const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { wei } = require("./utils/test-utils");

// Base mainnet addresses
const BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const UNIVERSAL_ROUTER_ADDRESS = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
const HUNT_ADDRESS = "0x37f0c2915CeCC7e977183B8543Fc0864d03E064C";
const TN100X_ADDRESS = "0x5B5dee44552546ECEA05EDeA01DCD7Be7aa6144A";
const CBBTC_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

// MC tokens
const SIGNET_ADDRESS = "0xDF2B673Ec06d210C8A8Be89441F8de60B5C679c9";
const MT_ADDRESS = "0xFf45161474C39cB00699070Dd49582e417b57a7E";

// Impersonated wallet
const WHALE = "0xCB3f3e0E992435390e686D7b638FCb8baBa6c5c7";

// UniversalRouter command constants
const V3_SWAP_EXACT_IN = 0x00;
const SWEEP = 0x04;

// Special address constants for UniversalRouter
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

/**
 * Encode a V3 swap path: token0 + fee + token1 + fee + token2 ...
 * Each token is 20 bytes, each fee is 3 bytes (uint24)
 */
function encodeV3Path(tokens, fees) {
  let encoded = "0x";
  for (let i = 0; i < tokens.length; i++) {
    encoded += tokens[i].slice(2).toLowerCase();
    if (i < fees.length) {
      encoded += fees[i].toString(16).padStart(6, "0");
    }
  }
  return encoded;
}

/**
 * Build UniversalRouter commands + inputs for a V3 exact-in swap.
 * Uses payerIsUser=false since ZapV2 transfers tokens to the router before calling execute.
 * Then SWEEP to send output tokens from router to a recipient.
 *
 * @param {string} recipient - who receives output (use ADDRESS_THIS for router, then sweep)
 * @param {bigint} amountIn - input amount (use ethers.MaxUint256 for CONTRACT_BALANCE)
 * @param {bigint} amountOutMin - minimum output
 * @param {string} path - encoded V3 path
 * @param {string} sweepToken - token to sweep from router to recipient
 * @param {string} sweepRecipient - final recipient of swept tokens
 */
function buildV3SwapCommands(amountIn, amountOutMin, path, sweepToken, sweepRecipient) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // Command 1: V3_SWAP_EXACT_IN - swap on router's balance, output stays in router
  const swapInput = abiCoder.encode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    [ADDRESS_THIS, amountIn, amountOutMin, path, false] // payerIsUser=false
  );

  // Command 2: SWEEP - send output token from router to recipient
  const sweepInput = abiCoder.encode(
    ["address", "address", "uint256"],
    [sweepToken, sweepRecipient, amountOutMin]
  );

  const commands = ethers.concat([
    new Uint8Array([V3_SWAP_EXACT_IN]),
    new Uint8Array([SWEEP]),
  ]);

  return { commands, inputs: [swapInput, sweepInput] };
}

