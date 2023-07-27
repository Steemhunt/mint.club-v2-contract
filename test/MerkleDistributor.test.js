const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ORIGINAL_BALANCE = wei(1000000);
const TEST_DATA = {
  amountPerClaim: wei(100),
  whitelistCount: 10n,
  endTime: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 hours from now
};

function wei(num, decimals = 18) {
  return BigInt(num) * 10n**BigInt(decimals);
}

describe.only('MerkleDistributor', function () {
  async function deployFixtures() {
    const Token = await ethers.deployContract('TestToken', [ORIGINAL_BALANCE]); // supply: 1M
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
      this.totalAirdropAmount = TEST_DATA.amountPerClaim * TEST_DATA.whitelistCount;
      await Token.approve(MerkleDistributor.target, this.totalAirdropAmount);
    });

    describe('Normal cases', function () {
      beforeEach(async function () {
        await MerkleDistributor.connect(owner).createDistribution(
          Token.target,
          TEST_DATA.amountPerClaim,
          TEST_DATA.whitelistCount,
          TEST_DATA.endTime,
          ZERO_BYTES32
        );
        this.distribution = await MerkleDistributor.distributions(0);
      });

      it('should set properties correctly - token', async function() {
        expect(this.distribution.token).to.equal(Token.target);
      });

      it('should set properties correctly - amountPerClaim', async function() {
        expect(this.distribution.amountPerClaim).to.equal(TEST_DATA.amountPerClaim);
      });

      it('should set properties correctly - whitelistCount', async function() {
        expect(this.distribution.whitelistCount).to.equal(TEST_DATA.whitelistCount);
      });

      it('should set properties correctly - endTime', async function() {
        expect(this.distribution.endTime).to.equal(TEST_DATA.endTime);
      });

      it('should set properties correctly - refunded', async function() {
        expect(this.distribution.refunded).to.equal(false);
      });

      it('should set properties correctly - owner', async function() {
        expect(this.distribution.owner).to.equal(owner.address);
      });

      it('should set properties correctly - merkleRoot', async function() {
        expect(this.distribution.merkleRoot).to.equal(ZERO_BYTES32);
      });

      it('should return total airdrop amount as amountLeft', async function() {
        expect(await MerkleDistributor.getAmountLeft(0)).to.equal(this.totalAirdropAmount);
      });

      it('should return 0 on getAmountClaimed', async function() {
        expect(await MerkleDistributor.getAmountClaimed(0)).to.equal(0n);
      });

      it('should transfer the total airdrop amount to the contract', async function() {
        expect(await Token.balanceOf(MerkleDistributor.target)).to.equal(this.totalAirdropAmount);
      });

      it('should deduct the total airdrop amount from the owner', async function() {
        expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE - this.totalAirdropAmount);
      });
    }); // Normal cases

    describe('Edge cases', function () {
      beforeEach(async function () {
        this.testParams = [
          Token.target,
          TEST_DATA.amountPerClaim,
          TEST_DATA.whitelistCount,
          TEST_DATA.endTime,
          ZERO_BYTES32
        ];
      });

      it('should revert if token is zero address', async function() {
        this.testParams[0] = NULL_ADDRESS;

        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidDistributionParams'
          ).withArgs('token');
      });

      it('should revert if amountPerClaim is zero', async function() {
        this.testParams[1] = 0;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidDistributionParams'
          ).withArgs('amountPerClaim');
      });

      it('should revert if whitelistCount is zero', async function() {
        this.testParams[2] = 0;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidDistributionParams'
          ).withArgs('whitelistCount');
      });

      it('should revert if endTime is in the past', async function() {
        this.testParams[3] = (await time.latest()) - 1;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidDistributionParams'
          ).withArgs('endTime');
      });
    }); // Edge cases
  }); // Create distribution

  // TODO: add more tests for claiming, withdrawing, etc.
});