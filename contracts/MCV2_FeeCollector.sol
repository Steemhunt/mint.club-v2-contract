// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // include Context

abstract contract MCV2_FeeCollector is Ownable {
    using SafeERC20 for IERC20;

    error MCV2_FeeCollector__NothingToClaim();
    error MCV2_FeeCollector__TokenTransferFailed();
    uint256 private constant MAX_FEE_BASE = 10000;
    address internal protocolBeneficiary;
    uint256 internal protocolFee;
    uint256 internal creatorFee;

    // User => Token => Fee Balance
    mapping(address => mapping(address => uint256)) public userTokenFeeBalance;
    mapping(address => mapping(address => uint256)) public userTokenFeeClaimed; // INFO

    // TODO: Custom creator fee for each token!
    

    constructor(address protocolBeneficiary_, uint256 protocolFee_, uint256 creatorFee_) {
        updateFeeRates(protocolBeneficiary_, protocolFee_, creatorFee_);
    }

    function addFee(address wallet, address reserveToken, uint256 amount) internal {
        userTokenFeeBalance[wallet][reserveToken] += amount;
    }

    function claimFees(address reserveToken) external {
        address msgSender = _msgSender();
        uint256 amount = userTokenFeeBalance[msgSender][reserveToken];
        if (amount == 0) revert MCV2_FeeCollector__NothingToClaim();

        userTokenFeeBalance[msgSender][reserveToken] = 0;
        userTokenFeeClaimed[msgSender][reserveToken] += amount; // INFO

        IERC20(reserveToken).safeTransfer(msgSender, amount);
    }

    function updateFeeRates(address protocolBeneficiary_, uint256 protocolFee_, uint256 creatorFee_) public onlyOwner {
        protocolBeneficiary = protocolBeneficiary_;
        protocolFee = protocolFee_;
        creatorFee = creatorFee_;
    }

    // MARK: - Utility view functions

    function getFeeConfigs() external view returns (address, uint256, uint256) {
        return (protocolBeneficiary, protocolFee, creatorFee);
    }

    function getFeeInfo(address wallet, address reserveToken) external view returns (uint256, uint256) {
        return (userTokenFeeBalance[wallet][reserveToken], userTokenFeeClaimed[wallet][reserveToken]);
    }

    // MARK: - Internal utility functions

    function getFees(uint256 amount) internal view returns (uint256, uint256) {
        return (amount * creatorFee / MAX_FEE_BASE, amount * protocolFee / MAX_FEE_BASE);
    }
}