describe("MCV2_ZapV2", function () {
  async function deployFixtures() {
    const [deployer, alice, bob] = await ethers.getSigners();

    const ZapV2 = await ethers.deployContract("MCV2_ZapV2", [
      BOND_ADDRESS,
      WETH_ADDRESS,
      UNIVERSAL_ROUTER_ADDRESS,
    ]);
    await ZapV2.waitForDeployment();

    const Bond = await ethers.getContractAt("MCV2_Bond", BOND_ADDRESS);
    const WETH = await ethers.getContractAt("IWETH", WETH_ADDRESS);
    const USDC = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    const HUNT = await ethers.getContractAt("IERC20", HUNT_ADDRESS);
    const TN100X = await ethers.getContractAt("IERC20", TN100X_ADDRESS);
    const MT = await ethers.getContractAt("IERC20", MT_ADDRESS);
    const SIGNET = await ethers.getContractAt("IERC20", SIGNET_ADDRESS);
    const cbBTC = await ethers.getContractAt("IERC20", CBBTC_ADDRESS);

    return { ZapV2, Bond, WETH, USDC, HUNT, TN100X, MT, SIGNET, cbBTC, deployer, alice, bob };
  }

  async function deployWithWhale() {
    const base = await deployFixtures();

    // Impersonate whale wallet
    await ethers.provider.send("hardhat_impersonateAccount", [WHALE]);
    const whale = await ethers.getSigner(WHALE);

    // Fund whale with ETH for gas
    await base.deployer.sendTransaction({ to: WHALE, value: wei(10) });

    return { ...base, whale };
  }

  let ZapV2, Bond, WETH, USDC, HUNT, TN100X, MT, SIGNET, cbBTC, deployer, alice, bob;

  beforeEach(async function () {
    ({ ZapV2, Bond, WETH, USDC, HUNT, TN100X, MT, SIGNET, cbBTC, deployer, alice, bob } =
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
      expect((await ZapV2.UNIVERSAL_ROUTER()).toLowerCase()).to.equal(UNIVERSAL_ROUTER_ADDRESS.toLowerCase());
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

  describe("zapMint (ETH → WETH reserve, no swap needed)", function () {
    let mcToken;

    beforeEach(async function () {
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
      const event = receipt.logs.find((log) => {
        try { return Bond.interface.parseLog(log)?.name === "TokenCreated"; }
        catch { return false; }
      });
      mcToken = Bond.interface.parseLog(event).args.token;
    });

    it("should mint MC tokens with ETH (no swap)", async function () {
      const inputAmount = wei(1, 15); // 0.001 ETH
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const balBefore = await MCToken.balanceOf(alice.address);

      await ZapV2.connect(alice).zapMint(
        mcToken,
        ethers.ZeroAddress, // ETH
        inputAmount,
        1, // minTokensOut
        "0x", // no commands (empty triggers direct wrap)
        [],
        0,
        alice.address,
        { value: inputAmount }
      );

      const balAfter = await MCToken.balanceOf(alice.address);
      expect(balAfter - balBefore).to.be.gt(0);
    });

    it("should refund leftover ETH", async function () {
      const inputAmount = wei(2, 15);
      const ethBefore = await ethers.provider.getBalance(alice.address);

      const tx = await ZapV2.connect(alice).zapMint(
        mcToken,
        ethers.ZeroAddress,
        inputAmount,
        1,
        "0x",
        [],
        0,
        alice.address,
        { value: inputAmount }
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      const totalSpent = ethBefore - ethAfter;
      expect(totalSpent).to.be.lte(inputAmount + gasCost);
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          mcToken,
          ethers.ZeroAddress,
          wei(1, 15),
          1,
          "0x",
          [],
          0,
          ethers.ZeroAddress,
          { value: wei(1, 15) }
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });

    it("should revert with zero amount", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          mcToken,
          ethers.ZeroAddress,
          0,
          1,
          "0x",
          [],
          0,
          alice.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidAmount");
    });

    it("should revert if msg.value != inputAmount for ETH", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          mcToken,
          ethers.ZeroAddress,
          wei(1),
          1,
          "0x",
          [],
          0,
          alice.address,
          { value: wei(1) - 1n }
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__MsgValueMismatch");
    });

    it("should revert if msg.value sent with ERC20 input", async function () {
      await expect(
        ZapV2.connect(alice).zapMint(
          mcToken,
          USDC_ADDRESS,
          wei(100, 6),
          1,
          "0x",
          [],
          0,
          alice.address,
          { value: wei(1) }
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__MsgValueMismatch");
    });
  });

  describe("zapBurn (WETH reserve → ETH, no swap needed)", function () {
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
      const event = receipt.logs.find((log) => {
        try { return Bond.interface.parseLog(log)?.name === "TokenCreated"; }
        catch { return false; }
      });
      mcToken = Bond.interface.parseLog(event).args.token;

      const inputAmount = wei(2, 15);
      await ZapV2.connect(alice).zapMint(
        mcToken,
        ethers.ZeroAddress,
        inputAmount,
        1,
        "0x",
        [],
        0,
        alice.address,
        { value: inputAmount }
      );

      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      await MCToken.connect(alice).approve(ZapV2.target, ethers.MaxUint256);
    });

    it("should burn MC tokens and receive ETH", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokenBalance = await MCToken.balanceOf(alice.address);
      const tokensToBurn = tokenBalance / 2n;
      const [refundAmount] = await Bond.getRefundForTokens(mcToken, tokensToBurn);

      const ethBefore = await ethers.provider.getBalance(bob.address);

      await ZapV2.connect(alice).zapBurn(
        mcToken,
        tokensToBurn,
        ethers.ZeroAddress,
        refundAmount,
        "0x",
        [],
        0,
        bob.address
      );

      const ethAfter = await ethers.provider.getBalance(bob.address);
      expect(ethAfter - ethBefore).to.equal(refundAmount);
    });

    it("should revert with slippage exceeded", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokenBalance = await MCToken.balanceOf(alice.address);
      const tokensToBurn = tokenBalance / 2n;
      const [refundAmount] = await Bond.getRefundForTokens(mcToken, tokensToBurn);

      await expect(
        ZapV2.connect(alice).zapBurn(
          mcToken,
          tokensToBurn,
          ethers.ZeroAddress,
          refundAmount + 1n,
          "0x",
          [],
          0,
          bob.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__SlippageLimitExceeded");
    });

    it("should revert with zero address receiver", async function () {
      await expect(
        ZapV2.connect(alice).zapBurn(
          mcToken,
          wei(100),
          ethers.ZeroAddress,
          0,
          "0x",
          [],
          0,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidReceiver");
    });

    it("should revert with zero burn amount", async function () {
      await expect(
        ZapV2.connect(alice).zapBurn(
          mcToken,
          0,
          ethers.ZeroAddress,
          0,
          "0x",
          [],
          0,
          alice.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__InvalidAmount");
    });
  });

  describe("zapMint with UniswapV3 swap (forked mainnet)", function () {
    let whale;

    beforeEach(async function () {
      const fixtures = await loadFixture(deployWithWhale);
      ({ ZapV2, Bond, WETH, USDC, HUNT, TN100X, MT, SIGNET, cbBTC, deployer, alice, bob, whale } = fixtures);
    });

    it("Test Case 1: Buy SIGNET with USDC (V3 multi-hop: USDC → WETH → HUNT → SIGNET)", async function () {
      const inputAmount = wei(5000, 6); // 5000 USDC (6 decimals)

      // Approve ZapV2 to spend USDC
      await USDC.connect(whale).approve(ZapV2.target, inputAmount);

      // V3 multi-hop path: USDC → WETH (fee 500) → HUNT (fee 3000)
      // USDC/HUNT has zero liquidity, so we route through WETH
      const path = encodeV3Path(
        [USDC_ADDRESS, WETH_ADDRESS, HUNT_ADDRESS],
        [500, 3000]
      );

      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3SwapCommands(
        ethers.MaxUint256, // CONTRACT_BALANCE - use all tokens transferred to router
        1n, // minOutputAmount (1 wei min, slippage handled by zapMint)
        path,
        HUNT_ADDRESS,
        zapV2Address
      );

      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const signetBefore = await SIGNET.balanceOf(whale.address);

      const tx = await ZapV2.connect(whale).zapMint(
        SIGNET_ADDRESS,
        USDC_ADDRESS,
        inputAmount,
        1n, // minTokensOut
        commands,
        inputs,
        deadline,
        whale.address
      );

      const receipt = await tx.wait();
      const signetAfter = await SIGNET.balanceOf(whale.address);
      const tokensReceived = signetAfter - signetBefore;

      console.log(`    SIGNET received: ${ethers.formatEther(tokensReceived)}`);
      expect(tokensReceived).to.be.gt(0);

      // Check ZapMint event
      const zapMintEvent = receipt.logs.find((log) => {
        try { return ZapV2.interface.parseLog(log)?.name === "ZapMint"; }
        catch { return false; }
      });
      expect(zapMintEvent).to.not.be.undefined;
    });

    it("Test Case 2: Buy MT with TN100X (V3 multi-hop: TN100X → WETH → HUNT → MT)", async function () {
      const inputAmount = wei(50000); // 50,000 TN100X (18 decimals)

      // Approve ZapV2 to spend TN100X
      await TN100X.connect(whale).approve(ZapV2.target, inputAmount);

      // V3 multi-hop path: TN100X → WETH (fee 3000) → HUNT (fee 3000)
      const path = encodeV3Path(
        [TN100X_ADDRESS, WETH_ADDRESS, HUNT_ADDRESS],
        [3000, 3000]
      );

      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3SwapCommands(
        ethers.MaxUint256, // CONTRACT_BALANCE
        1n,
        path,
        HUNT_ADDRESS,
        zapV2Address
      );

      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const mtBefore = await MT.balanceOf(whale.address);

      const tx = await ZapV2.connect(whale).zapMint(
        MT_ADDRESS,
        TN100X_ADDRESS,
        inputAmount,
        1n,
        commands,
        inputs,
        deadline,
        whale.address
      );

      const receipt = await tx.wait();
      const mtAfter = await MT.balanceOf(whale.address);
      const tokensReceived = mtAfter - mtBefore;

      console.log(`    MT received: ${ethers.formatEther(tokensReceived)}`);
      expect(tokensReceived).to.be.gt(0);
    });
  });

  describe("zapBurn with UniswapV3 swap (forked mainnet)", function () {
    let whale;

    beforeEach(async function () {
      const fixtures = await loadFixture(deployWithWhale);
      ({ ZapV2, Bond, WETH, USDC, HUNT, TN100X, MT, SIGNET, cbBTC, deployer, alice, bob, whale } = fixtures);
    });

    it("Test Case 3: Sell MT to cbBTC (V3 multi-hop: MT → HUNT → USDC → cbBTC)", async function () {
      const tokensToBurn = wei(10000); // 10,000 MT

      // Approve ZapV2 to spend MT
      await MT.connect(whale).approve(ZapV2.target, tokensToBurn);

      // V3 multi-hop path: HUNT → WETH (fee 3000) → cbBTC (fee 500)
      const path = encodeV3Path(
        [HUNT_ADDRESS, WETH_ADDRESS, CBBTC_ADDRESS],
        [3000, 500]
      );

      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3SwapCommands(
        ethers.MaxUint256, // CONTRACT_BALANCE
        1n,
        path,
        CBBTC_ADDRESS,
        zapV2Address
      );

      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const cbBTCBefore = await cbBTC.balanceOf(whale.address);

      const tx = await ZapV2.connect(whale).zapBurn(
        MT_ADDRESS,
        tokensToBurn,
        CBBTC_ADDRESS,
        1n, // minOutputAmount
        commands,
        inputs,
        deadline,
        whale.address
      );

      const receipt = await tx.wait();
      const cbBTCAfter = await cbBTC.balanceOf(whale.address);
      const cbBTCReceived = cbBTCAfter - cbBTCBefore;

      console.log(`    cbBTC received: ${ethers.formatUnits(cbBTCReceived, 8)}`);
      expect(cbBTCReceived).to.be.gt(0);
    });
  });

  describe("Admin functions", function () {
    describe("rescueETH", function () {
      it("should rescue ETH stuck in contract", async function () {
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
