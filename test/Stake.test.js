const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MAX_INT_256, wei } = require("./utils/test-utils");

// Constants from contract
const MIN_REWARD_DURATION = 3600n;
const MAX_REWARD_DURATION = MIN_REWARD_DURATION * 24n * 365n * 10n; // 10 years

// Token amount constants
const INITIAL_TOKEN_SUPPLY = 2n ** 256n - 1n; // max(uint256)
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

  const createSamplePool = async (
    creator = owner,
    isStakingTokenERC20 = true,
    rewardStartsAt = 0 // 0 = start on first stake, future time = pre-staking allowed
  ) => {
    const poolId = await Stake.poolCount(); // Get current pool count before creating
    await Stake.connect(creator).createPool(
      SIMPLE_POOL.stakingToken,
      isStakingTokenERC20,
      SIMPLE_POOL.rewardToken,
      SIMPLE_POOL.rewardAmount,
      rewardStartsAt,
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

  describe("Contract Deployment", function () {
    it("should deploy with valid creation fee", async function () {
      const validFee = 5n * 10n ** 17n; // 0.5 ETH
      const TestStake = await ethers.deployContract("Stake", [
        owner.address,
        validFee,
        0,
      ]);
      await TestStake.waitForDeployment();
      expect(await TestStake.creationFee()).to.equal(validFee);
    });

    it("should deploy with maximum creation fee (1 ETH)", async function () {
      const maxFee = 10n ** 18n;
      const TestStake = await ethers.deployContract("Stake", [
        owner.address,
        maxFee,
        0,
      ]);
      await TestStake.waitForDeployment();
      expect(await TestStake.creationFee()).to.equal(maxFee);
    });
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

      it("should initialize reward clock on first stake", async function () {
        // Both rewardStartedAt and lastRewardUpdatedAt should be set to current time
        const stakeTime = await time.latest();
        expect(this.pool.rewardStartedAt).to.equal(stakeTime);
        expect(this.pool.lastRewardUpdatedAt).to.equal(stakeTime);
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

      it("should emit Unstaked event with rewardClaimed=true", async function () {
        await expect(
          Stake.connect(alice).unstake(this.poolId, this.unstakeAmount)
        )
          .emit(Stake, "Unstaked")
          .withArgs(this.poolId, alice.address, this.unstakeAmount, true);
      });
    }); // Unstaking Operations

    describe("Emergency Unstaking Operations", function () {
      beforeEach(async function () {
        await Stake.connect(alice).stake(this.poolId, wei(100));
      });

      it("should unstake full amount without claiming rewards", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 1000);

        const initialRewardBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).emergencyUnstake(this.poolId);

        // All staking tokens returned, no rewards claimed
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(0);
        expect(await RewardToken.balanceOf(alice.address)).to.equal(
          initialRewardBalance
        );
      });

      it("should forfeit rewards during emergency unstake", async function () {
        await time.setNextBlockTimestamp((await time.latest()) + 1000);

        const initialBalance = await RewardToken.balanceOf(alice.address);

        // Emergency unstake full amount - rewards will be forfeited
        await Stake.connect(alice).emergencyUnstake(this.poolId);

        // User should have 0 staked and rewards should be forfeited
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(0);

        // Rewards should NOT be claimable (forfeited)
        const [rewardClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(rewardClaimable).to.equal(0);

        // No reward tokens should have been transferred
        expect(await RewardToken.balanceOf(alice.address)).to.equal(
          initialBalance
        );

        // Claiming should not transfer any tokens
        await Stake.connect(alice).claim(this.poolId);
        expect(await RewardToken.balanceOf(alice.address)).to.equal(
          initialBalance
        );
      });

      it("should emit Unstaked event with rewardClaimed=false", async function () {
        await expect(Stake.connect(alice).emergencyUnstake(this.poolId))
          .to.emit(Stake, "Unstaked")
          .withArgs(this.poolId, alice.address, wei(100), false);
      });

      it("should revert if no tokens staked", async function () {
        // First unstake all tokens
        await Stake.connect(alice).emergencyUnstake(this.poolId);

        // Try to emergency unstake again
        await expect(
          Stake.connect(alice).emergencyUnstake(this.poolId)
        ).to.be.revertedWithCustomError(Stake, "Stake__ZeroAmount");
      });
    }); // Emergency Unstaking Operations

    describe("Pool Management", function () {
      it("should create pool with correct parameters", async function () {
        const pool = await Stake.pools(this.poolId);

        expect(pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
        expect(pool.isStakingTokenERC20).to.equal(true);
        expect(pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
        expect(pool.creator).to.equal(owner.address);
        expect(pool.rewardAmount).to.equal(SIMPLE_POOL.rewardAmount);
        expect(pool.rewardDuration).to.equal(SIMPLE_POOL.rewardDuration);
        expect(pool.totalAllocatedRewards).to.equal(0);
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
            true,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          )
        )
          .emit(Stake, "PoolCreated")
          .withArgs(
            poolId,
            owner.address,
            SIMPLE_POOL.stakingToken,
            true,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            0,
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

      describe("totalAllocatedRewards Tracking", function () {
        it("should correctly track totalAllocatedRewards as rewards are allocated", async function () {
          const pool = await Stake.pools(this.poolId);
          expect(pool.totalAllocatedRewards).to.equal(0);

          // Alice stakes to start rewards
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Check pool still shows 0 allocated rewards initially
          const poolAfterStake = await Stake.pools(this.poolId);
          expect(poolAfterStake.totalAllocatedRewards).to.equal(0);

          // Move forward 1000 seconds (should allocate 1000 reward tokens at 1 per second)
          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          // Trigger pool update by checking claimable rewards
          await Stake.connect(alice).claim(this.poolId);

          // Check that totalAllocatedRewards has increased by expected amount
          const poolAfterTime = await Stake.pools(this.poolId);
          expect(poolAfterTime.totalAllocatedRewards).to.equal(wei(1000));
        });

        it("should accurately calculate refunds based on totalAllocatedRewards", async function () {
          // Alice stakes to start rewards
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move forward 2000 seconds (2000 reward tokens allocated)
          await time.setNextBlockTimestamp((await time.latest()) + 2000);

          // Force pool update by calling claim (which calls _updatePool internally)
          await Stake.connect(alice).claim(this.poolId);

          // Check allocated rewards before cancellation
          const poolBeforeCancel = await Stake.pools(this.poolId);
          expect(poolBeforeCancel.totalAllocatedRewards).to.equal(wei(2000));

          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          // Cancel pool and check refund
          const creatorBalanceBefore = await RewardToken.balanceOf(
            owner.address
          );
          await Stake.connect(owner).cancelPool(this.poolId);
          const creatorBalanceAfter = await RewardToken.balanceOf(
            owner.address
          );

          const refund = creatorBalanceAfter - creatorBalanceBefore;
          // Should refund: total reward - allocated rewards = 10,000 - 3,000 = 7,000
          expect(refund).to.equal(SIMPLE_POOL.rewardAmount - wei(3000));
        });

        it("should handle multiple users with correct totalAllocatedRewards tracking", async function () {
          // Alice stakes at start
          await Stake.connect(alice).stake(this.poolId, wei(100));

          // Move forward 1000 seconds
          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          // Bob stakes (this should update pool and allocate 1000 rewards to Alice's period)
          await Stake.connect(bob).stake(this.poolId, wei(300));

          // Check that 1000 rewards were allocated for Alice's solo period
          const poolAfterBobStakes = await Stake.pools(this.poolId);
          expect(poolAfterBobStakes.totalAllocatedRewards).to.equal(wei(1000));

          // Move forward another 1000 seconds (now both users earning)
          await time.increase(1000);

          const [aliceClaimable] = await Stake.claimableReward(
            this.poolId,
            alice.address
          );
          expect(aliceClaimable).to.equal(wei(1250)); // 1000 + 1000/4 = 1250

          // Should not update the totalAllocatedRewards since pool is not updated
          const poolAfterSecondPeriod = await Stake.pools(this.poolId);
          expect(poolAfterSecondPeriod.totalAllocatedRewards).to.equal(
            wei(1000)
          ); // if updated: 2000

          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          const beforeClaim = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).claim(this.poolId);
          const afterClaim = await RewardToken.balanceOf(alice.address);

          expect(afterClaim - beforeClaim).to.equal(wei(1500)); // 1000 + 1000/4 + 1000/4 = 1500

          const poolAfterThirdPeriod = await Stake.pools(this.poolId);
          expect(poolAfterThirdPeriod.totalAllocatedRewards).to.equal(
            wei(3000)
          ); // Should be updated
        });
      }); // totalAllocatedRewards Tracking
    }); // Pool Management

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
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidToken");
        });

        it("should revert if rewardToken is zero address", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              ethers.ZeroAddress,
              SIMPLE_POOL.rewardAmount,
              0,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidToken");
        });

        it("should revert if rewardAmount is zero", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              0,
              0,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__ZeroAmount");
        });

        it("should revert if rewardDuration is too short", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
              MIN_REWARD_DURATION - 1n
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration");
        });

        it("should revert if rewardDuration is too long", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
              MAX_REWARD_DURATION + 1n
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration");
        });

        it("should accept minimum valid duration", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
              MIN_REWARD_DURATION
            )
          ).to.not.be.reverted;
        });

        it("should accept maximum valid duration", async function () {
          await expect(
            Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
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
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
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
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              0,
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
            true,
            SIMPLE_POOL.rewardToken,
            SIMPLE_POOL.rewardAmount,
            0,
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
              true,
              SIMPLE_POOL.rewardToken,
              customRewardAmount,
              0,
              customDuration
            )
          )
            .to.emit(Stake, "PoolCreated")
            .withArgs(
              poolId,
              owner.address,
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              customRewardAmount,
              0,
              customDuration
            );

          const pool = await Stake.pools(poolId);
          expect(pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
          expect(pool.isStakingTokenERC20).to.equal(true);
          expect(pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
          expect(pool.creator).to.equal(owner.address);
          expect(pool.rewardAmount).to.equal(customRewardAmount);
          expect(pool.rewardDuration).to.equal(customDuration);
          expect(pool.totalAllocatedRewards).to.equal(0);
          expect(pool.rewardStartedAt).to.equal(0);
          expect(pool.cancelledAt).to.equal(0);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
          expect(pool.lastRewardUpdatedAt).to.equal(0);
          expect(pool.accRewardPerShare).to.equal(0);
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
              true,
              TaxToken.target,
              wei(10000),
              0,
              SIMPLE_POOL.rewardDuration
            )
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__TokenHasTransferFeesOrRebasing"
          );
        });

        it("should reject pools with insufficient reward rate", async function () {
          const lowRewardAmount = 10000; // Low reward amount
          const longDuration = 3600 * 100; // Long duration causes precision loss

          await expect(
            Stake.connect(owner).createPool(
              StakingToken.target,
              true,
              RewardToken.target,
              lowRewardAmount,
              0,
              longDuration
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__RewardRateTooLow");
        });

        describe("Reward Start Time Validations", function () {
          beforeEach(async function () {
            await RewardToken.connect(owner).approve(
              Stake.target,
              SIMPLE_POOL.rewardAmount
            );
          });

          it("should accept valid future rewardStartsAt within 1 week", async function () {
            const futureTime = (await time.latest()) + 24 * 60 * 60; // 1 day from now
            await expect(
              Stake.connect(owner).createPool(
                SIMPLE_POOL.stakingToken,
                true,
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                futureTime,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should revert if rewardStartsAt is more than 1 week in the future", async function () {
            const tooFarFuture = (await time.latest()) + 7 * 24 * 60 * 60 + 2; // 7 days and 2 second from now
            await expect(
              Stake.connect(owner).createPool(
                SIMPLE_POOL.stakingToken,
                true,
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                tooFarFuture,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(
              Stake,
              "Stake__InvalidRewardStartsAt"
            );
          });

          it("should accept rewardStartedAt exactly 1 week in the future", async function () {
            const exactlyOneWeek = (await time.latest()) + 7 * 24 * 60 * 60; // exactly 7 days
            await expect(
              Stake.connect(owner).createPool(
                SIMPLE_POOL.stakingToken,
                true,
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                exactlyOneWeek,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should emit PoolCreated event with rewardStartsAt", async function () {
            const futureTime = (await time.latest()) + 3600; // 1 hour from now
            const poolId = await Stake.poolCount();

            await expect(
              Stake.connect(owner).createPool(
                SIMPLE_POOL.stakingToken,
                true,
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                futureTime,
                SIMPLE_POOL.rewardDuration
              )
            )
              .to.emit(Stake, "PoolCreated")
              .withArgs(
                poolId,
                owner.address,
                SIMPLE_POOL.stakingToken,
                true,
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                futureTime,
                SIMPLE_POOL.rewardDuration
              );
          });

          it("should set rewardStartsAt in pool correctly", async function () {
            const futureTime = (await time.latest()) + 3600; // 1 hour from now
            const poolId = await Stake.poolCount();

            await Stake.connect(owner).createPool(
              SIMPLE_POOL.stakingToken,
              true,
              SIMPLE_POOL.rewardToken,
              SIMPLE_POOL.rewardAmount,
              futureTime,
              SIMPLE_POOL.rewardDuration
            );

            const pool = await Stake.pools(poolId);
            expect(pool.rewardStartsAt).to.equal(futureTime);
            expect(pool.rewardStartedAt).to.equal(0); // Not started yet until someone stakes
            expect(pool.lastRewardUpdatedAt).to.equal(0); // Not started yet until someone stakes
          });
        }); // Reward Start Time Validations
      }); // Pool Creation Validations

      describe("Token Type Validation", function () {
        let ERC1155ClaimingToBeERC20,
          WrongSupportsInterfaceReturn,
          RevertingSupportsInterface;
        let NoBalanceOf,
          WrongERC20BalanceOfSignature,
          WrongERC1155BalanceOfSignature;
        let WrongBalanceOfReturnLength,
          RevertingBalanceOf,
          GasConsumingContract,
          EmptyReturnData;

        beforeEach(async function () {
          await RewardToken.connect(owner).approve(
            Stake.target,
            SIMPLE_POOL.rewardAmount
          );

          // Deploy mock contracts for testing _isTokenTypeValid logic
          ERC1155ClaimingToBeERC20 = await ethers.deployContract(
            "ERC1155ClaimingToBeERC20"
          );
          WrongSupportsInterfaceReturn = await ethers.deployContract(
            "WrongSupportsInterfaceReturn"
          );
          RevertingSupportsInterface = await ethers.deployContract(
            "RevertingSupportsInterface"
          );
          NoBalanceOf = await ethers.deployContract("NoBalanceOf");
          WrongERC20BalanceOfSignature = await ethers.deployContract(
            "WrongERC20BalanceOfSignature"
          );
          WrongERC1155BalanceOfSignature = await ethers.deployContract(
            "WrongERC1155BalanceOfSignature"
          );
          WrongBalanceOfReturnLength = await ethers.deployContract(
            "WrongBalanceOfReturnLength"
          );
          RevertingBalanceOf = await ethers.deployContract(
            "RevertingBalanceOf"
          );
          GasConsumingContract = await ethers.deployContract(
            "GasConsumingContract"
          );
          EmptyReturnData = await ethers.deployContract("EmptyReturnData");
        });

        describe("ERC20 Validation Path", function () {
          it("should succeed with valid ERC20 tokens", async function () {
            // Existing StakingToken should work (baseline test)
            await expect(
              Stake.connect(owner).createPool(
                StakingToken.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should revert when contract claims to support ERC1155 interface", async function () {
            await expect(
              Stake.connect(owner).createPool(
                ERC1155ClaimingToBeERC20.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should succeed when supportsInterface returns wrong data format", async function () {
            await expect(
              Stake.connect(owner).createPool(
                WrongSupportsInterfaceReturn.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should succeed when supportsInterface reverts", async function () {
            await expect(
              Stake.connect(owner).createPool(
                RevertingSupportsInterface.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should revert when balanceOf doesn't exist", async function () {
            await expect(
              Stake.connect(owner).createPool(
                NoBalanceOf.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf has wrong signature", async function () {
            await expect(
              Stake.connect(owner).createPool(
                WrongERC20BalanceOfSignature.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf returns wrong data length", async function () {
            await expect(
              Stake.connect(owner).createPool(
                WrongBalanceOfReturnLength.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf reverts", async function () {
            await expect(
              Stake.connect(owner).createPool(
                RevertingBalanceOf.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf returns empty data", async function () {
            await expect(
              Stake.connect(owner).createPool(
                EmptyReturnData.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });
        });

        describe("ERC1155 Validation Path", function () {
          it("should succeed with valid ERC1155 tokens", async function () {
            const TestERC1155 = await ethers.deployContract("TestERC1155", [
              1000,
            ]);
            await expect(
              Stake.connect(owner).createPool(
                TestERC1155.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.not.be.reverted;
          });

          it("should revert when balanceOf doesn't exist", async function () {
            await expect(
              Stake.connect(owner).createPool(
                NoBalanceOf.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf has wrong signature", async function () {
            await expect(
              Stake.connect(owner).createPool(
                WrongERC1155BalanceOfSignature.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf returns wrong data length", async function () {
            await expect(
              Stake.connect(owner).createPool(
                WrongBalanceOfReturnLength.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf reverts", async function () {
            await expect(
              Stake.connect(owner).createPool(
                RevertingBalanceOf.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should revert when balanceOf returns empty data", async function () {
            await expect(
              Stake.connect(owner).createPool(
                EmptyReturnData.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });
        });

        describe("Gas Limit Protection", function () {
          it("should handle gas-consuming contracts (ERC20 mode)", async function () {
            // Gas consuming contract should fail due to gas limit in supportsInterface or balanceOf
            await expect(
              Stake.connect(owner).createPool(
                GasConsumingContract.target,
                true, // isStakingTokenERC20 = true
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });

          it("should handle gas-consuming contracts (ERC1155 mode)", async function () {
            // Gas consuming contract should fail due to gas limit in balanceOf
            await expect(
              Stake.connect(owner).createPool(
                GasConsumingContract.target,
                false, // isStakingTokenERC20 = false
                SIMPLE_POOL.rewardToken,
                SIMPLE_POOL.rewardAmount,
                0,
                SIMPLE_POOL.rewardDuration
              )
            ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenType");
          });
        });
      }); // Token Type Validation

      describe("Staking Validations", function () {
        it("should revert if stake amount is zero", async function () {
          await expect(
            Stake.connect(alice).stake(this.poolId, 0)
          ).to.be.revertedWithCustomError(Stake, "Stake__ZeroAmount");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).stake(999, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should allow pre-staking before pool start time", async function () {
          // Create a pool with start time 1 hour in the future
          const futureStartTime = (await time.latest()) + 3600; // 1 hour from now
          const poolId = await createSamplePool(owner, true, futureStartTime);

          // Should now allow staking before the start time (pre-staking)
          await expect(Stake.connect(alice).stake(poolId, wei(100))).to.not.be
            .reverted;

          // Verify stake was successful
          const userStake = await Stake.userPoolStake(alice.address, poolId);
          expect(userStake.stakedAmount).to.equal(wei(100));

          // Verify rewards are scheduled to start at futureStartTime
          const pool = await Stake.pools(poolId);
          expect(pool.rewardStartedAt).to.equal(futureStartTime);
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
          await time.setNextBlockTimestamp(endTime);

          await expect(
            Stake.connect(alice).stake(this.poolId, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolFinished");
        });

        it("should revert if attempting to stake at exact reward end time", async function () {
          // Start rewards by staking
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(bob).stake(this.poolId, wei(300));

          // Move to exact pool end time (not past it)
          const exactEndTime = stakeTime + SIMPLE_POOL.rewardDuration;
          await time.setNextBlockTimestamp(exactEndTime);

          // Should revert at exact end time due to >= boundary condition
          await expect(
            Stake.connect(alice).stake(this.poolId, wei(100))
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolFinished");
        });

        it("should allow staking one second before reward end time", async function () {
          // Start rewards by staking
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(bob).stake(this.poolId, wei(300));

          // Move to 1 seconds before pool end time
          const beforeEndTime = stakeTime + SIMPLE_POOL.rewardDuration - 1;
          await time.setNextBlockTimestamp(beforeEndTime);

          // Should allow staking one second before end time
          await expect(Stake.connect(alice).stake(this.poolId, wei(100))).to.not
            .be.reverted;

          // Verify stake was successful
          const userStake = await Stake.userPoolStake(
            alice.address,
            this.poolId
          );
          expect(userStake.stakedAmount).to.equal(wei(100));
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
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
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

        describe("Reward Start Time Integration Tests", function () {
          it("should allow staking after pool start time", async function () {
            // Create a pool with start time 1000 seconds in the future
            const futureStartTime = (await time.latest()) + 1000;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Move time to after the start time
            await time.setNextBlockTimestamp(futureStartTime + 1);

            // Should allow staking after start time
            await expect(Stake.connect(alice).stake(poolId, wei(100))).to.not.be
              .reverted;

            // Verify stake was successful
            const userStake = await Stake.userPoolStake(alice.address, poolId);
            expect(userStake.stakedAmount).to.equal(wei(100));
          });

          it("should allow staking exactly at pool start time", async function () {
            // Create a pool with start time 1000 seconds in the future
            const futureStartTime = (await time.latest()) + 1000;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Move time to exactly the start time
            await time.setNextBlockTimestamp(futureStartTime);

            // Should allow staking at exactly start time
            await expect(Stake.connect(alice).stake(poolId, wei(100))).to.not.be
              .reverted;

            // Verify stake was successful
            const userStake = await Stake.userPoolStake(alice.address, poolId);
            expect(userStake.stakedAmount).to.equal(wei(100));
          });

          it("should not start rewards until first stake even with preset start time", async function () {
            // Create a pool with start time in the past
            const pastStartTime = (await time.latest()) - 100;
            const poolId = await createSamplePool(owner, true, pastStartTime);

            // Move forward in time without any stakes
            await time.increase(50);

            // Now stake
            await Stake.connect(alice).stake(poolId, wei(100));

            // Move forward a bit more
            await time.increase(100);

            // Check claimable rewards - should only be based on time since stake, not since pastStartTime
            const [claimable] = await Stake.claimableReward(
              poolId,
              alice.address
            );
            expect(claimable).to.be.equal(wei(100)); // 100 seconds since stake
          });

          it("should handle pre-staking before scheduled reward start", async function () {
            // Create a pool with start time 1000 seconds in the future
            const futureStartTime = (await time.latest()) + 1000;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Pre-stake before the scheduled start time
            await Stake.connect(alice).stake(poolId, wei(100));

            // Verify stake worked and rewards are scheduled for future
            const pool = await Stake.pools(poolId);
            expect(pool.totalStaked).to.equal(wei(100));
            expect(pool.rewardStartedAt).to.equal(futureStartTime); // Scheduled for future
            expect(pool.rewardStartsAt).to.equal(futureStartTime);
            const [claimable] = await Stake.claimableReward(
              poolId,
              alice.address
            );
            expect(claimable).to.equal(0); // No rewards during pre-staking period
          });

          it("should start rewards after scheduled start time", async function () {
            const futureStartTime = (await time.latest()) + 1000;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Pre-stake before the scheduled start time
            await Stake.connect(alice).stake(poolId, wei(100));
            await time.increase(100); // 100 seconds after alice's stake
            await Stake.connect(bob).stake(poolId, wei(100));

            // Move forward and check rewards
            await time.increaseTo(futureStartTime + 1000);

            const [claimableAlice] = await Stake.claimableReward(
              poolId,
              alice.address
            );
            const [claimableBob] = await Stake.claimableReward(
              poolId,
              bob.address
            );

            expect(claimableAlice).to.equal(wei(500)); // 1000 seconds after reward start time, 50% of 1000 seconds
            expect(claimableBob).to.equal(wei(500)); // same as alice even though bob staked later
          });

          it("should reset reward clock if everyone unstakes before rewards start", async function () {
            // Create a pool with start time 1000 seconds in the future
            const futureStartTime = (await time.latest()) + 1000;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Alice pre-stakes
            await Stake.connect(alice).stake(poolId, wei(100));

            // Verify reward clock was set to future time
            let pool = await Stake.pools(poolId);
            expect(pool.rewardStartedAt).to.equal(futureStartTime);
            expect(pool.lastRewardUpdatedAt).to.equal(futureStartTime);
            expect(pool.totalStaked).to.equal(wei(100));

            // Alice unstakes before rewards start (everyone leaves)
            await Stake.connect(alice).unstake(poolId, wei(100));

            // Verify reward clock was reset since everyone left before rewards started
            pool = await Stake.pools(poolId);
            expect(pool.rewardStartedAt).to.equal(0); // Reset!
            expect(pool.lastRewardUpdatedAt).to.equal(0); // Reset!
            expect(pool.totalStaked).to.equal(0);

            // Bob stakes after the original scheduled start time
            await time.increase(1100); // Move past the original futureStartTime
            await Stake.connect(bob).stake(poolId, wei(200));

            // Verify rewards start immediately now (not at the original scheduled time)
            pool = await Stake.pools(poolId);
            expect(pool.rewardStartedAt).to.equal(await time.latest()); // Current time, not original schedule
            expect(pool.totalStaked).to.equal(wei(200));

            // Move forward and verify rewards work correctly
            await time.increase(100);
            const [claimable] = await Stake.claimableReward(
              poolId,
              bob.address
            );
            expect(claimable).to.be.equal(wei(100)); // 100 seconds of rewards
          });

          it("should NOT reset reward clock if someone unstakes AFTER rewards started", async function () {
            // Create a pool with start time 100 seconds in the future
            const futureStartTime = (await time.latest()) + 100;
            const poolId = await createSamplePool(owner, true, futureStartTime);

            // Alice pre-stakes
            await Stake.connect(alice).stake(poolId, wei(100));

            // Move time past the start time (rewards now active)
            await time.setNextBlockTimestamp(futureStartTime + 50);

            // Trigger pool update by staking more
            await Stake.connect(bob).stake(poolId, wei(50));

            // Now Alice unstakes after rewards have started
            await Stake.connect(alice).unstake(poolId, wei(100));
            await Stake.connect(bob).unstake(poolId, wei(50)); // Everyone leaves

            // Verify reward clock was NOT reset (rewards had already started)
            const pool = await Stake.pools(poolId);
            expect(pool.rewardStartedAt).to.not.equal(0); // Should NOT be reset
            expect(pool.totalStaked).to.equal(0);
          });
        }); // Reward Start Time Integration Tests
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

      describe("getPool", function () {
        it("should return complete pool view with token info", async function () {
          const poolView = await Stake.getPool(this.poolId);

          // Check pool data
          expect(poolView.pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
          expect(poolView.pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
          expect(poolView.pool.creator).to.equal(owner.address);
          expect(poolView.pool.rewardAmount).to.equal(SIMPLE_POOL.rewardAmount);
          expect(poolView.pool.rewardDuration).to.equal(
            SIMPLE_POOL.rewardDuration
          );

          // Check staking token info
          expect(poolView.stakingToken.symbol).to.equal("STAKE");
          expect(poolView.stakingToken.name).to.equal("Staking Token");
          expect(poolView.stakingToken.decimals).to.equal(18);

          // Check reward token info
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);
        });

        it("should handle tokens with different decimals", async function () {
          const Token6 = await ethers.deployContract("TestToken", [
            wei(1_000_000, 6),
            "6 Decimal Token",
            "6DEC",
            6n,
          ]);
          await Token6.waitForDeployment();

          await approveTokens(Token6, [owner], Stake.target);
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            Token6.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const poolView = await Stake.getPool(poolId);

          expect(poolView.stakingToken.symbol).to.equal("6DEC");
          expect(poolView.stakingToken.name).to.equal("6 Decimal Token");
          expect(poolView.stakingToken.decimals).to.equal(6);
        });

        it("should handle ERC1155 tokens (which don't have optional ERC20 methods)", async function () {
          const TestERC1155 = await ethers.deployContract("TestERC1155", [
            1_000_000n,
          ]);
          await TestERC1155.waitForDeployment();

          await TestERC1155.connect(owner).setApprovalForAll(
            Stake.target,
            true
          );
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            TestERC1155.target,
            false, // isStakingTokenERC20 = false for ERC1155
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const poolView = await Stake.getPool(poolId);

          // ERC1155 tokens don't have symbol(), name(), decimals() methods
          // Should fall back to defaults
          expect(poolView.stakingToken.symbol).to.equal("undefined");
          expect(poolView.stakingToken.name).to.equal("undefined");
          expect(poolView.stakingToken.decimals).to.equal(0);

          // Reward token should still work normally (it's ERC20)
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);
        });

        it("should handle tokens with empty string methods", async function () {
          // Create token with empty strings for name/symbol
          const tokenWithEmptyStrings = await ethers.deployContract(
            "TestToken",
            [
              wei(1_000_000),
              "", // empty name
              "", // empty symbol
              0n, // 0 decimals
            ]
          );
          await tokenWithEmptyStrings.waitForDeployment();

          await approveTokens(tokenWithEmptyStrings, [owner], Stake.target);
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            tokenWithEmptyStrings.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const poolView = await Stake.getPool(poolId);

          // Should return the actual empty strings and 0 decimals
          expect(poolView.stakingToken.symbol).to.equal("");
          expect(poolView.stakingToken.name).to.equal("");
          expect(poolView.stakingToken.decimals).to.equal(0);
        });

        it("should revert if pool does not exist", async function () {
          await expect(Stake.getPool(999)).to.be.revertedWithCustomError(
            Stake,
            "Stake__PoolNotFound"
          );
        });
      }); // getPool

      describe("getPools", function () {
        it("should return pool views in range", async function () {
          const poolViews = await Stake.getPools(0, 2);

          expect(poolViews).to.have.length(2);
          expect(poolViews[0].pool.creator).to.equal(owner.address);
          expect(poolViews[1].pool.creator).to.equal(owner.address);

          // Check that token info is included
          expect(poolViews[0].stakingToken.symbol).to.equal("STAKE");
          expect(poolViews[0].stakingToken.name).to.equal("Staking Token");
          expect(poolViews[0].stakingToken.decimals).to.equal(18);
          expect(poolViews[0].rewardToken.symbol).to.equal("REWARD");
          expect(poolViews[0].rewardToken.name).to.equal("Reward Token");
          expect(poolViews[0].rewardToken.decimals).to.equal(18);
        });

        it("should handle poolIdTo exceeding poolCount", async function () {
          const poolViews = await Stake.getPools(0, 10);

          expect(poolViews).to.have.length(3); // Only 3 pools exist
          expect(poolViews[0].pool.creator).to.equal(owner.address);
          expect(poolViews[1].pool.creator).to.equal(owner.address);
          expect(poolViews[2].pool.creator).to.equal(owner.address);
        });

        it("should return pool views with complete token information", async function () {
          const poolViews = await Stake.getPools(0, 1);

          expect(poolViews).to.have.length(1);
          const poolView = poolViews[0];

          // Verify pool data structure
          expect(poolView.pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
          expect(poolView.pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
          expect(poolView.pool.creator).to.equal(owner.address);

          // Verify token info structure
          expect(poolView.stakingToken.symbol).to.equal("STAKE");
          expect(poolView.stakingToken.name).to.equal("Staking Token");
          expect(poolView.stakingToken.decimals).to.equal(18);
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);
        });

        it("should handle pools with ERC1155 staking tokens", async function () {
          // Create ERC1155 token
          const TestERC1155 = await ethers.deployContract("TestERC1155", [
            1_000_000n,
          ]);
          await TestERC1155.waitForDeployment();

          await TestERC1155.connect(owner).setApprovalForAll(
            Stake.target,
            true
          );
          // Create pool with ERC1155 staking token
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            TestERC1155.target,
            false, // ERC1155
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const poolViews = await Stake.getPools(poolId, poolId + 1n);

          expect(poolViews).to.have.length(1);
          const poolView = poolViews[0];

          // ERC1155 should fall back to "undefined" defaults
          expect(poolView.stakingToken.symbol).to.equal("undefined");
          expect(poolView.stakingToken.name).to.equal("undefined");
          expect(poolView.stakingToken.decimals).to.equal(0);

          // Reward token (ERC20) should work normally
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);
        });

        it("should handle mixed token types in pool range", async function () {
          // Create a pool with tokens having different decimals
          const Token6 = await ethers.deployContract("TestToken", [
            wei(1_000_000, 6),
            "6 Decimal Token",
            "6DEC",
            6n,
          ]);
          await Token6.waitForDeployment();
          await approveTokens(Token6, [owner], Stake.target);

          // Create a pool with ERC1155 token
          const TestERC1155 = await ethers.deployContract("TestERC1155", [
            1_000_000n,
          ]);
          await TestERC1155.waitForDeployment();

          await TestERC1155.connect(owner).setApprovalForAll(
            Stake.target,
            true
          );
          // Create both pools
          const pool1Id = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            Token6.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const pool2Id = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            TestERC1155.target,
            false,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          // Get both pools
          const poolViews = await Stake.getPools(pool1Id, pool2Id + 1n);

          expect(poolViews).to.have.length(2);

          // First pool (ERC20 with 6 decimals)
          expect(poolViews[0].stakingToken.symbol).to.equal("6DEC");
          expect(poolViews[0].stakingToken.name).to.equal("6 Decimal Token");
          expect(poolViews[0].stakingToken.decimals).to.equal(6);

          // Second pool (ERC1155)
          expect(poolViews[1].stakingToken.symbol).to.equal("undefined");
          expect(poolViews[1].stakingToken.name).to.equal("undefined");
          expect(poolViews[1].stakingToken.decimals).to.equal(0);
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

      describe("getPoolsByCreator", function () {
        beforeEach(async function () {
          // Create additional pools with different creators for testing
          // owner creates pools 0, 1, 2 (from previous setup)

          // alice creates pool 3
          await distributeTokens(
            RewardToken,
            [alice],
            SIMPLE_POOL.rewardAmount
          );
          await approveTokens(RewardToken, [alice], Stake.target);
          this.alicePoolId = await Stake.poolCount();
          await Stake.connect(alice).createPool(
            StakingToken.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          // bob creates pools 4 and 5
          await distributeTokens(
            RewardToken,
            [bob],
            SIMPLE_POOL.rewardAmount * 2n
          );
          await approveTokens(RewardToken, [bob], Stake.target);
          this.bobPoolId1 = await Stake.poolCount();
          await Stake.connect(bob).createPool(
            StakingToken.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );
          this.bobPoolId2 = await Stake.poolCount();
          await Stake.connect(bob).createPool(
            StakingToken.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          // Total pools: 6 (0,1,2 by owner, 3 by alice, 4,5 by bob)
        });

        it("should return only pools created by owner", async function () {
          const poolViews = await Stake.getPoolsByCreator(0, 6, owner.address);

          // Owner created pools 0, 1, 2
          expect(poolViews).to.have.length(3);
          expect(poolViews[0].pool.creator).to.equal(owner.address);
          expect(poolViews[1].pool.creator).to.equal(owner.address);
          expect(poolViews[2].pool.creator).to.equal(owner.address);

          // Verify token info is included
          expect(poolViews[0].stakingToken.symbol).to.equal("STAKE");
          expect(poolViews[0].rewardToken.symbol).to.equal("REWARD");
        });

        it("should return only pools created by alice", async function () {
          const poolViews = await Stake.getPoolsByCreator(0, 6, alice.address);

          // Alice created only pool 3
          expect(poolViews).to.have.length(1);
          expect(poolViews[0].pool.creator).to.equal(alice.address);

          // Verify it's the correct pool
          const poolData = await Stake.pools(this.alicePoolId);
          expect(poolViews[0].pool.stakingToken).to.equal(
            poolData.stakingToken
          );
          expect(poolViews[0].pool.rewardToken).to.equal(poolData.rewardToken);
        });

        it("should return only pools created by bob", async function () {
          const poolViews = await Stake.getPoolsByCreator(0, 6, bob.address);

          // Bob created pools 4 and 5
          expect(poolViews).to.have.length(2);
          expect(poolViews[0].pool.creator).to.equal(bob.address);
          expect(poolViews[1].pool.creator).to.equal(bob.address);
        });

        it("should return empty array for creator with no pools", async function () {
          const poolViews = await Stake.getPoolsByCreator(0, 6, carol.address);

          expect(poolViews).to.have.length(0);
        });

        it("should handle partial ranges correctly", async function () {
          // Query only pools 3-5 (alice: 3, bob: 4,5)
          const ownerPools = await Stake.getPoolsByCreator(3, 6, owner.address);
          const alicePools = await Stake.getPoolsByCreator(3, 6, alice.address);
          const bobPools = await Stake.getPoolsByCreator(3, 6, bob.address);

          expect(ownerPools).to.have.length(0); // Owner has no pools in this range
          expect(alicePools).to.have.length(1); // Alice has pool 3
          expect(bobPools).to.have.length(2); // Bob has pools 4,5
        });

        it("should handle ranges with some matching pools", async function () {
          // Query pools 1-4 (owner: 1,2, alice: 3, bob: none in this range)
          const ownerPools = await Stake.getPoolsByCreator(1, 4, owner.address);
          const alicePools = await Stake.getPoolsByCreator(1, 4, alice.address);
          const bobPools = await Stake.getPoolsByCreator(1, 4, bob.address);

          expect(ownerPools).to.have.length(2); // Owner has pools 1,2
          expect(alicePools).to.have.length(1); // Alice has pool 3
          expect(bobPools).to.have.length(0); // Bob has no pools in this range
        });

        it("should handle single pool ranges", async function () {
          // Query only pool 3 (alice's pool)
          const alicePools = await Stake.getPoolsByCreator(3, 4, alice.address);
          const ownerPools = await Stake.getPoolsByCreator(3, 4, owner.address);

          expect(alicePools).to.have.length(1);
          expect(alicePools[0].pool.creator).to.equal(alice.address);
          expect(ownerPools).to.have.length(0);
        });

        it("should handle poolIdTo exceeding poolCount", async function () {
          const poolViews = await Stake.getPoolsByCreator(
            0,
            100,
            owner.address
          );

          // Should still return only owner's pools (0,1,2)
          expect(poolViews).to.have.length(3);
          expect(poolViews[0].pool.creator).to.equal(owner.address);
          expect(poolViews[1].pool.creator).to.equal(owner.address);
          expect(poolViews[2].pool.creator).to.equal(owner.address);
        });

        it("should return empty array if poolIdFrom >= poolCount", async function () {
          const poolViews = await Stake.getPoolsByCreator(
            10,
            20,
            owner.address
          );

          expect(poolViews).to.have.length(0);
        });

        it("should return empty array if poolIdFrom >= searchTo", async function () {
          // poolIdFrom (5) >= poolCount (6) after limiting searchTo
          const poolViews = await Stake.getPoolsByCreator(5, 10, owner.address);

          // Should return pool 5 which doesn't belong to owner
          expect(poolViews).to.have.length(0);
        });

        it("should handle edge case where range contains no pools", async function () {
          const poolViews = await Stake.getPoolsByCreator(
            100,
            200,
            owner.address
          );

          expect(poolViews).to.have.length(0);
        });

        it("should return correct pool data structure", async function () {
          const poolViews = await Stake.getPoolsByCreator(0, 1, owner.address);

          expect(poolViews).to.have.length(1);
          const poolView = poolViews[0];

          // Verify pool data structure matches what we expect
          expect(poolView.pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
          expect(poolView.pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
          expect(poolView.pool.creator).to.equal(owner.address);
          expect(poolView.pool.rewardAmount).to.equal(SIMPLE_POOL.rewardAmount);
          expect(poolView.pool.rewardDuration).to.equal(
            SIMPLE_POOL.rewardDuration
          );

          // Verify token info structure
          expect(poolView.stakingToken.symbol).to.equal("STAKE");
          expect(poolView.stakingToken.name).to.equal("Staking Token");
          expect(poolView.stakingToken.decimals).to.equal(18);
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);
        });

        it("should handle multiple creators with different token types", async function () {
          // Create a pool with different tokens for testing
          const Token6 = await ethers.deployContract("TestToken", [
            wei(1_000_000, 6),
            "6 Decimal Token",
            "6DEC",
            6n,
          ]);
          await Token6.waitForDeployment();

          await distributeTokens(Token6, [carol], wei(10000, 6));
          await approveTokens(Token6, [carol], Stake.target);
          await distributeTokens(
            RewardToken,
            [carol],
            SIMPLE_POOL.rewardAmount
          );
          await approveTokens(RewardToken, [carol], Stake.target);

          // Carol creates pool with different staking token
          await Stake.connect(carol).createPool(
            Token6.target,
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
            SIMPLE_POOL.rewardDuration
          );

          const carolPools = await Stake.getPoolsByCreator(
            0,
            10,
            carol.address
          );

          expect(carolPools).to.have.length(1);
          expect(carolPools[0].stakingToken.symbol).to.equal("6DEC");
          expect(carolPools[0].stakingToken.decimals).to.equal(6);
          expect(carolPools[0].rewardToken.symbol).to.equal("REWARD");
        });

        it("should revert if pagination parameters are invalid", async function () {
          await expect(
            Stake.getPoolsByCreator(5, 5, owner.address)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );

          await expect(
            Stake.getPoolsByCreator(0, 1001, owner.address)
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__InvalidPaginationParameters"
          );
        });

        it("should handle gas efficiently with large ranges", async function () {
          // Test that the function doesn't consume excessive gas even with max range
          const tx = await Stake.getPoolsByCreator(0, 500, owner.address);

          // Should complete without reverting (gas limit test)
          expect(tx).to.have.length(3); // Owner's 3 pools
        });

        it("should maintain correct order of pools", async function () {
          const bobPools = await Stake.getPoolsByCreator(0, 10, bob.address);

          expect(bobPools).to.have.length(2);

          // Verify pools are returned in order (pool 4 before pool 5)
          const pool4Data = await Stake.pools(this.bobPoolId1);
          const pool5Data = await Stake.pools(this.bobPoolId2);

          expect(bobPools[0].pool.stakingToken).to.equal(
            pool4Data.stakingToken
          );
          expect(bobPools[1].pool.stakingToken).to.equal(
            pool5Data.stakingToken
          );
        });
      }); // getPoolsByCreator

      describe("version", function () {
        it("should return correct version", async function () {
          const version = await Stake.version();
          expect(version).to.equal("1.1.0");
        });
      }); // version

      describe("DoS Protection", function () {
        it("should handle gas bomb tokens without reverting", async function () {
          // Deploy gas bomb token
          const GasBombToken = await ethers.getContractFactory("GasBombToken");
          const gasBombToken = await GasBombToken.deploy();
          await gasBombToken.waitForDeployment();

          // Create a reward token for the pool
          const TestToken = await ethers.getContractFactory("TestToken");
          const rewardToken = await TestToken.deploy(
            ethers.parseEther("10000"),
            "Test Reward Token",
            "TREWARD",
            18
          );
          await rewardToken.waitForDeployment();

          // Create pool with gas bomb token as staking token
          const rewardAmount = ethers.parseEther("100"); // Smaller amount
          await rewardToken.connect(owner).approve(Stake.target, rewardAmount);

          const gasBombPoolId = await Stake.poolCount();
          const createTx = await Stake.createPool(
            gasBombToken.target, // Gas bomb staking token
            true, // isStakingTokenERC20
            rewardToken.target,
            rewardAmount,
            0, // immediate start (rewardStartsAt)
            7200 // 2 hours duration (rewardDuration)
          );

          // Test getPool - should not revert despite gas bomb
          const poolView = await Stake.getPool(gasBombPoolId);

          // Gas bomb token should return fallback values (gas stipend prevents the bomb)
          expect(poolView.stakingToken.symbol).to.equal("undefined");
          expect(poolView.stakingToken.name).to.equal("undefined");
          expect(poolView.stakingToken.decimals).to.equal(0);

          // Reward token should work normally
          expect(poolView.rewardToken.symbol).to.equal("TREWARD");
          expect(poolView.rewardToken.name).to.equal("Test Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);

          // Test getPools - should not revert despite gas bomb
          const pools = await Stake.getPools(gasBombPoolId, gasBombPoolId + 1n);
          expect(pools).to.have.length(1);
          expect(pools[0].stakingToken.symbol).to.equal("undefined");
          expect(pools[0].rewardToken.symbol).to.equal("TREWARD");

          // Test getPoolsByCreator - should not revert despite gas bomb
          const creatorPools = await Stake.getPoolsByCreator(
            0,
            500, // Updated to respect MAX_ITEMS_PER_PAGE = 500
            owner.address
          );
          expect(creatorPools.length).to.be.greaterThan(0);

          const gasBombPool = creatorPools.find(
            (p) => p.pool.stakingToken === gasBombToken.target
          );
          expect(gasBombPool).to.exist;
          expect(gasBombPool.stakingToken.symbol).to.equal("undefined");
        });

        it("should handle tokens with very long names/symbols without gas issues", async function () {
          // Create very long strings (128 characters each - realistic but long)
          const longName = "A".repeat(128);
          const longSymbol = "B".repeat(128);

          // Deploy token with very long name and symbol
          const TestToken = await ethers.getContractFactory("TestToken");
          const longNameToken = await TestToken.deploy(
            ethers.parseEther("10000"), // supply
            longName,
            longSymbol,
            18 // decimals
          );
          await longNameToken.waitForDeployment();

          // Create reward token
          const rewardToken = await TestToken.deploy(
            ethers.parseEther("10000"),
            "Reward Token",
            "REWARD",
            18
          );
          await rewardToken.waitForDeployment();

          // Create pool with long name token as staking token
          const rewardAmount = ethers.parseEther("100");
          await rewardToken.connect(owner).approve(Stake.target, rewardAmount);

          const poolId = await Stake.poolCount();
          await Stake.createPool(
            longNameToken.target, // Long name staking token
            true,
            rewardToken.target,
            rewardAmount,
            0, // immediate start
            7200 // 2 hours duration
          );

          // Test that view functions work correctly with long names
          const poolView = await Stake.getPool(poolId);

          // Should return the full long name and symbol (not truncated or "undefined")
          expect(poolView.stakingToken.symbol).to.equal(longSymbol);
          expect(poolView.stakingToken.name).to.equal(longName);
          expect(poolView.stakingToken.decimals).to.equal(18);

          // Reward token should work normally too
          expect(poolView.rewardToken.symbol).to.equal("REWARD");
          expect(poolView.rewardToken.name).to.equal("Reward Token");
          expect(poolView.rewardToken.decimals).to.equal(18);

          // Test getPools also works with long names
          const pools = await Stake.getPools(poolId, poolId + 1n);
          expect(pools).to.have.length(1);
          expect(pools[0].stakingToken.symbol).to.equal(longSymbol);
          expect(pools[0].stakingToken.name).to.equal(longName);

          // Test getPoolsByCreator also works
          const creatorPools = await Stake.getPoolsByCreator(
            0,
            500,
            owner.address
          );
          const longNamePool = creatorPools.find(
            (p) => p.pool.stakingToken === longNameToken.target
          );
          expect(longNamePool).to.exist;
          expect(longNamePool.stakingToken.symbol).to.equal(longSymbol);
          expect(longNamePool.stakingToken.name).to.equal(longName);
        });
      }); // DoS Protection
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
            true,
            StakingToken.target, // Same token
            SIMPLE_POOL.rewardAmount,
            0,
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
            true,
            Token8.target,
            wei(10000, 8), // 10k reward tokens, with 8 decimals
            0,
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
            true,
            RewardToken.target,
            SIMPLE_POOL.rewardAmount,
            0,
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
          this.originalRewardBalance = await RewardToken.balanceOf(
            Stake.target
          );
          // NOTE: With totalAllocatedRewards system:
          // - totalAllocatedRewards tracks theoretical rewards allocated to users
          // - Precision loss still occurs in accRewardPerShare calculation during claiming
          // - The difference between totalAllocatedRewards and actual claimable becomes dust

          this.rewardAmount = 12340n;
          this.stakingAmount = wei(100); // 100 * 1e18 wei
          this.duration = 10000; // 10000s

          this.smallPoolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            true,
            RewardToken.target,
            this.rewardAmount,
            0,
            this.duration
          );

          await Stake.connect(alice).stake(
            this.smallPoolId,
            this.stakingAmount
          );

          // Precision behavior with higher REWARD_PRECISION (1e30):
          // After 1000s: totalAllocatedRewards = 1234, claimable/claimed = 1234 (loss: 0)
          // After 10000s: totalAllocatedRewards = 12340, claimable/claimed = 12340 (loss: 0)
        });

        it("should have zero precision loss after 1000s", async function () {
          await time.setNextBlockTimestamp((await time.latest()) + 1000);

          // Trigger pool update by claiming (which calls _updatePool)
          await Stake.connect(alice).claim(this.smallPoolId);

          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);

          // Check pool state after interaction
          const pool = await Stake.pools(this.smallPoolId);

          // Theoretical allocation: Math.mulDiv(1000, 12340, 10000) = 1234
          expect(pool.totalAllocatedRewards).to.equal(1234n);

          // With higher precision, user claims full allocated amount
          expect(claimedTotal).to.equal(1234n);

          // Remaining claimable should be 0 after claiming
          expect(claimable).to.equal(0n);
          expect(fee).to.equal(0);
          expect(feeTotal).to.equal(0);

          // Precision loss = allocated - actually claimed = 1234 - 1234 = 0
          const precisionLoss = pool.totalAllocatedRewards - claimedTotal;
          expect(precisionLoss).to.equal(0n);
        });

        it("should have zero precision loss after full duration", async function () {
          // Wait full duration
          await time.setNextBlockTimestamp(
            (await time.latest()) + this.duration
          );

          // Trigger pool update by claiming (which calls _updatePool)
          await Stake.connect(alice).claim(this.smallPoolId);

          const [claimable, fee, claimedTotal, feeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);

          // Check pool state after interaction
          const pool = await Stake.pools(this.smallPoolId);

          // Theoretical allocation for full duration: 12340
          expect(pool.totalAllocatedRewards).to.equal(12340n);

          // With higher precision, user claims full allocated amount
          expect(claimedTotal).to.equal(12340n);

          // Remaining claimable should be 0 after claiming
          expect(claimable).to.equal(0n);
          expect(fee).to.equal(0);
          expect(feeTotal).to.equal(0);

          // Precision loss = allocated - actually claimed = 0
          const precisionLoss = pool.totalAllocatedRewards - claimedTotal;
          expect(precisionLoss).to.equal(0n);

          // With higher precision, no precision loss dust remains
          const contractBalance = await RewardToken.balanceOf(Stake.target);
          const expectedDust = 0n + SIMPLE_POOL.rewardAmount; // 0 from this pool + previous pool
          expect(contractBalance).to.equal(expectedDust);
        });

        it("should handle multiple users with 1 wei precision loss", async function () {
          // After 1000s, bob stakes 300 * 1e18 wei (this will trigger _updatePool for first 1000s)
          await time.setNextBlockTimestamp((await time.latest()) + 1000);
          await Stake.connect(bob).stake(this.smallPoolId, wei(300));

          await time.setNextBlockTimestamp((await time.latest()) + 1000); // total 2000s passed

          // Trigger pool update for the second period by having someone claim
          await Stake.connect(alice).claim(this.smallPoolId);

          // Get final states after interactions
          const [aliceClaimable, aliceFee, aliceClaimedTotal, aliceFeeTotal] =
            await Stake.claimableReward(this.smallPoolId, alice.address);
          const [bobClaimable, bobFee, bobClaimedTotal, bobFeeTotal] =
            await Stake.claimableReward(this.smallPoolId, bob.address);

          // Check pool state - totalAllocatedRewards should be 2468 (1234 + 1234)
          const pool = await Stake.pools(this.smallPoolId);
          expect(pool.totalAllocatedRewards).to.equal(2468n); // 1234 + 1234 theoretical

          // Alice claimed during the first period claim: 1234 + 308 = 1542
          expect(aliceClaimedTotal).to.equal(1542n);
          expect(aliceClaimable).to.equal(0n); // Already claimed
          expect(aliceFee).to.equal(0);
          expect(aliceFeeTotal).to.equal(0);

          // Bob can claim: 925 (second period share only)
          expect(bobClaimable).to.equal(925n);
          expect(bobClaimedTotal).to.equal(0n); // Not claimed yet
          expect(bobFee).to.equal(0);
          expect(bobFeeTotal).to.equal(0);

          // Total user actual rewards: 1542 (Alice) + 925 (Bob) = 2467
          // Precision loss: 2468 - 2467 = 1
          const totalUserRewards = aliceClaimedTotal + bobClaimable;
          const precisionLoss = pool.totalAllocatedRewards - totalUserRewards;
          expect(precisionLoss).to.equal(1n);
        });

        it("should refund creator correctly with totalAllocatedRewards system", async function () {
          // Let some rewards accumulate
          await time.setNextBlockTimestamp((await time.latest()) + 5000); // Half duration

          // Trigger pool update by cancelling (which calls _updatePool)
          const creatorBalanceBefore = await RewardToken.balanceOf(
            owner.address
          );
          await Stake.connect(owner).cancelPool(this.smallPoolId);
          const creatorBalanceAfter = await RewardToken.balanceOf(
            owner.address
          );

          const poolAfter = await Stake.pools(this.smallPoolId);
          const refund = creatorBalanceAfter - creatorBalanceBefore;

          // Expected allocation for half duration: Math.mulDiv(5000, 12340, 10000) = 6170
          expect(poolAfter.totalAllocatedRewards).to.equal(6170n);

          // Expected refund = rewardAmount - totalAllocatedRewards = 12340 - 6170 = 6170
          const expectedRefund =
            this.rewardAmount - poolAfter.totalAllocatedRewards;
          expect(refund).to.equal(expectedRefund);
          expect(refund).to.equal(6170n);

          // Note: The precision loss will still occur when users claim their allocated rewards
        });

        it("should demonstrate no remaining precision loss", async function () {
          await time.setNextBlockTimestamp(
            (await time.latest()) + this.duration
          );

          // Trigger pool update by claiming (which calls _updatePool)
          await Stake.connect(alice).claim(this.smallPoolId);

          const pool = await Stake.pools(this.smallPoolId);
          const [claimable, , claimedTotal] = await Stake.claimableReward(
            this.smallPoolId,
            alice.address
          );

          // totalAllocatedRewards = 12340 (theoretical)
          // User claimable/claimed = 12340 with higher precision
          // Precision loss = 0 tokens
          expect(pool.totalAllocatedRewards).to.equal(12340n);
          expect(claimedTotal).to.equal(12340n);
          expect(claimable).to.equal(0n); // Already claimed

          const precisionLoss = pool.totalAllocatedRewards - claimedTotal;
          expect(precisionLoss).to.equal(0n);

          // Cancel pool - creator gets 0 refund because all rewards are "allocated"
          const creatorBalanceBefore = await RewardToken.balanceOf(
            owner.address
          );
          await Stake.connect(owner).cancelPool(this.smallPoolId);
          const creatorBalanceAfter = await RewardToken.balanceOf(
            owner.address
          );

          expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(0n);

          // No precision loss remains in contract
          const contractBalance = await RewardToken.balanceOf(Stake.target);
          expect(contractBalance - this.originalRewardBalance).to.be.equal(0n);
        });
      }); // Precision and Rounding Edge Cases

      describe("Boundary Conditions", function () {
        it("should handle very small stake amounts", async function () {
          // With no minimum restriction, any positive amount should work
          await expect(Stake.connect(alice).stake(this.poolId, 1)).to.not.be
            .reverted;
        });

        it("should handle maximum reward duration boundary", async function () {
          const maxDuration = await Stake.MAX_REWARD_DURATION();

          await expect(
            Stake.connect(owner).createPool(
              StakingToken.target,
              true,
              RewardToken.target,
              SIMPLE_POOL.rewardAmount,
              0,
              maxDuration
            )
          ).to.not.be.reverted;
        });
      }); // Boundary Conditions

      describe("Extreme Precision Scenarios (USDC 6 decimals, huge stake)", function () {
        beforeEach(async function () {
          // Deploy a 6-decimal USDC-like reward token
          this.USDC = await ethers.deployContract("TestToken", [
            INITIAL_TOKEN_SUPPLY,
            "USD Coin",
            "USDC",
            6n,
          ]);
          await this.USDC.waitForDeployment();

          // Approve Stake to pull rewards
          await this.USDC.connect(owner).approve(Stake.target, MAX_INT_256);

          // Create a pool with 1 USDC total rewards over minimum valid duration
          this.usdcRewardAmount = wei(1, 6); // 1 USDC in base units
          this.usdcDuration = Number(MIN_REWARD_DURATION);
          this.usdcStart = (await time.latest()) + 100; // future start time so multiple stakers begin equally
          this.usdcPoolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            true,
            this.USDC.target,
            this.usdcRewardAmount,
            this.usdcStart,
            this.usdcDuration
          );
        });

        it("should distribute full 1 USDC to a single massive staker", async function () {
          const hugeStake = wei(100_000_000_000n); // 100B tokens (18 decimals)

          // Top-up Alice to have enough balance to stake
          await StakingToken.transfer(alice.address, hugeStake);

          await Stake.connect(alice).stake(this.usdcPoolId, hugeStake);

          // Advance to the end of the reward duration (from scheduled start)
          await time.setNextBlockTimestamp(this.usdcStart + this.usdcDuration);

          // Claim rewards
          await Stake.connect(alice).claim(this.usdcPoolId);

          const [claimable, , claimedTotal] = await Stake.claimableReward(
            this.usdcPoolId,
            alice.address
          );

          const pool = await Stake.pools(this.usdcPoolId);

          // All rewards should be allocated and fully claimable by the sole staker
          expect(pool.totalAllocatedRewards).to.equal(this.usdcRewardAmount);
          expect(claimedTotal).to.equal(this.usdcRewardAmount);
          expect(claimable).to.equal(0n);

          // No dust should remain for USDC in the contract
          const contractUSDCBalance = await this.USDC.balanceOf(Stake.target);
          expect(contractUSDCBalance).to.equal(0n);
        });

        it("should split 1 USDC exactly between two massive stakers", async function () {
          const hugeStake = wei(100_000_000_000n); // 100B tokens each

          // Top-up both users
          await StakingToken.transfer(alice.address, hugeStake);
          await StakingToken.transfer(bob.address, hugeStake);

          // Both stake before rewards start (equal opportunity)
          await Stake.connect(alice).stake(this.usdcPoolId, hugeStake);
          await Stake.connect(bob).stake(this.usdcPoolId, hugeStake);

          // Jump to end of reward period
          await time.setNextBlockTimestamp(this.usdcStart + this.usdcDuration);

          // Claim for both
          await Stake.connect(alice).claim(this.usdcPoolId);
          await Stake.connect(bob).claim(this.usdcPoolId);

          const [aliceClaimable, , aliceClaimedTotal] =
            await Stake.claimableReward(this.usdcPoolId, alice.address);
          const [bobClaimable, , bobClaimedTotal] = await Stake.claimableReward(
            this.usdcPoolId,
            bob.address
          );

          // Each should receive exactly 0.5 USDC = 500,000 (USDC base units)
          expect(aliceClaimedTotal).to.equal(500000n);
          expect(bobClaimedTotal).to.equal(500000n);
          expect(aliceClaimable).to.equal(0n);
          expect(bobClaimable).to.equal(0n);

          // Pool allocated amount should match total distribution
          const pool = await Stake.pools(this.usdcPoolId);
          expect(pool.totalAllocatedRewards).to.equal(this.usdcRewardAmount);

          // No USDC dust remains after both claims
          const contractUSDCBalance = await this.USDC.balanceOf(Stake.target);
          expect(contractUSDCBalance).to.equal(0n);
        });

        describe("Tiny rewards progression with minimum viable reward rate", function () {
          it("should miss 1 wei USDC until accRewardPerShare set to 1 eventually", async function () {
            // Create a new pool with 1 USDC rewards over 1,000,000 seconds (1 micro / sec)
            const DURATION_SECONDS = 1_000_000;
            const rewardAmount = wei(1, 6); // 1 USDC
            const startAt = (await time.latest()) + 100; // future start
            const poolId = await Stake.poolCount();
            await Stake.connect(owner).createPool(
              StakingToken.target,
              true,
              this.USDC.target,
              rewardAmount,
              startAt,
              DURATION_SECONDS
            );

            // Single massive staker with 100B tokens
            const hugeStake = wei(4_000_000_000_000n); // 4000B
            await StakingToken.transfer(alice.address, hugeStake);
            await Stake.connect(alice).stake(poolId, hugeStake);

            // 1s after start -> 1 micro allocated, but accRewardPerShare remains 0 due to precision
            await time.setNextBlockTimestamp(startAt + 1);
            const aliceBalBefore1 = await this.USDC.balanceOf(alice.address);
            await Stake.connect(alice).claim(poolId);
            let pool = await Stake.pools(poolId);
            expect(pool.totalAllocatedRewards).to.equal(1n);
            expect(pool.accRewardPerShare).to.equal(0n);
            expect(pool.lastRewardUpdatedAt).to.equal(startAt + 1);
            const aliceBalAfter1 = await this.USDC.balanceOf(alice.address);
            expect(aliceBalAfter1 - aliceBalBefore1).to.equal(0n);

            // 2s after start -> total 2 micro allocated, still accRewardPerShare = 0
            await time.setNextBlockTimestamp(startAt + 2);
            await Stake.connect(alice).claim(poolId);
            pool = await Stake.pools(poolId);
            expect(pool.totalAllocatedRewards).to.equal(2n);
            expect(pool.accRewardPerShare).to.equal(0n);
            expect(pool.lastRewardUpdatedAt).to.equal(startAt + 2);

            // 4s after start -> total 2 + 4 micro allocated, accRewardPerShare finally becomes 1n
            await time.setNextBlockTimestamp(startAt + 6);
            await Stake.connect(alice).claim(poolId);
            pool = await Stake.pools(poolId);
            expect(pool.totalAllocatedRewards).to.equal(6n);
            expect(pool.accRewardPerShare).to.equal(1n);
            expect(pool.lastRewardUpdatedAt).to.equal(startAt + 6);

            const aliceBalAfter2 = await this.USDC.balanceOf(alice.address);
            expect(aliceBalAfter2 - aliceBalBefore1).to.equal(4n);

            // NOTE: We have lost 2 micro USDC due to precision loss
            // Even with 1e30 precision, reward loss can happen with huge staking amounts
          });
        });
      }); // Extreme Precision Scenarios

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

      describe("Overflow Edge Cases", function () {
        it("should handle worst-case reward calculations without overflowing and enforce stake amount limits", async function () {
          // Create pool with maximum reward amount
          const maxRewardAmount = 2n ** 104n - 1n; // type(uint104).max
          const LargeRewardToken = await ethers.deployContract("TestToken", [
            maxRewardAmount,
            "Large Reward Token",
            "LARGE",
            18n,
          ]);
          await LargeRewardToken.waitForDeployment();
          await LargeRewardToken.connect(owner).approve(
            Stake.target,
            maxRewardAmount
          );

          // Create pool with maximum reward amount
          const poolId = await Stake.poolCount();
          await Stake.connect(owner).createPool(
            StakingToken.target,
            true,
            LargeRewardToken.target,
            maxRewardAmount,
            0,
            MIN_REWARD_DURATION
          );

          // Step 1: First user stakes minimum amount (1 token)
          await Stake.connect(alice).stake(poolId, 1n);

          // Step 2: Wait for full reward duration to maximize accRewardPerShare
          await time.increase(MIN_REWARD_DURATION - 10n);

          // At this point, accRewardPerShare ≈ (maxRewardAmount * 10^18) / 1
          // This should be around type(uint104).max * 10^18

          // Step 3: Second user tries to stake maximum amount
          const maxStakeAmount = 2n ** 104n - 1n; // type(uint104).max
          await distributeTokens(StakingToken, [bob], maxStakeAmount * 2n);

          // This should cause overflow when calculating reward debt:
          // rewardDebt = (stakedAmount * accRewardPerShare) / REWARD_PRECISION
          // = (type(uint104).max * type(uint104).max * 10^18) / 10^18
          // = type(uint104).max * type(uint104).max
          // ≈ 4.12 × 10^80 which exceeds uint256.max (≈ 1.15 × 10^77)

          await expect(Stake.connect(bob).stake(poolId, maxStakeAmount - 1n)).to
            .not.be.reverted;

          await expect(Stake.connect(bob).stake(poolId, 1n)).to.not.be.reverted; // still within the limit

          await expect(
            Stake.connect(bob).stake(poolId, 1n)
          ).to.be.revertedWithCustomError(Stake, "Stake__StakeAmountTooLarge");
        });
      }); // Overflow Edge Cases
    }); // Edge Cases
  }); // Stake Operations

  describe("ERC1155 Staking", function () {
    beforeEach(async function () {
      const TestMultiToken = await ethers.deployContract("TestMultiToken", [
        1_000_000n, // 1M tokens
      ]);
      await TestMultiToken.waitForDeployment();

      this.initialBalance = 10_000n;

      // Distribute and approve ERC1155 tokens for alice, bob, and owner
      await TestMultiToken.connect(owner).safeTransferFrom(
        owner.address,
        alice.address,
        0,
        this.initialBalance,
        "0x"
      );
      await TestMultiToken.connect(owner).safeTransferFrom(
        owner.address,
        bob.address,
        0,
        this.initialBalance,
        "0x"
      );
      await TestMultiToken.connect(owner).setApprovalForAll(Stake.target, true);
      await TestMultiToken.connect(alice).setApprovalForAll(Stake.target, true);
      await TestMultiToken.connect(bob).setApprovalForAll(Stake.target, true);

      this.poolId = await Stake.poolCount();
      await Stake.connect(owner).createPool(
        TestMultiToken.target,
        false, // isStakingTokenERC20 = false for ERC1155
        RewardToken.target,
        SIMPLE_POOL.rewardAmount,
        0,
        SIMPLE_POOL.rewardDuration
      );

      this.pool = await Stake.pools(this.poolId);
      this.TestMultiToken = TestMultiToken;
    });

    it("should create pool correctly", async function () {
      expect(this.pool.stakingToken).to.equal(this.TestMultiToken.target);
      expect(this.pool.isStakingTokenERC20).to.equal(false);
      expect(this.pool.rewardToken).to.equal(RewardToken.target);
    });

    describe("Basic Staking Operations", function () {
      it("should stake ERC1155 tokens correctly", async function () {
        const stakeAmount = 1000n;
        await Stake.connect(alice).stake(this.poolId, stakeAmount);

        // Verify staking worked
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(stakeAmount);
        expect(await this.TestMultiToken.balanceOf(Stake.target, 0)).to.equal(
          stakeAmount
        );
        expect(await this.TestMultiToken.balanceOf(alice.address, 0)).to.equal(
          this.initialBalance - stakeAmount
        );

        // Pool state should be updated
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(stakeAmount);
        expect(pool.activeStakerCount).to.equal(1);
        expect(pool.rewardStartedAt).to.equal(await time.latest());
      });

      it("should handle multiple stakes by same user", async function () {
        const firstStake = 1000n;
        const secondStake = 2000n;

        await Stake.connect(alice).stake(this.poolId, firstStake);

        // Move time forward and stake again
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(alice).stake(this.poolId, secondStake);

        // Verify total staked amount
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(firstStake + secondStake);
        expect(await this.TestMultiToken.balanceOf(Stake.target, 0)).to.equal(
          firstStake + secondStake
        );
        expect(await this.TestMultiToken.balanceOf(alice.address, 0)).to.equal(
          this.initialBalance - (firstStake + secondStake)
        );

        // Active staker count should still be 1
        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should handle multiple users staking ERC1155 tokens", async function () {
        const aliceStake = 1000n;
        const bobStake = 2000n;

        await Stake.connect(alice).stake(this.poolId, aliceStake);
        await time.setNextBlockTimestamp((await time.latest()) + 1);
        await Stake.connect(bob).stake(this.poolId, bobStake);

        // Verify both users' stakes
        const aliceUserStake = await Stake.userPoolStake(
          alice.address,
          this.poolId
        );
        const bobUserStake = await Stake.userPoolStake(
          bob.address,
          this.poolId
        );
        expect(aliceUserStake.stakedAmount).to.equal(aliceStake);
        expect(bobUserStake.stakedAmount).to.equal(bobStake);

        // Contract should have both stakes
        expect(await this.TestMultiToken.balanceOf(Stake.target, 0)).to.equal(
          aliceStake + bobStake
        );

        // Pool state should reflect both stakers
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(aliceStake + bobStake);
        expect(pool.activeStakerCount).to.equal(2);
      });
    });

    describe("Reward Operations", function () {
      beforeEach(async function () {
        await Stake.connect(alice).stake(this.poolId, 1000n);
      });

      it("should calculate rewards correctly for ERC1155 staking", async function () {
        // Move time forward to earn rewards
        await time.increase(1000);

        // Check claimable rewards
        const [claimable, fee, claimedTotal, feeTotal] =
          await Stake.claimableReward(this.poolId, alice.address);

        expect(claimable).to.equal(wei(1000)); // 1000 seconds * 1 token/second
      });

      it("should claim rewards correctly", async function () {
        // Move time forward to earn rewards
        await time.setNextBlockTimestamp((await time.latest()) + 1000);

        // Claim rewards
        const initialRewardBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(this.poolId);
        const finalRewardBalance = await RewardToken.balanceOf(alice.address);

        expect(finalRewardBalance - initialRewardBalance).to.equal(wei(1000));

        // Verify claimed total is updated
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.claimedTotal).to.equal(wei(1000));
      });

      it("should handle proportional rewards with multiple ERC1155 stakers", async function () {
        // Bob stakes 3x more than Alice after 1000s
        await time.setNextBlockTimestamp((await time.latest()) + 1000);
        await Stake.connect(bob).stake(this.poolId, 3000n);

        // Move time forward
        await time.increase(1000);

        // Check proportional rewards
        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );

        // Alice: 1000 (alone) + 1000 * 1/4 = 1250
        // Bob: 1000 * 3/4 = 750
        expect(aliceClaimable).to.equal(wei(1250));
        expect(bobClaimable).to.equal(wei(750));
      });
    }); // Reward Operations

    describe("Unstaking Operations", function () {
      beforeEach(async function () {
        this.stakedAmount = 1000n;
        await Stake.connect(alice).stake(this.poolId, this.stakedAmount);
      });

      it("should unstake ERC1155 tokens correctly", async function () {
        const unstakeAmount = 500n;
        await Stake.connect(alice).unstake(this.poolId, unstakeAmount);

        // Verify unstaking worked
        const userStakeAfter = await Stake.userPoolStake(
          alice.address,
          this.poolId
        );
        expect(userStakeAfter.stakedAmount).to.equal(
          this.stakedAmount - unstakeAmount
        );
        expect(await this.TestMultiToken.balanceOf(Stake.target, 0)).to.equal(
          this.stakedAmount - unstakeAmount
        );
        expect(await this.TestMultiToken.balanceOf(alice.address, 0)).to.equal(
          this.initialBalance - (this.stakedAmount - unstakeAmount)
        );

        // Pool state should be updated
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(this.stakedAmount - unstakeAmount);
        expect(pool.activeStakerCount).to.equal(1); // Still active since partial unstake
      });

      it("should fully unstake ERC1155 tokens", async function () {
        await Stake.connect(alice).unstake(this.poolId, this.stakedAmount);

        // Verify full unstaking worked
        const userStakeAfter = await Stake.userPoolStake(
          alice.address,
          this.poolId
        );
        expect(userStakeAfter.stakedAmount).to.equal(0);
        expect(await this.TestMultiToken.balanceOf(Stake.target, 0)).to.equal(
          0
        );
        expect(await this.TestMultiToken.balanceOf(alice.address, 0)).to.equal(
          this.initialBalance
        );

        // Pool state should reflect no active stakers
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(0);
        expect(pool.activeStakerCount).to.equal(0);
      });

      it("should auto-claim rewards on unstaking", async function () {
        // Move time forward to earn rewards
        await time.setNextBlockTimestamp((await time.latest()) + 1000);

        // Unstake should auto-claim rewards
        const initialRewardBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).unstake(this.poolId, 500n);
        const finalRewardBalance = await RewardToken.balanceOf(alice.address);

        expect(finalRewardBalance - initialRewardBalance).to.equal(wei(1000));

        // Verify claimed total is updated
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.claimedTotal).to.equal(wei(1000));
      });
    }); // Unstaking Operations

    describe("Validations", function () {
      it("should revert if insufficient ERC1155 balance", async function () {
        // Try to stake more than balance
        await expect(
          Stake.connect(alice).stake(this.poolId, this.initialBalance * 2n)
        ).to.be.revertedWithCustomError(
          this.TestMultiToken,
          "ERC1155InsufficientBalance"
        );
      });

      it("should revert if insufficient staked amount for unstaking", async function () {
        await Stake.connect(alice).stake(this.poolId, 1000n);

        await expect(
          Stake.connect(alice).unstake(this.poolId, 1001n)
        ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
      });

      it("should revert with InvalidTokenId when trying to send ERC1155 with non-zero token ID", async function () {
        await this.TestMultiToken.connect(owner).safeTransferFrom(
          owner.address,
          alice.address,
          1,
          1n,
          "0x"
        );

        // Try to send ERC1155 token with ID 1 to the Stake contract
        await expect(
          this.TestMultiToken.connect(alice).safeTransferFrom(
            alice.address,
            Stake.target,
            1, // Invalid token ID (should be 0)
            1n,
            "0x"
          )
        ).to.be.revertedWithCustomError(Stake, "Stake__InvalidTokenId");
      });
    }); // Validations
  }); // ERC1155 Staking

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

      it("should allow setting creation fee to maximum (1 ETH)", async function () {
        const maxFee = 10n ** 18n;
        await expect(Stake.connect(owner).updateCreationFee(maxFee))
          .to.emit(Stake, "CreationFeeUpdated")
          .withArgs(0, maxFee);

        expect(await Stake.creationFee()).to.equal(maxFee);
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
          true,
          RewardToken.target,
          SIMPLE_POOL.rewardAmount,
          0,
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
        true,
        RewardToken.target,
        SIMPLE_POOL.rewardAmount,
        0,
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
          true,
          RewardToken.target,
          SIMPLE_POOL.rewardAmount,
          0,
          SIMPLE_POOL.rewardDuration,
          { value: 0 }
        )
      ).to.not.be.reverted;
    });
  }); // Creation Fee
}); // Stake
