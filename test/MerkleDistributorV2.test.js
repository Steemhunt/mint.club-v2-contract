const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");
const {
  NULL_ADDRESS,
  ZERO_BYTES32,
  PROTOCOL_BENEFICIARY,
  wei,
} = require("./utils/test-utils");

const CREATION_FEE = 250000000000000n; // 0.0002 ETH (~ $1.0)
const CLAIM_FEE = 25000000000000n; // 0.000025 ETH ($~ $0.1)
const ORIGINAL_BALANCE = wei(10000000000000);
const TEST_DATA = {
  amountPerClaim: wei(1000000),
  walletCount: 1000000n,
  startTime: 0, // Start immediately
  endTime: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours from now
  metaData: { title: "Test Airdrop", ipfsCID: "" },
};

function bufferToHex(x) {
  return `0x${x.toString("hex")}`;
}

function getProof(tree, address) {
  return tree.getProof(keccak256(address)).map((x) => bufferToHex(x.data));
}

describe("MerkleDistributorV2", function () {
  async function deployFixtures() {
    const Token = await ethers.deployContract("TestToken", [
      ORIGINAL_BALANCE,
      "Test Token",
      "TEST",
      18n,
    ]); // supply: 1M
    await Token.waitForDeployment();

    const MultiToken = await ethers.deployContract("TestMultiToken", [
      ORIGINAL_BALANCE,
    ]);
    await MultiToken.waitForDeployment();

    const MerkleDistributorV2 = await ethers.deployContract(
      "MerkleDistributorV2",
      [PROTOCOL_BENEFICIARY, CREATION_FEE, CLAIM_FEE]
    );
    await MerkleDistributorV2.waitForDeployment();

    return [Token, MultiToken, MerkleDistributorV2];
  }

  let Token, MultiToken, MerkleDistributorV2;
  let deployer, creator, alice, bob, carol, david;
  let defaultWhiltelist;

  beforeEach(async function () {
    [Token, MultiToken, MerkleDistributorV2] = await loadFixture(
      deployFixtures
    );
    [deployer, creator, alice, bob, carol, david] = await ethers.getSigners();
    defaultWhiltelist = [alice.address, bob.address, carol.address];
  });

  describe("Create distribution: ERC20", function () {
    beforeEach(async function () {
      this.totalAirdropAmount =
        TEST_DATA.amountPerClaim * TEST_DATA.walletCount;
      await Token.transfer(creator.address, ORIGINAL_BALANCE);
      await Token.connect(creator).approve(
        MerkleDistributorV2.target,
        this.totalAirdropAmount
      );
    });

    describe("Normal cases", function () {
      beforeEach(async function () {
        await MerkleDistributorV2.connect(creator).createDistribution(
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.metaData,
          { value: CREATION_FEE }
        );
        this.distribution = await MerkleDistributorV2.distributions(0);
      });

      it("should set properties correctly", async function () {
        expect(this.distribution.token).to.equal(Token.target);
        expect(this.distribution.isERC20).to.equal(true);
        expect(this.distribution.amountPerClaim).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(this.distribution.walletCount).to.equal(TEST_DATA.walletCount);
        expect(this.distribution.claimedCount).to.equal(0);
        expect(this.distribution.startTime).to.equal(TEST_DATA.startTime);
        expect(this.distribution.endTime).to.equal(TEST_DATA.endTime);
        expect(this.distribution.refundedAt).to.equal(0);
        expect(this.distribution.creator).to.equal(creator.address);
        expect(this.distribution.merkleRoot).to.equal(ZERO_BYTES32);
        expect(this.distribution.title).to.equal(TEST_DATA.metaData.title);
        expect(this.distribution.ipfsCID).to.equal(TEST_DATA.metaData.ipfsCID);
      });

      it("should return total airdrop amount as amountLeft", async function () {
        expect(await MerkleDistributorV2.getAmountLeft(0)).to.equal(
          this.totalAirdropAmount
        );
      });

      it("should return 0 on getAmountClaimed", async function () {
        expect(await MerkleDistributorV2.getAmountClaimed(0)).to.equal(0n);
      });

      it("should return false on isWhitelistOnly", async function () {
        expect(await MerkleDistributorV2.isWhitelistOnly(0)).to.equal(false);
      });

      it("should transfer the total airdrop amount to the contract", async function () {
        expect(await Token.balanceOf(MerkleDistributorV2.target)).to.equal(
          this.totalAirdropAmount
        );
      });

      it("should deduct the total airdrop amount from the creator", async function () {
        expect(await Token.balanceOf(creator.address)).to.equal(
          ORIGINAL_BALANCE - this.totalAirdropAmount
        );
      });

      it("should allow anyone to claim", async function () {
        await MerkleDistributorV2.connect(alice).claim(0, [], {
          value: CLAIM_FEE,
        });
        await MerkleDistributorV2.connect(bob).claim(0, [], {
          value: CLAIM_FEE,
        });

        expect(await Token.balanceOf(alice.address)).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(await Token.balanceOf(bob.address)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });
    }); // Normal cases

    describe("Edge cases", function () {
      beforeEach(async function () {
        this.testParams = [
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.metaData,
        ];
      });

      it("should revert if token is zero address", async function () {
        this.testParams[0] = NULL_ADDRESS;

        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams,
            { value: CREATION_FEE }
          )
        )
          .to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidParams"
          )
          .withArgs("token");
      });

      it("should revert if amountPerClaim is zero", async function () {
        this.testParams[2] = 0;
        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams,
            { value: CREATION_FEE }
          )
        )
          .to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidParams"
          )
          .withArgs("amountPerClaim");
      });

      it("should revert if walletCount is zero", async function () {
        this.testParams[3] = 0;
        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams,
            { value: CREATION_FEE }
          )
        )
          .to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidParams"
          )
          .withArgs("walletCount");
      });

      it("should revert if endTime is in the past", async function () {
        this.testParams[5] = (await time.latest()) - 1;
        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams,
            { value: CREATION_FEE }
          )
        )
          .to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidParams"
          )
          .withArgs("endTime");
      });

      it("should revert if creation fee is not paid", async function () {
        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidCreationFee"
        );
      });

      it("should revert if wrong creation fee amount is paid", async function () {
        await expect(
          MerkleDistributorV2.connect(creator).createDistribution(
            ...this.testParams,
            { value: CREATION_FEE + 1n }
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidCreationFee"
        );
      });

      describe("Claim edge cases", function () {
        beforeEach(async function () {
          await MerkleDistributorV2.connect(creator).createDistribution(
            Token.target,
            true,
            TEST_DATA.amountPerClaim,
            TEST_DATA.walletCount,
            TEST_DATA.startTime,
            TEST_DATA.endTime,
            ZERO_BYTES32,
            TEST_DATA.metaData,
            { value: CREATION_FEE }
          );
        });

        it("should revert if claim fee is not paid", async function () {
          await expect(
            MerkleDistributorV2.connect(alice).claim(0, [])
          ).to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidClaimFee"
          );
        });

        it("should revert if claim fee is not enough", async function () {
          await expect(
            MerkleDistributorV2.connect(alice).claim(0, [], {
              value: CLAIM_FEE - 1n,
            })
          ).to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidClaimFee"
          );
        });

        it("should not allow to claim if the claim fee is extra", async function () {
          await expect(
            MerkleDistributorV2.connect(alice).claim(0, [], {
              value: CLAIM_FEE + 1n,
            })
          ).to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidClaimFee"
          );
        });
      }); // Claim edge cases
    }); // Edge cases
  }); // Create distribution: ERC20

  describe("Create distribution: ERC1155", function () {
    beforeEach(async function () {
      this.totalAirdropAmount =
        TEST_DATA.amountPerClaim * TEST_DATA.walletCount;
      await MultiToken.safeTransferFrom(
        deployer.address,
        creator.address,
        0,
        ORIGINAL_BALANCE,
        ZERO_BYTES32
      );
      await MultiToken.connect(creator).setApprovalForAll(
        MerkleDistributorV2.target,
        true
      );
    });

    describe("Normal cases", function () {
      beforeEach(async function () {
        await MerkleDistributorV2.connect(creator).createDistribution(
          MultiToken.target,
          false,
          TEST_DATA.amountPerClaim,
          TEST_DATA.walletCount,
          TEST_DATA.startTime,
          TEST_DATA.endTime,
          ZERO_BYTES32,
          TEST_DATA.metaData,
          { value: CREATION_FEE }
        );
        this.distribution = await MerkleDistributorV2.distributions(0);
      });

      it("should set properties correctly", async function () {
        expect(this.distribution.token).to.equal(MultiToken.target);
        expect(this.distribution.isERC20).to.equal(false);
        expect(this.distribution.amountPerClaim).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(this.distribution.walletCount).to.equal(TEST_DATA.walletCount);
        expect(this.distribution.claimedCount).to.equal(0);
        expect(this.distribution.startTime).to.equal(TEST_DATA.startTime);
        expect(this.distribution.endTime).to.equal(TEST_DATA.endTime);
        expect(this.distribution.refundedAt).to.equal(0);
        expect(this.distribution.creator).to.equal(creator.address);
        expect(this.distribution.merkleRoot).to.equal(ZERO_BYTES32);
        expect(this.distribution.title).to.equal(TEST_DATA.metaData.title);
        expect(this.distribution.ipfsCID).to.equal(TEST_DATA.metaData.ipfsCID);
      });

      it("should return total airdrop amount as amountLeft", async function () {
        expect(await MerkleDistributorV2.getAmountLeft(0)).to.equal(
          this.totalAirdropAmount
        );
      });

      it("should return 0 on getAmountClaimed", async function () {
        expect(await MerkleDistributorV2.getAmountClaimed(0)).to.equal(0n);
      });

      it("should return false on isWhitelistOnly", async function () {
        expect(await MerkleDistributorV2.isWhitelistOnly(0)).to.equal(false);
      });

      it("should transfer the total airdrop amount to the contract", async function () {
        expect(
          await MultiToken.balanceOf(MerkleDistributorV2.target, 0)
        ).to.equal(this.totalAirdropAmount);
      });

      it("should deduct the total airdrop amount from the creator", async function () {
        expect(await MultiToken.balanceOf(creator.address, 0)).to.equal(
          ORIGINAL_BALANCE - this.totalAirdropAmount
        );
      });

      it("should allow anyone to claim", async function () {
        await MerkleDistributorV2.connect(alice).claim(0, [], {
          value: CLAIM_FEE,
        });
        await MerkleDistributorV2.connect(bob).claim(0, [], {
          value: CLAIM_FEE,
        });

        expect(await MultiToken.balanceOf(alice.address, 0)).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(await MultiToken.balanceOf(bob.address, 0)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });
    }); // Normal cases
  }); // Create distribution: ERC1155

  describe("Set merkle root: ERC20", function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x));
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await Token.transfer(creator.address, ORIGINAL_BALANCE);
      await Token.connect(creator).approve(
        MerkleDistributorV2.target,
        TEST_DATA.amountPerClaim * 3n
      );
      await MerkleDistributorV2.connect(creator).createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim, // wei(100)
        3n,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.metaData,
        { value: CREATION_FEE }
      );
      this.distribution = await MerkleDistributorV2.distributions(0);
    });

    it("should set merkle root correctly", async function () {
      expect(this.distribution.merkleRoot).to.equal(
        bufferToHex(this.tree.getRoot())
      );
    });

    it("should have alice in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          alice.address,
          getProof(this.tree, alice.address)
        )
      ).to.equal(true);
    });

    it("should have bob in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          bob.address,
          getProof(this.tree, bob.address)
        )
      ).to.equal(true);
    });

    it("should have carol in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          carol.address,
          getProof(this.tree, carol.address)
        )
      ).to.equal(true);
    });

    it("should NOT have david in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          david.address,
          getProof(this.tree, david.address)
        )
      ).to.equal(false);
    });

    it("should not set any of isClaimed to true", async function () {
      expect(await MerkleDistributorV2.isClaimed(0, creator.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, alice.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, bob.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, carol.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, david.address)).to.equal(
        false
      );
    });

    describe("Claim", function () {
      beforeEach(async function () {
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
      });

      it("should able to claim if merkle proof is valid", async function () {
        expect(await Token.balanceOf(carol.address)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });

      it("should increase the amount claimed", async function () {
        expect(await MerkleDistributorV2.getAmountClaimed(0)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });

      it("should set isClaimed to true", async function () {
        expect(await MerkleDistributorV2.isClaimed(0, carol.address)).to.equal(
          true
        );
      });

      it("should not able to claim twice", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__AlreadyClaimed"
        );
      });

      it("should decrease the remaining amount", async function () {
        expect(await MerkleDistributorV2.getAmountLeft(0)).to.equal(
          TEST_DATA.amountPerClaim * 2n
        );
      });

      it("should revert if merkle proof is invalid", async function () {
        await expect(
          MerkleDistributorV2.connect(david).claim(
            0,
            getProof(this.tree, david.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidProof"
        );
      });

      it("should not able to claim before started", async function () {
        const leaves = defaultWhiltelist.map((x) => keccak256(x));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

        await Token.connect(creator).approve(
          MerkleDistributorV2.target,
          TEST_DATA.amountPerClaim * 3n
        );
        await MerkleDistributorV2.connect(creator).createDistribution(
          Token.target,
          true,
          TEST_DATA.amountPerClaim,
          3n,
          (await time.latest()) + 9999,
          TEST_DATA.endTime,
          bufferToHex(tree.getRoot()),
          TEST_DATA.metaData,
          { value: CREATION_FEE }
        );

        await expect(
          MerkleDistributorV2.connect(carol).claim(
            1,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__NotStarted"
        );
      });

      it("should not able to claim after ended", async function () {
        await time.increaseTo(TEST_DATA.endTime + 1);
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__Finished"
        );
      });
    }); // Claim

    describe("Claim fee should not be required for private airdrops", function () {
      it("should revert if claim fee is paid", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address),
            {
              value: CLAIM_FEE,
            }
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidClaimFee"
        );
      });
    });

    describe("Refund", function () {
      it("should revert if not the creator", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__PermissionDenied"
        );
      });

      it("should be able to refund the whole amount if not claimed", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(await Token.balanceOf(MerkleDistributorV2.target)).to.equal(0);
        expect(await Token.balanceOf(creator.address)).to.equal(
          ORIGINAL_BALANCE
        );
      });

      it("should update refundedAt timestamp", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(
          (await MerkleDistributorV2.distributions(0)).refundedAt
        ).to.equal(await time.latest());
      });

      it("should be able to refund the remaining amount", async function () {
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(await Token.balanceOf(MerkleDistributorV2.target)).to.equal(0);
        expect(await Token.balanceOf(carol.address)).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(await Token.balanceOf(creator.address)).to.equal(
          ORIGINAL_BALANCE - TEST_DATA.amountPerClaim
        );
      });

      it("should revert if all claimed", async function () {
        await MerkleDistributorV2.connect(alice).claim(
          0,
          getProof(this.tree, alice.address)
        );
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
        await MerkleDistributorV2.connect(bob).claim(
          0,
          getProof(this.tree, bob.address)
        );
        await expect(
          MerkleDistributorV2.connect(creator).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__NothingToRefund"
        );
      });

      it("should revert if already refunded", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        await expect(
          MerkleDistributorV2.connect(creator).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__AlreadyRefunded"
        );
      });
    }); // Refund
  }); // Set merkle root: ERC20

  describe("Set merkle root: ERC1155", function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x));
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await MultiToken.safeTransferFrom(
        deployer.address,
        creator.address,
        0,
        ORIGINAL_BALANCE,
        ZERO_BYTES32
      );
      await MultiToken.connect(creator).setApprovalForAll(
        MerkleDistributorV2.target,
        true
      );
      await MerkleDistributorV2.connect(creator).createDistribution(
        MultiToken.target,
        false,
        TEST_DATA.amountPerClaim, // wei(100)
        3n,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.metaData,
        { value: CREATION_FEE }
      );
      this.distribution = await MerkleDistributorV2.distributions(0);
    });

    it("should set merkle root correctly", async function () {
      expect(this.distribution.merkleRoot).to.equal(
        bufferToHex(this.tree.getRoot())
      );
    });

    it("should have alice in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          alice.address,
          getProof(this.tree, alice.address)
        )
      ).to.equal(true);
    });

    it("should have bob in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          bob.address,
          getProof(this.tree, bob.address)
        )
      ).to.equal(true);
    });

    it("should have carol in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          carol.address,
          getProof(this.tree, carol.address)
        )
      ).to.equal(true);
    });

    it("should NOT have david in the whitelist", async function () {
      expect(
        await MerkleDistributorV2.isWhitelisted(
          0,
          david.address,
          getProof(this.tree, david.address)
        )
      ).to.equal(false);
    });

    it("should not set any of isClaimed to true", async function () {
      expect(await MerkleDistributorV2.isClaimed(0, creator.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, alice.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, bob.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, carol.address)).to.equal(
        false
      );
      expect(await MerkleDistributorV2.isClaimed(0, david.address)).to.equal(
        false
      );
    });

    describe("Claim", function () {
      beforeEach(async function () {
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
      });

      it("should able to claim if merkle proof is valid", async function () {
        expect(await MultiToken.balanceOf(carol.address, 0)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });

      it("should increase the amount claimed", async function () {
        expect(await MerkleDistributorV2.getAmountClaimed(0)).to.equal(
          TEST_DATA.amountPerClaim
        );
      });

      it("should set isClaimed to true", async function () {
        expect(await MerkleDistributorV2.isClaimed(0, carol.address)).to.equal(
          true
        );
      });

      it("should not able to claim twice", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__AlreadyClaimed"
        );
      });

      it("should decrease the remaining amount", async function () {
        expect(await MerkleDistributorV2.getAmountLeft(0)).to.equal(
          TEST_DATA.amountPerClaim * 2n
        );
      });

      it("should revert if merkle proof is invalid", async function () {
        await expect(
          MerkleDistributorV2.connect(david).claim(
            0,
            getProof(this.tree, david.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidProof"
        );
      });

      it("should not able to claim before started", async function () {
        const leaves = defaultWhiltelist.map((x) => keccak256(x));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

        await MultiToken.setApprovalForAll(MerkleDistributorV2.target, true);
        await MerkleDistributorV2.connect(creator).createDistribution(
          MultiToken.target,
          false,
          TEST_DATA.amountPerClaim,
          3n,
          (await time.latest()) + 9999,
          TEST_DATA.endTime,
          bufferToHex(tree.getRoot()),
          TEST_DATA.metaData,
          { value: CREATION_FEE }
        );

        await expect(
          MerkleDistributorV2.connect(carol).claim(
            1,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__NotStarted"
        );
      });

      it("should not able to claim after ended", async function () {
        await time.increaseTo(TEST_DATA.endTime + 1);
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address)
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__Finished"
        );
      });
    }); // Claim

    describe("Claim fee should not be required for private airdrops", function () {
      it("should revert if claim fee is paid", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).claim(
            0,
            getProof(this.tree, carol.address),
            {
              value: CLAIM_FEE,
            }
          )
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidClaimFee"
        );
      });
    });

    describe("Refund", function () {
      it("should revert if not the creator", async function () {
        await expect(
          MerkleDistributorV2.connect(carol).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__PermissionDenied"
        );
      });

      it("should be able to refund the whole amount if not claimed", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(
          await MultiToken.balanceOf(MerkleDistributorV2.target, 0)
        ).to.equal(0);
        expect(await MultiToken.balanceOf(creator.address, 0)).to.equal(
          ORIGINAL_BALANCE
        );
      });

      it("should update refundedAt timestamp", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(
          (await MerkleDistributorV2.distributions(0)).refundedAt
        ).to.equal(await time.latest());
      });

      it("should be able to refund the remaining amount", async function () {
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
        await MerkleDistributorV2.connect(creator).refund(0);
        expect(
          await MultiToken.balanceOf(MerkleDistributorV2.target, 0)
        ).to.equal(0);
        expect(await MultiToken.balanceOf(carol.address, 0)).to.equal(
          TEST_DATA.amountPerClaim
        );
        expect(await MultiToken.balanceOf(creator.address, 0)).to.equal(
          ORIGINAL_BALANCE - TEST_DATA.amountPerClaim
        );
      });

      it("should revert if all claimed", async function () {
        await MerkleDistributorV2.connect(alice).claim(
          0,
          getProof(this.tree, alice.address)
        );
        await MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        );
        await MerkleDistributorV2.connect(bob).claim(
          0,
          getProof(this.tree, bob.address)
        );
        await expect(
          MerkleDistributorV2.connect(creator).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__NothingToRefund"
        );
      });

      it("should revert if already refunded", async function () {
        await MerkleDistributorV2.connect(creator).refund(0);
        await expect(
          MerkleDistributorV2.connect(creator).refund(0)
        ).to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__AlreadyRefunded"
        );
      });
    }); // Refund
  }); // Set merkle root: ERC1155

  describe("Edge cases", function () {
    beforeEach(async function () {
      const leaves = defaultWhiltelist.map((x) => keccak256(x)); // 3 whitelist
      this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      await Token.transfer(creator.address, ORIGINAL_BALANCE);
      await Token.connect(creator).approve(
        MerkleDistributorV2.target,
        TEST_DATA.amountPerClaim * 2n
      );
      await MerkleDistributorV2.connect(creator).createDistribution(
        Token.target,
        true,
        TEST_DATA.amountPerClaim, // wei(100)
        2n, // only 2 can calim
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        bufferToHex(this.tree.getRoot()),
        TEST_DATA.metaData,
        { value: CREATION_FEE }
      );
      this.distribution = await MerkleDistributorV2.distributions(0);
    });

    it("should revert if all claimed", async function () {
      await MerkleDistributorV2.connect(alice).claim(
        0,
        getProof(this.tree, alice.address)
      );
      await MerkleDistributorV2.connect(bob).claim(
        0,
        getProof(this.tree, bob.address)
      );
      await expect(
        MerkleDistributorV2.connect(carol).claim(
          0,
          getProof(this.tree, carol.address)
        )
      ).to.be.revertedWithCustomError(
        MerkleDistributorV2,
        "MerkleDistributorV2__NoClaimableTokensLeft"
      );
    });
  }); // Edge cases

  describe("Utility functions", function () {
    beforeEach(async function () {
      this.Token2 = await ethers.deployContract("TestToken", [
        ORIGINAL_BALANCE,
        "Test Token2",
        "TEST",
        18n,
      ]);
      await this.Token2.waitForDeployment();

      await Token.transfer(alice.address, ORIGINAL_BALANCE);
      await Token.connect(alice).approve(
        MerkleDistributorV2.target,
        ORIGINAL_BALANCE
      );
      await this.Token2.transfer(alice.address, ORIGINAL_BALANCE / 2n);
      await this.Token2.connect(alice).approve(
        MerkleDistributorV2.target,
        ORIGINAL_BALANCE / 2n
      );
      await this.Token2.transfer(bob.address, ORIGINAL_BALANCE / 2n);
      await this.Token2.connect(bob).approve(
        MerkleDistributorV2.target,
        ORIGINAL_BALANCE / 2n
      );

      this.RANDOM_PARAMS = [
        true,
        100,
        100,
        TEST_DATA.startTime,
        TEST_DATA.endTime,
        ZERO_BYTES32,
        TEST_DATA.metaData,
      ];

      this.output = function (distributionId, tokenAddress, creatorAddress) {
        return [
          tokenAddress,
          true,
          100n,
          0n,
          100n,
          0n,
          TEST_DATA.endTime,
          creatorAddress,
          0n,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "Test Airdrop",
          "",
          distributionId,
          "TEST",
          18n,
          "",
        ];
      };
    });

    describe("List functions", function () {
      beforeEach(async function () {
        await MerkleDistributorV2.connect(alice).createDistribution(
          Token.target,
          ...this.RANDOM_PARAMS,
          { value: CREATION_FEE }
        );
        await MerkleDistributorV2.connect(alice).createDistribution(
          this.Token2.target,
          ...this.RANDOM_PARAMS,
          { value: CREATION_FEE }
        );
        await MerkleDistributorV2.connect(bob).createDistribution(
          this.Token2.target,
          ...this.RANDOM_PARAMS,
          { value: CREATION_FEE }
        );
      });

      it("should return [0] for token = Token", async function () {
        const [ids, results] =
          await MerkleDistributorV2.getDistributionsByToken(
            Token.target,
            0,
            100
          );

        expect(ids).to.deep.equal([0]);
        expect(results).to.deep.equal([
          this.output(0n, Token.target, alice.address),
        ]);
      });

      it("should return [1, 2] for token = Token2", async function () {
        const [ids, results] =
          await MerkleDistributorV2.getDistributionsByToken(
            this.Token2.target,
            0,
            100
          );
        expect(ids).to.deep.equal([1, 2]);
        expect(results).to.deep.equal([
          this.output(1n, this.Token2.target, alice.address),
          this.output(2n, this.Token2.target, bob.address),
        ]);
      });

      it("should return [0, 1] for creator = alice", async function () {
        const [ids, results] =
          await MerkleDistributorV2.getDistributionsByCreator(
            alice.address,
            0,
            100
          );
        expect(ids).to.deep.equal([0, 1]);
        expect(results).to.deep.equal([
          this.output(0n, Token.target, alice.address),
          this.output(1n, this.Token2.target, alice.address),
        ]);
      });

      it("should return [2] for creator = bob", async function () {
        const [ids, results] =
          await MerkleDistributorV2.getDistributionsByCreator(
            bob.address,
            0,
            100
          );
        expect(ids).to.deep.equal([2]);
        expect(results).to.deep.equal([
          this.output(2n, this.Token2.target, bob.address),
        ]);
      });
    }); // List functions

    describe("Pagination and limits", function () {
      beforeEach(async function () {
        this.limit = 49;
        this.evenIds = [];
        this.evenOutputs = [];
        this.oddIds = [];
        this.oddOutputs = [];

        for (let i = 0; i < this.limit; i++) {
          if (i % 2 === 0) {
            await MerkleDistributorV2.connect(alice).createDistribution(
              Token.target,
              ...this.RANDOM_PARAMS,
              { value: CREATION_FEE }
            );
            this.evenIds.push(BigInt(i));
            this.evenOutputs.push(
              this.output(BigInt(i), Token.target, alice.address)
            );
          } else {
            await MerkleDistributorV2.connect(bob).createDistribution(
              this.Token2.target,
              ...this.RANDOM_PARAMS,
              { value: CREATION_FEE }
            );
            this.oddIds.push(BigInt(i));
            this.oddOutputs.push(
              this.output(BigInt(i), this.Token2.target, bob.address)
            );
          }
        }
      });

      describe("Count functions", function () {
        it("should return the count of all distributions filtered by creator", async function () {
          expect(
            await MerkleDistributorV2.getDistributionsCountByCreator(
              alice.address
            )
          ).to.equal(Math.ceil(this.limit / 2));
        });

        it("should return the count of all distributions filtered by token", async function () {
          expect(
            await MerkleDistributorV2.getDistributionsCountByToken(
              this.Token2.target
            )
          ).to.equal(Math.floor(this.limit / 2));
        });
      });

      describe("All ids", function () {
        it("should return all ids properly filtered by creator", async function () {
          expect(
            await MerkleDistributorV2.getAllDistributionIdsByCreator(
              alice.address
            )
          ).to.deep.equal(this.evenIds);
        });

        it("should return all ids properly filtered by token", async function () {
          expect(
            await MerkleDistributorV2.getAllDistributionIdsByToken(
              this.Token2.target
            )
          ).to.deep.equal(this.oddIds);
        });
      });

      describe("Filters", function () {
        it("should return even ids for token = Token", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByToken(
              Token.target,
              0,
              this.limit
            );
          expect(ids).to.deep.equal(this.evenIds);
          expect(results).to.deep.equal(this.evenOutputs);
        });

        it("should return odd ids for token = Token2", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByToken(
              this.Token2.target,
              0,
              this.limit
            );
          expect(ids).to.deep.equal(this.oddIds);
          expect(results).to.deep.equal(this.oddOutputs);
        });

        it("should return even ids for creator = alice", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByCreator(
              alice.address,
              0,
              this.limit
            );
          expect(ids).to.deep.equal(this.evenIds);
          expect(results).to.deep.equal(this.evenOutputs);
        });

        it("should return odd ids for creator = bob", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByCreator(
              bob.address,
              0,
              this.limit
            );
          expect(ids).to.deep.equal(this.oddIds);
          expect(results).to.deep.equal(this.oddOutputs);
        });
      }); // Filters

      describe("Pagination params", function () {
        it("should limit the number of results", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByToken(
              Token.target,
              0,
              10
            );
          expect(ids).to.deep.equal(this.evenIds.slice(0, 10));
          expect(results).to.deep.equal(this.evenOutputs.slice(0, 10));
        });

        it("should starts from startIndex", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByCreator(
              bob.address,
              10,
              5
            );
          expect(ids).to.deep.equal(this.oddIds.slice(10, 15));
          expect(results).to.deep.equal(this.oddOutputs.slice(10, 15));
        });

        it("should return empty if startIndex >= limit", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByToken(
              Token.target,
              this.limit,
              5
            );
          expect(ids).to.deep.equal([]);
          expect(results).to.deep.equal([]);
        });

        it("should return the last element", async function () {
          const [ids, results] =
            await MerkleDistributorV2.getDistributionsByCreator(
              bob.address,
              this.limit - 1,
              100
            );
          expect(ids).to.deep.equal(this.oddIds.slice(this.limit - 1));
          expect(results).to.deep.equal(this.oddOutputs.slice(this.limit - 1));
        });

        it("should revert if the limit is over 100", async function () {
          await expect(
            MerkleDistributorV2.getDistributionsByToken(Token.target, 0, 101)
          ).to.be.revertedWithCustomError(
            MerkleDistributorV2,
            "MerkleDistributorV2__InvalidPaginationParams"
          );
        });
      });
    }); // Pagination
  }); // Utility functions

  describe("Admin function", async function () {
    it("should revert if not owner", async function () {
      await expect(
        MerkleDistributorV2.connect(alice).updateProtocolBeneficiary(
          alice.address
        )
      ).to.be.revertedWithCustomError(
        MerkleDistributorV2,
        "OwnableUnauthorizedAccount"
      );
    });

    it("should update the protocol beneficiary", async function () {
      await MerkleDistributorV2.updateProtocolBeneficiary(alice.address);
      expect(await MerkleDistributorV2.protocolBeneficiary()).to.equal(
        alice.address
      );
    });

    it("should revert if the protocol beneficiary is zero address", async function () {
      await expect(MerkleDistributorV2.updateProtocolBeneficiary(NULL_ADDRESS))
        .to.be.revertedWithCustomError(
          MerkleDistributorV2,
          "MerkleDistributorV2__InvalidParams"
        )
        .withArgs("NULL_ADDRESS");
    });

    it("should emit ProtocolBeneficiaryUpdated event", async function () {
      await expect(MerkleDistributorV2.updateProtocolBeneficiary(alice.address))
        .to.emit(MerkleDistributorV2, "ProtocolBeneficiaryUpdated")
        .withArgs(alice.address);
    });

    it("should update the claim fee", async function () {
      await MerkleDistributorV2.updateClaimFee(100);
      expect(await MerkleDistributorV2.claimFee()).to.equal(100);
    });

    it("should emit ClaimFeeUpdated event", async function () {
      await expect(MerkleDistributorV2.updateClaimFee(100))
        .to.emit(MerkleDistributorV2, "ClaimFeeUpdated")
        .withArgs(100);
    });

    it("should revert if not owner", async function () {
      await expect(
        MerkleDistributorV2.connect(alice).updateClaimFee(100)
      ).to.be.revertedWithCustomError(
        MerkleDistributorV2,
        "OwnableUnauthorizedAccount"
      );
    });
  }); // Admin function
}); // MerkleDistributorV2
