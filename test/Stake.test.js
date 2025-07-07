const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { NULL_ADDRESS, wei } = require("./utils/test-utils");

// MARK: - Constants

const ORIGINAL_BALANCE = wei(200000000); // 200M tokens
const STAKE_AMOUNT = wei(1000);
const REWARD_AMOUNT = wei(10000);
const REWARD_DURATION = 3600; // 1 hour in seconds
const MIN_REWARD_DURATION = 3600; // 1 hour
const MAX_REWARD_DURATION = 3600 * 24 * 365 * 10; // 10 years

// MARK: - Fixtures

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

// MARK: - Helper Functions

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

// Enhanced helper functions for better test readability
async function expectPoolState(Stake, poolId, expectedState) {
  const pool = await Stake.pools(poolId);

  if (expectedState.stakingToken)
    expect(pool.stakingToken).to.equal(expectedState.stakingToken);
  if (expectedState.rewardToken)
    expect(pool.rewardToken).to.equal(expectedState.rewardToken);
  if (expectedState.creator)
    expect(pool.creator).to.equal(expectedState.creator);
  if (expectedState.rewardAmount !== undefined)
    expect(pool.rewardAmount).to.equal(expectedState.rewardAmount);
  if (expectedState.rewardDuration !== undefined)
    expect(pool.rewardDuration).to.equal(expectedState.rewardDuration);
  if (expectedState.totalStaked !== undefined)
    expect(pool.totalStaked).to.equal(expectedState.totalStaked);
  if (expectedState.activeStakerCount !== undefined)
    expect(pool.activeStakerCount).to.equal(expectedState.activeStakerCount);
  if (expectedState.cancelledAt !== undefined)
    expect(pool.cancelledAt).to.equal(expectedState.cancelledAt);
  if (expectedState.isCancelled !== undefined) {
    expect(pool.cancelledAt > 0).to.equal(expectedState.isCancelled);
  }
}

async function expectUserStake(Stake, user, poolId, expectedStake) {
  const userStake = await Stake.userPoolStake(user.address, poolId);

  if (expectedStake.stakedAmount !== undefined)
    expect(userStake.stakedAmount).to.equal(expectedStake.stakedAmount);
  if (expectedStake.claimedRewards !== undefined)
    expect(userStake.claimedRewards).to.equal(expectedStake.claimedRewards);
  if (expectedStake.claimedRewardsGt !== undefined)
    expect(userStake.claimedRewards).to.be.gt(expectedStake.claimedRewardsGt);
}

async function expectTokenBalances(token, expectedBalances) {
  for (const [address, expectedBalance] of Object.entries(expectedBalances)) {
    const balance = await token.balanceOf(address);
    if (typeof expectedBalance === "object" && expectedBalance.closeTo) {
      expect(balance).to.be.closeTo(
        expectedBalance.amount,
        expectedBalance.closeTo
      );
    } else {
      expect(balance).to.equal(expectedBalance);
    }
  }
}

async function expectEventEmitted(
  txPromise,
  contractInstance,
  eventName,
  expectedArgs
) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  const event = await getEventFromReceipt(receipt, eventName);

  expect(event).to.not.be.undefined;
  if (expectedArgs) {
    expectedArgs.forEach((arg, index) => {
      if (typeof arg === "object" && arg.closeTo) {
        expect(event.args[index]).to.be.closeTo(arg.amount, arg.closeTo);
      } else {
        expect(event.args[index]).to.equal(arg);
      }
    });
  }

  return { tx, receipt, event };
}

async function advanceTimeAndCheck(
  seconds,
  Stake,
  poolId,
  user,
  expectedRewardIncrease
) {
  const [rewardsBefore] = await Stake.claimableReward(poolId, user.address);
  await time.increase(seconds);
  const [rewardsAfter] = await Stake.claimableReward(poolId, user.address);

  if (expectedRewardIncrease) {
    expect(rewardsAfter).to.be.closeTo(
      rewardsBefore + expectedRewardIncrease,
      wei(50)
    );
  } else {
    expect(rewardsAfter).to.be.gt(rewardsBefore);
  }

  return { rewardsBefore, rewardsAfter };
}

