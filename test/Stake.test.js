const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MAX_INT_256, NULL_ADDRESS, wei } = require("./utils/test-utils");

// Constants from contract
const MIN_STAKE_AMOUNT = 1000n;
const MIN_REWARD_DURATION = 3600n;
const MAX_REWARD_DURATION = MIN_REWARD_DURATION * 24n * 365n * 10n; // 10 years

// Token amount constants
const INITIAL_TOKEN_SUPPLY = wei(1000000); // 1M tokens
const INITIAL_USER_BALANCE = wei(100000); // 100k tokens per user (enough for multiple pool creations)

// Simplified test constants for easy manual calculation
const SIMPLE_POOL = {
  stakingToken: null, // Will be set in beforeEach
  rewardToken: null, // Will be set in beforeEach
  rewardAmount: wei(10000), // 10k reward tokens
  rewardDuration: 10000, // 10000 seconds = 1 reward token per second
};

describe("Stake", function () {
  async function deployFixtures() {
    const Stake = await ethers.deployContract("Stake");
    await Stake.waitForDeployment();

    const StakingToken = await ethers.deployContract("TestToken", [
      INITIAL_TOKEN_SUPPLY,
      "Staking Token",
      "STAKE",
      18n,
    ]);
    await StakingToken.waitForDeployment();

    const RewardToken = await ethers.deployContract("TestToken", [
      INITIAL_TOKEN_SUPPLY,
      "Reward Token",
      "REWARD",
      18n,
    ]);
    await RewardToken.waitForDeployment();

    return [Stake, StakingToken, RewardToken];
  }

  let Stake, StakingToken, RewardToken;
  let owner, alice, bob, carol;

  // Helper functions
  const distributeTokens = async (token, users, amount) => {
    for (const user of users) {
      await token.transfer(user.address, amount);
    }
  };

  const approveTokens = async (token, users, spender, amount = MAX_INT_256) => {
    for (const user of users) {
      await token.connect(user).approve(spender, amount);
    }
  };

  const createSamplePool = async (creator = owner) => {
    const poolId = await Stake.poolCount(); // Get current pool count before creating
    await RewardToken.connect(creator).approve(
      Stake.target,
      SIMPLE_POOL.rewardAmount
    );
    await Stake.connect(creator).createPool(
      SIMPLE_POOL.stakingToken,
      SIMPLE_POOL.rewardToken,
      SIMPLE_POOL.rewardAmount,
      SIMPLE_POOL.rewardDuration
    );
    return poolId; // Return the pool ID that was created
  };

  beforeEach(async function () {
    [Stake, StakingToken, RewardToken] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();

    SIMPLE_POOL.stakingToken = StakingToken.target;
    SIMPLE_POOL.rewardToken = RewardToken.target;

    // Distribute tokens to test accounts (including owner for pool creation)
    await distributeTokens(
      StakingToken,
      [owner, alice, bob, carol],
      INITIAL_USER_BALANCE
    );
  });

  describe("Stake Operations", function () {
    beforeEach(async function () {
      this.poolId = await createSamplePool();

      // Approve staking tokens for users
      await approveTokens(StakingToken, [alice, bob, carol], Stake.target);
    });

    describe("Basic Staking", function () {
      beforeEach(async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));
        this.pool = await Stake.pools(this.poolId);
      });

      it("should stake correct amount", async function () {
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(wei(100));
      });

      it("should transfer staking tokens to contract", async function () {
        expect(await StakingToken.balanceOf(Stake.target)).to.equal(wei(100));
        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          INITIAL_USER_BALANCE - wei(100)
        );
      });

      it("should update pool total staked", async function () {
        expect(this.pool.totalStaked).to.equal(wei(100));
      });

      it("should increment active staker count", async function () {
        expect(this.pool.activeStakerCount).to.equal(1);
      });

      it("should set rewardStartedAt when first stake happens", async function () {
        expect(this.pool.rewardStartedAt).to.equal(await time.latest());
      });

      it("should emit Staked event", async function () {
        await expect(Stake.connect(alice).stake(this.poolId, wei(100)))
          .emit(Stake, "Staked")
          .withArgs(this.poolId, alice.address, wei(100));
      });
    }); // Basic Staking

    describe("Reward Calculation Scenarios", function () {
      it("should have 0 claimable rewards immediately after staking", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Immediately after staking, Alice's claimable reward should be 0
        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(0);
      });

      it("should calculate rewards correctly for single staker", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        await time.increase(1234);
        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(wei(1234));
      });

      it("should calculate rewards correctly when second staker joins", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        await time.setNextBlockTimestamp((await time.latest()) + 4567);
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Check rewards at the exact moment Bob stakes
        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );

        expect(aliceClaimable).to.equal(wei(4567)); // Alice was alone for exactly 4567s
        expect(bobClaimable).to.equal(0); // Bob just staked
      });

      it("should calculate proportional rewards correctly", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Bob stakes exactly 1000s after Alice
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Check rewards exactly 1000s after Bob stakes
        // - Alice was alone for 1000s: earned 1000 tokens
        // - Both staked for 1000s: Alice earned 1000 * 100/400 = 250, Bob earned 1000 * 300/400 = 750
        // - Alice total: 1000 + 250 = 1250, Bob total: 750
        await time.increase(1000);

        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );

        expect(aliceClaimable).to.equal(wei(1250));
        expect(bobClaimable).to.equal(wei(750));
      });

      it("should handle three stakers correctly", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Bob stakes exactly 1000s after Alice
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Carol stakes exactly 1000s after Bob
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(carol).stake(this.poolId, wei(100));

        // Check rewards exactly 1000s after Carol stakes
        // - Alice was alone for 1000s: earned 1000 tokens
        // - Alice and Bob staked for 1000s: Alice earned 1000 * 100/400 = 250
        // - All three staked for 1000s: Alice earned 1000 * 100/500 = 200
        // - Alice total: 1000 + 250 + 200 = 1450
        // - Bob total: 750 + 600 = 1350
        // - Carol total: 200
        await time.increaseTo(carolStakeTime + 1000);

        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );
        const [carolClaimable] = await Stake.claimableReward(
          this.poolId,
          carol.address
        );

        expect(aliceClaimable).to.equal(wei(1450));
        expect(bobClaimable).to.equal(wei(1350));
        expect(carolClaimable).to.equal(wei(200));
      });
    }); // Reward Calculation Scenarios

    describe("Claim Operations", function () {
      beforeEach(async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));
      });

      it("should claim rewards correctly", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        const initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(this.poolId);
        const finalBalance = await RewardToken.balanceOf(alice.address);

        expect(finalBalance - initialBalance).to.equal(wei(1000));
      });

      it("should update claimed rewards correctly", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 3);
        await Stake.connect(alice).claim(this.poolId);

        // Check that claimedRewards is updated
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.claimedRewards).to.equal(wei(3));
      });

      it("should emit RewardClaimed event on claim", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 100);

        await expect(Stake.connect(alice).claim(this.poolId))
          .to.emit(Stake, "RewardClaimed")
          .withArgs(this.poolId, alice.address, wei(100));
      });
    }); // Claim Operations

    describe("Unstaking Operations", function () {
      beforeEach(async function () {
        this.stakeAmount = wei(100);
        this.unstakeAmount = wei(50);

        await Stake.connect(alice).stake(this.poolId, wei(100));
      });

      it("should unstake correct amount", async function () {
        await Stake.connect(alice).unstake(this.poolId, this.unstakeAmount);

        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(
          this.stakeAmount - this.unstakeAmount
        );
      });

      it("should transfer tokens back to user", async function () {
        const initialBalance = await StakingToken.balanceOf(alice.address);
        await Stake.connect(alice).unstake(this.poolId, this.unstakeAmount);

        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          initialBalance + this.unstakeAmount
        );
      });

      it("should update pool total staked", async function () {
        await Stake.connect(alice).unstake(this.poolId, this.unstakeAmount);

        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(
          this.stakeAmount - this.unstakeAmount
        );
      });

      it("should claim rewards before unstaking", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 1000);

        const initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).unstake(this.poolId, this.unstakeAmount);
        const finalBalance = await RewardToken.balanceOf(alice.address);

        expect(finalBalance - initialBalance).to.equal(wei(1000));
      });

      it("should decrement active staker count when fully unstaked", async function () {
        await Stake.connect(alice).unstake(this.poolId, this.stakeAmount);

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(0);
      });

      it("should not decrement active staker count when partially unstaked", async function () {
        await Stake.connect(alice).unstake(this.poolId, this.unstakeAmount);

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should emit Unstaked event", async function () {
        await expect(
          Stake.connect(alice).unstake(this.poolId, this.unstakeAmount)
        )
          .emit(Stake, "Unstaked")
          .withArgs(this.poolId, alice.address, this.unstakeAmount);
      });
    }); // Unstaking Operations

    describe("Pool Management", function () {
      it("should create pool with correct parameters", async function () {
        const pool = await Stake.pools(this.poolId);

        expect(pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
        expect(pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
        expect(pool.creator).to.equal(owner.address);
        expect(pool.rewardAmount).to.equal(SIMPLE_POOL.rewardAmount);
        expect(pool.rewardDuration).to.equal(SIMPLE_POOL.rewardDuration);
        expect(pool.totalSkippedDuration).to.equal(0);
        expect(pool.rewardStartedAt).to.equal(0);
        expect(pool.cancelledAt).to.equal(0);
        expect(pool.totalStaked).to.equal(0);
        expect(pool.activeStakerCount).to.equal(0);
        expect(pool.lastRewardUpadtedAt).to.equal(0);
        expect(pool.accRewardPerShare).to.equal(0);
      });

      it("should emit PoolCreated event", async function () {
        const poolId = await Stake.poolCount();
        await RewardToken.connect(owner).approve(
          Stake.target,
          SIMPLE_POOL.rewardAmount
        );

        await expect(
          Stake.connect(owner).createPool(
            SIMPLE_POOL.stakingToken,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          )
        )
          .emit(Stake, "PoolCreated")
          .withArgs(
            poolId,
            owner.address,
            SIMPLE_POOL.stakingToken,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );
      });

      it("should cancel pool before rewards start", async function () {
        const initialBalance = await RewardToken.balanceOf(owner.address);
        await expect(Stake.connect(owner).cancelPool(this.poolId))
          .emit(Stake, "PoolCancelled")
          .withArgs(this.poolId, SIMPLE_POOL.rewardAmount);

        // Should return all rewards to creator
        const finalBalance = await RewardToken.balanceOf(owner.address);
        expect(finalBalance - initialBalance).to.equal(
          SIMPLE_POOL.rewardAmount
        );

        // Pool should be marked as cancelled
        const pool = await Stake.pools(this.poolId);
        expect(pool.cancelledAt).to.be.gt(0);
      });

      it("should cancel pool after rewards start with partial refund", async function () {
        // Start rewards by staking
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Cancel pool halfway through duration
        await time.setNextBlockTimestamp((await time.latest()) + 5000);

        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(this.poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        expect(finalBalance - initialBalance).to.equal(
          SIMPLE_POOL.rewardAmount / 2n
        );
      });
    }); // Pool Management

    describe("Skipped Time Tracking", function () {
      it("should not increment totalSkippedDuration when stakers are present", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Move time forward while stakers are present
        await time.setNextBlockTimestamp((await time.latest()) + 2000);

        // Check that totalSkippedDuration hasn't changed
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalSkippedDuration).to.equal(0);
      });

      it("should increment totalSkippedDuration when no one is staking", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Alice unstakes completely
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Move time forward while no one is staking
        await time.setNextBlockTimestamp((await time.latest()) + 2000);
        // Trigger pool update by staking again (this calls _updatePool)
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Check that totalSkippedDuration has been incremented
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalSkippedDuration).to.equal(2000);
      });

      it("should handle multiple periods of skipped time", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // First unstake period
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip 500 seconds
        await time.setNextBlockTimestamp((await time.latest()) + 500);
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Second unstake period
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip another 300 seconds
        await time.setNextBlockTimestamp((await time.latest()) + 300);
        // Trigger pool update by staking again
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Total skipped time should be 500 + 300 = 800 seconds
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalSkippedDuration).to.equal(800);
      });

      it("should not increment totalSkippedDuration when pool hasn't started", async function () {
        // Move time forward without anyone staking
        await time.increase(2000);

        // Trigger pool update by staking (this will start the pool)
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // totalSkippedDuration should still be 0 because rewards hadn't started before
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalSkippedDuration).to.equal(0);
      });

      it("should stop tracking skipped time when pool is cancelled", async function () {
        // Start rewards by staking
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Alice unstakes completely at 1000s
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip some time then cancel (cancelPool calls _updatePool internally)
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(owner).cancelPool(this.poolId);

        // totalSkippedDuration should count time before cancellation
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalSkippedDuration).to.equal(1000);
      });
    }); // Skipped Time Tracking

    describe("Skipped Reward Refunds", function () {
      beforeEach(async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));
      });

      it("should refund skipped rewards when pool is cancelled", async function () {
        // Alice unstakes after earning 1000 rewards
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip 2000 seconds (2000 rewards worth)
        await time.setNextBlockTimestamp((await time.latest()) + 2000);
        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(this.poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        // Should refund: future rewards (7000) + skipped rewards (2000) = 9000
        // Total pool: 10000, distributed: 1000, leftover: 9000
        expect(finalBalance - initialBalance).to.equal(wei(9000));
      });

      it("should handle mixed skipped and future rewards correctly", async function () {
        // Alice earns 2000 rewards then unstakes
        await time.setNextBlockTimestamp((await time.latest()) + 2000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip 1000 seconds (1000 rewards worth)
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(bob).stake(this.poolId, wei(200));

        // Cancel after 100s since Bob stakes
        await time.setNextBlockTimestamp((await time.latest()) + 100);
        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(this.poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        // Should refund: future rewards (6900) + skipped rewards (1000) = 7900
        // Total pool: 10000, distributed: 2000 (Alice), unclaimed: 100 (Bob), leftover: 7900
        expect(finalBalance - initialBalance).to.equal(wei(7900));

        // Contract should have unclaimed reward token for future claiming
        expect(await RewardToken.balanceOf(Stake.target)).to.equal(wei(100));

        // Bob should be able to claim 100 rewards later
        await time.setNextBlockTimestamp((await time.latest()) + 5000);
        await Stake.connect(bob).claim(this.poolId);
        expect(await RewardToken.balanceOf(bob.address)).to.equal(wei(100));

        // Contract should have no reward token balance left
        expect(await RewardToken.balanceOf(Stake.target)).to.equal(0);
      });

      it("should refund all skipped rewards when pool never restarts", async function () {
        // Alice earns 1000 rewards then unstakes
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip to near end of pool and cancel
        await time.setNextBlockTimestamp((await time.latest()) + 7000);

        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(this.poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        // Should refund: future rewards (2000) + skipped rewards (7000) = 9000
        // Total pool: 10000, distributed: 1000, leftover: 9000
        expect(finalBalance - initialBalance).to.equal(wei(9000));
      });

      it("should never refund more if current time is after pool end time", async function () {
        // Alice earns 2000 rewards then unstakes
        await time.setNextBlockTimestamp((await time.latest()) + 2000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip over to the pool end time
        await time.setNextBlockTimestamp(
          (await time.latest()) + SIMPLE_POOL.rewardDuration
        );

        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(this.poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        // Should refund: future rewards (0) + skipped rewards (8000) = 8000
        // Total pool: 10000, distributed: 2000, leftover: 8000
        const expectedRefund = wei(8000);
        expect(finalBalance - initialBalance).to.equal(expectedRefund);
      });

      it("should emit PoolCancelled event with correct leftover amount including skipped rewards", async function () {
        // Alice earns 1000 rewards then unstakes
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).unstake(this.poolId, wei(100));

        // Skip 2000 seconds then cancel
        await time.setNextBlockTimestamp((await time.latest()) + 2000);

        // Should emit event with total leftover rewards (future + skipped)
        await expect(Stake.connect(owner).cancelPool(this.poolId))
          .emit(Stake, "PoolCancelled")
          .withArgs(this.poolId, wei(9000)); // 7000 future + 2000 skipped
      });
    }); // Skipped Reward Refunds

    // TODO: Refactor and fix the tests below

    describe("Validations", function () {
      describe("Pool Creation Validations", function () {
        it("should revert if stakingToken is zero address", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              ethers.ZeroAddress,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidToken")
            .withArgs("stakingToken cannot be zero");
        });

        it("should revert if rewardToken is zero address", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              ethers.ZeroAddress,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidToken")
            .withArgs("rewardToken cannot be zero");
        });

        it("should revert if rewardAmount is zero", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              0,
              SIMPLE_POOL.rewardDuration
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("rewardAmount cannot be zero");
        });

        it("should revert if rewardDuration is too short", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MIN_REWARD_DURATION - 1n
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
            .withArgs("rewardDuration out of range");
        });

        it("should revert if rewardDuration is too long", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MAX_REWARD_DURATION + 1n
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
            .withArgs("rewardDuration out of range");
        });

        it("should accept minimum valid duration", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MIN_REWARD_DURATION
            )
          ).to.not.be.reverted;
        });

        it("should accept maximum valid duration", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MAX_REWARD_DURATION
            )
          ).to.not.be.reverted;
        });

        it("should revert if insufficient allowance for reward token", async function () {
          // Don't approve, or approve insufficient amount
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount - 1n
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(
            RewardToken,
            "ERC20InsufficientAllowance"
          );
        });

        it("should revert if insufficient balance for reward token", async function () {
          // Transfer away all reward tokens except for less than required
          const ownerBalance = await RewardToken.balanceOf(owner.address);
          await RewardToken.connect(owner).transfer(
            alice.address,
            ownerBalance - SIMPLE_POOL.rewardAmount + 1n
          );

          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(
            RewardToken,
            "ERC20InsufficientBalance"
          );
        });

        it("should transfer reward tokens to contract on creation", async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          const initialContractBalance = await RewardToken.balanceOf(
            Stake.target
          );
          const initialOwnerBalance = await RewardToken.balanceOf(
            owner.address
          );

          await Stake.connect(owner).createPool(
            SIMPLE_POOL.stakingToken,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          const finalContractBalance = await RewardToken.balanceOf(
            Stake.target
          );
          const finalOwnerBalance = await RewardToken.balanceOf(owner.address);

          expect(finalContractBalance - initialContractBalance).to.equal(
            SIMPLE_POOL.rewardAmount
          );
          expect(initialOwnerBalance - finalOwnerBalance).to.equal(
            SIMPLE_POOL.rewardAmount
          );
        });

        it("should increment pool count correctly", async function () {
          const initialPoolCount = await Stake.poolCount();

          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          await Stake.connect(owner).createPool(
            SIMPLE_POOL.stakingToken,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          const finalPoolCount = await Stake.poolCount();
          expect(finalPoolCount).to.equal(initialPoolCount + 1n);
        });

        it("should create pool with custom parameters", async function () {
          const customRewardAmount = wei(50000);
          const customDuration = 7200; // 2 hours

          await RewardToken.connect(owner).approve(
            Stake.target,
            customRewardAmount
          );

          const poolId = await Stake.poolCount();
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              customRewardAmount,
              customDuration
            )
          )
            .to.emit(Stake, "PoolCreated")
            .withArgs(
              poolId,
              owner.address,
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              customRewardAmount,
              customDuration
            );

          const pool = await Stake.pools(poolId);
          expect(pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
          expect(pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
          expect(pool.creator).to.equal(owner.address);
          expect(pool.rewardAmount).to.equal(customRewardAmount);
          expect(pool.rewardDuration).to.equal(customDuration);
          expect(pool.totalSkippedDuration).to.equal(0);
          expect(pool.rewardStartedAt).to.equal(0);
          expect(pool.cancelledAt).to.equal(0);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
          expect(pool.lastRewardUpadtedAt).to.equal(0);
          expect(pool.accRewardPerShare).to.equal(0);
        });

        it("should revert if rewardAmount is too large (prevents overflow)", async function () {
          // Create a new reward token with massive supply
          const massiveSupply = 2n ** 256n - 1n; // uint256 max
          const MassiveRewardToken = await ethers.deployContract("TestToken", [
            massiveSupply,
            "Massive Reward Token",
            "MASSIVE",
            18n,
          ]);
          await MassiveRewardToken.waitForDeployment();
          await MassiveRewardToken.connect(owner).approve(
            Stake.target,
            massiveSupply
          );

          const tooBigRewardAmount =
            (await Stake.MAX_SAFE_REWARD_AMOUNT()) + 1n;

          // This should fail during pool creation due to overflow prevention
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              MassiveRewardToken.target,
              tooBigRewardAmount,
              MIN_REWARD_DURATION
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("rewardAmount too large - would cause overflow");
        });

        it("should revert if token has transfer fees", async function () {
          const TaxToken = await ethers.deployContract("TaxToken", [
            wei(1000000),
          ]);
          await TaxToken.waitForDeployment();

          await TaxToken.connect(owner).approve(Stake.target, wei(10000));

          await expect(
            Stake.connect(owner).createPool(
              StakingToken.target,
              TaxToken.target,
              wei(10000),
              SIMPLE_POOL.rewardDuration
            )
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidToken")
            .withArgs("Token has transfer fees or rebasing - not supported");
        });
      });

      describe("Staking Validations", function () {
        it("should revert if stake amount is too small", async function () {
          await expect(
            Stake.connect(alice).stake(this.poolId, MIN_STAKE_AMOUNT - 1n)
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("Stake amount too small");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).stake(999, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if pool is cancelled", async function () {
          await Stake.connect(owner).cancelPool(this.poolId);

          await expect(
            Stake.connect(alice).stake(this.poolId, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolCancelled");
        });

        it("should revert if pool is finished", async function () {
          // Start rewards by staking
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(bob).stake(this.poolId, wei(300));

          // Move past pool end time
          const endTime = stakeTime + SIMPLE_POOL.rewardDuration + 1;
          await time.increaseTo(endTime);

          await expect(
            Stake.connect(alice).stake(this.poolId, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolFinished");
        });
      });

      describe("Unstaking Validations", function () {
        it("should revert if unstake amount is zero", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          await expect(Stake.connect(alice).unstake(this.poolId, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("amount cannot be zero");
        });

        it("should revert if insufficient balance", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          await expect(
            Stake.connect(alice).unstake(this.poolId, wei(100) + wei(1))
          ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).unstake(999, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      });

      describe("Claim Validations", function () {
        it("should revert if no rewards to claim", async function () {
          await expect(
            Stake.connect(alice).claim(this.poolId)
          ).to.be.revertedWithCustomError(Stake, "Stake__NoRewardsToClaim");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).claim(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      });

      describe("Pool Cancellation Validations", function () {
        it("should revert if not pool creator", async function () {
          await expect(
            Stake.connect(bob).cancelPool(this.poolId)
          ).to.be.revertedWithCustomError(Stake, "Stake__Unauthorized");
        });

        it("should revert if pool already cancelled", async function () {
          await Stake.connect(owner).cancelPool(this.poolId);

          await expect(
            Stake.connect(owner).cancelPool(this.poolId)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolCancelled");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(owner).cancelPool(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      });
    });

    describe("View Functions", function () {
      beforeEach(async function () {
        // Create additional pools for testing (use owner who has tokens)
        await createSamplePool(); // poolId 1
        await createSamplePool(); // poolId 2

        // Add some stakes and claims for testing
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await Stake.connect(bob).stake(this.poolId, wei(300));
        await Stake.connect(alice).stake(1, wei(100));
      });

      describe("claimableRewardBulk", function () {
        it("should return claimable rewards for multiple pools", async function () {
          const results = await Stake.claimableRewardBulk(0, 3, alice.address);

          expect(results).to.have.length(3);
          expect(results[0][0]).to.equal(0); // poolId 0
          expect(results[1][0]).to.equal(1); // poolId 1
          expect(results[2][0]).to.equal(2); // poolId 2
        });

        it("should stop at poolCount if poolIdTo exceeds it", async function () {
          const results = await Stake.claimableRewardBulk(0, 10, alice.address);

          expect(results).to.have.length(10);
          // Only first 3 pools should have data, rest should be empty
          expect(results[0][0]).to.equal(0);
          expect(results[1][0]).to.equal(1);
          expect(results[2][0]).to.equal(2);
        });

        it("should revert if pagination parameters are invalid", async function () {
          await expect(
            Stake.claimableRewardBulk(5, 5, alice.address)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );

          await expect(
            Stake.claimableRewardBulk(0, 1001, alice.address)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );
        });
      });

      describe("getPools", function () {
        it("should return pools in range", async function () {
          const pools = await Stake.getPools(0, 2);

          expect(pools).to.have.length(2);
          expect(pools[0].creator).to.equal(owner.address);
          expect(pools[1].creator).to.equal(owner.address);
        });

        it("should handle poolIdTo exceeding poolCount", async function () {
          const pools = await Stake.getPools(0, 10);

          expect(pools).to.have.length(3); // Only 3 pools exist
        });

        it("should revert if pagination parameters are invalid", async function () {
          await expect(Stake.getPools(5, 5)).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );

          await expect(Stake.getPools(0, 1001)).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );
        });
      });

      describe("getUserEngagedPools", function () {
        it("should return pools user has interacted with", async function () {
          const engagedPools = await Stake.getUserEngagedPools(
            alice.address,
            0,
            10
          );

          expect(engagedPools).to.have.length(2);
          expect(engagedPools[0]).to.equal(0); // poolId 0
          expect(engagedPools[1]).to.equal(1); // poolId 1
        });

        it("should return empty array if no engagement", async function () {
          const engagedPools = await Stake.getUserEngagedPools(
            carol.address,
            0,
            10
          );

          expect(engagedPools).to.have.length(0);
        });

        it("should return empty array if poolIdFrom >= searchTo", async function () {
          const engagedPools = await Stake.getUserEngagedPools(
            alice.address,
            5,
            10
          );

          expect(engagedPools).to.have.length(0);
        });

        it("should include pools with only claimed rewards", async function () {
          // Move time forward and claim rewards
          await time.increase(1000);
          await Stake.connect(alice).claim(this.poolId);

          // Unstake all tokens
          await Stake.connect(alice).unstake(this.poolId, wei(100));

          const engagedPools = await Stake.getUserEngagedPools(
            alice.address,
            0,
            10
          );

          expect(engagedPools).to.include(0n); // Still engaged due to claimed rewards
        });

        it("should revert if pagination parameters are invalid", async function () {
          await expect(
            Stake.getUserEngagedPools(alice.address, 5, 5)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );

          await expect(
            Stake.getUserEngagedPools(alice.address, 0, 1001)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );
        });
      });

      describe("version", function () {
        it("should return correct version", async function () {
          const version = await Stake.version();
          expect(version).to.equal("1.0.0");
        });
      });
    });

    describe("Edge Cases", function () {
      beforeEach(async function () {
        // Approve tokens for multiple operations
        await approveTokens(StakingToken, [alice, bob, carol], Stake.target);
      });

      describe("Multiple Stakes by Same User", function () {
        it("should handle multiple stakes correctly", async function () {
          // First stake at specific time
          const firstStakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(firstStakeTime);
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Second stake exactly 1000s later should claim rewards and add to stake
          const secondStakeTime = firstStakeTime + 1000;
          await time.setNextBlockTimestamp(secondStakeTime);
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).stake(this.poolId, wei(100));
          const finalBalance = await RewardToken.balanceOf(alice.address);

          // Should have auto-claimed rewards
          expect(finalBalance - initialBalance).to.equal(wei(1000));

          // Should have double stake amount
          const userStake = await Stake.userPoolStake(
            alice.address,
            this.poolId
          );
          expect(userStake.stakedAmount).to.equal(wei(100) * 2n);
        });

        it("should not increment active staker count on subsequent stakes", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));
          await Stake.connect(alice).stake(this.poolId, wei(100));

          const pool = await Stake.pools(this.poolId);
          expect(pool.activeStakerCount).to.equal(1);
        });
      });

      describe("Pool Expiration Scenarios", function () {
        it("should stop reward distribution when pool expires", async function () {
          // Start rewards
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move to exact end time
          const endTime = stakeTime + SIMPLE_POOL.rewardDuration;
          await time.increaseTo(endTime);

          const [claimable] = await Stake.claimableReward(
            this.poolId,
            alice.address
          );
          expect(claimable).to.equal(SIMPLE_POOL.rewardAmount); // All rewards

          // Move past end time - should not increase rewards
          await time.increaseTo(endTime + 1000);

          const [claimableAfter] = await Stake.claimableReward(
            this.poolId,
            alice.address
          );
          expect(claimableAfter).to.equal(SIMPLE_POOL.rewardAmount); // Still all rewards
        });

        it("should allow claiming rewards after pool expires", async function () {
          // Start rewards
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move past end time
          const endTime = stakeTime + SIMPLE_POOL.rewardDuration;
          await time.increaseTo(endTime + 1000);

          // Should be able to claim all rewards
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(this.poolId);
          const finalBalance = await RewardToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(
            SIMPLE_POOL.rewardAmount
          );
        });
      });

      describe("Cancelled Pool Scenarios", function () {
        it("should stop reward distribution when pool is cancelled", async function () {
          // Start rewards
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Cancel pool after 50% of duration
          const cancelTime = stakeTime + SIMPLE_POOL.rewardDuration / 2;
          await time.setNextBlockTimestamp(cancelTime);
          await Stake.connect(owner).cancelPool(this.poolId);

          // Move further in time
          await time.increaseTo(cancelTime + 1000);

          // Should only have rewards up to cancellation time
          const [claimable] = await Stake.claimableReward(
            this.poolId,
            alice.address
          );
          expect(claimable).to.equal(SIMPLE_POOL.rewardAmount / 2n); // 50% of rewards
        });

        it("should allow claiming rewards from cancelled pool", async function () {
          // Start rewards
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Cancel pool exactly 1000s after staking
          const cancelTime = stakeTime + 1000;
          await time.setNextBlockTimestamp(cancelTime);
          await Stake.connect(owner).cancelPool(this.poolId);

          // Should be able to claim earned rewards
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(this.poolId);
          const finalBalance = await RewardToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(wei(1000));
        });
      });

      describe("Empty Pool Scenarios", function () {
        it("should handle empty pool (no stakes)", async function () {
          const [claimable] = await Stake.claimableReward(
            this.poolId,
            alice.address
          );
          expect(claimable).to.equal(0);
        });

        it("should handle pool with all stakes removed", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));
          await Stake.connect(alice).unstake(this.poolId, wei(100));

          const pool = await Stake.pools(this.poolId);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
        });
      });
    }); // Edge Cases

    describe("Token Type Edge Cases", function () {
      describe("Same Token for Staking and Rewards", function () {
        it("should handle same token for staking and rewards", async function () {
          // Create a pool where staking and reward tokens are the same
          await StakingToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            StakingToken.target, // Same token
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          // Approve and stake with precise timing
          await StakingToken.connect(alice).approve(Stake.target, wei(100));

          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(poolId, wei(100));

          // Verify staking worked
          const userStake = await Stake.userPoolStake(alice.address, poolId);
          expect(userStake.stakedAmount).to.equal(wei(100));

          // Claim exactly 1000 seconds after staking
          const claimTime = stakeTime + 1000;
          await time.setNextBlockTimestamp(claimTime);

          const initialBalance = await StakingToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(poolId);
          const finalBalance = await StakingToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(wei(1000));
        });
      });

      describe("Different Token Decimals", function () {
        it("should handle tokens with 6 decimals", async function () {
          const Token6 = await ethers.deployContract("TestToken", [
            wei(1000000),
            "6 Decimal Token",
            "6DEC",
            6n,
          ]);
          await Token6.waitForDeployment();

          // Distribute tokens
          await Token6.transfer(alice.address, wei(100000));
          await Token6.transfer(owner.address, wei(100000));

          // Create pool with 6-decimal reward token
          const rewardAmount = wei(10000); // 10k tokens
          await Token6.connect(owner).approve(Stake.target, rewardAmount);

          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            Token6.target,
            rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          // Stake and verify
          await StakingToken.connect(alice).approve(Stake.target, wei(100));
          await Stake.connect(alice).stake(poolId, wei(100));

          await time.increase(1000);
          const [claimable] = await Stake.claimableReward(
            poolId,
            alice.address
          );
          expect(claimable).to.equal(wei(1000)); // 1 token per second
        });

        it("should handle tokens with 8 decimals", async function () {
          const Token8 = await ethers.deployContract("TestToken", [
            wei(1000000),
            "8 Decimal Token",
            "8DEC",
            8n,
          ]);
          await Token8.waitForDeployment();

          // Distribute tokens
          await Token8.transfer(alice.address, wei(100000));
          await Token8.transfer(owner.address, wei(100000));

          // Create pool with 8-decimal staking token
          const rewardAmount = wei(10000);
          await RewardToken.connect(owner).approve(Stake.target, rewardAmount);

          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            Token8.target,
            RewardToken.target,
            rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          // Stake and verify
          const stakeAmount = wei(100); // 100 tokens
          await Token8.connect(alice).approve(Stake.target, stakeAmount);
          await Stake.connect(alice).stake(poolId, stakeAmount);

          await time.increase(1000);
          const [claimable] = await Stake.claimableReward(
            poolId,
            alice.address
          );
          expect(claimable).to.equal(wei(1000)); // 1 token per second
        });
      }); // Different Token Decimals
    }); // Token Type Edge Cases

    describe("Precision and Rounding Edge Cases", function () {
      it("should handle precision with very small amounts", async function () {
        const smallAmount = MIN_STAKE_AMOUNT; // 1000 wei
        const smallReward = 1000n; // Very small reward

        // Create pool with minimal amounts
        await RewardToken.connect(owner).approve(Stake.target, smallReward);

        const poolId = await Stake.poolCount();
        await Stake.connect(owner).createPool(
          StakingToken.target,
          RewardToken.target,
          smallReward,
          MIN_REWARD_DURATION
        );

        // Stake minimal amount
        await StakingToken.connect(alice).approve(Stake.target, smallAmount);
        await Stake.connect(alice).stake(poolId, smallAmount);

        // Wait full duration
        await time.increase(Number(MIN_REWARD_DURATION));

        const [claimable] = await Stake.claimableReward(poolId, alice.address);
        expect(claimable).to.equal(smallReward); // Should get all rewards
      });

      it("should handle reward rounding correctly", async function () {
        // Create scenario that causes rounding
        const rewardAmount = 100100n; // Odd number
        const duration = 3601; // Creates ~27.8 per second

        await RewardToken.connect(owner).approve(Stake.target, rewardAmount);

        const poolId = await Stake.poolCount();
        await Stake.connect(owner).createPool(
          StakingToken.target,
          RewardToken.target,
          rewardAmount,
          duration
        );

        await StakingToken.connect(alice).approve(Stake.target, 1000n);
        await Stake.connect(alice).stake(poolId, 1000n);

        for (let i = 0; i < 3601; i++) {
          await time.increase(1);
          const [claimable] = await Stake.claimableReward(
            poolId,
            alice.address
          );
          console.log(`${i}s: ${claimable}`);
        }

        // await time.increase(1800);

        // const [claimable] = await Stake.claimableReward(poolId, alice.address);
        // // Should be approximately half the rewards, accounting for rounding
        // const expectedHalf = rewardAmount / 2n;
        // expect(claimable).to.equal(expectedHalf);
      });

      it("should handle multiple users with precision", async function () {
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await StakingToken.connect(bob).approve(Stake.target, wei(300));

        // Alice stakes first
        const startTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(startTime);
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Bob stakes after exactly 1000s
        await time.setNextBlockTimestamp(startTime + 1000);
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Check after another 1000s
        await time.setNextBlockTimestamp(startTime + 2000);

        // Verify total claimable equals expected
        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );

        expect(aliceClaimable + bobClaimable).to.equal(wei(2000)); // Total distributed
      });
    });

    describe("Multiple Pools Scenarios", function () {
      it("should handle multiple pools with same token pairs", async function () {
        // Create two pools with identical token pairs
        const pool1 = await createSamplePool();
        const pool2 = await createSamplePool();

        // Verify pools are independent
        expect(pool1).to.not.equal(pool2);

        const poolData1 = await Stake.pools(pool1);
        const poolData2 = await Stake.pools(pool2);

        expect(poolData1.stakingToken).to.equal(poolData2.stakingToken);
        expect(poolData1.rewardToken).to.equal(poolData2.rewardToken);
        expect(poolData1.rewardAmount).to.equal(poolData2.rewardAmount);

        // Stake in both pools with precise timing
        await StakingToken.connect(alice).approve(Stake.target, wei(100) * 2n);

        const stakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(stakeTime);
        await Stake.connect(alice).stake(pool1, wei(100));
        await Stake.connect(alice).stake(pool2, wei(100));

        // Check rewards exactly 1000 seconds after staking
        const checkTime = stakeTime + 1000;
        await time.setNextBlockTimestamp(checkTime);

        const [claimable1] = await Stake.claimableReward(pool1, alice.address);
        const [claimable2] = await Stake.claimableReward(pool2, alice.address);

        expect(claimable1).to.equal(wei(1000));
        expect(claimable2).to.equal(wei(1000));
      });

      it("should handle user engaged in multiple pools", async function () {
        // Create additional pools
        const pool1 = await createSamplePool();
        const pool2 = await createSamplePool();

        // Alice stakes in multiple pools
        await StakingToken.connect(alice).approve(Stake.target, wei(100) * 3n);
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await Stake.connect(alice).stake(pool1, wei(100));
        await Stake.connect(alice).stake(pool2, wei(100));

        // Check engaged pools
        const engagedPools = await Stake.getUserEngagedPools(
          alice.address,
          0,
          10
        );
        expect(engagedPools).to.have.length(3);
        expect(engagedPools).to.include(this.poolId);
        expect(engagedPools).to.include(pool1);
        expect(engagedPools).to.include(pool2);
      });
    });

    describe("State Consistency Tests", function () {
      it("should maintain state consistency after complex operations", async function () {
        // Complex sequence of operations
        await StakingToken.connect(alice).approve(Stake.target, wei(1000));
        await StakingToken.connect(bob).approve(Stake.target, wei(1000));
        await StakingToken.connect(carol).approve(Stake.target, wei(1000));

        // Initial states
        let pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(0);
        expect(pool.activeStakerCount).to.equal(0);

        // Alice stakes
        await Stake.connect(alice).stake(this.poolId, wei(100));
        pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(100));
        expect(pool.activeStakerCount).to.equal(1);

        // Bob stakes
        await Stake.connect(bob).stake(this.poolId, wei(200));
        pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(300));
        expect(pool.activeStakerCount).to.equal(2);

        // Alice partially unstakes
        await Stake.connect(alice).unstake(this.poolId, wei(50));
        pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(250));
        expect(pool.activeStakerCount).to.equal(2); // Still active

        // Carol stakes
        await Stake.connect(carol).stake(this.poolId, wei(100));
        pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(350));
        expect(pool.activeStakerCount).to.equal(3);

        // Alice fully unstakes
        await Stake.connect(alice).unstake(this.poolId, wei(50));
        pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(300));
        expect(pool.activeStakerCount).to.equal(2); // Alice no longer active

        // Verify user stakes
        const aliceStake = await Stake.userPoolStake(
          alice.address,
          this.poolId
        );
        const bobStake = await Stake.userPoolStake(bob.address, this.poolId);
        const carolStake = await Stake.userPoolStake(
          carol.address,
          this.poolId
        );

        expect(aliceStake.stakedAmount).to.equal(0);
        expect(bobStake.stakedAmount).to.equal(wei(200));
        expect(carolStake.stakedAmount).to.equal(wei(100));
      });

      it("should maintain reward consistency across operations", async function () {
        const stakeTime = (await time.latest()) + 1000;

        // Alice stakes first
        await time.setNextBlockTimestamp(stakeTime);
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Bob stakes after 1000s
        await time.setNextBlockTimestamp(stakeTime + 1000);
        await StakingToken.connect(bob).approve(Stake.target, wei(100));
        await Stake.connect(bob).stake(this.poolId, wei(100));

        // Alice claims after another 1000s
        await time.setNextBlockTimestamp(stakeTime + 2000);
        const aliceBalanceBefore = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(this.poolId);
        const aliceBalanceAfter = await RewardToken.balanceOf(alice.address);

        // Alice should have: 1000 (alone) + 500 (with Bob) = 1500
        expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(wei(1500));

        // Bob should have 500 claimable
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );
        expect(bobClaimable).to.equal(wei(500));
      });
    });

    describe("Boundary Conditions", function () {
      it("should handle MAX_SAFE_REWARD_AMOUNT boundary", async function () {
        const maxSafeAmount = await Stake.MAX_SAFE_REWARD_AMOUNT();

        // Create a token with enough supply for the max safe amount
        const LargeSupplyToken = await ethers.deployContract("TestToken", [
          maxSafeAmount,
          "Large Supply Token",
          "LARGE",
          18n,
        ]);
        await LargeSupplyToken.waitForDeployment();

        // Should accept exactly at boundary
        await LargeSupplyToken.connect(owner).approve(
          Stake.target,
          maxSafeAmount
        );

        await expect(
          Stake.connect(owner).createPool(
            StakingToken.target,
            LargeSupplyToken.target,
            maxSafeAmount,
            MIN_REWARD_DURATION
          )
        ).to.not.be.reverted;
      });

      it("should handle minimum stake amount boundary", async function () {
        const minStakeAmount = await Stake.MIN_STAKE_AMOUNT();

        // Should accept exactly at boundary
        await StakingToken.connect(alice).approve(Stake.target, minStakeAmount);

        await expect(Stake.connect(alice).stake(this.poolId, minStakeAmount)).to
          .not.be.reverted;
      });

      it("should handle maximum reward duration boundary", async function () {
        const maxDuration = await Stake.MAX_REWARD_DURATION();

        await RewardToken.connect(owner).approve(
          Stake.target,
          SIMPLE_POOL.rewardAmount
        );

        await expect(
          Stake.connect(owner).createPool(
            StakingToken.target,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            maxDuration
          )
        ).to.not.be.reverted;
      });
    });

    describe("Pool State Transitions", function () {
      it("should handle created -> active -> cancelled transition", async function () {
        const poolId = await createSamplePool();

        // Initially created state
        let pool = await Stake.pools(poolId);
        expect(pool.rewardStartedAt).to.equal(0);
        expect(pool.cancelledAt).to.equal(0);
        expect(pool.totalStaked).to.equal(0);

        // Transition to active
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await Stake.connect(alice).stake(poolId, wei(100));

        pool = await Stake.pools(poolId);
        expect(pool.rewardStartedAt).to.be.gt(0);
        expect(pool.cancelledAt).to.equal(0);
        expect(pool.totalStaked).to.equal(wei(100));

        // Transition to cancelled
        await Stake.connect(owner).cancelPool(poolId);

        pool = await Stake.pools(poolId);
        expect(pool.rewardStartedAt).to.be.gt(0);
        expect(pool.cancelledAt).to.be.gt(0);
        expect(pool.totalStaked).to.equal(wei(100));
      });

      it("should handle created -> active -> finished transition", async function () {
        const poolId = await createSamplePool();

        // Activate pool
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        const stakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(stakeTime);
        await Stake.connect(alice).stake(poolId, wei(100));

        // Move to finished state
        await time.increaseTo(stakeTime + SIMPLE_POOL.rewardDuration + 1);

        // Should reject new stakes
        await expect(
          Stake.connect(bob).stake(poolId, wei(300))
        ).to.be.revertedWithCustomError(Stake, "Stake__PoolFinished");

        // Should still allow claims
        const [claimable] = await Stake.claimableReward(poolId, alice.address);
        expect(claimable).to.equal(SIMPLE_POOL.rewardAmount);
      });
    });

    describe("Timestamp Edge Cases", function () {
      it("should handle rewards at exact pool end time", async function () {
        const stakeTime = (await time.latest()) + 1000;

        await time.setNextBlockTimestamp(stakeTime);
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Move to exact end time
        const endTime = stakeTime + SIMPLE_POOL.rewardDuration;
        await time.increaseTo(endTime);

        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(SIMPLE_POOL.rewardAmount);
      });

      it("should handle rewards past pool end time", async function () {
        const stakeTime = (await time.latest()) + 1000;

        await time.setNextBlockTimestamp(stakeTime);
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Move past end time
        const endTime = stakeTime + SIMPLE_POOL.rewardDuration;
        await time.increaseTo(endTime + 1000);

        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(SIMPLE_POOL.rewardAmount); // Should not exceed total
      });

      it("should handle operations in quick succession", async function () {
        const operationTime = (await time.latest()) + 1000;

        // Set up stakes in quick succession
        await StakingToken.connect(alice).approve(Stake.target, wei(100));
        await StakingToken.connect(bob).approve(Stake.target, wei(300));

        // Both stake in the same block window
        await time.setNextBlockTimestamp(operationTime);
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Verify state consistency
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(wei(100) + wei(300));
        expect(pool.activeStakerCount).to.equal(2);
      });
    });

    describe("View Function Consistency", function () {
      it("should maintain consistency between view and state functions", async function () {
        await StakingToken.connect(alice).approve(Stake.target, wei(100));

        const stakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(stakeTime);
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Check exactly 1000 seconds after staking
        const checkTime = stakeTime + 1000;
        await time.setNextBlockTimestamp(checkTime);

        // Get claimable from view function
        const [claimableBefore] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );

        // Claim and verify actual amount matches
        const balanceBefore = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(this.poolId);
        const balanceAfter = await RewardToken.balanceOf(alice.address);

        expect(balanceAfter - balanceBefore).to.equal(claimableBefore);
      });

      it("should handle bulk operations correctly", async function () {
        // Create multiple pools and stakes
        const pool1 = await createSamplePool();
        const pool2 = await createSamplePool();

        await StakingToken.connect(alice).approve(Stake.target, wei(100) * 3n);

        const stakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(stakeTime);
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await Stake.connect(alice).stake(pool1, wei(100));
        await Stake.connect(alice).stake(pool2, wei(100));

        // Check exactly 1000 seconds after staking
        const checkTime = stakeTime + 1000;
        await time.setNextBlockTimestamp(checkTime);

        // Test bulk claimable rewards
        const results = await Stake.claimableRewardBulk(0, 10, alice.address);

        expect(results[this.poolId][1]).to.equal(wei(1000)); // claimable
        expect(results[pool1][1]).to.equal(wei(1000));
        expect(results[pool2][1]).to.equal(wei(1000));
      });
    });
  }); // Stake Operations
}); // Stake
