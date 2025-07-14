const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MAX_INT_256, wei } = require("./utils/test-utils");

// Constants from contract
const MIN_STAKE_AMOUNT = 1000n;
const MIN_REWARD_DURATION = 3600n;
const MAX_REWARD_DURATION = MIN_REWARD_DURATION * 24n * 365n * 10n; // 10 years

// Token amount constants
const INITIAL_TOKEN_SUPPLY = wei(1_000_000_000); // 1B tokens
const INITIAL_USER_BALANCE = wei(1_000_000); // 1M tokens per user (enough for multiple pool creations)

// Simplified test constants for easy manual calculation
const SIMPLE_POOL = {
  stakingToken: null, // Will be set in beforeEach
  rewardToken: null, // Will be set in beforeEach
  rewardAmount: wei(10000), // 10k reward tokens
  rewardDuration: 10000, // 10000 seconds = 1 reward token per second
};

describe("Stake", function () {
  async function deployFixtures() {
    const [deployer] = await ethers.getSigners();
    const Stake = await ethers.deployContract("Stake", [
      deployer.address, // protocolBeneficiary (will be updated in beforeEach)
      0, // creationFee
      0, // claimFee
    ]);
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

    // Distribute & approve tokens to test accounts
    await distributeTokens(
      StakingToken,
      [alice, bob, carol],
      INITIAL_USER_BALANCE
    );
    await approveTokens(StakingToken, [alice, bob, carol], Stake.target);
    await approveTokens(RewardToken, [owner], Stake.target);
  });

  describe("Stake Operations", function () {
    beforeEach(async function () {
      this.poolId = await createSamplePool();
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

    describe("Multiple Stakes by Same User", function () {
      it("should handle multiple stakes correctly", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Second stake exactly 1000s later should claim rewards and add to stake
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        const initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).stake(this.poolId, wei(100));
        const finalBalance = await RewardToken.balanceOf(alice.address);

        // Should have auto-claimed rewards
        expect(finalBalance - initialBalance).to.equal(wei(1000));

        // Should have double stake amount
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(wei(100) * 2n);
      });

      it("should not increment active staker count on subsequent stakes", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await Stake.connect(alice).stake(this.poolId, wei(100));

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });
    });

    describe("Reward Calculation Scenarios", function () {
      it("should have 0 claimable rewards immediately after staking", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        // Immediately after staking, Alice's claimable reward should be 0
        const [claimable, fee, claimedTotal, feeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);
        expect(claimable).to.equal(0);
        expect(fee).to.equal(0);
        expect(claimedTotal).to.equal(0);
        expect(feeTotal).to.equal(0);
      });

      it("should calculate rewards correctly for single staker", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        await time.increase(1234);
        const [claimable, fee, claimedTotal, feeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);
        expect(claimable).to.equal(wei(1234));
        expect(fee).to.equal(0);
        expect(claimedTotal).to.equal(0);
        expect(feeTotal).to.equal(0);
      });

      it("should calculate rewards correctly when second staker joins", async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));

        await time.setNextBlockTimestamp((await time.latest()) + 4567);
        await Stake.connect(bob).stake(this.poolId, wei(300));

        // Check rewards at the exact moment Bob stakes
        const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);
        const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
          await Stake.claimableReward(this.poolId, bob.address);

        expect(aliceClaimable).to.equal(wei(4567)); // Alice was alone for exactly 4567s
        expect(aliceFee).to.equal(0); // No claim fee set
        expect(aliceClaimedTotal).to.equal(0); // No claims yet
        expect(aliceFeeTotal).to.equal(0); // No fees yet
        expect(bobClaimable).to.equal(0); // Bob just staked
        expect(bobFee).to.equal(0); // No claim fee set
        expect(bobClaimedTotal).to.equal(0); // No claims yet
        expect(bobFeeTotal).to.equal(0); // No fees yet
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

        const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);
        const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
          await Stake.claimableReward(this.poolId, bob.address);

        expect(aliceClaimable).to.equal(wei(1250));
        expect(aliceFee).to.equal(0); // No claim fee set
        expect(aliceClaimedTotal).to.equal(0); // No claims yet
        expect(aliceFeeTotal).to.equal(0); // No fees yet
        expect(bobClaimable).to.equal(wei(750));
        expect(bobFee).to.equal(0); // No claim fee set
        expect(bobClaimedTotal).to.equal(0); // No claims yet
        expect(bobFeeTotal).to.equal(0); // No fees yet
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
        await time.increase(1000);

        const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);
        const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
          await Stake.claimableReward(this.poolId, bob.address);
        const [carolClaimable, carolFee, carolClaimedTotal, carolFeeTotal] =
          await Stake.claimableReward(this.poolId, carol.address);

        expect(aliceClaimable).to.equal(wei(1450));
        expect(aliceFee).to.equal(0); // No claim fee set
        expect(aliceClaimedTotal).to.equal(0); // No claims yet
        expect(aliceFeeTotal).to.equal(0); // No fees yet
        expect(bobClaimable).to.equal(wei(1350));
        expect(bobFee).to.equal(0); // No claim fee set
        expect(bobClaimedTotal).to.equal(0); // No claims yet
        expect(bobFeeTotal).to.equal(0); // No fees yet
        expect(carolClaimable).to.equal(wei(200));
        expect(carolFee).to.equal(0); // No claim fee set
        expect(carolClaimedTotal).to.equal(0); // No claims yet
        expect(carolFeeTotal).to.equal(0); // No fees yet
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

        // Check that claimedTotal is updated
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.claimedTotal).to.equal(wei(3));
      });

      it("should emit RewardClaimed event on claim", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 100);

        await expect(Stake.connect(alice).claim(this.poolId))
          .to.emit(Stake, "RewardClaimed")
          .withArgs(this.poolId, alice.address, wei(100), wei(0));
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
        expect(pool.lastRewardUpdatedAt).to.equal(0);
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

    describe("Validations", function () {
      describe("Pool Creation Validations", function () {
        beforeEach(async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );
        });

        it("should revert if stakingToken is zero address", async function () {
          await expect(
            Stake.connect(owner).createPool(
              ethers.ZeroAddress,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidToken");
        });

        it("should revert if rewardToken is zero address", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              ethers.ZeroAddress,
              SIMPLE_POOL.rewardAmount,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidToken");
        });

        it("should revert if rewardAmount is zero", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              0,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__ZeroAmount");
        });

        it("should revert if rewardDuration is too short", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MIN_REWARD_DURATION - 1n
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration");
        });

        it("should revert if rewardDuration is too long", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              MAX_REWARD_DURATION + 1n
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration");
        });

        it("should accept minimum valid duration", async function () {
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
          // Override the default approval with insufficient amount
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

        it("should create pool with custom parameters", async function () {
          const customRewardAmount = wei(1_000_000);
          const customDuration = MAX_REWARD_DURATION / 2n; // 5 years

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
          expect(pool.lastRewardUpdatedAt).to.equal(0);
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
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidRewardAmount");
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
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__TokenHasTransferFeesOrRebasing"
          );
        });
      }); // Pool Creation Validations

      describe("Staking Validations", function () {
        it("should revert if stake amount is too small", async function () {
          await expect(
            Stake.connect(alice).stake(this.poolId, MIN_STAKE_AMOUNT - 1n)
          ).to.be.revertedWithCustomError(Stake, "Stake__StakeTooSmall");
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

        it("should revert if staking token has transfer fees", async function () {
          const TaxToken = await ethers.deployContract("TaxToken", [
            wei(1000000),
          ]);
          await TaxToken.waitForDeployment();

          // Create a pool with TaxToken as staking token
          await distributeTokens(TaxToken, [owner], wei(10000));
          await approveTokens(TaxToken, [owner], Stake.target);
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            TaxToken.target,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          // Distribute and approve TaxToken for alice
          await distributeTokens(TaxToken, [alice], wei(10000));
          await approveTokens(TaxToken, [alice], Stake.target);

          // Try to stake - should revert due to transfer fees
          await expect(
            Stake.connect(alice).stake(poolId, wei(1000))
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__TokenHasTransferFeesOrRebasing"
          );
        });
      }); // Staking Validations

      describe("Unstaking Validations", function () {
        beforeEach(async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));
        });

        it("should revert if unstake amount is zero", async function () {
          await expect(
            Stake.connect(alice).unstake(this.poolId, 0)
          ).to.be.revertedWithCustomError(Stake, "Stake__ZeroAmount");
        });

        it("should revert if insufficient balance", async function () {
          await expect(
            Stake.connect(alice).unstake(this.poolId, wei(100) + wei(1))
          ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).unstake(999, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      }); // Unstaking Validations

      describe("Claim Validations", function () {
        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).claim(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      }); // Claim Validations

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
      }); // Pool Cancellation Validations
    });

    describe("View Functions", function () {
      beforeEach(async function () {
        // Create additional pools for testing (use owner who has tokens)
        await createSamplePool(); // poolId 1
        await createSamplePool(); // poolId 2

        // Add some stakes and claims for testing
        await Stake.connect(alice).stake(this.poolId, wei(100));
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(bob).stake(this.poolId, wei(300));
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).stake(1, wei(100));
      });

      describe("claimableRewardBulk", function () {
        it("should return only pools with rewards (claimable > 0)", async function () {
          // Move time forward to generate rewards
          await time.increase(1000);

          const results = await Stake.claimableRewardBulk(0, 3, alice.address);

          // Alice staked in pools 0 and 1, so only these should be returned
          expect(results).to.have.length(2);
          expect(results[0][0]).to.equal(0); // poolId 0
          expect(results[1][0]).to.equal(1); // poolId 1

          // Verify claimable rewards are correct for pool 0
          // Alice has 100 tokens, Bob has 300 tokens in pool 0
          // Alice = 1000 + 2000 * 1/4 = 1500
          expect(results[0][1]).to.equal(wei(1500)); // claimable
          expect(results[0][2]).to.equal(0); // fee
          expect(results[0][3]).to.equal(0); // claimedTotal
          expect(results[0][4]).to.equal(0); // feeTotal

          // Verify claimable rewards are correct for pool 1
          // Alice should get 100% of rewards = 1000 tokens after 1000s
          expect(results[1][1]).to.equal(wei(1000)); // claimable
          expect(results[1][2]).to.equal(0); // fee
          expect(results[1][3]).to.equal(0); // claimedTotal
          expect(results[1][4]).to.equal(0); // feeTotal
        });

        it("should return pools with claimed rewards > 0", async function () {
          // Move time forward and claim rewards
          await time.setNextBlockTimestamp((await time.latest()) + 1000);
          await Stake.connect(alice).claim(this.poolId);

          // Alice has claimed 1500 rewards, so claimable = 0

          const results = await Stake.claimableRewardBulk(0, 3, alice.address);

          // Should still return pool 0 because alice has claimed rewards > 0
          // Pool 1 should also be returned because alice still has stake there
          expect(results).to.have.length(2);

          // Find pool 0 result
          const pool0Result = results.find((r) => r[0] === 0n);
          expect(pool0Result).to.not.be.undefined;
          expect(pool0Result[1]).to.equal(0); // claimable = 0 (fully unstaked)
          expect(pool0Result[2]).to.equal(0); // fee = 0 (no claim fee set)
          expect(pool0Result[3]).to.equal(wei(1500)); // claimedTotal = 1500 (from earlier claim)
          expect(pool0Result[4]).to.equal(0); // feeTotal = 0 (no claim fee set)
        });

        it("should return empty array if no pools have rewards", async function () {
          const results = await Stake.claimableRewardBulk(0, 3, carol.address);

          expect(results).to.have.length(0);
        });

        it("should handle mixed pools (some with rewards, some without)", async function () {
          // Create additional pools where carol has no activity
          await createSamplePool(); // poolId 3
          await createSamplePool(); // poolId 4

          await time.increase(500);

          const results = await Stake.claimableRewardBulk(0, 5, alice.address);

          // Alice should only have rewards in pools 0 and 1
          expect(results).to.have.length(2);
          expect(results[0][0]).to.equal(0); // poolId 0
          expect(results[1][0]).to.equal(1); // poolId 1
        });

        it("should handle poolIdTo exceeding poolCount", async function () {
          await time.increase(1000);

          const results = await Stake.claimableRewardBulk(0, 10, alice.address);

          // Only pools 0 and 1 exist with alice's stakes
          expect(results).to.have.length(2);
          expect(results[0][0]).to.equal(0);
          expect(results[1][0]).to.equal(1);
        });

        it("should return empty array if poolIdFrom >= poolCount", async function () {
          const results = await Stake.claimableRewardBulk(5, 10, alice.address);

          expect(results).to.have.length(0);
        });

        it("should handle partial ranges correctly", async function () {
          await time.increase(1000);

          // Query only pool 1
          const results = await Stake.claimableRewardBulk(1, 2, alice.address);

          expect(results).to.have.length(1);
          expect(results[0][0]).to.equal(1); // poolId 1
          expect(results[0][1]).to.equal(wei(1000)); // claimable
          expect(results[0][2]).to.equal(0); // fee
          expect(results[0][3]).to.equal(0); // claimedTotal
          expect(results[0][4]).to.equal(0); // feeTotal
        });

        it("should return correct values after partial claims", async function () {
          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          // Alice claim rewards from pool 0 -> 1500
          await Stake.connect(alice).claim(this.poolId);

          // Move time forward for more rewards
          await time.increase(1000);

          // Alice claimed: 1500 / Claimable: 1000 * 1/4 = 250
          const results = await Stake.claimableRewardBulk(0, 2, alice.address);

          expect(results).to.have.length(2);

          // Pool 0: Alice claimed 1500 tokens earlier, now has 250 more claimable
          const pool0Result = results.find((r) => r[0] === 0n);
          expect(pool0Result[1]).to.equal(wei(250)); // new claimable
          expect(pool0Result[2]).to.equal(0); // fee (no claim fee set)
          expect(pool0Result[3]).to.equal(wei(1500)); // previously claimedTotal
          expect(pool0Result[4]).to.equal(0); // feeTotal (no claim fee set)

          // Pool 1: Alice never claimed, so has 2000 claimable (2000s after staking)
          const pool1Result = results.find((r) => r[0] === 1n);
          expect(pool1Result[1]).to.equal(wei(2000)); // claimable
          expect(pool1Result[2]).to.equal(0); // fee (no claim fee set)
          expect(pool1Result[3]).to.equal(0); // claimedTotal
          expect(pool1Result[4]).to.equal(0); // feeTotal
        });

        it("should handle users with no staked amount correctly", async function () {
          // Alice stakes and then completely unstakes (which claims all rewards)
          await time.setNextBlockTimestamp((await time.latest()) + 1000);
          await Stake.connect(alice).unstake(this.poolId, wei(100));

          const results = await Stake.claimableRewardBulk(0, 3, alice.address);

          // Should still return pool 0 because alice has claimed rewards > 0
          expect(results).to.have.length(2);

          // Find pool 0 result
          const pool0Result = results.find((r) => r[0] === 0n);
          expect(pool0Result).to.not.be.undefined;
          expect(pool0Result[1]).to.equal(0); // claimable = 0 (no stake)
          expect(pool0Result[2]).to.equal(0); // fee = 0 (no stake)
          expect(pool0Result[3]).to.equal(wei(1500)); // claimedTotal = 1500 (from unstake claim)
          expect(pool0Result[4]).to.equal(0); // feeTotal = 0 (no claim fee set)
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
      }); // claimableRewardBulk

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
      }); // getPools

      describe("version", function () {
        it("should return correct version", async function () {
          const version = await Stake.version();
          expect(version).to.equal("1.0.0");
        });
      }); // version
    }); // View Functions

    describe("Edge Cases", function () {
      describe("Pool Expiration Scenarios", function () {
        it("should stop reward distribution when pool expires", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move to exact end time
          await time.increaseTo(
            (await time.latest()) + SIMPLE_POOL.rewardDuration
          );

          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.poolId, alice.address);
          expect(claimable).to.equal(SIMPLE_POOL.rewardAmount); // All rewards
          expect(fee).to.equal(0); // No claim fee set
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);

          // Move past end time - should not increase rewards
          await time.increase(9999);

          const [claimableAfter, feeAfter, claimedTotalAfter, feeTotalAfter] =
            await Stake.claimableReward(this.poolId, alice.address);
          expect(claimableAfter).to.equal(SIMPLE_POOL.rewardAmount); // Still all rewards
          expect(feeAfter).to.equal(0); // No claim fee set
          expect(claimedTotalAfter).to.equal(0);
          expect(feeTotalAfter).to.equal(0);
        });

        it("should allow claiming rewards after pool expires", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move past end time
          await time.increase(SIMPLE_POOL.rewardDuration * 10);

          // Should be able to claim all rewards
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(this.poolId);
          const finalBalance = await RewardToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(
            SIMPLE_POOL.rewardAmount
          );
        });
      }); // Pool Expiration Scenarios

      describe("Cancelled Pool Scenarios", function () {
        it("should allow claiming rewards from cancelled pool", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Cancel pool exactly 1000s after staking
          await time.setNextBlockTimestamp((await time.latest()) + 1000);
          await Stake.connect(owner).cancelPool(this.poolId);

          // Should be able to claim earned rewards
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(this.poolId);
          const finalBalance = await RewardToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(wei(1000));
        });

        it("should stop reward distribution when pool is cancelled", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Cancel pool after 50% of duration
          await time.setNextBlockTimestamp(
            (await time.latest()) + SIMPLE_POOL.rewardDuration / 2
          );
          await Stake.connect(owner).cancelPool(this.poolId);

          // Move further in time
          await time.increase(9999);

          // Should only have rewards up to cancellation time
          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.poolId, alice.address);

          expect(claimable).to.equal(SIMPLE_POOL.rewardAmount / 2n); // 50% of rewards
          expect(fee).to.equal(0); // No claim fee set
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);
        });
      }); // Cancelled Pool Scenarios

      describe("Empty Pool Scenarios", function () {
        it("should handle empty pool (no stakes)", async function () {
          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.poolId, alice.address);
          expect(claimable).to.equal(0);
          expect(fee).to.equal(0);
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);
        });

        it("should handle pool with all stakes removed", async function () {
          await Stake.connect(alice).stake(this.poolId, wei(100));
          await Stake.connect(alice).unstake(this.poolId, wei(100));

          const pool = await Stake.pools(this.poolId);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
        });
      }); // Empty Pool Scenarios

      describe("Token Type Edge Cases", function () {
        it("should handle same token for staking and rewards", async function () {
          const poolId = await Stake.poolCount();
          await approveTokens(StakingToken, [owner], Stake.target);
          await Stake.connect(owner).createPool(
            StakingToken.target,
            StakingToken.target, // Same token
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          await Stake.connect(alice).stake(poolId, wei(100));

          const userStake = await Stake.userPoolStake(alice.address, poolId);
          expect(userStake.stakedAmount).to.equal(wei(100));

          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          const initialBalance = await StakingToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(poolId);
          const finalBalance = await StakingToken.balanceOf(alice.address);

          expect(finalBalance - initialBalance).to.equal(wei(1000));
        });

        it("should handle tokens with different decimals", async function () {
          const Token6 = await ethers.deployContract("TestToken", [
            wei(1_000_000, 6),
            "6 Decimal Token",
            "6DEC",
            6n,
          ]);
          await Token6.waitForDeployment();
          const Token8 = await ethers.deployContract("TestToken", [
            wei(1_000_000, 8),
            "8 Decimal Token",
            "8DEC",
            8n,
          ]);
          await Token8.waitForDeployment();

          // Distribute tokens
          await distributeTokens(Token6, [alice, owner], wei(100000, 6));
          await approveTokens(Token6, [alice, owner], Stake.target);
          await distributeTokens(Token8, [alice, owner], wei(100000, 8));
          await approveTokens(Token8, [alice, owner], Stake.target);

          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            Token6.target,
            Token8.target,
            wei(10000, 8), // 10k reward tokens, with 8 decimals
            10000n // 10000 seconds
          );

          await Stake.connect(alice).stake(poolId, wei(100, 6));
          await time.increase(1000);
          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(poolId, alice.address);
          expect(claimable).to.equal(wei(1000, 8)); // 1 token per second
          expect(fee).to.equal(0); // No claim fee set
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);
        });

        it("should handle standard ERC20 tokens without transfer fees correctly", async function () {
          const poolId = await Stake.poolCount();
          await approveTokens(StakingToken, [owner], Stake.target);
          await Stake.connect(owner).createPool(
            StakingToken.target,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            SIMPLE_POOL.rewardDuration
          );

          // Record balances before staking
          const contractBalanceBefore = await StakingToken.balanceOf(
            Stake.target
          );
          const aliceBalanceBefore = await StakingToken.balanceOf(
            alice.address
          );
          const stakeAmount = wei(100);

          // Stake tokens
          await Stake.connect(alice).stake(poolId, stakeAmount);

          // Verify balances after staking
          const contractBalanceAfter = await StakingToken.balanceOf(
            Stake.target
          );
          const aliceBalanceAfter = await StakingToken.balanceOf(alice.address);

          // Contract should receive exactly the staked amount
          expect(contractBalanceAfter - contractBalanceBefore).to.equal(
            stakeAmount
          );
          // Alice should lose exactly the staked amount
          expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(stakeAmount);

          // Verify accounting is correct
          const userStake = await Stake.userPoolStake(alice.address, poolId);
          expect(userStake.stakedAmount).to.equal(stakeAmount);
          const pool = await Stake.pools(poolId);
          expect(pool.totalStaked).to.equal(stakeAmount);
        });
      }); // Token Type Edge Cases

      describe("Precision and Rounding Edge Cases", function () {
        beforeEach(async function () {
          // NOTE:
          // accRewardPerShare = (totalReward * REWARD_PRECISION) / pool.totalStaked;
          // accRewardAmount = (stakedAmount * accRewardPerShare) / REWARD_PRECISION;

          // So when totalReward is small, but totalStaked is large, we have rounding issues

          this.rewardAmount = 12340n;
          this.stakingAmount = wei(100); // 100 * 1e18 wei
          this.duration = 10000; // 10000s

          this.smallPoolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            RewardToken.target,
            this.rewardAmount,
            this.duration
          );

          await Stake.connect(alice).stake(
            this.smallPoolId,
            this.stakingAmount
          );

          // in this scenario, we have 12340 reward / 100 * 1e18 staked tokens / 1000s passed
          // so accRewardPerShare = (1000s * 12340 / 10000s) * 1e18 / 100 * 1e18 = 12
          // accRewardAmount = (100 * 1e18 * 12) / 1e18 = 1200 (precision loss from 1234)
          // -> after 1000s, we will have 1200 rewards instead of 1234
        });

        it("may have reward rounding issues with small rewards", async function () {
          await time.increase(1000);

          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);

          expect(claimable).to.equal(1200n);
          expect(fee).to.equal(0); // No claim fee set
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);
        });

        it("will have small dust after full duration", async function () {
          // Wait full duration
          await time.increase(this.duration);

          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);

          expect(claimable).to.equal(12300n);
          expect(fee).to.equal(0); // No claim fee set
          expect(claimedTotal).to.equal(0);
          expect(feeTotal).to.equal(0);

          await Stake.connect(alice).claim(this.smallPoolId);
          expect(await RewardToken.balanceOf(Stake.target)).to.equal(
            40n + SIMPLE_POOL.rewardAmount // pool 1: 40 (dust) + pool 0: SIMPLE_POOL.rewardAmount
          );
        });

        it("should handle multiple users with precision", async function () {
          // After 1000s, bob stakes 300 * 1e18 wei
          await time.setNextBlockTimestamp((await time.latest()) + 1000);
          await Stake.connect(bob).stake(this.smallPoolId, wei(300));

          await time.increase(1000); // total 2000s passed

          // Verify individual claimable amounts
          const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);
          const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
            await Stake.claimableReward(this.smallPoolId, bob.address);

          // Alice: 1200 + 1200 * 100/400 = 1200 + 300 = 1500
          // Bob: 1200 * 300/400 = 900
          expect(aliceClaimable).to.equal(1500n);
          expect(aliceFee).to.equal(0); // No claim fee set
          expect(aliceClaimedTotal).to.equal(0);
          expect(aliceFeeTotal).to.equal(0);
          expect(bobClaimable).to.equal(900n);
          expect(bobFee).to.equal(0); // No claim fee set
          expect(bobClaimedTotal).to.equal(0);
          expect(bobFeeTotal).to.equal(0);
        });
      }); // Precision and Rounding Edge Cases

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
          await approveTokens(LargeSupplyToken, [owner], Stake.target);

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

          await expect(Stake.connect(alice).stake(this.poolId, minStakeAmount))
            .to.not.be.reverted;
        });

        it("should handle maximum reward duration boundary", async function () {
          const maxDuration = await Stake.MAX_REWARD_DURATION();

          await expect(
            Stake.connect(owner).createPool(
              StakingToken.target,
              RewardToken.target,
              SIMPLE_POOL.rewardAmount,
              maxDuration
            )
          ).to.not.be.reverted;
        });
      }); // Boundary Conditions

      describe("Pool State Transitions", function () {
        it("should handle created -> active -> cancelled transition", async function () {
          const poolId = await createSamplePool();

          // Initially created state
          let pool = await Stake.pools(poolId);
          expect(pool.rewardStartedAt).to.equal(0);
          expect(pool.cancelledAt).to.equal(0);
          expect(pool.totalStaked).to.equal(0);

          // Transition to active
          await Stake.connect(alice).stake(poolId, wei(100));
          const rewardStartedAt = await time.latest();

          pool = await Stake.pools(poolId);
          expect(pool.rewardStartedAt).to.equal(rewardStartedAt);
          expect(pool.cancelledAt).to.equal(0);
          expect(pool.totalStaked).to.equal(wei(100));

          // Transition to cancelled
          await Stake.connect(owner).cancelPool(poolId);

          pool = await Stake.pools(poolId);
          expect(pool.rewardStartedAt).to.equal(rewardStartedAt);
          expect(pool.cancelledAt).to.equal(await time.latest());
          expect(pool.totalStaked).to.equal(wei(100));
        });
      }); // Pool State Transitions

      describe("Multiple Transactions In Same Block", function () {
        beforeEach(async function () {
          const targetTime = (await time.latest()) + 1000;

          // Disable auto-mining to control block creation
          await ethers.provider.send("evm_setAutomine", [false]);
          await ethers.provider.send("evm_setIntervalMining", [0]);

          // Set the next block timestamp
          await time.setNextBlockTimestamp(targetTime);

          // Prepare transaction data for both stake calls
          const stakeInterface = Stake.interface;
          const aliceStakeData = stakeInterface.encodeFunctionData("stake", [
            this.poolId,
            wei(100),
          ]);
          const bobStakeData = stakeInterface.encodeFunctionData("stake", [
            this.poolId,
            wei(300),
          ]);

          // Send both transactions to pending block (await the sending, not the mining)
          await alice.sendTransaction({
            to: Stake.target,
            data: aliceStakeData,
            gasLimit: 200000,
          });

          await bob.sendTransaction({
            to: Stake.target,
            data: bobStakeData,
            gasLimit: 200000,
          });

          // Mine a single block containing both transactions
          await ethers.provider.send("evm_mine", []);

          // Re-enable auto-mining
          await ethers.provider.send("evm_setAutomine", [true]);

          this.pool = await Stake.pools(this.poolId);
          this.targetTime = targetTime;
        });

        it("should verify both transactions are in the same block", async function () {
          // Get the latest block
          const latestBlock = await ethers.provider.getBlock("latest");

          // Should have both transactions in the same block
          expect(latestBlock.transactions.length).to.equal(2);

          // Verify both transactions are stake transactions
          const tx1 = await ethers.provider.getTransaction(
            latestBlock.transactions[0]
          );
          const tx2 = await ethers.provider.getTransaction(
            latestBlock.transactions[1]
          );

          expect(tx1.to).to.equal(Stake.target);
          expect(tx2.to).to.equal(Stake.target);
          expect(tx1.blockNumber).to.equal(tx2.blockNumber);
        });

        it("should have correct staker count", async function () {
          expect(this.pool.activeStakerCount).to.equal(2);
        });

        it("should have correct total staked", async function () {
          expect(this.pool.totalStaked).to.equal(wei(400));
        });

        it("should have correct reward started at", async function () {
          expect(this.pool.rewardStartedAt).to.equal(this.targetTime);
        });

        it("should have zero claimable rewards immediately for both users", async function () {
          const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
            await Stake.claimableReward(this.poolId, alice.address);
          const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
            await Stake.claimableReward(this.poolId, bob.address);

          expect(aliceClaimable).to.equal(0);
          expect(aliceFee).to.equal(0);
          expect(aliceClaimedTotal).to.equal(0);
          expect(aliceFeeTotal).to.equal(0);
          expect(bobClaimable).to.equal(0);
          expect(bobFee).to.equal(0);
          expect(bobClaimedTotal).to.equal(0);
          expect(bobFeeTotal).to.equal(0);
        });

        it("should calculate proportional rewards correctly after time passes", async function () {
          // Move time forward by 1000 seconds
          await time.increase(1000);

          const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
            await Stake.claimableReward(this.poolId, alice.address);
          const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
            await Stake.claimableReward(this.poolId, bob.address);

          // Alice: 100/400 = 25% of 1000 rewards = 250
          // Bob: 300/400 = 75% of 1000 rewards = 750
          expect(aliceClaimable).to.equal(wei(250));
          expect(aliceFee).to.equal(0); // No claim fee set
          expect(aliceClaimedTotal).to.equal(0);
          expect(aliceFeeTotal).to.equal(0);
          expect(bobClaimable).to.equal(wei(750));
          expect(bobFee).to.equal(0); // No claim fee set
          expect(bobClaimedTotal).to.equal(0);
          expect(bobFeeTotal).to.equal(0);
        });
      }); // Multiple Transactions In Same Block
    }); // Edge Cases
  }); // Stake Operations

  describe("Claim Fee", function () {
    beforeEach(async function () {
      this.poolId = await createSamplePool();
      await Stake.connect(owner).updateClaimFee(400n);
      await Stake.connect(alice).stake(this.poolId, wei(100));
      this.stakedTime = await time.latest();
    });

    it("should calculate claim fee correctly", async function () {
      await time.increase(1000);
      const [claimable, fee, claimedTotal, feeTotal] =
        await Stake.claimableReward(this.poolId, alice.address);

      expect(claimable).to.equal(wei(960));
      expect(fee).to.equal(wei(40));
      expect(claimedTotal).to.equal(0);
      expect(feeTotal).to.equal(0);
    });

    it("should transfer fee to protocol beneficiary", async function () {
      const initialUserBalance = await RewardToken.balanceOf(alice.address);
      const initialBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      await time.setNextBlockTimestamp(this.stakedTime + 1000);
      await Stake.connect(alice).claim(this.poolId);

      const finalUserBalance = await RewardToken.balanceOf(alice.address);
      const finalBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      expect(finalUserBalance - initialUserBalance).to.equal(wei(960));
      expect(finalBeneficiaryBalance - initialBeneficiaryBalance).to.equal(
        wei(40)
      ); // Beneficiary gets 4%
    });

    it("should handle different fee percentages in the middle of the pool", async function () {
      await time.setNextBlockTimestamp(this.stakedTime + 1000); // alice earned 1000 rewards
      await Stake.connect(owner).updateClaimFee(100); // update to 1% fee

      await time.increase(1000); // alice earned 2000 rewards in total

      let [claimable, fee, claimedTotal, feeTotal] =
        await Stake.claimableReward(this.poolId, alice.address);
      expect(claimable).to.equal(wei(1980)); // 2000 - 20 (1% fee)
      expect(fee).to.equal(wei(20)); // 1% of 2000
      expect(claimedTotal).to.equal(0);
      expect(feeTotal).to.equal(0);
    });

    it("should handle fee with multiple stakes correctly", async function () {
      await time.setNextBlockTimestamp(this.stakedTime + 1000); // Alice earned 1000 rewards
      await Stake.connect(bob).stake(this.poolId, wei(300));

      await time.increase(1000);

      // Alice: 1000 + 1000 * 100/400 = 1250 gross rewards
      // Reward: 1200 / Fee: 50 (4%)
      const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
        await Stake.claimableReward(this.poolId, alice.address);
      expect(aliceClaimable).to.equal(wei(1200));
      expect(aliceFee).to.equal(wei(50));
      expect(aliceClaimedTotal).to.equal(0);
      expect(aliceFeeTotal).to.equal(0);

      // Bob: 1000 * 300/400 = 750 gross rewards
      // Reward: 720 / Fee: 30 (4%)
      const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
        await Stake.claimableReward(this.poolId, bob.address);
      expect(bobClaimable).to.equal(wei(720));
      expect(bobFee).to.equal(wei(30));
      expect(bobClaimedTotal).to.equal(0);
      expect(bobFeeTotal).to.equal(0);
    });

    it("should handle fee with unstaking (auto-claim)", async function () {
      const initialUserBalance = await RewardToken.balanceOf(alice.address);
      const initialBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      // Unstaking should auto-claim rewards with fee
      await time.setNextBlockTimestamp(this.stakedTime + 1000); // alice earned 1000 rewards
      await Stake.connect(alice).unstake(this.poolId, wei(50)); // alice unstakes 50

      const finalUserBalance = await RewardToken.balanceOf(alice.address);
      const finalBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      expect(finalUserBalance - initialUserBalance).to.equal(wei(960));
      expect(finalBeneficiaryBalance - initialBeneficiaryBalance).to.equal(
        wei(40)
      );
    });

    it("should handle fee with additional stakes (auto-claim)", async function () {
      const initialUserBalance = await RewardToken.balanceOf(alice.address);
      const initialBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      // Additional staking should auto-claim rewards with fee
      await time.setNextBlockTimestamp(this.stakedTime + 1000); // alice earned 1000 rewards
      await Stake.connect(alice).stake(this.poolId, wei(100)); // alice stakes 100 more

      const finalUserBalance = await RewardToken.balanceOf(alice.address);
      const finalBeneficiaryBalance = await RewardToken.balanceOf(
        owner.address
      );

      expect(finalUserBalance - initialUserBalance).to.equal(wei(960));
      expect(finalBeneficiaryBalance - initialBeneficiaryBalance).to.equal(
        wei(40)
      );
    });

    it("should not charge fee when claimable is 0", async function () {
      // No time passed, so no rewards
      const [claimable, fee, claimedTotal, feeTotal] =
        await Stake.claimableReward(this.poolId, alice.address);
      expect(claimable).to.equal(0);
      expect(fee).to.equal(0);
      expect(claimedTotal).to.equal(0);
      expect(feeTotal).to.equal(0);
    });

    it("should emit RewardClaimed event with gross amount", async function () {
      await time.setNextBlockTimestamp(this.stakedTime + 1000); // alice earned 1000 rewards

      await expect(Stake.connect(alice).claim(this.poolId))
        .to.emit(Stake, "RewardClaimed")
        .withArgs(this.poolId, alice.address, wei(960), wei(40));
    });
  }); // Claim Fee Operations

  describe("Admin Functions", function () {
    describe("updateProtocolBeneficiary", function () {
      it("should update protocol beneficiary", async function () {
        await expect(
          Stake.connect(owner).updateProtocolBeneficiary(alice.address)
        )
          .to.emit(Stake, "ProtocolBeneficiaryUpdated")
          .withArgs(owner.address, alice.address);

        expect(await Stake.protocolBeneficiary()).to.equal(alice.address);
      });

      it("should revert if called by non-owner", async function () {
        await expect(
          Stake.connect(alice).updateProtocolBeneficiary(alice.address)
        ).to.be.revertedWithCustomError(Stake, "OwnableUnauthorizedAccount");
      });

      it("should revert if zero address", async function () {
        await expect(
          Stake.connect(owner).updateProtocolBeneficiary(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(Stake, "Stake__InvalidAddress");
      });
    });

    describe("updateCreationFee", function () {
      it("should update creation fee", async function () {
        const newFee = ethers.parseEther("0.1");
        await expect(Stake.connect(owner).updateCreationFee(newFee))
          .to.emit(Stake, "CreationFeeUpdated")
          .withArgs(0, newFee);

        expect(await Stake.creationFee()).to.equal(newFee);
      });

      it("should revert if called by non-owner", async function () {
        await expect(
          Stake.connect(alice).updateCreationFee(ethers.parseEther("0.1"))
        ).to.be.revertedWithCustomError(Stake, "OwnableUnauthorizedAccount");
      });
    }); // updateCreationFee

    describe("updateClaimFee", function () {
      it("should update claim fee", async function () {
        const newFee = 500; // 5%
        await expect(Stake.connect(owner).updateClaimFee(newFee))
          .to.emit(Stake, "ClaimFeeUpdated")
          .withArgs(0, newFee);

        expect(await Stake.claimFee()).to.equal(newFee);
      });

      it("should revert if called by non-owner", async function () {
        await expect(
          Stake.connect(alice).updateClaimFee(500)
        ).to.be.revertedWithCustomError(Stake, "OwnableUnauthorizedAccount");
      });

      it("should allow setting claim fee to 0", async function () {
        await expect(Stake.connect(owner).updateClaimFee(0))
          .to.emit(Stake, "ClaimFeeUpdated")
          .withArgs(0, 0);

        expect(await Stake.claimFee()).to.equal(0);
      });

      it("should revert if fee is greater than MAX_CLAIM_FEE", async function () {
        await expect(
          Stake.connect(owner).updateClaimFee(2001)
        ).to.be.revertedWithCustomError(Stake, "Stake__InvalidClaimFee");
      });
    }); // updateClaimFee
  }); // Admin Functions

  describe("Creation Fee", function () {
    beforeEach(async function () {
      await Stake.connect(owner).updateCreationFee(ethers.parseEther("0.1"));
    });

    it("should require exact creation fee", async function () {
      await expect(
        Stake.connect(owner).createPool(
          StakingToken.target,
          RewardToken.target,
          SIMPLE_POOL.rewardAmount,
          SIMPLE_POOL.rewardDuration,
          { value: ethers.parseEther("0.05") }
        )
      ).to.be.revertedWithCustomError(Stake, "Stake__InvalidCreationFee");
    });

    it("should transfer creation fee to beneficiary", async function () {
      await distributeTokens(RewardToken, [alice], SIMPLE_POOL.rewardAmount);
      await approveTokens(RewardToken, [alice], Stake.target);

      const initialBalance = await ethers.provider.getBalance(owner.address);
      await Stake.connect(alice).createPool(
        StakingToken.target,
        RewardToken.target,
        SIMPLE_POOL.rewardAmount,
        SIMPLE_POOL.rewardDuration,
        { value: ethers.parseEther("0.1") }
      );
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
    });

    it("should work with zero creation fee", async function () {
      await Stake.connect(owner).updateCreationFee(0);

      await expect(
        Stake.connect(owner).createPool(
          StakingToken.target,
          RewardToken.target,
          SIMPLE_POOL.rewardAmount,
          SIMPLE_POOL.rewardDuration,
          { value: 0 }
        )
      ).to.not.be.reverted;
    });
  }); // Creation Fee
}); // Stake
