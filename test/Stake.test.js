const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { NULL_ADDRESS, wei } = require("./utils/test-utils");

const ORIGINAL_BALANCE = wei(200000000); // 200M tokens
const STAKE_AMOUNT = wei(1000);
const REWARD_AMOUNT = wei(10000);
const REWARD_DURATION = 3600; // 1 hour in seconds

describe("Stake", function () {
  async function deployFixtures() {
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

    return [Stake, StakingToken, RewardToken, AnotherToken];
  }

  let Stake, StakingToken, RewardToken, AnotherToken;
  let owner, alice, bob, carol;

  beforeEach(async function () {
    [Stake, StakingToken, RewardToken, AnotherToken] = await loadFixture(
      deployFixtures
    );
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  describe("Create Pool", function () {
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

    it("should create a pool correctly", async function () {
      expect(this.pool.stakingToken).to.equal(StakingToken.target);
      expect(this.pool.rewardToken).to.equal(RewardToken.target);
      expect(this.pool.rewardAmount).to.equal(REWARD_AMOUNT);
      expect(this.pool.rewardDuration).to.equal(REWARD_DURATION);
      expect(this.pool.creator).to.equal(owner.address);
      expect(this.pool.active).to.equal(true);
      expect(this.pool.totalStaked).to.equal(0);
    });

    it("should transfer reward tokens to the contract", async function () {
      expect(await RewardToken.balanceOf(Stake.target)).to.equal(REWARD_AMOUNT);
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

    describe("Edge Cases", function () {
      it("should revert if staking token is zero address", async function () {
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

      it("should revert if reward token is zero address", async function () {
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

      it("should allow staking and reward tokens to be the same", async function () {
        await StakingToken.approve(Stake.target, REWARD_AMOUNT);
        await expect(
          Stake.createPool(
            StakingToken.target,
            StakingToken.target,
            REWARD_AMOUNT,
            REWARD_DURATION
          )
        ).to.not.be.reverted;

        const pool = await Stake.pools(1);
        expect(pool.stakingToken).to.equal(StakingToken.target);
        expect(pool.rewardToken).to.equal(StakingToken.target);
        expect(pool.rewardAmount).to.equal(REWARD_AMOUNT);
        expect(pool.active).to.equal(true);
      });

      it("should revert if reward amount is zero", async function () {
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

      it("should revert if reward duration is too short", async function () {
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            3599 // 1 second less than minimum
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
          .withArgs("rewardDuration out of range");
      });

      it("should revert if reward duration is too long", async function () {
        const maxDuration = 3600 * 24 * 365 * 10; // 10 years
        await expect(
          Stake.createPool(
            StakingToken.target,
            RewardToken.target,
            REWARD_AMOUNT,
            maxDuration + 1
          )
        )
          .to.be.revertedWithCustomError(Stake, "Stake__InvalidDuration")
          .withArgs("rewardDuration out of range");
      });
    }); // Edge Cases

    describe("Same Token Staking", function () {
      beforeEach(async function () {
        await StakingToken.approve(Stake.target, REWARD_AMOUNT);
        await Stake.createPool(
          StakingToken.target,
          StakingToken.target,
          REWARD_AMOUNT,
          REWARD_DURATION
        );

        // Transfer staking tokens to alice and bob
        await StakingToken.transfer(alice.address, STAKE_AMOUNT * 3n);
        await StakingToken.transfer(bob.address, STAKE_AMOUNT * 3n);
      });

      it("should allow staking when staking and reward tokens are the same", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await expect(Stake.connect(alice).stake(1, STAKE_AMOUNT))
          .to.emit(Stake, "Staked")
          .withArgs(1, alice.address, STAKE_AMOUNT);

        const userInfo = await Stake.getUserInfo(1, alice.address);
        expect(userInfo.stakedAmount).to.equal(STAKE_AMOUNT);

        const pool = await Stake.pools(1);
        expect(pool.totalStaked).to.equal(STAKE_AMOUNT);
      });

      it("should allow unstaking when staking and reward tokens are the same", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        await expect(Stake.connect(alice).unstake(1, STAKE_AMOUNT / 2n))
          .to.emit(Stake, "Unstaked")
          .withArgs(1, alice.address, STAKE_AMOUNT / 2n);

        const userInfo = await Stake.getUserInfo(1, alice.address);
        expect(userInfo.stakedAmount).to.equal(STAKE_AMOUNT / 2n);
      });

      it("should calculate rewards correctly for same token pools", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        // Fast forward 360 seconds (10% of reward duration)
        await time.increase(360);

        const [claimable, claimed] = await Stake.claimableReward(
          1,
          alice.address
        );

        // Expected reward: (10000 * 360) / 3600 = 1000 tokens
        expect(claimable).to.be.closeTo(wei(1000), wei(1));
        expect(claimed).to.equal(0);
      });

      it("should allow claiming rewards from same token pools", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        // Fast forward to accumulate rewards
        await time.increase(360);

        const initialBalance = await StakingToken.balanceOf(alice.address);

        const tx = await Stake.connect(alice).claim(1);
        const receipt = await tx.wait();

        // Check that RewardClaimed event was emitted
        const event = receipt.logs.find(
          (log) => log.fragment?.name === "RewardClaimed"
        );
        expect(event).to.not.be.undefined;
        expect(event.args[0]).to.equal(1); // poolId
        expect(event.args[1]).to.equal(alice.address); // staker
        expect(event.args[2]).to.be.closeTo(wei(1000), wei(50)); // reward amount with tolerance

        const finalBalance = await StakingToken.balanceOf(alice.address);
        expect(finalBalance).to.be.gt(initialBalance);
      });

      it("should handle multiple users in same token pools", async function () {
        // Alice stakes first
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        // Bob stakes the same amount
        await StakingToken.connect(bob).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(bob).stake(1, STAKE_AMOUNT);

        // Fast forward
        await time.increase(360);

        const [aliceClaimable] = await Stake.claimableReward(1, alice.address);
        const [bobClaimable] = await Stake.claimableReward(1, bob.address);

        // Alice should have more rewards since she staked earlier
        expect(aliceClaimable).to.be.gt(bobClaimable);

        // Total rewards should be approximately correct
        expect(aliceClaimable + bobClaimable).to.be.closeTo(wei(1000), wei(50));
      });

      it("should handle token balance correctly in same token pools", async function () {
        const initialContractBalance = await StakingToken.balanceOf(
          Stake.target
        );

        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        // Contract should have initial reward amount plus staked amount
        const afterStakeBalance = await StakingToken.balanceOf(Stake.target);
        expect(afterStakeBalance).to.equal(
          initialContractBalance + STAKE_AMOUNT
        );

        // Fast forward and claim
        await time.increase(360);
        await Stake.connect(alice).claim(1);

        // Balance should be reduced by claimed amount
        const afterClaimBalance = await StakingToken.balanceOf(Stake.target);
        expect(afterClaimBalance).to.be.lt(afterStakeBalance);
      });
    }); // Same Token Staking
  }); // Create Pool

  describe("Staking", function () {
    beforeEach(async function () {
      await RewardToken.approve(Stake.target, REWARD_AMOUNT);
      await Stake.createPool(
        StakingToken.target,
        RewardToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );

      // Transfer tokens to alice and bob for testing
      await StakingToken.transfer(alice.address, STAKE_AMOUNT * 2n);
      await StakingToken.transfer(bob.address, STAKE_AMOUNT * 2n);
    });

    describe("Stake", function () {
      beforeEach(async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(0, STAKE_AMOUNT);

        this.pool = await Stake.pools(0);
        this.userInfo = await Stake.getUserInfo(0, alice.address);
      });

      it("should stake tokens correctly", async function () {
        expect(this.userInfo.stakedAmount).to.equal(STAKE_AMOUNT);
        expect(this.userInfo.poolId).to.equal(0);
        expect(this.userInfo.staker).to.equal(alice.address);
        expect(this.pool.totalStaked).to.equal(STAKE_AMOUNT);
      });

      it("should transfer staking tokens to the contract", async function () {
        expect(await StakingToken.balanceOf(Stake.target)).to.equal(
          STAKE_AMOUNT
        );
        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          STAKE_AMOUNT
        );
      });

      it("should emit Staked event", async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await expect(Stake.connect(alice).stake(0, STAKE_AMOUNT))
          .to.emit(Stake, "Staked")
          .withArgs(0, alice.address, STAKE_AMOUNT);
      });

      describe("Multiple Stakes", function () {
        beforeEach(async function () {
          await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
          await Stake.connect(alice).stake(0, STAKE_AMOUNT);

          this.userInfo = await Stake.getUserInfo(0, alice.address);
          this.pool = await Stake.pools(0);
        });

        it("should accumulate stake amounts", async function () {
          expect(this.userInfo.stakedAmount).to.equal(STAKE_AMOUNT * 2n);
          expect(this.pool.totalStaked).to.equal(STAKE_AMOUNT * 2n);
        });
      }); // Multiple Stakes

      describe("Edge Cases", function () {
        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).stake(999, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if amount is zero", async function () {
          await expect(Stake.connect(alice).stake(0, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("amount cannot be zero");
        });

        it("should revert if pool is inactive", async function () {
          await Stake.deactivatePool(0);
          await expect(
            Stake.connect(alice).stake(0, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      }); // Edge Cases
    }); // Stake

    describe("Unstake", function () {
      beforeEach(async function () {
        await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(0, STAKE_AMOUNT);

        // Fast forward some time to accumulate rewards
        await time.increase(100);

        await Stake.connect(alice).unstake(0, STAKE_AMOUNT / 2n);

        this.pool = await Stake.pools(0);
        this.userInfo = await Stake.getUserInfo(0, alice.address);
      });

      it("should unstake tokens correctly", async function () {
        expect(this.userInfo.stakedAmount).to.equal(STAKE_AMOUNT / 2n);
        expect(this.pool.totalStaked).to.equal(STAKE_AMOUNT / 2n);
      });

      it("should transfer staking tokens back to user", async function () {
        expect(await StakingToken.balanceOf(Stake.target)).to.equal(
          STAKE_AMOUNT / 2n
        );
        expect(await StakingToken.balanceOf(alice.address)).to.equal(
          STAKE_AMOUNT + STAKE_AMOUNT / 2n
        );
      });

      it("should emit Unstaked event", async function () {
        await expect(Stake.connect(alice).unstake(0, STAKE_AMOUNT / 2n))
          .to.emit(Stake, "Unstaked")
          .withArgs(0, alice.address, STAKE_AMOUNT / 2n);
      });

      describe("Edge Cases", function () {
        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).unstake(999, STAKE_AMOUNT)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });

        it("should revert if amount is zero", async function () {
          await expect(Stake.connect(alice).unstake(0, 0))
            .to.be.revertedWithCustomError(Stake, "Stake__InvalidAmount")
            .withArgs("amount cannot be zero");
        });

        it("should revert if insufficient balance", async function () {
          await expect(
            Stake.connect(alice).unstake(0, STAKE_AMOUNT * 2n)
          ).to.be.revertedWithCustomError(Stake, "Stake__InsufficientBalance");
        });
      }); // Edge Cases
    }); // Unstake
  }); // Staking

  describe("Rewards", function () {
    beforeEach(async function () {
      await RewardToken.approve(Stake.target, REWARD_AMOUNT);
      await Stake.createPool(
        StakingToken.target,
        RewardToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );

      // Transfer tokens to alice and bob
      await StakingToken.transfer(alice.address, STAKE_AMOUNT * 2n);
      await StakingToken.transfer(bob.address, STAKE_AMOUNT * 2n);

      // Alice stakes
      await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
      await Stake.connect(alice).stake(0, STAKE_AMOUNT);
    });

    describe("Reward Calculation", function () {
      it("should calculate claimable rewards correctly", async function () {
        // Fast forward 360 seconds (10% of reward duration)
        await time.increase(360);

        const [claimable, claimed] = await Stake.claimableReward(
          0,
          alice.address
        );

        // Expected reward: (10000 * 360) / 3600 = 1000 tokens
        expect(claimable).to.be.closeTo(wei(1000), wei(1)); // Allow small rounding error
        expect(claimed).to.equal(0);
      });

      it("should handle multiple stakers correctly", async function () {
        // Bob stakes the same amount
        await StakingToken.connect(bob).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(bob).stake(0, STAKE_AMOUNT);

        // Fast forward 360 seconds
        await time.increase(360);

        const [aliceClaimable] = await Stake.claimableReward(0, alice.address);
        const [bobClaimable] = await Stake.claimableReward(0, bob.address);

        // Alice should have more rewards since she staked earlier
        expect(aliceClaimable).to.be.gt(bobClaimable);

        // Total rewards should be approximately 1000 tokens (allow for rounding)
        expect(aliceClaimable + bobClaimable).to.be.closeTo(wei(1000), wei(50));
      });

      it("should return zero rewards for non-stakers", async function () {
        const [claimable, claimed] = await Stake.claimableReward(
          0,
          bob.address
        );
        expect(claimable).to.equal(0);
        expect(claimed).to.equal(0);
      });
    }); // Reward Calculation

    describe("No Rewards Available", function () {
      it("should revert if no rewards to claim", async function () {
        // Bob has never staked, so should have no rewards
        await expect(Stake.connect(bob).claim(0)).to.be.revertedWithCustomError(
          Stake,
          "Stake__NoRewardsToClaim"
        );
      });
    }); // No Rewards Available

    describe("Claim Rewards", function () {
      beforeEach(async function () {
        // Fast forward to accumulate rewards
        await time.increase(360);

        this.initialBalance = await RewardToken.balanceOf(alice.address);
        await Stake.connect(alice).claim(0);

        this.finalBalance = await RewardToken.balanceOf(alice.address);
        this.userInfo = await Stake.getUserInfo(0, alice.address);
      });

      it("should transfer reward tokens to user", async function () {
        expect(this.finalBalance).to.be.gt(this.initialBalance);
        expect(this.userInfo.claimedRewards).to.be.gt(0);
      });

      it("should emit RewardClaimed event", async function () {
        await time.increase(360);
        const [expectedReward] = await Stake.claimableReward(0, alice.address);

        const tx = await Stake.connect(alice).claim(0);
        const receipt = await tx.wait();
        const event = receipt.logs.find(
          (log) => log.fragment?.name === "RewardClaimed"
        );

        expect(event.args[0]).to.equal(0); // poolId
        expect(event.args[1]).to.equal(alice.address); // staker
        expect(event.args[2]).to.be.closeTo(expectedReward, wei(50)); // reward amount with tolerance
      });

      it("should reset claimable rewards after claiming", async function () {
        const [claimable] = await Stake.claimableReward(0, alice.address);
        expect(claimable).to.equal(0);
      });

      describe("Edge Cases", function () {
        it("should revert if pool does not exist", async function () {
          await expect(
            Stake.connect(alice).claim(999)
          ).to.be.revertedWithCustomError(Stake, "Stake__PoolNotFound");
        });
      }); // Edge Cases
    }); // Claim Rewards

    describe("Bulk Reward Query", function () {
      beforeEach(async function () {
        // Create another pool
        await RewardToken.approve(Stake.target, REWARD_AMOUNT);
        await Stake.createPool(
          AnotherToken.target,
          RewardToken.target,
          REWARD_AMOUNT,
          REWARD_DURATION
        );

        // Alice stakes in both pools
        await AnotherToken.transfer(alice.address, STAKE_AMOUNT);
        await AnotherToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
        await Stake.connect(alice).stake(1, STAKE_AMOUNT);

        await time.increase(360);
      });

      it("should return bulk reward information", async function () {
        const results = await Stake.claimableRewardBulk(0, 2, alice.address);

        expect(results.length).to.equal(2);
        expect(results[0][0]).to.equal(0); // pool id
        expect(results[0][1]).to.be.gt(0); // claimable
        expect(results[0][2]).to.equal(0); // claimed

        expect(results[1][0]).to.equal(1); // pool id
        expect(results[1][1]).to.be.gt(0); // claimable
        expect(results[1][2]).to.equal(0); // claimed
      });

      it("should handle pagination correctly", async function () {
        const results = await Stake.claimableRewardBulk(0, 1, alice.address);
        expect(results.length).to.equal(1);
        expect(results[0][0]).to.equal(0);
      });

      it("should revert with invalid pagination", async function () {
        await expect(
          Stake.claimableRewardBulk(1, 0, alice.address)
        ).to.be.revertedWithCustomError(
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    }); // Bulk Reward Query
  }); // Rewards

  describe("Utility Functions", function () {
    beforeEach(async function () {
      // Create multiple pools
      await RewardToken.approve(Stake.target, REWARD_AMOUNT * 2n);
      await AnotherToken.approve(Stake.target, REWARD_AMOUNT);
      await Stake.createPool(
        StakingToken.target,
        RewardToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );
      await Stake.createPool(
        AnotherToken.target,
        RewardToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );
      await Stake.createPool(
        StakingToken.target,
        AnotherToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );
    });

    describe("Get Pools", function () {
      it("should return pools correctly", async function () {
        const pools = await Stake.getPools(0, 3);

        expect(pools.length).to.equal(3);
        expect(pools[0].stakingToken).to.equal(StakingToken.target);
        expect(pools[0].rewardToken).to.equal(RewardToken.target);
        expect(pools[1].stakingToken).to.equal(AnotherToken.target);
        expect(pools[1].rewardToken).to.equal(RewardToken.target);
        expect(pools[2].stakingToken).to.equal(StakingToken.target);
        expect(pools[2].rewardToken).to.equal(AnotherToken.target);
      });

      it("should handle pagination correctly", async function () {
        const pools = await Stake.getPools(1, 2);
        expect(pools.length).to.equal(1);
        expect(pools[0].stakingToken).to.equal(AnotherToken.target);
      });

      it("should revert with invalid pagination", async function () {
        await expect(Stake.getPools(2, 1)).to.be.revertedWithCustomError(
          Stake,
          "Stake__InvalidPaginationParameters"
        );
      });
    }); // Get Pools

    describe("Pool Status", function () {
      it("should return correct reward per second", async function () {
        const rewardPerSecond = await Stake.getRewardPerSecond(0);
        expect(rewardPerSecond).to.equal(
          REWARD_AMOUNT / BigInt(REWARD_DURATION)
        );
      });

      it("should return active status correctly", async function () {
        expect(await Stake.isPoolActive(0)).to.be.true;

        // Fast forward beyond reward duration
        await time.increase(REWARD_DURATION + 1);
        expect(await Stake.isPoolActive(0)).to.be.false;
      });
    }); // Pool Status

    describe("Pool Management", function () {
      it("should allow creator to deactivate pool", async function () {
        await expect(Stake.deactivatePool(0))
          .to.emit(Stake, "PoolDeactivated")
          .withArgs(0);

        const pool = await Stake.pools(0);
        expect(pool.active).to.be.false;
      });

      it("should prevent non-creator from deactivating pool", async function () {
        await expect(Stake.connect(alice).deactivatePool(0)).to.be.revertedWith(
          "Only creator can deactivate pool"
        );
      });
    }); // Pool Management
  }); // Utility Functions

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await RewardToken.approve(Stake.target, REWARD_AMOUNT);
      await Stake.createPool(
        StakingToken.target,
        RewardToken.target,
        REWARD_AMOUNT,
        REWARD_DURATION
      );
    });

    it("should handle reward duration completion", async function () {
      // Alice stakes
      await StakingToken.transfer(alice.address, STAKE_AMOUNT);
      await StakingToken.connect(alice).approve(Stake.target, STAKE_AMOUNT);
      await Stake.connect(alice).stake(0, STAKE_AMOUNT);

      // Fast forward beyond reward duration
      await time.increase(REWARD_DURATION + 1000);

      const [claimable] = await Stake.claimableReward(0, alice.address);

      // Should not exceed total reward amount
      expect(claimable).to.be.lte(REWARD_AMOUNT);
      expect(claimable).to.be.closeTo(REWARD_AMOUNT, wei(100)); // Allow for rounding
    });

    it("should handle zero staked amount", async function () {
      const [claimable] = await Stake.claimableReward(0, alice.address);
      expect(claimable).to.equal(0);
    });

    it("should return correct pool count", async function () {
      expect(await Stake.poolCount()).to.equal(1);
    });
  }); // Edge Cases

  describe("Version", function () {
    it("should return correct version", async function () {
      expect(await Stake.version()).to.equal("1.0.0");
    });
  }); // Version
}); // Stake