async function createPoolAndStake(
  Stake,
  stakingToken,
  rewardToken,
  staker,
  stakeAmount = STAKE_AMOUNT
) {
  const poolId = await createPool(Stake, stakingToken, rewardToken);
  await stakeTokens(Stake, stakingToken, staker, poolId, stakeAmount);
  return poolId;
}

async function expectRevertWithReason(
  txPromise,
  contractInstance,
  errorName,
  errorArgs
) {
  if (errorArgs) {
    await expect(txPromise)
      .to.be.revertedWithCustomError(contractInstance, errorName)
      .withArgs(...errorArgs);
  } else {
    await expect(txPromise).to.be.revertedWithCustomError(
      contractInstance,
      errorName
    );
  }
}

// Test scenario helpers
async function setupMultipleStakers(
  Stake,
  stakingToken,
  poolId,
  stakers,
  amounts
) {
  for (let i = 0; i < stakers.length; i++) {
    const amount = amounts[i] || STAKE_AMOUNT;
    await stakeTokens(Stake, stakingToken, stakers[i], poolId, amount);
  }
}

async function checkRewardDistribution(Stake, poolId, stakers, expectedRatios) {
  const rewards = [];
  for (const staker of stakers) {
    const [claimable] = await Stake.claimableReward(poolId, staker.address);
    rewards.push(claimable);
  }

  // Check ratios are approximately correct
  for (let i = 1; i < rewards.length; i++) {
    if (expectedRatios && expectedRatios[i]) {
      const ratio = rewards[0] / rewards[i];
      expect(ratio).to.be.closeTo(expectedRatios[i], 0.1);
    }
  }

  return rewards;
}

