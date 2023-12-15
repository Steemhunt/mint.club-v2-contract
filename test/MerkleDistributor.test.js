const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const keccak256 = require('keccak256');
const { MerkleTree } = require('merkletreejs');
const { NULL_ADDRESS, ZERO_BYTES32, wei } = require('./utils/test-utils');

const ORIGINAL_BALANCE = wei(1000000);
const TEST_DATA = {
  amountPerClaim: wei(100),
  walletCount: 10n,
  startTime: 0, // Start immediately
  endTime: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours from now
  title: 'Test Airdrop'
};

function bufferToHex(x) {
  return `0x${x.toString("hex")}`;
}

function getProof(tree, address) {
  return tree.getProof(keccak256(address)).map((x) => bufferToHex(x.data));
}

describe('MerkleDistributor', function () {
  async function deployFixtures() {
    const Token = await ethers.deployContract('TestToken', [ORIGINAL_BALANCE, 'Test Token', 'TEST', 18n]); // supply: 1M
    await Token.waitForDeployment();

    const MultiToken = await ethers.deployContract('TestMultiToken', [ORIGINAL_BALANCE]);
    await MultiToken.waitForDeployment();

    const MerkleDistributor = await ethers.deployContract('MerkleDistributor');
    await MerkleDistributor.waitForDeployment();

    return [Token, MultiToken, MerkleDistributor];
  }

  let Token, MultiToken, MerkleDistributor;
  let owner, alice, bob, carol, david;
  let defaultWhiltelist;

  beforeEach(async function () {
    [Token, MultiToken, MerkleDistributor] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol, david] = await ethers.getSigners();
    defaultWhiltelist = [alice.address, bob.address, carol.address];
  });

  describe('Create distribution: ERC20', function () {
    beforeEach(async function () {
      this.totalAirdropAmount = TEST_DATA.amountPerClaim * TEST_DATA.walletCount;
      await Token.approve(MerkleDistributor.target, this.totalAirdropAmount);
    });

    describe('Normal cases', function () {
      beforeEach(async function () {
        await MerkleDistributor.createDistribution(
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.title,
          ''
        );
        this.distribution = await MerkleDistributor.distributions(0);
      });

      it('should set properties correctly', async function() {
        expect(this.distribution.token).to.equal(Token.target);
        expect(this.distribution.isERC20).to.equal(true);
        expect(this.distribution.amountPerClaim).to.equal(TEST_DATA.amountPerClaim);
        expect(this.distribution.walletCount).to.equal(TEST_DATA.walletCount);
        expect(this.distribution.claimedCount).to.equal(0);
        expect(this.distribution.startTime).to.equal(TEST_DATA.startTime);
        expect(this.distribution.endTime).to.equal(TEST_DATA.endTime);
        expect(this.distribution.refundedAt).to.equal(0);
        expect(this.distribution.owner).to.equal(owner.address);
        expect(this.distribution.merkleRoot).to.equal(ZERO_BYTES32);
        expect(this.distribution.title).to.equal(TEST_DATA.title);
        expect(this.distribution.ipfsCID).to.equal('');
      });

      it('should return total airdrop amount as amountLeft', async function() {
        expect(await MerkleDistributor.getAmountLeft(0)).to.equal(this.totalAirdropAmount);
      });

      it('should return 0 on getAmountClaimed', async function() {
        expect(await MerkleDistributor.getAmountClaimed(0)).to.equal(0n);
      });

      it('should return false on isWhitelistOnly', async function() {
        expect(await MerkleDistributor.isWhitelistOnly(0)).to.equal(false);
      });

      it('should transfer the total airdrop amount to the contract', async function() {
        expect(await Token.balanceOf(MerkleDistributor.target)).to.equal(this.totalAirdropAmount);
      });

      it('should deduct the total airdrop amount from the owner', async function() {
        expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE - this.totalAirdropAmount);
      });

      it('should allow anyone to claim', async function() {
        await MerkleDistributor.connect(alice).claim(0, []);
        await MerkleDistributor.connect(bob).claim(0, []);

        expect(await Token.balanceOf(alice.address)).to.equal(TEST_DATA.amountPerClaim);
        expect(await Token.balanceOf(bob.address)).to.equal(TEST_DATA.amountPerClaim);
      });
    }); // Normal cases

    describe('Edge cases', function () {
      beforeEach(async function () {
        this.testParams = [
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.title,
          ''
        ];
      });

      it('should revert if token is zero address', async function() {
        this.testParams[0] = NULL_ADDRESS;

        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidParams'
          ).withArgs('token');
      });

      it('should revert if amountPerClaim is zero', async function() {
        this.testParams[2] = 0;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidParams'
          ).withArgs('amountPerClaim');
      });

      it('should revert if walletCount is zero', async function() {
        this.testParams[3] = 0;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidParams'
          ).withArgs('walletCount');
      });

      it('should revert if endTime is in the past', async function() {
        this.testParams[5] = (await time.latest()) - 1;
        await expect(MerkleDistributor.createDistribution(...this.testParams)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidParams'
          ).withArgs('endTime');
      });
    }); // Edge cases
  }); // Create distribution: ERC20

  describe('Create distribution: ERC1155', function () {
    beforeEach(async function () {
      this.totalAirdropAmount = TEST_DATA.amountPerClaim * TEST_DATA.walletCount;
      await MultiToken.setApprovalForAll(MerkleDistributor.target, true);
    });

    describe('Normal cases', function () {
      beforeEach(async function () {
        await MerkleDistributor.createDistribution(
          MultiToken.target,
          false,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.title,
          ''
        );
        this.distribution = await MerkleDistributor.distributions(0);
      });

      it('should set properties correctly', async function() {
        expect(this.distribution.token).to.equal(MultiToken.target);
        expect(this.distribution.isERC20).to.equal(false);
        expect(this.distribution.amountPerClaim).to.equal(TEST_DATA.amountPerClaim);
        expect(this.distribution.walletCount).to.equal(TEST_DATA.walletCount);
        expect(this.distribution.claimedCount).to.equal(0);
        expect(this.distribution.startTime).to.equal(TEST_DATA.startTime);
        expect(this.distribution.endTime).to.equal(TEST_DATA.endTime);
        expect(this.distribution.refundedAt).to.equal(0);
        expect(this.distribution.owner).to.equal(owner.address);
        expect(this.distribution.merkleRoot).to.equal(ZERO_BYTES32);
        expect(this.distribution.title).to.equal(TEST_DATA.title);
        expect(this.distribution.ipfsCID).to.equal('');
      });

      it('should return total airdrop amount as amountLeft', async function() {
        expect(await MerkleDistributor.getAmountLeft(0)).to.equal(this.totalAirdropAmount);
      });

      it('should return 0 on getAmountClaimed', async function() {
        expect(await MerkleDistributor.getAmountClaimed(0)).to.equal(0n);
      });

      it('should return false on isWhitelistOnly', async function() {
        expect(await MerkleDistributor.isWhitelistOnly(0)).to.equal(false);
      });

      it('should transfer the total airdrop amount to the contract', async function() {
        expect(await MultiToken.balanceOf(MerkleDistributor.target, 0)).to.equal(this.totalAirdropAmount);
      });

      it('should deduct the total airdrop amount from the owner', async function() {
        expect(await MultiToken.balanceOf(owner.address, 0)).to.equal(ORIGINAL_BALANCE - this.totalAirdropAmount);
      });

      it('should allow anyone to claim', async function() {
        await MerkleDistributor.connect(alice).claim(0, []);
        await MerkleDistributor.connect(bob).claim(0, []);

        expect(await MultiToken.balanceOf(alice.address, 0)).to.equal(TEST_DATA.amountPerClaim);
        expect(await MultiToken.balanceOf(bob.address, 0)).to.equal(TEST_DATA.amountPerClaim);
      });
    }); // Normal cases
  }); // Create distribution: ERC1155

  describe('Set merkle root: ERC20', function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x));
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await Token.approve(MerkleDistributor.target, TEST_DATA.amountPerClaim * 3n);
      await MerkleDistributor.createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim, // wei(100)
        3n,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.title,
        '' // No need for ipfsCID in the test
      );
      this.distribution = await MerkleDistributor.distributions(0);
    });

    it('should set merkle root correctly', async function() {
      expect(this.distribution.merkleRoot).to.equal(bufferToHex(this.tree.getRoot()));
    });

    it('should have alice in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, alice.address, getProof(this.tree, alice.address))).to.equal(true);
    });

    it('should have bob in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, bob.address, getProof(this.tree, bob.address))).to.equal(true);
    });

    it('should have carol in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, carol.address, getProof(this.tree, carol.address))).to.equal(true);
    });

    it('should NOT have david in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, david.address, getProof(this.tree, david.address))).to.equal(false);
    });

    it('should not set any of isClaimed to true', async function() {
      expect(await MerkleDistributor.isClaimed(0, owner.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, alice.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, bob.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, carol.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, david.address)).to.equal(false);
    });

    describe('Claim', function () {
      beforeEach(async function () {
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
      });

      it('should able to claim if merkle proof is valid', async function() {
        expect(await Token.balanceOf(carol.address)).to.equal(TEST_DATA.amountPerClaim);
      });

      it('should increase the amount claimed', async function() {
        expect(await MerkleDistributor.getAmountClaimed(0)).to.equal(TEST_DATA.amountPerClaim);
      });

      it('should set isClaimed to true', async function() {
        expect(await MerkleDistributor.isClaimed(0, carol.address)).to.equal(true);
      });

      it('should not able to claim twice', async function() {
        await expect(MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__AlreadyClaimed'
          );
      });

      it('should decrease the remaining amount', async function() {
        expect(await MerkleDistributor.getAmountLeft(0)).to.equal(TEST_DATA.amountPerClaim * 2n);
      });

      it('should revert if merkle proof is invalid', async function() {
        await expect(MerkleDistributor.connect(david).claim(0, getProof(this.tree, david.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidProof'
          );
      });

      it('should not able to claim before started', async function() {
        const leaves = defaultWhiltelist.map((x) => keccak256(x));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

        await Token.approve(MerkleDistributor.target, TEST_DATA.amountPerClaim * 3n);
        await MerkleDistributor.createDistribution(
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          3n,
          await time.latest() + 9999,
          TEST_DATA.endTime,
          bufferToHex(tree.getRoot()),
          TEST_DATA.title,
          ''
        );

        await expect(MerkleDistributor.connect(carol).claim(1, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__NotStarted'
          );
      });

      it('should not able to claim after ended', async function() {
        await time.increaseTo(TEST_DATA.endTime + 1);
        await expect(MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__Finished'
          );
      });
    }); // Claim

    describe('Refund', function () {
      it('should revert if not the owner', async function() {
        await expect(MerkleDistributor.connect(carol).refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__PermissionDenied'
          );
      });

      it('should be able to refund the whole amount if not claimed', async function() {
        await MerkleDistributor.refund(0);
        expect(await Token.balanceOf(MerkleDistributor.target)).to.equal(0);
        expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE);
      });

      it('should update refundedAt timestamp', async function() {
        await MerkleDistributor.refund(0);
        expect((await MerkleDistributor.distributions(0)).refundedAt).to.equal(await time.latest());
      });

      it('should be able to refund the remaining amount', async function() {
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
        await MerkleDistributor.refund(0);
        expect(await Token.balanceOf(MerkleDistributor.target)).to.equal(0);
        expect(await Token.balanceOf(carol.address)).to.equal(TEST_DATA.amountPerClaim);
        expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE - TEST_DATA.amountPerClaim);
      });

      it('should revert if all claimed', async function() {
        await MerkleDistributor.connect(alice).claim(0, getProof(this.tree, alice.address));
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
        await MerkleDistributor.connect(bob).claim(0, getProof(this.tree, bob.address));
        await expect(MerkleDistributor.refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__NothingToRefund'
          );
      });

      it('should revert if already refunded', async function() {
        await MerkleDistributor.refund(0);
        await expect(MerkleDistributor.refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__AlreadyRefunded'
          );
      });
    }); // Refund
  }); // Set merkle root: ERC20

  describe('Set merkle root: ERC1155', function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x));
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await MultiToken.setApprovalForAll(MerkleDistributor.target, true);
      await MerkleDistributor.createDistribution(
        MultiToken.target,
        false,
        TEST_DATA.amountPerClaim, // wei(100)
        3n,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.title,
        '' // No need for ipfsCID in the test
      );
      this.distribution = await MerkleDistributor.distributions(0);
    });

    it('should set merkle root correctly', async function() {
      expect(this.distribution.merkleRoot).to.equal(bufferToHex(this.tree.getRoot()));
    });

    it('should have alice in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, alice.address, getProof(this.tree, alice.address))).to.equal(true);
    });

    it('should have bob in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, bob.address, getProof(this.tree, bob.address))).to.equal(true);
    });

    it('should have carol in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, carol.address, getProof(this.tree, carol.address))).to.equal(true);
    });

    it('should NOT have david in the whitelist', async function() {
      expect(await MerkleDistributor.isWhitelisted(0, david.address, getProof(this.tree, david.address))).to.equal(false);
    });

    it('should not set any of isClaimed to true', async function() {
      expect(await MerkleDistributor.isClaimed(0, owner.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, alice.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, bob.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, carol.address)).to.equal(false);
      expect(await MerkleDistributor.isClaimed(0, david.address)).to.equal(false);
    });

    describe('Claim', function () {
      beforeEach(async function () {
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
      });

      it('should able to claim if merkle proof is valid', async function() {
        expect(await MultiToken.balanceOf(carol.address, 0)).to.equal(TEST_DATA.amountPerClaim);
      });

      it('should increase the amount claimed', async function() {
        expect(await MerkleDistributor.getAmountClaimed(0)).to.equal(TEST_DATA.amountPerClaim);
      });

      it('should set isClaimed to true', async function() {
        expect(await MerkleDistributor.isClaimed(0, carol.address)).to.equal(true);
      });

      it('should not able to claim twice', async function() {
        await expect(MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__AlreadyClaimed'
          );
      });

      it('should decrease the remaining amount', async function() {
        expect(await MerkleDistributor.getAmountLeft(0)).to.equal(TEST_DATA.amountPerClaim * 2n);
      });

      it('should revert if merkle proof is invalid', async function() {
        await expect(MerkleDistributor.connect(david).claim(0, getProof(this.tree, david.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__InvalidProof'
          );
      });

      it('should not able to claim before started', async function() {
        const leaves = defaultWhiltelist.map((x) => keccak256(x));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

        await MultiToken.setApprovalForAll(MerkleDistributor.target, true);
        await MerkleDistributor.createDistribution(
          MultiToken.target,
          false,
          TEST_DATA.amountPerClaim,
          3n,
          await time.latest() + 9999,
          TEST_DATA.endTime,
          bufferToHex(tree.getRoot()),
          TEST_DATA.title,
          ''
        );

        await expect(MerkleDistributor.connect(carol).claim(1, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__NotStarted'
          );
      });

      it('should not able to claim after ended', async function() {
        await time.increaseTo(TEST_DATA.endTime + 1);
        await expect(MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address))).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__Finished'
          );
      });
    }); // Claim

    describe('Refund', function () {
      it('should revert if not the owner', async function() {
        await expect(MerkleDistributor.connect(carol).refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__PermissionDenied'
          );
      });

      it('should be able to refund the whole amount if not claimed', async function() {
        await MerkleDistributor.refund(0);
        expect(await MultiToken.balanceOf(MerkleDistributor.target, 0)).to.equal(0);
        expect(await MultiToken.balanceOf(owner.address, 0)).to.equal(ORIGINAL_BALANCE);
      });

      it('should update refundedAt timestamp', async function() {
        await MerkleDistributor.refund(0);
        expect((await MerkleDistributor.distributions(0)).refundedAt).to.equal(await time.latest());
      });

      it('should be able to refund the remaining amount', async function() {
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
        await MerkleDistributor.refund(0);
        expect(await MultiToken.balanceOf(MerkleDistributor.target, 0)).to.equal(0);
        expect(await MultiToken.balanceOf(carol.address, 0)).to.equal(TEST_DATA.amountPerClaim);
        expect(await MultiToken.balanceOf(owner.address, 0)).to.equal(ORIGINAL_BALANCE - TEST_DATA.amountPerClaim);
      });

      it('should revert if all claimed', async function() {
        await MerkleDistributor.connect(alice).claim(0, getProof(this.tree, alice.address));
        await MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address));
        await MerkleDistributor.connect(bob).claim(0, getProof(this.tree, bob.address));
        await expect(MerkleDistributor.refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__NothingToRefund'
          );
      });

      it('should revert if already refunded', async function() {
        await MerkleDistributor.refund(0);
        await expect(MerkleDistributor.refund(0)).
          to.be.revertedWithCustomError(
            MerkleDistributor,
            'MerkleDistributor__AlreadyRefunded'
          );
      });
    }); // Refund
  }); // Set merkle root: ERC1155

  describe('Edge cases', function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x)); // 3 whitelist
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await Token.approve(MerkleDistributor.target, TEST_DATA.amountPerClaim * 2n);
      await MerkleDistributor.createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim, // wei(100)
        2n, // only 2 can calim
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.title,
        ''
      );
      this.distribution = await MerkleDistributor.distributions(0);
    });

    it('should revert if all claimed', async function() {
      await MerkleDistributor.connect(alice).claim(0, getProof(this.tree, alice.address));
      await MerkleDistributor.connect(bob).claim(0, getProof(this.tree, bob.address));
      await expect(MerkleDistributor.connect(carol).claim(0, getProof(this.tree, carol.address))).
        to.be.revertedWithCustomError(
          MerkleDistributor,
          'MerkleDistributor__NoClaimableTokensLeft'
        );
    });
  }); // Edge cases

  describe('Utility functions', function () {
    beforeEach(async function () {
      this.Token2 = await ethers.deployContract('TestToken', [ORIGINAL_BALANCE, 'Test Token', 'TEST', 18n]);
      await this.Token2.waitForDeployment();

      await Token.transfer(alice.address, 10000);
      await Token.connect(alice).approve(MerkleDistributor.target, 10000);
      await MerkleDistributor.connect(alice).createDistribution(
        Token.target,
        true,
        100,
        100,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        ZERO_BYTES32,
        'test',
        ''
      );

      await this.Token2.transfer(alice.address, 10000);
      await this.Token2.connect(alice).approve(MerkleDistributor.target, 10000);
      await MerkleDistributor.connect(alice).createDistribution(
        this.Token2.target,
        true,
        100,
        100,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        ZERO_BYTES32,
        'test',
        ''
      );

      await this.Token2.transfer(bob.address, 10000);
      await this.Token2.connect(bob).approve(MerkleDistributor.target, 10000);
      await MerkleDistributor.connect(bob).createDistribution(
        this.Token2.target,
        true,
        100,
        100,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        ZERO_BYTES32,
        'test',
        ''
      );
    });

    it('should return [0] for token = Token', async function () {
      const ids = await MerkleDistributor.getDistributionIdsByToken(Token.target, 0, 100);
      expect(ids).to.deep.equal([0]);
    });

    it('should return [1, 2] for token = Token2', async function () {
      const ids = await MerkleDistributor.getDistributionIdsByToken(this.Token2.target, 0, 100);
      expect(ids).to.deep.equal([1, 2]);
    });

    it('should return [0, 1] for owner = alice', async function () {
      const ids = await MerkleDistributor.getDistributionIdsByOwner(alice.address, 0, 100);
      expect(ids).to.deep.equal([0, 1]);
    });

    it('should return [2] for owner = bob', async function () {
      const ids = await MerkleDistributor.getDistributionIdsByOwner(bob.address, 0, 100);
      expect(ids).to.deep.equal([2]);
    });
  }); // Utility functions
}); // MerkleDistributor