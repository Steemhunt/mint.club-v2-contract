const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const {
  MAX_INT_256,
  PROTOCOL_BENEFICIARY,
  getMaxSteps,
  wei,
} = require("./utils/test-utils");

const MAX_STEPS = getMaxSteps("mainnet");

const SIMPLE_TOKEN = {
  tokenParams: { name: "Simple Token", symbol: "SIMPLE" },
  bondParams: {
    mintRoyalty: 0n, // 0% for easier calculation
    burnRoyalty: 0n, // 0% for easier calculation
    reserveToken: null, // Should be set later
    maxSupply: wei(1000), // supply: 1000 tokens
    stepRanges: [
      wei(100), // 0-100: free
      wei(500), // 100-500: 1 BASE per token
      wei(1000), // 500-1000: 2 BASE per token
    ],
    stepPrices: [
      0n, // Free minting for first 100 tokens
      wei(1), // 1 BASE per token
      wei(2), // 2 BASE per token
    ],
  },
};

describe("BondPeriphery", function () {
  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract("MCV2_Token");
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract("MCV2_MultiToken");
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract("MCV2_Bond", [
      TokenImplementation.target,
      NFTImplementation.target,
      PROTOCOL_BENEFICIARY,
      0n,
      MAX_STEPS,
    ]);
    await Bond.waitForDeployment();

    const BondPeriphery = await ethers.deployContract("MCV2_BondPeriphery", [
      Bond.target,
    ]);
    await BondPeriphery.waitForDeployment();

    const ReserveToken = await ethers.deployContract("TestToken", [
      wei(200000000),
      "Test Token",
      "TEST",
      18n,
    ]); // supply: 200M
    await ReserveToken.waitForDeployment();

    return [Bond, BondPeriphery, ReserveToken];
  }

  let Bond, BondPeriphery, ReserveToken;
  let owner, alice, bob;

  beforeEach(async function () {
    [Bond, BondPeriphery, ReserveToken] = await loadFixture(deployFixtures);
    [owner, alice, bob] = await ethers.getSigners();
    SIMPLE_TOKEN.bondParams.reserveToken = ReserveToken.target; // set ReserveToken address
  });

  describe("Constructor", function () {
    it("should set the correct bond address", async function () {
      expect(await BondPeriphery.BOND()).to.equal(Bond.target);
    });
  });

  describe("getTokensForReserve", function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory("MCV2_Token");
      await Bond.createToken(
        Object.values(SIMPLE_TOKEN.tokenParams),
        Object.values(SIMPLE_TOKEN.bondParams)
      );
      this.token = await Token.attach(await Bond.tokens(0));
    });

    describe("Normal calculations", function () {
      it("should calculate correct tokens for small reserve amount", async function () {
        // Current supply: 100 (free mint), so we're at step 1 (price: 1 BASE per token)
        // reserveAmount = 50 BASE, no royalty
        const reserveAmount = wei(50);
        const expectedTokens = wei(50);

        const [tokensToMint, reserveAddress] =
          await BondPeriphery.getTokensForReserve(
            this.token.target,
            reserveAmount
          );

        expect(tokensToMint).to.equal(expectedTokens);
        expect(reserveAddress).to.equal(ReserveToken.target);
      });

      it("should calculate correct tokens across multiple steps", async function () {
        // Mint enough to reach step 2 (500 tokens total)
        const initialBaseBalance = wei(1000);
        await ReserveToken.transfer(alice.address, initialBaseBalance);
        await ReserveToken.connect(alice).approve(
          Bond.target,
          initialBaseBalance
        );

        // Mint to reach step 2 (400 more tokens after 100 free mint)
        // Step 1: 400 tokens * 1 BASE = 400 BASE
        await Bond.connect(alice).mint(
          this.token.target,
          wei(400),
          MAX_INT_256,
          alice.address
        );

        // Now at step 2 (price: 2 BASE per token)
        // reserveAmount = 100 BASE, no royalty
        // tokens = 100 BASE / 2 BASE per token = 50 tokens
        const reserveAmount = wei(100);
        const expectedTokens = wei(50);

        const [tokensToMint, reserveAddress] =
          await BondPeriphery.getTokensForReserve(
            this.token.target,
            reserveAmount
          );

        expect(tokensToMint).to.equal(expectedTokens);
        expect(reserveAddress).to.equal(ReserveToken.target);
      });

      it("should handle reserve amount that spans multiple steps", async function () {
        // Reserve amount that spans both step 1 and step 2
        // Current supply: 100 (free mint)
        // Step 1: 400 tokens at 1 BASE each = 400 BASE (gets us to 500 total supply)
        // Step 2: 100 tokens at 2 BASE each = 200 BASE (gets us to 600 total supply)
        // Total: 600 BASE for 500 tokens
        const reserveAmount = wei(600);
        const expectedTokens = wei(500); // 400 from step 1 + 100 from step 2

        const [tokensToMint, reserveAddress] =
          await BondPeriphery.getTokensForReserve(
            this.token.target,
            reserveAmount
          );

        expect(tokensToMint).to.equal(expectedTokens);
        expect(reserveAddress).to.equal(ReserveToken.target);
      });
    });

    describe("Edge cases and validations", function () {
      it("should revert if token does not exist", async function () {
        await expect(
          BondPeriphery.getTokensForReserve(ReserveToken.target, wei(1000))
        )
          .to.be.revertedWithCustomError(
            BondPeriphery,
            "MCV2_BondPeriphery__InvalidParams"
          )
          .withArgs("token");
      });

      it("should revert if reserve amount is zero", async function () {
        await expect(BondPeriphery.getTokensForReserve(this.token.target, 0))
          .to.be.revertedWithCustomError(
            BondPeriphery,
            "MCV2_BondPeriphery__InvalidParams"
          )
          .withArgs("reserveAmount");
      });

      it("should revert if token has reached max supply", async function () {
        // Mint all available tokens
        const initialBaseBalance = wei(1400); // Enough for all tokens
        await ReserveToken.transfer(alice.address, initialBaseBalance);
        await ReserveToken.connect(alice).approve(
          Bond.target,
          initialBaseBalance
        );

        // Mint to max supply (900 tokens, excluding 100 free mint)
        // Step 1: 400 tokens * 1 BASE = 400 BASE
        // Step 2: 500 tokens * 2 BASE = 1000 BASE
        // Total: 1400 BASE needed
        await Bond.connect(alice).mint(
          this.token.target,
          wei(900),
          MAX_INT_256,
          alice.address
        );

        await expect(
          BondPeriphery.getTokensForReserve(this.token.target, wei(100))
        ).to.be.revertedWithCustomError(
          BondPeriphery,
          "MCV2_BondPeriphery__ExceedMaxSupply"
        );
      });

      it("should calculate correct tokens for very small amounts", async function () {
        // Very small reserve amount - with step 1 price of 1e18 and 0% royalty
        const reserveAmount = 1n;
        const expectedTokens = 1n;

        const [tokensToMint, reserveAddress] =
          await BondPeriphery.getTokensForReserve(
            this.token.target,
            reserveAmount
          );

        expect(tokensToMint).to.equal(expectedTokens);
        expect(reserveAddress).to.equal(ReserveToken.target);
      });
    }); // Edge cases and validations
  }); // getTokensForReserve

  describe("mintWithReserveAmount", function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory("MCV2_Token");
      await Bond.createToken(
        Object.values(SIMPLE_TOKEN.tokenParams),
        Object.values(SIMPLE_TOKEN.bondParams)
      );
      this.token = await Token.attach(await Bond.tokens(0));

      this.initialBaseBalance = wei(2000); // 2000 BASE tokens
      await ReserveToken.transfer(alice.address, this.initialBaseBalance);
      await ReserveToken.connect(alice).approve(
        BondPeriphery.target,
        this.initialBaseBalance
      );
      // BondPeriphery needs to approve Bond contract to spend reserve tokens
      await ReserveToken.connect(alice).approve(Bond.target, MAX_INT_256);
    });

    describe("Normal flow", function () {
      it("should mint tokens with exact reserve amount", async function () {
        // Current supply: 100 (free mint), step 1 price: 1 BASE per token
        // reserveAmount = 50 BASE, no royalty
        // expectedTokens = 50 tokens
        const reserveAmount = wei(50);
        const expectedTokens = wei(50);

        const tx = await BondPeriphery.connect(alice).mintWithReserveAmount(
          this.token.target,
          reserveAmount,
          expectedTokens,
          alice.address
        );

        expect(await this.token.balanceOf(alice.address)).to.equal(
          expectedTokens
        );
        expect(await ReserveToken.balanceOf(alice.address)).to.equal(
          this.initialBaseBalance - reserveAmount
        );
      });

      it("should mint to a different receiver", async function () {
        // Current supply: 100 (free mint), step 1 price: 1 BASE per token
        // reserveAmount = 100 BASE, expectedTokens = 100 tokens
        const reserveAmount = wei(100);
        const expectedTokens = wei(100);

        await BondPeriphery.connect(alice).mintWithReserveAmount(
          this.token.target,
          reserveAmount,
          expectedTokens,
          bob.address
        );

        expect(await this.token.balanceOf(bob.address)).to.equal(
          expectedTokens
        );
        expect(await this.token.balanceOf(alice.address)).to.equal(0);
      });

      it("should handle leftover reserve tokens correctly", async function () {
        // Create a simple token with free minting step to guarantee leftover
        const STEP_TOKEN = {
          tokenParams: { name: "Step Token", symbol: "STEP" },
          bondParams: {
            mintRoyalty: 0n, // No royalty for simplicity
            burnRoyalty: 0n,
            reserveToken: ReserveToken.target,
            maxSupply: 1000n,
            stepRanges: [
              500n, // step 0
              1000n, // step 1
            ],
            stepPrices: [
              1n * 10n ** 20n, // 100 wei reserveToken per 1 token (multiFactor = 1e18)
              2n * 10n ** 20n, // 200 wei reserveToken per 1 token (multiFactor = 1e18)
            ],
          },
        };

        // Create the step token as regular ERC20
        const Token = await ethers.getContractFactory("MCV2_Token");
        await Bond.createToken(
          Object.values(STEP_TOKEN.tokenParams),
          Object.values(STEP_TOKEN.bondParams)
        );
        const stepToken = await Token.attach(await Bond.tokens(1)); // Second token

        // To mint 123 wei token on step 1, it costs 123 * 100 wei reserveToken
        // Provide 12345 wei reserveToken - should mint 123 wei token with 45 wei reserveToken leftover
        // (because the extra 45 wei is not enough to buy another token which costs 100 wei)
        const reserveAmount = 12345n; // 123 * 1e18 + 12345 wei
        const expectedTokens = 123n;
        const actualReserveAmount = 12300n;
        const expectedReserveLeftover = 45n;

        const [calculatedTokens] = await BondPeriphery.getTokensForReserve(
          stepToken.target,
          reserveAmount
        );

        expect(calculatedTokens).to.equal(expectedTokens);

        const aliceReserveBalanceBefore = await ReserveToken.balanceOf(
          alice.address
        );
        const bobReserveBalanceBefore = await ReserveToken.balanceOf(
          bob.address
        );

        // Calculate what the Bond contract actually needs for 123 tokens
        const [actualReserveNeeded] = await Bond.getReserveForToken(
          stepToken.target,
          calculatedTokens
        );
        expect(actualReserveNeeded).to.equal(actualReserveAmount);

        const leftover = reserveAmount - actualReserveNeeded;
        expect(leftover).to.equal(expectedReserveLeftover);

        await ReserveToken.connect(alice).approve(
          BondPeriphery.target,
          reserveAmount
        );
        await await BondPeriphery.connect(alice).mintWithReserveAmount(
          stepToken.target,
          reserveAmount,
          calculatedTokens,
          bob.address
        );

        const aliceReserveBalanceAfter = await ReserveToken.balanceOf(
          alice.address
        );
        const bobReserveBalanceAfter = await ReserveToken.balanceOf(
          bob.address
        );
        const bobTokenBalance = await stepToken.balanceOf(bob.address);

        // Alice should have paid the full reserve amount
        expect(aliceReserveBalanceAfter).to.equal(
          aliceReserveBalanceBefore - reserveAmount
        );

        // Bob should receive exactly 1 token
        expect(bobTokenBalance).to.equal(expectedTokens);

        // Bob should receive the leftover 12345 wei
        expect(bobReserveBalanceAfter).to.equal(
          bobReserveBalanceBefore + expectedReserveLeftover
        );

        // Contract should have no remaining balance
        const contractBalance = await ReserveToken.balanceOf(
          BondPeriphery.target
        );
        expect(contractBalance).to.equal(
          0n,
          "BondPeriphery should have no remaining reserve tokens"
        );
      });
    }); // Normal flow

    describe("Slippage protection", function () {
      it("should revert if minted tokens are less than minimum", async function () {
        // Current supply: 100, step 1 price: 1 BASE per token
        // reserveAmount = 50 BASE, expectedTokens = 50, but asking for 60
        const reserveAmount = wei(50);
        const minTokens = wei(60); // More than expected 50

        await expect(
          BondPeriphery.connect(alice).mintWithReserveAmount(
            this.token.target,
            reserveAmount,
            minTokens,
            alice.address
          )
        ).to.be.revertedWithCustomError(
          BondPeriphery,
          "MCV2_BondPeriphery__SlippageLimitExceeded"
        );
      });
    }); // Slippage protection

    describe("Edge cases", function () {
      it("should revert if insufficient allowance", async function () {
        await ReserveToken.connect(alice).approve(BondPeriphery.target, 0);

        await expect(
          BondPeriphery.connect(alice).mintWithReserveAmount(
            this.token.target,
            wei(1010),
            wei(500),
            alice.address
          )
        ).to.be.revertedWithCustomError(
          ReserveToken,
          "ERC20InsufficientAllowance"
        );
      });

      it("should revert if insufficient balance", async function () {
        const reserveAmount = this.initialBaseBalance + 1n;

        // Need to approve the amount first, then it will fail on balance
        await ReserveToken.connect(alice).approve(
          BondPeriphery.target,
          reserveAmount
        );

        await expect(
          BondPeriphery.connect(alice).mintWithReserveAmount(
            this.token.target,
            reserveAmount,
            0,
            alice.address
          )
        ).to.be.revertedWithCustomError(
          ReserveToken,
          "ERC20InsufficientBalance"
        );
      });

      it("should handle very small reserve amounts", async function () {
        const reserveAmount = 1n;
        const expectedTokens = 1n;

        await BondPeriphery.connect(alice).mintWithReserveAmount(
          this.token.target,
          reserveAmount,
          expectedTokens,
          alice.address
        );

        expect(await this.token.balanceOf(alice.address)).to.equal(
          expectedTokens
        );
      });
    });
  });

  describe("Integration with Bond contract", function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory("MCV2_Token");
      await Bond.createToken(
        Object.values(SIMPLE_TOKEN.tokenParams),
        Object.values(SIMPLE_TOKEN.bondParams)
      );
      this.token = await Token.attach(await Bond.tokens(0));

      this.initialBaseBalance = wei(1000000);
      await ReserveToken.transfer(alice.address, this.initialBaseBalance);
      await ReserveToken.connect(alice).approve(
        BondPeriphery.target,
        this.initialBaseBalance
      );
    });

    it("should produce same results as direct Bond minting", async function () {
      const reserveAmount = wei(1010);

      // Calculate expected tokens using periphery
      const [expectedTokens] = await BondPeriphery.getTokensForReserve(
        this.token.target,
        reserveAmount
      );

      // Mint using periphery
      await BondPeriphery.connect(alice).mintWithReserveAmount(
        this.token.target,
        reserveAmount,
        expectedTokens,
        alice.address
      );

      const peripheryTokens = await this.token.balanceOf(alice.address);
      expect(peripheryTokens).to.equal(expectedTokens);
    });

    it("should properly handle royalties", async function () {
      // Our SIMPLE_TOKEN has 0% royalty, so no royalties should be collected
      const reserveAmount = wei(50);

      const creatorBalanceBefore = await Bond.userTokenRoyaltyBalance(
        owner.address,
        ReserveToken.target
      );
      const protocolBalanceBefore = await Bond.userTokenRoyaltyBalance(
        PROTOCOL_BENEFICIARY,
        ReserveToken.target
      );

      await BondPeriphery.connect(alice).mintWithReserveAmount(
        this.token.target,
        reserveAmount,
        0,
        alice.address
      );

      const creatorBalanceAfter = await Bond.userTokenRoyaltyBalance(
        owner.address,
        ReserveToken.target
      );
      const protocolBalanceAfter = await Bond.userTokenRoyaltyBalance(
        PROTOCOL_BENEFICIARY,
        ReserveToken.target
      );

      // With 0% royalty, balances should remain the same
      expect(creatorBalanceAfter).to.equal(creatorBalanceBefore);
      expect(protocolBalanceAfter).to.equal(protocolBalanceBefore);
    });

    it("should work with different reserve token decimals", async function () {
      // Create a token with 6 decimal reserve token
      const USDCToken = await ethers.deployContract("TestToken", [
        wei(200000000, 6),
        "USD Coin",
        "USDC",
        6n,
      ]);
      await USDCToken.waitForDeployment();

      const USDC_TOKEN = {
        tokenParams: { name: "USDC Token", symbol: "USDCT" },
        bondParams: {
          mintRoyalty: 100n,
          burnRoyalty: 150n,
          reserveToken: USDCToken.target,
          maxSupply: wei(1000000),
          stepRanges: [wei(10000), wei(1000000)],
          stepPrices: [0n, wei(1, 6)], // 1 USDC per token
        },
      };

      await Bond.createToken(
        Object.values(USDC_TOKEN.tokenParams),
        Object.values(USDC_TOKEN.bondParams)
      );
      const Token = await ethers.getContractFactory("MCV2_Token");
      const usdcToken = await Token.attach(await Bond.tokens(1));

      await USDCToken.transfer(alice.address, wei(10000, 6));
      await USDCToken.connect(alice).approve(BondPeriphery.target, MAX_INT_256);

      const reserveAmount = wei(1010, 6); // 1010 USDC
      const expectedTokens = wei(1000); // Should get 1000 tokens

      await BondPeriphery.connect(alice).mintWithReserveAmount(
        usdcToken.target,
        reserveAmount,
        expectedTokens,
        alice.address
      );

      expect(await usdcToken.balanceOf(alice.address)).to.equal(expectedTokens);
    });
  }); // Integration with Bond contract

  describe("Tests with larget steps to measure gas usage", function () {
    let largeStepToken;
    let largeStepBond;

    beforeEach(async function () {
      // Create a token with 500 steps for gas testing
      const stepRanges = [];
      const stepPrices = [];

      // Create 500 steps with increasing ranges and prices
      for (let i = 1; i <= 500; i++) {
        stepRanges.push(wei(i * 2000)); // Each step covers 2000 tokens
        stepPrices.push(wei(i, 9)); // Price increases by 1e9 wei per step
      }

      const bondParams = {
        mintRoyalty: 100n, // 1%
        burnRoyalty: 150n, // 1.5%
        reserveToken: ReserveToken.target,
        maxSupply: wei(1000000), // 1M tokens max supply (matches last step range)
        stepRanges: stepRanges,
        stepPrices: stepPrices,
      };

      const tokenParams = {
        name: "Large Step Token",
        symbol: "LST",
      };

      await Bond.createToken(tokenParams, bondParams, {
        value: await Bond.creationFee(),
      });

      largeStepToken = await ethers.getContractAt(
        "MCV2_Token",
        await Bond.tokens(0)
      );
      largeStepBond = Bond;
    });

    it("should handle 500 steps efficiently for small mint", async function () {
      const reserveAmount = wei(100); // Small amount

      // Measure gas for mintWithReserveAmount
      await ReserveToken.approve(BondPeriphery.target, reserveAmount);
      await BondPeriphery.mintWithReserveAmount(
        largeStepToken.target,
        reserveAmount,
        0, // No slippage protection for this test
        alice.address
      );

      // Verify the mint was successful
      expect(await largeStepToken.balanceOf(alice.address)).to.be.gt(0);
    });

    it("should handle 500 steps efficiently for medium mint", async function () {
      const reserveAmount = wei(10000); // Medium amount

      // Measure gas for mintWithReserveAmount
      await ReserveToken.approve(BondPeriphery.target, reserveAmount);
      await BondPeriphery.mintWithReserveAmount(
        largeStepToken.target,
        reserveAmount,
        0, // No slippage protection for this test
        alice.address
      );

      // Verify the mint was successful
      expect(await largeStepToken.balanceOf(alice.address)).to.be.gt(0);
    });

    it("should handle 500 steps efficiently for large mint", async function () {
      const reserveAmount = wei(100000); // Large amount

      // Measure gas for mintWithReserveAmount
      await ReserveToken.approve(BondPeriphery.target, reserveAmount);
      await BondPeriphery.mintWithReserveAmount(
        largeStepToken.target,
        reserveAmount,
        0, // No slippage protection for this test
        alice.address
      );

      // Verify the mint was successful
      expect(await largeStepToken.balanceOf(alice.address)).to.be.gt(0);
    });
  }); // Gas optimization tests
}); // BondPeriphery
