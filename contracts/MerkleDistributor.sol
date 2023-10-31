// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

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

    event Created(uint256 indexed distributionId, address indexed token, bool isERC20, uint40 startTime);
    event Refunded(uint256 indexed distributionId, uint256 amount);
    event Claimed(uint256 indexed distributionId, address account);

    struct Distribution {
        address token;
        bool isERC20;
        uint24 walletCount;
        uint24 claimedCount; // 160 + 8 + 24 + 24 = 216 bits

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

    function createDistribution(
        address token,
        bool isERC20,
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
        if (isERC20) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amountPerClaim * walletCount);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, amountPerClaim * walletCount, "");
        }

        // Create a new distribution
        distributions.push();
        Distribution storage distribution = distributions[distributions.length - 1];
        distribution.token = token;
        distribution.isERC20 = isERC20;
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

        emit Created(distributions.length - 1, token, isERC20, startTime);
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

        if (distribution.isERC20) {
            IERC20(distribution.token).safeTransfer(msg.sender, distribution.amountPerClaim);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(distribution.token).safeTransferFrom(address(this), msg.sender, 0, distribution.amountPerClaim, "");
        }

        emit Claimed(distributionId, msg.sender);
    }

    // The owner can refund the remaining tokens whenever they want, even during the distribution
    function refund(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.refunded) revert MerkleDistributor__AlreadyRefunded();

        uint256 amountLeft = getAmountLeft(distributionId);
        if (amountLeft == 0) revert MerkleDistributor__NothingToRefund();

        distribution.refunded = true;
        if (distribution.isERC20) {
            IERC20(distribution.token).safeTransfer(distribution.owner, amountLeft);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(distribution.token).safeTransferFrom(address(this), distribution.owner, 0, amountLeft, "");
        }

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

    // Get DistributionIds by token address in the range where start <= id < stop
    function getDistributionIdsByToken(address token, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 distributionsLength = distributions.length;
            if (stop > distributionsLength) {
                stop = distributionsLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (distributions[i].token == token) ++count;
            }

            ids = new uint256[](count);
            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                if (distributions[i].token == token) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    // Get DistributionIds by owner address in the range where start <= id < stop
    function getDistributionIdsByOwner(address owner, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 distributionsLength = distributions.length;
            if (stop > distributionsLength) {
                stop = distributionsLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (distributions[i].owner == owner) ++count;
            }

            ids = new uint256[](count);
            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                if (distributions[i].owner == owner) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    // MARK: - ERC1155 Receiver

    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function onERC721Received(address, address, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
