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

const SIMPLE_STAKES = {
  alice: wei(100), // 100 tokens
  bob: wei(300), // 300 tokens
  carol: wei(100), // 100 tokens
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
    await distributeTokens(
      RewardToken,
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
      it("should stake correct amount", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(SIMPLE_STAKES.alice);
      });

      it("should transfer staking tokens to contract", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        expect(await StakingToken.balanceOf(Stake.target)).to.equal(
          SIMPLE_STAKES.alice
        );
        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          INITIAL_USER_BALANCE - SIMPLE_STAKES.alice
        );
      });

      it("should update pool total staked", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(SIMPLE_STAKES.alice);
      });

      it("should increment active staker count", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should set rewardStartedAt when first stake happens", async function () {
        const stakeTx = await Stake.connect(alice).stake(
          this.poolId,
          SIMPLE_STAKES.alice
        );
        const stakeTime = await time.latest();

        const pool = await Stake.pools(this.poolId);
        expect(pool.rewardStartedAt).to.equal(stakeTime);
      });

      it("should emit Staked event", async function () {
        await expect(
          Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice)
        )
          .emit(Stake, "Staked")
          .withArgs(this.poolId, alice.address, SIMPLE_STAKES.alice);
      });
    });

    describe("Reward Calculation Scenarios", function () {
      it("should have 0 claimable rewards immediately after staking", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Immediately after staking, Alice's claimable reward should be 0
        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(0);
      });

      it("should calculate rewards correctly for single staker", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Check rewards exactly 1000s after Alice stakes
        await time.increaseTo(aliceStakeTime + 1000);
        const [claimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        expect(claimable).to.equal(wei(1000));
      });

      it("should calculate rewards correctly when second staker joins", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Bob stakes exactly 1000s after Alice
        const bobStakeTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(bobStakeTime);
        await Stake.connect(bob).stake(this.poolId, SIMPLE_STAKES.bob);

        // Check rewards at the exact moment Bob stakes
        const [aliceClaimable] = await Stake.claimableReward(
          this.poolId,
          alice.address
        );
        const [bobClaimable] = await Stake.claimableReward(
          this.poolId,
          bob.address
        );

        expect(aliceClaimable).to.equal(wei(1000)); // Alice was alone for exactly 1000s
        expect(bobClaimable).to.equal(0); // Bob just staked
      });

      it("should calculate proportional rewards correctly", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Bob stakes exactly 1000s after Alice
        const bobStakeTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(bobStakeTime);
        await Stake.connect(bob).stake(this.poolId, SIMPLE_STAKES.bob);

        // Check rewards exactly 1000s after Bob stakes
        // - Alice was alone for 1000s: earned 1000 tokens
        // - Both staked for 1000s: Alice earned 1000 * 100/400 = 250, Bob earned 1000 * 300/400 = 750
        // - Alice total: 1000 + 250 = 1250, Bob total: 750
        await time.increaseTo(bobStakeTime + 1000);

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
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Bob stakes exactly 1000s after Alice
        const bobStakeTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(bobStakeTime);
        await Stake.connect(bob).stake(this.poolId, SIMPLE_STAKES.bob);

        // Carol stakes exactly 1000s after Bob
        const carolStakeTime = bobStakeTime + 1000;
        await time.setNextBlockTimestamp(carolStakeTime);
        await Stake.connect(carol).stake(this.poolId, SIMPLE_STAKES.carol);

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
    });

    describe("Claim Operations", function () {
      it("should claim rewards correctly", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Alice claims exactly 1000s after staking
        const claimTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(claimTime);
        const initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(this.poolId);
        const finalBalance = await RewardToken.balanceOf(alice.address);

        expect(finalBalance - initialBalance).to.equal(wei(1000));
      });

      it("should update claimed rewards correctly", async function () {
        // Alice stakes at a specific time
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Alice claims exactly 1000s after staking
        const claimTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(claimTime);
        await Stake.connect(alice).claim(this.poolId);

        // Check that claimedRewards is updated
        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.claimedRewards).to.equal(wei(1000));
      });
    });

    describe("Unstaking Operations", function () {
      it("should unstake correct amount", async function () {
        // Alice stakes first
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Partial unstake
        const unstakeAmount = wei(50);
        await Stake.connect(alice).unstake(this.poolId, unstakeAmount);

        const userStake = await Stake.userPoolStake(alice.address, this.poolId);
        expect(userStake.stakedAmount).to.equal(
          SIMPLE_STAKES.alice - unstakeAmount
        );
      });

      it("should transfer tokens back to user", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const initialBalance = await StakingToken.balanceOf(alice.address);
        const unstakeAmount = wei(50);
        await Stake.connect(alice).unstake(this.poolId, unstakeAmount);

        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          initialBalance + unstakeAmount
        );
      });

      it("should update pool total staked", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const unstakeAmount = wei(50);
        await Stake.connect(alice).unstake(this.poolId, unstakeAmount);

        const pool = await Stake.pools(this.poolId);
        expect(pool.totalStaked).to.equal(SIMPLE_STAKES.alice - unstakeAmount);
      });

      it("should claim rewards before unstaking", async function () {
        // Alice stakes
        const aliceStakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(aliceStakeTime);
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Wait and unstake - should automatically claim rewards
        const unstakeTime = aliceStakeTime + 1000;
        await time.setNextBlockTimestamp(unstakeTime);

        const initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).unstake(this.poolId, wei(50));
        const finalBalance = await RewardToken.balanceOf(alice.address);

        expect(finalBalance - initialBalance).to.equal(wei(1000));
      });

      it("should decrement active staker count when fully unstaked", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Full unstake
        await Stake.connect(alice).unstake(this.poolId, SIMPLE_STAKES.alice);

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(0);
      });

      it("should not decrement active staker count when partially unstaked", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        // Partial unstake
        await Stake.connect(alice).unstake(this.poolId, wei(50));

        const pool = await Stake.pools(this.poolId);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should emit Unstaked event", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const unstakeAmount = wei(50);
        await expect(Stake.connect(alice).unstake(this.poolId, unstakeAmount))
          .emit(Stake, "Unstaked")
          .withArgs(this.poolId, alice.address, unstakeAmount);
      });
    });

    describe("Pool Management", function () {
      it("should create pool with correct parameters", async function () {
        // Create a fresh pool for this test
        const poolId = await createSamplePool();
        const pool = await Stake.pools(poolId);

        expect(pool.stakingToken).to.equal(SIMPLE_POOL.stakingToken);
        expect(pool.rewardToken).to.equal(SIMPLE_POOL.rewardToken);
        expect(pool.creator).to.equal(owner.address);
        expect(pool.rewardAmount).to.equal(SIMPLE_POOL.rewardAmount);
        expect(pool.rewardDuration).to.equal(SIMPLE_POOL.rewardDuration);
        expect(pool.rewardStartedAt).to.equal(0);
        expect(pool.cancelledAt).to.equal(0);
        expect(pool.totalStaked).to.equal(0);
        expect(pool.activeStakerCount).to.equal(0);
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
        // Create a fresh pool for this test
        const poolId = await createSamplePool();

        const initialBalance = await RewardToken.balanceOf(owner.address);
        await expect(Stake.connect(owner).cancelPool(poolId))
          .emit(Stake, "PoolCancelled")
          .withArgs(poolId, SIMPLE_POOL.rewardAmount);

        // Should return all rewards to creator
        const finalBalance = await RewardToken.balanceOf(owner.address);
        expect(finalBalance - initialBalance).to.equal(
          SIMPLE_POOL.rewardAmount
        );

        // Pool should be marked as cancelled
        const pool = await Stake.pools(poolId);
        expect(pool.cancelledAt).to.be.gt(0);
      });

      it("should cancel pool after rewards start with partial refund", async function () {
        // Create a fresh pool for this test
        const poolId = await createSamplePool();

        // Start rewards by staking
        const stakeTime = (await time.latest()) + 1000;
        await time.setNextBlockTimestamp(stakeTime);
        await Stake.connect(bob).stake(poolId, SIMPLE_STAKES.bob);

        // Cancel pool halfway through duration
        const cancelTime = stakeTime + 5000; // 5000s out of 10000s
        await time.setNextBlockTimestamp(cancelTime);

        const initialBalance = await RewardToken.balanceOf(owner.address);
        await Stake.connect(owner).cancelPool(poolId);
        const finalBalance = await RewardToken.balanceOf(owner.address);

        // Should return 50% of rewards (5000/10000)
        const expectedRefund = wei(5000);
        expect(finalBalance - initialBalance).to.equal(expectedRefund);
      });
    });

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
          expect(pool.rewardStartedAt).to.equal(0);
          expect(pool.cancelledAt).to.equal(0);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
          expect(pool.lastRewardTime).to.equal(0);
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
            Stake.connect(alice).stake(999, SIMPLE_STAKES.alice)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if pool is cancelled", async function () {
          await Stake.connect(owner).cancelPool(this.poolId);

          await expect(
            Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolCancelled");
        });

        it("should revert if pool is finished", async function () {
          // Start rewards by staking
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(bob).stake(this.poolId, SIMPLE_STAKES.bob);

          // Move past pool end time
          const endTime = stakeTime + SIMPLE_POOL.rewardDuration + 1;
          await time.increaseTo(endTime);

          await expect(
            Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolFinished");
        });
      });

      describe("Unstaking Validations", function () {
        it("should revert if unstake amount is zero", async function () {
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

          await expect(Stake.connect(alice).unstake(this.poolId, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("amount cannot be zero");
        });

        it("should revert if insufficient balance", async function () {
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

          await expect(
            Stake.connect(alice).unstake(
              this.poolId,
              SIMPLE_STAKES.alice + wei(1)
            )
          ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
        });

        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).unstake(999, SIMPLE_STAKES.alice)
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
          ).to.be.revertedWithCustomError(
            Stake,
            "Stake__UnauthorizedPoolDeactivation"
          );
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
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);
        await Stake.connect(bob).stake(this.poolId, SIMPLE_STAKES.bob);
        await Stake.connect(alice).stake(1, SIMPLE_STAKES.alice);
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
          await Stake.connect(alice).unstake(this.poolId, SIMPLE_STAKES.alice);

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
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

          // Second stake exactly 1000s later should claim rewards and add to stake
          const secondStakeTime = firstStakeTime + 1000;
          await time.setNextBlockTimestamp(secondStakeTime);
          const initialBalance = await RewardToken.balanceOf(alice.address);
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);
          const finalBalance = await RewardToken.balanceOf(alice.address);

          // Should have auto-claimed rewards
          expect(finalBalance - initialBalance).to.equal(wei(1000));

          // Should have double stake amount
          const userStake = await Stake.userPoolStake(
            alice.address,
            this.poolId
          );
          expect(userStake.stakedAmount).to.equal(SIMPLE_STAKES.alice * 2n);
        });

        it("should not increment active staker count on subsequent stakes", async function () {
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

          const pool = await Stake.pools(this.poolId);
          expect(pool.activeStakerCount).to.equal(1);
        });
      });

      describe("Pool Expiration Scenarios", function () {
        it("should stop reward distribution when pool expires", async function () {
          // Start rewards
          const stakeTime = (await time.latest()) + 1000;
          await time.setNextBlockTimestamp(stakeTime);
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

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
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

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
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

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
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

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
          await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);
          await Stake.connect(alice).unstake(this.poolId, SIMPLE_STAKES.alice);

          const pool = await Stake.pools(this.poolId);
          expect(pool.totalStaked).to.equal(0);
          expect(pool.activeStakerCount).to.equal(0);
        });
      });
    }); // Edge Cases
  }); // Stake Operations
}); // Stake
