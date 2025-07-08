const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { network } = require("hardhat");
const { MAX_INT_256, NULL_ADDRESS, wei } = require("./utils/test-utils");

// Global staking constants
const ONE_HOUR = 3600;
const MIN_REWARD_DURATION = ONE_HOUR;
const MAX_REWARD_DURATION = ONE_HOUR * 24 * 365 * 10;
const REWARD_PRECISION = 10n ** 18n; // 1e18

// Token amount constants
const INITIAL_TOKEN_SUPPLY = wei(1000000); // 1M tokens
const INITIAL_USER_BALANCE = wei(10000); // 10k tokens per user

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

  const getPoolAndUserStake = async (poolId, userAddress) => {
    const pool = await Stake.pools(poolId);
    const userStake = await Stake.userPoolStake(userAddress, poolId);
    return { pool, userStake };
  };

  const createSamplePool = async (creator) => {
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
    return 0; // First pool ID
  };

  beforeEach(async function () {
    [Stake, StakingToken, RewardToken] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();

    SIMPLE_POOL.stakingToken = StakingToken.target;
    SIMPLE_POOL.rewardToken = RewardToken.target;

    // Distribute tokens to test accounts
    await distributeTokens(
      StakingToken,
      [alice, bob, carol],
      INITIAL_USER_BALANCE
    );
    await distributeTokens(
      RewardToken,
      [alice, bob, carol],
      INITIAL_USER_BALANCE
    );
  });

  describe("Stake Operations", function () {
    beforeEach(async function () {
      this.poolId = await createSamplePool(alice);

      // Approve staking tokens for users
      await approveTokens(StakingToken, [alice, bob, carol], Stake.target);
    });

    describe("Basic Staking", function () {
      it("should stake correct amount", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const { userStake } = await getPoolAndUserStake(
          this.poolId,
          alice.address
        );
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

        const { pool } = await getPoolAndUserStake(this.poolId, alice.address);
        expect(pool.totalStaked).to.equal(SIMPLE_STAKES.alice);
      });

      it("should increment active staker count", async function () {
        await Stake.connect(alice).stake(this.poolId, SIMPLE_STAKES.alice);

        const { pool } = await getPoolAndUserStake(this.poolId, alice.address);
        expect(pool.activeStakerCount).to.equal(1);
      });

      it("should set rewardStartedAt when first stake happens", async function () {
        const stakeTx = await Stake.connect(alice).stake(
          this.poolId,
          SIMPLE_STAKES.alice
        );
        const stakeTime = await time.latest();

        const { pool } = await getPoolAndUserStake(this.poolId, alice.address);
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
        const { userStake } = await getPoolAndUserStake(
          this.poolId,
          alice.address
        );
        expect(userStake.claimedRewards).to.equal(wei(1000));
      });
    });

    describe("Validations", function () {
      it("should revert if stake amount is too small", async function () {
        await expect(
          Stake.connect(alice).stake(this.poolId, 999) // Less than MIN_STAKE_AMOUNT (1000)
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
          .withArgs("Stake amount too small");
      });

      it("should revert if pool does not exist", async function () {
        await expect(
          Stake.connect(alice).stake(999, SIMPLE_STAKES.alice)
        ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
      });

      it("should revert if no rewards to claim", async function () {
        await expect(
          Stake.connect(alice).claim(this.poolId)
        ).to.be.revertedWithCustomError(Stake, "Stake__NoRewardsToClaim");
      });
    });
  });
});
