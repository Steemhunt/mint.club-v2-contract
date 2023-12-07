// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Locker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error LockUp__InvalidParams(string param);
    error LockUp__PermissionDenied();
    error LockUp__AlreadyClaimed();
    error LockUp__NotYetUnlocked();

    event LockedUp(uint256 indexed lockUpId, address indexed token, bool isERC20, address indexed receiver, uint256 amount, uint40 unlockTime);
    event Unlocked(uint256 indexed lockUpId, address indexed token, bool isERC20, address indexed receiver, uint256 amount);

    struct LockUp { // 3 slots
        address token; // 160 bits
        bool isERC20;
        uint40 unlockTime; // supports up to year 36,825
        bool unlocked; // 160 + 8 + 40 + 8 = 216 bits
        uint256 amount;
        address receiver;
        string title; // optional
    }

    LockUp[] public lockUps;

    modifier onlyReceiver(uint256 lockUpId) {
        if (msg.sender != lockUps[lockUpId].receiver) revert LockUp__PermissionDenied();
        _;
    }

    function createLockUp(address token, bool isERC20, uint256 amount, uint40 unlockTime, address receiver, string calldata title) external nonReentrant {
        if (token == address(0)) revert LockUp__InvalidParams('token');
        if (amount == 0) revert LockUp__InvalidParams('amount');
        if (unlockTime <= block.timestamp) revert LockUp__InvalidParams('unlockTime');

        // Deposit total amount of tokens to this contract
        if (isERC20) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, amount, "");
        }

        // Create a new lockUp
        lockUps.push();
        LockUp storage lockUp = lockUps[lockUps.length - 1];
        lockUp.token = token;
        lockUp.isERC20 = isERC20;
        lockUp.unlockTime = unlockTime;
        // lockUp.unlocked = false;
        lockUp.amount = amount;
        lockUp.receiver = receiver;
        lockUp.title = title;

        emit LockedUp(lockUps.length - 1, token, isERC20, receiver, amount, unlockTime);
    }

   function unlock(uint256 lockUpId) external onlyReceiver(lockUpId) nonReentrant {
        LockUp storage lockUp = lockUps[lockUpId];
        if (lockUp.unlocked) revert LockUp__AlreadyClaimed();
        if (lockUp.unlockTime > block.timestamp) revert LockUp__NotYetUnlocked();

        lockUp.unlocked = true;

        if (lockUp.isERC20) {
            IERC20(lockUp.token).safeTransfer(lockUp.receiver, lockUp.amount);
        } else {
            IERC1155(lockUp.token).safeTransferFrom(address(this), lockUp.receiver, 0, lockUp.amount, "");
        }

        emit Unlocked(lockUpId, lockUp.token, lockUp.isERC20, lockUp.receiver, lockUp.amount);
    }

    // MARK: - Utility functions

    function lockUpCount() external view returns (uint256) {
        return lockUps.length;
    }

    // Get lockupIds by token address in the range where start <= id < stop
    function getLockUpIdsByToken(address token, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 lockUpsLength = lockUps.length;
            if (stop > lockUpsLength) {
                stop = lockUpsLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (lockUps[i].token == token) ++count;
            }

            ids = new uint256[](count);
            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                if (lockUps[i].token == token) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    // Get lockupIds by token address in the range where start <= id < stop
    function getLockUpIdsByReceiver(address receiver, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 lockUpsLength = lockUps.length;
            if (stop > lockUpsLength) {
                stop = lockUpsLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (lockUps[i].receiver == receiver) ++count;
            }

            ids = new uint256[](count);
            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                if (lockUps[i].receiver == receiver) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    // MARK: - ERC1155 Receiver

    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
