// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // include Context

abstract contract MCV2_Royalty is Ownable {
    using SafeERC20 for IERC20;

    error MCV2_Royalty__NothingToClaim();
    error MCV2_Royalty__TokenTransferFailed();

    uint256 private constant RATIO_BASE = 10000; // 100.00%
    uint256 private constant PROTOCOL_CUT = 2000;
    uint256 internal constant MAX_ROYALTY_RANGE = 5000; // The max fee is set at 50% to offer flexibility in tokenomics

    address public protocolBeneficiary;

    // User => ReserveToken => Fee Balance
    mapping(address => mapping(address => uint256)) public userTokenFeeBalance;
    mapping(address => mapping(address => uint256)) public userTokenFeeClaimed; // INFO

    event FeeClaimed(address indexed user, address reserveToken, uint256 amount);

    constructor(address protocolBeneficiary_) {
        updateProtocolBeneficiary(protocolBeneficiary_);
    }

    function updateProtocolBeneficiary(address protocolBeneficiary_) public onlyOwner {
        protocolBeneficiary = protocolBeneficiary_;
    }

    // MARK: - Internal utility functions

    // Returns (creatorFee, protocolFee)
    function getFees(uint256 amount, uint16 feeRate) internal pure returns (uint256, uint256) {
        uint256 totalFee = amount * feeRate / RATIO_BASE;
        uint256 protocolFee = totalFee * PROTOCOL_CUT / RATIO_BASE;

        return (totalFee - protocolFee, protocolFee);
    }

    // Add fee to the fee balance of the beneficiary and the protocol
    function addFee(address beneficiary, address reserveToken, uint256 feeAmount) internal {
        uint256 protocolFee = feeAmount * PROTOCOL_CUT / RATIO_BASE;
        userTokenFeeBalance[beneficiary][reserveToken] += feeAmount - protocolFee;
        userTokenFeeBalance[protocolBeneficiary][reserveToken] += protocolFee;
    }

    // MARK: - External functions

    function claimFees(address reserveToken) external {
        address msgSender = _msgSender();
        uint256 amount = userTokenFeeBalance[msgSender][reserveToken];
        if (amount == 0) revert MCV2_Royalty__NothingToClaim();

        userTokenFeeBalance[msgSender][reserveToken] = 0;
        userTokenFeeClaimed[msgSender][reserveToken] += amount; // INFO

        IERC20(reserveToken).safeTransfer(msgSender, amount);

        emit FeeClaimed(msgSender, reserveToken, amount);
    }

    // MARK: - Utility view functions

    function getFeeInfo(address wallet, address reserveToken) external view returns (uint256, uint256) {
        return (userTokenFeeBalance[wallet][reserveToken], userTokenFeeClaimed[wallet][reserveToken]);
    }
}
