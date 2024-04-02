// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MerkleDistributorV2
 * @dev A contract for distributing tokens to multiple addresses using a Merkle tree.
 * @dev Update logs
 * 1. Added `claimFee` to charge a fee for claiming tokens to prevent bots from all public airdrops (no fee for private airdrops).
 * 2. Change `distribution.owner` to `distribution.creator` to avoid conflicts with the `Ownable` contract.
 * 3. Added `getDistributionsByCreator` and `getDistributionsByToken` to save read calls for each distribution.
 * 4. Remove `getDistributionIdsByCreator` and `getDistributionIdsByToken`
 */
contract MerkleDistributorV2 is Ownable {
    using SafeERC20 for IERC20;

    error MerkleDistributorV2__PermissionDenied();
    error MerkleDistributorV2__NotStarted();
    error MerkleDistributorV2__Finished();
    error MerkleDistributorV2__Refunded();
    error MerkleDistributorV2__AlreadyRefunded();
    error MerkleDistributorV2__NoClaimableTokensLeft();
    error MerkleDistributorV2__AlreadyClaimed();
    error MerkleDistributorV2__InvalidProof();
    error MerkleDistributorV2__InvalidParams(string param);
    error MerkleDistributorV2__InvalidClaimFee();
    error MerkleDistributorV2__ClaimFeeTransactionFailed();
    error MerkleDistributorV2__NothingToRefund();
    error MerkleDistributorV2__InvalidPaginationParams();

    // Events
    event Created(
        uint256 indexed distributionId,
        address indexed token,
        bool isERC20,
        uint40 startTime
    );
    event Refunded(uint256 indexed distributionId, uint256 amount);
    event Claimed(uint256 indexed distributionId, address account);
    event ProtocolBeneficiaryUpdated(address protocolBeneficiary);
    event ClaimFeeUpdated(uint256 amount);

    // Struct to store distribution details
    struct Distribution {
        address token;
        bool isERC20;
        uint40 walletCount; // max: ~1B wallets
        uint40 claimedCount; // 160 + 8 + 40 + 40 = 248 bits
        uint176 amountPerClaim;
        uint40 startTime; // supports up to year 36,825
        uint40 endTime; // 176 + 40 + 40 = 256 bits
        address creator;
        uint40 refundedAt; // 160 + 40 = 200 bits
        bytes32 merkleRoot; // 256 bits
        string title;
        string ipfsCID; // To store all WL addresses to create the Merkle Proof
    }

    Distribution[] public distributions;
    mapping(uint256 => mapping(address => bool)) public isClaimed; // distributionId => account => claimed
    mapping(address => uint256[]) private _tokenDistributions;
    mapping(address => uint256[]) private _creatorDistributions;

    address public protocolBeneficiary;
    uint256 public claimFee;

    constructor(
        address protocolBeneficiary_,
        uint256 claimFee_
    ) Ownable(msg.sender) {
        protocolBeneficiary = protocolBeneficiary_;
        claimFee = claimFee_;
    }

    /**
     * @dev Modifier to check if the caller is the creator of the distribution.
     * @param distributionId The ID of the distribution.
     */
    modifier onlyCreator(uint256 distributionId) {
        if (msg.sender != distributions[distributionId].creator)
            revert MerkleDistributorV2__PermissionDenied();
        _;
    }

    // MARK: - Admin functions

    /**
     * @dev Updates the protocol beneficiary address.
     * @param protocolBeneficiary_ The new address of the protocol beneficiary.
     */
    function updateProtocolBeneficiary(
        address protocolBeneficiary_
    ) public onlyOwner {
        if (protocolBeneficiary == address(0))
            revert MerkleDistributorV2__InvalidParams("NULL_ADDRESS");

        protocolBeneficiary = protocolBeneficiary_;

        emit ProtocolBeneficiaryUpdated(protocolBeneficiary_);
    }

    function updateClaimFee(uint256 amount) external onlyOwner {
        claimFee = amount;

        emit ClaimFeeUpdated(amount);
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
    struct MetadataParams {
        string title;
        string ipfsCID;
    }

    function createDistribution(
        address token,
        bool isERC20,
        uint176 amountPerClaim,
        uint40 walletCount,
        uint40 startTime,
        uint40 endTime,
        bytes32 merkleRoot,
        MetadataParams calldata metaData
    ) external {
        if (token == address(0))
            revert MerkleDistributorV2__InvalidParams("token");
        if (amountPerClaim == 0)
            revert MerkleDistributorV2__InvalidParams("amountPerClaim");
        if (walletCount == 0)
            revert MerkleDistributorV2__InvalidParams("walletCount");
        if (endTime <= block.timestamp)
            revert MerkleDistributorV2__InvalidParams("endTime");
        if (startTime >= endTime)
            revert MerkleDistributorV2__InvalidParams("startTime");

        // Create a new distribution
        distributions.push();
        uint256 distributionId = distributions.length - 1;
        Distribution storage distribution = distributions[distributionId];
        distribution.token = token;
        distribution.isERC20 = isERC20;
        distribution.walletCount = walletCount;
        // distribution.claimedCount = 0;

        distribution.amountPerClaim = amountPerClaim;
        distribution.startTime = startTime;
        distribution.endTime = endTime;

        distribution.creator = msg.sender;
        // distribution.refundedAt = 0;
        distribution.merkleRoot = merkleRoot; // optional
        distribution.title = metaData.title; // optional
        distribution.ipfsCID = metaData.ipfsCID; // optional

        // Deposit total amount of tokens to this contract
        if (isERC20) {
            IERC20(token).safeTransferFrom(
                msg.sender,
                address(this),
                amountPerClaim * walletCount
            );
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(token).safeTransferFrom(
                msg.sender,
                address(this),
                0,
                amountPerClaim * walletCount,
                ""
            );
        }

        // Update mappings
        _tokenDistributions[token].push(distributionId);
        _creatorDistributions[msg.sender].push(distributionId);

        emit Created(distributionId, token, isERC20, startTime);
    }

    /**
     * @dev Allows a user to claim tokens from a specific distribution using a merkle proof.
     * @param distributionId The ID of the distribution.
     * @param merkleProof The merkle proof for the user's claim.
     */
    function claim(
        uint256 distributionId,
        bytes32[] calldata merkleProof
    ) external payable {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.startTime > block.timestamp)
            revert MerkleDistributorV2__NotStarted();
        if (distribution.endTime < block.timestamp)
            revert MerkleDistributorV2__Finished();
        if (distribution.refundedAt > 0) revert MerkleDistributorV2__Refunded();
        if (isClaimed[distributionId][msg.sender])
            revert MerkleDistributorV2__AlreadyClaimed();
        if (distribution.claimedCount >= distribution.walletCount)
            revert MerkleDistributorV2__NoClaimableTokensLeft();

        // For public airdrop, we've added a claimFee to prevent bots from claiming all tokens
        if (distribution.merkleRoot == bytes32(0)) {
            if (msg.value != claimFee)
                revert MerkleDistributorV2__InvalidClaimFee();
        } else {
            // Whitelist only
            if (msg.value != 0) revert MerkleDistributorV2__InvalidClaimFee();
            if (
                !MerkleProof.verify(
                    merkleProof,
                    distribution.merkleRoot,
                    keccak256(abi.encodePacked(msg.sender))
                )
            ) revert MerkleDistributorV2__InvalidProof();
        }

        // Mark it claimed and send the token
        isClaimed[distributionId][msg.sender] = true;
        distribution.claimedCount += 1;

        if (distribution.isERC20) {
            IERC20(distribution.token).safeTransfer(
                msg.sender,
                distribution.amountPerClaim
            );
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(distribution.token).safeTransferFrom(
                address(this),
                msg.sender,
                0,
                distribution.amountPerClaim,
                ""
            );
        }

        // Collect claimFee if it's a public airdriop and claimFee exists
        if (distribution.merkleRoot == bytes32(0) && claimFee > 0) {
            (bool success, ) = payable(protocolBeneficiary).call{
                value: claimFee
            }("");
            if (!success)
                revert MerkleDistributorV2__ClaimFeeTransactionFailed();
        }

        emit Claimed(distributionId, msg.sender);
    }

    /**
     * @dev Allows the creator to refund the remaining tokens from a specific distribution.
     * @param distributionId The ID of the distribution to refund.
     * @notice The creator can refund the remaining tokens whenever they want, even during the distribution.
     */
    function refund(
        uint256 distributionId
    ) external onlyCreator(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (distribution.refundedAt > 0)
            revert MerkleDistributorV2__AlreadyRefunded();

        uint256 amountLeft = getAmountLeft(distributionId);
        if (amountLeft == 0) revert MerkleDistributorV2__NothingToRefund();

        distribution.refundedAt = uint40(block.timestamp);

        // Transfer the remaining tokens back to the creator
        if (distribution.isERC20) {
            IERC20(distribution.token).safeTransfer(
                distribution.creator,
                amountLeft
            );
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(distribution.token).safeTransferFrom(
                address(this),
                distribution.creator,
                0,
                amountLeft,
                ""
            );
        }

        emit Refunded(distributionId, amountLeft);
    }

    // MARK: - Utility functions

    /**
     * @dev Checks if a distribution is whitelist-only.
     * @param distributionId The ID of the distribution.
     * @return A boolean indicating whether the distribution is whitelist-only.
     */
    function isWhitelistOnly(
        uint256 distributionId
    ) external view returns (bool) {
        return distributions[distributionId].merkleRoot != bytes32(0);
    }

    /**
     * @dev Checks if an address is whitelisted for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @param wallet The address to check.
     * @param merkleProof The Merkle proof for the address.
     * @return A boolean indicating whether the address is whitelisted.
     */
    function isWhitelisted(
        uint256 distributionId,
        address wallet,
        bytes32[] calldata merkleProof
    ) external view returns (bool) {
        return
            MerkleProof.verify(
                merkleProof,
                distributions[distributionId].merkleRoot,
                keccak256(abi.encodePacked(wallet))
            );
    }

    /**
     * @dev Returns the amount of tokens left to be claimed for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @return The amount of tokens left to be claimed.
     */
    function getAmountLeft(
        uint256 distributionId
    ) public view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return
            distribution.amountPerClaim *
            (distribution.walletCount - distribution.claimedCount);
    }

    /**
     * @dev Returns the total amount claimed for a specific distribution.
     * @param distributionId The ID of the distribution.
     * @return The total amount claimed for the distribution.
     */
    function getAmountClaimed(
        uint256 distributionId
    ) external view returns (uint256) {
        Distribution storage distribution = distributions[distributionId];

        return distribution.amountPerClaim * distribution.claimedCount;
    }

    /**
     * @dev Returns the number of distributions in the MerkleDistributorV2 contract.
     * @return The number of distributions.
     */
    function distributionCount() external view returns (uint256) {
        return distributions.length;
    }

    /**
     * @dev Retrieves the distribution length for made by a specific creator.
     * @param creator The address of the creator.
     * @return The distribution count
     */
    function getDistributionsCountByCreator(
        address creator
    ) external view returns (uint256) {
        return _creatorDistributions[creator].length;
    }

    /**
     * @dev Retrieves all the distributions created by a specific address.
     * @param creator The address of the creator.
     * @return An array of distribution IDs created by the address.
     */
    function getAllDistributionIdsByCreator(
        address creator
    ) external view returns (uint256[] memory) {
        return _creatorDistributions[creator];
    }

    /**
     * @dev Retrieves the distributions created by a specific address within a specified range.
     * @param creator The address of the creator.
     * @param startIndex The starting index.
     * @param limit The maximum number of results to return.
     * @return ids An array of distribution IDs within the specified range.
     * @return data An array of Distribution structs within the specified range.
     */
    function getDistributionsByCreator(
        address creator,
        uint256 startIndex,
        uint256 limit
    ) external view returns (uint256[] memory ids, Distribution[] memory data) {
        if (limit > 100) revert MerkleDistributorV2__InvalidPaginationParams();

        unchecked {
            uint256 totalLength = _creatorDistributions[creator].length;
            if (startIndex >= totalLength) {
                return (ids, data); // return empty
            }
            uint256 until = startIndex + limit;
            if (until > totalLength) {
                until = totalLength;
            }
            uint256 size = until - startIndex;

            ids = new uint256[](size);
            data = new Distribution[](size);
            uint256 outputIndex;
            for (uint256 i = startIndex; i < until; ++i) {
                uint256 distributionId = _creatorDistributions[creator][i];
                ids[outputIndex] = distributionId;
                data[outputIndex] = distributions[distributionId];
                ++outputIndex;
            }
        }
    }

    /**
     * @dev Retrieves the distribution length for made by a specific token.
     * @param token The address of the token.
     * @return The distribution count
     */
    function getDistributionsCountByToken(
        address token
    ) external view returns (uint256) {
        return _tokenDistributions[token].length;
    }

    /**
     * @dev Retrieves all the distributions created by a specific address.
     * @param token The address of the token.
     * @return An array of distribution IDs created by the address.
     */
    function getAllDistributionIdsByToken(
        address token
    ) external view returns (uint256[] memory) {
        return _tokenDistributions[token];
    }

    /**
     * @dev Retrieves the distributions for a specific token within a specified range.
     * @param token The address of the token.
     * @param startIndex The starting index.
     * @param limit The maximum number of result to return.
     * @return ids An array of distribution IDs within the specified range.
     * @return data An array of Distribution structs within the specified range.
     */
    function getDistributionsByToken(
        address token,
        uint256 startIndex,
        uint256 limit
    ) external view returns (uint256[] memory ids, Distribution[] memory data) {
        if (limit > 100) revert MerkleDistributorV2__InvalidPaginationParams();

        unchecked {
            uint256 totalLength = _tokenDistributions[token].length;
            if (startIndex >= totalLength) {
                return (ids, data); // return empty
            }
            uint256 until = startIndex + limit;
            if (until > totalLength) {
                until = totalLength;
            }
            uint256 size = until - startIndex;

            ids = new uint256[](size);
            data = new Distribution[](size);
            uint256 outputIndex;
            for (uint256 i = startIndex; i < until; ++i) {
                uint256 distributionId = _tokenDistributions[token][i];
                ids[outputIndex] = distributionId;
                data[outputIndex] = distributions[distributionId];
                ++outputIndex;
            }
        }
    }

    // MARK: - ERC1155 Receiver

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
