// SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Test-only router that simulates exact-output swaps and input refunds.
 */
contract MockUniversalRouter {
    using SafeERC20 for IERC20;

    address public inputToken;
    address public outputToken;
    uint256 public inputUsed;
    uint256 public outputAmount;

    receive() external payable {}

    function configure(
        address inputToken_,
        address outputToken_,
        uint256 inputUsed_,
        uint256 outputAmount_
    ) external {
        inputToken = inputToken_;
        outputToken = outputToken_;
        inputUsed = inputUsed_;
        outputAmount = outputAmount_;
    }

    function execute(bytes calldata, bytes[] calldata, uint256) external payable {
        if (outputToken == address(0)) {
            (bool sent, ) = msg.sender.call{value: outputAmount}("");
            require(sent, "ETH output failed");
        } else {
            IERC20(outputToken).safeTransfer(msg.sender, outputAmount);
        }

        if (inputToken == address(0)) {
            uint256 refund = msg.value - inputUsed;
            if (refund > 0) {
                (bool sent, ) = msg.sender.call{value: refund}("");
                require(sent, "ETH refund failed");
            }
        } else {
            uint256 balance = IERC20(inputToken).balanceOf(address(this));
            if (balance > inputUsed) {
                IERC20(inputToken).safeTransfer(msg.sender, balance - inputUsed);
            }
        }
    }
}
