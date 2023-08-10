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

    return [Locker, Token];
  }

  let Locker, Token;
  let owner, alice, bob, carol;

  beforeEach(async function () {
    [Locker, Token] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  describe('Create LockUp', function () {
    beforeEach(async function () {
      this.unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now

      await Token.approve(Locker.target, LOCKUP_AMOUNT);
      await Locker.createLockUp(Token.target, LOCKUP_AMOUNT, this.unlockTime, alice);

      this.lockUp = await Locker.lockUps(0);
    });

    it('should create a lockup correctly', async function () {
      expect(this.lockUp.token).to.equal(Token.target);
      expect(this.lockUp.amount).to.equal(LOCKUP_AMOUNT);
      expect(this.lockUp.unlockTime).to.equal(this.unlockTime);
      expect(this.lockUp.receiver).to.equal(alice.address);
      expect(this.lockUp.unlocked).to.equal(false);
    });

    it('should transfer tokens to the Locker', async function () {
      expect(await Token.balanceOf(Locker.target)).to.equal(LOCKUP_AMOUNT);
      expect(await Token.balanceOf(owner.address)).to.equal(ORIGINAL_BALANCE - LOCKUP_AMOUNT);
    });

    it('should emit LockedUp event', async function () {
      await Token.approve(Locker.target, LOCKUP_AMOUNT);
      await expect(Locker.createLockUp(Token.target, LOCKUP_AMOUNT, this.unlockTime, alice))
        .to.emit(Locker, 'LockedUp')
        .withArgs(1, Token.target, alice.address, LOCKUP_AMOUNT, this.unlockTime);
    });

    it('should emit an Unlock event', async function () {
      await time.increaseTo(this.unlockTime + 1);
      await expect(Locker.connect(alice).unlock(0))
        .to.emit(Locker, 'Unlocked')
        .withArgs(0, Token.target, alice.address, LOCKUP_AMOUNT);
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
  }); // Create LockUp

  describe('Edge Cases', function () {
    beforeEach(async function () {
      this.unlockTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
    });

    it('should not allow creating a lockup with a zero address token', async function () {
      await expect(Locker.createLockUp(NULL_ADDRESS, LOCKUP_AMOUNT, this.unlockTime, alice))
        .to.be.revertedWithCustomError(
          Locker,
          'LockUp__InvalidParams'
        ).withArgs('token');
    });

    it('should not allow creating a lockup with a zero amount', async function () {
      await expect(Locker.createLockUp(Token.target, 0, this.unlockTime, alice))
        .to.be.revertedWithCustomError(
          Locker,
          'LockUp__InvalidParams'
        ).withArgs('amount');
    });

    it('should not allow creating a lockup with an unlock time in the past', async function () {
      const now = await time.latest();
      await expect(Locker.createLockUp(Token.target, LOCKUP_AMOUNT, now - 1, alice))
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
      await this.Token2.approve(Locker.target, LOCKUP_AMOUNT * 3n);
      await Locker.createLockUp(Token.target, LOCKUP_AMOUNT, unlockTime, alice);
      await Locker.createLockUp(this.Token2.target, LOCKUP_AMOUNT, unlockTime, alice);
      await Locker.createLockUp(this.Token2.target, LOCKUP_AMOUNT, unlockTime, bob);
      await Locker.createLockUp(this.Token2.target, LOCKUP_AMOUNT, unlockTime, carol);
    });

    it('should filter ids with token', async function () {
      expect(await Locker.getLockUpIdsByToken(Token.target)).to.deep.equal([0]);
      expect(await Locker.getLockUpIdsByToken(this.Token2.target)).to.deep.equal([1, 2, 3]);
    });

    it('should filter ids with receiver', async function () {
      expect(await Locker.getLockUpIdsByReceiver(alice.address)).to.deep.equal([0, 1]);
      expect(await Locker.getLockUpIdsByReceiver(bob.address)).to.deep.equal([2]);
      expect(await Locker.getLockUpIdsByReceiver(carol.address)).to.deep.equal([3]);
    });
  }); // Utility functions
}); // Locker