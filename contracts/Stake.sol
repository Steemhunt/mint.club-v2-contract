// SPDX-License-Identifier: BUSL-1.1

/**
 * @title Stake Contract
 * @notice Mint Club V2 - Staking Contract
 * @dev Allows users to create staking pools for any ERC20 tokens with timestamp-based reward distribution
 *
 * NOTICES:
 *      1. We use timestamp-based reward calculation,
 *         so it inherently carries minimal risk of timestamp manipulation (±15 seconds).
 *         We chose this design because this contract may be deployed on various networks with differing block times,
 *         and block times may change in the future even on the same network.
 *      2. We use uint40 for timestamp storage, which supports up to year 36,812.
 *      3. Precision Loss: Due to integer division in reward calculations, small amounts
 *         of reward tokens may be lost as "dust" and remain in the contract permanently.
 *         This is most pronounced with small reward amounts relative to large staking amounts.
 */

pragma solidity =0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";

contract Stake is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // MARK: - Constants & Errors

    uint256 private constant MAX_CLAIM_FEE = 2000; // 20% - for safety when admin privileges are abused
    uint256 private constant MAX_CREATION_FEE = 1 ether; // 1 ETH - for safety when admin privileges are abused
    uint256 private constant REWARD_PRECISION = 1e18;
    uint256 public constant MIN_REWARD_DURATION = 3600; // 1 hour in seconds
    uint256 public constant MAX_REWARD_DURATION =
        MIN_REWARD_DURATION * 24 * 365 * 10; // 10 years

    // MARK: - Error messages

    error Stake__InvalidToken();
    error Stake__TokenHasTransferFeesOrRebasing();
    error Stake__InvalidCreationFee();
    error Stake__CreationFeeTooHigh();
    error Stake__FeeTransferFailed();
    error Stake__InvalidDuration();
    error Stake__PoolNotFound();
    error Stake__PoolCancelled();
    error Stake__PoolFinished();
    error Stake__InsufficientBalance();
    error Stake__InvalidPaginationParameters();
    error Stake__Unauthorized();
    error Stake__InvalidAddress();
    error Stake__ZeroAmount();
    error Stake__InvalidClaimFee();
    error Stake__StakeAmountTooLarge();
    error Stake__InvalidTokenId();
    error Stake__RewardRateTooLow();

    // MARK: - Structs

    // Gas optimized struct packing - fits in 7 storage slots
    struct Pool {
        address stakingToken; // 160 bits - slot 0 - immutable
        bool isStakingTokenERC20; // 8 bit - slot 0 - immutable
        address rewardToken; // 160 bits - slot 1 - immutable
        address creator; // 160 bits - slot 2 - immutable
        uint104 rewardAmount; // 104 bits - slot 3 - immutable
        uint32 rewardDuration; // 32 bits - slot 3 (up to ~136 years in seconds) - immutable
        uint40 rewardStartedAt; // 40 bits - slot 3 (until year 36,812) - 0 until first stake
        uint40 cancelledAt; // 40 bits - slot 3 - default 0 (not cancelled)
        uint128 totalStaked; // 128 bits - slot 4
        uint32 activeStakerCount; // 32 bits - slot 4 - number of unique active stakers
        uint40 lastRewardUpdatedAt; // 40 bits - slot 4
        uint256 accRewardPerShare; // 256 bits - slot 5
        uint104 totalAllocatedRewards; // 104 bits - slot 6 - Track rewards allocated to users (earned but maybe not claimed)
    }

    // Gas optimized struct packing - fits in 3 storage slots
    struct UserStake {
        uint104 stakedAmount; // 104 bits - slot 0
        uint104 claimedTotal; // 104 bits - slot 0 - informational
        uint104 feeTotal; // 104 bits - slot 1 - informational
        uint256 rewardDebt; // 256 bits - slot 2 - uses full slot for overflow safety
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
        bool isStakingTokenERC20,
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
        uint104 amount,
        bool rewardClaimed
    );
    event RewardClaimed(
        uint256 indexed poolId,
        address indexed staker,
        uint104 reward,
        uint104 fee
    );
    event PoolCancelled(uint256 indexed poolId, uint256 leftoverRewards);
    event ProtocolBeneficiaryUpdated(
        address oldBeneficiary,
        address newBeneficiary
    );
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event ClaimFeeUpdated(uint256 oldFee, uint256 newFee);

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
     * @notice Integer division may cause precision loss in reward calculations
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

        uint256 totalReward = Math.mulDiv(
            timePassed,
            pool.rewardAmount,
            pool.rewardDuration
        );

        return
            pool.accRewardPerShare +
            Math.mulDiv(totalReward, REWARD_PRECISION, pool.totalStaked);
    }

    /**
     * @dev Calculates claimable rewards (assumes pool is updated)
     * @param updatedAccRewardPerShare The accumulated reward per share
     * @param stakedAmount The amount of tokens staked
     * @param originalRewardDebt The baseline reward amount to subtract, accounting for staking timing and already claimed rewards
     * @return rewardClaimable The amount of rewards that can be claimed
     * @notice Due to integer division, small amounts of rewards may be lost as "dust"
     *         This precision loss is most significant with small reward amounts relative to large total staked amounts
     */
    function _claimableReward(
        uint256 updatedAccRewardPerShare,
        uint256 stakedAmount,
        uint256 originalRewardDebt
    ) internal view returns (uint256 rewardClaimable, uint256 fee) {
        if (stakedAmount == 0) return (0, 0);

        uint256 accRewardAmount = Math.mulDiv(
            stakedAmount,
            updatedAccRewardPerShare,
            REWARD_PRECISION
        );

        if (accRewardAmount <= originalRewardDebt) return (0, 0);

        rewardClaimable = accRewardAmount - originalRewardDebt;
        fee = Math.mulDiv(rewardClaimable, claimFee, 10000);
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
        userStake.rewardDebt += rewardAndFee;
        // Safe to cast because claimAmount + fee <= pool.rewardAmount (uint104)
        userStake.claimedTotal += uint104(claimAmount);
        userStake.feeTotal += uint104(fee);

        // Transfer reward tokens to user (reward tokens are always ERC20)
        if (claimAmount > 0) {
            IERC20(pool.rewardToken).safeTransfer(user, claimAmount);
        }
        if (fee > 0) {
            IERC20(pool.rewardToken).safeTransfer(protocolBeneficiary, fee);
        }

        emit RewardClaimed(poolId, user, uint104(claimAmount), uint104(fee));
    }

    /**
     * @dev Safely transfers tokens from one address to another with balance verification
     * @param token The address of the token to transfer
     * @param isERC20 Whether the token is ERC20 (true) or ERC1155 (false)
     * @param from The address to transfer from
     * @param to The address to transfer to
     * @param amount The amount to transfer
     */
    function _safeTransferFrom(
        address token,
        bool isERC20,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (isERC20) {
            uint256 balanceBefore = IERC20(token).balanceOf(to);
            IERC20(token).safeTransferFrom(from, to, amount);
            uint256 balanceAfter = IERC20(token).balanceOf(to);

            if (balanceAfter - balanceBefore != amount) {
                revert Stake__TokenHasTransferFeesOrRebasing();
            }
        } else {
            // For ERC1155, we use token ID 0 only
            uint256 balanceBefore = IERC1155(token).balanceOf(to, 0);
            IERC1155(token).safeTransferFrom(from, to, 0, amount, "");
            uint256 balanceAfter = IERC1155(token).balanceOf(to, 0);

            if (balanceAfter - balanceBefore != amount) {
                revert Stake__TokenHasTransferFeesOrRebasing();
            }
        }
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

        // Cache more values for efficiency
        uint32 rewardDuration = pool.rewardDuration;
        uint40 cancelledAt = pool.cancelledAt;
        uint256 endTime = rewardStartedAt + rewardDuration;

        // If pool is cancelled, use cancellation time as end time
        if (cancelledAt > 0 && cancelledAt < endTime) {
            endTime = cancelledAt;
        }
        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - lastRewardUpdatedAt;

        // Track allocated rewards if there are stakers and time has passed
        if (pool.totalStaked > 0 && timePassed > 0) {
            uint256 totalReward = Math.mulDiv(
                timePassed,
                pool.rewardAmount,
                pool.rewardDuration
            );
            // Track these rewards as allocated to users (earned, whether claimed or not)
            pool.totalAllocatedRewards += uint104(totalReward);
        }

        // Update accRewardPerShare
        pool.accRewardPerShare = _getUpdatedAccRewardPerShare(pool);

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
        bool isStakingTokenERC20,
        address rewardToken,
        uint104 rewardAmount,
        uint32 rewardDuration
    ) external payable nonReentrant returns (uint256 poolId) {
        if (stakingToken == address(0)) revert Stake__InvalidToken();
        if (rewardToken == address(0)) revert Stake__InvalidToken();
        if (rewardAmount == 0) revert Stake__ZeroAmount();
        if (
            rewardDuration < MIN_REWARD_DURATION ||
            rewardDuration > MAX_REWARD_DURATION
        ) revert Stake__InvalidDuration();
        // Validate that reward rate is meaningful to prevent precision loss
        if (rewardAmount / rewardDuration == 0)
            revert Stake__RewardRateTooLow();
        if (msg.value != creationFee) revert Stake__InvalidCreationFee();

        if (creationFee > 0) {
            (bool success, ) = protocolBeneficiary.call{value: creationFee}("");
            if (!success) revert Stake__FeeTransferFailed();
        }

        poolId = poolCount;
        poolCount = poolId + 1;

        pools[poolId] = Pool({
            stakingToken: stakingToken,
            isStakingTokenERC20: isStakingTokenERC20,
            rewardToken: rewardToken,
            creator: msg.sender,
            rewardAmount: rewardAmount,
            rewardDuration: rewardDuration,
            rewardStartedAt: 0, // Will be set on first stake
            cancelledAt: 0,
            totalStaked: 0,
            activeStakerCount: 0,
            lastRewardUpdatedAt: 0, // Will be set on first stake
            accRewardPerShare: 0,
            totalAllocatedRewards: 0
        });

        // Transfer reward tokens from creator to contract (always ERC20)
        _safeTransferFrom(
            rewardToken,
            true,
            msg.sender,
            address(this),
            rewardAmount
        );

        emit PoolCreated(
            poolId,
            msg.sender,
            stakingToken,
            isStakingTokenERC20,
            rewardToken,
            rewardAmount,
            rewardDuration
        );
    }

    /**
     * @dev Cancels a pool (only pool creator can call)
     * @param poolId The ID of the pool to cancel
     * @notice INTENTIONAL DESIGN: Pool creators can cancel their pools at any time, even during active staking periods.
     *         This may impact stakers who committed tokens expecting ongoing reward distribution for the full duration.
     *         Stakers risk losing expected future rewards when creators exercise this cancellation right.
     *         This design prioritizes creator flexibility over staker reward guarantees.
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
        // Only return rewards that haven't been allocated to users yet
        // This prevents precision loss from permanently locking tokens and ensures
        // that users can still claim rewards they've earned even after cancellation
        uint256 leftoverRewards = pool.rewardAmount -
            pool.totalAllocatedRewards;

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

            // Reward tokens are always ERC20
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
        if (amount == 0) revert Stake__ZeroAmount();

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

        // safely checks for overflow and reverts with the custom error
        if (
            type(uint104).max - amount < userStake.stakedAmount ||
            type(uint128).max - amount < totalStaked
        ) revert Stake__StakeAmountTooLarge();

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

        // Update user's staked amount
        userStake.stakedAmount += amount;
        userStake.rewardDebt = Math.mulDiv(
            userStake.stakedAmount,
            pool.accRewardPerShare,
            REWARD_PRECISION
        );

        // Update pool's total staked amount
        pool.totalStaked += amount;

        // Transfer tokens from user to contract with balance check to prevent transfer fees/rebasing tokens
        _safeTransferFrom(
            pool.stakingToken,
            pool.isStakingTokenERC20,
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
        _unstake(poolId, amount, true);
    }

    /**
     * @dev Emergency unstake function that allows users to withdraw ALL their staking tokens
     * without claiming rewards. Use this if reward claims are failing due to malicious reward tokens.
     * WARNING: Any accumulated rewards will be forfeited and permanently locked in the contract.
     * @param poolId The ID of the pool to unstake from
     */
    function emergencyUnstake(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        // Unstake the total staked amount
        _unstake(poolId, userPoolStake[msg.sender][poolId].stakedAmount, false);
    }

    /**
     * @dev Internal function to handle unstaking logic
     * @param poolId The ID of the pool to unstake from
     * @param amount The amount of tokens to unstake
     * @param shouldClaimRewards Whether to claim rewards before unstaking
     */
    function _unstake(
        uint256 poolId,
        uint104 amount,
        bool shouldClaimRewards
    ) internal {
        if (amount == 0) revert Stake__ZeroAmount();

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        if (userStake.stakedAmount < amount)
            revert Stake__InsufficientBalance();

        _updatePool(poolId);

        // Regular unstake: claim rewards
        if (shouldClaimRewards) {
            _claimRewards(poolId, msg.sender); // Transfers rewards and updates rewardDebt
        }
        // Emergency unstake: skip reward claiming (rewards are forfeited)

        // Update user and pool's staked amount
        unchecked {
            userStake.stakedAmount -= amount; // Safe: checked above
            pool.totalStaked -= amount; // Safe: total always >= user amount
        }

        // Reset rewardDebt for both regular and emergency unstake
        userStake.rewardDebt = Math.mulDiv(
            userStake.stakedAmount,
            pool.accRewardPerShare,
            REWARD_PRECISION
        );

        // If user completely unstaked, decrement active staker count
        if (userStake.stakedAmount == 0) {
            pool.activeStakerCount--;
        }

        // Transfer tokens back to user
        if (pool.isStakingTokenERC20) {
            IERC20(pool.stakingToken).safeTransfer(msg.sender, amount);
        } else {
            // For ERC1155, we use token ID 0 only
            IERC1155(pool.stakingToken).safeTransferFrom(
                address(this),
                msg.sender,
                0,
                amount,
                ""
            );
        }

        emit Unstaked(poolId, msg.sender, amount, shouldClaimRewards);
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

        address oldBeneficiary = protocolBeneficiary;
        protocolBeneficiary = protocolBeneficiary_;
        emit ProtocolBeneficiaryUpdated(oldBeneficiary, protocolBeneficiary_);
    }

    function updateCreationFee(uint256 creationFee_) public onlyOwner {
        if (creationFee_ > MAX_CREATION_FEE) revert Stake__CreationFeeTooHigh();
        uint256 oldFee = creationFee;
        creationFee = creationFee_;
        emit CreationFeeUpdated(oldFee, creationFee_);
    }

    function updateClaimFee(uint256 claimFee_) public onlyOwner {
        if (claimFee_ > MAX_CLAIM_FEE) revert Stake__InvalidClaimFee();
        uint256 oldFee = claimFee;
        claimFee = claimFee_;
        emit ClaimFeeUpdated(oldFee, claimFee_);
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

    // Struct and view helper functions for getPool and getPools
    struct TokenInfo {
        string symbol;
        string name;
        uint8 decimals;
    }
    struct PoolView {
        Pool pool;
        TokenInfo stakingToken;
        TokenInfo rewardToken;
    }

    function _getTokenInfo(
        address tokenAddress
    ) internal view returns (TokenInfo memory) {
        MCV2_ICommonToken token = MCV2_ICommonToken(tokenAddress);
        string memory symbol;
        string memory name;
        uint8 decimals;
        try token.symbol() returns (string memory _symbol) {
            symbol = _symbol;
        } catch {
            symbol = "undefined";
        }
        try token.name() returns (string memory _name) {
            name = _name;
        } catch {
            name = "undefined";
        }
        try token.decimals() returns (uint8 _decimals) {
            decimals = _decimals;
        } catch {
            decimals = 0;
        }

        return TokenInfo({symbol: symbol, name: name, decimals: decimals});
    }

    /**
     * @dev Returns pool information for a single pool
     * @param poolId The ID of the pool
     * @return poolView The pool information
     */
    function getPool(
        uint256 poolId
    ) external view _checkPoolExists(poolId) returns (PoolView memory) {
        Pool memory pool = pools[poolId];
        TokenInfo memory stakingTokenInfo = _getTokenInfo(pool.stakingToken);
        TokenInfo memory rewardTokenInfo = _getTokenInfo(pool.rewardToken);

        return PoolView(pool, stakingTokenInfo, rewardTokenInfo);
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
    ) external view returns (PoolView[] memory poolList) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            uint256 length = poolIdTo > poolCount
                ? poolCount - poolIdFrom
                : poolIdTo - poolIdFrom;
            poolList = new PoolView[](length);

            for (uint256 i = 0; i < length; ++i) {
                Pool memory pool = pools[poolIdFrom + i];
                poolList[i] = PoolView({
                    pool: pool,
                    stakingToken: _getTokenInfo(pool.stakingToken),
                    rewardToken: _getTokenInfo(pool.rewardToken)
                });
            }
        }
    }

    /**
     * @dev Returns pool information for pools created by a specific creator within a range
     * @param poolIdFrom The starting pool ID (inclusive)
     * @param poolIdTo The ending pool ID (exclusive)
     * @param creator The address of the pool creator to filter by
     * @return poolList Array of PoolView structs for pools created by the specified creator
     * @notice This function filters pools by creator and returns only matching pools
     *         The returned array size will match the number of pools found, not the input range
     */
    function getPoolsByCreator(
        uint256 poolIdFrom,
        uint256 poolIdTo,
        address creator
    ) external view returns (PoolView[] memory poolList) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            // Limit search to actual pool count
            uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
            if (poolIdFrom >= searchTo) {
                return new PoolView[](0);
            }

            // Single pass: collect results in temporary array, then resize
            uint256 maxLength = searchTo - poolIdFrom;
            PoolView[] memory tempResults = new PoolView[](maxLength);
            uint256 validCount = 0;

            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                Pool memory pool = pools[i];

                // Skip pools not created by the specified creator
                if (pool.creator != creator) continue;

                tempResults[validCount] = PoolView({
                    pool: pool,
                    stakingToken: _getTokenInfo(pool.stakingToken),
                    rewardToken: _getTokenInfo(pool.rewardToken)
                });
                ++validCount;
            }

            // Create final array with exact size and copy results
            poolList = new PoolView[](validCount);
            for (uint256 i = 0; i < validCount; ++i) {
                poolList[i] = tempResults[i];
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

    // MARK: - ERC1155 Receiver

    /**
     * @dev Handles the receipt of a single ERC1155 token type. This function is
     * called at the end of a `safeTransferFrom` after the balance has been updated.
     * Required for the contract to receive ERC1155 tokens.
     */
    function onERC1155Received(
        address,
        address,
        uint256 id,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        if (id != 0) revert Stake__InvalidTokenId();

        return this.onERC1155Received.selector;
    }
}
