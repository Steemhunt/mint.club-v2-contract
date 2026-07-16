// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MCV2_Bond} from "./MCV2_Bond.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";
import {IUniversalRouter} from "./interfaces/IUniversalRouter.sol";

/**
 * @title Mint Club V2 Zap V2 Contract
 * @dev Zap functionality with Uniswap UniversalRouter integration for MCV2 Bond.
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
    error MCV2_ZapV2__ExactOutputMismatch();
    error MCV2_ZapV2__InvalidERC1155Transfer();

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

    /// @dev Check if an MC token is ERC-20 (vs ERC-1155).
    ///      MC ERC-20s return decimals() == 18, MC ERC-1155s return 0.
    ///      Uses try/catch so tokens that don't implement decimals() are treated as ERC-1155.
    function _isMCTokenERC20(address token) private view returns (bool) {
        try MCV2_ICommonToken(token).decimals() returns (uint8 d) {
            return d == 18;
        } catch {
            return false;
        }
    }

    /// @dev Execute swap via UniversalRouter with balance-check slippage protection.
    ///
    /// IMPORTANT for off-chain command construction:
    /// - Swap recipient MUST be address(this) — output is measured by balance delta.
    /// - Use payerIsUser=false — this contract transfers tokens to the router before execute().
    /// - Use exact amountIn (not CONTRACT_BALANCE/MaxUint256) for reliable execution.
    /// - Fee-on-transfer tokens are NOT supported and will cause amount mismatches.
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

        uint256 balanceBefore = _balanceOf(outputToken);

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

        outputAmount = _balanceOf(outputToken) - balanceBefore;

        if (outputAmount < minOutputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
    }

    /// @dev Execute an exact-output swap and require the router to return the exact balance delta.
    ///      Exact-output commands must sweep unused input back to address(this).
    function _executeSwapExactOut(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) private {
        if (commands.length == 0) revert MCV2_ZapV2__InvalidSwapPath();

        uint256 balanceBefore = _balanceOf(outputToken);

        if (inputToken == address(0)) {
            UNIVERSAL_ROUTER.execute{value: maxInputAmount}(commands, inputs, deadline);
        } else {
            IERC20(inputToken).safeTransfer(address(UNIVERSAL_ROUTER), maxInputAmount);
            UNIVERSAL_ROUTER.execute(commands, inputs, deadline);
        }

        if (_balanceOf(outputToken) - balanceBefore != exactOutputAmount) {
            revert MCV2_ZapV2__ExactOutputMismatch();
        }
    }

    function _balanceOf(address token) private view returns (uint256) {
        return token == address(0)
            ? address(this).balance
            : IERC20(token).balanceOf(address(this));
    }

    function _transferAsset(address token, address recipient, uint256 amount) private {
        if (amount == 0) return;

        if (token == address(0)) {
            (bool sent, ) = recipient.call{value: amount}("");
            if (!sent) revert MCV2_ZapV2__EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /// @dev Refund only the balance added during the current operation.
    function _refundBalance(address token, uint256 balanceBefore, address recipient)
        private returns (uint256 refunded)
    {
        uint256 currentBalance = _balanceOf(token);
        if (currentBalance <= balanceBefore) return 0;

        unchecked { refunded = currentBalance - balanceBefore; }
        _transferAsset(token, recipient, refunded);
    }

    /// @dev Calculate maximum mintable tokens within a reserve budget by walking bond steps.
    function _calculateMaxMintable(address token, uint256 reserveAmount)
        private view returns (uint256 maxTokens, uint256 actualReserveNeeded)
    {
        (maxTokens, ) = _getTokensForReserve(token, reserveAmount);
        if (maxTokens == 0) return (0, 0);

        (actualReserveNeeded, ) = BOND.getReserveForToken(token, maxTokens);
        if (actualReserveNeeded <= reserveAmount) return (maxTokens, actualReserveNeeded);

        --maxTokens;
        if (maxTokens == 0) return (0, 0);
        (actualReserveNeeded, ) = BOND.getReserveForToken(token, maxTokens);
        if (actualReserveNeeded > reserveAmount) return (0, 0);
    }

    /// @dev Calculate tokens purchasable with reserve by walking the curve once.
    function _getTokensForReserve(address token, uint256 reserveAmount)
        private view returns (uint256 tokensToMint, address reserveToken)
    {
        if (reserveAmount == 0) return (0, address(0));

        (, uint16 mintRoyalty, , , address reserveTokenAddress, ) = BOND.tokenBond(token);
        reserveToken = reserveTokenAddress;
        if (reserveTokenAddress == address(0)) return (0, address(0));

        MCV2_Bond.BondStep[] memory steps = BOND.getSteps(token);
        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        uint256 stepsLength = steps.length;
        if (stepsLength == 0 || currentSupply >= steps[stepsLength - 1].rangeTo) {
            return (0, reserveToken);
        }

        uint256 multiFactor = 10 ** MCV2_ICommonToken(token).decimals();
        uint256 reserveLeft = Math.mulDiv(reserveAmount, 10_000, 10_000 + mintRoyalty);
        if (reserveLeft < reserveAmount) {
            uint256 nextReserve = reserveLeft + 1;
            uint256 nextTotal = nextReserve + Math.mulDiv(nextReserve, mintRoyalty, 10_000);
            if (nextTotal <= reserveAmount) reserveLeft = nextReserve;
        }
        uint256 i = _getCurrentStep(steps, currentSupply);

        for (; i < stepsLength && reserveLeft > 0; ++i) {
            MCV2_Bond.BondStep memory step = steps[i];
            uint256 supplyLeft = step.rangeTo - currentSupply;
            if (supplyLeft == 0) continue;
            if (step.price == 0) {
                currentSupply += supplyLeft;
                continue;
            }

            uint256 tokensAtStep = Math.mulDiv(reserveLeft, multiFactor, step.price);

            if (tokensAtStep <= supplyLeft) {
                tokensToMint += tokensAtStep;
                break;
            }

            tokensToMint += supplyLeft;
            reserveLeft -= Math.mulDiv(supplyLeft, step.price, multiFactor, Math.Rounding.Ceil);
            currentSupply += supplyLeft;
        }
    }

    /// @dev Calculate the minimum MC tokens that refund at least reserveAmount.
    function _getTokensForRefund(address token, uint256 reserveAmount)
        private view returns (uint256 tokensToBurn, address reserveToken)
    {
        if (reserveAmount == 0) return (0, address(0));

        (, , uint16 burnRoyalty, , address reserveTokenAddress, ) = BOND.tokenBond(token);
        reserveToken = reserveTokenAddress;
        if (reserveTokenAddress == address(0)) return (0, address(0));

        MCV2_Bond.BondStep[] memory steps = BOND.getSteps(token);
        uint256 totalSupply = MCV2_ICommonToken(token).totalSupply();
        if (steps.length == 0 || totalSupply == 0) return (0, reserveToken);
        uint256 currentSupply = totalSupply;

        uint256 grossReserve = Math.mulDiv(
            reserveAmount,
            10_000,
            10_000 - burnRoyalty,
            Math.Rounding.Ceil
        );
        if (grossReserve > 0) {
            uint256 previousGross = grossReserve - 1;
            uint256 previousRefund = previousGross - Math.mulDiv(previousGross, burnRoyalty, 10_000);
            if (previousRefund >= reserveAmount) grossReserve = previousGross;
        }

        uint256 multiFactor = 10 ** MCV2_ICommonToken(token).decimals();
        uint256 i = _getCurrentStep(steps, currentSupply);

        while (grossReserve > 0) {
            uint256 stepStart = i == 0 ? 0 : steps[i - 1].rangeTo;
            uint256 tokensAtStep = currentSupply - stepStart;
            uint256 reserveAtStep = Math.mulDiv(tokensAtStep, steps[i].price, multiFactor);

            if (reserveAtStep >= grossReserve) {
                tokensToBurn += Math.mulDiv(
                    grossReserve,
                    multiFactor,
                    steps[i].price,
                    Math.Rounding.Ceil
                );
                break;
            }

            tokensToBurn += tokensAtStep;
            grossReserve -= reserveAtStep;
            currentSupply = stepStart;
            if (i == 0) revert MCV2_ZapV2__InvalidAmount();
            unchecked { --i; }
        }

        (uint256 refundAmount, ) = BOND.getRefundForTokens(token, tokensToBurn);
        if (refundAmount < reserveAmount) {
            if (tokensToBurn == totalSupply) revert MCV2_ZapV2__InvalidAmount();
            unchecked { ++tokensToBurn; }
            (refundAmount, ) = BOND.getRefundForTokens(token, tokensToBurn);
            if (refundAmount < reserveAmount) revert MCV2_ZapV2__InvalidAmount();
        }
    }

    function _getCurrentStep(MCV2_Bond.BondStep[] memory steps, uint256 currentSupply)
        private pure returns (uint256)
    {
        uint256 left;
        uint256 right = steps.length;

        while (left < right) {
            uint256 mid = (left + right) / 2;
            if (steps[mid].rangeTo < currentSupply) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        if (left >= steps.length) revert MCV2_ZapV2__InvalidAmount();
        return left;
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

    // ─── zapMintExactOut ─────────────────────────────────────────────

    /**
     * @notice Mint an exact amount of MC tokens using at most maxInputAmount.
     * @dev For routed swaps, commands must send the exact reserve output to this contract and
     *      sweep unused input back to this contract for refunding.
     *      Native-input routes must unwrap unused WETH and return native ETH to this contract.
     */
    function zapMintExactOut(
        address token,
        address inputToken,
        uint256 tokensOut,
        uint256 maxInputAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline,
        address receiver
    ) external payable nonReentrant returns (uint256 inputUsed, uint256 reserveUsed) {
        if (token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (tokensOut == 0 || maxInputAmount == 0) revert MCV2_ZapV2__InvalidAmount();

        if (inputToken == address(0)) {
            if (msg.value != maxInputAmount) revert MCV2_ZapV2__MsgValueMismatch();
        } else if (msg.value != 0) {
            revert MCV2_ZapV2__MsgValueMismatch();
        }

        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        (reserveUsed, ) = BOND.getReserveForToken(token, tokensOut);
        uint256 reserveBalanceBefore = IERC20(reserveToken).balanceOf(address(this));

        if (inputToken == address(0)) {
            uint256 ethBalanceBefore = address(this).balance - msg.value;

            if (reserveToken == address(WETH)) {
                if (reserveUsed > maxInputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
                WETH.deposit{value: reserveUsed}();
            } else {
                _executeSwapExactOut(
                    address(0), reserveToken, maxInputAmount, reserveUsed,
                    commands, inputs, deadline
                );
            }

            uint256 refunded = _refundBalance(address(0), ethBalanceBefore, msg.sender);
            if (refunded > maxInputAmount) revert MCV2_ZapV2__ExactOutputMismatch();
            inputUsed = maxInputAmount - refunded;
        } else if (inputToken == reserveToken) {
            if (reserveUsed > maxInputAmount) revert MCV2_ZapV2__SlippageLimitExceeded();
            IERC20(reserveToken).safeTransferFrom(msg.sender, address(this), reserveUsed);
            inputUsed = reserveUsed;
        } else {
            uint256 inputBalanceBefore = IERC20(inputToken).balanceOf(address(this));
            IERC20(inputToken).safeTransferFrom(msg.sender, address(this), maxInputAmount);
            _executeSwapExactOut(
                inputToken, reserveToken, maxInputAmount, reserveUsed,
                commands, inputs, deadline
            );

            uint256 refunded = _refundBalance(inputToken, inputBalanceBefore, msg.sender);
            if (refunded > maxInputAmount) revert MCV2_ZapV2__ExactOutputMismatch();
            inputUsed = maxInputAmount - refunded;
        }

        IERC20(reserveToken).forceApprove(address(BOND), reserveUsed);
        reserveUsed = BOND.mint(token, tokensOut, reserveUsed, receiver);
        IERC20(reserveToken).forceApprove(address(BOND), 0);

        _refundBalance(reserveToken, reserveBalanceBefore, msg.sender);
        if (inputToken == reserveToken) inputUsed = reserveUsed;

        emit ZapMint(token, inputToken, receiver, inputUsed, tokensOut, reserveUsed);
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

        // Step 1: Transfer MC tokens and burn
        reserveReceived = _burnForReserve(token, tokensToBurn, 0);

        // Step 2: Convert reserve → desired output
        outputAmount = _deliverOutput(
            reserveToken, outputToken, reserveReceived, minOutputAmount, commands, inputs, deadline, receiver
        );

        emit ZapBurn(token, outputToken, receiver, tokensToBurn, outputAmount, reserveReceived);
    }

    function _burnForReserve(address token, uint256 tokensToBurn, uint256 minRefund)
        private returns (uint256 reserveReceived)
    {
        (uint256 expectedRefund, ) = BOND.getRefundForTokens(token, tokensToBurn);
        if (expectedRefund < minRefund) revert MCV2_ZapV2__SlippageLimitExceeded();

        if (_isMCTokenERC20(token)) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), tokensToBurn);
            IERC20(token).forceApprove(address(BOND), tokensToBurn);
        } else {
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, tokensToBurn, "");
            if (!IERC1155(token).isApprovedForAll(address(this), address(BOND))) {
                IERC1155(token).setApprovalForAll(address(BOND), true);
            }
        }

        reserveReceived = BOND.burn(token, tokensToBurn, expectedRefund, address(this));
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
            _transferAsset(address(0), receiver, reserveAmount);
            return reserveAmount;
        }

        // Swap reserve → output via router
        uint256 outputAmount = _executeSwap(
            reserveToken, outputToken, reserveAmount, minOutputAmount, commands, inputs, deadline
        );

        _transferAsset(outputToken, receiver, outputAmount);
        return outputAmount;
    }

    // ─── zapBurnExactOut ─────────────────────────────────────────────

    /**
     * @notice Burn at most maxTokensIn to receive an exact output amount.
     * @param maxReserveAmount Maximum reserve input for a routed exact-output swap. For direct
     *        reserve or WETH-to-ETH output, it must be at least outputAmount and only the exact
     *        amount is funded. Routed swaps burn enough tokens to fund this full maximum because
     *        the burn is irreversible; all unused reserve is refunded to msg.sender.
     */
    function zapBurnExactOut(
        address token,
        uint256 maxTokensIn,
        address outputToken,
        uint256 outputAmount,
        uint256 maxReserveAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline,
        address receiver
    ) external nonReentrant returns (uint256 tokensBurned, uint256 reserveReceived) {
        if (token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (maxTokensIn == 0 || outputAmount == 0 || maxReserveAmount == 0) {
            revert MCV2_ZapV2__InvalidAmount();
        }

        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        bool isDirectOutput = outputToken == reserveToken
            || (outputToken == address(0) && reserveToken == address(WETH));
        uint256 reserveTarget = isDirectOutput ? outputAmount : maxReserveAmount;
        if (isDirectOutput && outputAmount > maxReserveAmount) {
            revert MCV2_ZapV2__SlippageLimitExceeded();
        }

        (tokensBurned, ) = _getTokensForRefund(token, reserveTarget);
        if (tokensBurned == 0) revert MCV2_ZapV2__InvalidAmount();
        if (tokensBurned > maxTokensIn) revert MCV2_ZapV2__SlippageLimitExceeded();

        uint256 reserveBalanceBefore = IERC20(reserveToken).balanceOf(address(this));
        reserveReceived = _burnForReserve(token, tokensBurned, reserveTarget);

        if (outputToken == reserveToken) {
            IERC20(reserveToken).safeTransfer(receiver, outputAmount);
        } else if (outputToken == address(0) && reserveToken == address(WETH)) {
            WETH.withdraw(outputAmount);
            _transferAsset(address(0), receiver, outputAmount);
        } else {
            _executeSwapExactOut(
                reserveToken, outputToken, maxReserveAmount, outputAmount,
                commands, inputs, deadline
            );
            _transferAsset(outputToken, receiver, outputAmount);
        }

        _refundBalance(reserveToken, reserveBalanceBefore, msg.sender);
        emit ZapBurn(token, outputToken, receiver, tokensBurned, outputAmount, reserveReceived);
    }

    // ─── View Functions ──────────────────────────────────────────────

    /// @dev Estimate zapMint output from an amount denominated in the bond reserve token.
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

    /// @dev Estimate reserve required to mint an exact MC token amount.
    function estimateZapMintExactOut(address token, uint256 tokensOut)
        external view returns (uint256 reserveRequired)
    {
        (reserveRequired, ) = BOND.getReserveForToken(token, tokensOut);
    }

    /// @dev Estimate minimum MC tokens to burn for an exact reserve refund.
    function estimateZapBurnExactOut(address token, uint256 reserveAmount)
        external view returns (uint256 tokensToBurn)
    {
        (tokensToBurn, ) = _getTokensForRefund(token, reserveAmount);
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

    function onERC1155Received(
        address operator,
        address,
        uint256,
        uint256,
        bytes memory
    ) external view returns (bytes4) {
        if (operator != address(this)) revert MCV2_ZapV2__InvalidERC1155Transfer();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) external pure returns (bytes4) {
        revert MCV2_ZapV2__InvalidERC1155Transfer();
    }
}
