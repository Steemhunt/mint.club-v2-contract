const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const {
  PROTOCOL_BENEFICIARY,
  getMaxSteps,
  wei,
  MAX_INT_256,
} = require('./utils/test-utils');
const { ethers } = require('hardhat');

const MAX_STEPS = getMaxSteps('ethereum');
const BABY_TOKEN = {
  isERC20: true,
  tokenParams: { name: 'Baby Token', symbol: 'BABY' },
  bondParams: {
    mintRoyalty: 100n, // 1%
    burnRoyalty: 150n, // 1.5%
    reserveToken: null, // Should be set later
    maxSupply: wei(30), // supply: 100
    stepRanges: [wei(10), wei(20), wei(30)],
    stepPrices: [0n, wei(2), wei(5)],
  },
  mintPredicted: {
    tokensToMint: wei(10),
    ethToBond: wei(20), // 20
    ethRequired: wei(202, 17), // 20.2
    creatorRoyalty: wei(16, 16), // 20 * 0.01 * 0.8 = 0.16
    protocolRoyalty: wei(4, 16), // 20 * 0.01 * 0.2 = 0.04
  },
  burnPredicted: {
    tokensToBurn: wei(10),
    ethFromBond: wei(20), // 20
    ethToRefund: wei(198, 17), // 20 - 0.15 - 0.05 = 19.8
    creatorRoyalty: wei(24, 16), // 20 * 0.015 * 0.8 = 0.24 (+0.16 on minting = 0.4)
    protocolRoyalty: wei(6, 16), // 20 * 0.015 * 0.2 = 0.06 (+0.04 on minting = 0.1)
  }
};

const BABY_NFT = {
  isERC20: false,
  tokenParams: { name: 'Baby NFT', symbol: 'BABY', uri: 'https://api.hunt.town/token-metadata/buildings/0.json' },
  bondParams: {
    mintRoyalty: 100n, // 1%
    burnRoyalty: 150n, // 1.5%
    reserveToken: null, // Should be set later
    maxSupply: 100n,
    stepRanges: [ 10n, 30n, 50n, 100n ],
    stepPrices: [ 0n, wei(2), wei(5), wei(10) ]
  },
  mintPredicted: {
    tokensToMint: 10n,
    ethToBond: wei(20), // 20
    ethRequired: wei(202, 17), // 20.2
    creatorRoyalty: wei(16, 16), // 20 * 0.01 * 0.8 = 0.16
    protocolRoyalty: wei(4, 16), // 20 * 0.01 * 0.2 = 0.04
  },
  burnPredicted: {
    tokensToBurn: 10n,
    ethFromBond: wei(20), // 20
    ethToRefund: wei(198, 17), // 20 - 0.15 - 0.05 = 19.8
    creatorRoyalty: wei(24, 16), // 20 * 0.015 * 0.8 = 0.24 (+0.16 on minting = 0.4)
    protocolRoyalty: wei(6, 16), // 20 * 0.015 * 0.2 = 0.06 (+0.04 on minting = 0.1)
  }
};

