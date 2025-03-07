const {
  loadFixture,
  impersonateAccount,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { wei } = require("./utils/test-utils");

const HUNT = "0x37f0c2915CeCC7e977183B8543Fc0864d03E064C";
const MT = "0xFf45161474C39cB00699070Dd49582e417b57a7E";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";

describe("MCV2_BuyBackBurner", function () {
  async function deployFixtures() {
    const [deployer, alice] = await ethers.getSigners();

    const BuyBackBurner = await ethers.deployContract("MCV2_BuyBackBurner");
    await BuyBackBurner.waitForDeployment();

    const Token = await ethers.getContractFactory("TestToken");
    const HuntToken = await Token.attach(HUNT);
    const MtToken = await Token.attach(MT);

    // Get Bond contract instance
    const Bond = await ethers.getContractAt("IMCV2_Bond", BOND_ADDRESS);

    const impersonatedAddress = "0xCB3f3e0E992435390e686D7b638FCb8baBa6c5c7";
    await impersonateAccount(impersonatedAddress);
    const burningAccount = await ethers.getSigner(impersonatedAddress);
    await HuntToken.connect(burningAccount).approve(
      BuyBackBurner.target,
      wei(9999999999999)
    );

    return [
      BuyBackBurner,
      HuntToken,
      MtToken,
      Bond,
      deployer,
      alice,
      burningAccount,
    ];
  }

  let BuyBackBurner, HuntToken, MtToken, Bond, deployer, alice, burningAccount;

  beforeEach(async function () {
    [BuyBackBurner, HuntToken, MtToken, Bond, deployer, alice, burningAccount] =
      await loadFixture(deployFixtures);
  });

  describe("Contract initialization", function () {
    it("should have approved BOND contract for max HUNT tokens", async function () {
      const allowance = await HuntToken.allowance(
        BuyBackBurner.target,
        BOND_ADDRESS
      );
      expect(allowance).to.equal(ethers.MaxUint256);
    });
  });

  describe("Buy back and burn MT", function () {
    beforeEach(async function () {
      this.mtAmount = wei(1000); // 1000 MT tokens to burn
      this.fromChainId = 10; // Optimism chain ID
      this.initialMtOnDeadAddress = await MtToken.balanceOf(DEAD_ADDRESS);

      // Get the required HUNT amount for the MT amount using Bond fixture
      const [huntRequired] = await Bond.getReserveForToken(MT, this.mtAmount);
      this.huntAmount = huntRequired;

      this.initialHuntTokenBalance = await HuntToken.balanceOf(
        burningAccount.address
      );
      this.initialStats = await BuyBackBurner.stats();
    });

    describe("Normal flow", function () {
      beforeEach(async function () {
        await HuntToken.connect(burningAccount).approve(
          BuyBackBurner.target,
          this.huntAmount
        );
        await BuyBackBurner.connect(burningAccount).buyBackBurn(
          this.mtAmount,
          this.fromChainId
        );
      });

      it.only("should burn MT tokens", async function () {
        expect(await MtToken.balanceOf(DEAD_ADDRESS)).to.equal(
          this.initialMtOnDeadAddress + this.mtAmount
        );
      });

      it("should deduct HUNT tokens from the purchasing account", async function () {
        expect(await HuntToken.balanceOf(burningAccount.address)).to.equal(
          this.initialHuntTokenBalance - this.huntAmount
        );
      });

      it("should update stats correctly", async function () {
        const newStats = await BuyBackBurner.stats();
        expect(newStats.totalHuntSpent).to.equal(
          this.initialStats.totalHuntSpent + BigInt(this.huntAmount)
        );
        expect(newStats.totalMtBurned).to.equal(
          this.initialStats.totalMtBurned + BigInt(this.mtAmount)
        );
      });
    }); // Normal flow

    it("should emit BuyBackBurn event", async function () {
      expect(
        await BuyBackBurner.connect(burningAccount).buyBackBurn(
          this.mtAmount,
          this.fromChainId
        )
      )
        .to.emit(BuyBackBurner, "BuyBackBurn")
        .withArgs(this.huntAmount, this.mtAmount, this.fromChainId);
    });

    describe("Edge cases", function () {
      it("should revert if mt amount is 0", async function () {
        await expect(
          BuyBackBurner.connect(burningAccount).buyBackBurn(0, this.fromChainId)
        ).to.be.revertedWithCustomError(
          BuyBackBurner,
          "MCV2_BuyBackBurner__InvalidParams"
        );
      });

      it("should revert if MT amount to burn is 0", async function () {
        // Mock a scenario where getTokensForReserve returns 0
        const mockBuyBackBurner = await ethers.deployContract(
          "MockBuyBackBurner",
          {
            returnZeroAmount: true,
          }
        );

        await expect(
          mockBuyBackBurner
            .connect(burningAccount)
            .buyBackBurn(this.mtAmount, this.fromChainId)
        ).to.be.revertedWithCustomError(
          mockBuyBackBurner,
          "MCV2_BuyBackBurner__ZeroAmount"
        );
      });

      it("should revert if swap is invalid", async function () {
        // Mock a scenario where HUNT balance is not 0 after swap
        const mockBuyBackBurner = await ethers.deployContract(
          "MockBuyBackBurner",
          {
            invalidSwap: true,
          }
        );

        await expect(
          mockBuyBackBurner
            .connect(burningAccount)
            .buyBackBurn(this.mtAmount, this.fromChainId)
        ).to.be.revertedWithCustomError(
          mockBuyBackBurner,
          "MCV2_BuyBackBurner__InvalidSwap"
        );
      });
    }); // Edge cases
  }); // Buy back and burn MT

  describe("History functions", function () {
    beforeEach(async function () {
      this.mtAmount = wei(1000); // 1000 MT tokens to burn
      this.fromChainId = 10; // Optimism chain ID

      // Create some history by performing operations
      await BuyBackBurner.connect(burningAccount).buyBackBurn(
        this.mtAmount,
        this.fromChainId
      );

      await BuyBackBurner.connect(burningAccount).buyBackBurn(
        this.mtAmount * 2n,
        this.fromChainId
      );

      await BuyBackBurner.connect(burningAccount).buyBackBurn(
        this.mtAmount / 2n,
        this.fromChainId
      );
    });

    it("should return correct history count", async function () {
      const count = await BuyBackBurner.getHistoryCount();
      expect(count).to.equal(3);
    });

    it("should return correct history slice", async function () {
      const historySlice = await BuyBackBurner.getHistory(0, 2);
      expect(historySlice.length).to.equal(2);

      // Verify entries based on MT amounts, not HUNT amounts
      expect(historySlice[0].mtBurned).to.equal(this.mtAmount);
      expect(historySlice[0].fromChainId).to.equal(this.fromChainId);

      expect(historySlice[1].mtBurned).to.equal(this.mtAmount * 2n);
      expect(historySlice[1].fromChainId).to.equal(this.fromChainId);
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
      const mtAmount = wei(2000);
      const fromChainId = 10;
      const initialStats = await BuyBackBurner.stats();

      // Get the required HUNT amount for the MT amount using Bond fixture
      const [huntRequired1] = await Bond.getReserveForToken(MT, mtAmount);

      // Perform multiple operations
      await BuyBackBurner.connect(burningAccount).buyBackBurn(
        mtAmount,
        fromChainId
      );

      const [huntRequired2] = await Bond.getReserveForToken(MT, mtAmount * 2n);

      await BuyBackBurner.connect(burningAccount).buyBackBurn(
        mtAmount * 2n,
        fromChainId
      );

      const finalStats = await BuyBackBurner.stats();

      // Verify stats are accumulated correctly
      expect(finalStats.totalMtBurned).to.equal(
        initialStats.totalMtBurned + BigInt(mtAmount) + BigInt(mtAmount) * 2n
      );
      expect(finalStats.totalHuntSpent).to.be.gt(initialStats.totalHuntSpent);
    });
  }); // Stats tracking

  describe("Fallback and receive functions", function () {
    it("should revert when receiving ETH with no data", async function () {
      await expect(
        deployer.sendTransaction({
          to: BuyBackBurner.target,
          value: ethers.parseEther("1.0"),
        })
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "MCV2_BuyBackBurner__InvalidOperation"
      );
    });

    it("should revert when calling non-existent function", async function () {
      await expect(
        deployer.sendTransaction({
          to: BuyBackBurner.target,
          data: "0x12345678", // Random function selector
        })
      ).to.be.revertedWithCustomError(
        BuyBackBurner,
        "MCV2_BuyBackBurner__InvalidOperation"
      );
    });
  }); // Fallback and receive functions
}); // MCV2_BuyBackBurner
