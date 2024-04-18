const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const {
  PROTOCOL_BENEFICIARY,
  wei,
  getMaxSteps,
} = require("./utils/test-utils");

const FEE_PER_RECIPIENT = 10000000000000n; // 0.00001 ETH (~$0.03)
const CREATION_FEE = 12345n;
const MAX_STEPS = getMaxSteps("mainnet");

const BABY_TOKEN = {
  tokenParams: {
    name: "Baby Token",
    symbol: "BABY",
    uri: "https://api.hunt.town/token-metadata/buildings/0.json",
  },
  bondParams: {
    mintRoyalty: 500n, // 5%
    burnRoyalty: 700n, // 7%
    reserveToken: null, // Should be set later
    maxSupply: 10n,
    stepRanges: [6n, 10n],
    stepPrices: [0n, wei("1")],
  },
};

describe("NFTDistributor", function () {
  async function deployFixtures() {
    const BulkSender = await ethers.deployContract("BulkSender", [
      PROTOCOL_BENEFICIARY,
      FEE_PER_RECIPIENT,
    ]);
    await BulkSender.waitForDeployment();

    const TokenImplementation = await ethers.deployContract("MCV2_Token");
    await TokenImplementation.waitForDeployment();

    const NFTImplementation = await ethers.deployContract("MCV2_MultiToken");
    await NFTImplementation.waitForDeployment();

    const Bond = await ethers.deployContract("MCV2_Bond", [
      TokenImplementation.target,
      NFTImplementation.target,
      PROTOCOL_BENEFICIARY,
      CREATION_FEE,
      MAX_STEPS,
    ]);
    await Bond.waitForDeployment();

    const BaseToken = await ethers.deployContract("TestToken", [
      wei(2000, 9),
      "Test Token",
      "TEST",
      9n,
    ]); // supply: 2,000
    await BaseToken.waitForDeployment();

    const NFTDistributor = await ethers.deployContract("MCV2_NFTDistributor", [
      Bond.target,
      BulkSender.target,
    ]);

    return [Bond, NFTDistributor, BaseToken];
  }

  let Bond, NFTDistributor, BaseToken;
  let creator, alice, bob, carol;

  beforeEach(async function () {
    [Bond, NFTDistributor, BaseToken] = await loadFixture(deployFixtures);
    [creator, alice, bob, carol] = await ethers.getSigners();
    BABY_TOKEN.bondParams.reserveToken = BaseToken.target; // set BaseToken address
  });

  describe("Create and send", function () {
    beforeEach(async function () {
      await NFTDistributor.createAndDistribute(
        Object.values(BABY_TOKEN.tokenParams),
        Object.values(BABY_TOKEN.bondParams),
        [alice.address, bob.address, carol.address],
        [1n, 2n, 3n],
        { value: CREATION_FEE + FEE_PER_RECIPIENT * 3n }
      );

      const Token = await ethers.getContractFactory("MCV2_MultiToken");
      this.token = await Token.attach(await Bond.tokens(0));
    });

    it("should create a new NFT", async function () {
      expect(await this.token.name()).to.equal(BABY_TOKEN.tokenParams.name);
      expect(await this.token.symbol()).to.equal(BABY_TOKEN.tokenParams.symbol);
      expect(await this.token.uri(0)).to.equal(BABY_TOKEN.tokenParams.uri);
    });

    it("should mint the correct amount of NFTs", async function () {
      expect(await this.token.totalSupply()).to.equal(6n);
    });

    it("should distribute the NFTs correctly", async function () {
      expect(await this.token.balanceOf(alice.address, 0)).to.equal(1n);
      expect(await this.token.balanceOf(bob.address, 0)).to.equal(2n);
      expect(await this.token.balanceOf(carol.address, 0)).to.equal(3n);
    });
  }); // Create and send
}); // NFTDistributor
