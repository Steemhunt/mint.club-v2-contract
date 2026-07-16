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
const V3_SWAP_EXACT_OUT = 0x01;
const SWEEP = 0x04;
const WRAP_ETH = 0x0b;
const UNWRAP_WETH = 0x0c;

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
 * Uses exact amountIn and sends output directly to recipient (no SWEEP needed).
 *
 * @param {bigint} amountIn - exact input amount
 * @param {bigint} amountOutMin - minimum output
 * @param {string} path - encoded V3 path
 * @param {string} recipient - who receives the swap output
 */
function buildV3SwapCommands(amountIn, amountOutMin, path, recipient) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const swapInput = abiCoder.encode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    [recipient, amountIn, amountOutMin, path, false] // payerIsUser=false
  );

  const commands = new Uint8Array([V3_SWAP_EXACT_IN]);

  return { commands, inputs: [swapInput] };
}

/**
 * Build UniversalRouter commands + inputs for a V3 exact-output swap.
 * The path must be encoded in reverse order: output token → input token.
 * Unused prefunded input is swept back to ZapV2 for refunding.
 */
function buildV3ExactOutCommands(
  amountOut,
  amountInMax,
  path,
  inputToken,
  recipient
) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const swapInput = abiCoder.encode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    [recipient, amountOut, amountInMax, path, false]
  );
  const sweepInput = abiCoder.encode(
    ["address", "address", "uint256"],
    [inputToken, recipient, 0]
  );

  return {
    commands: new Uint8Array([V3_SWAP_EXACT_OUT, SWEEP]),
    inputs: [swapInput, sweepInput],
  };
}

/**
 * Build UniversalRouter commands for a native ETH exact-output swap.
 * Unused WETH is unwrapped and returned to ZapV2 as native ETH.
 */
function buildV3ExactOutWithEthCommands(
  amountOut,
  amountInMax,
  path,
  recipient
) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const wrapInput = abiCoder.encode(
    ["address", "uint256"],
    [UNIVERSAL_ROUTER_ADDRESS, amountInMax]
  );
  const swapInput = abiCoder.encode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    [recipient, amountOut, amountInMax, path, false]
  );
  const unwrapInput = abiCoder.encode(
    ["address", "uint256"],
    [recipient, 0]
  );

  return {
    commands: new Uint8Array([WRAP_ETH, V3_SWAP_EXACT_OUT, UNWRAP_WETH]),
    inputs: [wrapInput, swapInput, unwrapInput],
  };
}

