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
    error MCV2_BuyBackBurner__SlippageExceeded();
    error MCV2_BuyBackBurner__InvalidAddress();
    error MCV2_BuyBackBurner__InvalidAmount();
    error MCV2_BuyBackBurner__InvalidToken();
    error MCV2_BuyBackBurner__InvalidRange();

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
    address public constant DEAD_ADDRESS =
        address(0x000000000000000000000000000000000000dEaD);

    struct Stats {
        uint104 mintTokenSpent;
        uint80 mintDaoBurned;
        uint80 creatorBurned;
        uint80 grantPurchased;
    }
    Stats public stats;

    struct History {
        uint104 mintTokenAmount;
        uint80 tokenAmount;
        uint40 blockNumber;
        uint40 timestamp;
        address token; // CREATOR, MINTDAO, GRANT
    }
    History[] public history;

    event BuyBackBurnMintDao(
        uint256 mintTokenAmount,
        uint256 mintDaoAmount,
        uint256 timestamp
    );
    event BuyBackBurnCreator(
        uint256 mintTokenAmount,
        uint256 creatorAmount,
        uint256 timestamp
    );
    event BuyBackGrant(
        uint256 mintTokenAmount,
        uint256 grantAmount,
        uint256 timestamp
    );

    constructor() Ownable(msg.sender) {
        // Pre-approve infinite amount of MINT tokens to the V1 BOND contract
        // This is done so that we don't have to approve within the `_buyBack` function
        IERC20 mintToken = IERC20(MINT);
        mintToken.approve(address(V1_BOND), type(uint256).max);

        // TODO: Add previous history before this contract was deployed
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
     * @notice Buy back MINTDAO tokens and send them DEAD_ADDRESS for burning
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     * @param minMintDaoToBurn The minimum amount of MINTDAO tokens to burn (for slippage)
     */
    function buyBackBurnMintDao(
        uint256 mintTokenAmount,
        uint256 minMintDaoToBurn
    ) external returns (uint256 burned) {
        burned = _buyBack(MINTDAO, mintTokenAmount);
        if (burned < minMintDaoToBurn)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        _recordStatsAndHistory(mintTokenAmount, burned, MINTDAO);

        IERC20(MINTDAO).transfer(DEAD_ADDRESS, burned); // burn

        emit BuyBackBurnMintDao(mintTokenAmount, burned, block.timestamp);
    }

    /**
     * @notice Buy back CREATOR tokens and send them DEAD_ADDRESS for burning
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     * @param minCreatorToBurn The minimum amount of CREATOR tokens to burn (for slippage)
     */
    function buyBackBurnCreator(
        uint256 mintTokenAmount,
        uint256 minCreatorToBurn
    ) external returns (uint256 burned) {
        burned = _buyBack(CREATOR, mintTokenAmount);
        if (burned < minCreatorToBurn)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        _recordStatsAndHistory(mintTokenAmount, burned, CREATOR);

        IERC20(CREATOR).transfer(DEAD_ADDRESS, burned); // burn

        emit BuyBackBurnCreator(mintTokenAmount, burned, block.timestamp);
    }

    /**
     * @notice Buy back GRANT tokens and send them to the OP fund address
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     * @param minGrantToBuyBack The minimum amount of GRANT tokens to buy back (for slippage)
     */
    function buyBackGrant(
        uint256 mintTokenAmount,
        uint256 minGrantToBuyBack
    ) external returns (uint256 purchased) {
        purchased = _buyBack(GRANT, mintTokenAmount);
        if (purchased < minGrantToBuyBack)
            revert MCV2_BuyBackBurner__SlippageExceeded();

        _recordStatsAndHistory(mintTokenAmount, purchased, GRANT);

        IERC20(GRANT).transfer(OP_FUND_ADDRESS, purchased); // send to the OP fund

        emit BuyBackGrant(mintTokenAmount, purchased, block.timestamp);
    }

    /**
     * @notice Get required MINT token amount to buy X amount of MintClubV1 tokens
     * @param tokenAddress The address of the token to buy back
     * @param tokensToBuy The amount of tokens to buy
     */
    function estimateReserveAmountV1(
        address tokenAddress,
        uint256 tokensToBuy
    ) external view returns (uint256 reserveRequired) {
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
    ) external view returns (uint256 tokenAmount) {
        (tokenAmount, ) = V1_BOND.getMintReward(tokenAddress, mintTokenAmount);
    }

    // MARK: - Internal functions

    /**
     * @notice Buy back tokens and send them to the specified address
     * @param tokenAddress The address of the token to buy back
     * @param mintTokenAmount The amount of MINT tokens to spend on the buy back
     */
    function _buyBack(
        address tokenAddress,
        uint256 mintTokenAmount
    ) private returns (uint256 purchasedAmount) {
        if (mintTokenAmount == 0) revert MCV2_BuyBackBurner__InvalidAmount();

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
        assert(purchasedAmount > 0);
    }

    /**
     * @notice Record the stats and history of the buy back (and burn)
     * @param mintTokenAmount The amount of MINT tokens spent on the buy back
     * @param tokenAmount The amount of tokens purchased
     * @param token The token that was bought
     */
    function _recordStatsAndHistory(
        uint256 mintTokenAmount,
        uint256 tokenAmount,
        address token
    ) private {
        stats.mintTokenSpent += uint104(mintTokenAmount);

        if (token == GRANT) {
            stats.grantPurchased += uint80(tokenAmount);
        } else if (token == MINTDAO) {
            stats.mintDaoBurned += uint80(tokenAmount);
        } else if (token == CREATOR) {
            stats.creatorBurned += uint80(tokenAmount);
        } else {
            revert MCV2_BuyBackBurner__InvalidToken();
        }

        history.push(
            History({
                mintTokenAmount: uint104(mintTokenAmount),
                tokenAmount: uint80(tokenAmount),
                blockNumber: uint40(block.number),
                timestamp: uint40(block.timestamp),
                token: token
            })
        );
    }

    // MARK: - Utility functions

    /**
     * @notice Get the balances of the tokens that have been burned (including the ones in the contract address and DEAD_ADDRESS)
     * @return creatorBurnedBalance The balance of the CREATOR tokens that have been burned
     * @return mintDaoBurnedBalance The balance of the MINTDAO tokens that have been burned
     */
    function getBurnedBalances()
        external
        view
        returns (uint256 creatorBurnedBalance, uint256 mintDaoBurnedBalance)
    {
        creatorBurnedBalance =
            IERC20(CREATOR).balanceOf(CREATOR) +
            IERC20(CREATOR).balanceOf(DEAD_ADDRESS);
        mintDaoBurnedBalance =
            IERC20(MINTDAO).balanceOf(MINTDAO) +
            IERC20(MINTDAO).balanceOf(DEAD_ADDRESS);
    }

    /**
     * @notice Get the number of history entries
     * @return The number of history entries
     */
    function getHistoryCount() external view returns (uint256) {
        return history.length;
    }

    /**
     * @notice Get a slice of the history array
     * @param start The start index of the slice
     * @param stopBefore The end index of the slice (exclusive)
     * @return The slice of the history
     */
    function getHistory(
        uint256 start,
        uint256 stopBefore
    ) external view returns (History[] memory) {
        if (start >= stopBefore) revert MCV2_BuyBackBurner__InvalidRange();

        if (stopBefore >= history.length) {
            stopBefore = history.length;
        }

        unchecked {
            uint256 arrayLength = stopBefore - start;
            History[] memory historySlice = new History[](arrayLength);

            uint256 j;
            for (uint256 i = start; i < stopBefore; ++i) {
                historySlice[j++] = history[i];
            }
            return historySlice;
        }
    }
}
