const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { NULL_ADDRESS, wei } = require("./utils/test-utils");

// =============================================================================
// CONSTANTS
// =============================================================================

const ORIGINAL_BALANCE = wei(200000000); // 200M tokens
const STAKE_AMOUNT = wei(1000);
const REWARD_AMOUNT = wei(10000);
const REWARD_DURATION = 3600; // 1 hour in seconds
const MIN_REWARD_DURATION = 3600; // 1 hour
const MAX_REWARD_DURATION = 3600 * 24 * 365 * 10; // 10 years

// =============================================================================
// FIXTURES
// =============================================================================

async function deployStakeFixture() {
  const Stake = await ethers.deployContract("Stake");
  await Stake.waitForDeployment();

  const StakingToken = await ethers.deployContract("TestToken", [
    ORIGINAL_BALANCE,
    "Staking Token",
    "STAKE",
    18n,
  ]);
  await StakingToken.waitForDeployment();

  const RewardToken = await ethers.deployContract("TestToken", [
    ORIGINAL_BALANCE,
    "Reward Token",
    "REWARD",
    18n,
  ]);
  await RewardToken.waitForDeployment();

  const AnotherToken = await ethers.deployContract("TestToken", [
    ORIGINAL_BALANCE,
    "Another Token",
    "OTHER",
    18n,
  ]);
  await AnotherToken.waitForDeployment();

  const [owner, alice, bob, carol] = await ethers.getSigners();

  return {
    Stake,
    StakingToken,
    RewardToken,
    AnotherToken,
    owner,
    alice,
    bob,
    carol,
  };
}

