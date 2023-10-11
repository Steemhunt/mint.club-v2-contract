const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const web3 = require('web3');
const {
  MAX_INT_256,
  NULL_ADDRESS,
  PROTOCOL_BENEFICIARY,
  MAX_ROYALTY_RANGE,
  MAX_STEPS,
  wei,
  modifiedValues,
  computeCreate2Address,
  calculatePurchase,
  calculateSell
} = require('./utils/test-utils');

const BABY_TOKEN = {
  tokenParams: {
    name: 'Baby Token',
    symbol: 'BABY'
  },
  bondParams: {
    royalty: 100n, // 1%
    reserveToken: null, // Should be set later
    maxSupply: wei(10000000), // supply: 10M
    stepRanges: [wei(10000), wei(100000), wei(200000), wei(500000), wei(1000000), wei(2000000), wei(5000000), wei(10000000) ],
    stepPrices: [wei(0), wei(2), wei(3), wei(4), wei(5), wei(7), wei(10), wei(15) ]
  }
};

describe('Bond', function () {
  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract('MCV2_MultiToken');
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, NFTImplementation.target, PROTOCOL_BENEFICIARY]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(200000000)]); // supply: 200M
    await BaseToken.waitForDeployment();

    // console.log('-222222', [TokenImplementation, NFTImplementation, Bond, BaseToken]);

    return [TokenImplementation, NFTImplementation, Bond, BaseToken];
  }

  let TokenImplementation, NFTImplementation, Bond, BaseToken;
  let owner, alice, bob;

  beforeEach(async function () {
    [TokenImplementation, NFTImplementation, Bond, BaseToken] = await loadFixture(deployFixtures);
    [owner, alice, bob] = await ethers.getSigners();
    BABY_TOKEN.bondParams.reserveToken = BaseToken.target; // set BaseToken address
  });

  describe('Create token', function () {
    beforeEach(async function () {
      const Token = await ethers.getContractFactory('MCV2_Token');
      this.creationTx = await Bond.createToken(Object.values(BABY_TOKEN.tokenParams), Object.values(BABY_TOKEN.bondParams));
      this.token = await Token.attach(await Bond.tokens(0));
      this.bond = await Bond.tokenBond(this.token.target);
    });

    describe('Normal flow', function() {
      it('should create a contract addreess deterministically', async function() {
        const salt = web3.utils.soliditySha3(
          { t: 'address', v: Bond.target },
          { t: 'string', v: BABY_TOKEN.tokenParams.symbol }
        );
        const predicted = computeCreate2Address(salt, TokenImplementation.target, Bond.target);

        expect(this.token.target).to.be.equal(predicted);
      });

      it('should create token with correct parameters', async function() {
        expect(await this.token.name()).to.equal(BABY_TOKEN.tokenParams.name);
        expect(await this.token.symbol()).to.equal(BABY_TOKEN.tokenParams.symbol);
      });

      it('should mint free range tokens initially to the creator', async function () {
        expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0]);
        expect(await this.token.balanceOf(owner.address)).to.equal(BABY_TOKEN.bondParams.stepRanges[0]);
      });

      it('should set correct bond parameters', async function() {
        expect(this.bond.creator).to.equal(owner.address);
        expect(this.bond.reserveToken).to.equal(BABY_TOKEN.bondParams.reserveToken);
        expect(this.bond.maxSupply).to.equal(BABY_TOKEN.bondParams.maxSupply);
      });

      it('should set correct bond steps', async function() {
        const steps = await Bond.getSteps(this.token.target);
        for(let i = 0; i < steps.length; i++) {
          expect(steps[i][0]).to.equal(BABY_TOKEN.bondParams.stepRanges[i]);
          expect(steps[i][1]).to.equal(BABY_TOKEN.bondParams.stepPrices[i]);
        }
      });

      it('should emit TokenCreated event', async function () {
        await expect(this.creationTx)
          .emit(Bond, 'TokenCreated')
          .withArgs(this.token.target, BABY_TOKEN.tokenParams.name, BABY_TOKEN.tokenParams.symbol);
      });

      it('should return tokenCount = 1', async function () {
        expect(await Bond.tokenCount()).to.equal(1);
      });

      it('should return true for existence check', async function () {
        expect(await Bond.exists(this.token.target)).to.equal(true);
      });
    }); // Normal flow

    describe('Validations', function () {
      beforeEach(async function () {
        this.newTokenParams = modifiedValues(BABY_TOKEN.tokenParams, { symbol: 'BABY2' });
      });

      it('should check if name is blank', async function () {
        await expect(
          Bond.createToken(
            modifiedValues(BABY_TOKEN.tokenParams, { name: '' }),
            Object.values(BABY_TOKEN.bondParams)
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('name');
      });

      it('should check if symbol is blank', async function () {
        await expect(
          Bond.createToken(
            modifiedValues(BABY_TOKEN.tokenParams, { symbol: '' }),
            Object.values(BABY_TOKEN.bondParams)
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('symbol');
      });

      it('should check if royalty is less than the max range', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { royalty: MAX_ROYALTY_RANGE + 1n })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('royalty');
      });

      it('should check if reserve token is valid', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { reserveToken: NULL_ADDRESS })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('reserveToken');
      });

      it('should check if max supply is valid', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { maxSupply: 0 })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenCreationParams')
        .withArgs('maxSupply');
      });

      it('should check if step ranges are not empty', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('INVALID_STEP_LENGTH');
      });

      it('should check if the length of step ranges are more than max steps', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [...Array(MAX_STEPS + 2).keys()].splice(1) })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('INVALID_STEP_LENGTH');
      });

      it('should check if the length of step ranges has the same length with step prices', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [100, 200], stepPrices: [1] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('STEP_LENGTH_DO_NOT_MATCH');
      });

      it('should check if the max suppply matches with the last step range', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [100, 200], stepPrices: [1, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('MAX_SUPPLY_MISMATCH');
      });

      it('should check if any of step ranges has zero value', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [0, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('STEP_CANNOT_BE_ZERO');
      });

      it('should check if any of step ranges is less than the previous step', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [2, 1, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2, 3] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('DECREASING_RANGE');
      });

      it('should check if any of step prices is less than the previous step', async function () {
        await expect(
          Bond.createToken(
            this.newTokenParams,
            modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [1, 2, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 3, 2] })
          )
        ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidStepParams')
        .withArgs('DECREASING_PRICE');
      });

      it('should revert if token symbol already exists', async function () {
        await expect(Bond.createToken(BABY_TOKEN.tokenParams, BABY_TOKEN.bondParams))
          .to.be.revertedWithCustomError(Bond, 'MCV2_Bond__TokenSymbolAlreadyExists');
      });

      it('should not mint any tokens if the first step price is not zero', async function () {
        await Bond.createToken(
          this.newTokenParams,
          modifiedValues(BABY_TOKEN.bondParams, { stepRanges: [1, 2, BABY_TOKEN.bondParams.maxSupply], stepPrices: [1, 2, 3] })
        );

        const Token = await ethers.getContractFactory('MCV2_Token');
        this.token2 = await Token.attach(await Bond.tokens(1));
        expect(await this.token2.totalSupply()).to.equal(0);
      });

      // NOTE: This could cost up to ~13M gas, which is ~43% of the block gas limit
      // Skipping this test because this exceptional case makes the average gas cost too high
      it.skip('should check if it support up to max steps', async function () {
        await Bond.createToken(
          this.newTokenParams,
          modifiedValues(BABY_TOKEN.bondParams, {
            maxSupply: MAX_STEPS,
            stepRanges: [...Array(1001).keys()].splice(1),
            stepPrices: [...Array(1001).keys()].splice(1)
          })
        );

        const Token = await ethers.getContractFactory('MCV2_Token');
        const token = await Token.attach(await Bond.tokens(1));
        const bond = await Bond.tokenBond(token.target);

        expect(await token.symbol()).to.equal('BABY2');
        expect(bond.maxSupply).to.equal(1000);
      });
    }); // Validations

    describe('Buy', function () {
      beforeEach(async function () {
        // Start with 10000 BaseToken, purchasing BABY tokens with 1000 BaseToken
        this.initialBaseBalance = wei(1000000); // 1M BASE tokens
        this.reserveToPurchase = wei(1000);

        this.buyTest = calculatePurchase(this.reserveToPurchase, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
        // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveOnBond: 990, tokensToMint: 495 }

        await BaseToken.transfer(alice.address, this.initialBaseBalance);
        await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
        await Bond.connect(alice).buy(this.token.target, this.reserveToPurchase, 0);
      });

      describe('Buy once', function() {
        it('should mint correct amount after royalties', async function () {
          expect(await this.token.balanceOf(alice.address)).to.equal(this.buyTest.tokensToMint); // excluding royalties
        });

        it('should transfer BASE tokens to the bond', async function () {
          expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance - this.reserveToPurchase);
          expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.reserveToPurchase); // including royalties until claimed
        });

        it('should add reserveBalance to the bond', async function () {
          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.buyTest.reserveOnBond);
        });

        it('should increase the total supply', async function () {
          // BABY_TOKEN.bondParams.stepRanges[0] is automatically minted to the creator on initialization
          expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0] + this.buyTest.tokensToMint);
        });

        it('should add claimable balance to the creator', async function () {
          expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(this.buyTest.creatorCut);
        });

        it('should add claimable balance to the protocol beneficiary', async function () {
          expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(this.buyTest.protocolCut);
        });

        it('should emit Buy event', async function () {
          await expect(Bond.connect(alice).buy(this.token.target, this.reserveToPurchase, 0))
            .emit(Bond, 'Buy')
            .withArgs(this.token.target, alice.address, this.buyTest.tokensToMint, BaseToken.target, this.reserveToPurchase);
        });
      }); // Buy once

      describe('Massive buy & sell through multiple steps', function () {
        beforeEach(async function () {
          // Buy with all base balance Alice has (1,000,000 - 1000 = 990,000)
          const additionalPurchase = this.initialBaseBalance - this.reserveToPurchase;
          await Bond.connect(alice).buy(this.token.target, additionalPurchase, 0);

          // Calculation table:
          // https://ipfs.io/ipfs/QmUpLBTjABeDtXuV4VpoMdhd415AqcVpc7ndy6FBRGeEVY
          this.predicted = {
            reserveOnBond: wei(990000),
            totalSupply: wei(327500),
            tokensToMint: wei(317500), // 10,000 is the initial free mint
            creatorCut: wei(8000),
            protocolCut: wei(2000)
          }
        });

        describe.only('Massiv Buy', function () {
          it('should be at 4th price', async function () {
            expect(await Bond.currentPrice(this.token.target)).to.equal(BABY_TOKEN.bondParams.stepPrices[3]);
          });

          it('should mint correct amount after royalties', async function () {
            expect(await this.token.balanceOf(alice.address)).to.equal(this.predicted.tokensToMint);
          });

          it('should transfer BASE tokens to the bond', async function () {
            expect(await BaseToken.balanceOf(alice.address)).to.equal(0);
            expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.initialBaseBalance); // including royalty until claimed
          });

          it('should add reserveBalance to the bond', async function () {
            const bond = await Bond.tokenBond(this.token.target);
            expect(bond.reserveBalance).to.equal(this.predicted.reserveOnBond);
          });

          it('should increase the total supply', async function () {
            // BABY_TOKEN.bondParams.stepRanges[0] is automatically minted to the creator on initialization
            expect(await this.token.totalSupply()).to.equal(this.predicted.totalSupply);
          });

          it('should add claimable balance to the creator', async function () {
            expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(this.predicted.creatorCut);
          });

          it('should add claimable balance to the protocol beneficiary', async function () {
            expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(this.predicted.protocolCut);
          });
        }); // Massive Buy

        describe('Massive Sell', function () {
          beforeEach(async function () {
            this.initial = {
              supply: await this.token.totalSupply(),
              baseBalance: await BaseToken.balanceOf(alice.address),
              tokenBalance: await this.token.balanceOf(alice.address),
              bondBalance: await BaseToken.balanceOf(Bond.target),
              bondReserve: (await Bond.tokenBond(this.token.target)).reserveBalance
            };

            // Sell all BABY tokens Alice has
            await this.token.connect(alice).approve(Bond.target, MAX_INT_256);

            await Bond.connect(alice).sell(this.token.target, this.initial.tokenBalance, 0);
          });

          it('should burn all BABY tokens from alice', async function () {
            expect(await this.token.balanceOf(alice.address)).to.equal(0);
          });

          it('should transfer BASE tokens to alice', async function () {
            const royalties = calculateFees(this.initial.bondReserve); // FIXME: calculateFees is not defined
            expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initial.baseBalance + this.initial.bondReserve - royalties.totalFee);
          });

          it('should decrease the total supply', async function () {
            expect(await this.token.totalSupply()).to.equal(BABY_TOKEN.bondParams.stepRanges[0]); // except the free minting amount
          });

          it('should decrease the reserveBalance on the bond', async function () {
            const bond = await Bond.tokenBond(this.token.target);
            expect(bond.reserveBalance).to.equal(0);
          });

          it('should add claimable balance to the creator', async function () {
            expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(
              this.initialBaseBalance * CREATOR_FEE / 10000n + // buy
              this.initial.bondReserve * CREATOR_FEE / 10000n // sell
            );
          });

          it('should add claimable balance to the creator', async function () {
            expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(
              this.initialBaseBalance * PROTOCOL_FEE / 10000n + // buy
              this.initial.bondReserve * PROTOCOL_FEE / 10000n // sell
            );
          });

          it('should leave claimable royalty balance on the bond', async function () {
            expect(await BaseToken.balanceOf(Bond.target)).to.equal(
              this.initialBaseBalance * (CREATOR_FEE + PROTOCOL_FEE) / 10000n + // buy
              this.initial.bondReserve * (CREATOR_FEE + PROTOCOL_FEE) / 10000n // sell
            );
          });
        });
      }); // Massive buy through multiple steps

      describe('Sell', function () {
        beforeEach(async function () {
          this.originalSupply = await this.token.totalSupply();
          this.initialBaseBalance = await BaseToken.balanceOf(alice.address);
          this.initialTokenBalance = await this.token.balanceOf(alice.address);
          this.initialBondBalance = await BaseToken.balanceOf(Bond.target);
          this.initialBondReserve = (await Bond.tokenBond(this.token.target)).reserveBalance;

          this.tokensToSell = wei(100);

          // { reserveFromBond, creatorCut, protocolCut, reserveToRefund }
          this.sellTest = calculateSell(this.tokensToSell, BABY_TOKEN.bondParams.stepPrices[1]);

          // should be 989, 200
          // console.log(this.initialBondReserve, this.sellTest.reserveFromBond);

          await this.token.connect(alice).approve(Bond.target, MAX_INT_256);
          await Bond.connect(alice).sell(this.token.target, this.tokensToSell, 0);
        });

        it('should decrease the BABY tokens from Alice', async function () {
          expect(await this.token.balanceOf(alice.address)).to.equal(this.initialTokenBalance - this.tokensToSell);
        });

        it('should transfer correct amount of BASE tokens to Alice', async function () {
          // should receive (100 - 1.1) * 2 = 197.8 BASE tokens for return
          expect(await BaseToken.balanceOf(alice.address)).to.equal(this.initialBaseBalance + this.sellTest.reserveToRefund);
        });

        it('should decrease the BASE tokens balance from the bond', async function () {
          expect(await BaseToken.balanceOf(Bond.target)).to.equal(this.initialBondBalance - this.sellTest.reserveToRefund);
        });

        it('should decrease the total supply of BABY token', async function () {
          expect(await this.token.totalSupply()).to.equal(this.originalSupply - this.tokensToSell);
        });

        it('should deduct reserveBalance from the bond', async function () {
          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.initialBondReserve - this.sellTest.reserveFromBond);
        });

        it('should add claimable balance to the creator', async function () {
          expect(await Bond.userTokenRoyaltyBalance(owner.address, BaseToken.target)).to.equal(this.buyTest.creatorCut + this.sellTest.creatorCut);
        });

        it('should add claimable balance to the protocol beneficiary', async function () {
          expect(await Bond.userTokenRoyaltyBalance(PROTOCOL_BENEFICIARY, BaseToken.target)).to.equal(this.buyTest.protocolCut + this.sellTest.protocolCut);
        });

        it('should emit Sell event', async function () {
          await expect(Bond.connect(alice).sell(this.token.target, this.tokensToSell, 0))
            .emit(Bond, 'Sell')
            .withArgs(this.token.target, alice.address, this.tokensToSell, BaseToken.target, this.sellTest.reserveToRefund);
        });
      }); // Sell
    }); // Buy

    describe('Other Edge Cases', function() {
      describe('Buy: Edge Cases', function() {
        beforeEach(async function () {
          this.initialBaseBalance = wei(200000000); // 200M
          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
        });

        it('should revert if the pool does not exists', async function () {
          await expect(
            Bond.connect(alice).buy(BaseToken.target, 100n, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__TokenNotFound');
        });

        it('should revert if the minTokens parameter is set more than the expected value', async function () {
          const test = calculatePurchase(100n, BABY_TOKEN.bondParams.stepPrices[1]);
          await expect(
            Bond.connect(alice).buy(this.token.target, 100n, test.tokensToMint + 1n)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if the slippage limit exceeded due to a front-run', async function () {
          const test = calculatePurchase(100n, BABY_TOKEN.bondParams.stepPrices[1]);

          // front-run till the next price step (price becomes 3 after 100k tokens, 180k reserve)
          await Bond.connect(alice).buy(this.token.target, wei(200000), test.tokensToMint)

          await expect(
            Bond.connect(alice).buy(this.token.target, 100n, test.tokensToMint)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if alice try to sell more than approved', async function () {
          await BaseToken.connect(alice).approve(Bond.target, 0);

          await expect(
            Bond.connect(alice).buy(this.token.target, 100n, 0)
          ).to.be.revertedWith('ERC20: insufficient allowance');
        });

        it('should revert if reserve amount is zero', async function () {
          await expect(
            Bond.connect(alice).buy(this.token.target, 0, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidReserveAmount');
        });

        it('should revert if user try to buy more than the available supply', async function () {
          // To mint 10M tokens, requires 116,180,000 reserve, 116,529,588.8 including royalties
          // Ref: https://t.ly/LFfGh
          await expect(
            Bond.connect(alice).buy(this.token.target, wei(116529589), 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__ExceedMaxSupply');

          await expect(
            Bond.connect(alice).buy(this.token.target, wei(116529588), 0)
          ).not.to.be.reverted;
        });

        it('should revert if user try to buy more than the balance', async function () {
          // transfer 90% of the balance to owner
          await BaseToken.connect(alice).transfer(owner.address, 9n * this.initialBaseBalance / 10n);
          const balanceLeft = await BaseToken.balanceOf(alice.address);

          await expect(
            Bond.connect(alice).buy(this.token.target, balanceLeft + 1n, 0)
          ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      }); // Buy: Edge Cases

      describe('Sell: Edge Cases', function() {
        beforeEach(async function () {
          this.initialBaseBalance = wei(200000000); // 200M
          await BaseToken.transfer(alice.address, this.initialBaseBalance);
          await BaseToken.connect(alice).approve(Bond.target, this.initialBaseBalance);
          await Bond.connect(alice).buy(this.token.target, wei(10000), 0); // Buys 4945
        });

        it('should revert if the sell amount is 0', async function () {
          await expect(
            Bond.connect(alice).sell(this.token.target, 0, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__InvalidTokenAmount');
        });

        it('should revert if it did not approve', async function () {
          await expect(
            Bond.connect(alice).sell(this.token.target, 100n, 0)
          ).to.be.revertedWith('ERC20: insufficient allowance');
        });

        it('should revert if alice try to sell more than the total supply', async function () {
          await this.token.transfer(alice.address, await this.token.balanceOf(owner.address));
          const amount = await this.token.balanceOf(alice);
          const totalSupply = await this.token.totalSupply();
          expect(amount).to.equal(totalSupply);

          await this.token.connect(alice).approve(Bond.target, amount + 1n);
          await expect(
            Bond.connect(alice).sell(this.token.target, amount + 1n, 0)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__ExceedTotalSupply');
        });

        it('should revert if alice try to sell more than the available balance', async function () {
          const amount = await this.token.balanceOf(alice.address);
          await this.token.connect(alice).approve(Bond.target, amount + 1n);

          await expect(
            Bond.connect(alice).sell(this.token.target, amount + 1n, 0)
          ).to.be.revertedWith('ERC20: burn amount exceeds balance');
        });

        it('should revert if the minTokens parameter is set more than the expected value', async function () {
          const sellAmount = wei(100);
          const { reserveToRefund } = calculateSell(sellAmount, BABY_TOKEN.bondParams.stepPrices[1]);
          await this.token.connect(alice).approve(Bond.target, sellAmount);

          await expect(
            Bond.connect(alice).sell(this.token.target, sellAmount, reserveToRefund + 1n)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });

        it('should revert if the slippage limit exceeded due to a front-run', async function () {
          const sellAmount = wei(100);
          const { reserveToRefund } = calculateSell(sellAmount, BABY_TOKEN.bondParams.stepPrices[1]);
          await this.token.connect(alice).approve(Bond.target, sellAmount);

          // Front-run the transaction - owner rugs the pool
          await this.token.connect(owner).approve(Bond.target, BABY_TOKEN.bondParams.stepRanges[0]);
          await Bond.connect(owner).sell(this.token.target, BABY_TOKEN.bondParams.stepRanges[0], 0);

          await expect(
            Bond.connect(alice).sell(this.token.target, sellAmount, reserveToRefund)
          ).to.be.revertedWithCustomError(Bond, 'MCV2_Bond__SlippageLimitExceeded');
        });
      }); // Sell: Edge Cases

      describe('Rounding errors', function() {
        beforeEach(async function () {
          await BaseToken.transfer(alice.address, wei(999999));
          await BaseToken.connect(alice).approve(Bond.target, wei(999999));

          this.tokensToMint = wei(1000);
          this.reserveOnBond = 2000000000000000000000n; // wei(2000)
          /**
           * reserveReqruied = reserve * (1 / (1 - royalty))
           *   -> 20000000000000000000000n * 10000n / 9970n = 2006018054162487462387n
           * actualCalculation = (x) => x - x * 10n / 10000n - x * 20n / 10000n
           *  -> actualCalculation(2006018054162487462387n) = 2000000000000000000001n
           */
          this.reversedCalculation = 2006018054162487462387n;
        });

        it('mints 1000 BABY, with 2000 BASE', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reversedCalculation - 1n, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint);

          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.reserveOnBond);
        });

        it('mints the same 1000 BABY, with 2000 BASE + 1 wei', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reversedCalculation, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint);

          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.reserveOnBond + 1n);
        });

        it('mints 1 wei more BABY, with 2000 BASE + 2 wei', async function () {
          await Bond.connect(alice).buy(this.token.target, this.reversedCalculation + 1n, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(this.tokensToMint + 1n);

          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(this.reserveOnBond + 2n);
        });

        it('does not collect any royalties if the amount is too small, due to flooring', async function () {
          // price = 2
          await Bond.connect(alice).buy(this.token.target, 200n, 0);
          expect(await this.token.balanceOf(alice.address)).to.equal(100n);

          const bond = await Bond.tokenBond(this.token.target);
          expect(bond.reserveBalance).to.equal(200n);
        });
      }); // Rounding errors
    }); // Other Edge Cases
  }); // Create token

  describe('Utility functions', function () {
    beforeEach(async function () {
      this.BaseToken2 = await ethers.deployContract('TestToken', [wei(200000000)]);
      await this.BaseToken2.waitForDeployment();
      const BABY_TOKEN2 = Object.assign({}, BABY_TOKEN, { symbol: 'BABY2', reserveToken: this.BaseToken2.target });
      const BABY_TOKEN3 = Object.assign({}, BABY_TOKEN, { symbol: 'BABY3', reserveToken: this.BaseToken2.target });

      await Bond.connect(alice).createToken(...Object.values(BABY_TOKEN));
      await Bond.connect(alice).createToken(...Object.values(BABY_TOKEN2));
      await Bond.connect(bob).createToken(...Object.values(BABY_TOKEN3));
    });

    it('should return [0] for ReserveToken = BaseToken', async function () {
      const ids = await Bond.getTokenIdsByReserveToken(BaseToken.target);
      expect(ids).to.deep.equal([0]);
    });

    it('should return [1, 2] for ReserveToken = BaseToken2', async function () {
      const ids = await Bond.getTokenIdsByReserveToken(this.BaseToken2.target);
      expect(ids).to.deep.equal([1, 2]);
    });

    it('should return [0, 1] for creator = alice', async function () {
      const ids = await Bond.getTokenIdsByCreator(alice.address);
      expect(ids).to.deep.equal([0, 1]);
    });

    it('should return [2] for creator = bob', async function () {
      const ids = await Bond.getTokenIdsByCreator(bob.address);
      expect(ids).to.deep.equal([2]);
    });
  }); // Utility functions
}); // Bond
