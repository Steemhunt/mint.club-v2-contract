// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MCV2_Bond} from "./MCV2_Bond.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";
import {IUniversalRouter} from "./interfaces/IUniversalRouter.sol";

/**
 * @title Mint Club V2 Zap V2 Contract
 * @dev Zap functionality with Uniswap V4 UniversalRouter integration for MCV2 Bond.
 *      Supports swapping ANY token to reserve token (and vice versa) in a single transaction.
 *
 * NOTE: Fee-on-transfer tokens may cause amount mismatches. This contract does not support them.
 * Callers must construct valid UniversalRouter commands and inputs off-chain.
 */
contract MCV2_ZapV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Errors
    error MCV2_ZapV2__InvalidAddress();
    error MCV2_ZapV2__InvalidToken();
    error MCV2_ZapV2__InvalidAmount();
    error MCV2_ZapV2__InvalidReceiver();
    error MCV2_ZapV2__SlippageLimitExceeded();
    error MCV2_ZapV2__EthTransferFailed();
    error MCV2_ZapV2__InvalidSwapPath();
    error MCV2_ZapV2__MsgValueMismatch();
    error MCV2_ZapV2__NothingToRescue();

    // Immutables — stored in bytecode, zero SLOAD cost
    MCV2_Bond public immutable BOND;
    IWETH public immutable WETH;
    IUniversalRouter public immutable UNIVERSAL_ROUTER;

    // Events
    event ZapMint(
        address indexed token,
        address indexed inputToken,
        address indexed receiver,
        uint256 inputAmount,
        uint256 tokensReceived,
        uint256 reserveUsed
    );

    event ZapBurn(
        address indexed token,
        address indexed outputToken,
        address indexed receiver,
        uint256 tokensBurned,
        uint256 outputAmount,
        uint256 reserveReceived
    );

    event EmergencyTokenRescue(address indexed token, address indexed recipient, uint256 amount);

    constructor(
        address bondAddress,
        address wethAddress,
        address universalRouterAddress
    ) Ownable(msg.sender) {
        if (bondAddress == address(0)) revert MCV2_ZapV2__InvalidAddress();
        if (wethAddress == address(0)) revert MCV2_ZapV2__InvalidAddress();
        if (universalRouterAddress == address(0)) revert MCV2_ZapV2__InvalidAddress();

        BOND = MCV2_Bond(bondAddress);
        WETH = IWETH(wethAddress);
        UNIVERSAL_ROUTER = IUniversalRouter(universalRouterAddress);
    }

    /// @dev Accept ETH from WETH unwrap and from UniversalRouter refunds
    receive() external payable {}

    // ─── Internal Helpers ────────────────────────────────────────────

    /// @dev Get the reserve token for a given MC token
    function _getReserveToken(address token) private view returns (address reserveToken) {
        (,,,,reserveToken,) = BOND.tokenBond(token);
    }

    /// @dev Check if an MC token is ERC-20 (vs ERC-1155). All MC ERC-20s have 18 decimals.
    function _isMCTokenERC20(address token) private view returns (bool) {
        return MCV2_ICommonToken(token).decimals() == 18;
    }

    /// @dev Execute swap via UniversalRouter with balance-check slippage protection
    function _executeSwap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) private returns (uint256 outputAmount) {
        if (commands.length == 0) revert MCV2_ZapV2__InvalidSwapPath();

        bool isEthOutput = (outputToken == address(0));

        // Measure balance before — single SLOAD/BALANCE
        uint256 balanceBefore;
        unchecked {
            balanceBefore = isEthOutput
                ? address(this).balance
                : IERC20(outputToken).balanceOf(address(this));
        }

        if (inputToken == address(0)) {
            // ETH input — forward value to router
            UNIVERSAL_ROUTER.execute{value: inputAmount}(commands, inputs, deadline);
        } else {
            // ERC-20 input — transfer tokens to router, then execute
            // The UniversalRouter pulls tokens via Permit2, but since we are a contract
            // (cannot sign Permit2 messages), we transfer tokens directly to the router
            // and use payerIsUser=false in swap commands so the router uses its own balance.
            IERC20(inputToken).safeTransfer(address(UNIVERSAL_ROUTER), inputAmount);
            UNIVERSAL_ROUTER.execute(commands, inputs, deadline);
        }

        // Measure balance after
        unchecked {
            outputAmount = isEthOutput
                ? address(this).balance - balanceBefore
                : IERC20(outputToken).balanceOf(address(this)) - balanceBefore;
        }

        if (outputAmount < minOutputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
    }

    /// @dev Calculate maximum mintable tokens within a reserve budget via binary search.
    ///      Uses unchecked arithmetic where overflow is impossible (bounded by maxSupply).
    function _calculateMaxMintable(address token, uint256 reserveAmount)
        private view returns (uint256 maxTokens, uint256 actualReserveNeeded)
    {
        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        uint256 maxSupply = BOND.maxSupply(token);

        if (currentSupply >= maxSupply) return (0, 0);

        uint256 left;
        uint256 right;
        unchecked {
            right = maxSupply - currentSupply;
        }

        while (left < right) {
            uint256 mid;
            unchecked {
                mid = left + (right - left + 1) / 2;
            }
            try BOND.getReserveForToken(token, mid) returns (uint256 required, uint256) {
                if (required <= reserveAmount) {
                    left = mid;
                } else {
                    unchecked { right = mid - 1; }
                }
            } catch {
                unchecked { right = mid - 1; }
            }
        }

        maxTokens = left;
        if (maxTokens == 0) return (0, 0);
        (actualReserveNeeded, ) = BOND.getReserveForToken(token, maxTokens);
    }

    // ─── zapMint ─────────────────────────────────────────────────────

    /**
     * @notice Mint MC tokens by optionally swapping inputToken → reserveToken first.
     * @param token         MC token to mint
     * @param inputToken    Token to pay with (address(0) for ETH)
     * @param inputAmount   Amount of input token
     * @param minTokensOut  Minimum MC tokens to receive (slippage on bonding curve)
     * @param commands      UniversalRouter commands (empty if no swap needed)
     * @param inputs        UniversalRouter inputs   (empty if no swap needed)
     * @param deadline      Swap deadline (ignored when no swap)
     * @param receiver      Who gets the MC tokens
     */
    function zapMint(
        address token,
        address inputToken,
        uint256 inputAmount,
        uint256 minTokensOut,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline,
        address receiver
    ) external payable nonReentrant returns (uint256 tokensReceived, uint256 reserveUsed) {
        if (token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (inputAmount == 0) revert MCV2_ZapV2__InvalidAmount();

        // ETH/msg.value validation
        if (inputToken == address(0)) {
            if (msg.value != inputAmount) revert MCV2_ZapV2__MsgValueMismatch();
        } else {
            if (msg.value != 0) revert MCV2_ZapV2__MsgValueMismatch();
        }

        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        // Step 1: Obtain reserve tokens
        uint256 reserveObtained = _obtainReserveForMint(
            inputToken, reserveToken, inputAmount, commands, inputs, deadline
        );

        // Step 2: Calculate max mintable and mint
        (tokensReceived, reserveUsed) = _calculateMaxMintable(token, reserveObtained);
        if (tokensReceived < minTokensOut) revert MCV2_ZapV2__SlippageLimitExceeded();

        // Exact approval → mint → zero-out (CEI: approve is state, mint is external)
        IERC20(reserveToken).forceApprove(address(BOND), reserveUsed);
        BOND.mint(token, tokensReceived, reserveUsed, receiver);
        IERC20(reserveToken).forceApprove(address(BOND), 0);

        // Step 3: Refund leftover reserve
        unchecked {
            uint256 leftover = reserveObtained - reserveUsed;
            if (leftover > 0) {
                if (reserveToken == address(WETH) && inputToken == address(0)) {
                    WETH.withdraw(leftover);
                    (bool sent, ) = msg.sender.call{value: leftover}("");
                    if (!sent) revert MCV2_ZapV2__EthTransferFailed();
                } else {
                    IERC20(reserveToken).safeTransfer(msg.sender, leftover);
                }
            }
        }

        emit ZapMint(token, inputToken, receiver, inputAmount, tokensReceived, reserveUsed);
    }

    /// @dev Obtain reserve tokens from the user's input (swap if necessary)
    function _obtainReserveForMint(
        address inputToken,
        address reserveToken,
        uint256 inputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) private returns (uint256) {
        if (inputToken == address(0)) {
            if (reserveToken == address(WETH)) {
                // Wrap ETH → WETH directly — cheapest path, no router needed
                WETH.deposit{value: inputAmount}();
                return inputAmount;
            }
            // Swap ETH → reserveToken via router
            return _executeSwap(address(0), reserveToken, inputAmount, 1, commands, inputs, deadline);
        }

        // ERC-20 input
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        if (inputToken == reserveToken) return inputAmount;

        return _executeSwap(inputToken, reserveToken, inputAmount, 1, commands, inputs, deadline);
    }

    // ─── zapBurn ─────────────────────────────────────────────────────

    /**
     * @notice Burn MC tokens and optionally swap reserveToken → outputToken.
     * @param token            MC token to burn
     * @param tokensToBurn     Amount to burn
     * @param outputToken      Desired output (address(0) for ETH)
     * @param minOutputAmount  Minimum output after swap (slippage protection)
     * @param commands         UniversalRouter commands (empty if no swap needed)
     * @param inputs           UniversalRouter inputs   (empty if no swap needed)
     * @param deadline         Swap deadline (ignored when no swap)
     * @param receiver         Who gets the output
     */
    function zapBurn(
        address token,
        uint256 tokensToBurn,
        address outputToken,
        uint256 minOutputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline,
        address receiver
    ) external nonReentrant returns (uint256 outputAmount, uint256 reserveReceived) {
        if (token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (tokensToBurn == 0) revert MCV2_ZapV2__InvalidAmount();

        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        // Step 1: Get expected refund, transfer MC tokens, burn
        (uint256 refundAmount, ) = BOND.getRefundForTokens(token, tokensToBurn);

        if (_isMCTokenERC20(token)) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), tokensToBurn);
            IERC20(token).forceApprove(address(BOND), tokensToBurn);
        } else {
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, tokensToBurn, "");
            if (!IERC1155(token).isApprovedForAll(address(this), address(BOND))) {
                IERC1155(token).setApprovalForAll(address(BOND), true);
            }
        }

        BOND.burn(token, tokensToBurn, refundAmount, address(this));
        reserveReceived = refundAmount;

        // Step 2: Convert reserve → desired output
        outputAmount = _deliverOutput(
            reserveToken, outputToken, reserveReceived, minOutputAmount, commands, inputs, deadline, receiver
        );

        emit ZapBurn(token, outputToken, receiver, tokensToBurn, outputAmount, reserveReceived);
    }

    /// @dev Convert reserve tokens to desired output and send to receiver
    function _deliverOutput(
        address reserveToken,
        address outputToken,
        uint256 reserveAmount,
        uint256 minOutputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline,
        address receiver
    ) private returns (uint256) {
        if (outputToken == reserveToken) {
            if (reserveAmount < minOutputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
            IERC20(reserveToken).safeTransfer(receiver, reserveAmount);
            return reserveAmount;
        }

        if (outputToken == address(0) && reserveToken == address(WETH)) {
            // Unwrap WETH → ETH directly — no router needed
            if (reserveAmount < minOutputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
            WETH.withdraw(reserveAmount);
            (bool sent, ) = receiver.call{value: reserveAmount}("");
            if (!sent) revert MCV2_ZapV2__EthTransferFailed();
            return reserveAmount;
        }

        // Swap reserve → output via router
        uint256 outputAmount = _executeSwap(
            reserveToken, outputToken, reserveAmount, minOutputAmount, commands, inputs, deadline
        );

        if (outputToken == address(0)) {
            (bool sent, ) = receiver.call{value: outputAmount}("");
            if (!sent) revert MCV2_ZapV2__EthTransferFailed();
        } else {
            IERC20(outputToken).safeTransfer(receiver, outputAmount);
        }
        return outputAmount;
    }

    // ─── View Functions ──────────────────────────────────────────────

    /// @dev Estimate output for zapMint (off-chain helper, assumes 1:1 swap for estimation)
    function estimateZapMint(address token, uint256 inputAmount)
        external view returns (uint256 estimatedTokensOut, uint256 estimatedReserveNeeded)
    {
        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) return (0, 0);
        return _calculateMaxMintable(token, inputAmount);
    }

    /// @dev Estimate output for zapBurn (off-chain helper)
    function estimateZapBurn(address token, uint256 tokensToBurn)
        external view returns (uint256 estimatedReserveOut)
    {
        (estimatedReserveOut, ) = BOND.getRefundForTokens(token, tokensToBurn);
    }

    // ─── Admin Functions ─────────────────────────────────────────────

    /// @dev Emergency rescue stuck ETH
    function rescueETH(address recipient) external onlyOwner {
        if (recipient == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        uint256 balance = address(this).balance;
        if (balance == 0) revert MCV2_ZapV2__NothingToRescue();
        (bool sent, ) = recipient.call{value: balance}("");
        if (!sent) revert MCV2_ZapV2__EthTransferFailed();
        emit EmergencyTokenRescue(address(0), recipient, balance);
    }

    /// @dev Emergency rescue stuck ERC-20 tokens
    function rescueTokens(address tokenAddress, address recipient) external onlyOwner {
        if (recipient == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance == 0) revert MCV2_ZapV2__NothingToRescue();
        IERC20(tokenAddress).safeTransfer(recipient, balance);
        emit EmergencyTokenRescue(tokenAddress, recipient, balance);
    }

    // ─── ERC1155 Receiver ────────────────────────────────────────────

    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
