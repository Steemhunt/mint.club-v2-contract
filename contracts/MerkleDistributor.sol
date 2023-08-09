// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleDistributor {
    using SafeERC20 for IERC20;

    error MerkleDistributor__PermissionDenied();
    error MerkleDistributor__ClaimWindowFinished();
    error MerkleDistributor__AlreadyClaimed();
    error MerkleDistributor__InvalidProof();
    error MerkleDistributor__InvalidParams(string param);
    error MerkleDistributor__NoRefundDuringClaim();
    error MerkleDistributor__NothingToRefund();

    event Refunded(uint256 distributionId, uint256 amount);
    event Claimed(uint256 distributionId, address account);

    struct Distribution {
        address token;
        uint96 amountPerClaim; // (supports ~ 79B) 160 + 96 = 256 bits
        uint24 whitelistCount;
        uint24 claimedCount;
        uint40 endTime; // supports up to year 36,825
        bool refunded;
        address owner; // 24 + 24 + 40 + 8 + 160 = 256 bits
        bytes32 merkleRoot; // 256 bits
        string title;

        mapping(address => bool) isClaimed;
    }

    Distribution[] public distributions;

    modifier onlyOwner(uint256 distributionId) {
        if (msg.sender != distributions[distributionId].owner) revert MerkleDistributor__PermissionDenied();
        _;
    }

    function createDistribution(
        address token,
        uint96 amountPerClaim,
        uint24 whitelistCount,
        uint40 endTime,
        bytes32 merkleRoot,
        string calldata title
    ) external {
        if (token == address(0)) revert MerkleDistributor__InvalidParams('token');
        if (amountPerClaim == 0) revert MerkleDistributor__InvalidParams('amountPerClaim');
        if (whitelistCount == 0) revert MerkleDistributor__InvalidParams('whitelistCount');
        if (endTime <= block.timestamp) revert MerkleDistributor__InvalidParams('endTime');

        // Deposit total amount of tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountPerClaim * whitelistCount);

        // Create a new distribution
        distributions.push();
        Distribution storage distribution = distributions[distributions.length - 1];
        distribution.token = token;
        distribution.amountPerClaim = amountPerClaim;
        distribution.whitelistCount = whitelistCount;
        // distribution.claimedCount = 0;
        distribution.endTime = endTime;
        // distribution.refunded = false;
        distribution.merkleRoot = merkleRoot;
        distribution.title = title;
        distribution.owner = msg.sender;
    }

    function claim(uint256 distributionId, bytes32[] calldata merkleProof) external {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.endTime < block.timestamp) revert MerkleDistributor__ClaimWindowFinished();
        if (distribution.isClaimed[msg.sender]) revert MerkleDistributor__AlreadyClaimed();

        // Verify the merkle proof
        if (!MerkleProof.verify(
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

    function refund(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];
        if (block.timestamp < distribution.endTime) revert MerkleDistributor__NoRefundDuringClaim();

        uint256 amountLeft = getAmountLeft(distributionId);
        if (amountLeft == 0) revert MerkleDistributor__NothingToRefund();

        distribution.refunded = true;
        IERC20(distribution.token).safeTransfer(distribution.owner, amountLeft);

        emit Refunded(distributionId, amountLeft);
    }

    // MARK: - Utility functions

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

        return distribution.amountPerClaim * (distribution.whitelistCount - distribution.claimedCount);
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
