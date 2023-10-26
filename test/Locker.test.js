const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { NULL_ADDRESS, wei } = require('./utils/test-utils');

const ORIGINAL_BALANCE = wei(200000000);
const LOCKUP_AMOUNT = wei(1000);

describe('Locker', function () {
  async function deployFixtures() {
    const Locker = await ethers.deployContract('Locker');
    await Locker.waitForDeployment();

    const Token = await ethers.deployContract('TestToken', [ORIGINAL_BALANCE]); // supply: 200M
    await Token.waitForDeployment();

    const MultiToken = await ethers.deployContract('TestMultiToken', [ORIGINAL_BALANCE]); // supply: 200M
    await MultiToken.waitForDeployment();

    return [Locker, Token, MultiToken];
  }

  let Locker, Token, MultiToken;
  let owner, alice, bob, carol;

  beforeEach(async function () {
    [Locker, Token, MultiToken] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  describe('Create LockUp: ERC20', function () {
    beforeEach(async function () {
      this.unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now

      await Token.approve(Locker.target, LOCKUP_AMOUNT);
      await Locker.createLockUp(Token.target, true, LOCKUP_AMOUNT, this.unlockTime, alice.address, 'Test Lockup');

      this.lockUp = await Locker.lockUps(0);
    });

    it('should create a lockup correctly', async function () {
      expect(this.lockUp.token).to.equal(Token.target);
      expect(this.lockUp.isERC20).to.equal(true);
      expect(this.lockUp.amount).to.equal(LOCKUP_AMOUNT);
      expect(this.lockUp.unlockTime).to.equal(this.unlockTime);
      expect(this.lockUp.receiver).to.equal(alice.address);
      expect(this.lockUp.unlocked).to.equal(false);
      expect(this.lockUp.title).to.equal('Test Lockup');
    });

    it('should transfer tokens to the Locker', async function () {
      expect(await Token.balanceOf(Locker.target)).to.equal(LOCKUP_AMOUNT);
      expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE - LOCKUP_AMOUNT);
    });

    it('should emit LockedUp event', async function () {
      await Token.approve(Locker.target, LOCKUP_AMOUNT);
      await expect(Locker.createLockUp(Token.target, true, LOCKUP_AMOUNT, this.unlockTime, alice.address, ''))
        .to.emit(Locker, 'LockedUp')
        .withArgs(1, Token.target, true, alice.address, LOCKUP_AMOUNT, this.unlockTime);
    });

    it('should emit an Unlock event', async function () {
      await time.increaseTo(this.unlockTime + 1);
      await expect(Locker.connect(alice).unlock(0))
        .to.emit(Locker, 'Unlocked')
        .withArgs(0, Token.target, true, alice.address, LOCKUP_AMOUNT);
    });

    describe('Unlock', function () {
      beforeEach(async function () {
        await time.increaseTo(this.unlockTime + 1);
        await Locker.connect(alice).unlock(0);
      });

      it('should transfer the tokens to the receiver', async function () {
        expect(await Token.balanceOf(Locker.target)).to.equal(0);
        expect(await Token.balanceOf(alice.address)).to.equal(LOCKUP_AMOUNT);
      });

      it('should set the lockup as unlocked', async function () {
        expect((await Locker.lockUps(0)).unlocked).to.equal(true);
      });
    }); // Unlock

    describe('Edge Cases', function () {
      it('should revert if the lockup does not exist', async function () {
        await expect(Locker.connect(alice).unlock(1)).to.be.reverted;
      });

      it('should revert if the lockup is not unlocked', async function () {
        await expect(Locker.connect(alice).unlock(0)).to.be.revertedWithCustomError(
          Locker,
          'LockUp__NotYetUnlocked'
        );
      });

      it('should revert if the lockup is not unlocked by the receiver', async function () {
        await expect(Locker.connect(owner).unlock(0)).to.be.revertedWithCustomError(
          Locker,
          'LockUp__PermissionDenied'
        );
      });

      it('should revert if the lockup is already unlocked', async function () {
        await time.increaseTo(this.unlockTime + 1);
        await Locker.connect(alice).unlock(0);
        await expect(Locker.connect(alice).unlock(0)).to.be.revertedWithCustomError(
          Locker,
          'LockUp__AlreadyClaimed'
        );
      });
    }); // Edge Cases
  }); // Create LockUp: ERC20


  describe('Create LockUp: ERC1155', function () {
    beforeEach(async function () {
      this.unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now

      await MultiToken.setApprovalForAll(Locker.target, true);
      await Locker.createLockUp(MultiToken.target, false, LOCKUP_AMOUNT, this.unlockTime, alice.address, 'Test Lockup');

      this.lockUp = await Locker.lockUps(0);
    });

    it('should create a lockup correctly', async function () {
      expect(this.lockUp.token).to.equal(MultiToken.target);
      expect(this.lockUp.isERC20).to.equal(false);
      expect(this.lockUp.amount).to.equal(LOCKUP_AMOUNT);
      expect(this.lockUp.unlockTime).to.equal(this.unlockTime);
      expect(this.lockUp.receiver).to.equal(alice.address);
      expect(this.lockUp.unlocked).to.equal(false);
      expect(this.lockUp.title).to.equal('Test Lockup');
    });

    it('should transfer tokens to the Locker', async function () {
      expect(await MultiToken.balanceOf(Locker.target, 0)).to.equal(LOCKUP_AMOUNT);
      expect(await MultiToken.balanceOf(owner.address, 0)).to.equal(ORIGINAL_BALANCE - LOCKUP_AMOUNT);
    });

    it('should emit LockedUp event', async function () {
      await expect(Locker.createLockUp(MultiToken.target, false, LOCKUP_AMOUNT, this.unlockTime, alice.address, ''))
        .to.emit(Locker, 'LockedUp')
        .withArgs(1, MultiToken.target, false, alice.address, LOCKUP_AMOUNT, this.unlockTime);
    });

    it('should emit an Unlock event', async function () {
      await time.increaseTo(this.unlockTime + 1);
      await expect(Locker.connect(alice).unlock(0))
        .to.emit(Locker, 'Unlocked')
        .withArgs(0, MultiToken.target, false, alice.address, LOCKUP_AMOUNT);
    });

    describe('Unlock', function () {
      beforeEach(async function () {
        await time.increaseTo(this.unlockTime + 1);
        await Locker.connect(alice).unlock(0);
      });

      it('should transfer the tokens to the receiver', async function () {
        expect(await MultiToken.balanceOf(Locker.target, 0)).to.equal(0);
        expect(await MultiToken.balanceOf(alice.address, 0)).to.equal(LOCKUP_AMOUNT);
      });

      it('should set the lockup as unlocked', async function () {
        expect((await Locker.lockUps(0)).unlocked).to.equal(true);
      });
    }); // Unlock
  }); // Create LockUp: ERC1155


  describe('Edge Cases', function () {
    beforeEach(async function () {
      this.unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
    });

    it('should not allow creating a lockup with a zero address token', async function () {
      await expect(Locker.createLockUp(NULL_ADDRESS, true, LOCKUP_AMOUNT, this.unlockTime, alice.address, ''))
        .to.be.revertedWithCustomError(
          Locker,
          'LockUp__InvalidParams'
        ).withArgs('token');
    });

    it('should not allow creating a lockup with a zero amount', async function () {
      await expect(Locker.createLockUp(Token.target, true, 0, this.unlockTime, alice.address, ''))
        .to.be.revertedWithCustomError(
          Locker,
          'LockUp__InvalidParams'
        ).withArgs('amount');
    });

    it('should not allow creating a lockup with an unlock time in the past', async function () {
      const now = await time.latest();
      await expect(Locker.createLockUp(Token.target, true, LOCKUP_AMOUNT, now - 1, alice.address, ''))
        .to.be.revertedWithCustomError(
          Locker,
          'LockUp__InvalidParams'
        ).withArgs('unlockTime');
    });
  }); // Edge Cases

  describe('Utility functions', function () {
    beforeEach(async function () {
      const unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      this.Token2 = await ethers.deployContract('TestToken', [ORIGINAL_BALANCE]); // supply: 200M
      await this.Token2.waitForDeployment();

      await Token.approve(Locker.target, LOCKUP_AMOUNT);
      await this.Token2.approve(Locker.target, LOCKUP_AMOUNT * 4n);
      await Locker.createLockUp(Token.target, true, LOCKUP_AMOUNT, unlockTime, alice.address, ''); // id: 0
      await Locker.createLockUp(this.Token2.target, true, LOCKUP_AMOUNT, unlockTime, alice.address, ''); // id: 1
      await Locker.createLockUp(this.Token2.target, true, LOCKUP_AMOUNT, unlockTime, bob.address, ''); // id: 2
      await Locker.createLockUp(this.Token2.target, true, LOCKUP_AMOUNT, unlockTime, carol.address, ''); // id: 3
      await Locker.createLockUp(this.Token2.target, true, LOCKUP_AMOUNT, unlockTime, alice.address, ''); // id: 4
    });

    it('should filter ids with token', async function () {
      expect(await Locker.getLockUpIdsByToken(Token.target, 0, 9999)).to.deep.equal([0]);
      expect(await Locker.getLockUpIdsByToken(this.Token2.target, 0, 9999)).to.deep.equal([1, 2, 3, 4]);
    });

    it('should filter token and paginate properly', async function () {
      // stop parameter is exclusive
      expect(await Locker.getLockUpIdsByToken(this.Token2.target, 0, 1)).to.deep.equal([]);
      expect(await Locker.getLockUpIdsByToken(this.Token2.target, 0, 2)).to.deep.equal([1]);
      expect(await Locker.getLockUpIdsByToken(this.Token2.target, 0, 4)).to.deep.equal([1, 2, 3]);
    });

    it('should filter ids with receiver', async function () {
      expect(await Locker.getLockUpIdsByReceiver(alice.address, 0, 9999)).to.deep.equal([0, 1, 4]);
      expect(await Locker.getLockUpIdsByReceiver(bob.address, 0, 9999)).to.deep.equal([2]);
      expect(await Locker.getLockUpIdsByReceiver(carol.address, 0, 9999)).to.deep.equal([3]);
    });

    it('should filter receiver and paginate properly', async function () {
      // stop parameter is exclusive
      expect(await Locker.getLockUpIdsByReceiver(alice.address, 0, 1)).to.deep.equal([0]);
      expect(await Locker.getLockUpIdsByReceiver(alice.address, 0, 2)).to.deep.equal([0, 1]);
      expect(await Locker.getLockUpIdsByReceiver(alice.address, 0, 5)).to.deep.equal([0, 1, 4]);
    });
  }); // Utility functions
}); // Locker