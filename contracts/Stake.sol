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

    // Error messages
    error Stake__InvalidToken(string reason);
    error Stake__InvalidAmount(string reason);
    error Stake__InvalidDuration(string reason);
    error Stake__PoolNotFound();
    error Stake__PoolNotActive();
    error Stake__InsufficientBalance();
    error Stake__NoRewardsToClaim();
    error Stake__InvalidPaginationParameters();
    error Stake__CalculationOverflow();
    error Stake__UnauthorizedPoolDeactivation();

    uint256 private constant REWARD_PRECISION = 1e18;
    uint256 private constant MIN_REWARD_DURATION = 3600; // 1 hour in seconds
    uint256 private constant MAX_REWARD_DURATION =
        MIN_REWARD_DURATION * 24 * 365 * 10; // 10 years
    uint256 private constant MIN_STAKE_AMOUNT = 1000; // Prevent dust stakes to avoid Stake__CalculationOverflow

    // Gas optimized struct packing - fits in 6 storage slots
    struct Pool {
        address stakingToken; // 160 bits - slot 0 - immutable
        address rewardToken; // 160 bits - slot 1 - immutable
        address creator; // 160 bits - slot 2 - immutable
        uint128 rewardAmount; // 128 bits - slot 3 - immutable
        uint32 rewardDuration; // 32 bits - slot 3 (up to ~136 years in seconds) - immutable
        uint40 rewardCreatedAt; // 40 bits - slot 3 (until year 36,812) - immutable
        bool cancelled; // 8 bits - slot 3 - default false
        uint128 totalStaked; // 128 bits - slot 4
        uint32 activeStakerCount; // 32 bits - slot 4 - number of unique active stakers
        uint40 lastRewardTime; // 40 bits - slot 4
        uint256 accRewardPerShare; // 256 bits - slot 5
    }

    // Gas optimized struct packing - fits in 2 storage slots
    struct UserStake {
        uint128 stakedAmount; // 128 bits - slot 0
        uint128 claimedRewards; // 128 bits - slot 0
        uint256 rewardDebt; // 256 bits - slot 1
    }

    // poolId => Pool
    mapping(uint256 => Pool) public pools;

    // user => poolId => UserStake
    mapping(address => mapping(uint256 => UserStake)) public userPoolStake;

    uint256 public poolCount;

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        address indexed stakingToken,
        address rewardToken,
        uint128 rewardAmount,
        uint32 rewardDuration
    );
    event Staked(
        uint256 indexed poolId,
        address indexed staker,
        uint128 amount
    );
    event Unstaked(
        uint256 indexed poolId,
        address indexed staker,
        uint128 amount
    );
    event RewardClaimed(
        uint256 indexed poolId,
        address indexed staker,
        uint128 reward
    );
    event PoolCancelled(uint256 indexed poolId);

    modifier _checkPoolExists(uint256 poolId) {
        if (poolId >= poolCount) revert Stake__PoolNotFound();
        _;
    }

    modifier _checkPoolActive(uint256 poolId) {
        if (!isPoolActive(poolId)) revert Stake__PoolNotActive();
        _;
    }

    constructor() {}

    /**
     * @dev Safe calculation of accumulated reward amount with overflow protection
     * @param amount The staked amount
     * @param accRewardPerShare The accumulated reward per share
     * @return The calculated reward amount, or 0 if overflow would occur
     */
    function _safeCalculateReward(
        uint256 amount,
        uint256 accRewardPerShare
    ) internal pure returns (uint256) {
        if (amount == 0 || accRewardPerShare == 0) {
            return 0;
        }

        // Revert on overflow
        if (amount > type(uint256).max / accRewardPerShare)
            revert Stake__CalculationOverflow();

        return (amount * accRewardPerShare) / REWARD_PRECISION;
    }

    // MARK: - Pool Creation

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
        uint128 rewardAmount,
        uint32 rewardDuration
    ) external returns (uint256 poolId) {
        if (stakingToken == address(0))
            revert Stake__InvalidToken("stakingToken cannot be zero");
        if (rewardToken == address(0))
            revert Stake__InvalidToken("rewardToken cannot be zero");
        if (rewardAmount == 0)
            revert Stake__InvalidAmount("rewardAmount cannot be zero");
        if (
            rewardDuration < MIN_REWARD_DURATION ||
            rewardDuration > MAX_REWARD_DURATION
        ) revert Stake__InvalidDuration("rewardDuration out of range");

        poolId = poolCount++;
        uint40 currentTime = uint40(block.timestamp);

        pools[poolId] = Pool({
            stakingToken: stakingToken,
            rewardToken: rewardToken,
            creator: msg.sender,
            rewardAmount: rewardAmount,
            rewardDuration: rewardDuration,
            rewardCreatedAt: currentTime,
            cancelled: false,
            totalStaked: 0,
            activeStakerCount: 0,
            lastRewardTime: currentTime,
            accRewardPerShare: 0
        });

        // Transfer reward tokens from creator to contract
        IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            rewardAmount
        );

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
        if (msg.sender != pool.creator)
            revert Stake__UnauthorizedPoolDeactivation();

        pool.cancelled = true;
        emit PoolCancelled(poolId);
    }

    // MARK: - Internal Helper Functions

    /**
     * @dev Calculates up-to-date accRewardPerShare for a pool without modifying state
     * @param pool The pool struct
     * @return accRewardPerShare The up-to-date accumulated reward per share
     */
    function _getUpdatedAccRewardPerShare(
        Pool memory pool
    ) internal view returns (uint256 accRewardPerShare) {
        accRewardPerShare = pool.accRewardPerShare;

        uint40 currentTime = uint40(block.timestamp);
        if (currentTime > pool.lastRewardTime && pool.totalStaked > 0) {
            uint256 endTime = pool.rewardCreatedAt + pool.rewardDuration;
            uint256 toTime = currentTime > endTime ? endTime : currentTime;
            uint256 timePassed = toTime - pool.lastRewardTime;

            if (timePassed > 0) {
                uint256 rewardPerSecond = pool.rewardAmount /
                    pool.rewardDuration;
                uint256 totalReward = timePassed * rewardPerSecond;
                accRewardPerShare +=
                    (totalReward * REWARD_PRECISION) /
                    pool.totalStaked;
            }
        }
    }

    /**
     * @dev Calculates claimable rewards for a user in a pool (assumes pool is updated)
     * @param pool The pool struct
     * @param userStake The user's stake struct
     * @return claimableAmount The amount of rewards that can be claimed
     */
    function _calculateClaimableReward(
        Pool memory pool,
        UserStake memory userStake
    ) internal pure returns (uint256 claimableAmount) {
        if (userStake.stakedAmount > 0) {
            uint256 accRewardAmount = _safeCalculateReward(
                userStake.stakedAmount,
                pool.accRewardPerShare
            );
            if (accRewardAmount > userStake.rewardDebt) {
                claimableAmount = accRewardAmount - userStake.rewardDebt;
            }
        }
    }

    /**
     * @dev Internal function to claim rewards for a user
     * @param poolId The ID of the pool
     * @param user The address of the user
     * @return claimedAmount The amount of rewards claimed
     */
    function _claimRewards(
        uint256 poolId,
        address user
    ) internal returns (uint256 claimedAmount) {
        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[user][poolId];

        // Calculate claimable rewards
        claimedAmount = _calculateClaimableReward(pool, userStake);

        if (claimedAmount > 0) {
            // Update user's reward debt and claimed rewards
            userStake.rewardDebt = _safeCalculateReward(
                userStake.stakedAmount,
                pool.accRewardPerShare
            );
            userStake.claimedRewards += uint128(claimedAmount);

            // Transfer reward tokens to user
            IERC20(pool.rewardToken).safeTransfer(user, claimedAmount);

            emit RewardClaimed(poolId, user, uint128(claimedAmount));
        }
    }

    // MARK: - Staking Functions

    /**
     * @dev Updates the reward variables for a pool based on timestamp
     * @param poolId The ID of the pool to update
     */
    function updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        uint40 currentTime = uint40(block.timestamp);

        if (currentTime <= pool.lastRewardTime) {
            return;
        }

        if (pool.totalStaked == 0) {
            pool.lastRewardTime = currentTime;
            return;
        }

        uint256 endTime = pool.rewardCreatedAt + pool.rewardDuration;
        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - pool.lastRewardTime;

        if (timePassed > 0) {
            uint256 rewardPerSecond = pool.rewardAmount / pool.rewardDuration;
            uint256 totalReward = timePassed * rewardPerSecond;
            uint256 rewardPerShare = (totalReward * REWARD_PRECISION) /
                pool.totalStaked;

            pool.accRewardPerShare += rewardPerShare;
        }

        pool.lastRewardTime = currentTime;
    }

    /**
     * @dev Stakes tokens in a pool
     * @param poolId The ID of the pool to stake in
     * @param amount The amount of tokens to stake
     */
    function stake(
        uint256 poolId,
        uint128 amount
    ) external _checkPoolExists(poolId) _checkPoolActive(poolId) {
        if (amount < MIN_STAKE_AMOUNT)
            revert Stake__InvalidAmount("Stake amount too small");

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        updatePool(poolId);

        // If user has existing stake, accumulate pending rewards
        if (userStake.stakedAmount > 0) {
            uint256 accRewardAmount = _safeCalculateReward(
                userStake.stakedAmount,
                pool.accRewardPerShare
            );
            if (accRewardAmount > userStake.rewardDebt) {
                // Add pending rewards to claimable amount (stored in rewardDebt temporarily)
                userStake.rewardDebt = accRewardAmount;
            }
        } else {
            // First time staking in this pool
            pool.activeStakerCount++;
        }

        // Update user's staked amount and reward debt
        userStake.stakedAmount += amount;
        userStake.rewardDebt = _safeCalculateReward(
            userStake.stakedAmount,
            pool.accRewardPerShare
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
        uint128 amount
    ) external _checkPoolExists(poolId) {
        if (amount == 0) revert Stake__InvalidAmount("amount cannot be zero");

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        if (userStake.stakedAmount < amount)
            revert Stake__InsufficientBalance();

        updatePool(poolId);

        // Automatically claim all pending rewards before unstaking
        _claimRewards(poolId, msg.sender);

        // Update user's staked amount and reward debt
        userStake.stakedAmount -= amount;
        userStake.rewardDebt = userStake.stakedAmount > 0
            ? _safeCalculateReward(
                userStake.stakedAmount,
                pool.accRewardPerShare
            )
            : 0;

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
        updatePool(poolId);

        uint256 claimedAmount = _claimRewards(poolId, msg.sender);

        if (claimedAmount == 0) revert Stake__NoRewardsToClaim();
    }

    // MARK: - View Functions

    /**
     * @dev Returns whether a pool is still active (distributing rewards)
     * @param poolId The ID of the pool
     * @return active Whether the pool is active
     */
    function isPoolActive(
        uint256 poolId
    ) public view _checkPoolExists(poolId) returns (bool active) {
        Pool memory pool = pools[poolId];
        uint256 endTime = pool.rewardCreatedAt + pool.rewardDuration;
        active = !pool.cancelled && block.timestamp <= endTime;
    }

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

        // Get up-to-date accRewardPerShare
        pool.accRewardPerShare = _getUpdatedAccRewardPerShare(pool);

        // Calculate claimable rewards using the same logic as internal functions
        rewardClaimable = _calculateClaimableReward(pool, userStake);
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

        uint256 length = poolIdTo - poolIdFrom;
        results = new uint256[3][](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 poolId = poolIdFrom + i;
            if (poolId >= poolCount) break;

            (uint256 claimable, uint256 claimed) = this.claimableReward(
                poolId,
                staker
            );
            results[i] = [poolId, claimable, claimed];
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

        uint256 length = poolIdTo > poolCount
            ? poolCount - poolIdFrom
            : poolIdTo - poolIdFrom;
        poolList = new Pool[](length);

        for (uint256 i = 0; i < length; i++) {
            poolList[i] = pools[poolIdFrom + i];
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
        if (poolIdFrom >= poolIdTo) {
            return new uint256[](0);
        }

        // Limit search to actual pool count
        uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
        if (poolIdFrom >= searchTo) {
            return new uint256[](0);
        }

        // Count engaged pools first
        uint256 engagedCount = 0;
        for (uint256 i = poolIdFrom; i < searchTo; i++) {
            UserStake memory userStake = userPoolStake[staker][i];
            if (userStake.stakedAmount > 0 || userStake.claimedRewards > 0) {
                engagedCount++;
            }
        }

        // Create array with exact size
        poolIds = new uint256[](engagedCount);
        uint256 index = 0;
        for (uint256 i = poolIdFrom; i < searchTo; i++) {
            UserStake memory userStake = userPoolStake[staker][i];
            if (userStake.stakedAmount > 0 || userStake.claimedRewards > 0) {
                poolIds[index] = i;
                index++;
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
