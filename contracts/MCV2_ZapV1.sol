// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {MCV2_Bond} from "./MCV2_Bond.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/**
* @title Mint Club V2 Zap V1 Contract
* @dev This contract implements the Zap functionality for the Mint Club V2 Bond contract.
*/

contract MCV2_ZapV1 is Context {
    using SafeERC20 for IERC20;

    error MCV2_ZapV1__ReserveIsNotWETH();
    error MCV2_ZapV1__EthTransferFailed();
    error MCV2_ZapV1__SlippageLimitExceeded();

    MCV2_Bond public immutable BOND;
    IWETH public immutable WETH;

    uint256 private constant MAX_INT = type(uint256).max;

    constructor(address bondAddress, address wethAddress) {
        BOND = MCV2_Bond(bondAddress);
        WETH = IWETH(wethAddress);

        // Approve WETH to Bond contract
        WETH.approve(bondAddress, MAX_INT);
    }

    receive() external payable {}

    /**
     * @dev Internal function to get the reserve token for a given token.
     * @param token The token address.
     * @return reserveToken The reserve token address.
     */
    function _getReserveToken(address token) private view returns (address reserveToken) {
        (,,,,reserveToken,) = BOND.tokenBond(token);
    }

    /**
     * @dev Mint tokens by sending ETH.
     * @param token The token address.
     * @param tokensToMint The amount of tokens to mint.
     * @param receiver The address to receive the minted tokens.
     */
    function mintWithEth(address token, uint256 tokensToMint, address receiver) external payable {
        if (_getReserveToken(token) != address(WETH)) revert MCV2_ZapV1__ReserveIsNotWETH();

        // Check slippage limit
        uint256 maxEthAmount = msg.value;
        (uint256 ethAmount, ) = BOND.getReserveForToken(token, tokensToMint);
        if (ethAmount > maxEthAmount) revert MCV2_ZapV1__SlippageLimitExceeded();

        // Wrap ETH to WETH
        WETH.deposit{value: ethAmount}();

        // Mint and transfer tokens to the receiver
        BOND.mint(token, tokensToMint, ethAmount, receiver);

        // Refund leftover ETH to the sender
        (bool sent, ) = _msgSender().call{value: maxEthAmount - ethAmount}("");
        if (!sent) revert MCV2_ZapV1__EthTransferFailed();
    }

    /**
     * @dev Burn tokens and receive ETH as refund.
     * @param token The token address.
     * @param tokensToBurn The amount of tokens to burn.
     * @param minRefund The minimum amount of ETH to receive as refund.
     * @param receiver The address to receive the ETH refund.
     */
    function burnToEth(address token, uint256 tokensToBurn, uint256 minRefund, address receiver) external {
        if (_getReserveToken(token) != address(WETH)) revert MCV2_ZapV1__ReserveIsNotWETH();

        // Burn and get refund WETH
        (uint256 refundAmount, ) = BOND.getRefundForTokens(token, tokensToBurn);
        if (refundAmount < minRefund) revert MCV2_ZapV1__SlippageLimitExceeded();

        // Receive tokens to burn
        IERC20 t = IERC20(token);
        t.safeTransferFrom(_msgSender(), address(this), tokensToBurn);

        // Approve tokens to Bond contract for the first time
        if (t.allowance(address(this), address(BOND)) < tokensToBurn) {
            t.approve(address(BOND), MAX_INT);
        }

        // Burn tokens
        BOND.burn(token, tokensToBurn, refundAmount, address(this));

        // Unwrap WETH to ETH
        IWETH(WETH).withdraw(refundAmount);

        // Transfer ETH to the receiver
        (bool sent, ) = receiver.call{value: refundAmount}("");
        if (!sent) revert MCV2_ZapV1__EthTransferFailed();
    }
}
