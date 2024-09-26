// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMintClubBond} from "./interfaces/IMintClubBond.sol";

/**
 * @title Mint Club V2 Buy-back & Burner Contract
 * @dev Implements the buy back and burning functionality for the Mint Club V2 premium features and revenue burning
 */

contract MCV2_BuyBackBurner is Ownable {
    error MCV2_BuyBackBurner__PremiumPriceNotSet();
    error MCV2_BuyBackBurner__PremiumAlreadyPurchased();
    error MCV2_BuyBackBurner__SlippageExceeded();
    error MCV2_BuyBackBurner__PremiumPurchaseFailed();
    error MCV2_BuyBackBurner__InvalidAddress();
    error MCV2_BuyBackBurner__InvalidAmount();

    IMintClubBond public constant V1_BOND =
        IMintClubBond(0x8BBac0C7583Cc146244a18863E708bFFbbF19975);
    address public constant MINT =
        address(0x1f3Af095CDa17d63cad238358837321e95FC5915);
    address public constant CREATOR =
        address(0x9f3C60dC06f66b3e0ea1Eb05866F9c1A74d43D67);
    address public constant MINTDAO =
        address(0x558810B46101DE82b579DD1950E9C717dCc28338);
    address public constant GRANT =
        address(0x58764cE77f0140F9678bA6dED9D9697c979F4E0f);
    address public OP_FUND_ADDRESS =
        address(0x5e74f8CC57a3A2d9718Cc98eD7f60D72b0159a14);

    // Key mappings for premium features (e.g. "token-page-customization-{chainId}-{tokenAddress}" => true/false)
    mapping(string => uint256) public premiumPrice;
    mapping(string => bool) public premiumEnabled;

    uint256 public premiumPurchasedCount;
    uint256 public totalGrantPurchased;

    event PurchasePremium(
        string key,
        uint256 mintTokenAmount,
        uint256 creatorAmount,
        address indexed purchaser,
        uint256 timestamp
    );
    event BuyBackGrant(
        uint256 mintTokenAmount,
        uint256 grantAmount,
        uint256 timestamp
    );
    event BuyBackBurnMintDao(
        uint256 mintTokenAmount,
        uint256 mintDaoAmount,
        uint256 timestamp
    );

    constructor() Ownable(msg.sender) {
        // Pre-approve infinite amount of MINT tokens to the V1 BOND contract
        // This is done so that we don't have to approve within the `_buyBack` function
        IERC20 mintToken = IERC20(MINT);
        mintToken.approve(address(V1_BOND), type(uint256).max);
    }

    /**
     * @notice Set the price for a premium feature
     * @param key The key for the premium feature
     * @param price The price of the premium feature
     */
    function setPremiumPrice(
        string calldata key,
        uint256 price
    ) external onlyOwner {
        // setting it to zero will disable new premium purchases
        premiumPrice[key] = price;
    }

    /**
     * @notice Set the OP fund address that receives GRANT tokens
     * @param opFundAddress The address of the OP fund
     */
    function setOpFundAddress(address opFundAddress) external onlyOwner {
        if (opFundAddress == address(0))
            revert MCV2_BuyBackBurner__InvalidAddress();
        OP_FUND_ADDRESS = opFundAddress;
    }

    /**
     * @notice Purchase premium features for a given key
     * @param key The key to purchase premium features for
     * @param purchaser The wallet address of the purchaser
     * @param maxMintTokenToSpend The maximum amount of MINT tokens to spend on the purchase to prevent frontrunning
     */
    function purchasePremium(
        string calldata key,
        address purchaser,
        uint256 maxMintTokenToSpend
    ) external returns (uint256 burned) {
        if (premiumPrice[key] == 0)
            revert MCV2_BuyBackBurner__PremiumPriceNotSet();
        if (premiumEnabled[key])
            revert MCV2_BuyBackBurner__PremiumAlreadyPurchased();

        uint256 creatorPrice = premiumPrice[key];
        uint256 mintTokenRequired = estimateReserveAmountV1(
            CREATOR,
            creatorPrice
        );
        if (mintTokenRequired > maxMintTokenToSpend)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        // Purchase CREATOR tokens and burn them by sending them to the the token contract address
        burned = _buyBack(CREATOR, mintTokenRequired);
        if (burned != creatorPrice)
            revert MCV2_BuyBackBurner__PremiumPurchaseFailed();

        premiumEnabled[key] = true;
        premiumPurchasedCount++;
        IERC20(CREATOR).transfer(CREATOR, burned);

        emit PurchasePremium(
            key,
            mintTokenRequired,
            creatorPrice,
            purchaser,
            block.timestamp
        );
    }

    /**
     * @notice Buy back GRANT tokens and send them to the OP fund address
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     */
    function buyBackGrant(
        uint256 mintTokenAmount,
        uint256 minGrantToBuyBack
    ) external returns (uint256 purchased) {
        if (mintTokenAmount == 0) revert MCV2_BuyBackBurner__InvalidAmount();

        // Buy back GRANT tokens and send them to the OP fund address
        purchased = _buyBack(GRANT, mintTokenAmount);

        if (purchased < minGrantToBuyBack)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        totalGrantPurchased += purchased;
        IERC20(GRANT).transfer(OP_FUND_ADDRESS, purchased);

        emit BuyBackGrant(mintTokenAmount, purchased, block.timestamp);
    }

    /**
     * @notice Buy back MINTDAO tokens and send them to its contract address to be burned
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     */
    function buyBackBurnMintDao(
        uint256 mintTokenAmount,
        uint256 minMintDaoToBurn
    ) external returns (uint256 burned) {
        if (mintTokenAmount == 0) revert MCV2_BuyBackBurner__InvalidAmount();

        // Buy back MINTDAO tokens and send them to its contract address to be burned
        burned = _buyBack(MINTDAO, mintTokenAmount);
        if (burned < minMintDaoToBurn)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        IERC20(MINTDAO).transfer(MINTDAO, burned);

        emit BuyBackBurnMintDao(mintTokenAmount, burned, block.timestamp);
    }

    /**
     * @notice Get required MINT token amount to buy X amount of MintClubV1 tokens
     * @param tokenAddress The address of the token to buy back
     * @param tokensToBuy The amount of tokens to buy
     */
    function estimateReserveAmountV1(
        address tokenAddress,
        uint256 tokensToBuy
    ) public view returns (uint256 reserveRequired) {
        IERC20 token = IERC20(tokenAddress);

        uint256 currentSupply = token.totalSupply();
        uint256 newTokenSupply = currentSupply + tokensToBuy;
        reserveRequired =
            (newTokenSupply ** 2 - currentSupply ** 2) /
            (2 * 1e18);
        reserveRequired = (reserveRequired * 1000) / 997; // Adjust for fees (fixed 0.3%)
    }

    /**
     * @notice Get the amount of tokens that can be bought with a given amount of MINT tokens
     * @param tokenAddress The address of the token to buy
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy
     */
    function estimateTokenAmountV1(
        address tokenAddress,
        uint256 mintTokenAmount
    ) public view returns (uint256 tokenAmount) {
        (tokenAmount, ) = V1_BOND.getMintReward(tokenAddress, mintTokenAmount);
    }

    /**
     * @notice Buy back tokens and send them to the specified address
     * @param tokenAddress The address of the token to buy back
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     */
    function _buyBack(
        address tokenAddress,
        uint256 mintTokenAmount
    ) private returns (uint256 purchasedAmount) {
        // Transfer MINT tokens from the caller to this contract
        IERC20 mintToken = IERC20(MINT);
        mintToken.transferFrom(_msgSender(), address(this), mintTokenAmount);

        IERC20 token = IERC20(tokenAddress);
        // Check balances before and after because BOND.buy() does not return the amount purchased
        uint256 balanceBefore = token.balanceOf(address(this));
        // Interface: function buy(tokenAddress, reserveAmount, minReward, beneficiary)
        V1_BOND.buy(tokenAddress, mintTokenAmount, 0, address(0));
        uint256 balanceAfter = token.balanceOf(address(this));

        purchasedAmount = balanceAfter - balanceBefore;
    }

    /**
     * @notice Get the total amount of CREATOR and MINTDAO tokens burned (including the amount before this contract was deployed)
     * @return totalCreatorBurned The total amount of CREATOR tokens burned
     * @return totalMintDaoBurned The total amount of MINTDAO tokens burned
     */
    function getBurnedStats()
        external
        view
        returns (uint256 totalCreatorBurned, uint256 totalMintDaoBurned)
    {
        totalCreatorBurned = IERC20(CREATOR).balanceOf(CREATOR);
        totalMintDaoBurned = IERC20(MINTDAO).balanceOf(MINTDAO);
    }
}
