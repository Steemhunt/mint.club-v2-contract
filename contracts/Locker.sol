// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Locker {
    using SafeERC20 for IERC20;

    error LockUp__InvalidParams(string param);
    error LockUp__PermissionDenied();
    error LockUp__AlreadyClaimed();
    error LockUp__NotYetUnlocked();

    event LockedUp(uint256 indexed lockUpId, address indexed token, address indexed receiver, uint128 amount, uint40 unlockTime);
    event Unlocked(uint256 indexed lockUpId, address indexed token, address indexed receiver, uint128 amount);

    struct LockUp { // 3 slots
        address token; // 160 bits
        uint40 unlockTime; // supports up to year 36,825
        bool unlocked;
        uint128 amount; // 128 + 8 + 40 = 176 bits
        address receiver;
    }

    LockUp[] public lockUps;

    modifier onlyReceiver(uint256 lockUpId) {
        if (msg.sender != lockUps[lockUpId].receiver) revert LockUp__PermissionDenied();
        _;
    }

    function createLockUp(address token, uint128 amount, uint40 unlockTime, address receiver) external {
        if (token == address(0)) revert LockUp__InvalidParams('token');
        if (amount == 0) revert LockUp__InvalidParams('amount');
        if (unlockTime <= block.timestamp) revert LockUp__InvalidParams('unlockTime');

        // Deposit total amount of tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Create a new lockUp
        lockUps.push();
        LockUp storage lockUp = lockUps[lockUps.length - 1];
        lockUp.token = token;
        lockUp.unlockTime = unlockTime;
        // lockUp.unlocked = false;
        lockUp.amount = amount;
        lockUp.receiver = receiver;

        emit LockedUp(lockUps.length - 1, token, receiver, amount, unlockTime);
    }

    function unlock(uint256 lockUpId) external onlyReceiver(lockUpId) {
        LockUp storage lockUp = lockUps[lockUpId];
        if (lockUp.unlocked) revert LockUp__AlreadyClaimed();
        if (lockUp.unlockTime > block.timestamp) revert LockUp__NotYetUnlocked();

        lockUp.unlocked = true;
        IERC20(lockUp.token).safeTransfer(lockUp.receiver, lockUp.amount);

        emit Unlocked(lockUpId, lockUp.token, lockUp.receiver, lockUp.amount);
    }

    // MARK: - Utility functions

    function getLockUpIdsByToken(address token) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count;
            uint256 lockUpsLength = lockUps.length;
            for (uint256 i = 0; i < lockUpsLength; ++i) {
                if (lockUps[i].token == token) ++count;
            }
            ids = new uint256[](count);

            uint256 j;
            for (uint256 i = 0; i < lockUpsLength; ++i) {
                if (lockUps[i].token == token) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    function getLockUpIdsByReceiver(address receiver) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count;
            uint256 lockUpsLength = lockUps.length;
            for (uint256 i = 0; i < lockUpsLength; ++i) {
                if (lockUps[i].receiver == receiver) ++count;
            }
            ids = new uint256[](count);

            uint256 j;
            for (uint256 i = 0; i < lockUpsLength; ++i) {
                if (lockUps[i].receiver == receiver) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }
}