// MARK: - Tests

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
      });

      it("should create pool with correct parameters", async function () {
        await expectPoolState(Stake, 0, {
          stakingToken: StakingToken.target,
          rewardToken: RewardToken.target,
          creator: owner.address,
          rewardAmount: REWARD_AMOUNT,
          rewardDuration: REWARD_DURATION,
          totalStaked: 0,
          cancelledAt: 0,
        });
      });

      it("should transfer reward tokens and update balances", async function () {
        await expectTokenBalances(RewardToken, {
          [Stake.target]: REWARD_AMOUNT,
          [owner.address]: ORIGINAL_BALANCE - REWARD_AMOUNT,
        });
      });

      it("should emit PoolCreated event", async function () {
        await RewardToken.approve(Stake.target, REWARD_AMOUNT);

        await expectEventEmitted(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          ),
          Stake,
          "PoolCreated",
          [
            1,
            owner.address,
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION,
          ]
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

        await expectPoolState(Stake, 0, {
          stakingToken: StakingToken.target,
          rewardToken: StakingToken.target,
          rewardAmount: REWARD_AMOUNT,
          cancelledAt: 0,
        });
      });
    });

    describe("Validation Tests", function () {
      const validationTests = [
        {
          name: "should reject zero staking token address",
          params: [NULL_ADDRESS, "RewardToken", REWARD_AMOUNT, REWARD_DURATION],
          error: "Stake__InvalidToken",
          errorArgs: ["stakingToken cannot be zero"],
        },
        {
          name: "should reject zero reward token address",
          params: [
            "StakingToken",
            NULL_ADDRESS,
            REWARD_AMOUNT,
            REWARD_DURATION,
          ],
          error: "Stake__InvalidToken",
          errorArgs: ["rewardToken cannot be zero"],
        },
        {
          name: "should reject zero reward amount",
          params: ["StakingToken", "RewardToken", 0, REWARD_DURATION],
          error: "Stake__InvalidAmount",
          errorArgs: ["rewardAmount cannot be zero"],
        },
        {
          name: "should reject reward duration too short",
          params: [
            "StakingToken",
            "RewardToken",
            REWARD_AMOUNT,
            MIN_REWARD_DURATION - 1,
          ],
          error: "Stake__InvalidDuration",
          errorArgs: ["rewardDuration out of range"],
        },
        {
          name: "should reject reward duration too long",
          params: [
            "StakingToken",
            "RewardToken",
            REWARD_AMOUNT,
            MAX_REWARD_DURATION + 1,
          ],
          error: "Stake__InvalidDuration",
          errorArgs: ["rewardDuration out of range"],
        },
      ];

      validationTests.forEach(({ name, params, error, errorArgs }) => {
        it(name, async function () {
          const [stakingToken, rewardToken, rewardAmount, rewardDuration] =
            params;
          const stakingTokenAddress =
            stakingToken === "StakingToken"
              ? StakingToken.target
              : stakingToken;
          const rewardTokenAddress =
            rewardToken === "RewardToken" ? RewardToken.target : rewardToken;

          await expectRevertWithReason(
            Stake.createPool(
              stakingTokenAddress,
              rewardTokenAddress,
              rewardAmount,
              rewardDuration
            ),
            Stake,
            error,
            errorArgs
          );
        });
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
      it("should stake tokens and update state", async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        await expectUserStake(Stake, alice, poolId, {
          stakedAmount: STAKE_AMOUNT,
        });
        await expectPoolState(Stake, poolId, { totalStaked: STAKE_AMOUNT });
      });

      it("should transfer tokens to contract", async function () {
        const initialBalance = await StakingToken.balanceOf(alice.address);
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        await expectTokenBalances(StakingToken, {
          [Stake.target]: STAKE_AMOUNT,
          [alice.address]: initialBalance - STAKE_AMOUNT,
        });
      });

      it("should emit Staked event", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);

        await expectEventEmitted(
          Stake.connect(alice).stake(poolId, STAKE_AMOUNT),
          Stake,
          "Staked",
          [poolId, alice.address, STAKE_AMOUNT]
        );
      });

      it("should accumulate multiple stakes", async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);

        await expectUserStake(Stake, alice, poolId, {
          stakedAmount: STAKE_AMOUNT * 2n,
        });
        await expectPoolState(Stake, poolId, {
          totalStaked: STAKE_AMOUNT * 2n,
        });
      });

      describe("Staking Validations", function () {
        const stakingValidationTests = [
          {
            name: "should reject staking in non-existent pool",
            poolId: 999,
            amount: STAKE_AMOUNT,
            error: "Stake__PoolNotFound",
          },
          {
            name: "should reject zero stake amount",
            poolId: "current",
            amount: 0,
            error: "Stake__InvalidAmount",
            errorArgs: ["Stake amount too small"],
          },
          {
            name: "should reject staking below minimum amount",
            poolId: "current",
            amount: 999, // MIN_STAKE_AMOUNT - 1
            error: "Stake__InvalidAmount",
            errorArgs: ["Stake amount too small"],
          },
        ];

        stakingValidationTests.forEach(
          ({ name, poolId: testPoolId, amount, error, errorArgs }) => {
            it(name, async function () {
              const actualPoolId =
                testPoolId === "current" ? poolId : testPoolId;

              await expectRevertWithReason(
                stakeTokens(Stake, StakingToken, alice, actualPoolId, amount),
                Stake,
                error,
                errorArgs
              );
            });
          }
        );

        it("should reject staking in cancelled pool", async function () {
          await Stake.cancelPool(poolId);

          await expectRevertWithReason(
            stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT),
            Stake,
            "Stake__PoolNotActive"
          );
        });

        it("should accept staking at minimum amount", async function () {
          const minStakeAmount = 1000; // MIN_STAKE_AMOUNT from contract
          await stakeTokens(Stake, StakingToken, alice, poolId, minStakeAmount);

          await expectUserStake(Stake, alice, poolId, {
            stakedAmount: minStakeAmount,
          });
        });
      });
    });

    describe("Unstaking Tokens", function () {
      beforeEach(async function () {
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await time.increase(100); // Accumulate some rewards
      });

      it("should unstake tokens and update state", async function () {
        const unstakeAmount = STAKE_AMOUNT / 2n;
        await Stake.connect(alice).unstake(poolId, unstakeAmount);

        await expectUserStake(Stake, alice, poolId, {
          stakedAmount: STAKE_AMOUNT - unstakeAmount,
        });
        await expectPoolState(Stake, poolId, {
          totalStaked: STAKE_AMOUNT - unstakeAmount,
        });
      });

      it("should transfer tokens back to user", async function () {
        const initialBalance = await StakingToken.balanceOf(alice.address);
        const unstakeAmount = STAKE_AMOUNT / 2n;

        await Stake.connect(alice).unstake(poolId, unstakeAmount);

        await expectTokenBalances(StakingToken, {
          [alice.address]: initialBalance + unstakeAmount,
        });
      });

      it("should emit Unstaked event", async function () {
        const unstakeAmount = STAKE_AMOUNT / 2n;

        await expectEventEmitted(
          Stake.connect(alice).unstake(poolId, unstakeAmount),
          Stake,
          "Unstaked",
          [poolId, alice.address, unstakeAmount]
        );
      });

      it("should auto-claim rewards when unstaking", async function () {
        const initialRewardBalance = await RewardToken.balanceOf(alice.address);
        await time.increase(360);

        const [claimableBefore] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(claimableBefore).to.be.gt(0);

        const { receipt } = await expectEventEmitted(
          Stake.connect(alice).unstake(poolId, STAKE_AMOUNT),
          Stake,
          "Unstaked",
          [poolId, alice.address, STAKE_AMOUNT]
        );

        // Should also emit RewardClaimed event
        const rewardEvent = await getEventFromReceipt(receipt, "RewardClaimed");
        expect(rewardEvent).to.not.be.undefined;
        expect(rewardEvent.args[2]).to.be.closeTo(claimableBefore, wei(50));

        // Check rewards were transferred
        const finalRewardBalance = await RewardToken.balanceOf(alice.address);
        expect(finalRewardBalance).to.be.gt(initialRewardBalance);

        // Check claimable rewards are now zero
        const [claimableAfter] = await Stake.claimableReward(
          poolId,
          alice.address
        );
        expect(claimableAfter).to.equal(0);
      });

      describe("Unstaking Validations", function () {
        const unstakingValidationTests = [
          {
            name: "should reject unstaking from non-existent pool",
            poolId: 999,
            amount: STAKE_AMOUNT,
            error: "Stake__PoolNotFound",
          },
          {
            name: "should reject zero unstake amount",
            poolId: "current",
            amount: 0,
            error: "Stake__InvalidAmount",
            errorArgs: ["amount cannot be zero"],
          },
          {
            name: "should reject unstaking more than staked",
            poolId: "current",
            amount: STAKE_AMOUNT * 2n,
            error: "Stake__InsufficientBalance",
          },
        ];

        unstakingValidationTests.forEach(
          ({ name, poolId: testPoolId, amount, error, errorArgs }) => {
            it(name, async function () {
              const actualPoolId =
                testPoolId === "current" ? poolId : testPoolId;

              await expectRevertWithReason(
                Stake.connect(alice).unstake(actualPoolId, amount),
                Stake,
                error,
                errorArgs
              );
            });
          }
        );
      });
    });

    describe("Active Staker Count", function () {
      it("should track active stakers correctly", async function () {
        await expectPoolState(Stake, poolId, { activeStakerCount: 0 });

        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await expectPoolState(Stake, poolId, { activeStakerCount: 1 });

        await stakeTokens(Stake, StakingToken, bob, poolId, STAKE_AMOUNT);
        await expectPoolState(Stake, poolId, { activeStakerCount: 2 });

        // Alice stakes again - should not increment
        await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
        await expectPoolState(Stake, poolId, { activeStakerCount: 2 });
      });

      it("should decrement when user completely unstakes", async function () {
        await setupMultipleStakers(
          Stake,
          StakingToken,
          poolId,
          [alice, bob],
          [STAKE_AMOUNT, STAKE_AMOUNT]
        );
        await expectPoolState(Stake, poolId, { activeStakerCount: 2 });

        // Alice partially unstakes - should not decrement
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);
        await expectPoolState(Stake, poolId, { activeStakerCount: 2 });

        // Alice completely unstakes - should decrement
        await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);
        await expectPoolState(Stake, poolId, { activeStakerCount: 1 });

        // Bob completely unstakes - should decrement
        await Stake.connect(bob).unstake(poolId, STAKE_AMOUNT);
        await expectPoolState(Stake, poolId, { activeStakerCount: 0 });
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
        const { rewardsAfter } = await advanceTimeAndCheck(
          360,
          Stake,
          poolId,
          alice
        ); // 10% of duration
        expect(rewardsAfter).to.be.closeTo(wei(1000), wei(50)); // ~10% of 10000
      });

      it("should handle multiple stakers proportionally", async function () {
        await stakeTokens(Stake, StakingToken, bob, poolId, STAKE_AMOUNT);
        await time.increase(360);

        const [aliceRewards, bobRewards] = await checkRewardDistribution(
          Stake,
          poolId,
          [alice, bob]
        );

        expect(aliceRewards).to.be.gt(bobRewards); // Alice staked earlier
        expect(aliceRewards + bobRewards).to.be.closeTo(wei(1000), wei(50));
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
      });

      it("should claim rewards and update balances", async function () {
        const initialBalance = await RewardToken.balanceOf(alice.address);

        await Stake.connect(alice).claim(poolId);

        const finalBalance = await RewardToken.balanceOf(alice.address);
        expect(finalBalance).to.be.gt(initialBalance);

        await expectUserStake(Stake, alice, poolId, { claimedRewardsGt: 0 });
      });

      it("should emit RewardClaimed event", async function () {
        const { event } = await expectEventEmitted(
          Stake.connect(alice).claim(poolId),
          Stake,
          "RewardClaimed"
        );

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
          await expectRevertWithReason(
            Stake.connect(alice).claim(999),
            Stake,
            "Stake__PoolNotFound"
          );
        });

        it("should reject claiming when no rewards available", async function () {
          await expectRevertWithReason(
            Stake.connect(bob).claim(poolId),
            Stake,
            "Stake__NoRewardsToClaim"
          );
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
      await expectUserStake(Stake, alice, poolId, {
        stakedAmount: STAKE_AMOUNT,
      });
    });

    it("should allow unstaking with same token", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT / 2n);

      await expectUserStake(Stake, alice, poolId, {
        stakedAmount: STAKE_AMOUNT / 2n,
      });
    });

    it("should calculate rewards correctly for same token", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      const { rewardsAfter } = await advanceTimeAndCheck(
        360,
        Stake,
        poolId,
        alice
      );
      expect(rewardsAfter).to.be.closeTo(wei(1000), wei(50));
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
        await expectRevertWithReason(
          Stake.getPools(2, 1),
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    });

    describe("Bulk Reward Query", function () {
      beforeEach(async function () {
        await setupUserTokens(StakingToken, [alice]);
        await setupUserTokens(AnotherToken, [alice]);
        await setupMultipleStakers(
          Stake,
          StakingToken,
          0,
          [alice],
          [STAKE_AMOUNT]
        );
        await setupMultipleStakers(
          Stake,
          AnotherToken,
          1,
          [alice],
          [STAKE_AMOUNT]
        );
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
        await expectRevertWithReason(
          Stake.claimableRewardBulk(1, 0, alice.address),
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    });

    describe("User Engaged Pools Tracking", function () {
      it("should track user engaged pools correctly", async function () {
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

        await stakeTokens(Stake, StakingToken, alice, poolId1, STAKE_AMOUNT);
        await stakeTokens(Stake, AnotherToken, bob, poolId2, STAKE_AMOUNT);

        const alicePools = await Stake.getUserEngagedPools(
          alice.address,
          0,
          10
        );
        expect(alicePools).to.have.length(1);
        expect(alicePools[0]).to.equal(poolId1);

        const bobPools = await Stake.getUserEngagedPools(bob.address, 0, 1000);
        expect(bobPools).to.have.length(1);
        expect(bobPools[0]).to.equal(poolId2);
      });

      it("should keep pools after complete unstaking", async function () {
        const poolId1 = await createPool(Stake, StakingToken, RewardToken);
        const poolId2 = await createPool(Stake, AnotherToken, RewardToken);

        await setupUserTokens(StakingToken, [alice]);
        await setupUserTokens(AnotherToken, [alice]);

        await setupMultipleStakers(
          Stake,
          StakingToken,
          poolId1,
          [alice],
          [STAKE_AMOUNT]
        );
        await setupMultipleStakers(
          Stake,
          AnotherToken,
          poolId2,
          [alice],
          [STAKE_AMOUNT]
        );

        let userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);

        // Completely unstake from both pools - should remain in engaged pools
        await Stake.connect(alice).unstake(poolId1, STAKE_AMOUNT);
        await Stake.connect(alice).unstake(poolId2, STAKE_AMOUNT);

        userPools = await Stake.getUserEngagedPools(alice.address, 0, 1000);
        expect(userPools).to.have.length(2);
        expect(userPools[0]).to.equal(poolId1);
        expect(userPools[1]).to.equal(poolId2);
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
      const tx = await Stake.cancelPool(poolId);
      const receipt = await tx.wait();

      // Extract leftover rewards from event
      const event = await getEventFromReceipt(receipt, "PoolCancelled");
      const leftoverRewards = event.args[1];

      // Should be close to full reward amount since no stakers
      expect(leftoverRewards).to.be.closeTo(REWARD_AMOUNT, wei(100));

      await expectPoolState(Stake, poolId, { isCancelled: true });
    });

    it("should prevent non-creator from cancelling pool", async function () {
      await expectRevertWithReason(
        Stake.connect(alice).cancelPool(poolId),
        Stake,
        "Stake__UnauthorizedPoolDeactivation"
      );
    });

    it("should reject cancellation of non-existent pool", async function () {
      await expectRevertWithReason(
        Stake.connect(owner).cancelPool(999),
        Stake,
        "Stake__PoolNotFound"
      );
    });

    it("should prevent double cancellation", async function () {
      await Stake.connect(owner).cancelPool(poolId);

      await expectRevertWithReason(
        Stake.connect(owner).cancelPool(poolId),
        Stake,
        "Stake__PoolNotActive"
      );
    });
  });

  describe("Pool Cancellation", function () {
    let Stake, StakingToken, RewardToken, owner, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, owner, alice, bob, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
      await setupUserTokens(StakingToken, [alice, bob]);
    });

    it("should return all rewards when cancelled immediately", async function () {
      const creatorInitialBalance = await RewardToken.balanceOf(owner.address);

      const { event } = await expectEventEmitted(
        Stake.cancelPool(poolId),
        Stake,
        "PoolCancelled"
      );

      const leftoverRewards = event.args[1];
      expect(leftoverRewards).to.be.closeTo(REWARD_AMOUNT, wei(100));

      await expectTokenBalances(RewardToken, {
        [owner.address]: {
          amount: creatorInitialBalance + REWARD_AMOUNT,
          closeTo: wei(100),
        },
      });
    });

    it("should return partial rewards when cancelled mid-period", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(REWARD_DURATION / 2);

      const creatorInitialBalance = await RewardToken.balanceOf(owner.address);
      const { event } = await expectEventEmitted(
        Stake.cancelPool(poolId),
        Stake,
        "PoolCancelled"
      );

      const leftoverRewards = event.args[1];
      expect(leftoverRewards).to.be.closeTo(REWARD_AMOUNT / 2n, wei(100));

      await expectTokenBalances(RewardToken, {
        [owner.address]: creatorInitialBalance + leftoverRewards,
      });
    });

    it("should return zero rewards when cancelled after period ends", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(REWARD_DURATION + 100);

      const creatorInitialBalance = await RewardToken.balanceOf(owner.address);

      await expectEventEmitted(
        Stake.cancelPool(poolId),
        Stake,
        "PoolCancelled",
        [poolId, 0] // No leftover rewards
      );

      await expectTokenBalances(RewardToken, {
        [owner.address]: creatorInitialBalance, // No change
      });
    });

    it("should allow stakers to unstake after cancellation", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(REWARD_DURATION / 4);
      await Stake.cancelPool(poolId);

      const aliceInitialBalance = await StakingToken.balanceOf(alice.address);
      await Stake.connect(alice).unstake(poolId, STAKE_AMOUNT);

      await expectTokenBalances(StakingToken, {
        [alice.address]: aliceInitialBalance + STAKE_AMOUNT,
      });

      await expectUserStake(Stake, alice, poolId, { stakedAmount: 0 });
    });

    it("should allow stakers to claim rewards earned before cancellation", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(REWARD_DURATION / 4);

      await Stake.cancelPool(poolId);

      const aliceInitialBalance = await RewardToken.balanceOf(alice.address);
      const [claimableBefore] = await Stake.claimableReward(
        poolId,
        alice.address
      );

      expect(claimableBefore).to.be.gt(0);
      expect(claimableBefore).to.be.closeTo(REWARD_AMOUNT / 4n, wei(100));

      await Stake.connect(alice).claim(poolId);

      await expectTokenBalances(RewardToken, {
        [alice.address]: {
          amount: aliceInitialBalance + claimableBefore,
          closeTo: wei(50),
        },
      });
    });

    it("should prevent new staking after cancellation", async function () {
      await Stake.cancelPool(poolId);

      await expectRevertWithReason(
        stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT),
        Stake,
        "Stake__PoolNotActive"
      );
    });

    it("should handle cancellation with no stakers", async function () {
      const creatorInitialBalance = await RewardToken.balanceOf(owner.address);

      const { event } = await expectEventEmitted(
        Stake.cancelPool(poolId),
        Stake,
        "PoolCancelled"
      );

      const leftoverRewards = event.args[1];
      expect(leftoverRewards).to.be.closeTo(REWARD_AMOUNT, wei(100));

      await expectTokenBalances(RewardToken, {
        [owner.address]: {
          amount: creatorInitialBalance + REWARD_AMOUNT,
          closeTo: wei(100),
        },
      });
    });

    it("should handle cancellation with multiple stakers", async function () {
      await setupMultipleStakers(
        Stake,
        StakingToken,
        poolId,
        [alice, bob],
        [STAKE_AMOUNT, STAKE_AMOUNT]
      );
      await time.increase(REWARD_DURATION / 3);

      const { event } = await expectEventEmitted(
        Stake.cancelPool(poolId),
        Stake,
        "PoolCancelled"
      );

      const leftoverRewards = event.args[1];
      expect(leftoverRewards).to.be.closeTo(
        (REWARD_AMOUNT * 2n) / 3n,
        wei(200)
      );

      const [aliceRewards, bobRewards] = await checkRewardDistribution(
        Stake,
        poolId,
        [alice, bob]
      );
      expect(aliceRewards).to.be.gt(0);
      expect(bobRewards).to.be.gt(0);

      // Combined rewards should equal original amount
      expect(aliceRewards + bobRewards + leftoverRewards).to.be.closeTo(
        REWARD_AMOUNT,
        wei(100)
      );
    });

    it("should stop reward accrual at cancellation time", async function () {
      await stakeTokens(Stake, StakingToken, alice, poolId, STAKE_AMOUNT);
      await time.increase(REWARD_DURATION / 4);

      const [rewardsBefore] = await Stake.claimableReward(
        poolId,
        alice.address
      );
      await Stake.cancelPool(poolId);

      // Wait additional time after cancellation
      await time.increase(REWARD_DURATION / 4);

      const [rewardsAfter] = await Stake.claimableReward(poolId, alice.address);
      expect(rewardsAfter).to.be.closeTo(rewardsBefore, wei(50));
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

    it("should handle extreme conditions without overflow", async function () {
      const largeRewardAmount = wei(1000000);
      const shortDuration = 3600;

      await RewardToken.approve(Stake.target, largeRewardAmount);
      const poolId = await createPool(
        Stake,
        StakingToken,
        RewardToken,
        largeRewardAmount,
        shortDuration
      );

      await setupUserTokens(StakingToken, [alice, bob]);
      await setupMultipleStakers(
        Stake,
        StakingToken,
        poolId,
        [alice, bob],
        [1000, 1000]
      );

      await time.increase(shortDuration - 100);
      const [claimable] = await Stake.claimableReward(poolId, alice.address);
      expect(claimable).to.be.lte(largeRewardAmount);

      await time.increase(200);
      await expectRevertWithReason(
        stakeTokens(Stake, StakingToken, alice, poolId, 1000),
        Stake,
        "Stake__PoolNotActive"
      );
    });

    it("should handle maximum staking amounts", async function () {
      const poolId = await createPool(Stake, StakingToken, RewardToken);
      const maxStakeAmount = wei(100000000);

      await StakingToken.transfer(alice.address, maxStakeAmount);
      await stakeTokens(Stake, StakingToken, alice, poolId, maxStakeAmount);

      await expectUserStake(Stake, alice, poolId, {
        stakedAmount: maxStakeAmount,
      });
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

    it("should reject amounts below minimum", async function () {
      const minStakeAmount = 1000;

      for (let amount = 1; amount < minStakeAmount; amount += 100) {
        await expectRevertWithReason(
          stakeTokens(Stake, StakingToken, alice, poolId, amount),
          Stake,
          "Stake__InvalidAmount",
          ["Stake amount too small"]
        );
      }
    });

    it("should accept amounts at or above minimum", async function () {
      const minStakeAmount = 1000;
      const testAmounts = [
        minStakeAmount,
        minStakeAmount + 1,
        minStakeAmount * 2,
        STAKE_AMOUNT,
      ];

      for (const amount of testAmounts) {
        await stakeTokens(Stake, StakingToken, alice, poolId, amount);
        await expectUserStake(Stake, alice, poolId, { stakedAmount: amount });

        // Reset for next test
        await Stake.connect(alice).unstake(poolId, amount);
      }
    });

    it("should prevent dust attacks", async function () {
      await expectRevertWithReason(
        stakeTokens(Stake, StakingToken, alice, poolId, 1),
        Stake,
        "Stake__InvalidAmount",
        ["Stake amount too small"]
      );
    });
  });

  describe("Authorization Tests", function () {
    let Stake, StakingToken, RewardToken, owner, alice, bob, poolId;

    beforeEach(async function () {
      ({ Stake, StakingToken, RewardToken, owner, alice, bob, poolId } =
        await loadFixture(deployStakeWithPoolFixture));
    });

    it("should allow only creator to cancel pool", async function () {
      const { event } = await expectEventEmitted(
        Stake.connect(owner).cancelPool(poolId),
        Stake,
        "PoolCancelled"
      );

      expect(event.args[1]).to.be.closeTo(REWARD_AMOUNT, wei(100));
    });

    it("should reject cancellation from non-creator", async function () {
      const nonCreators = [alice, bob];

      for (const user of nonCreators) {
        await expectRevertWithReason(
          Stake.connect(user).cancelPool(poolId),
          Stake,
          "Stake__UnauthorizedPoolDeactivation"
        );
      }
    });

    it("should reject cancellation of non-existent pool", async function () {
      await expectRevertWithReason(
        Stake.connect(owner).cancelPool(999),
        Stake,
        "Stake__PoolNotFound"
      );
    });
  });
});
