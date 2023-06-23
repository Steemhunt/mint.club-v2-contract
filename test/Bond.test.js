const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { expect } = require('chai');

function wei(num) {
  return BigInt(num) * BigInt(1e18);
}

describe('Bond', function () {
  const BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
  const BABY_TOKEN = [
    'Baby Token',
    'BABY',
    null, // Should be set later
    wei(1000000), // supply: 1M
    100n, // creator fee: 1.0%
    [wei(10), wei(100), wei(50000), wei(700000), wei(1000000) ],
    [wei(1), wei(2), wei(3), wei(4), wei(5) ]
  ]

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
    BABY_TOKEN[2] = BaseToken.target; // set BaseToken address
  });

  describe('Deployment', function () {
    it('should set the right TokenImplementation address', async function() {
      expect(await Bond.tokenImplementation()).to.equal(TokenImplementation.target);
    });
  });

  describe('Create token', function () {
    beforeEach(async function () {
      this.token = await Bond.createToken(...BABY_TOKEN);
    });

    // TODO:

    it('should emit TokenCreated event', async function () {
        await expect(Bond.createToken(...BABY_TOKEN))
          .emit(Bond, 'TokenCreated')
          .withArgs(anyValue, BABY_TOKEN[0], BABY_TOKEN[1]);
      });
  });
});