async function deployStakeWithPoolFixture() {
  const contracts = await deployStakeFixture();
  const { Stake, StakingToken, RewardToken, owner } = contracts;

  // Create a standard pool
  await RewardToken.approve(Stake.target, REWARD_AMOUNT);
  await Stake.createPool(
    StakingToken.target,
    RewardToken.target,
    REWARD_AMOUNT,
    REWARD_DURATION
  );

  return { ...contracts, poolId: 0 };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function createPool(
  Stake,
  stakingToken,
  rewardToken,
  rewardAmount = REWARD_AMOUNT,
  duration = REWARD_DURATION
) {
  await rewardToken.approve(Stake.target, rewardAmount);
  const tx = await Stake.createPool(
    stakingToken.target,
    rewardToken.target,
    rewardAmount,
    duration
  );
  const receipt = await tx.wait();
  const poolId = (await Stake.poolCount()) - 1n;
  return poolId;
}

async function stakeTokens(Stake, stakingToken, user, poolId, amount) {
  await stakingToken.connect(user).approve(Stake.target, amount);
  return await Stake.connect(user).stake(poolId, amount);
}

async function setupUserTokens(
  stakingToken,
  users,
  amount = STAKE_AMOUNT * 3n
) {
  for (const user of users) {
    await stakingToken.transfer(user.address, amount);
  }
}

async function getEventFromReceipt(receipt, eventName) {
  return receipt.logs.find((log) => log.fragment?.name === eventName);
}

// =============================================================================
// TESTS
// =============================================================================

describe("Stake Contract", function () {
  describe("Deployment", function () {
    it("should deploy successfully", async function () {
      const { Stake } = await loadFixture(deployStakeFixture);
      expect(await Stake.version()).to.equal("1.0.0");
      expect(await Stake.poolCount()).to.equal(0);
    });
  });

  describe("Pool Creation", function () {
    let Stake, StakingToken, RewardToken, AnotherToken, owner;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, AnotherToken, owner } =
        await loadFixture(deployStakeFixture));
    });

    describe("Successful Pool Creation", function () {
      beforeEach(async function () {
        await RewardToken.approve(Stake.target, REWARD_AMOUNT);
        await Stake.createPool(
          StakingToken.target,
          RewardToken.target,
          REWARD_AMOUNT,
          REWARD_DURATION
        );
        this.pool = await Stake.pools(0);
      });

      it("should create pool with correct parameters", async function () {
        expect(this.pool.stakingToken).to.equal(StakingToken.target);
        expect(this.pool.rewardToken).to.equal(RewardToken.target);
        expect(this.pool.rewardAmount).to.equal(REWARD_AMOUNT);
        expect(this.pool.rewardDuration).to.equal(REWARD_DURATION);
        expect(this.pool.creator).to.equal(owner.address);
        expect(this.pool.cancelled).to.equal(false);
        expect(this.pool.totalStaked).to.equal(0);
      });

      it("should transfer reward tokens to contract", async function () {
        expect(await RewardToken.balanceOf(Stake.target)).to.equal(
          REWARD_AMOUNT
        );
        expect(await RewardToken.balanceOf(owner.address)).to.equal(
          ORIGINAL_BALANCE - REWARD_AMOUNT
        );
      });

      it("should emit PoolCreated event", async function () {
        await RewardToken.approve(Stake.target, REWARD_AMOUNT);
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          )
        )
          .to.emit(Stake, "PoolCreated")
          .withArgs(
            1,
            owner.address,
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          );
      });

      it("should increment pool count", async function () {
        expect(await Stake.poolCount()).to.equal(1);
      });
    });

    describe("Same Token Pool Creation", function () {
      it("should allow same token for staking and rewards", async function () {
        await StakingToken.approve(Stake.target, REWARD_AMOUNT);
        await expect(
          Stake.createPool(
            StakingToken.target,
            StakingToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          )
        ).to.not.be.reverted;

        const pool = await Stake.pools(0);
        expect(pool.stakingToken).to.equal(StakingToken.target);
        expect(pool.rewardToken).to.equal(StakingToken.target);
        expect(pool.rewardAmount).to.equal(REWARD_AMOUNT);
        expect(pool.cancelled).to.equal(false);
      });
    });

    describe("Pool Creation Validations", function () {
      it("should reject zero staking token address", async function () {
        await expect(
          Stake.createPool(
            NULL_ADDRESS,
            RewardToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidToken")
          .withArgs("stakingToken cannot be zero");
      });

      it("should reject zero reward token address", async function () {
        await expect(
          Stake.createPool(
            StakingToken.target,
            NULL_ADDRESS,
            REWARD_AMOUNT,
            REWARD_DURATION
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidToken")
          .withArgs("rewardToken cannot be zero");
      });

      it("should reject zero reward amount", async function () {
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            0,
            REWARD_DURATION
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
          .withArgs("rewardAmount cannot be zero");
      });

      it("should reject reward duration too short", async function () {
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            MIN_REWARD_DURATION - 1
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
          .withArgs("rewardDuration out of range");
      });

      it("should reject reward duration too long", async function () {
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            MAX_REWARD_DURATION + 1
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
          .withArgs("rewardDuration out of range");
      });
    });
  });

  describe("Staking Operations", function () {
    let Stake, StakingToken, RewardToken, owner, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, owner, alice, bob, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
      await setupUserTokens(StakingToken, [alice, bob]);
    });

    describe("Staking Tokens", function () {
      it("should stake tokens successfully", async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        const userStake = await Stake.userPoolStake(alice.address, poolId);
        const pool = await Stake.pools(poolId);

        expect(userStake.stakedAmount).to.equal(STAKE_AMOUNT);
        expect(pool.totalStaked).to.equal(STAKE_AMOUNT);
      });

      it("should transfer staking tokens to contract", async function () {
        const initialBalance = await StakingToken.balanceOf(alice.address);
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        expect(await StakingToken.balanceOf(Stake.target)).to.equal(
          STAKE_AMOUNT
        );
        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          initialBalance - STAKE_AMOUNT
        );
      });

      it("should emit Staked event", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await expect(Stake.connect(alice).stake(poolId, STAKE_AMOUNT))
          .to.emit(Stake, "Staked")
          .withArgs(poolId, alice.address, STAKE_AMOUNT);
      });

      it("should accumulate multiple stakes", async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        const userStake = await Stake.userPoolStake(alice.address, poolId);
        const pool = await Stake.pools(poolId);

        expect(userStake.stakedAmount).to.equal(STAKE_AMOUNT * 2n);
        expect(pool.totalStaked).to.equal(STAKE_AMOUNT * 2n);
      });

      describe("Staking Validations", function () {
        it("should reject staking in non-existent pool", async function () {
          await expect(
            stakeTokens(Stake, StakingToken, alice, 999, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should reject zero stake amount", async function () {
          await expect(stakeTokens(Stake, StakingToken, alice, poolId, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("Stake amount too small");
        });

        it("should reject staking in cancelled pool", async function () {
          await Stake.cancelPool(poolId);
          await expect(
            stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotActive");
        });

        it("should reject staking below minimum amount", async function () {
          const minStakeAmount = 1000; // MIN_STAKE_AMOUNT from contract
          await expect(
            stakeTokens(Stake, StakingToken, alice, poolId, minStakeAmount - 1)
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("Stake amount too small");
        });

        it("should accept staking at minimum amount", async function () {
          const minStakeAmount = 1000; // MIN_STAKE_AMOUNT from contract
          await stakeTokens(Stake, StakingToken, alice, poolId, minStakeAmount);

          const userStake = await Stake.userPoolStake(alice.address, poolId);
          expect(userStake.stakedAmount).to.equal(minStakeAmount);
        });
      });
    });

    describe("Unstaking Tokens", function () {
      beforeEach(async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await time.increase(100); // Accumulate some rewards
      });

      it("should unstake tokens successfully", async function () {
        const unstakeAmount = STAKE_AMOUNT / 2n;
        await Stake.connect(alice).unstake(poolId, unstakeAmount);

        const userStake = await Stake.userPoolStake(alice.address, poolId);
        const pool = await Stake.pools(poolId);

        expect(userStake.stakedAmount).to.equal(STAKE_AMOUNT - unstakeAmount);
        expect(pool.totalStaked).to.equal(STAKE_AMOUNT - unstakeAmount);
      });

      it("should transfer tokens back to user", async function () {
        const initialBalance = await StakingToken.balanceOf(alice.address);
        const unstakeAmount = STAKE_AMOUNT / 2n;

        await Stake.connect(alice).unstake(poolId, unstakeAmount);

        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          initialBalance + unstakeAmount
        );
      });

      it("should emit Unstaked event", async function () {
        const unstakeAmount = STAKE_AMOUNT / 2n;
        await expect(Stake.connect(alice).unstake(poolId, unstakeAmount))
          .to.emit(Stake, "Unstaked")
          .withArgs(poolId, alice.address, unstakeAmount);
      });

      it("should automatically claim rewards when unstaking", async function () {
        const initialRewardBalance = await RewardToken.balanceOf(alice.address);

        // Wait for rewards to accumulate
        await time.increase(360);

        // Check claimable rewards before unstaking
        const [claimableBefore] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(claimableBefore).to.be.gt(0);

        // Unstake completely without explicitly claiming
        const tx = await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT);
        const receipt = await tx.wait();

        // Should emit both RewardClaimed and Unstaked events
        const rewardEvent = await getEventFromReceipt(receipt, "RewardClaimed");
        const unstakeEvent = await getEventFromReceipt(receipt, "Unstaked");

        expect(rewardEvent).to.not.be.undefined;
        expect(rewardEvent.args[0]).to.equal(poolId);
        expect(rewardEvent.args[1]).to.equal(alice.address);
        expect(rewardEvent.args[2]).to.be.closeTo(claimableBefore, wei(50));

        expect(unstakeEvent).to.not.be.undefined;
        expect(unstakeEvent.args[2]).to.equal(STAKE_AMOUNT);

        // Check rewards were transferred
        const finalRewardBalance = await RewardToken.balanceOf(alice.address);
        expect(finalRewardBalance).to.be.gt(initialRewardBalance);

        // Check user's claimed rewards were updated
        const userStake = await Stake.userPoolStake(alice.address, poolId);
        expect(userStake.claimedRewards).to.be.closeTo(
          claimableBefore,
          wei(50)
        );

        // Claimable rewards should now be 0
        const [claimableAfter] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(claimableAfter).to.equal(0);
      });

      it("should prevent reward loss when unstaking completely without manual claiming", async function () {
        const initialRewardBalance = await RewardToken.balanceOf(alice.address);

        // Wait for significant rewards to accumulate
        await time.increase(1800); // 30 minutes = 50% of reward duration

        // Check rewards before unstaking
        const [rewardsBefore] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(rewardsBefore).to.be.closeTo(wei(5000), wei(300)); // ~50% of 10000

        // Unstake completely without manually claiming first
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT);

        // User should have received the rewards automatically
        const finalRewardBalance = await RewardToken.balanceOf(alice.address);
        expect(finalRewardBalance - initialRewardBalance).to.be.closeTo(
          rewardsBefore,
          wei(300)
        );

        // No rewards should be lost - claimable should be 0
        const [rewardsAfter] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(rewardsAfter).to.equal(0);

        // User's claimed rewards should be recorded
        const userStake = await Stake.userPoolStake(alice.address, poolId);
        expect(userStake.claimedRewards).to.be.closeTo(rewardsBefore, wei(300));
      });

      it("should handle unstaking when minimal rewards are pending", async function () {
        // Unstake immediately after staking (minimal time passed)
        const tx = await Stake.connect(alice).unstake(
          poolId,
          STAKE_AMOUNT / 2n
        );
        const receipt = await tx.wait();

        // Should always emit Unstaked event
        const unstakeEvent = await getEventFromReceipt(receipt, "Unstaked");
        expect(unstakeEvent).to.not.be.undefined;

        // May or may not emit RewardClaimed depending on timing
        const rewardEvent = await getEventFromReceipt(receipt, "RewardClaimed");
        if (rewardEvent) {
          // If rewards were claimed, they should be reasonable (less than 10% of total)
          expect(rewardEvent.args[2]).to.be.lt(wei(1000)); // Less than 1000 tokens
        }
      });

      describe("Unstaking Validations", function () {
        it("should reject unstaking from non-existent pool", async function () {
          await expect(
            Stake.connect(alice).unstake(999, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should reject zero unstake amount", async function () {
          await expect(Stake.connect(alice).unstake(poolId, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("amount cannot be zero");
        });

        it("should reject unstaking more than staked", async function () {
          await expect(
            Stake.connect(alice).unstake(poolId, STAKE_AMOUNT * 2n)
          ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
        });
      });
    });

    describe("Active Staker Count Tracking", function () {
      it("should track active staker count correctly", async function () {
        // Initially no active stakers
        let pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(0);

        // Alice stakes
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(1);

        // Bob stakes
        await stakeTokens(Stake, StakingToken, bob, poolId, STAKE_AMOUNT);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(2);

        // Alice stakes again - should not increment
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(2);
      });

      it("should decrement active staker count when user completely unstakes", async function () {
        // Both users stake
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await stakeTokens(Stake, StakingToken, bob, poolId, STAKE_AMOUNT);

        let pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(2);

        // Alice partially unstakes - should not decrement
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(2);

        // Alice completely unstakes - should decrement
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(1);

        // Bob completely unstakes - should decrement
        await Stake.connect(bob).unstake(poolId, STAKE_AMOUNT);
        pool = await Stake.pools(poolId);
        expect(pool.activeStakerCount).to.equal(0);
      });
    });
  });

  describe("Reward System", function () {
    let Stake, StakingToken, RewardToken, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, alice, bob, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
      await setupUserTokens(StakingToken, [alice, bob]);
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
    });

    describe("Reward Calculations", function () {
      it("should calculate rewards correctly over time", async function () {
        await time.increase(360); // 10% of reward duration

        const [claimable, claimed] = await Stake.claimableReward(
          poolId,
          alice.address
        );

        expect(claimable).to.be.closeTo(wei(1000), wei(1)); // 10% of 10000
        expect(claimed).to.equal(0);
      });

      it("should handle multiple stakers proportionally", async function () {
        await stakeTokens(Stake, StakingToken, bob, poolId, STAKE_AMOUNT);
        await time.increase(360);

        const [aliceClaimable] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(poolId, bob.address);

        expect(aliceClaimable).to.be.gt(bobClaimable); // Alice staked earlier
        expect(aliceClaimable + bobClaimable).to.be.closeTo(wei(1000), wei(50));
      });

      it("should return zero for non-stakers", async function () {
        const [claimable, claimed] = await Stake.claimableReward(
          poolId,
          bob.address
        );
        expect(claimable).to.equal(0);
        expect(claimed).to.equal(0);
      });

      it("should cap rewards at total reward amount", async function () {
        await time.increase(REWARD_DURATION + 1000); // Beyond reward period

        const [claimable] = await Stake.claimableReward(poolId, alice.address);
        expect(claimable).to.be.lte(REWARD_AMOUNT);
        expect(claimable).to.be.closeTo(REWARD_AMOUNT, wei(100));
      });
    });

    describe("Claiming Rewards", function () {
      beforeEach(async function () {
        await time.increase(360);
        this.initialBalance = await RewardToken.balanceOf(alice.address);
      });

      it("should claim rewards successfully", async function () {
        await Stake.connect(alice).claim(poolId);

        const finalBalance = await RewardToken.balanceOf(alice.address);
        const userStake = await Stake.userPoolStake(alice.address, poolId);

        expect(finalBalance).to.be.gt(this.initialBalance);
        expect(userStake.claimedRewards).to.be.gt(0);
      });

      it("should emit RewardClaimed event", async function () {
        const tx = await Stake.connect(alice).claim(poolId);
        const receipt = await tx.wait();
        const event = await getEventFromReceipt(receipt, "RewardClaimed");

        expect(event).to.not.be.undefined;
        expect(event.args[0]).to.equal(poolId);
        expect(event.args[1]).to.equal(alice.address);
        expect(event.args[2]).to.be.closeTo(wei(1000), wei(50));
      });

      it("should reset claimable rewards after claiming", async function () {
        await Stake.connect(alice).claim(poolId);
        const [claimable] = await Stake.claimableReward(poolId, alice.address);
        expect(claimable).to.equal(0);
      });

      describe("Claiming Validations", function () {
        it("should reject claiming from non-existent pool", async function () {
          await expect(
            Stake.connect(alice).claim(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should reject claiming when no rewards available", async function () {
          await expect(
            Stake.connect(bob).claim(poolId)
          ).to.be.revertedWithCustomError(Stake, "Stake__NoRewardsToClaim");
        });
      });
    });
  });

  describe("Same Token Staking", function () {
    let Stake, StakingToken, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, alice, bob } = await loadFixture(
        deployStakeFixture
      ));
      poolId = await createPool(Stake, StakingToken, StakingToken);
      await setupUserTokens(StakingToken, [alice, bob]);
    });

    it("should allow staking with same token", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

      const userStake = await Stake.userPoolStake(alice.address, poolId);
      expect(userStake.stakedAmount).to.equal(STAKE_AMOUNT);
    });

    it("should allow unstaking with same token", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);

      const userStake = await Stake.userPoolStake(alice.address, poolId);
      expect(userStake.stakedAmount).to.equal(STAKE_AMOUNT / 2n);
    });

    it("should calculate rewards correctly for same token", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(360);

      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.be.closeTo(wei(1000), wei(1));
    });

    it("should handle token balances correctly", async function () {
      const initialContractBalance = await StakingToken.balanceOf(Stake.target);

      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      const afterStakeBalance = await StakingToken.balanceOf(Stake.target);
      expect(afterStakeBalance).to.equal(initialContractBalance + STAKE_AMOUNT);

      await time.increase(360);
      await Stake.connect(alice).claim(poolId);
      const afterClaimBalance = await StakingToken.balanceOf(Stake.target);
      expect(afterClaimBalance).to.be.lt(afterStakeBalance);
    });
  });

  describe("Utility Functions", function () {
    let Stake, StakingToken, RewardToken, AnotherToken, alice, bob;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, AnotherToken, alice, bob } =
        await loadFixture(deployStakeFixture));

      // Create multiple pools
      await createPool(Stake, StakingToken, RewardToken);
      await createPool(Stake, AnotherToken, RewardToken);
      await createPool(Stake, StakingToken, AnotherToken);
    });

    describe("Pool Information", function () {
      it("should return pools with pagination", async function () {
        const pools = await Stake.getPools(0, 3);
        expect(pools).to.have.length(3);
        expect(pools[0].stakingToken).to.equal(StakingToken.target);
        expect(pools[1].stakingToken).to.equal(AnotherToken.target);
        expect(pools[2].stakingToken).to.equal(StakingToken.target);
      });

      it("should handle partial pagination", async function () {
        const pools = await Stake.getPools(1, 2);
        expect(pools).to.have.length(1);
        expect(pools[0].stakingToken).to.equal(AnotherToken.target);
      });

      it("should reject invalid pagination", async function () {
        await expect(Stake.getPools(2, 1)).to.be.revertedWithCustomError(
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    });

    describe("Bulk Reward Query", function () {
      beforeEach(async function () {
        await setupUserTokens(StakingToken, [alice]);
        await setupUserTokens(AnotherToken, [alice]);

        await stakeTokens(Stake, StakingToken, alice, 0, STAKE_AMOUNT);
        await stakeTokens(Stake, AnotherToken, alice, 1, STAKE_AMOUNT);
        await time.increase(360);
      });

      it("should return bulk reward information", async function () {
        const results = await Stake.claimableRewardBulk(0, 2, alice.address);

        expect(results).to.have.length(2);
        expect(results[0][0]).to.equal(0); // poolId
        expect(results[0][1]).to.be.gt(0); // claimable
        expect(results[1][0]).to.equal(1); // poolId
        expect(results[1][1]).to.be.gt(0); // claimable
      });

      it("should handle bulk query pagination", async function () {
        const results = await Stake.claimableRewardBulk(0, 1, alice.address);
        expect(results).to.have.length(1);
        expect(results[0][0]).to.equal(0);
      });

      it("should reject invalid bulk query parameters", async function () {
        await expect(
          Stake.claimableRewardBulk(1, 0, alice.address)
        ).to.be.revertedWithCustomError(
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    });

    describe("Pool Status", function () {
      it("should return active status correctly", async function () {
        expect(await Stake.isPoolActive(0)).to.be.true;

        await time.increase(REWARD_DURATION + 1);
        expect(await Stake.isPoolActive(0)).to.be.false;
      });
    });

    describe("User Engaged Pools Tracking", function () {
      it("should track user engaged pools correctly", async function () {
        // Create multiple pools
        const poolId1 = await createPool(Stake, StakingToken, RewardToken);
        const poolId2 = await createPool(Stake, AnotherToken, RewardToken);

        await setupUserTokens(StakingToken, [alice]);
        await setupUserTokens(AnotherToken, [alice]);

        // Initially no pools for alice
        expect(
          await Stake.getUserEngagedPools(alice.address, 0, 1000)
        ).to.have.length(0);

        // Stake in first pool
        await stakeTokens(Stake, StakingToken, alice, poolId1, STAKE_AMOUNT);
        let userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1);
        expect(userPools[0]).to.equal(poolId1);

        // Stake in second pool
        await stakeTokens(Stake, AnotherToken, alice, poolId2, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);
        expect(userPools[0]).to.equal(poolId1);
        expect(userPools[1]).to.equal(poolId2);

        // Stake again in first pool - should not duplicate
        await stakeTokens(Stake, StakingToken, alice, poolId1, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);
      });

      it("should track different users separately", async function () {
        const poolId1 = await createPool(Stake, StakingToken, RewardToken);
        const poolId2 = await createPool(Stake, AnotherToken, RewardToken);

        await setupUserTokens(StakingToken, [alice, bob]);
        await setupUserTokens(AnotherToken, [alice, bob]);

        // Alice stakes in pool 1
        await stakeTokens(Stake, StakingToken, alice, poolId1, STAKE_AMOUNT);

        // Bob stakes in pool 2
        await stakeTokens(Stake, AnotherToken, bob, poolId2, STAKE_AMOUNT);

        // Check alice's pools
        const alicePools = await Stake.getUserEngagedPools(
          alice.address,
          0,
          10
        );
        expect(alicePools).to.have.length(1);
        expect(alicePools[0]).to.equal(poolId1);

        // Check bob's pools
        const bobPools = await Stake.getUserEngagedPools(bob.address, 0, 1000);
        expect(bobPools).to.have.length(1);
        expect(bobPools[0]).to.equal(poolId2);
      });

      it("should keep pools in engaged list even after complete unstaking", async function () {
        const poolId1 = await createPool(Stake, StakingToken, RewardToken);
        const poolId2 = await createPool(Stake, AnotherToken, RewardToken);

        await setupUserTokens(StakingToken, [alice]);
        await setupUserTokens(AnotherToken, [alice]);

        // Stake in both pools
        await stakeTokens(Stake, StakingToken, alice, poolId1, STAKE_AMOUNT);
        await stakeTokens(Stake, AnotherToken, alice, poolId2, STAKE_AMOUNT);

        let userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);

        // Completely unstake from first pool - should remain in engaged pools
        await Stake.connect(alice).unstake(poolId1, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);
        expect(userPools[0]).to.equal(poolId1);
        expect(userPools[1]).to.equal(poolId2);

        // Completely unstake from second pool - should still remain
        await Stake.connect(alice).unstake(poolId2, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);
        expect(userPools[0]).to.equal(poolId1);
        expect(userPools[1]).to.equal(poolId2);
      });

      it("should prevent duplicate pool IDs when restaking after claiming", async function () {
        const poolId = await createPool(Stake, StakingToken, RewardToken);

        await setupUserTokens(StakingToken, [alice]);

        // Initial stake
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        let userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1);
        expect(userPools[0]).to.equal(poolId);

        // Wait and claim rewards
        await time.increase(360);
        await Stake.connect(alice).claim(poolId);

        // Completely unstake
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1); // Still there

        // Stake again - should NOT create duplicate
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1); // Still just one entry
        expect(userPools[0]).to.equal(poolId);

        // Verify user still has claim history
        const userStake = await Stake.userPoolStake(alice.address, poolId);
        expect(userStake.claimedRewards).to.be.gt(0);
      });

      it("should prevent duplicate pool IDs when restaking without claiming", async function () {
        const poolId = await createPool(Stake, StakingToken, RewardToken);

        await setupUserTokens(StakingToken, [alice]);

        // Initial stake
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        let userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1);

        // Unstake without claiming
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1); // Still there

        // Stake again - should NOT create duplicate
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(1); // Still just one entry
        expect(userPools[0]).to.equal(poolId);
      });
    });
  });

  describe("Pool Management", function () {
    let Stake, StakingToken, RewardToken, owner, alice, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, owner, alice, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
    });

    it("should allow creator to cancel pool", async function () {
      await expect(Stake.cancelPool(poolId))
        .to.emit(Stake, "PoolCancelled")
        .withArgs(poolId);

      const pool = await Stake.pools(poolId);
      expect(pool.cancelled).to.be.true;
    });

    it("should prevent non-creator from cancelling pool", async function () {
      await expect(
        Stake.connect(alice).cancelPool(poolId)
      ).to.be.revertedWithCustomError(
        Stake,
        "Stake__UnauthorizedPoolDeactivation"
      );
    });
  });

  describe("Edge Cases", function () {
    let Stake, StakingToken, RewardToken, alice, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, alice, poolId } = await loadFixture(
        deployStakeWithPoolFixture
      ));
    });

    it("should handle zero staked amount gracefully", async function () {
      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.equal(0);
    });

    it("should return correct pool count", async function () {
      expect(await Stake.poolCount()).to.equal(1);
    });

    it("should handle completed reward duration", async function () {
      await setupUserTokens(StakingToken, [alice]);
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

      await time.increase(REWARD_DURATION + 1000);

      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.be.lte(REWARD_AMOUNT);
      expect(claimable).to.be.closeTo(REWARD_AMOUNT, wei(100));
    });
  });

  describe("Calculation Overflow Protection", function () {
    let Stake, StakingToken, RewardToken, alice, bob;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, alice, bob } = await loadFixture(
        deployStakeFixture
      ));
    });

    it("should prevent overflow in reward calculations", async function () {
      // Create a pool with extreme conditions that could cause overflow
      const largeRewardAmount = wei(1000000); // 1M tokens
      const shortDuration = 3600; // 1 hour

      await RewardToken.approve(Stake.target, largeRewardAmount);
      const poolId = await createPool(
        Stake,
        StakingToken,
        RewardToken,
        largeRewardAmount,
        shortDuration
      );

      // Setup tokens for users
      await setupUserTokens(StakingToken, [alice, bob]);

      // Stake tiny amount to create high accRewardPerShare
      await stakeTokens(Stake, StakingToken, alice, poolId, 1000); // MIN_STAKE_AMOUNT

      // Bob stakes before reward period ends
      await StakingToken.connect(bob).approve(Stake.target, 1000);
      await Stake.connect(bob).stake(poolId, 1000);

      // Fast forward to accumulate massive rewards per share (but not past end)
      await time.increase(shortDuration - 100); // Stop 100 seconds before end

      // Try to claim rewards - should not overflow
      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.be.lte(largeRewardAmount);

      // Fast forward past end to test that staking is now blocked
      await time.increase(200);

      // Now trying to stake should fail with PoolNotActive
      await expect(
        stakeTokens(Stake, StakingToken, alice, poolId, 1000)
      ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotActive");
    });

    it("should handle maximum possible staking amounts", async function () {
      const poolId = await createPool(Stake, StakingToken, RewardToken);

      // Transfer large amount to alice (within available balance)
      const maxStakeAmount = wei(100000000); // 100M tokens (within 200M original balance)
      await StakingToken.transfer(alice.address, maxStakeAmount);

      // This should not overflow even with large amounts
      await stakeTokens(Stake, StakingToken, alice, poolId, maxStakeAmount);

      const userStake = await Stake.userPoolStake(alice.address, poolId);
      expect(userStake.stakedAmount).to.equal(maxStakeAmount);
    });

    it("should handle zero division edge cases", async function () {
      const poolId = await createPool(Stake, StakingToken, RewardToken);

      // Test with zero staked amount
      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.equal(0);

      // Test with zero accRewardPerShare (no time passed)
      await setupUserTokens(StakingToken, [alice]);
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

      const [claimableNoTime] = await Stake.claimableReward(
        poolId,
        alice.address
      );
      expect(claimableNoTime).to.equal(0);
    });
  });

  describe("Minimum Stake Amount Validation", function () {
    let Stake, StakingToken, RewardToken, alice, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, alice, poolId } = await loadFixture(
        deployStakeWithPoolFixture
      ));
      await setupUserTokens(StakingToken, [alice]);
    });

    it("should reject staking amounts below minimum", async function () {
      const minStakeAmount = 1000; // MIN_STAKE_AMOUNT from contract

      for (let amount = 1; amount < minStakeAmount; amount += 100) {
        await expect(stakeTokens(Stake, StakingToken, alice, poolId, amount))
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
          .withArgs("Stake amount too small");
      }
    });

    it("should accept staking amounts at or above minimum", async function () {
      const minStakeAmount = 1000; // MIN_STAKE_AMOUNT from contract
      const testAmounts = [
        minStakeAmount,
        minStakeAmount + 1,
        minStakeAmount * 2,
        STAKE_AMOUNT,
      ];

      for (const amount of testAmounts) {
        await stakeTokens(Stake, StakingToken, alice, poolId, amount);

        const userStake = await Stake.userPoolStake(alice.address, poolId);
        expect(userStake.stakedAmount).to.be.gte(amount);
      }
    });

    it("should prevent dust attacks with minimum stake requirement", async function () {
      // Try to create a dust attack scenario
      const dustAmount = 1; // Far below minimum

      await expect(stakeTokens(Stake, StakingToken, alice, poolId, dustAmount))
        .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
        .withArgs("Stake amount too small");
    });
  });

  describe("Authorization Tests", function () {
    let Stake, StakingToken, RewardToken, owner, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, owner, alice, bob, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
    });

    it("should allow only creator to cancel pool", async function () {
      // Owner (creator) should be able to cancel
      await expect(Stake.connect(owner).cancelPool(poolId))
        .to.emit(Stake, "PoolCancelled")
        .withArgs(poolId);
    });

    it("should reject cancellation from non-creator", async function () {
      // Non-creator should not be able to cancel
      await expect(
        Stake.connect(alice).cancelPool(poolId)
      ).to.be.revertedWithCustomError(
        Stake,
        "Stake__UnauthorizedPoolDeactivation"
      );

      await expect(
        Stake.connect(bob).cancelPool(poolId)
      ).to.be.revertedWithCustomError(
        Stake,
        "Stake__UnauthorizedPoolDeactivation"
      );
    });

    it("should reject cancellation of non-existent pool", async function () {
      const nonExistentPoolId = 999;
      await expect(
        Stake.connect(owner).cancelPool(nonExistentPoolId)
      ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
    });
  });
});
