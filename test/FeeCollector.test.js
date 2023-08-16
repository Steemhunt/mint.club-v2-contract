const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const web3 = require('web3');
const { MAX_INT_256, wei } = require('./utils/test-utils');

const PROTOCOL_FEE = 10n; // 0.1%
const CREATOR_FEE = 20n; // 0.2%
const BABY_TOKEN = {
  name: 'Baby Token',
  symbol: 'BABY',
  reserveToken: null, // Should be set later
  maxSupply: wei(10000000), // supply: 10M
  stepRanges: [wei(10000), wei(100000), wei(200000), wei(500000), wei(1000000), wei(2000000), wei(5000000), wei(10000000) ],
  stepPrices: [wei(0), wei(2), wei(3), wei(4), wei(5), wei(7), wei(10), wei(15) ]
};

function calculateFees(reserveAmount) {
  const creatorFee = reserveAmount * CREATOR_FEE / 10000n;
  const protocolFee = reserveAmount * PROTOCOL_FEE / 10000n;

  return { creatorFee, protocolFee, totalFee: creatorFee + protocolFee };
}

describe('FeeCollector', function () {
  let TokenImplementation, Bond, BaseToken;
  let owner, alice, bob, beneficiary;

  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, beneficiary.address, PROTOCOL_FEE, CREATOR_FEE]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(200000000)]); // supply: 200M
    await BaseToken.waitForDeployment();

    return [TokenImplementation, Bond, BaseToken];
  }

  beforeEach(async function () {
    [owner, alice, bob, beneficiary] = await ethers.getSigners();
    [TokenImplementation, Bond, BaseToken] = await loadFixture(deployFixtures);
    BABY_TOKEN.reserveToken = BaseToken.target; // set BaseToken address

    await Bond.connect(alice).createToken(...Object.values(BABY_TOKEN)); // creator = alice

    const Token = await ethers.getContractFactory('MCV2_Token');
    this.token = await Token.attach(await Bond.tokens(0));
  });

  it('should have correct protocol beneficiary', async function () {
    expect((await Bond.getFeeConfigs())[0]).to.equal(beneficiary.address);
  });

  it('should have correct protocol fee', async function () {
    expect((await Bond.getFeeConfigs())[1]).to.equal(PROTOCOL_FEE);
  });

  it('should have correct creator fee', async function () {
    expect((await Bond.getFeeConfigs())[2]).to.equal(CREATOR_FEE);
  });

  it('should be able to update fee rates by owner', async function () {
    await Bond.connect(owner).updateFeeRates(owner.address, 22, 33);
    const configs = await Bond.getFeeConfigs();
    expect(configs[0]).to.equal(owner.address);
    expect(configs[1]).to.equal(22);
    expect(configs[2]).to.equal(33);
  });

  it('should not be able to update fee rates by non-owner', async function () {
    await expect(Bond.connect(alice).updateFeeRates(owner.address, 22, 33)).to.be.
      revertedWith('Ownable: caller is not the owner');
  });

  describe('Buy fee', function () {
    beforeEach(async function () {
      this.reserveToPurchase = wei(1000);
      this.buyFeeCreator = this.reserveToPurchase * CREATOR_FEE / 10000n;
      this.buyFeeProtocol = this.reserveToPurchase * PROTOCOL_FEE / 10000n;

      await BaseToken.transfer(bob.address, this.reserveToPurchase);
      await BaseToken.connect(bob).approve(Bond.target, this.reserveToPurchase);
      await Bond.connect(bob).buy(this.token.target, this.reserveToPurchase, 0);
    });

    it('should add the creator fee to alice', async function () {
      const fees = await Bond.getFeeInfo(alice.address, BaseToken.target);
      expect(fees[0]).to.equal(this.buyFeeCreator);
      expect(fees[1]).to.equal(0); // nothing cliamed yet
    });

    it('should add the protocol fee to beneficiary', async function () {
      const fees = await Bond.getFeeInfo(beneficiary.address, BaseToken.target);
      expect(fees[0]).to.equal(this.buyFeeProtocol);
      expect(fees[1]).to.equal(0); // nothing cliamed yet
    });

    describe('Sell fee', function () {
      beforeEach(async function () {
        const amountToSell = wei(100);
        const reserveAmount = amountToSell * 2n;
        this.sellFeeCreator = reserveAmount * CREATOR_FEE / 10000n;
        this.sellFeeProtocol = reserveAmount * PROTOCOL_FEE / 10000n;
        this.reserveToRefund = reserveAmount - this.sellFeeCreator - this.sellFeeProtocol;

        await this.token.connect(bob).approve(Bond.target, amountToSell);
        await Bond.connect(bob).sell(this.token.target, amountToSell, 0);
      });

      it('should add the creator fee to alice', async function () {
        const fees = await Bond.getFeeInfo(alice.address, BaseToken.target);
        expect(fees[0]).to.equal(this.buyFeeCreator + this.sellFeeCreator);
        expect(fees[1]).to.equal(0); // nothing cliamed yet
      });

      it('should add the protocol fee to beneficiary', async function () {
        const fees = await Bond.getFeeInfo(beneficiary.address, BaseToken.target);
        expect(fees[0]).to.equal(this.buyFeeProtocol + this.sellFeeProtocol);
        expect(fees[1]).to.equal(0); // nothing cliamed yet
      });

      describe('Claim fees', function () {
        it('should be able to claim fees by creator', async function () {
          const feeToClaim = this.buyFeeCreator + this.sellFeeCreator;
          await Bond.connect(alice).claimFees(BaseToken.target);

          const fees = await Bond.getFeeInfo(alice.address, BaseToken.target);
          expect(fees[0]).to.equal(0);
          expect(fees[1]).to.equal(feeToClaim);
          expect(await BaseToken.balanceOf(alice.address)).to.equal(feeToClaim);
        });

        it('should be able to claim fees by beneficiary', async function () {
          const feeToClaim = this.buyFeeProtocol + this.sellFeeProtocol;
          await Bond.connect(beneficiary).claimFees(BaseToken.target);

          const fees = await Bond.getFeeInfo(beneficiary.address, BaseToken.target);
          expect(fees[0]).to.equal(0);
          expect(fees[1]).to.equal(feeToClaim);
          expect(await BaseToken.balanceOf(beneficiary.address)).to.equal(feeToClaim);
        });

        it('should not be able to claim twice', async function () {
          await Bond.connect(alice).claimFees(BaseToken.target);
          await expect(Bond.connect(alice).claimFees(BaseToken.target)).to.be.
            revertedWithCustomError(
              Bond,
              'MCV2_FeeCollector__NothingToClaim'
            )
        });
      });
    }); // Sell fee
  }); // Buy fee
}); // FeeCollector