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
        uint256 tokensToMint = getTokensForReserve(token, reserveAmount);
        if (tokensToMint < minTokensToMint)
            revert MCV2_BondPeriphery__SlippageLimitExceeded();

        (, , , , address reserveAddress, ) = BOND.tokenBond(token);
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
     * @return tokensToMint The number of tokens that can be minted.
     */
    function getTokensForReserve(
        address tokenAddress,
        uint256 reserveAmount
    ) public view returns (uint256 tokensToMint) {
        if (!BOND.exists(tokenAddress))
            revert MCV2_BondPeriphery__InvalidParams("token");
        if (reserveAmount == 0)
            revert MCV2_BondPeriphery__InvalidParams("reserveAmount");

        (, uint16 mintRoyalty, , , , ) = BOND.tokenBond(tokenAddress);
        IMCV2_Bond.BondStep[] memory steps = BOND.getSteps(tokenAddress);

        MCV2_ICommonToken t = MCV2_ICommonToken(tokenAddress);
        uint256 currentSupply = t.totalSupply();
        uint256 maxTokenSupply = steps[steps.length - 1].rangeTo;

        if (currentSupply >= maxTokenSupply)
            revert MCV2_BondPeriphery__ExceedMaxSupply();

        uint256 multiFactor = 10 ** t.decimals(); // 1 (ERC1155) or 18 (ERC20)

        // reserveAmount = reserveToBond + royalty
        // reserveAmount = reserveToBond + (reserveToBond * mintRoyalty) / 10000
        // reserveToBond = reserveAmount / (1 + (mintRoyalty) / 10000)
        uint256 reserveLeft = (reserveAmount * 10000) / (10000 + mintRoyalty);

        // Cache steps.length to avoid multiple storage reads
        uint256 stepsLength = steps.length;

        for (
            uint256 i = _getCurrentStep(steps, currentSupply);
            i < stepsLength;
            ++i
        ) {
            IMCV2_Bond.BondStep memory step = steps[i];
            if (step.price == 0) continue; // Skip free minting ranges

            uint256 supplyLeft = step.rangeTo - currentSupply;
            if (supplyLeft == 0) continue;

            // Calculate how many tokens can be minted with the available reserve at this step
            // Using floor division since we can't mint partial tokens
            uint256 tokensAtStep = (reserveLeft * multiFactor) / step.price;

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

            if (currentSupply >= maxTokenSupply || reserveLeft == 0) break;
        }

        if (tokensToMint == 0) revert MCV2_BondPeriphery__InvalidTokenAmount();

        return tokensToMint;
    }

    function _getCurrentStep(
        IMCV2_Bond.BondStep[] memory steps,
        uint256 currentSupply
    ) internal pure returns (uint256) {
        unchecked {
            for (uint256 i = 0; i < steps.length; ++i) {
                if (currentSupply <= steps[i].rangeTo) {
                    return i;
                }
            }
        }
        revert MCV2_BondPeriphery__InvalidCurrentSupply();
    }
}
