// SPDX-License-Identifier: BSD-3-Clause
pragma solidity =0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title Locker
 * @dev A contract for locking up ERC20 and ERC1155 tokens for a specified period of time.
 */
contract Locker {
    using SafeERC20 for IERC20;

    error LockUp__InvalidParams(string param);
    error LockUp__PermissionDenied();
    error LockUp__AlreadyClaimed();
    error LockUp__NotYetUnlocked();
    error LockUp__InvalidPaginationParameters();

    event LockedUp(uint256 indexed lockUpId, address indexed token, bool isERC20, address indexed receiver, uint256 amount, uint40 unlockTime);
    event Unlocked(uint256 indexed lockUpId, address indexed token, bool isERC20, address indexed receiver, uint256 amount);


    struct LockUp {
        address token;
        bool isERC20;
        uint40 unlockTime;
        bool unlocked; // 160 + 8 + 40 + 8 = 216 bits
        uint256 amount;
        address receiver;
        string title;
    }

    LockUp[] public lockUps;

    modifier onlyReceiver(uint256 lockUpId) {
        if (msg.sender != lockUps[lockUpId].receiver) revert LockUp__PermissionDenied();
        _;
    }

    /**
     * @dev Creates a new lock-up.
     * @param token The address of the token being locked up.
     * @param isERC20 A boolean indicating whether the token is an ERC20 token.
     * @param amount The amount of tokens being locked up.
     * @param unlockTime The timestamp when the tokens can be unlocked.
     * @param receiver The address of the receiver of the locked tokens.
     * @param title The optional title of the lock-up.
     */
    function createLockUp(address token, bool isERC20, uint256 amount, uint40 unlockTime, address receiver, string calldata title) external {
        // Parameter validations
        if (token == address(0)) revert LockUp__InvalidParams('token');
        if (amount == 0) revert LockUp__InvalidParams('amount');
        if (unlockTime <= block.timestamp) revert LockUp__InvalidParams('unlockTime');
        if (receiver == address(0)) revert LockUp__InvalidParams('receiver');

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

        // Deposit total amount of tokens to this contract
        if (isERC20) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // Only support an ERC1155 token at id = 0
            IERC1155(token).safeTransferFrom(msg.sender, address(this), 0, amount, "");
        }

        emit LockedUp(lockUps.length - 1, token, isERC20, receiver, amount, unlockTime);
    }

    /**
     * @dev Unlocks the tokens of a lock-up.
     * @param lockUpId The ID of the lock-up.
     */
    function unlock(uint256 lockUpId) external onlyReceiver(lockUpId) {
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

    /**
     * @dev Returns the length of lockUps array.
     * @return The number of lock-ups.
     */
    function lockUpCount() external view returns (uint256) {
        return lockUps.length;
    }

    /**
     * @dev Returns an array of lock-up IDs for a given token address within a specified range.
     * @param token The address of the token.
     * @param start The starting index of the range.
     * @param stop The ending index of the range.
     * @return ids An array of lock-up IDs.
     */
    function getLockUpIdsByToken(address token, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        if (start >= stop || stop - start > 10000) revert LockUp__InvalidPaginationParameters();

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

    /**
     * @dev Returns an array of lock-up IDs for a given receiver address within a specified range.
     * @param receiver The address of the receiver.
     * @param start The starting index of the range.
     * @param stop The ending index of the range.
     * @return ids An array of lock-up IDs.
     */
    function getLockUpIdsByReceiver(address receiver, uint256 start, uint256 stop) external view returns (uint256[] memory ids) {
        if (start >= stop || stop - start > 10000) revert LockUp__InvalidPaginationParameters();

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
