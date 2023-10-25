// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleDistributor {
    using SafeERC20 for IERC20;

    error MerkleDistributor__PermissionDenied();
    error MerkleDistributor__NotStarted();
    error MerkleDistributor__Finished();
    error MerkleDistributor__Refunded();
    error MerkleDistributor__AlreadyRefunded();
    error MerkleDistributor__NoClaimableTokensLeft();
    error MerkleDistributor__AlreadyClaimed();
    error MerkleDistributor__InvalidProof();
    error MerkleDistributor__InvalidParams(string param);
    error MerkleDistributor__NoRefundDuringClaim();
    error MerkleDistributor__NothingToRefund();

    event Refunded(uint256 distributionId, uint256 amount);
    event Claimed(uint256 distributionId, address account);

    struct Distribution {
        address token;
        uint24 walletCount;
        uint24 claimedCount; // 160 + 24 + 24 = 208 bits

        uint128 amountPerClaim;
        uint40 startTime; // supports up to year 36,825
        uint40 endTime; // 128 + 40 + 40 = 208 bits

        address owner;
        bool refunded; // 160 + 8 = 168 bits

        bytes32 merkleRoot; // 256 bits
        string title;
        string ipfsCID; // NOTE: Could save more gas with: https://github.com/saurfang/ipfs-multihash-on-solidity

        mapping(address => bool) isClaimed;
    }

    Distribution[] public distributions;

    modifier onlyOwner(uint256 distributionId) {
        if (msg.sender != distributions[distributionId].owner) revert MerkleDistributor__PermissionDenied();
        _;
    }

    // TODO: Add ERC1155 support - maybe a wrapper contract?

    function createDistribution(
        address token,
        uint96 amountPerClaim,
        uint24 walletCount,
        uint40 startTime,
        uint40 endTime,
        bytes32 merkleRoot, // optional
        string calldata title, // optional
        string calldata ipfsCID // optional
    ) external {
        if (token == address(0)) revert MerkleDistributor__InvalidParams('token');
        if (amountPerClaim == 0) revert MerkleDistributor__InvalidParams('amountPerClaim');
        if (walletCount == 0) revert MerkleDistributor__InvalidParams('walletCount');
        if (endTime <= block.timestamp) revert MerkleDistributor__InvalidParams('endTime');
        if (startTime >= endTime) revert MerkleDistributor__InvalidParams('startTime');

        // Deposit total amount of tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountPerClaim * walletCount);

        // Create a new distribution
        distributions.push();
        Distribution storage distribution = distributions[distributions.length - 1];
        distribution.token = token;
        distribution.walletCount = walletCount;
        // distribution.claimedCount = 0;

        distribution.amountPerClaim = amountPerClaim;
        distribution.startTime = startTime;
        distribution.endTime = endTime;

        distribution.owner = msg.sender;
        // distribution.refunded = false;
        distribution.merkleRoot = merkleRoot; // optional
        distribution.title = title; // optional
        distribution.ipfsCID = ipfsCID; // optional
    }

    function claim(uint256 distributionId, bytes32[] calldata merkleProof) external {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.startTime > block.timestamp) revert MerkleDistributor__NotStarted();
        if (distribution.endTime < block.timestamp) revert MerkleDistributor__Finished();
        if (distribution.refunded) revert MerkleDistributor__Refunded();
        if (distribution.isClaimed[msg.sender]) revert MerkleDistributor__AlreadyClaimed();
        if (distribution.claimedCount >= distribution.walletCount) revert MerkleDistributor__NoClaimableTokensLeft();

        // Verify the merkle proof
        if (distribution.merkleRoot != bytes32(0) && !MerkleProof.verify(
            merkleProof,
            distribution.merkleRoot,
            keccak256(abi.encodePacked(msg.sender))
        )) revert MerkleDistributor__InvalidProof();

        // Mark it claimed and send the token
        distribution.isClaimed[msg.sender] = true;
        distribution.claimedCount += 1;

        IERC20(distribution.token).safeTransfer(msg.sender, distribution.amountPerClaim);

        emit Claimed(distributionId, msg.sender);
    }

    // The owner can refund the remaining tokens whenever they want, even during the distribution
    function refund(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.refunded) revert MerkleDistributor__AlreadyRefunded();

        uint256 amountLeft = getAmountLeft(distributionId);
        if (amountLeft == 0) revert MerkleDistributor__NothingToRefund();

        distribution.refunded = true;
        IERC20(distribution.token).safeTransfer(distribution.owner, amountLeft);

        emit Refunded(distributionId, amountLeft);
    }

    // MARK: - Utility functions

    function isWhitelistOnly(uint256 distributionId) external view returns (bool) {
        return distributions[distributionId].merkleRoot != bytes32(0);
    }

    function isWhitelisted(uint256 distributionId, address wallet, bytes32[] calldata merkleProof) external view returns (bool) {
        return MerkleProof.verify(
            merkleProof,
            distributions[distributionId].merkleRoot,
            keccak256(abi.encodePacked(wallet))
        );
    }

    function isClaimed(uint256 distributionId, address wallet) external view returns (bool) {
        return distributions[distributionId].isClaimed[wallet];
    }

    function getAmountLeft(uint256 distributionId) public view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return distribution.amountPerClaim * (distribution.walletCount - distribution.claimedCount);
    }

    function getAmountClaimed(uint256 distributionId) external view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return distribution.amountPerClaim * distribution.claimedCount;
    }

    function getDistributionIdsByToken(address token) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count;
            uint256 distributionsLength = distributions.length;
            for (uint256 i = 0; i < distributionsLength; ++i) {
                if (distributions[i].token == token) ++count;
            }
            ids = new uint256[](count);

            uint256 j;
            for (uint256 i = 0; i < distributionsLength; ++i) {
                if (distributions[i].token == token) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    function getDistributionIdsByOwner(address owner) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count;
            uint256 distributionsLength = distributions.length;
            for (uint256 i = 0; i < distributionsLength; ++i) {
                if (distributions[i].owner == owner) ++count;
            }
            ids = new uint256[](count);

            uint256 j;
            for (uint256 i = 0; i < distributionsLength; ++i) {
                if (distributions[i].owner == owner) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }
}
