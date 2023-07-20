const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
function wei(num, decimals = 18) {
  return BigInt(num) * 10n**BigInt(decimals);
}

describe('MerkleDistributor', function () {
  async function deployFixtures() {
    const Token = await ethers.deployContract('TestToken', [wei(1000000)]); // supply: 1M
    await Token.waitForDeployment();

    const MerkleDistributor = await ethers.deployContract('MerkleDistributor');
    await MerkleDistributor.waitForDeployment();

    return [Token, MerkleDistributor];
  }

  let Token, MerkleDistributor;
  let owner, alice;

  beforeEach(async function () {
    [Token, MerkleDistributor] = await loadFixture(deployFixtures);
    [owner, alice] = await ethers.getSigners();
  });

  describe('Create distribution', function () {
    beforeEach(async function () {
      this.endTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
      await MerkleDistributor.connect(owner).createDistribution(
        Token.target,
        wei(100),
        10,
        this.endTime,
        ZERO_BYTES32
      );
    });

    it('should create a distribution correctly', async function() {
      const distribution = await MerkleDistributor.distributions(0);
      expect(distribution.token).to.equal(Token.target);
      expect(distribution.merkleRoot).to.equal(ZERO_BYTES32);
      expect(distribution.endTime).to.equal(this.endTime);
      expect(distribution.owner).to.equal(owner.address);

      // TODO: more checks
    });
  });

  // TODO: add more tests for claiming, withdrawing, etc.
});