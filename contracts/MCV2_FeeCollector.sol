// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // include Context

abstract contract MCV2_FeeCollector is Ownable {
    error MCV2_FeeCollector__NothingToClaim();
    error MCV2_FeeCollector__TokenTransferFailed();

    uint256 internal constant FEE_MAX = 100; // 1.0%
    uint256 private constant MAX_FEE_BASE = 10000;
    address internal protocolBeneficiary;
    uint256 internal protocolFee;

    // User => Token => Fee Balance
    mapping(address => mapping(address => uint256)) public userTokenFeeBalance;
    mapping(address => mapping(address => uint256)) public userTokenFeeClaimed; // INFO

    constructor(address protocolBeneficiary_, uint256 protocolFee_) {
        updateProtocolBeneficiary(protocolBeneficiary_, protocolFee_);
    }

    function addFee(address tokenAddress, address walletAddress, uint256 amount) internal {
        userTokenFeeBalance[walletAddress][tokenAddress] += amount;
    }

    function claim(address tokenAddress) external {
        address msgSender = _msgSender();
        uint256 amount = userTokenFeeBalance[msgSender][tokenAddress];
        if (amount == 0) revert MCV2_FeeCollector__NothingToClaim();

        userTokenFeeBalance[msgSender][tokenAddress] = 0;
        userTokenFeeClaimed[msgSender][tokenAddress] += amount; // INFO

        if(!IERC20(tokenAddress).transfer(msgSender, amount)) revert MCV2_FeeCollector__TokenTransferFailed();
    }

    // TODO: Add updateProtocolBeneficiary function
    function updateProtocolBeneficiary(address protocolBeneficiary_, uint256 protocolFee_) public onlyOwner {
        protocolBeneficiary = protocolBeneficiary_;
        protocolFee = protocolFee_;
    }

    function getBeneficiaryInfo() external view returns (address, uint256) {
        return (protocolBeneficiary, protocolFee);
    }

    // MARK: - Internal utility functions

    function getAmountAfterFees(uint256 amount, uint8 creatorFee) internal view returns (uint256) {
        return amount * (MAX_FEE_BASE - (creatorFee + protocolFee)) / MAX_FEE_BASE;
    }

    function getAmountWithFees(uint256 amount, uint8 creatorFee) internal view returns (uint256) {
        return amount * (MAX_FEE_BASE + creatorFee + protocolFee) / MAX_FEE_BASE;
    }

    // Calculate creator fee and protocol fee
    function getFees(uint256 amount, uint8 creatorFee) internal view returns (uint256, uint256) {
        return (amount * creatorFee / MAX_FEE_BASE, amount * protocolFee / MAX_FEE_BASE);
    }
}