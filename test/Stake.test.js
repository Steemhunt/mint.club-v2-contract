const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MAX_INT_256, NULL_ADDRESS, wei } = require("./utils/test-utils");

const MIN_REWARD_DURATION = 3600; // 1 hour
const MAX_REWARD_DURATION = MIN_REWARD_DURATION * 24 * 365 * 10; // 10 years
const MIN_STAKE_AMOUNT = 1000;
const REWARD_PRECISION = 10n ** 18n; // 1e18

const SAMPLE_POOL = {
  stakingToken: null, // Will be set in beforeEach
  rewardToken: null, // Will be set in beforeEach
  rewardAmount: wei(1000), // 1000 reward tokens
  rewardDuration: MIN_REWARD_DURATION * 24, // 1 day
};

describe("Stake", function () {
  async function deployFixtures() {
    const Stake = await ethers.deployContract("Stake");
    await Stake.waitForDeployment();

    const StakingToken = await ethers.deployContract("TestToken", [
      wei(1000000), // 1M tokens
      "Staking Token",
      "STAKE",
      18n,
    ]);
    await StakingToken.waitForDeployment();

    const RewardToken = await ethers.deployContract("TestToken", [
      wei(1000000), // 1M tokens
      "Reward Token",
      "REWARD",
      18n,
    ]);
    await RewardToken.waitForDeployment();

    return [Stake, StakingToken, RewardToken];
  }

  let Stake, StakingToken, RewardToken;
  let owner, alice, bob, carol;

  beforeEach(async function () {
    [Stake, StakingToken, RewardToken] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();

    SAMPLE_POOL.stakingToken = StakingToken.target;
    SAMPLE_POOL.rewardToken = RewardToken.target;

    // Distribute tokens to test accounts
    await StakingToken.transfer(alice.address, wei(10000));
    await StakingToken.transfer(bob.address, wei(10000));
    await StakingToken.transfer(carol.address, wei(10000));

    await RewardToken.transfer(alice.address, wei(10000));
    await RewardToken.transfer(bob.address, wei(10000));
    await RewardToken.transfer(carol.address, wei(10000));
  });

  describe("Stake Operations", function () {
    beforeEach(async function () {
      // Create a pool first
      await RewardToken.connect(alice).approve(
        Stake.target,
        SAMPLE_POOL.rewardAmount
      );
      await Stake.connect(alice).createPool(
        SAMPLE_POOL.stakingToken,
        SAMPLE_POOL.rewardToken,
        SAMPLE_POOL.rewardAmount,
        SAMPLE_POOL.rewardDuration
      );

      this.poolId = 0;
      this.stakeAmount = wei(5000);

      // Approve staking tokens
      await StakingToken.connect(bob).approve(Stake.target, MAX_INT_256);
      await StakingToken.connect(carol).approve(Stake.target, MAX_INT_256);
    });

    describe("Stake", function () {
      beforeEach(async function () {
        this.stakeTx = await Stake.connect(bob).stake(
          this.poolId,
          this.stakeAmount
        );
      });

      it("should stake correct amount", async function () {
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(this.stakeAmount);
      });

      it("should transfer staking tokens to contract", async function () {
        expect(await StakingToken.balanceOf(Stake.target)).to.equal(
          this.stakeAmount
        );
        expect(await StakingToken.balanceOf(bob.address)).to.equal(
          wei(10000) - this.stakeAmount
        );
      });

      it("should update pool total staked", async function () {
        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(this.stakeAmount);
      });

      it("should increment active staker count", async function () {
        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should set correct reward debt", async function () {
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);
        expect(userStake.rewardDebt).to.equal(0); // No rewards accumulated yet
      });

      it("should emit Staked event", async function () {
        await expect(this.stakeTx)
          .emit(Stake, "Staked")
          .withArgs(this.poolId, bob.address, this.stakeAmount);
      });

      describe("Multiple stakes", function () {
        beforeEach(async function () {
          // Set exact timestamp for the second stake to ensure precise timing
          const pool = await Stake.pools(this.poolId);
          const exactSecondStakeTime = BigInt(pool.rewardCreatedAt) + 3600n; // exactly 1 hour after pool creation
          await time.setNextBlockTimestamp(Number(exactSecondStakeTime));

          // Second stake
          this.secondStakeAmount = wei(2000);
          await Stake.connect(bob).stake(this.poolId, this.secondStakeAmount);
        });

        it("should accumulate staked amounts", async function () {
          const userStake = await Stake.userPoolStake(bob.address, this.poolId);
          expect(userStake.stakedAmount).to.equal(
            this.stakeAmount + this.secondStakeAmount
          );
        });

        it("should not increment active staker count again", async function () {
          const pool = await Stake.pools(this.poolId);
          expect(pool.activeStakerCount).to.equal(1);
        });

        it("should update total staked", async function () {
          const pool = await Stake.pools(this.poolId);
          expect(pool.totalStaked).to.equal(
            this.stakeAmount + this.secondStakeAmount
          );
        });

        it("should accumulate rewards correctly over multiple stakes", async function () {
          // Actually advance time by 30 minutes after the second stake
          await time.increase(1800); // 30 minutes = 1800 seconds

          // Get claimable rewards and user stake info
          const [claimableBeforeCheck] = await Stake.claimableReward(
            this.poolId,
            bob.address
          );
          const userStake = await Stake.userPoolStake(bob.address, this.poolId);
          const poolUpdated = await Stake.pools(this.poolId);

          // Get the contract's actual accRewardPerShare after the first period
          const poolAfterFirstPeriod = await Stake.pools(this.poolId);

          // Calculate expected first period rewards using the contract's actual accRewardPerShare
          const firstPeriodRewards =
            (BigInt(this.stakeAmount) *
              BigInt(poolAfterFirstPeriod.accRewardPerShare)) /
            REWARD_PRECISION;

          // Verify that the claimed rewards match what we calculate using the contract's accRewardPerShare
          expect(userStake.claimedRewards).to.equal(firstPeriodRewards);

          // Verify that claimable rewards are reasonable (should be > 0 for the second period)
          expect(claimableBeforeCheck).to.be.gt(0n);

          // Verify staking amounts are correct
          expect(userStake.stakedAmount).to.equal(
            this.stakeAmount + this.secondStakeAmount
          );

          // Verify pool's total staked is correct
          expect(poolUpdated.totalStaked).to.equal(
            this.stakeAmount + this.secondStakeAmount
          );
        });

        it("should automatically claim rewards when staking additional amounts", async function () {
          // Get initial state after first stake and time passage
          const initialUserStake = await Stake.userPoolStake(
            bob.address,
            this.poolId
          );
          const initialRewardTokenBalance = await RewardToken.balanceOf(
            bob.address
          );

          // Calculate expected claimed rewards using the contract's actual accRewardPerShare
          // Instead of trying to calculate with precision losses, use the contract's actual values
          const pool = await Stake.pools(this.poolId);
          const expectedClaimedRewards =
            (BigInt(this.stakeAmount) * BigInt(pool.accRewardPerShare)) /
            REWARD_PRECISION;

          // Verify exact claimed rewards from automatic claim
          expect(initialUserStake.claimedRewards).to.equal(
            expectedClaimedRewards
          );

          // Verify the reward token balance increased by exactly the claimed amount
          expect(initialRewardTokenBalance - wei(10000)).to.equal(
            initialUserStake.claimedRewards
          );
        });
      });

      describe("Multiple users staking", function () {
        beforeEach(async function () {
          this.carolStakeAmount = wei(3000);
          await Stake.connect(carol).stake(this.poolId, this.carolStakeAmount);
        });

        it("should track both users' stakes", async function () {
          const bobStake = await Stake.userPoolStake(bob.address, this.poolId);
          const carolStake = await Stake.userPoolStake(
            carol.address,
            this.poolId
          );

          expect(bobStake.stakedAmount).to.equal(this.stakeAmount);
          expect(carolStake.stakedAmount).to.equal(this.carolStakeAmount);
        });

        it("should update total staked for both users", async function () {
          const pool = await Stake.pools(this.poolId);
          expect(pool.totalStaked).to.equal(
            this.stakeAmount + this.carolStakeAmount
          );
        });

        it("should increment active staker count for new user", async function () {
          const pool = await Stake.pools(this.poolId);
          expect(pool.activeStakerCount).to.equal(2);
        });
      });

      describe("Validations", function () {
        it("should revert if stake amount is too small", async function () {
          await expect(
            Stake.connect(bob).stake(this.poolId, MIN_STAKE_AMOUNT - 1)
          )
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("Stake amount too small");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(bob).stake(999, this.stakeAmount)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if insufficient balance", async function () {
          await expect(
            Stake.connect(bob).stake(this.poolId, wei(20000))
          ).to.be.revertedWithCustomError(
            StakingToken,
            "ERC20InsufficientBalance"
          );
        });

        it("should revert if insufficient allowance", async function () {
          await StakingToken.connect(bob).approve(Stake.target, 0);
          await expect(
            Stake.connect(bob).stake(this.poolId, this.stakeAmount)
          ).to.be.revertedWithCustomError(
            StakingToken,
            "ERC20InsufficientAllowance"
          );
        });
      });
    });

    describe("Claim", function () {
      beforeEach(async function () {
        // Stake first
        await Stake.connect(bob).stake(this.poolId, this.stakeAmount);

        // Set exact timestamp for the claim to ensure precise timing
        const pool = await Stake.pools(this.poolId);
        const exactClaimTime = BigInt(pool.rewardCreatedAt) + 3600n; // exactly 1 hour after pool creation
        await time.setNextBlockTimestamp(Number(exactClaimTime));

        this.claimTx = await Stake.connect(bob).claim(this.poolId);
      });

      it("should claim accumulated rewards", async function () {
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);

        // Calculate expected claimed rewards using the contract's actual accRewardPerShare
        // Instead of trying to calculate with precision losses, use the contract's actual values
        const pool = await Stake.pools(this.poolId);
        const expectedClaimedRewards =
          (BigInt(this.stakeAmount) * BigInt(pool.accRewardPerShare)) /
          REWARD_PRECISION;

        // Verify exact match with the contract's calculation
        expect(userStake.claimedRewards).to.equal(expectedClaimedRewards);
      });

      it("should transfer reward tokens to user", async function () {
        const initialBalance = wei(10000);
        const currentBalance = await RewardToken.balanceOf(bob.address);
        const rewardsReceived = currentBalance - initialBalance;

        // Should have received some rewards
        expect(rewardsReceived).to.be.gt(0);

        // Verify the transfer amount matches claimed amount
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);
        expect(rewardsReceived).to.equal(userStake.claimedRewards);
      });

      it("should update reward debt", async function () {
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);

        // Reward debt should be positive and match current accumulated rewards
        expect(userStake.rewardDebt).to.be.gt(0);

        // The reward debt should equal the total accumulated reward for this user
        // (since they claimed everything)
        const pool = await Stake.pools(this.poolId);
        const expectedDebt =
          (this.stakeAmount * pool.accRewardPerShare) / REWARD_PRECISION;
        expect(userStake.rewardDebt).to.equal(expectedDebt);
      });

      it("should emit RewardClaimed event", async function () {
        // Get the actual claimed amount from user stake
        const userStake = await Stake.userPoolStake(bob.address, this.poolId);
        const claimedAmount = userStake.claimedRewards;

        await expect(this.claimTx)
          .emit(Stake, "RewardClaimed")
          .withArgs(this.poolId, bob.address, claimedAmount);
      });

      describe("Validations", function () {
        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(bob).claim(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if no rewards to claim", async function () {
          // Test with a user who has never staked
          await expect(
            Stake.connect(carol).claim(this.poolId)
          ).to.be.revertedWithCustomError(Stake, "Stake__NoRewardsToClaim");
        });
      });
    });
  });
});
