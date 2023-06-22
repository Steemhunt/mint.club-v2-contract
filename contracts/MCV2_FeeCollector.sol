// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";

abstract contract MCV2_FeeCollector is Context {
    error MCV2_FeeCollector__NothingToClaim();
    error MCV2_FeeCollector__TokenTransferFailed();

    uint256 internal constant CREATOR_FEE_MAX = 100; // 1.0%
    uint256 internal constant PROTOCOL_FEE = 10; // 0.1%
    uint256 internal constant MAX_FEE_BASE = 10000;
    address internal protocolBeneficiary;

    // User => Token => Fee Balance
    mapping(address => mapping(address => uint256)) public userTokenFeeBalance;

    constructor(address protocolBeneficiary_) {
        protocolBeneficiary = protocolBeneficiary_;
    }

    function addFee(address tokenAddress, address walletAddress, uint256 amount) internal {
        userTokenFeeBalance[walletAddress][tokenAddress] += amount;
    }

    function claim(address tokenAddress) external {
        uint256 amount = userTokenFeeBalance[_msgSender()][tokenAddress];
        if (amount == 0) revert MCV2_FeeCollector__NothingToClaim();

        userTokenFeeBalance[_msgSender()][tokenAddress] = 0;
        if(!IERC20(tokenAddress).transfer(_msgSender(), amount)) revert MCV2_FeeCollector__TokenTransferFailed();
    }

    function getAmountAfterFees(uint256 amount, uint8 creatorFee) internal pure returns (uint256) {
        return amount * (MAX_FEE_BASE - (creatorFee + PROTOCOL_FEE)) / MAX_FEE_BASE;
    }

    function getAmountWithFees(uint256 amount, uint8 creatorFee) internal pure returns (uint256) {
        return amount * (MAX_FEE_BASE + creatorFee + PROTOCOL_FEE) / MAX_FEE_BASE;
    }

    // Calculate creator fee and protocol fee
    function getFees(uint256 amount, uint8 creatorFee) internal pure returns (uint256, uint256) {
        return (amount * creatorFee / MAX_FEE_BASE, amount * PROTOCOL_FEE / MAX_FEE_BASE);
    }
}