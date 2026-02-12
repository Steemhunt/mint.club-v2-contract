const {
  loadFixture,
  impersonateAccount,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { wei } = require("./utils/test-utils");

// Base mainnet addresses
const BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const UNIVERSAL_ROUTER_ADDRESS = "0x6ff5693b99212da76ad316178a184ab56d299b43"; // Uniswap V4 on Base

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// A known MC token on Base with WETH as reserve
// We'll find one dynamically or use a known one
const HUNT_BASE = "0x37f0c2915CeCC7e977183B8543Fc0864d03E064C";

describe("MCV2_ZapV2", function () {
  async function deployFixtures() {
    const [deployer, alice, bob] = await ethers.getSigners();

    const ZapV2 = await ethers.deployContract("MCV2_ZapV2", [
      BOND_ADDRESS,
      WETH_ADDRESS,
      UNIVERSAL_ROUTER_ADDRESS,
    ]);
    await ZapV2.waitForDeployment();

    const Bond = await ethers.getContractAt("IMCV2_Bond", BOND_ADDRESS);
    const WETH = await ethers.getContractAt("IWETH", WETH_ADDRESS);
    const USDC = await ethers.getContractAt("IERC20", USDC_ADDRESS);

    return { ZapV2, Bond, WETH, USDC, deployer, alice, bob };
  }

  let ZapV2, Bond, WETH, USDC, deployer, alice, bob;

  beforeEach(async function () {
    ({ ZapV2, Bond, WETH, USDC, deployer, alice, bob } =
      await loadFixture(deployFixtures));
  });

  describe("Deployment", function () {
    it("should set BOND address correctly", async function () {
      expect(await ZapV2.BOND()).to.equal(BOND_ADDRESS);
    });

    it("should set WETH address correctly", async function () {
      expect(await ZapV2.WETH()).to.equal(WETH_ADDRESS);
    });

    it("should set UNIVERSAL_ROUTER address correctly", async function () {
      expect(await ZapV2.UNIVERSAL_ROUTER()).to.equal(UNIVERSAL_ROUTER_ADDRESS);
    });

    it("should set deployer as owner", async function () {
      expect(await ZapV2.owner()).to.equal(deployer.address);
    });

    it("should revert with zero addresses", async function () {
      const ZapV2Factory = await ethers.getContractFactory("MCV2_ZapV2");
      await expect(
        ZapV2Factory.deploy(ethers.ZeroAddress, WETH_ADDRESS, UNIVERSAL_ROUTER_ADDRESS)
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidAddress");

      await expect(
        ZapV2Factory.deploy(BOND_ADDRESS, ethers.ZeroAddress, UNIVERSAL_ROUTER_ADDRESS)
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidAddress");

      await expect(
        ZapV2Factory.deploy(BOND_ADDRESS, WETH_ADDRESS, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidAddress");
    });
  });

  describe("mintWithEth (simple zap, no Uniswap)", function () {
    // Find a token with WETH as reserve on Base
    // We'll create one for testing
    let mcToken;

    beforeEach(async function () {
      // Create a test MC token with WETH as reserve via the Bond contract
      const creationFee = await Bond.creationFee();
      const symbol = "ZAPTEST" + Math.floor(Math.random() * 1000000);
      const tx = await Bond.createToken(
        { name: "Zap Test Token", symbol: symbol },
        {
          mintRoyalty: 0,
          burnRoyalty: 0,
          reserveToken: WETH_ADDRESS,
          maxSupply: wei(1000000),
          stepRanges: [wei(1000000)],
          stepPrices: [wei(1, 12)], // 0.000001 ETH per token
        },
        { value: creationFee }
      );
      const receipt = await tx.wait();
      // Get created token address from event
      const event = receipt.logs.find(
        (log) => {
          try {
            return Bond.interface.parseLog(log)?.name === "TokenCreated";
          } catch { return false; }
        }
      );
      mcToken = Bond.interface.parseLog(event).args.token;
    });

    it("should mint MC tokens with ETH", async function () {
      const tokensToMint = wei(100);
      const [reserveNeeded] = await Bond.getReserveForToken(mcToken, tokensToMint);

      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const balBefore = await MCToken.balanceOf(alice.address);

      await ZapV2.connect(alice).mintWithEth(mcToken, tokensToMint, alice.address, {
        value: reserveNeeded + wei(1, 15), // extra for safety
      });

      const balAfter = await MCToken.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(tokensToMint);
    });

    it("should refund leftover ETH", async function () {
      const tokensToMint = wei(100);
      const [reserveNeeded] = await Bond.getReserveForToken(mcToken, tokensToMint);
      const extraEth = wei(1, 15);

      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await ZapV2.connect(alice).mintWithEth(mcToken, tokensToMint, alice.address, {
        value: reserveNeeded + extraEth,
      });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      // Should have spent approximately reserveNeeded + gas, not reserveNeeded + extraEth + gas
      const ethSpent = ethBefore - ethAfter - gasCost;
      // ethSpent should be close to reserveNeeded (within dust)
      expect(ethSpent).to.be.closeTo(reserveNeeded, wei(1, 10));
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).mintWithEth(mcToken, wei(100), ethers.ZeroAddress, {
          value: wei(1),
        })
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });

    it("should revert with insufficient ETH", async function () {
      const tokensToMint = wei(100);
      await expect(
        ZapV2.connect(alice).mintWithEth(mcToken, tokensToMint, alice.address, {
          value: 1, // way too little
        })
      ).to.be.reverted;
    });
  });

  describe("burnToEth (simple zap, no Uniswap)", function () {
    let mcToken;

    beforeEach(async function () {
      const creationFee = await Bond.creationFee();
      const symbol = "ZAPBURN" + Math.floor(Math.random() * 1000000);
      const tx = await Bond.createToken(
        { name: "Zap Burn Test", symbol: symbol },
        {
          mintRoyalty: 0,
          burnRoyalty: 0,
          reserveToken: WETH_ADDRESS,
          maxSupply: wei(1000000),
          stepRanges: [wei(1000000)],
          stepPrices: [wei(1, 12)],
        },
        { value: creationFee }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => {
          try {
            return Bond.interface.parseLog(log)?.name === "TokenCreated";
          } catch { return false; }
        }
      );
      mcToken = Bond.interface.parseLog(event).args.token;

      // Mint some tokens first using mintWithEth
      const tokensToMint = wei(1000);
      const [reserveNeeded] = await Bond.getReserveForToken(mcToken, tokensToMint);
      await ZapV2.connect(alice).mintWithEth(mcToken, tokensToMint, alice.address, {
        value: reserveNeeded + wei(1, 15),
      });

      // Approve ZapV2 to spend MC tokens
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      await MCToken.connect(alice).approve(ZapV2.target, wei(1000));
    });

    it("should burn MC tokens and receive ETH", async function () {
      const tokensToBurn = wei(500);
      const [refundAmount] = await Bond.getRefundForTokens(mcToken, tokensToBurn);

      const ethBefore = await ethers.provider.getBalance(bob.address);
      await ZapV2.connect(alice).burnToEth(mcToken, tokensToBurn, refundAmount, bob.address);
      const ethAfter = await ethers.provider.getBalance(bob.address);

      expect(ethAfter - ethBefore).to.equal(refundAmount);
    });

    it("should revert with slippage exceeded", async function () {
      const tokensToBurn = wei(500);
      const [refundAmount] = await Bond.getRefundForTokens(mcToken, tokensToBurn);

      await expect(
        ZapV2.connect(alice).burnToEth(mcToken, tokensToBurn, refundAmount + 1n, bob.address)
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InsufficientOutputAmount");
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).burnToEth(mcToken, wei(100), 0, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });
  });

  describe("zapMint (with Uniswap swap)", function () {
    it("should revert with zero amount", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          ethers.ZeroAddress, // token (will fail for other reasons too)
          USDC_ADDRESS,
          0, // zero amount
          wei(100),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          alice.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidInputAmount");
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          ethers.ZeroAddress,
          USDC_ADDRESS,
          wei(100, 6),
          wei(100),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });

    it("should revert if msg.value sent with ERC20 input", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          ethers.ZeroAddress,
          USDC_ADDRESS,
          wei(100, 6),
          wei(100),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          alice.address,
          { value: wei(1) }
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__MsgValueMismatch");
    });

    it("should revert if insufficient ETH for ETH input", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          ethers.ZeroAddress,
          ETH_ADDRESS,
          wei(1),
          wei(100),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          alice.address,
          { value: wei(1) - 1n } // less than inputAmount
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__MsgValueMismatch");
    });
  });

  describe("zapBurn", function () {
    it("should revert with zero amount", async function () {
      await expect(
        ZapV2.connect(alice).zapBurn(
          ethers.ZeroAddress,
          0,
          USDC_ADDRESS,
          wei(100, 6),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          alice.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidInputAmount");
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).zapBurn(
          ethers.ZeroAddress,
          wei(100),
          USDC_ADDRESS,
          wei(100, 6),
          "0x",
          [],
          Math.floor(Date.now() / 1000) + 3600,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });
  });

  describe("Admin functions", function () {
    describe("rescueETH", function () {
      it("should rescue ETH stuck in contract", async function () {
        // Send ETH to contract
        await deployer.sendTransaction({
          to: ZapV2.target,
          value: wei(1),
        });

        const balBefore = await ethers.provider.getBalance(alice.address);
        await ZapV2.rescueETH(alice.address);
        const balAfter = await ethers.provider.getBalance(alice.address);

        expect(balAfter - balBefore).to.equal(wei(1));
      });

      it("should revert if no ETH to rescue", async function () {
        await expect(
          ZapV2.rescueETH(alice.address)
        ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__NothingToRescue");
      });

      it("should revert if not owner", async function () {
        await expect(
          ZapV2.connect(alice).rescueETH(alice.address)
        ).to.be.revertedWithCustomError(ZapV2, "OwnableUnauthorizedAccount");
      });

      it("should revert with zero address", async function () {
        await deployer.sendTransaction({
          to: ZapV2.target,
          value: wei(1),
        });
        await expect(
          ZapV2.rescueETH(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
      });
    });

    describe("rescueTokens", function () {
      it("should rescue ERC20 tokens stuck in contract", async function () {
        // Get some WETH and send to contract
        await WETH.deposit({ value: wei(1) });
        const wethToken = await ethers.getContractAt("IERC20", WETH_ADDRESS);
        await wethToken.transfer(ZapV2.target, wei(1));

        const balBefore = await wethToken.balanceOf(alice.address);
        await ZapV2.rescueTokens(WETH_ADDRESS, alice.address);
        const balAfter = await wethToken.balanceOf(alice.address);

        expect(balAfter - balBefore).to.equal(wei(1));
      });

      it("should revert if no tokens to rescue", async function () {
        await expect(
          ZapV2.rescueTokens(WETH_ADDRESS, alice.address)
        ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__NothingToRescue");
      });

      it("should revert if not owner", async function () {
        await expect(
          ZapV2.connect(alice).rescueTokens(WETH_ADDRESS, alice.address)
        ).to.be.revertedWithCustomError(ZapV2, "OwnableUnauthorizedAccount");
      });
    });
  });

  describe("ERC1155 receiver", function () {
    it("should return correct selector for onERC1155Received", async function () {
      const selector = await ZapV2.onERC1155Received(
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        0,
        "0x"
      );
      expect(selector).to.equal("0xf23a6e61");
    });
  });
});
