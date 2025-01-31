const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ZERO_BYTES32, wei } = require("./utils/test-utils");

// Constants for your test scenario
const ORIGINAL_BALANCE = wei(10000000000000n);
const TEST_DATA = {
  amountPerClaim: wei(1000),
  walletCount: 3n, // We'll only allow 3 claims max
  startTime: 0, // Start immediately
  endTime: 0, // We'll set this dynamically in the tests
  title: "Public Airdrop Test",
};

describe("AirdropClaimer", function () {
  async function deployAirdropClaimerFixture() {
    // 1. Deploy a TestToken
    const Token = await ethers.deployContract("TestToken", [
      ORIGINAL_BALANCE,
      "Test Token",
      "TEST",
      18n,
    ]);
    await Token.waitForDeployment();

    // 2. Deploy the MerkleDistributor
    const MerkleDistributor = await ethers.deployContract("MerkleDistributor");
    await MerkleDistributor.waitForDeployment();

    // 3. Deploy the AirdropClaimer, pointing it to MerkleDistributor
    const AirdropClaimer = await ethers.deployContract("AirdropClaimer", [
      MerkleDistributor.target,
    ]);
    await AirdropClaimer.waitForDeployment();

    // 4. Get signers
    const [owner, alice, bob, carol, david] = await ethers.getSigners();

    // Return them for the tests
    return {
      Token,
      MerkleDistributor,
      AirdropClaimer,
      owner,
      alice,
      bob,
      carol,
      david,
    };
  }

  let Token, MerkleDistributor, AirdropClaimer;
  let owner, alice, bob, carol, david;

  beforeEach(async function () {
    ({
      Token,
      MerkleDistributor,
      AirdropClaimer,
      owner,
      alice,
      bob,
      carol,
      david,
    } = await loadFixture(deployAirdropClaimerFixture));
  });

  describe("Create multiple distributions", function () {
    /*
      We'll create a few distributions with different conditions:
      - Distribution #0: public airdrop, currently valid
      - Distribution #1: public airdrop, already ended
      - Distribution #2: public airdrop, not yet started
      - Distribution #3: public airdrop, currently valid
        (We'll partially claim this before we call claimAll)
    */

    beforeEach(async function () {
      const now = await time.latest();

      // Approve 4x as many tokens
      await Token.approve(
        MerkleDistributor.target,
        TEST_DATA.amountPerClaim * TEST_DATA.walletCount * 4n
      );

      // Distribution #0: valid now, ends at now+3000
      await MerkleDistributor.createDistribution(
        Token.target,
        true, // isERC20
        TEST_DATA.amountPerClaim,
        TEST_DATA.walletCount, // 3 claims
        now, // start now
        now + 3000, // ends in 3000s
        ZERO_BYTES32, // merkleRoot == 0 => public
        TEST_DATA.title,
        ""
      );

      // Distribution #1: will end sooner
      await MerkleDistributor.createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim,
        TEST_DATA.walletCount,
        now, // start now
        now + 1000, // ends in 1000s
        ZERO_BYTES32,
        TEST_DATA.title,
        ""
      );

      // Advance time 1001s so #1 is ended
      await time.increase(1001);

      // Distribution #2: starts in the future
      await MerkleDistributor.createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim,
        TEST_DATA.walletCount,
        now + 9999, // starts 9999s in the future
        now + 10000, // ends 10000s in the future
        ZERO_BYTES32,
        TEST_DATA.title,
        ""
      );

      // Distribution #3: valid now, ends at now+2000
      await MerkleDistributor.createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim,
        TEST_DATA.walletCount,
        now, // start now
        now + 2000, // ends in 2000s
        ZERO_BYTES32,
        TEST_DATA.title,
        ""
      );
    });

    it("should have 4 distributions created", async function () {
      expect(await MerkleDistributor.distributionCount()).to.equal(4);
    });

    describe("claimAll", function () {
      it("should claim #0 and #3 for alice, skip #1 and #2 (reverts) without reverting the entire tx", async function () {
        // Balances before
        const balBefore = await Token.balanceOf(alice.address);

        // Attempt to claim distributions #0..#3 in a single loop
        await AirdropClaimer.connect(alice).claimAll(0, 3);

        // #0 and #3 should have succeeded => alice gets 2 * amountPerClaim
        // #1 is ended => revert => skip
        // #2 not started => revert => skip
        const balAfter = await Token.balanceOf(alice.address);
        expect(balAfter - balBefore).to.equal(TEST_DATA.amountPerClaim * 2n);

        // Confirm that #0 and #3 are now claimed for Alice
        expect(await MerkleDistributor.isClaimed(0, alice.address)).to.be.true;
        expect(await MerkleDistributor.isClaimed(3, alice.address)).to.be.true;

        // #1 and #2 remain unclaimed
        expect(await MerkleDistributor.isClaimed(1, alice.address)).to.be.false;
        expect(await MerkleDistributor.isClaimed(2, alice.address)).to.be.false;
      });

      it("should do nothing if the user already claimed all possible distributions", async function () {
        // First claim #0 and #3 via claimAll (instead of direct claims)
        await AirdropClaimer.connect(alice).claimAll(0, 3);

        const balBefore = await Token.balanceOf(alice.address);

        // claimAll again - nothing should happen (#1 ended, #2 not started, #0 and #3 claimed)
        await AirdropClaimer.connect(alice).claimAll(0, 3);

        const balAfter = await Token.balanceOf(alice.address);
        expect(balAfter - balBefore).to.equal(0n);
      });

      it("should revert if range is invalid", async function () {
        await expect(
          AirdropClaimer.connect(alice).claimAll(3, 2)
        ).to.be.revertedWithCustomError(
          AirdropClaimer,
          "AirdropClaimer__InvalidRange"
        );
      });

      it("should revert with AirdropClaimer__NoDistributions if there are zero distributions", async function () {
        // We can only test this easily if distributionCount == 0. Let's forcibly create a scenario:
        // Instead of hacking the existing contract, we can skip this test or deploy a fresh contract
        // with no distributions. But here's how it might look:
        const freshDistributor = await ethers.deployContract(
          "MerkleDistributor"
        );
        await freshDistributor.waitForDeployment();

        const freshClaimer = await ethers.deployContract("AirdropClaimer", [
          freshDistributor.target,
        ]);
        await freshClaimer.waitForDeployment();

        await expect(freshClaimer.claimAll(0, 0)).to.be.revertedWithCustomError(
          freshClaimer,
          "AirdropClaimer__NoDistributions"
        );
      });
    }); // claimAll
  }); // Create multiple distributions
});
