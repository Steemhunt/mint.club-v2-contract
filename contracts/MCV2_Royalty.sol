// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol"; // include Context

abstract contract MCV2_Royalty is Ownable {
    using SafeERC20 for IERC20;

    error MCV2_Royalty__NothingToClaim();
    error MCV2_Royalty__TokenTransferFailed();

    uint256 private constant RATIO_BASE = 10000; // 100.00%
    uint256 private constant PROTOCOL_CUT = 2000;
    uint256 internal constant MAX_ROYALTY_RANGE = 5000; // The max is set at 50% to offer flexibility in tokenomics

    address public constant BURN_ADDRESS = address(0x000000000000000000000000000000000000dEaD);
    address public protocolBeneficiary;

    // User => ReserveToken => Royalty Balance
    mapping(address => mapping(address => uint256)) public userTokenRoyaltyBalance;
    mapping(address => mapping(address => uint256)) public userTokenRoyaltyClaimed; // INFO

    event RoyaltyClaimed(address indexed user, address reserveToken, uint256 amount);

    constructor(address protocolBeneficiary_, address msgSender) Ownable(msgSender) {
        updateProtocolBeneficiary(protocolBeneficiary_);
    }

    function updateProtocolBeneficiary(address protocolBeneficiary_) public onlyOwner {
        protocolBeneficiary = protocolBeneficiary_;
    }

    // MARK: - Internal utility functions

    function getRoyalty(uint256 reserveAmount, uint16 royaltyRatio) internal pure returns (uint256) {
        return reserveAmount * royaltyRatio / RATIO_BASE;
    }

    // Add royalty to the beneficiary and the protocol
    function addRoyalty(address beneficiary, address reserveToken, uint256 royaltyAmount) internal {
        uint256 protocolCut = royaltyAmount * PROTOCOL_CUT / RATIO_BASE;
        userTokenRoyaltyBalance[beneficiary][reserveToken] += royaltyAmount - protocolCut;
        userTokenRoyaltyBalance[protocolBeneficiary][reserveToken] += protocolCut;
    }

    // MARK: - External functions

    function claimRoyalties(address reserveToken) external {
        address msgSender = _msgSender();
        uint256 amount = userTokenRoyaltyBalance[msgSender][reserveToken];
        if (amount == 0) revert MCV2_Royalty__NothingToClaim();

        userTokenRoyaltyBalance[msgSender][reserveToken] = 0;
        userTokenRoyaltyClaimed[msgSender][reserveToken] += amount; // INFO

        IERC20(reserveToken).safeTransfer(msgSender, amount);

        emit RoyaltyClaimed(msgSender, reserveToken, amount);
    }

    // @notice: If a creator transfers the ownership to the BURN_ADDRESS, that means the creator
    // wants to give up the royalties and burn their profit share. Instead of keeping them in the bond contract permanently,
    // let anyone call this function to burn the royalties and send them to the BURN_ADDRESS.
    function burnRoyalties(address reserveToken) external {
        uint256 amount = userTokenRoyaltyBalance[BURN_ADDRESS][reserveToken];
        if (amount == 0) revert MCV2_Royalty__NothingToClaim();

        userTokenRoyaltyBalance[BURN_ADDRESS][reserveToken] = 0;
        userTokenRoyaltyClaimed[BURN_ADDRESS][reserveToken] += amount; // INFO

        IERC20(reserveToken).safeTransfer(BURN_ADDRESS, amount);

        emit RoyaltyClaimed(BURN_ADDRESS, reserveToken, amount);
    }

    // MARK: - Utility view functions

    function getRoyaltyInfo(address wallet, address reserveToken) external view returns (uint256, uint256) {
        return (userTokenRoyaltyBalance[wallet][reserveToken], userTokenRoyaltyClaimed[wallet][reserveToken]);
    }
}
