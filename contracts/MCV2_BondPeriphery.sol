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

    IMCV2_Bond public immutable BOND;

    constructor(address bond_) {
        BOND = IMCV2_Bond(bond_);
    }

    function mintWithReserveAmount(
        address token,
        uint256 reserveAmount,
        uint256 minTokensToMint,
        address receiver
    ) external returns (uint256) {
        (uint256 tokensToMint, address reserveAddress) = getTokensForReserve(
            token,
            reserveAmount,
            true // Use ceiling division to minimize leftover reserves
        );
        if (tokensToMint < minTokensToMint)
            revert MCV2_BondPeriphery__SlippageLimitExceeded();

        // Verify that the calculated tokens can actually be minted with the reserve amount
        (uint256 actualReserveNeeded, ) = BOND.getReserveForToken(
            token,
            tokensToMint
        );
        if (actualReserveNeeded > reserveAmount) {
            // Adjust tokensToMint to ensure we don't exceed the available reserve
            tokensToMint = tokensToMint > 0 ? tokensToMint - 1 : 0;
            if (tokensToMint < minTokensToMint)
                revert MCV2_BondPeriphery__SlippageLimitExceeded();
        }

        IERC20 reserveToken = IERC20(reserveAddress);
        reserveToken.transferFrom(msg.sender, address(this), reserveAmount);

        reserveToken.approve(address(BOND), reserveAmount);
        BOND.mint(token, tokensToMint, reserveAmount, receiver);

        // Send the leftover reserve tokens to the receiver (potentially few weis left due to roundings)
        uint256 reserveBalance = reserveToken.balanceOf(address(this));
        if (reserveBalance > 0) {
            reserveToken.transfer(receiver, reserveBalance);
        }

        return reserveAmount;
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
        if (!BOND.exists(tokenAddress))
            revert MCV2_BondPeriphery__InvalidParams("token");
        if (reserveAmount == 0)
            revert MCV2_BondPeriphery__InvalidParams("reserveAmount");

        // Cache external calls to avoid repeated storage reads
        (, uint16 mintRoyalty, , , address reserveTokenAddr, ) = BOND.tokenBond(
            tokenAddress
        );
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
