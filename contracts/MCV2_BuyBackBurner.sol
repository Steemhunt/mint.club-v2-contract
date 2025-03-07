// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {IMCV2_Bond} from "./interfaces/IMCV2_Bond.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console} from "hardhat/console.sol";

/**
 * @title Mint Club V2 Buy-back & Burner Contract
 * @dev Implements the buy back and burning functionality for the Mint Club V2 premium features and revenue burning
 */

contract MCV2_BuyBackBurner {
    error MCV2_BuyBackBurner__SlippageExceeded();
    error MCV2_BuyBackBurner__InvalidAddress();
    error MCV2_BuyBackBurner__InvalidParams();
    error MCV2_BuyBackBurner__InvalidToken();
    error MCV2_BuyBackBurner__InvalidRange();
    error MCV2_BuyBackBurner__InvalidOperation();
    error MCV2_BuyBackBurner__ZeroAmount();
    error MCV2_BuyBackBurner__InvalidSwap();

    IMCV2_Bond public constant BOND =
        IMCV2_Bond(0xc5a076cad94176c2996B32d8466Be1cE757FAa27);

    IERC20 public constant HUNT =
        IERC20(0x37f0c2915CeCC7e977183B8543Fc0864d03E064C);
    IERC20 public constant MT =
        IERC20(0xFf45161474C39cB00699070Dd49582e417b57a7E);
    address public constant DEAD_ADDRESS =
        address(0x000000000000000000000000000000000000dEaD);

    struct Stats {
        uint128 totalHuntSpent;
        uint128 totalMtBurned;
    }
    Stats public stats;

    struct History {
        uint96 huntSpent;
        uint96 mtBurned;
        uint64 fromChainId;
        uint48 blockNumber;
        uint48 timestamp;
    }
    History[] public history;

    event BuyBackBurn(uint96 huntSpent, uint96 mtBurned, uint64 fromChainId);

    constructor() {
        // Pre-approve infinite HUNT to V2 BOND contract for MT minting
        HUNT.approve(address(BOND), type(uint256).max);
    }

    /**
     * @notice Buy back MT with HUNT and burn MT
     * @param mtAmount The amount of MT to buy back
     * @param fromChainId The chain ID of the origin chain that funds came from
     * @return The amount of HUNT spent
     */
    function buyBackBurn(
        uint96 mtAmount,
        uint64 fromChainId
    ) external returns (uint96) {
        if (mtAmount == 0) revert MCV2_BuyBackBurner__InvalidParams();

        // Estimate MT burn amount using the reverse calculation helper
        (uint256 huntRequired, ) = BOND.getReserveForToken(
            address(MT),
            mtAmount
        );
        if (huntRequired == 0) revert MCV2_BuyBackBurner__ZeroAmount();

        HUNT.transferFrom(msg.sender, address(this), huntRequired);

        console.log("HUNT balance before mint", HUNT.balanceOf(address(this)));

        // Mint MT and send it to the dead address straight away
        uint96 huntSpent = uint96(
            BOND.mint(address(MT), mtAmount, huntRequired, DEAD_ADDRESS)
        );

        console.log("HUNT balance after mint", HUNT.balanceOf(address(this)));

        if (huntSpent != huntRequired || HUNT.balanceOf(address(this)) != 0) {
            revert MCV2_BuyBackBurner__InvalidSwap();
        }

        stats.totalHuntSpent += huntSpent;
        stats.totalMtBurned += mtAmount;

        history.push(
            History({
                huntSpent: huntSpent,
                mtBurned: mtAmount,
                fromChainId: fromChainId,
                blockNumber: uint40(block.number),
                timestamp: uint40(block.timestamp)
            })
        );

        emit BuyBackBurn(huntSpent, mtAmount, fromChainId);

        return huntSpent;
    }

    // MARK: - Utility functions

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

    // MARK: - Prevent accidental ETH transfers to this contract

    // Sends value with no calldata
    receive() external payable {
        revert MCV2_BuyBackBurner__InvalidOperation();
    }

    // For function calls that don't exist or ETH with data
    fallback() external payable {
        revert MCV2_BuyBackBurner__InvalidOperation();
    }
}
