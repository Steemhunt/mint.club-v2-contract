// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMCV2_Bond} from "./interfaces/IMCV2_Bond.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Mint Club V2 Bond Periphery
 */
contract MCV2_BondPeriphery {
    error MCV2_BondPeriphery__InvalidParams(string name);
    error MCV2_BondPeriphery__ExceedMaxSupply();
    error MCV2_BondPeriphery__InvalidCurrentSupply();
    error MCV2_BondPeriphery__InvalidTokenAmount();
    error MCV2_BondPeriphery__SlippageLimitExceeded();
    error MCV2_BondPeriphery__NoLiquidityAvailable();

    IMCV2_Bond public immutable BOND;

    constructor(address bond_) {
        BOND = IMCV2_Bond(bond_);
    }

    function version() external pure returns (uint8) {
        return 2;
    }

    /**
     * @dev Estimate swap results between Mint Club tokens and their reserve tokens.
     * @param sellToken The address of the token to sell.
     * @param sellAmount The amount of tokens to sell.
     * @param buyToken The address of the token to buy.
     * @return buyAmount The amount of tokens that can be bought.
     */
    function estimateSwap(
        address sellToken,
        uint256 sellAmount,
        address buyToken
    ) external view returns (uint256 buyAmount) {
        // Check if sellToken is a Mint Club token and buyToken is the reserve token
        if (BOND.exists(sellToken)) {
            (, , , , address reserveToken, ) = BOND.tokenBond(sellToken);

            // Verify that buyToken matches the reserve token
            if (buyToken != reserveToken) {
                revert MCV2_BondPeriphery__NoLiquidityAvailable();
            }

            // Estimate burning: get refund amount for selling (burning) the Mint Club token
            (uint256 refundAmount, ) = BOND.getRefundForTokens(
                sellToken,
                sellAmount
            );

            return refundAmount;
        }
        // Check if buyToken is a Mint Club token and sellToken is the reserve token
        else if (BOND.exists(buyToken)) {
            (, , , , address reserveToken, ) = BOND.tokenBond(buyToken);

            // Verify that sellToken matches the reserve token
            if (sellToken != reserveToken) {
                revert MCV2_BondPeriphery__NoLiquidityAvailable();
            }

            // Estimate minting: get tokens that can be minted with the reserve amount
            (uint256 tokensToMint, ) = getTokensForReserve(
                buyToken,
                sellAmount,
                false // Use floor division for conservative estimation
            );

            return tokensToMint;
        } else {
            // Neither token is a Mint Club token - liquidity not available
            revert MCV2_BondPeriphery__NoLiquidityAvailable();
        }
    }

    /**
     * @dev Aggregated swap function that handles swaps between Mint Club tokens and their reserve tokens.
     * @param sellToken The address of the token to sell.
     * @param sellAmount The amount of tokens to sell.
     * @param buyToken The address of the token to buy.
     * @param minBuyAmount The minimum amount of tokens to receive.
     * @param receiver The address to receive the bought tokens.
     * @return buyAmount The actual amount of tokens bought.
     */
    function swap(
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 minBuyAmount,
        address receiver
    ) external returns (uint256 buyAmount) {
        // Check if sellToken is a Mint Club token and buyToken is the reserve token
        if (BOND.exists(sellToken)) {
            (, , , , address reserveToken, ) = BOND.tokenBond(sellToken);

            // Verify that buyToken matches the reserve token
            if (buyToken != reserveToken) {
                revert MCV2_BondPeriphery__NoLiquidityAvailable();
            }

            // Transfer the Mint Club token from sender to this contract
            IERC20(sellToken).transferFrom(
                msg.sender,
                address(this),
                sellAmount
            );

            // Approve the Bond contract to burn the tokens
            IERC20(sellToken).approve(address(BOND), sellAmount);

            // Burn the Mint Club token to get reserve tokens
            buyAmount = BOND.burn(
                sellToken,
                sellAmount,
                minBuyAmount,
                receiver
            );

            return buyAmount;
        }
        // Check if buyToken is a Mint Club token and sellToken is the reserve token
        else if (BOND.exists(buyToken)) {
            (, , , , address reserveToken, ) = BOND.tokenBond(buyToken);

            // Verify that sellToken matches the reserve token
            if (sellToken != reserveToken) {
                revert MCV2_BondPeriphery__NoLiquidityAvailable();
            }

            // Use the existing mintWithReserveAmount logic
            // Note: mintWithReserveAmount already handles transferFrom internally
            buyAmount = mintWithReserveAmount(
                buyToken,
                sellAmount,
                minBuyAmount,
                receiver
            );

            return buyAmount;
        } else {
            // Neither token is a Mint Club token - liquidity not available
            revert MCV2_BondPeriphery__NoLiquidityAvailable();
        }
    }

    function mintWithReserveAmount(
        address token,
        uint256 reserveAmount,
        uint256 minTokensToMint,
        address receiver
    ) public returns (uint256 tokensMinted) {
        (uint256 tokensToMint, address reserveAddress) = getTokensForReserve(
            token,
            reserveAmount,
            true // Use ceiling division to minimize leftover reserves
        );
        if (tokensToMint < minTokensToMint)
            revert MCV2_BondPeriphery__SlippageLimitExceeded();

        IERC20 reserveToken = IERC20(reserveAddress);
        reserveToken.transferFrom(msg.sender, address(this), reserveAmount);
        reserveToken.approve(address(BOND), reserveAmount);

        // Try minting with ceiling division result first
        try BOND.mint(token, tokensToMint, reserveAmount, receiver) {
            // Success - send any leftover reserve tokens to receiver
            uint256 reserveBalance = reserveToken.balanceOf(address(this));
            if (reserveBalance > 0) {
                reserveToken.transfer(receiver, reserveBalance);
            }
            return tokensToMint;
        } catch {
            // If minting fails, try reducing by 1 token
            tokensToMint -= 1;
            if (tokensToMint < minTokensToMint) {
                revert MCV2_BondPeriphery__SlippageLimitExceeded();
            }

            // Try minting with reduced amount
            BOND.mint(token, tokensToMint, reserveAmount, receiver);
            uint256 reserveBalance = reserveToken.balanceOf(address(this));
            if (reserveBalance > 0) {
                reserveToken.transfer(receiver, reserveBalance);
            }

            return tokensToMint;
        }
    }

    /**
     * @dev Calculates the number of tokens that can be minted with a given amount of reserve tokens.
     * @notice This wasn't implemented in the original Bond contract, due to *rounding errors*
     *         and it is impossible to calculate the exact number of tokens that can be minted
     *         without using binary search (too expensive, often reverts due to gas limit).
     *         Use this function just for estimating the number of tokens that can be minted.
     * @param tokenAddress The address of the token.
     * @param reserveAmount The amount of reserve tokens to pay.
     * @param useCeilDivision Whether to use ceiling division (true) or floor division (false).
     * @return tokensToMint The number of tokens that can be minted.
     * @return reserveAddress The address of the reserve token.
     */
    function getTokensForReserve(
        address tokenAddress,
        uint256 reserveAmount,
        bool useCeilDivision
    ) public view returns (uint256 tokensToMint, address reserveAddress) {
        if (reserveAmount == 0)
            revert MCV2_BondPeriphery__InvalidParams("reserveAmount");

        // Cache external calls to avoid repeated storage reads
        (, uint16 mintRoyalty, , , address reserveTokenAddr, ) = BOND.tokenBond(
            tokenAddress
        );
        if (reserveTokenAddr == address(0))
            revert MCV2_BondPeriphery__InvalidParams("token");

        reserveAddress = reserveTokenAddr;
        IMCV2_Bond.BondStep[] memory steps = BOND.getSteps(tokenAddress);
        MCV2_ICommonToken t = MCV2_ICommonToken(tokenAddress);

        uint256 currentSupply = t.totalSupply();
        uint256 stepsLength = steps.length;
        uint256 maxTokenSupply = steps[stepsLength - 1].rangeTo;

        if (currentSupply >= maxTokenSupply)
            revert MCV2_BondPeriphery__ExceedMaxSupply();

        uint256 multiFactor = 10 ** t.decimals(); // 1 (ERC1155) or 18 (ERC20)

        // reserveAmount = reserveToBond + royalty
        // reserveAmount = reserveToBond + (reserveToBond * mintRoyalty) / 10000
        // reserveToBond = reserveAmount / (1 + (mintRoyalty) / 10000)
        uint256 reserveLeft = (reserveAmount * 10000) / (10000 + mintRoyalty);

        // Find starting step index
        uint256 i = _getCurrentStep(steps, currentSupply);

        // Unchecked arithmetic for loop increment to save gas
        unchecked {
            for (; i < stepsLength; ++i) {
                // Early termination if no reserve left
                if (reserveLeft == 0) break;

                IMCV2_Bond.BondStep memory step = steps[i];
                if (step.price == 0) continue; // Skip free minting ranges

                uint256 supplyLeft = step.rangeTo - currentSupply;
                if (supplyLeft == 0) continue;

                // Calculate how many tokens can be minted with the available reserve at this step
                uint256 tokensAtStep = useCeilDivision
                    ? Math.ceilDiv(reserveLeft * multiFactor, step.price)
                    : (reserveLeft * multiFactor) / step.price;

                if (tokensAtStep > supplyLeft) {
                    // Can mint all tokens in this step and have reserve left
                    tokensToMint += supplyLeft;

                    // Calculate how much reserve is used for this step (with ceiling division)
                    uint256 reserveRequired = Math.ceilDiv(
                        supplyLeft * step.price,
                        multiFactor
                    );
                    reserveLeft -= reserveRequired;
                    currentSupply += supplyLeft;
                } else {
                    // Can mint only a portion of this step
                    tokensToMint += tokensAtStep;
                    // Don't need to calculate reserveRequired as we're using all available reserve
                    break;
                }

                if (currentSupply >= maxTokenSupply) break;
            }
        }

        if (tokensToMint == 0) revert MCV2_BondPeriphery__InvalidTokenAmount();

        return (tokensToMint, reserveAddress);
    }

    function _getCurrentStep(
        IMCV2_Bond.BondStep[] memory steps,
        uint256 currentSupply
    ) internal pure returns (uint256) {
        uint256 left = 0;
        uint256 right = steps.length;

        unchecked {
            while (left < right) {
                uint256 mid = (left + right) / 2;
                if (steps[mid].rangeTo < currentSupply) {
                    left = mid + 1;
                } else {
                    right = mid;
                }
            }
        }

        if (left >= steps.length)
            revert MCV2_BondPeriphery__InvalidCurrentSupply();
        return left;
    }
}
