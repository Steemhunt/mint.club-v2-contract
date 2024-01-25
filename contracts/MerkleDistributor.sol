// SPDX-License-Identifier: BSD-3-Clause
pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MerkleDistributor
 * @dev A contract for distributing tokens to multiple addresses using a Merkle tree.
 */
contract MerkleDistributor {
    using SafeERC20 for IERC20;

    error MerkleDistributor__PermissionDenied();
    error MerkleDistributor__NotStarted();
    error MerkleDistributor__Finished();
    error MerkleDistributor__Refunded();
    error MerkleDistributor__AlreadyRefunded();
    error MerkleDistributor__NoClaimableTokensLeft();
    error MerkleDistributor__AlreadyClaimed();
    error MerkleDistributor__InvalidCaller();
    error MerkleDistributor__InvalidProof();
    error MerkleDistributor__InvalidParams(string param);
    error MerkleDistributor__NothingToRefund();
    error MerkleDistributor__InvalidPaginationParameters();

    // Events
    event Created(uint256 indexed distributionId, address indexed token, bool isERC20, uint40 startTime);
    event Refunded(uint256 indexed distributionId, uint256 amount);
    event Claimed(uint256 indexed distributionId, address account);

    // Struct to store distribution details
    struct Distribution {
        address token;
        bool isERC20;
        uint40 walletCount; // max: ~1B wallets
        uint40 claimedCount; // 160 + 8 + 40 + 40 = 248 bits

        uint176 amountPerClaim;
        uint40 startTime; // supports up to year 36,825
        uint40 endTime; // 176 + 40 + 40 = 256 bits

        address owner;
        uint40 refundedAt; // 160 + 40 = 200 bits

        bytes32 merkleRoot; // 256 bits
        string title;
        string ipfsCID; // To store all WL addresses to create the Merkle Proof

        mapping(address => bool) isClaimed;
    }

    Distribution[] public distributions;

    /**
     * @dev Modifier to check if the caller is the owner of the distribution.
     * @param distributionId The ID of the distribution.
     */
    modifier onlyOwner(uint256 distributionId) {
        if (msg.sender != distributions[distributionId].owner) revert MerkleDistributor__PermissionDenied();
        _;
    }

    /**
     * @dev Creates a new token distribution.
     * @param token The address of the token to be distributed.
     * @param isERC20 Flag indicating if the token is an ERC20 token.
     * @param amountPerClaim The amount of tokens to be distributed per claim.
     * @param walletCount The number of wallets to distribute tokens to.
     * @param startTime The start time of the distribution.
     * @param endTime The end time of the distribution.
     * @param merkleRoot The Merkle root of the distribution (optional).
     * @param title The title of the distribution (optional).
     * @param ipfsCID The IPFS CID of the distribution (optional).
     *
     * @notice If the Merkle root is not provided, there will be no verification on claims,
     * anyone can claim all tokens with multiple accounts.
     */
    function createDistribution(
        address token,
        bool isERC20,
        uint176 amountPerClaim,
        uint40 walletCount,
        uint40 startTime,
        uint40 endTime,
        bytes32 merkleRoot,
        string calldata title,
        string calldata ipfsCID
    ) external {
        if (token == address(0)) revert MerkleDistributor__InvalidParams('token');
        if (amountPerClaim == 0) revert MerkleDistributor__InvalidParams('amountPerClaim');
        if (walletCount == 0) revert MerkleDistributor__InvalidParams('walletCount');
        if (endTime <= block.timestamp) revert MerkleDistributor__InvalidParams('endTime');
        if (startTime >= endTime) revert MerkleDistributor__InvalidParams('startTime');

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
        // distribution.refundedAt = 0;
        distribution.merkleRoot = merkleRoot; // optional
        distribution.title = title; // optional
        distribution.ipfsCID = ipfsCID; // optional

        // Deposit total amount of tokens to this contract
        if (isERC20) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amountPerClaim * walletCount);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, amountPerClaim * walletCount, "");
        }

        emit Created(distributions.length - 1, token, isERC20, startTime);
    }

    /**
     * @dev Allows a user to claim tokens from a specific distribution using a merkle proof.
     * @param distributionId The ID of the distribution.
     * @param merkleProof The merkle proof for the user's claim.
     */
    function claim(uint256 distributionId, bytes32[] calldata merkleProof) external {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.startTime > block.timestamp) revert MerkleDistributor__NotStarted();
        if (distribution.endTime < block.timestamp) revert MerkleDistributor__Finished();
        if (distribution.refundedAt > 0) revert MerkleDistributor__Refunded();
        if (distribution.isClaimed[msg.sender]) revert MerkleDistributor__AlreadyClaimed();
        if (distribution.claimedCount >= distribution.walletCount) revert MerkleDistributor__NoClaimableTokensLeft();

        if (distribution.merkleRoot == bytes32(0)) { // Public airdrop
            // NOTE: Block contracts from claiming tokens to prevent abuse during a public airdrop.
            // This won't completely eliminate bot claiming but will make it more challenging.
            // Caveat: ERC4337-based wallets will also be unable to claim; however, they can use an EOA to do so.
            if(tx.origin != msg.sender) revert MerkleDistributor__InvalidCaller();
        } else { // Whitelist only
            if (!MerkleProof.verify(
                merkleProof,
                distribution.merkleRoot,
                keccak256(abi.encodePacked(msg.sender))
            )) revert MerkleDistributor__InvalidProof();
        }

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

    /**
     * @dev Allows the owner to refund the remaining tokens from a specific distribution.
     * @param distributionId The ID of the distribution to refund.
     * @notice The owner can refund the remaining tokens whenever they want, even during the distribution.
     */
    function refund(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.refundedAt > 0) revert MerkleDistributor__AlreadyRefunded();

        uint256 amountLeft = getAmountLeft(distributionId);
        if (amountLeft == 0) revert MerkleDistributor__NothingToRefund();

        distribution.refundedAt = uint40(block.timestamp);

        // Transfer the remaining tokens back to the owner
        if (distribution.isERC20) {
            IERC20(distribution.token).safeTransfer(distribution.owner, amountLeft);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(distribution.token).safeTransferFrom(address(this), distribution.owner, 0, amountLeft, "");
        }

        emit Refunded(distributionId, amountLeft);
    }

    // MARK: - Utility functions

    /**
     * @dev Checks if a distribution is whitelist-only.
     * @param distributionId The ID of the distribution.
     * @return A boolean indicating whether the distribution is whitelist-only.
     */
    function isWhitelistOnly(uint256 distributionId) external view returns (bool) {
        return distributions[distributionId].merkleRoot != bytes32(0);
    }

    /**
     * @dev Checks if an address is whitelisted for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @param wallet The address to check.
     * @param merkleProof The Merkle proof for the address.
     * @return A boolean indicating whether the address is whitelisted.
     */
    function isWhitelisted(uint256 distributionId, address wallet, bytes32[] calldata merkleProof) external view returns (bool) {
        return MerkleProof.verify(
            merkleProof,
            distributions[distributionId].merkleRoot,
            keccak256(abi.encodePacked(wallet))
        );
    }

    /**
     * @dev Checks if a specific wallet address has claimed the tokens for a given distribution ID.
     * @param distributionId The ID of the distribution.
     * @param wallet The wallet address to check.
     * @return A boolean indicating whether the wallet address has claimed the tokens or not.
     */
    function isClaimed(uint256 distributionId, address wallet) external view returns (bool) {
        return distributions[distributionId].isClaimed[wallet];
    }

    /**
     * @dev Returns the amount of tokens left to be claimed for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @return The amount of tokens left to be claimed.
     */
    function getAmountLeft(uint256 distributionId) public view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return distribution.amountPerClaim * (distribution.walletCount - distribution.claimedCount);
    }

    /**
     * @dev Returns the total amount claimed for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @return The total amount claimed for the distribution.
     */
    function getAmountClaimed(uint256 distributionId) external view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return distribution.amountPerClaim * distribution.claimedCount;
    }

    /**
     * @dev Returns the number of distributions in the MerkleDistributor contract.
     * @return The number of distributions.
     */
    function distributionCount() external view returns (uint256) {
        return distributions.length;
    }

    /**
     * @dev Retrieves the distribution IDs for a given token address within a specified range.
     * @param token The address of the token.
     * @param start The starting index of the range (inclusive).
     * @param stop The ending index of the range (exclusive).
     * @return ids An array of distribution IDs within the specified range.
     */
    function getDistributionIdsByToken(address token, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        if (start >= stop || stop - start > 10000) revert MerkleDistributor__InvalidPaginationParameters();

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

    /**
     * @dev Retrieves the distribution IDs owned by a specific address within a given range.
     * @param owner The address of the owner.
     * @param start The starting index of the range (inclusive).
     * @param stop The ending index of the range (exclusive).
     * @return ids An array of distribution IDs owned by the specified address within the given range.
     */
    function getDistributionIdsByOwner(address owner, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        if (start >= stop || stop - start > 10000) revert MerkleDistributor__InvalidPaginationParameters();

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
}
