const {
  loadFixture,
  impersonateAccount,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { wei } = require("./utils/test-utils");

const MINT = "0x1f3Af095CDa17d63cad238358837321e95FC5915";
const CREATOR = "0x9f3C60dC06f66b3e0ea1Eb05866F9c1A74d43D67";
const MINTDAO = "0x558810B46101DE82b579DD1950E9C717dCc28338";
const GRANT = "0x58764cE77f0140F9678bA6dED9D9697c979F4E0f";
const OP_FUND_ADDRESS = "0x5e74f8CC57a3A2d9718Cc98eD7f60D72b0159a14";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("MCV2_BuyBackBurner", function () {
  async function deployFixtures() {
    const [deployer, alice] = await ethers.getSigners();

    const BuyBackBurner = await ethers.deployContract("MCV2_BuyBackBurner");
    await BuyBackBurner.waitForDeployment();

    const Token = await ethers.getContractFactory("TestToken");
    const MintToken = await Token.attach(MINT);
    const CreatorToken = await Token.attach(CREATOR);
    const MintDaoToken = await Token.attach(MINTDAO);
    const GrantToken = await Token.attach(GRANT);

    const impersonatedAddress = "0xCB3f3e0E992435390e686D7b638FCb8baBa6c5c7";
    await impersonateAccount(impersonatedAddress);
    const burningAccount = await ethers.getSigner(impersonatedAddress);
    await MintToken.connect(burningAccount).approve(
      BuyBackBurner.target,
      wei(9999999999999)
    );

    return [
      BuyBackBurner,
      MintToken,
      CreatorToken,
      MintDaoToken,
      GrantToken,
      deployer,
      alice,
      burningAccount,
    ];
  }

  let BuyBackBurner,
    MintToken,
    CreatorToken,
    MintDaoToken,
    GrantToken,
    deployer,
    alice,
    burningAccount;

  beforeEach(async function () {
    [
      BuyBackBurner,
      MintToken,
      CreatorToken,
      MintDaoToken,
      GrantToken,
      deployer,
      alice,
      burningAccount,
    ] = await loadFixture(deployFixtures);
  });

  describe("Ownership", function () {
    it("should set the deployer as the owner", async function () {
      expect(await BuyBackBurner.owner()).to.equal(deployer.address);
    });

    it("should allow the owner to transfer ownership", async function () {
      await BuyBackBurner.transferOwnership(alice.address);
      expect(await BuyBackBurner.owner()).to.equal(alice.address);
    });

    it("should restrict non-owners from transferring ownership", async function () {
      await expect(
        BuyBackBurner.connect(alice).transferOwnership(alice.address)
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("Set Premium Price", function () {
    it("should allow the owner to set the premium price", async function () {
      const key =
        "token-page-customization-8453-nft-0x475f8E3eE5457f7B4AAca7E989D35418657AdF2a";
      await BuyBackBurner.setPremiumPrice(key, wei(50)); // 50 CREATOR
      expect(await BuyBackBurner.premiumPrice(key)).to.equal(wei(50));
    });

    it("should not allow non-owners to set the premium price", async function () {
      await expect(
        BuyBackBurner.connect(alice).setPremiumPrice("abcd", wei(50))
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("Set OP Fund Address", function () {
    it("should allow the owner to set the OP fund address", async function () {
      await BuyBackBurner.setOpFundAddress(alice.address);
      expect(await BuyBackBurner.OP_FUND_ADDRESS()).to.equal(alice.address);
    });

    it("should not allow non-owners to set the OP fund address", async function () {
      await expect(
        BuyBackBurner.connect(alice).setOpFundAddress(alice.address)
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("Purchase Premium", function () {
    beforeEach(async function () {
      await BuyBackBurner.setPremiumPrice("abcd", wei(50)); // 50 CREATOR

      this.creatorRequired = await BuyBackBurner.premiumPrice("abcd");
      this.estimatedMintRequired = await BuyBackBurner.estimateReserveAmountV1(
        CREATOR,
        this.creatorRequired
      );
      this.initialCreatorOnDeadAddress = await CreatorToken.balanceOf(
        DEAD_ADDRESS
      );
      this.initialMintTokenBalance = await MintToken.balanceOf(
        burningAccount.address
      );
    });

    describe("Normal flow", async function () {
      it("initial state should be false", async function () {
        expect(await BuyBackBurner.premiumEnabled("abcd")).to.be.false;
      });

      describe("After purchase", async function () {
        beforeEach(async function () {
          this.initialPremiumPurchasedCount =
            await BuyBackBurner.premiumPurchasedCount();
          await BuyBackBurner.connect(burningAccount).purchasePremium(
            "abcd",
            burningAccount.address,
            this.estimatedMintRequired
          );
        });

        it("should enable premium feature", async function () {
          expect(await BuyBackBurner.premiumEnabled("abcd")).to.be.true;
        });

        it("should deduct the correct amount of MINT tokens", async function () {
          expect(await MintToken.balanceOf(burningAccount.address)).to.equal(
            this.initialMintTokenBalance - this.estimatedMintRequired
          );
        });

        it("should burn the correct amount of CREATOR tokens", async function () {
          expect(await CreatorToken.balanceOf(DEAD_ADDRESS)).to.equal(
            this.initialCreatorOnDeadAddress + this.creatorRequired
          );
        });

        it("should increment premiumPurchasedCount", async function () {
          expect(await BuyBackBurner.premiumPurchasedCount()).to.equal(
            this.initialPremiumPurchasedCount + 1n
          );
        });
      }); // After purchase
    }); // Normal flow

    it("should emit PurchasePremium event", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const timestamp = latestBlock.timestamp;

      expect(
        await BuyBackBurner.connect(burningAccount).purchasePremium(
          "abcd",
          burningAccount.address,
          this.estimatedMintRequired
        )
      )
        .to.emit(BuyBackBurner, "PurchasePremium")
        .withArgs(
          "abcd",
          this.estimatedMintRequired,
          this.creatorRequired,
          burningAccount.address,
          timestamp
        );
    });

    describe("Edge cases", function () {
      it("should revert if premium price is not set", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).purchasePremium(
            "zzzzz",
            burningAccount.address,
            this.estimatedMintRequired
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__PremiumPriceNotSet"
        );
      });

      it("should revert if premium is already purchased", async function () {
        await BuyBackBurner.connect(burningAccount).purchasePremium(
          "abcd",
          burningAccount.address,
          this.estimatedMintRequired
        );
        await expect(
          BuyBackBurner.connect(burningAccount).purchasePremium(
            "abcd",
            burningAccount.address,
            this.estimatedMintRequired
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__PremiumAlreadyPurchased"
        );
      });

      it("should revert if mint required is more than maxMintTokenAmount", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).purchasePremium(
            "abcd",
            burningAccount.address,
            this.estimatedMintRequired - 1n
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__SlippageExceeded"
        );
      });
    }); // Edge cases
  }); // Purchase Premium

  describe("Buy back GRANT", function () {
    beforeEach(async function () {
      this.mintAmount = wei(10000000);
      this.initialGrantBalance = await GrantToken.balanceOf(OP_FUND_ADDRESS);
      this.estimatedGrantAmount = await BuyBackBurner.estimateTokenAmountV1(
        GRANT,
        this.mintAmount
      );
      this.initialMintTokenBalance = await MintToken.balanceOf(
        burningAccount.address
      );

      this.initialTotalGrantPurchased =
        await BuyBackBurner.totalGrantPurchased();
    });

    describe("Normal flow", function () {
      beforeEach(async function () {
        await BuyBackBurner.connect(burningAccount).buyBackGrant(
          this.mintAmount,
          this.estimatedGrantAmount
        );
      });

      it("should send GRANT tokens to the OP fund address", async function () {
        expect(await GrantToken.balanceOf(OP_FUND_ADDRESS)).to.equal(
          this.initialGrantBalance + this.estimatedGrantAmount
        );
      });

      it("should deduct MINT tokens from the purchasing account", async function () {
        expect(await MintToken.balanceOf(burningAccount.address)).to.equal(
          this.initialMintTokenBalance - this.mintAmount
        );
      });

      it("should increase totalGrantPurchased", async function () {
        expect(await BuyBackBurner.totalGrantPurchased()).to.equal(
          this.initialTotalGrantPurchased + this.estimatedGrantAmount
        );
      });
    }); // Normal flow

    it("should emit BuyBackGrant event", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const timestamp = latestBlock.timestamp;
      expect(
        await BuyBackBurner.connect(burningAccount).buyBackGrant(
          this.mintAmount,
          this.estimatedGrantAmount
        )
      )
        .to.emit(BuyBackBurner, "BuyBackGrant")
        .withArgs(this.mintAmount, this.estimatedGrantAmount, timestamp);
    });

    describe("Edge cases", function () {
      it("should revert if mint amount is 0", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackGrant(
            0,
            this.estimatedGrantAmount
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__InvalidAmount"
        );
      });

      it("should revert if mint amount is less than estimated grant amount", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackGrant(
            this.mintAmount,
            this.estimatedGrantAmount + 1n
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__SlippageExceeded"
        );
      });
    }); // Edge cases
  }); // Buy back GRANT

  describe("Buy back and burn MINTDAO", function () {
    beforeEach(async function () {
      this.mintAmount = wei(10000000);
      this.initialDaoOnDeadAddress = await MintDaoToken.balanceOf(DEAD_ADDRESS);
      this.estimatedMintDaoAmount = await BuyBackBurner.estimateTokenAmountV1(
        MINTDAO,
        this.mintAmount
      );
      this.initialMintTokenBalance = await MintToken.balanceOf(
        burningAccount.address
      );
    });

    describe("Normal flow", function () {
      beforeEach(async function () {
        await BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
          this.mintAmount,
          this.estimatedMintDaoAmount
        );
      });

      it("should burn MINTDAO tokens", async function () {
        expect(await MintDaoToken.balanceOf(DEAD_ADDRESS)).to.equal(
          this.initialDaoOnDeadAddress + this.estimatedMintDaoAmount
        );
      });

      it("should deduct MINT tokens from the purchasing account", async function () {
        expect(await MintToken.balanceOf(burningAccount.address)).to.equal(
          this.initialMintTokenBalance - this.mintAmount
        );
      });
    }); // Normal flow

    it("should emit BuyBackBurnMintDao event", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const timestamp = latestBlock.timestamp;
      expect(
        await BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
          this.mintAmount,
          this.estimatedMintDaoAmount
        )
      )
        .to.emit(BuyBackBurner, "BuyBackBurnMintDao")
        .withArgs(this.mintAmount, this.estimatedMintDaoAmount, timestamp);
    });

    describe("Edge cases", function () {
      it("should revert if mint amount is 0", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
            0,
            this.estimatedMintDaoAmount
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__InvalidAmount"
        );
      });

      it("should revert if mint amount is less than estimated mint dao amount", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
            this.mintAmount,
            this.estimatedMintDaoAmount + 1n
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__SlippageExceeded"
        );
      });
    }); // Edge cases
  }); // Buy back and burn MINTDAO

  describe("Utility functions", function () {
    it("should return the total amount of CREATOR and MINTDAO tokens burned", async function () {
      const creatorBalance =
        (await CreatorToken.balanceOf(CREATOR)) +
        (await CreatorToken.balanceOf(DEAD_ADDRESS));
      const mintDaoBalance =
        (await MintDaoToken.balanceOf(MINTDAO)) +
        (await MintDaoToken.balanceOf(DEAD_ADDRESS));
      const { totalCreatorBurned, totalMintDaoBurned } =
        await BuyBackBurner.getBurnedStats();

      expect(totalCreatorBurned).to.equal(creatorBalance);
      expect(totalMintDaoBurned).to.equal(mintDaoBalance);
    });
  }); // Utility functions
}); // MCV2_BuyBackBurner