function findEvent(receipt, contract, name) {
  const log = receipt.logs.find((item) => {
    try { return contract.interface.parseLog(item)?.name === name; }
    catch { return false; }
  });
  return contract.interface.parseLog(log).args;
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

    it("should mint an exact MC amount and refund unused ETH", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokensOut = wei(1000);
      const [reserveRequired] = await Bond.getReserveForToken(mcToken, tokensOut);
      const maxInputAmount = reserveRequired + wei(1, 15);
      const balanceBefore = await MCToken.balanceOf(bob.address);

      const tx = await ZapV2.connect(alice).zapMintExactOut(
        mcToken,
        ethers.ZeroAddress,
        tokensOut,
        maxInputAmount,
        "0x",
        [],
        0,
        bob.address,
        { value: maxInputAmount }
      );
      const event = findEvent(await tx.wait(), ZapV2, "ZapMint");

      expect((await MCToken.balanceOf(bob.address)) - balanceBefore).to.equal(tokensOut);
      expect(event.inputAmount).to.equal(reserveRequired);
      expect(event.tokensReceived).to.equal(tokensOut);
      expect(await ethers.provider.getBalance(ZapV2.target)).to.equal(0);
      expect(await WETH.balanceOf(ZapV2.target)).to.equal(0);
    });

    it("should mint an exact MC amount with the reserve token directly", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokensOut = wei(1000);
      const [reserveRequired] = await Bond.getReserveForToken(mcToken, tokensOut);
      const maxInputAmount = reserveRequired + wei(1, 15);

      await WETH.connect(alice).deposit({ value: maxInputAmount });
      await WETH.connect(alice).approve(ZapV2.target, maxInputAmount);
      const wethBefore = await WETH.balanceOf(alice.address);

      await ZapV2.connect(alice).zapMintExactOut(
        mcToken,
        WETH_ADDRESS,
        tokensOut,
        maxInputAmount,
        "0x",
        [],
        0,
        alice.address
      );

      expect(wethBefore - (await WETH.balanceOf(alice.address))).to.equal(
        reserveRequired
      );
      expect(await MCToken.balanceOf(alice.address)).to.equal(tokensOut);
      expect(await WETH.balanceOf(ZapV2.target)).to.equal(0);
    });

    it("should enforce max input for an exact MC amount", async function () {
      const tokensOut = wei(1000);
      const [reserveRequired] = await Bond.getReserveForToken(mcToken, tokensOut);

      await expect(
        ZapV2.connect(alice).zapMintExactOut(
          mcToken,
          ethers.ZeroAddress,
          tokensOut,
          reserveRequired - 1n,
          "0x",
          [],
          0,
          alice.address,
          { value: reserveRequired - 1n }
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__SlippageLimitExceeded");
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

    it("should burn MC tokens and receive the reserve token directly", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokensToBurn = (await MCToken.balanceOf(alice.address)) / 4n;
      const [refundAmount] = await Bond.getRefundForTokens(mcToken, tokensToBurn);
      const wethBefore = await WETH.balanceOf(bob.address);

      await ZapV2.connect(alice).zapBurn(
        mcToken,
        tokensToBurn,
        WETH_ADDRESS,
        refundAmount,
        "0x",
        [],
        0,
        bob.address
      );

      expect((await WETH.balanceOf(bob.address)) - wethBefore).to.equal(
        refundAmount
      );
    });

    it("should burn the minimum MC amount for an exact ETH output", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const outputAmount = wei(5, 14);
      const tokensToBurn = await ZapV2.estimateZapBurnExactOut(
        mcToken,
        outputAmount
      );
      const tokenBalanceBefore = await MCToken.balanceOf(alice.address);
      const ethBalanceBefore = await ethers.provider.getBalance(bob.address);

      const tx = await ZapV2.connect(alice).zapBurnExactOut(
        mcToken,
        tokensToBurn,
        ethers.ZeroAddress,
        outputAmount,
        outputAmount,
        "0x",
        [],
        0,
        bob.address
      );
      const event = findEvent(await tx.wait(), ZapV2, "ZapBurn");

      expect(tokenBalanceBefore - (await MCToken.balanceOf(alice.address))).to.equal(
        tokensToBurn
      );
      expect((await ethers.provider.getBalance(bob.address)) - ethBalanceBefore).to.equal(
        outputAmount
      );
      expect(event.outputAmount).to.equal(outputAmount);
    });

    it("should burn the minimum MC amount for an exact reserve output", async function () {
      const outputAmount = wei(5, 14);
      const tokensToBurn = await ZapV2.estimateZapBurnExactOut(
        mcToken,
        outputAmount
      );
      const wethBefore = await WETH.balanceOf(bob.address);

      await ZapV2.connect(alice).zapBurnExactOut(
        mcToken,
        tokensToBurn,
        WETH_ADDRESS,
        outputAmount,
        outputAmount,
        "0x",
        [],
        0,
        bob.address
      );

      expect((await WETH.balanceOf(bob.address)) - wethBefore).to.equal(
        outputAmount
      );
      expect(await WETH.balanceOf(ZapV2.target)).to.equal(0);
    });

    it("should enforce max burn for an exact ETH output", async function () {
      const outputAmount = wei(5, 14);
      const tokensToBurn = await ZapV2.estimateZapBurnExactOut(
        mcToken,
        outputAmount
      );

      await expect(
        ZapV2.connect(alice).zapBurnExactOut(
          mcToken,
          tokensToBurn - 1n,
          ethers.ZeroAddress,
          outputAmount,
          outputAmount,
          "0x",
          [],
          0,
          bob.address
        )
      ).to.be.revertedWithCustomError(ZapV2, "MCV2_ZapV2__SlippageLimitExceeded");
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

  describe("curve calculations on the forked Bond", function () {
    let mcToken;

    beforeEach(async function () {
      const creationFee = await Bond.creationFee();
      const symbol = "ZAPCURVE" + Math.floor(Math.random() * 1000000);
      const tx = await Bond.createToken(
        { name: "Zap Curve Test", symbol },
        {
          mintRoyalty: 100,
          burnRoyalty: 150,
          reserveToken: WETH_ADDRESS,
          maxSupply: wei(4000),
          stepRanges: [wei(1000), wei(2000), wei(4000)],
          stepPrices: [wei(1, 15), wei(2, 15), wei(4, 15)],
        },
        { value: creationFee }
      );
      const event = (await tx.wait()).logs.find((log) => {
        try { return Bond.interface.parseLog(log)?.name === "TokenCreated"; }
        catch { return false; }
      });
      mcToken = Bond.interface.parseLog(event).args.token;
    });

    it("should keep exact-input minting maximal across curve steps", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const inputAmount = wei(3);
      const [estimatedTokens, estimatedReserve] = await ZapV2.estimateZapMint(
        mcToken,
        inputAmount
      );
      const [nextReserve] = await Bond.getReserveForToken(
        mcToken,
        estimatedTokens + 1n
      );

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
      const event = findEvent(await tx.wait(), ZapV2, "ZapMint");

      expect(await MCToken.balanceOf(alice.address)).to.equal(estimatedTokens);
      expect(event.reserveUsed).to.equal(estimatedReserve);
      expect(estimatedReserve).to.be.lte(inputAmount);
      expect(nextReserve).to.be.gt(inputAmount);
    });

    it("should find the minimum burn across curve steps and royalty rounding", async function () {
      const MCToken = await ethers.getContractAt("IERC20", mcToken);
      const tokensOut = wei(3000);
      const [reserveRequired] = await Bond.getReserveForToken(mcToken, tokensOut);

      await ZapV2.connect(alice).zapMintExactOut(
        mcToken,
        ethers.ZeroAddress,
        tokensOut,
        reserveRequired,
        "0x",
        [],
        0,
        alice.address,
        { value: reserveRequired }
      );
      await MCToken.connect(alice).approve(ZapV2.target, tokensOut);

      const reserveTargets = [1n, wei(5, 17), wei(25, 17), wei(6)];
      for (const reserveTarget of reserveTargets) {
        const tokensToBurn = await ZapV2.estimateZapBurnExactOut(
          mcToken,
          reserveTarget
        );
        const [refund] = await Bond.getRefundForTokens(mcToken, tokensToBurn);

        expect(refund).to.be.gte(reserveTarget);
        if (tokensToBurn > 1n) {
          const [previousRefund] = await Bond.getRefundForTokens(
            mcToken,
            tokensToBurn - 1n
          );
          expect(previousRefund).to.be.lt(reserveTarget);
        }
      }
    });
  });

  describe("ERC1155 MC tokens on the forked Bond", function () {
    it("should reject direct transfers and support exact-output and exact-input ERC1155 burns", async function () {
      const creationFee = await Bond.creationFee();
      const symbol = `ZAP1155-${ZapV2.target.slice(2)}`;
      const tx = await Bond.createMultiToken(
        {
          name: "Zap Multi Token",
          symbol,
          uri: "https://example.com/{id}.json",
        },
        {
          mintRoyalty: 100n,
          burnRoyalty: 150n,
          reserveToken: WETH_ADDRESS,
          maxSupply: 100n,
          stepRanges: [20n, 50n, 100n],
          stepPrices: [wei(1, 15), wei(2, 15), wei(4, 15)],
        },
        { value: creationFee }
      );
      const event = (await tx.wait()).logs.find((log) => {
        try { return Bond.interface.parseLog(log)?.name === "MultiTokenCreated"; }
        catch { return false; }
      });
      const multiTokenAddress = Bond.interface.parseLog(event).args.token;
      const MultiToken = await ethers.getContractAt(
        "MCV2_MultiToken",
        multiTokenAddress
      );

      const tokensOut = 40n;
      const [reserveRequired] = await Bond.getReserveForToken(
        multiTokenAddress,
        tokensOut
      );
      await ZapV2.connect(alice).zapMintExactOut(
        multiTokenAddress,
        ethers.ZeroAddress,
        tokensOut,
        reserveRequired,
        "0x",
        [],
        0,
        alice.address,
        { value: reserveRequired }
      );
      expect(await MultiToken.balanceOf(alice.address, 0)).to.equal(tokensOut);

      await expect(
        MultiToken.connect(alice).safeTransferFrom(
          alice.address,
          ZapV2.target,
          0n,
          1n,
          "0x"
        )
      ).to.be.revertedWithCustomError(
        ZapV2,
        "MCV2_ZapV2__InvalidERC1155Transfer"
      );

      const [outputAmount] = await Bond.getRefundForTokens(
        multiTokenAddress,
        7n
      );
      const tokensToBurn = await ZapV2.estimateZapBurnExactOut(
        multiTokenAddress,
        outputAmount
      );
      await MultiToken.connect(alice).setApprovalForAll(ZapV2.target, true);
      const wethBefore = await WETH.balanceOf(bob.address);

      await ZapV2.connect(alice).zapBurnExactOut(
        multiTokenAddress,
        tokensToBurn,
        WETH_ADDRESS,
        outputAmount,
        outputAmount,
        "0x",
        [],
        0,
        bob.address
      );

      expect(tokensToBurn).to.equal(7n);
      expect(await MultiToken.balanceOf(alice.address, 0)).to.equal(
        tokensOut - tokensToBurn
      );
      expect((await WETH.balanceOf(bob.address)) - wethBefore).to.equal(
        outputAmount
      );

      const exactInputAmount = 5n;
      const [expectedRefund] = await Bond.getRefundForTokens(
        multiTokenAddress,
        exactInputAmount
      );
      const tokenBalanceBefore = await MultiToken.balanceOf(alice.address, 0);
      const wethBeforeExactInput = await WETH.balanceOf(bob.address);
      const exactInputTx = await ZapV2.connect(alice).zapBurn(
        multiTokenAddress,
        exactInputAmount,
        WETH_ADDRESS,
        expectedRefund,
        "0x",
        [],
        0,
        bob.address
      );
      const exactInputEvent = findEvent(
        await exactInputTx.wait(),
        ZapV2,
        "ZapBurn"
      );

      expect(
        tokenBalanceBefore - (await MultiToken.balanceOf(alice.address, 0))
      ).to.equal(exactInputAmount);
      expect(
        (await WETH.balanceOf(bob.address)) - wethBeforeExactInput
      ).to.equal(expectedRefund);
      expect(exactInputEvent.tokensBurned).to.equal(exactInputAmount);
      expect(exactInputEvent.outputAmount).to.equal(expectedRefund);
      expect(exactInputEvent.reserveReceived).to.equal(expectedRefund);
      expect(await MultiToken.balanceOf(ZapV2.target, 0)).to.equal(0);
      expect(await WETH.balanceOf(ZapV2.target)).to.equal(0);
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
        inputAmount, // exact amount (CONTRACT_BALANCE/MaxUint256 not supported)
        1n,
        path,
        zapV2Address // output goes directly to ZapV2
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
        inputAmount,
        1n,
        path,
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

    it("should buy an exact SIGNET amount with USDC and refund unused input", async function () {
      const tokensOut = wei(10000);
      const maxInputAmount = wei(5000, 6);
      const [reserveRequired] = await Bond.getReserveForToken(
        SIGNET_ADDRESS,
        tokensOut
      );

      await USDC.connect(whale).approve(ZapV2.target, maxInputAmount);

      // V3 exact-output paths are encoded in reverse: HUNT → WETH → USDC
      const path = encodeV3Path(
        [HUNT_ADDRESS, WETH_ADDRESS, USDC_ADDRESS],
        [3000, 500]
      );
      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3ExactOutCommands(
        reserveRequired,
        maxInputAmount,
        path,
        USDC_ADDRESS,
        zapV2Address
      );

      const usdcBefore = await USDC.balanceOf(whale.address);
      const signetBefore = await SIGNET.balanceOf(whale.address);
      const tx = await ZapV2.connect(whale).zapMintExactOut(
        SIGNET_ADDRESS,
        USDC_ADDRESS,
        tokensOut,
        maxInputAmount,
        commands,
        inputs,
        Math.floor(Date.now() / 1000) + 3600,
        whale.address
      );
      const event = findEvent(await tx.wait(), ZapV2, "ZapMint");
      const inputUsed = usdcBefore - (await USDC.balanceOf(whale.address));

      expect((await SIGNET.balanceOf(whale.address)) - signetBefore).to.equal(
        tokensOut
      );
      expect(inputUsed).to.be.gt(0);
      expect(inputUsed).to.be.lt(maxInputAmount);
      expect(event.inputAmount).to.equal(inputUsed);
      expect(event.reserveUsed).to.equal(reserveRequired);
      expect(await USDC.balanceOf(ZapV2.target)).to.equal(0);
      expect(await HUNT.balanceOf(ZapV2.target)).to.equal(0);
    });

    it("should buy an exact SIGNET amount with ETH and refund unused input", async function () {
      const tokensOut = wei(1000);
      const maxInputAmount = wei(1);
      const [reserveRequired] = await Bond.getReserveForToken(
        SIGNET_ADDRESS,
        tokensOut
      );

      // V3 exact-output paths are encoded in reverse: HUNT → WETH.
      const path = encodeV3Path(
        [HUNT_ADDRESS, WETH_ADDRESS],
        [3000]
      );
      const { commands, inputs } = buildV3ExactOutWithEthCommands(
        reserveRequired,
        maxInputAmount,
        path,
        ZapV2.target
      );

      const signetBefore = await SIGNET.balanceOf(alice.address);
      const tx = await ZapV2.connect(alice).zapMintExactOut(
        SIGNET_ADDRESS,
        ethers.ZeroAddress,
        tokensOut,
        maxInputAmount,
        commands,
        inputs,
        Math.floor(Date.now() / 1000) + 3600,
        alice.address,
        { value: maxInputAmount }
      );
      const event = findEvent(await tx.wait(), ZapV2, "ZapMint");

      expect((await SIGNET.balanceOf(alice.address)) - signetBefore).to.equal(
        tokensOut
      );
      expect(event.inputAmount).to.be.gt(0);
      expect(event.inputAmount).to.be.lt(maxInputAmount);
      expect(event.reserveUsed).to.equal(reserveRequired);
      expect(await ethers.provider.getBalance(ZapV2.target)).to.equal(0);
      expect(await WETH.balanceOf(ZapV2.target)).to.equal(0);
      expect(await HUNT.balanceOf(ZapV2.target)).to.equal(0);
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

      // Get the exact HUNT amount that will be received from burning
      const [refundAmount] = await Bond.getRefundForTokens(MT_ADDRESS, tokensToBurn);

      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3SwapCommands(
        refundAmount, // exact HUNT amount from burn
        1n,
        path,
        zapV2Address // output to ZapV2, which then forwards to receiver
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

    it("should sell MT for an exact cbBTC amount and refund unused reserve", async function () {
      const maxTokensIn = wei(5000);
      const outputAmount = 10000n; // 0.0001 cbBTC
      const [maxReserveAmount] = await Bond.getRefundForTokens(
        MT_ADDRESS,
        maxTokensIn
      );
      const estimatedTokens = await ZapV2.estimateZapBurnExactOut(
        MT_ADDRESS,
        maxReserveAmount
      );

      await MT.connect(whale).approve(ZapV2.target, maxTokensIn);

      // V3 exact-output paths are encoded in reverse: cbBTC → WETH → HUNT
      const path = encodeV3Path(
        [CBBTC_ADDRESS, WETH_ADDRESS, HUNT_ADDRESS],
        [500, 3000]
      );
      const zapV2Address = await ZapV2.getAddress();
      const { commands, inputs } = buildV3ExactOutCommands(
        outputAmount,
        maxReserveAmount,
        path,
        HUNT_ADDRESS,
        zapV2Address
      );

      const mtBefore = await MT.balanceOf(whale.address);
      const huntBefore = await HUNT.balanceOf(whale.address);
      const cbBTCBefore = await cbBTC.balanceOf(whale.address);
      const tx = await ZapV2.connect(whale).zapBurnExactOut(
        MT_ADDRESS,
        maxTokensIn,
        CBBTC_ADDRESS,
        outputAmount,
        maxReserveAmount,
        commands,
        inputs,
        Math.floor(Date.now() / 1000) + 3600,
        whale.address
      );
      const event = findEvent(await tx.wait(), ZapV2, "ZapBurn");

      expect((await cbBTC.balanceOf(whale.address)) - cbBTCBefore).to.equal(
        outputAmount
      );
      expect(mtBefore - (await MT.balanceOf(whale.address))).to.equal(
        estimatedTokens
      );
      expect((await HUNT.balanceOf(whale.address)) - huntBefore).to.be.gt(0);
      expect(event.tokensBurned).to.equal(estimatedTokens);
      expect(event.outputAmount).to.equal(outputAmount);
      expect(await HUNT.balanceOf(ZapV2.target)).to.equal(0);
      expect(await cbBTC.balanceOf(ZapV2.target)).to.equal(0);
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
    it("should accept single transfers initiated by ZapV2", async function () {
      const selector = await ZapV2.onERC1155Received(
        ZapV2.target,
        ethers.ZeroAddress,
        0,
        0,
        "0x"
      );
      expect(selector).to.equal("0xf23a6e61");
    });

    it("should reject batch transfers", async function () {
      await expect(
        ZapV2.onERC1155BatchReceived(
          ZapV2.target,
          ethers.ZeroAddress,
          [0n],
          [1n],
          "0x"
        )
      ).to.be.revertedWithCustomError(
        ZapV2,
        "MCV2_ZapV2__InvalidERC1155Transfer"
      );
    });
  });
});
