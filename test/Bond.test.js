const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { expect } = require('chai');

const MAX_INT_256 = 2n**256n - 1n;
const BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
const PROTOCOL_FEE = 10n; // 0.1%
const BABY_TOKEN = {
  name: 'Baby Token',
  symbol: 'BABY',
  reserveToken: null, // Should be set later
  maxSupply: wei(10000000), // supply: 10M
  creatorFeeRate: 100n, // creator fee: 1.0%
  stepRanges: [wei(10000), wei(100000), wei(200000), wei(500000), wei(1000000), wei(2000000), wei(5000000), wei(10000000) ],
  stepPrices: [wei(0), wei(2), wei(3), wei(4), wei(5), wei(7), wei(10), wei(15) ]
};

function wei(num, decimals = 18) {
  return BigInt(num) * 10n**BigInt(decimals);
}

function calculatePurchase(reserveToPurchase, stepPrice) {
  const creatorFee = reserveToPurchase * BABY_TOKEN.creatorFeeRate / 10000n;
  const protocolFee = reserveToPurchase * PROTOCOL_FEE / 10000n;
  const reserveOnBond = reserveToPurchase - creatorFee - protocolFee;
  const tokensToMint = 10n**18n * reserveOnBond / stepPrice;

  return { creatorFee, protocolFee, reserveOnBond, tokensToMint };
}

function calculateSell(tokensToSell, stepPrice) {
  const reserveFromBond = tokensToSell * stepPrice / 10n**18n;
  const creatorFee = reserveFromBond * BABY_TOKEN.creatorFeeRate / 10000n;
  const protocolFee = reserveFromBond * PROTOCOL_FEE / 10000n;
  const reserveToRefund = reserveFromBond - creatorFee - protocolFee; // after fee -

  return { creatorFee, protocolFee, reserveFromBond, reserveToRefund };
}

