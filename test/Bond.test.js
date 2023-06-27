const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { expect } = require('chai');

function wei(num) {
  return BigInt(num) * BigInt(1e18);
}

describe('Bond', function () {
  const BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
  const PROTOCOL_FEE = 10n; // 0.1%
  const BABY_TOKEN = {
    name: 'Baby Token',
    symbol: 'BABY',
    reserveToken: null, // Should be set later
    maxSupply: wei(10000000), // supply: 10M
    creatorFee: 100n, // creator fee: 1.0%
    stepRanges: [wei(10000), wei(100000), wei(200000), wei(500000), wei(1000000), wei(2000000), wei(5000000), wei(10000000) ],
    stepPrices: [wei(0), wei(2), wei(3), wei(4), wei(5), wei(7), wei(10), wei(15) ]
  };

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
      expect(this.bond.creatorFee).to.equal(BABY_TOKEN.creatorFee);
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
        // Start with 10000 BaseToken, purchasing 1000 BABY with 1000 BASE
        this.initialBaseBalance = wei(10000);
        this.reserveToPurchase = wei(1000);
        this.creatorFee = this.reserveToPurchase * BABY_TOKEN.creatorFee / 10000n;
        this.protocolFee = this.reserveToPurchase * PROTOCOL_FEE / 10000n;
        this.reserveOnBond = this.reserveToPurchase - this.creatorFee - this.protocolFee;
        this.tokensToMint = this.reserveOnBond / 2n; // price = 2 on step[1] range

        await BaseToken.transfer(alice.address, this.initialBaseBalance);
        await BaseToken.connect(alice).approve(Bond.target, this.reserveToPurchase);
        await Bond.connect(alice).buyWithSetReserveAmount(this.token.target, this.reserveToPurchase, 0);
      });

      it('should mint correct amount after fees', async function () {
        expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint); // excluding 1.1% fee
      });

      it('should transfer BASE tokens to the bond', async function () {
        expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - this.reserveToPurchase);
        expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.reserveToPurchase); // including fee until claimed
      });

      it('should increase the total supply', async function () {
        // BABY_TOKEN.stepRanges[0] is automatically minted to the creator on initialization
        expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.stepRanges[0] + this.tokensToMint);
      });

      it('should add reserveBalance to the bond', async function () {
        const bond = await Bond.tokenBond(this.token.target);
        expect(bond.reserveBalance).to.equal(this.reserveOnBond);
      });

      it('should add claimable balance to the creator', async function () {
        expect(await Bond.userTokenFeeBalance(owner.address, this.token.target)).to.equal(this.creatorFee);
      });

      it('should add claimable balance to the protocol beneficiary', async function () {
        expect(await Bond.userTokenFeeBalance(BENEFICIARY, this.token.target)).to.equal(this.protocolFee);
      });

      // TODO: edge cases
    });

    // Sell
  });
});
