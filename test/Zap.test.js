const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const {
  PROTOCOL_BENEFICIARY,
  getMaxSteps,
  wei,
  MAX_INT_256,
} = require('./utils/test-utils');

const MAX_STEPS = getMaxSteps('ethereum');
const BABY_TOKEN = {
  tokenParams: { name: 'Baby Token', symbol: 'BABY' },
  bondParams: {
    mintRoyalty: 100n, // 1%
    burnRoyalty: 150n, // 1.5%
    reserveToken: null, // Should be set later
    maxSupply: wei(30), // supply: 100
    stepRanges: [wei(10), wei(20), wei(30)],
    stepPrices: [wei(0), wei(2), wei(5)],
  },
};

describe('MCV2_ZapV1', function () {
  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract('MCV2_MultiToken');
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [
      TokenImplementation.target,
      NFTImplementation.target,
      PROTOCOL_BENEFICIARY,
      0n,
      MAX_STEPS,
    ]);
    await Bond.waitForDeployment();

    const Weth = await ethers.deployContract('WETH9');
    await Weth.waitForDeployment();

    const Zap = await ethers.deployContract('MCV2_ZapV1', [
      Bond.target,
      Weth.target,
    ]);

    return [Weth, Zap, Bond];
  }

  let Weth, Zap, Bond;
  let owner, alice, bob;

  beforeEach(async function () {
    [Weth, Zap, Bond] = await loadFixture(deployFixtures);
    [owner, alice, bob] = await ethers.getSigners();
    BABY_TOKEN.bondParams.reserveToken = Weth.target; // set base token (WETH) address

    const Token = await ethers.getContractFactory('MCV2_Token');
    this.creationTx = await Bond.createToken(
      Object.values(BABY_TOKEN.tokenParams),
      Object.values(BABY_TOKEN.bondParams)
    );
    this.token = await Token.attach(await Bond.tokens(0));
    this.initialEthBalance = await ethers.provider.getBalance(alice.address);
  });

  describe('mintWithEth', function () {
    beforeEach(async function () {
      this.predicted = {
        tokensToMint: wei(10),
        ethToBond: wei(20), // 20
        ethRequired: wei(202, 17), // 20.2
        creatorRoyalty: wei(16, 16), // 20 * 0.01 * 0.8 = 0.16
        protocolRoyalty: wei(4, 16), // 20 * 0.01 * 0.2 = 0.04
      };

      await Zap.connect(alice).mintWithEth(
        this.token.target,
        this.predicted.tokensToMint,
        alice.address,
        { value: this.predicted.ethRequired }
      );
    });

    it('should mint tokens with ETH', async function () {
      expect(await this.token.balanceOf(alice.address)).to.equal(this.predicted.tokensToMint);
    });

    it('should deduct ETH from sender', async function () {
      expect(await ethers.provider.getBalance(alice.address)).to.changeEtherBalance(
        -this.predicted.ethRequired
      );
    });

    it('should add WETH to bond', async function () {
      expect(await Weth.balanceOf(Bond.target)).to.equal(this.predicted.ethRequired);
    });

    it('should add reserve balance correctly', async function () {
      const tokenBond = await Bond.tokenBond(this.token.target);
      expect(tokenBond.reserveBalance).to.equal(this.predicted.ethToBond);
    });

    it('should add creator royalty to the owner', async function () {
      const fees = await Bond.getRoyaltyInfo(owner.address, Weth.target);
      expect(fees[0]).to.equal(this.predicted.creatorRoyalty);
    });

    it('should add protocol royalty to the beneficiary', async function () {
      const fees = await Bond.getRoyaltyInfo(PROTOCOL_BENEFICIARY, Weth.target);
      expect(fees[0]).to.equal(this.predicted.protocolRoyalty);
    });

    describe('burnToEth', function () {
      beforeEach(async function () {
        this.burnPredicted = {
          tokensToBurn: wei(10),
          ethFromBond: wei(20), // 20
          ethToRefund: wei(198, 17), // 20 - 0.15 - 0.05 = 19.8
          creatorRoyalty: wei(24, 16), // 20 * 0.015 * 0.8 = 0.24 (+0.16 on minting = 0.4)
          protocolRoyalty: wei(6, 16), // 20 * 0.015 * 0.2 = 0.06 (+0.04 on minting = 0.1)
        };

        await this.token.connect(alice).approve(Zap.target, MAX_INT_256);
        await Zap.connect(alice).burnToEth(
          this.token.target,
          this.burnPredicted.tokensToBurn,
          0,
          bob.address
        );
      });

      it('should burn tokens', async function () {
        expect(await this.token.balanceOf(alice.address)).to.equal(0);
      });

      it('should add return ETH to the receiver', async function () {
        expect(await ethers.provider.getBalance(bob.address)).to.changeEtherBalance(
          this.burnPredicted.ethToRefund
        );
      });

      it('should deduct WETH from bond', async function () {
        expect(await Weth.balanceOf(Bond.target)).to.changeEtherBalance(
          -this.burnPredicted.ethToRefund
        );
      });

      it('should deduct reserve balance correctly', async function () {
        const tokenBond = await Bond.tokenBond(this.token.target);
        expect(tokenBond.reserveBalance).to.equal(0); // - ethFromBond
      });

      it('should add creator royalty to the owner', async function () {
        const fees = await Bond.getRoyaltyInfo(owner.address, Weth.target);
        expect(fees[0]).to.equal(this.predicted.creatorRoyalty + this.burnPredicted.creatorRoyalty);
      });

      it('should add protocol royalty to the beneficiary', async function () {
        const fees = await Bond.getRoyaltyInfo(PROTOCOL_BENEFICIARY, Weth.target);
        expect(fees[0]).to.equal(this.predicted.protocolRoyalty + this.burnPredicted.protocolRoyalty);
      });
    }); // burnToEth
  }); // mintWithEth
}); // MCV2_ZapV1
