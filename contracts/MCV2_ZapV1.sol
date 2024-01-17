// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MCV2_Bond} from "./MCV2_Bond.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";

interface IAggregationRouterV5 {
    struct SwapDescription {
        IERC20 srcToken;
        IERC20 dstToken;
        address srcReceiver;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
    }
    function swap(
        address caller,
        SwapDescription calldata desc,
        bytes calldata data
    ) external returns (uint256 returnAmount, uint256 gasLeft);
}



/**
* @title Mint Club V2 Zap V1 Contract
* @dev This contract implements the Zap functionality for the Mint Club V2 Bond contract.
*/

contract MCV2_ZapV1 is Ownable {
    using SafeERC20 for IERC20;

    error MCV2_ZapV1__ReserveIsNotWETH();
    error MCV2_ZapV1__EthTransferFailed();
    error MCV2_ZapV1__FailedToApprove();
    error MCV2_ZapV1__SlippageLimitExceeded();
    error MCV2_ZapV1__InvalidReceiver();

    MCV2_Bond public immutable BOND;
    IWETH public immutable WETH;

    uint256 private constant MAX_INT = type(uint256).max;

    event RescuedETH(address receiver, uint256 amount);

    constructor(address bondAddress, address wethAddress) Ownable(msg.sender) {
        BOND = MCV2_Bond(bondAddress);
        WETH = IWETH(wethAddress);

        // Approve WETH to Bond contract
        if(!WETH.approve(bondAddress, MAX_INT)) revert MCV2_ZapV1__FailedToApprove();
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
     * @dev Internal function to get the reserve amount for a given token.
     * @param token The token address.
     */
    function _isERC20(address token) private pure returns (bool) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);

        // All MCV2_Token has 18 decimals, whereas MCV2_MultiToken has 0 decimals
        return t.decimals() == 18;
    }

    /**
     * @dev Swap sourceToken to destToken using 1inch aggregation router
     * @param sourceToken The source token address.
     * @param sourceTokenAmount The amount of source tokens to swap.
     * @param destToken The destination token address.
     * @param minDestTokenAmount The minimum amount of destination tokens to receive.
     * @param data Data specific to the swap, refer to 1inch API for details
     * REF: API call example - https://portal.1inch.dev/documentation/swap/swagger?method=get&path=%2Fv5.2%2F1%2Fswap
     */
    function swapWith1inch(
        address sourceToken,
        uint256 sourceTokenAmount,
        address destToken,
        uint256 minDestTokenAmount,
        bytes calldata data
    ) public returns (uint256 destTokenAmount) {
        IAggregationRouterV5 aggregationRouter = IAggregationRouterV5(0x1111111254EEB25477B68fb85Ed929f73A960582);

        // Transfer source tokens to this contract
        require(IERC20(sourceToken).transferFrom(msg.sender, address(this), sourceTokenAmount), "Transfer failed");

        // Approve the router to spend tokens
        IERC20(sourceToken).approve(address(aggregationRouter), sourceTokenAmount);

        // Set up the swap parameters
        IAggregationRouterV5.SwapDescription memory callDescription;
        callDescription.srcToken = IERC20(sourceToken);
        callDescription.dstToken = IERC20(destToken);
        callDescription.srcReceiver = address(this);
        callDescription.dstReceiver = msg.sender;
        callDescription.amount = sourceTokenAmount;
        callDescription.minReturnAmount = minDestTokenAmount;
        callDescription.flags = 0;

        // Perform the swap
        (uint256 returnAmount, ) = aggregationRouter.swap(
            address(this),
            callDescription,
            data
        );

        require(returnAmount >= minDestTokenAmount, "Insufficient output amount");
        return returnAmount;
    }

    /**
     * @dev Mint tokens by sending ETH.
     * @param token The token address.
     * @param tokensToMint The amount of tokens to mint.
     * @param receiver The address to receive the minted tokens.
     */
    function mintWithEth(address token, uint256 tokensToMint, address receiver) external payable {
        if (_getReserveToken(token) != address(WETH)) revert MCV2_ZapV1__ReserveIsNotWETH();
        if (receiver == address(0)) revert MCV2_ZapV1__InvalidReceiver();

        // Check slippage limit
        uint256 maxEthAmount = msg.value;
        (uint256 ethAmount, ) = BOND.getReserveForToken(token, tokensToMint);
        if (ethAmount > maxEthAmount) revert MCV2_ZapV1__SlippageLimitExceeded();

        // Wrap ETH to WETH
        WETH.deposit{value: ethAmount}();

        // Mint and transfer tokens to the receiver
        BOND.mint(token, tokensToMint, ethAmount, receiver);

        // Refund leftover ETH to the sender
        uint256 leftover = maxEthAmount - ethAmount;
        if (leftover > 0) {
            (bool sent, ) = _msgSender().call{value: leftover}("");
            if (!sent) revert MCV2_ZapV1__EthTransferFailed();
        }
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
        if (receiver == address(0)) revert MCV2_ZapV1__InvalidReceiver();

        // Burn and get refund WETH
        (uint256 refundAmount, ) = BOND.getRefundForTokens(token, tokensToBurn);
        if (refundAmount < minRefund) revert MCV2_ZapV1__SlippageLimitExceeded();

        if (_isERC20(token)) {
            // Receive tokens to burn
            IERC20 t = IERC20(token);
            t.safeTransferFrom(_msgSender(), address(this), tokensToBurn);

            // Approve tokens to Bond contract for the first time
            if (t.allowance(address(this), address(BOND)) < tokensToBurn) {
                if (!t.approve(address(BOND), MAX_INT)) revert MCV2_ZapV1__FailedToApprove();
            }
        } else {
            // Receive tokens to burn
            IERC1155(token).safeTransferFrom(_msgSender(), address(this), 0, tokensToBurn, "");

            // Approve tokens to Bond contract for the first time
            if (!IERC1155(token).isApprovedForAll(address(this), address(BOND))) {
                IERC1155(token).setApprovalForAll(address(BOND), true);
            }
        }

        // Burn tokens
        BOND.burn(token, tokensToBurn, refundAmount, address(this));

        if (refundAmount > 0) {
            // Unwrap WETH to ETH
            IWETH(WETH).withdraw(refundAmount);

            // Transfer ETH to the receiver
            (bool sent, ) = receiver.call{value: refundAmount}("");
            if (!sent) revert MCV2_ZapV1__EthTransferFailed();
        }
    }

    // MARK: - Admin functions

    /**
     * @dev Rescue ETH from the contract because this contract can receive ETH from anyone.
     * @param receiver The address to receive the ETH.
     */
    function rescueETH(address receiver) external onlyOwner {
        if (receiver == address(0)) revert MCV2_ZapV1__InvalidReceiver();

        uint256 balance = address(this).balance;
        (bool sent, ) = receiver.call{value: balance}("");
        if (!sent) revert MCV2_ZapV1__EthTransferFailed();

        emit RescuedETH(receiver, balance);
    }

    // MARK: - ERC1155 Receiver

    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