describe('Bond', function () {
  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, BENEFICIARY, PROTOCOL_FEE]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(200000000)]); // supply: 200M
    await BaseToken.waitForDeployment();

    return [TokenImplementation, Bond, BaseToken];
  }

  let TokenImplementation, Bond, BaseToken;
  let owner, alice;

  beforeEach(async function () {
    [TokenImplementation, Bond, BaseToken] = await loadFixture(deployFixtures);
    [owner, alice] = await ethers.getSigners();
    BABY_TOKEN.reserveToken = BaseToken.target; // set BaseToken address
  });

  describe('Deployment', function () {
    it('should set the right TokenImplementation address', async function() {
      expect(await Bond.tokenImplementation()).to.equal(TokenImplementation.target);
    });
  });

  describe('Create token', function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory('MCV2_Token');

      this.creationTx = await Bond.createToken(...Object.values(BABY_TOKEN));
      this.token = await Token.attach(await Bond.tokens(0));
      this.bond = await Bond.tokenBond(this.token.target);
    });

    it('should create token with correct parameters', async function() {
      expect(await this.token.name()).to.equal(BABY_TOKEN.name);
      expect(await this.token.symbol()).to.equal(BABY_TOKEN.symbol);
    });

    it('should mint free range tokens initially to the creator', async function () {
      expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.stepRanges[0]);
      expect(await this.token.balanceOf(owner.address)).to.equal(BABY_TOKEN.stepRanges[0]);
    });

    it('should set correct bond parameters', async function() {
      expect(this.bond.creator).to.equal(owner.address);
      expect(this.bond.reserveToken).to.equal(BABY_TOKEN.reserveToken);
      expect(this.bond.maxSupply).to.equal(BABY_TOKEN.maxSupply);
      expect(this.bond.creatorFeeRate).to.equal(BABY_TOKEN.creatorFeeRate);
    });

    it('should set correct bond steps', async function() {
      const steps = await Bond.getSteps(this.token.target);
      for(let i = 0; i < steps.length; i++) {
        expect(steps[i][0]).to.equal(BABY_TOKEN.stepRanges[i]);
        expect(steps[i][1]).to.equal(BABY_TOKEN.stepPrices[i]);
      }
    });

    it('should emit TokenCreated event', async function () {
      await expect(this.creationTx)
        .emit(Bond, 'TokenCreated')
        .withArgs(this.token.target, BABY_TOKEN.name, BABY_TOKEN.symbol);
    });

    describe('Buy', function () {
      beforeEach(async function () {
        // Start with 10000 BaseToken, purchasing BABY tokens with 1000 BaseToken
        this.initialBaseBalance = wei(10000);
        this.reserveToPurchase = wei(1000);

        // { creatorFee, protocolFee, reserveOnBond, tokensToMint }
        this.buyTest = calculatePurchase(this.reserveToPurchase, BABY_TOKEN.stepPrices[1]);
        // should be minted: (1000 - 11)/2 = 494.5 BABY tokens

        await BaseToken.transfer(alice.address, this.initialBaseBalance);
        await BaseToken.connect(alice).approve(Bond.target, this.reserveToPurchase);
        await Bond.connect(alice).buy(this.token.target, this.reserveToPurchase, 0);
      });

      it('should mint correct amount after fees', async function () {
        expect(await this.token.balanceOf(alice.address)).to.equal(this.buyTest.tokensToMint); // excluding 1.1% fee
      });

      it('should transfer BASE tokens to the bond', async function () {
        expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - this.reserveToPurchase);
        expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.reserveToPurchase); // including fee until claimed
      });

      it('should add reserveBalance to the bond', async function () {
        const bond = await Bond.tokenBond(this.token.target);
        expect(bond.reserveBalance).to.equal(this.buyTest.reserveOnBond);
      });

      it('should increase the total supply', async function () {
        // BABY_TOKEN.stepRanges[0] is automatically minted to the creator on initialization
        expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.stepRanges[0] + this.buyTest.tokensToMint);
      });

      it('should add claimable balance to the creator', async function () {
        expect(await Bond.userTokenFeeBalance(owner.address, this.token.target)).to.equal(this.buyTest.creatorFee);
      });

      it('should add claimable balance to the protocol beneficiary', async function () {
        expect(await Bond.userTokenFeeBalance(BENEFICIARY, this.token.target)).to.equal(this.buyTest.protocolFee);
      });

      // TODO: event emissions
      // TODO: massive buys through multiple steps
      // TODO: edge cases

      describe('Sell', function () {
        beforeEach(async function () {
          this.originalSupply = await this.token.totalSupply();
          this.initialBaseBalance = await BaseToken.balanceOf(alice.address);
          this.initialTokenBalance = await this.token.balanceOf(alice.address);
          this.initialBondBalance = await BaseToken.balanceOf(Bond.target);
          this.initialBondReserve = (await Bond.tokenBond(this.token.target)).reserveBalance;

          this.tokensToSell = wei(100);

          // { reserveFromBond, creatorFee, protocolFee, reserveToRefund }
          this.sellTest = calculateSell(this.tokensToSell, BABY_TOKEN.stepPrices[1]);

          // should be 989, 200
          // console.log(this.initialBondReserve, this.sellTest.reserveFromBond);

          await this.token.connect(alice).approve(Bond.target, this.tokensToSell);
          await Bond.connect(alice).sell(this.token.target, this.tokensToSell, 0);
        });

        it('should decrease the BABY tokens from Alice', async function () {
          expect(await this.token.balanceOf(alice.address)).to.equal(this.initialTokenBalance - this.tokensToSell);
        });

        it('should transfer correct amount of BASE tokens to Alice', async function () {
          // should receive (100 - 1.1) * 2 = 197.8 BASE tokens for return
          expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance + this.sellTest.reserveToRefund);
        });

        it('should decrease the BASE tokens balance from the bond', async function () {
          expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.initialBondBalance - this.sellTest.reserveToRefund);
        });

        it('should decrease the total supply of BABY token', async function () {
          expect(await this.token.totalSupply()).to.equal(this.originalSupply - this.tokensToSell);
        });

        it('should deduct reserveBalance from the bond', async function () {
          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.initialBondReserve - this.sellTest.reserveFromBond);
        });

        it('should add claimable balance to the creator', async function () {
          expect(await Bond.userTokenFeeBalance(owner.address, this.token.target)).to.equal(this.buyTest.creatorFee + this.sellTest.creatorFee);
        });

        it('should add claimable balance to the protocol beneficiary', async function () {
          expect(await Bond.userTokenFeeBalance(BENEFICIARY, this.token.target)).to.equal(this.buyTest.protocolFee + this.sellTest.protocolFee);
        });

        // TODO: event emissions
        // TODO: massive sells through multiple steps
        // TODO: edge cases

      }); // Sell
    }); // Buy

    describe('General edge cases', function() {
      describe('Rounding errors', function() {
        beforeEach(async function () {
          // Start with 10000 BaseToken, purchasing 1000 BABY tokens
          this.initialBaseBalance = wei(10000);
          this.tokensToMint = wei(1000);

          this.reserveToPurchase = 2022244691607684529827n;
          this.reserveOnBond = 2000000000000000000000n;

          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
        });

        it('should be the correct calculation', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reserveToPurchase, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint); // minted 1000 BABY tokens

          const bond = await Bond.tokenBond(this.token.target);
          expect(await bond.reserveBalance).to.equal(this.reserveOnBond);
        });

        it('sould have an additional 1e-18 BASE token in the collateral bond, even if the minting amount remains the same', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reserveToPurchase + 1n, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint); // minted 1000 BABY tokens

          const bond = await Bond.tokenBond(this.token.target);
          expect(await bond.reserveBalance).to.equal(this.reserveOnBond + 1n);
        });

        it('should mint 1e-18 more BABY tokens', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reserveToPurchase + 2n, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint + 1n); // minted 1000 + 1e-18 BABY tokens

          const bond = await Bond.tokenBond(this.token.target);
          expect(await bond.reserveBalance).to.equal(this.reserveOnBond + 2n);
        });
      }); // Rounding errors
    }); // General edge cases
  }); // Create token
}); // Bond
