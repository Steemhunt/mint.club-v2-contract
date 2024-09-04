// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMintClubBond} from "./interfaces/IMintClubBond.sol";

/**
 * @title Mint Club V2 BuyBack Contract
 * @dev Implements the buy back functionality for the Mint Club V2 premium features and revenue burning
 */

contract MCV2_BuyBack is Ownable {
    error MCV2_BuyBack__PremiumPriceNotSet();

    IMintClubBond public constant V1_BOND =
        IMintClubBond(0x8BBac0C7583Cc146244a18863E708bFFbbF19975);
    IERC20 public MINT = IERC20(0x1f3Af095CDa17d63cad238358837321e95FC5915);
    IERC20 public CREATOR = IERC20(0x9f3C60dC06f66b3e0ea1Eb05866F9c1A74d43D67);
    IERC20 public GRANT = IERC20(0x58764cE77f0140F9678bA6dED9D9697c979F4E0f);
    IERC20 public MINTDAO = IERC20(0x558810B46101DE82b579DD1950E9C717dCc28338);

    // Key mappings for premium features (e.g. "token-page-customization-{tokenAddress}" => true/false)
    mapping(string => uint256) public premiumPrice;
    mapping(string => bool) public premiumEnabled;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setPremiumPrice(
        string calldata key,
        uint256 price
    ) external onlyOwner {
        premiumPrice[key] = price;
    }

    function purchasePremium(string calldata key) external {
        if (premiumPrice[key] == 0) revert MCV2_BuyBack__PremiumPriceNotSet();

        // Purchase CREATOR (V1) tokens and burn them
        // buy ( address tokenAddress, uint256 reserveAmount, uint256 minReward, address beneficiary ) external;
        // uint256 CREATOR_amount = V1_BOND.buy(CREATOR, premiumPrice[key], 0, address(0));
    }
}