for (let tokenParams of [BABY_TOKEN, BABY_NFT]) {
  describe(`MCV2_ZapV1 - ${tokenParams.isERC20 ? 'ERC20' : 'ERC1155'}`, function () {
    async function deployFixtures() {
      const TokenImplementation = await ethers.deployContract(tokenParams.isERC20 ? 'MCV2_Token': 'MCV2_MultiToken');
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
      tokenParams.bondParams.reserveToken = Weth.target; // set base token (WETH) address

      const Token = await ethers.getContractFactory(tokenParams.isERC20 ? 'MCV2_Token': 'MCV2_MultiToken');

      if (tokenParams.isERC20) {
        this.creationTx = await Bond.createToken(
          Object.values(tokenParams.tokenParams),
          Object.values(tokenParams.bondParams)
        );
      } else {
        this.creationTx = await Bond.createMultiToken(
          Object.values(tokenParams.tokenParams),
          Object.values(tokenParams.bondParams)
        );
      }
      this.token = await Token.attach(await Bond.tokens(0));
      this.initialEthBalance = await ethers.provider.getBalance(alice.address);
    });

    describe('mintWithEth', function () {
      beforeEach(async function () {
        await Zap.connect(alice).mintWithEth(
          this.token.target,
          tokenParams.mintPredicted.tokensToMint,
          alice.address,
          { value: tokenParams.mintPredicted.ethRequired }
        );
      });

      it('should mint tokens with ETH', async function () {
        if (tokenParams.isERC20) {
          expect(await this.token.balanceOf(alice.address)).to.equal(tokenParams.mintPredicted.tokensToMint);
        } else {
          expect(await this.token.balanceOf(alice.address, 0)).to.equal(tokenParams.mintPredicted.tokensToMint);
        }
      });

      it('should deduct ETH from sender', async function () {
        expect(await ethers.provider.getBalance(alice.address)).to.changeEtherBalance(
          -tokenParams.mintPredicted.ethRequired
        );
      });

      it('should add WETH to bond', async function () {
        expect(await Weth.balanceOf(Bond.target)).to.equal(tokenParams.mintPredicted.ethRequired);
      });

      it('should add reserve balance correctly', async function () {
        const tokenBond = await Bond.tokenBond(this.token.target);
        expect(tokenBond.reserveBalance).to.equal(tokenParams.mintPredicted.ethToBond);
      });

      it('should add creator royalty to the owner', async function () {
        const fees = await Bond.getRoyaltyInfo(owner.address, Weth.target);
        expect(fees[0]).to.equal(tokenParams.mintPredicted.creatorRoyalty);
      });

      it('should add protocol royalty to the beneficiary', async function () {
        const fees = await Bond.getRoyaltyInfo(PROTOCOL_BENEFICIARY, Weth.target);
        expect(fees[0]).to.equal(tokenParams.mintPredicted.protocolRoyalty);
      });

      describe('burnToEth', function () {
        beforeEach(async function () {
          if (tokenParams.isERC20) {
            await this.token.connect(alice).approve(Zap.target, MAX_INT_256);
          } else {
            await this.token.connect(alice).setApprovalForAll(Zap.target, true);
          }
          await Zap.connect(alice).burnToEth(
            this.token.target,
            tokenParams.burnPredicted.tokensToBurn,
            0,
            bob.address
          );
        });

        it('should burn tokens', async function () {
          if (tokenParams.isERC20) {
            expect(await this.token.balanceOf(alice.address)).to.equal(0);
          } else {
            expect(await this.token.balanceOf(alice.address, 0)).to.equal(0);
          }
        });

        it('should add return ETH to the receiver', async function () {
          expect(await ethers.provider.getBalance(bob.address)).to.changeEtherBalance(
            tokenParams.burnPredicted.ethToRefund
          );
        });

        it('should deduct WETH from bond', async function () {
          expect(await Weth.balanceOf(Bond.target)).to.changeEtherBalance(
            -tokenParams.burnPredicted.ethToRefund
          );
        });

        it('should deduct reserve balance correctly', async function () {
          const tokenBond = await Bond.tokenBond(this.token.target);
          expect(tokenBond.reserveBalance).to.equal(0); // - ethFromBond
        });

        it('should add creator royalty to the owner', async function () {
          const fees = await Bond.getRoyaltyInfo(owner.address, Weth.target);
          expect(fees[0]).to.equal(tokenParams.mintPredicted.creatorRoyalty + tokenParams.burnPredicted.creatorRoyalty);
        });

        it('should add protocol royalty to the beneficiary', async function () {
          const fees = await Bond.getRoyaltyInfo(PROTOCOL_BENEFICIARY, Weth.target);
          expect(fees[0]).to.equal(tokenParams.mintPredicted.protocolRoyalty + tokenParams.burnPredicted.protocolRoyalty);
        });
      }); // burnToEth
    }); // mintWithEth

    describe('Admin functions', function () {
      beforeEach(async function () {
        this.initialBobBalance = await ethers.provider.getBalance(bob.address);
        this.ethBalance = wei(3);
        await owner.sendTransaction({ to: Zap.target, value: this.ethBalance });
      });

      it('should return all ETH balance on the contract to the receiver', async function () {
        await Zap.connect(owner).rescueETH(bob.address);
        expect(await ethers.provider.getBalance(Zap.target)).to.equal(0n);
        expect(await ethers.provider.getBalance(bob.address)).to.equal(this.initialBobBalance + this.ethBalance);
      });

      it('should revert if not owner', async function () {
        await expect(Zap.connect(alice).rescueETH(bob.address)).to.be.revertedWithCustomError(
          Zap,
          'OwnableUnauthorizedAccount'
        );
      });
    });
  }); // MCV2_ZapV1
} // for