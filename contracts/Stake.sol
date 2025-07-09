// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title Stake Contract
 * @dev Allows users to create staking pools for any ERC20 tokens with timestamp-based reward distribution
 */
contract Stake {
    using SafeERC20 for IERC20;

    // MARK: - Constants & Errors

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

    // Error messages
    error Stake__InvalidToken(string reason);
    error Stake__InvalidAmount(string reason);
    error Stake__InvalidDuration(string reason);
    error Stake__PoolNotFound();
    error Stake__PoolCancelled();
    error Stake__PoolFinished();
    error Stake__InsufficientBalance();
    error Stake__NoRewardsToClaim();
    error Stake__InvalidPaginationParameters();
    error Stake__Unauthorized();

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
        uint40 lastRewardUpadtedAt; // 40 bits - slot 4
        uint256 accRewardPerShare; // 256 bits - slot 5
    }

    // Gas optimized struct packing - fits in 2 storage slots
    struct UserStake {
        uint104 stakedAmount; // 104 bits - slot 0
        uint104 claimedRewards; // 104 bits - slot 0
        uint256 rewardDebt; // 256 bits - slot 1
    }

    // MARK: - State Variables

    // poolId => Pool
    mapping(uint256 => Pool) public pools;

    // user => poolId => UserStake
    mapping(address => mapping(uint256 => UserStake)) public userPoolStake;

    uint256 public poolCount;

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
        uint104 reward
    );
    event PoolCancelled(uint256 indexed poolId, uint256 leftoverRewards);

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
            currentTime <= pool.lastRewardUpadtedAt
        ) return pool.accRewardPerShare;

        uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;
        // If pool is cancelled, use cancellation time as end time
        if (pool.cancelledAt > 0 && pool.cancelledAt < endTime)
            endTime = pool.cancelledAt;

        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - pool.lastRewardUpadtedAt;

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
    ) internal pure returns (uint256 rewardClaimable) {
        if (stakedAmount == 0) return 0;

        uint256 accRewardAmount = (stakedAmount * updatedAccRewardPerShare) /
            REWARD_PRECISION;

        if (accRewardAmount <= originalRewardDebt) return 0;

        return accRewardAmount - originalRewardDebt;
    }

    /**
     * @dev Internal function to claim rewards for a user
     * @param poolId The ID of the pool
     * @param user The address of the user
     * @return claimAmount The amount of rewards claimed
     */
    function _claimRewards(
        uint256 poolId,
        address user
    ) internal returns (uint256 claimAmount) {
        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[user][poolId];

        // Use the helper function to calculate claimable rewards
        claimAmount = _claimableReward(
            pool.accRewardPerShare,
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        if (claimAmount == 0) return 0;

        // Update user's reward debt and claimed rewards
        userStake.rewardDebt += claimAmount;
        userStake.claimedRewards += uint104(claimAmount);

        // Transfer reward tokens to user
        IERC20(pool.rewardToken).safeTransfer(user, claimAmount);

        emit RewardClaimed(poolId, user, uint104(claimAmount));
    }

    /**
     * @dev Updates the reward variables for a pool based on timestamp
     * @param poolId The ID of the pool to update
     */
    function _updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        uint40 currentTime = uint40(block.timestamp);

        // If rewards haven't started yet or no time passed, no need to update
        if (
            pool.rewardStartedAt == 0 || currentTime <= pool.lastRewardUpadtedAt
        ) return;

        // Update accRewardPerShare
        pool.accRewardPerShare = _getUpdatedAccRewardPerShare(pool);

        // Update lastRewardUpadtedAt
        if (pool.totalStaked == 0) {
            // Track the skipped time to refund undistributed rewards on cancellation
            pool.totalSkippedDuration += uint32(
                currentTime - pool.lastRewardUpadtedAt
            );
            pool.lastRewardUpadtedAt = currentTime;
        } else {
            // TODO: REFACTOR
            uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;
            // If pool is cancelled, use cancellation time as end time
            if (pool.cancelledAt > 0 && pool.cancelledAt < endTime) {
                endTime = pool.cancelledAt;
            }
            uint256 toTime = currentTime > endTime ? endTime : currentTime;
            pool.lastRewardUpadtedAt = uint40(toTime);
        }
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
    ) external returns (uint256 poolId) {
        if (stakingToken == address(0))
            revert Stake__InvalidToken("stakingToken cannot be zero");
        if (rewardToken == address(0))
            revert Stake__InvalidToken("rewardToken cannot be zero");
        if (rewardAmount == 0)
            revert Stake__InvalidAmount("rewardAmount cannot be zero");
        if (rewardAmount > MAX_SAFE_REWARD_AMOUNT)
            revert Stake__InvalidAmount(
                "rewardAmount too large - would cause overflow"
            );
        if (
            rewardDuration < MIN_REWARD_DURATION ||
            rewardDuration > MAX_REWARD_DURATION
        ) revert Stake__InvalidDuration("rewardDuration out of range");

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
            lastRewardUpadtedAt: 0, // Will be set on first stake
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

        if (balanceAfter - balanceBefore != rewardAmount) {
            revert Stake__InvalidToken(
                "Token has transfer fees or rebasing - not supported"
            );
        }

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
    function cancelPool(uint256 poolId) external _checkPoolExists(poolId) {
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
    ) external _checkPoolExists(poolId) {
        if (amount < MIN_STAKE_AMOUNT)
            revert Stake__InvalidAmount("Stake amount too small");

        // Check if pool is active
        Pool storage pool = pools[poolId];
        if (pool.cancelledAt > 0) revert Stake__PoolCancelled();

        // If rewards haven't started yet, pool is still active
        if (pool.rewardStartedAt != 0) {
            uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;
            if (block.timestamp > endTime) revert Stake__PoolFinished();
        }

        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        // If this is the first stake in the pool, start the reward clock
        if (pool.totalStaked == 0) {
            uint40 currentTime = uint40(block.timestamp);
            pool.rewardStartedAt = currentTime;
            pool.lastRewardUpadtedAt = currentTime;
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
        userStake.rewardDebt =
            (userStake.stakedAmount * pool.accRewardPerShare) /
            REWARD_PRECISION;

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
    ) external _checkPoolExists(poolId) {
        if (amount == 0) revert Stake__InvalidAmount("amount cannot be zero");

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        if (userStake.stakedAmount < amount)
            revert Stake__InsufficientBalance();

        _updatePool(poolId);

        // Automatically claim all pending rewards before unstaking
        _claimRewards(poolId, msg.sender);

        // Update user's staked amount and reward debt
        userStake.stakedAmount -= amount;
        userStake.rewardDebt =
            (userStake.stakedAmount * pool.accRewardPerShare) /
            REWARD_PRECISION;

        // If user completely unstaked, decrement active staker count
        if (userStake.stakedAmount == 0) {
            pool.activeStakerCount--;
        }

        // Update pool's total staked amount
        pool.totalStaked -= amount;

        // Transfer tokens back to user
        IERC20(pool.stakingToken).safeTransfer(msg.sender, amount);

        emit Unstaked(poolId, msg.sender, amount);
    }

    /**
     * @dev Claims rewards from a pool
     * @param poolId The ID of the pool to claim rewards from
     */
    function claim(uint256 poolId) external _checkPoolExists(poolId) {
        _updatePool(poolId);

        uint256 claimedAmount = _claimRewards(poolId, msg.sender);

        if (claimedAmount == 0) revert Stake__NoRewardsToClaim();
    }

    // MARK: - View Functions

    /**
     * @dev Returns claimable reward for a user in a specific pool
     * @param poolId The ID of the pool
     * @param staker The address of the staker
     * @return rewardClaimable The amount of rewards that can be claimed
     * @return rewardClaimed The total amount of rewards already claimed
     */
    function claimableReward(
        uint256 poolId,
        address staker
    )
        external
        view
        _checkPoolExists(poolId)
        returns (uint256 rewardClaimable, uint256 rewardClaimed)
    {
        Pool memory pool = pools[poolId];
        UserStake memory userStake = userPoolStake[staker][poolId];

        rewardClaimable = _claimableReward(
            _getUpdatedAccRewardPerShare(pool),
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        rewardClaimed = userStake.claimedRewards;
    }

    /**
     * @dev Returns claimable rewards for multiple pools
     * @param poolIdFrom The starting pool ID
     * @param poolIdTo The ending pool ID (exclusive)
     * @param staker The address of the staker
     * @return results Array of [poolId, rewardClaimable, rewardClaimed]
     */
    function claimableRewardBulk(
        uint256 poolIdFrom,
        uint256 poolIdTo,
        address staker
    ) external view returns (uint256[3][] memory results) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            uint256 length = poolIdTo - poolIdFrom;
            results = new uint256[3][](length);

            for (uint256 i = 0; i < length; ++i) {
                uint256 poolId = poolIdFrom + i;
                if (poolId >= poolCount) break;

                (uint256 claimable, uint256 claimed) = this.claimableReward(
                    poolId,
                    staker
                );
                results[i] = [poolId, claimable, claimed];
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
     * @dev Returns all pools a user has interacted with
     * @param staker The address of the staker
     * @param poolIdFrom The starting pool ID to search from
     * @param poolIdTo The ending pool ID to search to (exclusive)
     * @return poolIds Array of pool IDs the user has engaged with
     */
    function getUserEngagedPools(
        address staker,
        uint256 poolIdFrom,
        uint256 poolIdTo
    ) external view returns (uint256[] memory poolIds) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            // Limit search to actual pool count
            uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
            if (poolIdFrom >= searchTo) {
                return new uint256[](0);
            }

            // Count engaged pools first
            uint256 engagedCount = 0;
            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                UserStake memory userStake = userPoolStake[staker][i];
                if (
                    userStake.stakedAmount > 0 || userStake.claimedRewards > 0
                ) {
                    ++engagedCount;
                }
            }

            // Create array with exact size
            poolIds = new uint256[](engagedCount);
            uint256 index = 0;
            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                UserStake memory userStake = userPoolStake[staker][i];
                if (
                    userStake.stakedAmount > 0 || userStake.claimedRewards > 0
                ) {
                    poolIds[index] = i;
                    ++index;
                }
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
