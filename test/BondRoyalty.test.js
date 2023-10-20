const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const {
  MAX_INT_256,
  wei,
  calculateMint,
  calculateBurn,
} = require('./utils/test-utils');


const BABY_TOKEN = {
  tokenParams: { name: 'Baby Token', symbol: 'BABY' },
  bondParams: {
    royalty: 1000n, // 10%
    reserveToken: null, // Should be set later
    maxSupply: wei(10000000), // supply: 10M
    stepRanges: [ wei(10000), wei(100000), wei(200000), wei(500000), wei(1000000), wei(2000000), wei(5000000), wei(10000000) ],
    stepPrices: [ 0n, 2n, 3n, 4n, 5n, 7n, 10n, 15n ]
  }
};

describe('Royalty', function () {
  let Bond, BaseToken;
  let owner, alice, bob, beneficiary;

  async function deployFixtures() {
    const TokenImplementation = await ethers.deployContract('MCV2_Token');
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract('MCV2_MultiToken');
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract('MCV2_Bond', [TokenImplementation.target, NFTImplementation.target, beneficiary.address]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract('TestToken', [wei(200000000)]); // supply: 200M
    await BaseToken.waitForDeployment();

    return [Bond, BaseToken];
  }

  beforeEach(async function () {
    [owner, alice, bob, beneficiary] = await ethers.getSigners();
    [Bond, BaseToken] = await loadFixture(deployFixtures);
    BABY_TOKEN.bondParams.reserveToken = BaseToken.target; // set BaseToken address

    // creator = alice
    await Bond.connect(alice).createToken(Object.values(BABY_TOKEN.tokenParams), Object.values(BABY_TOKEN.bondParams));
    const Token = await ethers.getContractFactory('MCV2_Token');
    this.token = await Token.attach(await Bond.tokens(0));
  });

  describe('Update beneficiary by deployer', function () {
    it('should have correct protocol beneficiary', async function () {
      expect((await Bond.protocolBeneficiary())).to.equal(beneficiary.address);
    });

    it('should be able to update protocol beneficiary by the deployer', async function () {
      await Bond.connect(owner).updateProtocolBeneficiary(bob.address);
      expect((await Bond.protocolBeneficiary())).to.equal(bob.address);
    });

    it('should not be able to update protocol beneficiary by non-owner', async function () {
      await expect(Bond.connect(alice).updateProtocolBeneficiary(bob.address)).to.be.
        revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Mint royalty', function () {
    beforeEach(async function () {
      const tokensToMint = wei(500);
      this.buyTest = calculateMint(tokensToMint, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
      // { royalty: 100, creatorCut: 80, protocolCut: 20, reserveToBond: 1000, reserveRequired: 1100 }

      await BaseToken.transfer(bob.address, this.buyTest.reserveRequired);
      await BaseToken.connect(bob).approve(Bond.target, MAX_INT_256);
      await Bond.connect(bob).mint(this.token.target, tokensToMint, MAX_INT_256);
    });

    it('should add the creator royalty to alice', async function () {
      const royalties = await Bond.getRoyaltyInfo(alice.address, BaseToken.target);
      expect(royalties[0]).to.equal(this.buyTest.creatorCut);
      expect(royalties[1]).to.equal(0n); // nothing cliamed yet
    });

    it('should add the protocol royalty to beneficiary', async function () {
      const royalties = await Bond.getRoyaltyInfo(beneficiary.address, BaseToken.target);
      expect(royalties[0]).to.equal(this.buyTest.protocolCut);
      expect(royalties[1]).to.equal(0n); // nothing cliamed yet
    });

    describe('Burn royalty', function () {
      beforeEach(async function () {
        const amountToBurn = wei(100);
        this.sellTest = calculateBurn(amountToBurn, BABY_TOKEN.bondParams.stepPrices[1], BABY_TOKEN.bondParams.royalty);
        // { royalty: 10, creatorCut: 8, protocolCut: 2, reserveFromBond: 200, reserveToRefund: 190 }

        await this.token.connect(bob).approve(Bond.target, amountToBurn);
        await Bond.connect(bob).burn(this.token.target, amountToBurn, 0);
      });

      it('should add the creator royalty to alice', async function () {
        const royalties = await Bond.getRoyaltyInfo(alice.address, BaseToken.target);
        expect(royalties[0]).to.equal(this.buyTest.creatorCut + this.sellTest.creatorCut);
        expect(royalties[1]).to.equal(0n); // nothing cliamed yet
      });

      it('should add the protocol royalty to beneficiary', async function () {
        const royalties = await Bond.getRoyaltyInfo(beneficiary.address, BaseToken.target);
        expect(royalties[0]).to.equal(this.buyTest.protocolCut + this.sellTest.protocolCut);
        expect(royalties[1]).to.equal(0n); // nothing cliamed yet
      });

      describe('Claim', function () {
        it('should be able to claim royalties by creator', async function () {
          const royaltyToClaim = this.buyTest.creatorCut + this.sellTest.creatorCut;
          await Bond.connect(alice).claimRoyalties(BaseToken.target);

          const royalties = await Bond.getRoyaltyInfo(alice.address, BaseToken.target);
          expect(royalties[0]).to.equal(0n);
          expect(royalties[1]).to.equal(royaltyToClaim);
          expect(await BaseToken.balanceOf(alice.address)).to.equal(royaltyToClaim);
        });

        it('should be able to claim royalties by beneficiary', async function () {
          const royaltyToClaim = this.buyTest.protocolCut + this.sellTest.protocolCut;
          await Bond.connect(beneficiary).claimRoyalties(BaseToken.target);

          const royalties = await Bond.getRoyaltyInfo(beneficiary.address, BaseToken.target);
          expect(royalties[0]).to.equal(0n);
          expect(royalties[1]).to.equal(royaltyToClaim);
          expect(await BaseToken.balanceOf(beneficiary.address)).to.equal(royaltyToClaim);
        });

        it('should not be able to claim twice', async function () {
          await Bond.connect(alice).claimRoyalties(BaseToken.target);
          await expect(Bond.connect(alice).claimRoyalties(BaseToken.target)).to.be.
            revertedWithCustomError(
              Bond,
              'MCV2_Royalty__NothingToClaim'
            )
        });
      }); // Claim
    }); // Burn royalty
  }); // Mint royalty
}); // Royalty