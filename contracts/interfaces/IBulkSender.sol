// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

interface IBulkSender {
    function feePerRecipient() external view returns (uint256);

    function sendERC1155(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable;

    function sendERC20(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable;
}
