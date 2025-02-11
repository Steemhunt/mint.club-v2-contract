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

  describe("Contract initialization", function () {
    it("should have approved V1_BOND contract for max MINT tokens", async function () {
      const V1_BOND_ADDRESS = "0x8BBac0C7583Cc146244a18863E708bFFbbF19975";
      const allowance = await MintToken.allowance(
        BuyBackBurner.target,
        V1_BOND_ADDRESS
      );
      expect(allowance).to.equal(ethers.MaxUint256);
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

    it("should revert when setting zero address as OP fund address", async function () {
      await expect(
        BuyBackBurner.setOpFundAddress(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "MCV2_BuyBackBurner__InvalidAddress"
      );
    });
  }); // Set OP Fund Address

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

      this.initialStats = await BuyBackBurner.stats();
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

      it("should update stats correctly", async function () {
        const newStats = await BuyBackBurner.stats();
        expect(newStats.mintTokenSpent).to.equal(
          this.initialStats.mintTokenSpent + BigInt(this.mintAmount)
        );
        expect(newStats.grantPurchased).to.equal(
          this.initialStats.grantPurchased + BigInt(this.estimatedGrantAmount)
        );
      });

      it("should record history correctly", async function () {
        const historyIndex = (await BuyBackBurner.getHistoryCount()) - 1n;
        const lastHistory = await BuyBackBurner.history(historyIndex);

        expect(lastHistory.mintTokenAmount).to.equal(this.mintAmount);
        expect(lastHistory.tokenAmount).to.equal(this.estimatedGrantAmount);
        expect(lastHistory.token).to.equal(GRANT);
      });
    });

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
      this.initialStats = await BuyBackBurner.stats();
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

      it("should update stats correctly", async function () {
        const newStats = await BuyBackBurner.stats();
        expect(newStats.mintTokenSpent).to.equal(
          this.initialStats.mintTokenSpent + BigInt(this.mintAmount)
        );
        expect(newStats.mintDaoBurned).to.equal(
          this.initialStats.mintDaoBurned + BigInt(this.estimatedMintDaoAmount)
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

  describe("Buy back and burn CREATOR", function () {
    beforeEach(async function () {
      this.mintAmount = wei(10000000);
      this.initialCreatorOnDeadAddress = await CreatorToken.balanceOf(
        DEAD_ADDRESS
      );
      this.estimatedCreatorAmount = await BuyBackBurner.estimateTokenAmountV1(
        CREATOR,
        this.mintAmount
      );
      this.initialMintTokenBalance = await MintToken.balanceOf(
        burningAccount.address
      );
      this.initialStats = await BuyBackBurner.stats();
    });

    describe("Normal flow", function () {
      beforeEach(async function () {
        await BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
          this.mintAmount,
          this.estimatedCreatorAmount
        );
      });

      it("should burn CREATOR tokens", async function () {
        expect(await CreatorToken.balanceOf(DEAD_ADDRESS)).to.equal(
          this.initialCreatorOnDeadAddress + this.estimatedCreatorAmount
        );
      });

      it("should deduct MINT tokens from the purchasing account", async function () {
        expect(await MintToken.balanceOf(burningAccount.address)).to.equal(
          this.initialMintTokenBalance - this.mintAmount
        );
      });

      it("should update stats correctly", async function () {
        const newStats = await BuyBackBurner.stats();
        expect(newStats.mintTokenSpent).to.equal(
          this.initialStats.mintTokenSpent + BigInt(this.mintAmount)
        );
        expect(newStats.creatorBurned).to.equal(
          this.initialStats.creatorBurned + BigInt(this.estimatedCreatorAmount)
        );
      });
    });

    it("should emit BuyBackBurnCreator event", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const timestamp = latestBlock.timestamp;
      expect(
        await BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
          this.mintAmount,
          this.estimatedCreatorAmount
        )
      )
        .to.emit(BuyBackBurner, "BuyBackBurnCreator")
        .withArgs(this.mintAmount, this.estimatedCreatorAmount, timestamp);
    });

    describe("Edge cases", function () {
      it("should revert if mint amount is 0", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
            0,
            this.estimatedCreatorAmount
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__InvalidAmount"
        );
      });

      it("should revert if mint amount is less than estimated creator amount", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
            this.mintAmount,
            this.estimatedCreatorAmount + 1n
          )
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__SlippageExceeded"
        );
      });
    }); // Edge cases
  }); // Buy back and burn CREATOR

  describe("Utility functions", function () {
    it("should return the burned balances correctly", async function () {
      const { creatorBurnedBalance, mintDaoBurnedBalance } =
        await BuyBackBurner.getBurnedBalances();

      const expectedCreatorBurned =
        (await CreatorToken.balanceOf(CREATOR)) +
        (await CreatorToken.balanceOf(DEAD_ADDRESS));
      const expectedMintDaoBurned =
        (await MintDaoToken.balanceOf(MINTDAO)) +
        (await MintDaoToken.balanceOf(DEAD_ADDRESS));

      expect(creatorBurnedBalance).to.equal(expectedCreatorBurned);
      expect(mintDaoBurnedBalance).to.equal(expectedMintDaoBurned);
    });
  }); // Utility functions

  describe("History functions", function () {
    beforeEach(async function () {
      this.mintAmount = wei(1000000);
      // Create some history by performing operations
      await BuyBackBurner.connect(burningAccount).buyBackGrant(
        this.mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(GRANT, this.mintAmount)
      );
      await BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
        this.mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(MINTDAO, this.mintAmount)
      );
      await BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
        this.mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(CREATOR, this.mintAmount)
      );
    });

    it("should return correct history count", async function () {
      const count = await BuyBackBurner.getHistoryCount();
      expect(count).to.equal(3);
    });

    it("should return correct history slice", async function () {
      const historySlice = await BuyBackBurner.getHistory(0, 2);
      expect(historySlice.length).to.equal(2);

      // Verify first entry
      expect(historySlice[0].token).to.equal(GRANT);
      expect(historySlice[0].mintTokenAmount).to.equal(this.mintAmount);

      // Verify second entry
      expect(historySlice[1].token).to.equal(MINTDAO);
      expect(historySlice[1].mintTokenAmount).to.equal(this.mintAmount);
    });

    it("should handle out of bounds indices gracefully", async function () {
      const historySlice = await BuyBackBurner.getHistory(0, 999);
      expect(historySlice.length).to.equal(3); // Should return all entries
    });

    it("should revert with InvalidRange for invalid range", async function () {
      await expect(
        BuyBackBurner.getHistory(2, 1)
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "MCV2_BuyBackBurner__InvalidRange"
      );
    });
  });

  describe("Stats tracking", function () {
    it("should track cumulative stats correctly across multiple operations", async function () {
      const mintAmount = wei(1000000);
      const initialStats = await BuyBackBurner.stats();

      // Perform multiple operations
      await BuyBackBurner.connect(burningAccount).buyBackGrant(
        mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(GRANT, mintAmount)
      );
      await BuyBackBurner.connect(burningAccount).buyBackBurnMintDao(
        mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(MINTDAO, mintAmount)
      );
      await BuyBackBurner.connect(burningAccount).buyBackBurnCreator(
        mintAmount,
        await BuyBackBurner.estimateTokenAmountV1(CREATOR, mintAmount)
      );

      const finalStats = await BuyBackBurner.stats();

      // Verify stats are accumulated correctly
      expect(finalStats.mintTokenSpent).to.equal(
        initialStats.mintTokenSpent + BigInt(mintAmount) * 3n
      );
      expect(finalStats.mintDaoBurned).to.be.gt(initialStats.mintDaoBurned);
      expect(finalStats.creatorBurned).to.be.gt(initialStats.creatorBurned);
      expect(finalStats.grantPurchased).to.be.gt(initialStats.grantPurchased);
    });
  }); // History functions
}); // MCV2_BuyBackBurner
