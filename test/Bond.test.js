const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { expect } = require('chai');

function wei(num) {
  return BigInt(num) * BigInt(1e18);
}

describe('Bond', function () {
  const BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
  const BABY_TOKEN = {
    name: 'Baby Token',
    symbol: 'BABY',
    reserveToken: null, // Should be set later
    maxSupply: wei(1000000), // supply: 1M
    creatorFee: 100n, // creator fee: 1.0%
    stepRanges: [wei(10), wei(100), wei(50000), wei(700000), wei(1000000) ],
    stepPrices: [wei(1), wei(2), wei(3), wei(4), wei(5) ]
  };

  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, BENEFICIARY]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(100000000)]); // supply: 100M
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

    it('should not mint any tokens initially', async function () {
      expect(await this.token.totalSupply()).to.equal(0n);
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
  });

  // Buy

  // Sell
});
