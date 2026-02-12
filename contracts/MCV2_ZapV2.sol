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

/**
 * @title IUniversalRouter
 * @dev Interface for Uniswap V4 Universal Router
 */
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/**
 * @title Mint Club V2 Zap V2 Contract
 * @dev This contract implements advanced Zap functionality with Uniswap V4 UniversalRouter integration
 * for the Mint Club V2 Bond contract. Supports swapping ANY token to reserve token and vice versa.
 */
contract MCV2_ZapV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Errors
    error MCV2_ZapV2__InvalidRouter();
    error MCV2_ZapV2__InvalidToken();
    error MCV2_ZapV2__InvalidAmount();
    error MCV2_ZapV2__InvalidReceiver();
    error MCV2_ZapV2__SlippageLimitExceeded();
    error MCV2_ZapV2__SwapFailed();
    error MCV2_ZapV2__EthTransferFailed();
    error MCV2_ZapV2__InvalidSwapPath();
    error MCV2_ZapV2__UnsupportedChain();

    // Constants
    MCV2_Bond public immutable BOND;
    IWETH public immutable WETH;
    IUniversalRouter public immutable UNIVERSAL_ROUTER;
    
    uint256 private constant MAX_INT = type(uint256).max;
    
    // Chain-specific Universal Router addresses
    mapping(uint256 => address) public chainRouters;

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
        if (bondAddress == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (wethAddress == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (universalRouterAddress == address(0)) revert MCV2_ZapV2__InvalidRouter();

        BOND = MCV2_Bond(bondAddress);
        WETH = IWETH(wethAddress);
        UNIVERSAL_ROUTER = IUniversalRouter(universalRouterAddress);

        // Initialize supported chain routers
        _initializeChainRouters();
    }

    receive() external payable {
        // Only accept ETH from WETH contract
        if (msg.sender != address(WETH)) revert MCV2_ZapV2__EthTransferFailed();
    }

    /**
     * @dev Initialize Universal Router addresses for supported chains
     */
    function _initializeChainRouters() private {
        chainRouters[1] = 0x66a9893cc07d91d95644aedd05d03f95e1dba8af; // Ethereum
        chainRouters[10] = 0x851116d9223fabed8e56c0e6b8ad0c31d98b3507; // Optimism  
        chainRouters[8453] = 0x6ff5693b99212da76ad316178a184ab56d299b43; // Base
        chainRouters[42161] = 0xa51afafe0263b40edaef0df8781ea9aa03e381a3; // Arbitrum
        chainRouters[137] = 0x1095692a6237d83c6a72f3f5efedb9a670c49223; // Polygon
        chainRouters[81457] = 0xeabbcb3e8e415306207ef514f660a3f820025be3; // Blast
        chainRouters[7777777] = 0x3315ef7ca28db74abadc6c44570efdf06b04b020; // Zora
        chainRouters[56] = 0x1906c1d672b88cd1b9ac7593301ca990f94eae07; // BSC
        chainRouters[43114] = 0x94b75331ae8d42c1b61065089b7d48fe14aa73b7; // Avalanche
        chainRouters[42220] = 0xcb695bc5d3aa22cad1e6df07801b061a05a0233a; // Celo
        chainRouters[480] = 0x8ac7bee993bb44dab564ea4bc9ea67bf9eb5e743; // Worldchain
        chainRouters[130] = 0xef740bf23acae26f6492b10de645d6b98dc8eaf3; // Unichain
    }

    /**
     * @dev Check if current chain is supported
     */
    function _checkSupportedChain() private view {
        if (chainRouters[block.chainid] == address(0)) {
            revert MCV2_ZapV2__UnsupportedChain();
        }
    }

    /**
     * @dev Get the reserve token for a given MC token
     */
    function _getReserveToken(address token) private view returns (address reserveToken) {
        (,,,,reserveToken,) = BOND.tokenBond(token);
    }

    /**
     * @dev Check if token is ERC20 (18 decimals) vs ERC1155 (0 decimals)
     */
    function _isERC20(address token) private pure returns (bool) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        return t.decimals() == 18;
    }

    struct SwapParams {
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 minOutputAmount;
        bytes swapPath;
    }

    /**
     * @dev Execute swap via Uniswap V4 Universal Router
     */
    function _executeSwap(SwapParams memory params) private returns (uint256 outputAmount) {
        _checkSupportedChain();
        
        if (params.swapPath.length == 0) revert MCV2_ZapV2__InvalidSwapPath();
        
        uint256 balanceBefore;
        bool isEthInput = (params.inputToken == address(0));
        bool isEthOutput = (params.outputToken == address(0));
        
        if (isEthOutput) {
            balanceBefore = address(this).balance;
        } else {
            balanceBefore = IERC20(params.outputToken).balanceOf(address(this));
        }

        // Execute the swap through Universal Router
        if (isEthInput) {
            UNIVERSAL_ROUTER.execute{value: params.inputAmount}(params.swapPath, new bytes[](0), block.timestamp + 300);
        } else {
            IERC20(params.inputToken).forceApprove(address(UNIVERSAL_ROUTER), params.inputAmount);
            UNIVERSAL_ROUTER.execute(params.swapPath, new bytes[](0), block.timestamp + 300);
        }

        // Calculate output amount received
        if (isEthOutput) {
            outputAmount = address(this).balance - balanceBefore;
        } else {
            outputAmount = IERC20(params.outputToken).balanceOf(address(this)) - balanceBefore;
        }

        if (outputAmount < params.minOutputAmount) {
            revert MCV2_ZapV2__SlippageLimitExceeded();
        }
    }

    struct MintParams {
        address token;
        address inputToken;
        uint256 inputAmount;
        uint256 minTokensOut;
        bytes swapPath;
        address receiver;
    }

    /**
     * @dev Mint MC tokens by swapping input token to reserve token first
     * @param params Struct containing all mint parameters
     */
    function zapMint(MintParams calldata params) 
        external payable nonReentrant returns (uint256 tokensReceived, uint256 reserveUsed) 
    {
        if (params.token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (params.receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (params.inputAmount == 0) revert MCV2_ZapV2__InvalidAmount();

        address reserveToken = _getReserveToken(params.token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        // Process input and get reserve tokens
        uint256 swapOutputAmount = _processInputToken(params, reserveToken);

        // Calculate and mint tokens
        (tokensReceived, reserveUsed) = _mintTokensWithReserve(
            params.token, 
            swapOutputAmount, 
            params.minTokensOut, 
            params.receiver,
            reserveToken
        );

        // Handle refunds
        _handleRefund(params.inputToken, reserveToken, swapOutputAmount, reserveUsed);

        emit ZapMint(params.token, params.inputToken, params.receiver, params.inputAmount, tokensReceived, reserveUsed);
    }

    /**
     * @dev Process input token to get reserve tokens
     */
    function _processInputToken(MintParams calldata params, address reserveToken) private returns (uint256) {
        if (params.inputToken == address(0)) {
            // Native ETH input
            if (msg.value != params.inputAmount) revert MCV2_ZapV2__InvalidAmount();
            
            if (reserveToken == address(WETH)) {
                // Direct WETH deposit - no swap needed
                WETH.deposit{value: params.inputAmount}();
                return params.inputAmount;
            } else {
                // Swap ETH to reserve token
                SwapParams memory swapParams = SwapParams({
                    inputToken: address(0),
                    outputToken: reserveToken,
                    inputAmount: params.inputAmount,
                    minOutputAmount: 0,
                    swapPath: params.swapPath
                });
                return _executeSwap(swapParams);
            }
        } else {
            // ERC20 input
            IERC20(params.inputToken).safeTransferFrom(msg.sender, address(this), params.inputAmount);
            
            if (params.inputToken == reserveToken) {
                // No swap needed
                return params.inputAmount;
            } else {
                // Swap input token to reserve token
                SwapParams memory swapParams = SwapParams({
                    inputToken: params.inputToken,
                    outputToken: reserveToken,
                    inputAmount: params.inputAmount,
                    minOutputAmount: 0,
                    swapPath: params.swapPath
                });
                return _executeSwap(swapParams);
            }
        }
    }

    /**
     * @dev Mint tokens with reserve and return amounts
     */
    function _mintTokensWithReserve(
        address token,
        uint256 reserveAmount,
        uint256 minTokensOut,
        address receiver,
        address reserveToken
    ) private returns (uint256 tokensReceived, uint256 reserveUsed) {
        // Calculate how many MC tokens we can mint with the reserve we got
        (uint256 maxTokens, uint256 actualReserveNeeded) = _calculateMaxMintable(token, reserveAmount);
        
        if (maxTokens < minTokensOut) {
            revert MCV2_ZapV2__SlippageLimitExceeded();
        }

        // Approve reserve token for Bond contract
        IERC20(reserveToken).forceApprove(address(BOND), actualReserveNeeded);

        // Mint MC tokens
        BOND.mint(token, maxTokens, actualReserveNeeded, receiver);

        return (maxTokens, actualReserveNeeded);
    }

    /**
     * @dev Handle leftover refunds
     */
    function _handleRefund(
        address inputToken,
        address reserveToken,
        uint256 swapOutputAmount,
        uint256 reserveUsed
    ) private {
        uint256 leftoverReserve = swapOutputAmount - reserveUsed;
        if (leftoverReserve > 0) {
            if (reserveToken == address(WETH) && inputToken == address(0)) {
                // Unwrap and send back as ETH
                WETH.withdraw(leftoverReserve);
                (bool sent, ) = msg.sender.call{value: leftoverReserve}("");
                if (!sent) revert MCV2_ZapV2__EthTransferFailed();
            } else {
                // Send back as ERC20
                IERC20(reserveToken).safeTransfer(msg.sender, leftoverReserve);
            }
        }
    }

    /**
     * @dev Calculate maximum mintable tokens with given reserve amount
     */
    function _calculateMaxMintable(address token, uint256 reserveAmount) 
        private view returns (uint256 maxTokens, uint256 actualReserveNeeded) {
        
        // Binary search to find maximum mintable tokens within reserve budget
        MCV2_ICommonToken mcToken = MCV2_ICommonToken(token);
        uint256 currentSupply = mcToken.totalSupply();
        uint256 maxSupply = BOND.maxSupply(token);
        
        uint256 left = 0;
        uint256 right = maxSupply - currentSupply;
        
        while (left < right) {
            uint256 mid = left + (right - left + 1) / 2;
            try BOND.getReserveForToken(token, mid) returns (uint256 required, uint256) {
                if (required <= reserveAmount) {
                    left = mid;
                } else {
                    right = mid - 1;
                }
            } catch {
                right = mid - 1;
            }
        }
        
        maxTokens = left;
        if (maxTokens == 0) return (0, 0);
        
        (actualReserveNeeded, ) = BOND.getReserveForToken(token, maxTokens);
    }

    struct BurnParams {
        address token;
        uint256 tokensToBurn;
        address outputToken;
        uint256 minOutputAmount;
        bytes swapPath;
        address receiver;
    }

    /**
     * @dev Burn MC tokens and swap the reserve to desired output token
     * @param params Struct containing all burn parameters
     */
    function zapBurn(BurnParams calldata params) 
        external nonReentrant returns (uint256 outputAmount, uint256 reserveReceived) 
    {
        if (params.token == address(0)) revert MCV2_ZapV2__InvalidToken();
        if (params.receiver == address(0)) revert MCV2_ZapV2__InvalidReceiver();
        if (params.tokensToBurn == 0) revert MCV2_ZapV2__InvalidAmount();

        address reserveToken = _getReserveToken(params.token);
        if (reserveToken == address(0)) revert MCV2_ZapV2__InvalidToken();

        // Process burn and get reserve
        reserveReceived = _processBurnToken(params, reserveToken);

        // Convert reserve to output
        outputAmount = _convertReserveToOutput(params, reserveToken, reserveReceived);

        emit ZapBurn(params.token, params.outputToken, params.receiver, params.tokensToBurn, outputAmount, reserveReceived);
    }

    /**
     * @dev Process MC token burn and return reserve amount
     */
    function _processBurnToken(BurnParams calldata params, address reserveToken) private returns (uint256) {
        // Get refund amount
        (uint256 refundAmount, ) = BOND.getRefundForTokens(params.token, params.tokensToBurn);
        if (refundAmount < params.minOutputAmount && params.outputToken == reserveToken) {
            revert MCV2_ZapV2__SlippageLimitExceeded();
        }

        // Transfer MC tokens from user
        if (_isERC20(params.token)) {
            IERC20(params.token).safeTransferFrom(msg.sender, address(this), params.tokensToBurn);
            IERC20(params.token).forceApprove(address(BOND), params.tokensToBurn);
        } else {
            IERC1155(params.token).safeTransferFrom(msg.sender, address(this), 0, params.tokensToBurn, "");
            if (!IERC1155(params.token).isApprovedForAll(address(this), address(BOND))) {
                IERC1155(params.token).setApprovalForAll(address(BOND), true);
            }
        }

        // Burn tokens to get reserve
        BOND.burn(params.token, params.tokensToBurn, refundAmount, address(this));
        return refundAmount;
    }

    /**
     * @dev Convert reserve to desired output token
     */
    function _convertReserveToOutput(BurnParams calldata params, address reserveToken, uint256 reserveReceived) 
        private returns (uint256) 
    {
        if (params.outputToken == reserveToken) {
            // No swap needed - direct transfer
            IERC20(reserveToken).safeTransfer(params.receiver, reserveReceived);
            return reserveReceived;
        } else if (params.outputToken == address(0) && reserveToken == address(WETH)) {
            // Unwrap WETH to ETH - no additional swap
            WETH.withdraw(reserveReceived);
            (bool sent, ) = params.receiver.call{value: reserveReceived}("");
            if (!sent) revert MCV2_ZapV2__EthTransferFailed();
            return reserveReceived;
        } else {
            // Swap reserve token to output token
            SwapParams memory swapParams = SwapParams({
                inputToken: reserveToken,
                outputToken: params.outputToken,
                inputAmount: reserveReceived,
                minOutputAmount: params.minOutputAmount,
                swapPath: params.swapPath
            });

            uint256 outputAmount = _executeSwap(swapParams);
            
            if (params.outputToken == address(0)) {
                // Send ETH
                (bool sent, ) = params.receiver.call{value: outputAmount}("");
                if (!sent) revert MCV2_ZapV2__EthTransferFailed();
            } else {
                // Send ERC20
                IERC20(params.outputToken).safeTransfer(params.receiver, outputAmount);
            }
            
            return outputAmount;
        }
    }

    // MARK: - View Functions

    /**
     * @dev Get the Universal Router address for current chain
     */
    function getUniversalRouter() external view returns (address) {
        return chainRouters[block.chainid];
    }

    /**
     * @dev Check if current chain is supported
     */
    function isSupportedChain() external view returns (bool) {
        return chainRouters[block.chainid] != address(0);
    }

    /**
     * @dev Estimate output for zapMint (off-chain helper)
     * Note: This is a view function for off-chain estimation. Actual swap may differ.
     */
    function estimateZapMint(
        address token,
        uint256 inputAmount
    ) external view returns (uint256 estimatedTokensOut, uint256 estimatedReserveNeeded) {
        address reserveToken = _getReserveToken(token);
        if (reserveToken == address(0)) return (0, 0);
        
        // For estimation purposes, assume 1:1 swap rate
        // In practice, clients should compute proper swap paths off-chain
        return _calculateMaxMintable(token, inputAmount);
    }

    /**
     * @dev Estimate output for zapBurn (off-chain helper)
     */
    function estimateZapBurn(
        address token,
        uint256 tokensToBurn
    ) external view returns (uint256 estimatedReserveOut) {
        (estimatedReserveOut, ) = BOND.getRefundForTokens(token, tokensToBurn);
    }

    // MARK: - Admin Functions

    /**
     * @dev Emergency function to rescue stuck tokens
     * @param tokenAddress The token address to rescue (use address(0) for ETH)
     * @param recipient The address to send rescued tokens to
     */
    function rescueToken(address tokenAddress, address recipient) external onlyOwner {
        if (recipient == address(0)) revert MCV2_ZapV2__InvalidReceiver();

        if (tokenAddress == address(0)) {
            // Rescue ETH
            uint256 balance = address(this).balance;
            if (balance > 0) {
                (bool sent, ) = recipient.call{value: balance}("");
                if (!sent) revert MCV2_ZapV2__EthTransferFailed();
                emit EmergencyTokenRescue(address(0), recipient, balance);
            }
        } else {
            // Rescue ERC20
            IERC20 token = IERC20(tokenAddress);
            uint256 balance = token.balanceOf(address(this));
            if (balance > 0) {
                token.safeTransfer(recipient, balance);
                emit EmergencyTokenRescue(tokenAddress, recipient, balance);
            }
        }
    }

    /**
     * @dev Update Universal Router address for a specific chain (emergency use)
     */
    function updateChainRouter(uint256 chainId, address routerAddress) external onlyOwner {
        chainRouters[chainId] = routerAddress;
    }

    // MARK: - ERC1155 Receiver

    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}