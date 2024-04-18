// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IMCV2_Bond} from "./interfaces/IMCV2_Bond.sol";
import {IBulkSender} from "./interfaces/IBulkSender.sol";

/**
 * @title MCV2_NFTDistributor
 * @dev A contract for creating Mint Club V2's MultiToken and bulk sending in one transaction.
 */
contract MCV2_NFTDistributor {
    IMCV2_Bond public immutable bond;
    IBulkSender public immutable bulkSender;

    error MCV2_NFTDistributor__InvalidParams(string param);

    constructor(address bond_, address bulkSender_) {
        bond = IMCV2_Bond(bond_);
        bulkSender = IBulkSender(bulkSender_);
    }

    function createAndDistribute(
        IMCV2_Bond.MultiTokenParams calldata tp,
        IMCV2_Bond.BondParams calldata bp,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable returns (address token) {
        // Must be all free-minting
        if (bp.stepPrices[0] != 0)
            revert MCV2_NFTDistributor__InvalidParams("MUST_HAVE_FREE_MINTING");

        uint8 recipientsCount = uint8(recipients.length);
        uint256 totalAmount;
        for (uint256 i = 0; i < recipientsCount; i++) {
            totalAmount += amounts[i];
        }
        if (bp.stepRanges[0] != totalAmount)
            revert MCV2_NFTDistributor__InvalidParams(
                "TOTAL_AMOUNT_MUST_MATCH_FREE_MINTING_AMOUNT"
            );

        uint256 creationFee = bond.creationFee();
        uint256 senderFee = bulkSender.feePerRecipient() * recipientsCount;

        if (msg.value != creationFee + senderFee)
            revert MCV2_NFTDistributor__InvalidParams("INVALID_FEE_TOTAL");

        token = bond.createMultiToken{value: creationFee}(tp, bp);
        IERC1155(token).setApprovalForAll(address(bulkSender), true); // Approve bulkSender to transfer NFTs
        bulkSender.sendERC1155{value: senderFee}(token, recipients, amounts); // Distribute all NFTs
        bond.updateBondCreator(token, msg.sender); // Transfer ownership to msg.sender
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
