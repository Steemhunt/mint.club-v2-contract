// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BulkSender
 * @dev A contract for sending ERC20 / ERC1155 (id = 0) tokens to multiple addresses in a single transaction.
 * @notice With 30M block gas limit, the max number of recipient count was 4200 for ERC1155 / 5500 for ERC20
 */
contract BulkSender is Ownable {
    error BulkSender__InvalidParams(string param);
    error BulkSender__InsufficientTokenBalance();
    error BulkSender__InsufficientTokenAllowance();
    error BulkSender__InvalidFeeSent();
    error BulkSender__FeeTransactionFailed();

    address public protocolBeneficiary;
    uint256 public feePerRecipient;

    event Sent(address token, uint256 totalAmount, uint256 recipientsCount);
    event ProtocolBeneficiaryUpdated(address protocolBeneficiary);
    event FeeUpdated(uint256 feePerRecipient);

    constructor(
        address protocolBeneficiary_,
        uint256 feePerRecipient_
    ) Ownable(_msgSender()) {
        protocolBeneficiary = protocolBeneficiary_;
        feePerRecipient = feePerRecipient_;
    }

    // MARK: - Admin functions

    /**
     * @dev Updates the protocol beneficiary address.
     * @param protocolBeneficiary_ The new address of the protocol beneficiary.
     */
    function updateProtocolBeneficiary(
        address protocolBeneficiary_
    ) external onlyOwner {
        if (protocolBeneficiary_ == address(0))
            revert BulkSender__InvalidParams("NULL_ADDRESS");

        protocolBeneficiary = protocolBeneficiary_;

        emit ProtocolBeneficiaryUpdated(protocolBeneficiary_);
    }

    /**
     * @dev Updates the fee per recipient.
     * @param feePerRecipient_ The new fee per recipient.
     */
    function updateFeePerRecipient(
        uint256 feePerRecipient_
    ) external onlyOwner {
        feePerRecipient = feePerRecipient_;

        emit FeeUpdated(feePerRecipient_);
    }

    // MARK: - Send functions

    function _validateParams(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) private pure returns (uint256 totalAmount) {
        uint256 length = recipients.length;

        if (length == 0) revert BulkSender__InvalidParams("EMPTY_ARRAY");
        if (length != amounts.length)
            revert BulkSender__InvalidParams("ARRAYS_LENGTH_DO_NOT_MATCH");

        unchecked {
            for (uint256 i = 0; i < length; i++) {
                totalAmount += amounts[i];
            }
        }
        if (totalAmount == 0) revert BulkSender__InvalidParams("ZERO_AMOUNT");
    }

    function _validateFees(
        uint256 recipientsCount
    ) private view returns (uint256 totalFee) {
        totalFee = feePerRecipient * recipientsCount;
        if (msg.value != totalFee) revert BulkSender__InvalidFeeSent();
    }

    function _collectFee(uint256 totalFee) private {
        if (totalFee > 0) {
            (bool success, ) = payable(protocolBeneficiary).call{
                value: totalFee
            }("");
            if (!success) revert BulkSender__FeeTransactionFailed();
        }
    }

    /**
     * @dev Sends ERC20 tokens to multiple addresses.
     * @param token The address of the ERC20 token.
     * @param recipients The addresses of the recipients.
     * @param amounts The amounts of tokens to send to each recipient.
     */
    function sendERC20(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable {
        uint256 totalAmount = _validateParams(recipients, amounts);
        uint256 recipientsCount = recipients.length;
        uint256 totalFee = _validateFees(recipientsCount);

        if (totalAmount > IERC20(token).balanceOf(_msgSender()))
            revert BulkSender__InsufficientTokenBalance();
        if (totalAmount > IERC20(token).allowance(_msgSender(), address(this)))
            revert BulkSender__InsufficientTokenAllowance();

        // Send tokens to recipients
        unchecked {
            address msgSender = _msgSender(); // cache

            for (uint256 i = 0; i < recipientsCount; ++i) {
                IERC20(token).transferFrom(
                    msgSender,
                    recipients[i],
                    amounts[i]
                );
            }
        } // gas optimization

        emit Sent(token, totalAmount, recipientsCount);

        _collectFee(totalFee);
    }

    /**
     * @dev Sends ERC1155 tokens (only id = 0) to multiple addresses.
     * @param token The address of the ERC1155 token.
     * @param recipients The addresses of the recipients.
     * @param amounts The amounts of tokens to send to each recipient.
     */
    function sendERC1155(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable {
        uint256 totalAmount = _validateParams(recipients, amounts);
        uint256 recipientsCount = recipients.length;
        uint256 totalFee = _validateFees(recipientsCount);

        if (totalAmount > IERC1155(token).balanceOf(_msgSender(), 0))
            revert BulkSender__InsufficientTokenBalance();
        if (!IERC1155(token).isApprovedForAll(_msgSender(), address(this)))
            revert BulkSender__InsufficientTokenAllowance();

        // Send tokens to recipients
        unchecked {
            address msgSender = _msgSender(); // cache

            for (uint256 i = 0; i < recipientsCount; ++i) {
                IERC1155(token).safeTransferFrom(
                    msgSender,
                    recipients[i],
                    0,
                    amounts[i],
                    ""
                );
            }
        } // gas optimization

        emit Sent(token, totalAmount, recipientsCount);

        _collectFee(totalFee);
    }
}
