const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const {
  NULL_ADDRESS,
  PROTOCOL_BENEFICIARY,
  wei,
} = require("./utils/test-utils");

const ORIGINAL_BALANCE = wei("100"); // 100 tokens
const FEE_PER_RECIPIENT = 10000000000000n; // 0.00001 ETH (~$0.03)

describe("BulkSender", function () {
  async function deployFixtures() {
    const BulkSender = await ethers.deployContract("BulkSender", [
      PROTOCOL_BENEFICIARY,
      FEE_PER_RECIPIENT,
    ]);
    await BulkSender.waitForDeployment();

    const Token = await ethers.deployContract("TestToken", [
      ORIGINAL_BALANCE,
      "Test Token",
      "TEST",
      18n,
    ]); // supply: 200M
    await Token.waitForDeployment();

    const MultiToken = await ethers.deployContract("TestMultiToken", [
      ORIGINAL_BALANCE,
    ]); // supply: 200M
    await MultiToken.waitForDeployment();

    return [BulkSender, Token, MultiToken];
  }

  let BulkSender, Token, MultiToken;
  let owner, alice, bob, carol;

  beforeEach(async function () {
    [BulkSender, Token, MultiToken] = await loadFixture(deployFixtures);
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  describe("Admin functions", function () {
    it("should set the fee per recipient", async function () {
      await BulkSender.updateFeePerRecipient(FEE_PER_RECIPIENT);
      expect(await BulkSender.feePerRecipient()).to.equal(FEE_PER_RECIPIENT);
    });

    it("should revert if the fee per recipient is set by a non-owner", async function () {
      await expect(
        BulkSender.connect(alice).updateFeePerRecipient(FEE_PER_RECIPIENT)
      ).to.be.revertedWithCustomError(BulkSender, "OwnableUnauthorizedAccount");
    });

    it("should set the protocol beneficiary", async function () {
      await BulkSender.updateProtocolBeneficiary(PROTOCOL_BENEFICIARY);
      expect(await BulkSender.protocolBeneficiary()).to.equal(
        PROTOCOL_BENEFICIARY
      );
    });

    it("should revert if the protocol beneficiary is set by a non-owner", async function () {
      await expect(
        BulkSender.connect(alice).updateProtocolBeneficiary(
          PROTOCOL_BENEFICIARY
        )
      ).to.be.revertedWithCustomError(BulkSender, "OwnableUnauthorizedAccount");
    });

    it("should revert if the protocol beneficiary is set to the zero address", async function () {
      await expect(BulkSender.updateProtocolBeneficiary(NULL_ADDRESS))
        .to.be.revertedWithCustomError(BulkSender, "BulkSender__InvalidParams")
        .withArgs("NULL_ADDRESS");
    });
  }); // Admin functions

  describe("Send ERC20", function () {
    beforeEach(async function () {
      [BulkSender, Token, MultiToken] = await loadFixture(deployFixtures);
      [owner, alice, bob, carol] = await ethers.getSigners();

      this.TEST = {
        recipients: [alice.address, bob.address, carol.address],
        amounts: [wei("1"), wei("2"), wei("3")],
      };
      this.totalAmount = this.TEST.amounts.reduce((a, b) => a + b, 0n);
      this.recipientsCount = BigInt(this.TEST.recipients.length);
      this.totalFee = FEE_PER_RECIPIENT * this.recipientsCount;

      await Token.approve(BulkSender.target, this.totalAmount);
    });

    it("should send tokens to multiple recipients", async function () {
      await BulkSender.sendERC20(
        Token.target,
        this.TEST.recipients,
        this.TEST.amounts,
        { value: this.totalFee }
      );

      for (let i = 0; i < this.TEST.recipients.length; i++) {
        expect(await Token.balanceOf(this.TEST.recipients[i])).to.equal(
          this.TEST.amounts[i]
        );
      }

      expect(await Token.balanceOf(BulkSender.target)).to.equal(0);
      expect(await Token.balanceOf(owner.address)).to.equal(
        ORIGINAL_BALANCE - this.totalAmount
      );
    });

    it("should revert if the sender does not have enough token balance", async function () {
      await Token.transfer(alice.address, ORIGINAL_BALANCE);
      await expect(
        BulkSender.sendERC20(
          Token.target,
          this.TEST.recipients,
          this.TEST.amounts,
          { value: this.totalFee }
        )
      ).to.be.revertedWithCustomError(
        BulkSender,
        "BulkSender__InsufficientTokenBalance"
      );
    });

    it("should revert if the sender did not approve the token transfer", async function () {
      await Token.approve(BulkSender.target, 0);
      await expect(
        BulkSender.sendERC20(
          Token.target,
          this.TEST.recipients,
          this.TEST.amounts,
          { value: this.totalFee }
        )
      ).to.be.revertedWithCustomError(
        BulkSender,
        "BulkSender__InsufficientTokenAllowance"
      );
    });

    it("should revert if the sender does not have enough tokens to pay the fee", async function () {
      await expect(
        BulkSender.sendERC20(
          Token.target,
          this.TEST.recipients,
          this.TEST.amounts
        )
      ).to.be.revertedWithCustomError(BulkSender, "BulkSender__InvalidFeeSent");
    });

    it("should emit an event when sending tokens", async function () {
      await expect(
        BulkSender.sendERC20(
          Token.target,
          this.TEST.recipients,
          this.TEST.amounts,
          { value: this.totalFee }
        )
      )
        .to.emit(BulkSender, "Sent")
        .withArgs(Token.target, this.totalAmount, this.recipientsCount);
    });
  }); // Send ERC20

  describe("Send ERC1155", function () {
    beforeEach(async function () {
      [BulkSender, Token, MultiToken] = await loadFixture(deployFixtures);
      [owner, alice, bob, carol] = await ethers.getSigners();

      this.TEST = {
        recipients: [alice.address, bob.address, carol.address],
        amounts: [1n, 2n, 3n],
      };
      this.totalAmount = this.TEST.amounts.reduce((a, b) => a + b, 0n);
      this.recipientsCount = BigInt(this.TEST.recipients.length);
      this.totalFee = FEE_PER_RECIPIENT * this.recipientsCount;

      await MultiToken.setApprovalForAll(BulkSender.target, true);
    });

    it("should send tokens to multiple recipients", async function () {
      await BulkSender.sendERC1155(
        MultiToken.target,
        this.TEST.recipients,
        this.TEST.amounts,
        { value: this.totalFee }
      );

      for (let i = 0; i < this.TEST.recipients.length; i++) {
        expect(
          await MultiToken.balanceOf(this.TEST.recipients[i], 0n)
        ).to.equal(this.TEST.amounts[i]);
      }

      expect(await MultiToken.balanceOf(BulkSender.target, 0)).to.equal(0);
      expect(await MultiToken.balanceOf(owner.address, 0)).to.equal(
        ORIGINAL_BALANCE - this.totalAmount
      );
    });

    it("should revert if the sender did not approve the token transfer", async function () {
      await MultiToken.setApprovalForAll(BulkSender.target, false);
      await expect(
        BulkSender.sendERC1155(
          MultiToken.target,
          this.TEST.recipients,
          this.TEST.amounts,
          { value: this.totalFee }
        )
      ).to.be.revertedWithCustomError(
        BulkSender,
        "BulkSender__InsufficientTokenAllowance"
      );
    });

    it("should revert if the sender does not have enough tokens to pay the fee", async function () {
      await expect(
        BulkSender.sendERC1155(
          MultiToken.target,
          this.TEST.recipients,
          this.TEST.amounts
        )
      ).to.be.revertedWithCustomError(BulkSender, "BulkSender__InvalidFeeSent");
    });

    it("should emit an event when sending tokens", async function () {
      await expect(
        BulkSender.sendERC1155(
          MultiToken.target,
          this.TEST.recipients,
          this.TEST.amounts,
          { value: this.totalFee }
        )
      )
        .to.emit(BulkSender, "Sent")
        .withArgs(MultiToken.target, this.totalAmount, this.recipientsCount);
    });
  }); // Send ERC1155
}); // BulkSender
