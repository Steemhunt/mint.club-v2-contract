// SPDX-License-Identifier: BUSL-1.1

/**
 * @title Stake Contract
 * @notice Mint Club V2 - Staking Contract
 * @dev Allows users to create staking pools for any ERC20 tokens with timestamp-based reward distribution
 *
 * NOTE:
 *      1. We use timestamp-based reward calculation,
 *         so it inherently carries minimal risk of timestamp manipulation (±15 seconds).
 *         We chose this design because this contract may be deployed on various networks with differing block times,
 *         and block times may change in the future even on the same network.
 *      2. We use uint40 for timestamp storage, which supports up to year 36,812.
 */

pragma solidity =0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Stake is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // MARK: - Constants & Errors

    uint256 private constant MAX_CLAIM_FEE = 2000; // 20% - for safety when admin privileges are abused
    uint256 private constant REWARD_PRECISION = 1e18;
    uint256 public constant MIN_REWARD_DURATION = 3600; // 1 hour in seconds
    uint256 public constant MAX_REWARD_DURATION =
        MIN_REWARD_DURATION * 24 * 365 * 10; // 10 years
    uint256 public constant MIN_STAKE_AMOUNT = 1000; // Prevent dust stakes for gas efficiency and to avoid state bloat

    // Maximum safe reward amount to prevent overflow in calculations
    // Calculation: MAX_SAFE_REWARD_AMOUNT = (type(uint256).max * MIN_STAKE_AMOUNT) / (type(uint104).max * REWARD_PRECISION)
    // This ensures that even with maximum stake amounts, accRewardPerShare calculations won't overflow
    uint256 public constant MAX_SAFE_REWARD_AMOUNT =
        ((type(uint256).max / type(uint104).max) * MIN_STAKE_AMOUNT) /
            REWARD_PRECISION; // ~ 5.7T tokens with 18 decimals

    // MARK: - Error messages

    error Stake__InvalidToken();
    error Stake__TokenHasTransferFeesOrRebasing();
    error Stake__InvalidRewardAmount();
    error Stake__InvalidCreationFee();
    error Stake__FeeTransferFailed();
    error Stake__InvalidDuration();
    error Stake__PoolNotFound();
    error Stake__PoolCancelled();
    error Stake__PoolFinished();
    error Stake__InsufficientBalance();
    error Stake__InvalidPaginationParameters();
    error Stake__Unauthorized();
    error Stake__InvalidAddress();
    error Stake__StakeTooSmall();
    error Stake__ZeroAmount();
    error Stake__InvalidClaimFee();

    // MARK: - Structs

    // Gas optimized struct packing - fits in 6 storage slots
    struct Pool {
        address stakingToken; // 160 bits - slot 0 - immutable
        address rewardToken; // 160 bits - slot 1 - immutable
        address creator; // 160 bits - slot 2 - immutable
        uint104 rewardAmount; // 104 bits - slot 3 - immutable
        uint32 rewardDuration; // 32 bits - slot 3 (up to ~136 years in seconds) - immutable
        uint32 totalSkippedDuration; // 32 bits - slot 3 - Track time when totalStaked was 0 to refund undistributed rewards
        uint40 rewardStartedAt; // 40 bits - slot 3 (until year 36,812) - 0 until first stake
        uint40 cancelledAt; // 40 bits - slot 3 - default 0 (not cancelled)
        uint128 totalStaked; // 128 bits - slot 4
        uint32 activeStakerCount; // 32 bits - slot 4 - number of unique active stakers
        uint40 lastRewardUpdatedAt; // 40 bits - slot 4
        uint256 accRewardPerShare; // 256 bits - slot 5
    }

    // Gas optimized struct packing - fits in 2 storage slots
    struct UserStake {
        uint104 stakedAmount; // 104 bits - slot 0
        uint104 rewardDebt; // 104 bits - slot 0
        uint104 claimedTotal; // 104 bits - slot 1 - informational
        uint104 feeTotal; // 104 bits - slot 1 - informational
    }

    // MARK: - Protocol Config Variables

    address public protocolBeneficiary;
    uint256 public creationFee;
    uint256 public claimFee; // BP: 10000 = 100%

    // MARK: - Pool State Variables

    uint256 public poolCount;
    // poolId => Pool
    mapping(uint256 => Pool) public pools;
    // user => poolId => UserStake
    mapping(address => mapping(uint256 => UserStake)) public userPoolStake;

    // MARK: - Events

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        address indexed stakingToken,
        address rewardToken,
        uint104 rewardAmount,
        uint32 rewardDuration
    );
    event Staked(
        uint256 indexed poolId,
        address indexed staker,
        uint104 amount
    );
    event Unstaked(
        uint256 indexed poolId,
        address indexed staker,
        uint104 amount
    );
    event RewardClaimed(
        uint256 indexed poolId,
        address indexed staker,
        uint104 reward,
        uint104 fee
    );
    event PoolCancelled(uint256 indexed poolId, uint256 leftoverRewards);
    event ProtocolBeneficiaryUpdated(address protocolBeneficiary);
    event CreationFeeUpdated(uint256 creationFee);
    event ClaimFeeUpdated(uint256 claimFee);

    constructor(
        address protocolBeneficiary_,
        uint256 creationFee_,
        uint256 claimFee_
    ) Ownable(msg.sender) {
        updateProtocolBeneficiary(protocolBeneficiary_);
        updateCreationFee(creationFee_);
        updateClaimFee(claimFee_);
    }

    // MARK: - Modifiers

    modifier _checkPoolExists(uint256 poolId) {
        if (poolId >= poolCount) revert Stake__PoolNotFound();
        _;
    }

    // MARK: - Internal Helper Functions

    /**
     * @dev Calculates up-to-date accRewardPerShare for a pool without modifying state
     * @param pool The pool struct
     * @return updatedAccRewardPerShare The up-to-date accumulated reward per share
     */
    function _getUpdatedAccRewardPerShare(
        Pool memory pool
    ) internal view returns (uint256 updatedAccRewardPerShare) {
        uint40 currentTime = uint40(block.timestamp);

        // If rewards haven't started yet or no staked, no rewards to distribute
        if (
            pool.rewardStartedAt == 0 ||
            pool.totalStaked == 0 ||
            currentTime <= pool.lastRewardUpdatedAt
        ) return pool.accRewardPerShare;

        uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;
        // If pool is cancelled, use cancellation time as end time
        if (pool.cancelledAt > 0 && pool.cancelledAt < endTime)
            endTime = pool.cancelledAt;

        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - pool.lastRewardUpdatedAt;

        if (timePassed == 0) return pool.accRewardPerShare;

        uint256 totalReward = (timePassed * pool.rewardAmount) /
            pool.rewardDuration;

        return
            pool.accRewardPerShare +
            (totalReward * REWARD_PRECISION) /
            pool.totalStaked;
    }

    /**
     * @dev Calculates claimable rewards (assumes pool is updated)
     * @param updatedAccRewardPerShare The accumulated reward per share
     * @param stakedAmount The amount of tokens staked
     * @param originalRewardDebt The baseline reward amount to subtract, accounting for staking timing and already claimed rewards
     * @return rewardClaimable The amount of rewards that can be claimed
     */
    function _claimableReward(
        uint256 updatedAccRewardPerShare,
        uint256 stakedAmount,
        uint256 originalRewardDebt
    ) internal view returns (uint256 rewardClaimable, uint256 fee) {
        if (stakedAmount == 0) return (0, 0);

        uint256 accRewardAmount = (stakedAmount * updatedAccRewardPerShare) /
            REWARD_PRECISION;

        if (accRewardAmount <= originalRewardDebt) return (0, 0);

        rewardClaimable = accRewardAmount - originalRewardDebt;
        fee = (rewardClaimable * claimFee) / 10000;
        rewardClaimable -= fee;
    }

    /**
     * @dev Internal function to claim rewards for a user
     * @param poolId The ID of the pool
     * @param user The address of the user
     */
    function _claimRewards(uint256 poolId, address user) internal {
        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[user][poolId];

        // Use the helper function to calculate claimable rewards
        (uint256 claimAmount, uint256 fee) = _claimableReward(
            pool.accRewardPerShare,
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        uint256 rewardAndFee = claimAmount + fee;
        assert(rewardAndFee <= pool.rewardAmount);
        if (rewardAndFee == 0) return;

        // Update user's reward debt and claimed rewards
        userStake.rewardDebt += uint104(rewardAndFee);
        userStake.claimedTotal += uint104(claimAmount);
        userStake.feeTotal += uint104(fee);

        // Transfer reward tokens to user
        IERC20(pool.rewardToken).safeTransfer(user, claimAmount);
        IERC20(pool.rewardToken).safeTransfer(protocolBeneficiary, fee);

        emit RewardClaimed(poolId, user, uint104(claimAmount), uint104(fee));
    }

    /**
     * @dev Updates the reward variables for a pool based on timestamp
     * @param poolId The ID of the pool to update
     */
    function _updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        uint40 currentTime = uint40(block.timestamp);

        // Cache frequently accessed storage values
        uint40 rewardStartedAt = pool.rewardStartedAt;
        uint40 lastRewardUpdatedAt = pool.lastRewardUpdatedAt;

        // If rewards haven't started yet or no time passed, no need to update
        if (rewardStartedAt == 0 || currentTime <= lastRewardUpdatedAt) return;

        // Update accRewardPerShare
        pool.accRewardPerShare = _getUpdatedAccRewardPerShare(pool);

        // Cache more values for efficiency
        uint32 rewardDuration = pool.rewardDuration;
        uint40 cancelledAt = pool.cancelledAt;
        uint256 endTime = rewardStartedAt + rewardDuration;

        // If pool is cancelled, use cancellation time as end time
        if (cancelledAt > 0 && cancelledAt < endTime) {
            endTime = cancelledAt;
        }
        uint256 toTime = currentTime > endTime ? endTime : currentTime;

        if (pool.totalStaked == 0) {
            // Track the skipped time to refund undistributed rewards on cancellation
            uint256 skippedTime = toTime - lastRewardUpdatedAt;
            assert(skippedTime <= rewardDuration);
            unchecked {
                pool.totalSkippedDuration += uint32(skippedTime);
            }
        }

        pool.lastRewardUpdatedAt = uint40(toTime);
    }

    // MARK: - Pool Management

    /**
     * @dev Creates a new staking pool with timestamp-based rewards
     * @param stakingToken The address of the token to be staked
     * @param rewardToken The address of the reward token
     * @param rewardAmount The total amount of rewards to be distributed
     * @param rewardDuration The duration in seconds over which rewards are distributed
     * @return poolId The ID of the newly created pool
     */
    function createPool(
        address stakingToken,
        address rewardToken,
        uint104 rewardAmount,
        uint32 rewardDuration
    ) external payable nonReentrant returns (uint256 poolId) {
        if (stakingToken == address(0)) revert Stake__InvalidToken();
        if (rewardToken == address(0)) revert Stake__InvalidToken();
        if (rewardAmount == 0) revert Stake__ZeroAmount();
        if (rewardAmount > MAX_SAFE_REWARD_AMOUNT)
            revert Stake__InvalidRewardAmount();
        if (
            rewardDuration < MIN_REWARD_DURATION ||
            rewardDuration > MAX_REWARD_DURATION
        ) revert Stake__InvalidDuration();
        if (msg.value != creationFee) revert Stake__InvalidCreationFee();

        if (creationFee > 0) {
            (bool success, ) = protocolBeneficiary.call{value: creationFee}("");
            if (!success) revert Stake__FeeTransferFailed();
        }

        poolId = poolCount;
        poolCount = poolId + 1;

        pools[poolId] = Pool({
            stakingToken: stakingToken,
            rewardToken: rewardToken,
            creator: msg.sender,
            rewardAmount: rewardAmount,
            rewardDuration: rewardDuration,
            totalSkippedDuration: 0,
            rewardStartedAt: 0, // Will be set on first stake
            cancelledAt: 0,
            totalStaked: 0,
            activeStakerCount: 0,
            lastRewardUpdatedAt: 0, // Will be set on first stake
            accRewardPerShare: 0
        });

        uint256 balanceBefore = IERC20(rewardToken).balanceOf(address(this));
        // Transfer reward tokens from creator to contract
        IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            rewardAmount
        );
        uint256 balanceAfter = IERC20(rewardToken).balanceOf(address(this));

        if (balanceAfter - balanceBefore != rewardAmount)
            revert Stake__TokenHasTransferFeesOrRebasing();

        emit PoolCreated(
            poolId,
            msg.sender,
            stakingToken,
            rewardToken,
            rewardAmount,
            rewardDuration
        );
    }

    /**
     * @dev Cancels a pool (only pool creator can call)
     * @param poolId The ID of the pool to cancel
     */
    function cancelPool(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.creator) revert Stake__Unauthorized();
        if (pool.cancelledAt > 0) revert Stake__PoolCancelled(); // Already cancelled

        // Update pool rewards up to cancellation time
        _updatePool(poolId);

        uint40 currentTime = uint40(block.timestamp);

        // Calculate leftover rewards to return to creator
        uint256 leftoverRewards = 0;
        if (pool.rewardStartedAt == 0) {
            // Pool never started, return all rewards
            leftoverRewards = pool.rewardAmount;
        } else {
            uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;

            // Calculate future rewards
            uint256 futureRewards = 0;
            if (currentTime < endTime) {
                uint256 remainingTime = endTime - currentTime;
                futureRewards =
                    (remainingTime * pool.rewardAmount) /
                    pool.rewardDuration;
            }

            // Calculate skipped rewards from past unstaked periods
            uint256 skippedRewards = (pool.totalSkippedDuration *
                pool.rewardAmount) / pool.rewardDuration;

            leftoverRewards = futureRewards + skippedRewards;
        }

        // Set cancellation time
        pool.cancelledAt = currentTime;

        // Return leftover rewards to creator if any
        if (leftoverRewards > 0) {
            // Conditions that should never happen
            assert(leftoverRewards <= pool.rewardAmount);
            assert(
                leftoverRewards <=
                    IERC20(pool.rewardToken).balanceOf(address(this))
            );

            IERC20(pool.rewardToken).safeTransfer(
                pool.creator,
                leftoverRewards
            );
        }

        emit PoolCancelled(poolId, leftoverRewards);
    }

    // MARK: - Stake Operations

    /**
     * @dev Stakes tokens into a pool to earn rewards
     * @param poolId The ID of the pool to stake in
     * @param amount The amount of tokens to stake
     */
    function stake(
        uint256 poolId,
        uint104 amount
    ) external nonReentrant _checkPoolExists(poolId) {
        if (amount < MIN_STAKE_AMOUNT) revert Stake__StakeTooSmall();

        Pool storage pool = pools[poolId];

        // Cache frequently accessed storage values for gas efficiency
        uint40 cancelledAt = pool.cancelledAt;
        uint40 rewardStartedAt = pool.rewardStartedAt;
        uint32 rewardDuration = pool.rewardDuration;
        uint128 totalStaked = pool.totalStaked;

        if (cancelledAt > 0) revert Stake__PoolCancelled();
        if (
            rewardStartedAt > 0 &&
            block.timestamp > rewardStartedAt + rewardDuration
        ) {
            revert Stake__PoolFinished();
        }

        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        // If this is the first stake in the pool, start the reward clock
        if (rewardStartedAt == 0 && totalStaked == 0) {
            uint40 currentTime = uint40(block.timestamp);
            pool.rewardStartedAt = currentTime;
            pool.lastRewardUpdatedAt = currentTime;
        }

        _updatePool(poolId);

        // If user has existing stake, claim pending rewards first to preserve them
        if (userStake.stakedAmount > 0) {
            _claimRewards(poolId, msg.sender);
        } else {
            // First time staking in this pool
            pool.activeStakerCount++;
        }

        // Update user's staked amount and reward debt
        userStake.stakedAmount += amount;
        userStake.rewardDebt = uint104(
            (userStake.stakedAmount * pool.accRewardPerShare) / REWARD_PRECISION
        );

        // Update pool's total staked amount
        pool.totalStaked += amount;

        // Transfer tokens from user to contract
        IERC20(pool.stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        emit Staked(poolId, msg.sender, amount);
    }

    /**
     * @dev Unstakes tokens from a pool
     * @param poolId The ID of the pool to unstake from
     * @param amount The amount of tokens to unstake
     */
    function unstake(
        uint256 poolId,
        uint104 amount
    ) external nonReentrant _checkPoolExists(poolId) {
        if (amount == 0) revert Stake__ZeroAmount();

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        if (userStake.stakedAmount < amount)
            revert Stake__InsufficientBalance();

        _updatePool(poolId);

        // Automatically claim all pending rewards before unstaking
        _claimRewards(poolId, msg.sender);

        // Update user's staked amount and reward debt
        unchecked {
            userStake.stakedAmount -= amount; // Safe: checked above
        }
        userStake.rewardDebt = uint104(
            (userStake.stakedAmount * pool.accRewardPerShare) / REWARD_PRECISION
        );

        // If user completely unstaked, decrement active staker count
        if (userStake.stakedAmount == 0) {
            pool.activeStakerCount--;
        }

        // Update pool's total staked amount
        unchecked {
            pool.totalStaked -= amount; // Safe: total always >= user amount
        }

        // Transfer tokens back to user
        IERC20(pool.stakingToken).safeTransfer(msg.sender, amount);

        emit Unstaked(poolId, msg.sender, amount);
    }

    /**
     * @dev Claims rewards from a pool
     * @param poolId The ID of the pool to claim rewards from
     */
    function claim(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        _updatePool(poolId);

        _claimRewards(poolId, msg.sender);
    }

    // MARK: - Admin Functions

    function updateProtocolBeneficiary(
        address protocolBeneficiary_
    ) public onlyOwner {
        if (protocolBeneficiary_ == address(0)) revert Stake__InvalidAddress();

        protocolBeneficiary = protocolBeneficiary_;
        emit ProtocolBeneficiaryUpdated(protocolBeneficiary_);
    }

    function updateCreationFee(uint256 creationFee_) public onlyOwner {
        creationFee = creationFee_;
        emit CreationFeeUpdated(creationFee_);
    }

    function updateClaimFee(uint256 claimFee_) public onlyOwner {
        if (claimFee_ > MAX_CLAIM_FEE) revert Stake__InvalidClaimFee();
        claimFee = claimFee_;
        emit ClaimFeeUpdated(claimFee_);
    }

    // MARK: - View Functions

    /**
     * @dev Returns claimable reward for a user in a specific pool
     * @param poolId The ID of the pool
     * @param staker The address of the staker
     * @return rewardClaimable The amount of rewards that can be claimed
     * @return fee The fee for claiming rewards
     * @return claimedTotal The total amount of rewards already claimed
     * @return feeTotal The total amount of fees already claimed
     */
    function claimableReward(
        uint256 poolId,
        address staker
    )
        external
        view
        _checkPoolExists(poolId)
        returns (
            uint256 rewardClaimable,
            uint256 fee,
            uint256 claimedTotal,
            uint256 feeTotal
        )
    {
        Pool memory pool = pools[poolId];
        UserStake memory userStake = userPoolStake[staker][poolId];

        (rewardClaimable, fee) = _claimableReward(
            _getUpdatedAccRewardPerShare(pool),
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        claimedTotal = userStake.claimedTotal;
        feeTotal = userStake.feeTotal;
    }

    /**
     * @dev Returns claimable rewards for multiple pools that user have engaged (staked > 0 or claimable > 0 or claimed > 0)
     * @param poolIdFrom The starting pool ID
     * @param poolIdTo The ending pool ID (exclusive)
     * @param staker The address of the staker
     * @return results Array of [poolId, rewardClaimable, fee, claimedTotal, feeTotal] for pools with rewards only
     */
    function claimableRewardBulk(
        uint256 poolIdFrom,
        uint256 poolIdTo,
        address staker
    ) external view returns (uint256[5][] memory results) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            // Limit search to actual pool count
            uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
            if (poolIdFrom >= searchTo) {
                return new uint256[5][](0);
            }

            // Single pass: collect results in temporary array, then resize
            uint256 maxLength = searchTo - poolIdFrom;
            uint256[5][] memory tempResults = new uint256[5][](maxLength);
            uint256 validCount = 0;

            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                UserStake memory userStake = userPoolStake[staker][i];

                // Skip if user has not engaged with the pool
                if (userStake.stakedAmount == 0 && userStake.claimedTotal == 0)
                    continue;

                // If the user currently has no staked amount, all rewards are claimed because unstaking claims all pending rewards
                // We can simply return the claimed total and fee total
                if (userStake.stakedAmount == 0) {
                    tempResults[validCount] = [
                        i,
                        0,
                        0,
                        userStake.claimedTotal,
                        userStake.feeTotal
                    ];
                    ++validCount;
                    continue;
                }

                // Now, staked > 0, so we need to calculate the claimable reward
                (uint256 claimable, uint256 fee) = _claimableReward(
                    _getUpdatedAccRewardPerShare(pools[i]),
                    userStake.stakedAmount,
                    userStake.rewardDebt
                );

                tempResults[validCount] = [
                    i,
                    claimable,
                    fee,
                    userStake.claimedTotal,
                    userStake.feeTotal
                ];
                ++validCount;
            }

            // Create final array with exact size and copy results
            results = new uint256[5][](validCount);
            for (uint256 i = 0; i < validCount; ++i) {
                results[i] = tempResults[i];
            }
        }
    }

    /**
     * @dev Returns pool information for a range of pools
     * @param poolIdFrom The starting pool ID
     * @param poolIdTo The ending pool ID (exclusive)
     * @return poolList Array of Pool structs
     */
    function getPools(
        uint256 poolIdFrom,
        uint256 poolIdTo
    ) external view returns (Pool[] memory poolList) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            uint256 length = poolIdTo > poolCount
                ? poolCount - poolIdFrom
                : poolIdTo - poolIdFrom;
            poolList = new Pool[](length);

            for (uint256 i = 0; i < length; ++i) {
                poolList[i] = pools[poolIdFrom + i];
            }
        }
    }

    /**
     * @dev Returns the version of the contract
     * @return The version string
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
