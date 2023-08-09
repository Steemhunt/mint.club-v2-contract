// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Locker {
    using SafeERC20 for IERC20;

    error LockUp__InvalidParams(string param);
    error LockUp__PermissionDenied();
    error LockUp__AlreadyClaimed();

    event LockedUp(uint256 lockUpId, address account, uint256 amount, uint40 unlockTime);
    event Unlocked(uint256 lockUpId, address account, address amount);

    struct LockUp { // 3 slots
        address token; // 160 bits
        uint128 amount;
        uint40 unlockTime; // (supports up to year 36,825) 128 + 40 = 168 bits
        address owner;
        bool unlocked; // 160 + 8 = 168 bits
    }

    LockUp[] public lockUps;

    modifier onlyOwner(uint256 lockUpId) {
        if (msg.sender != lockUps[lockUpId].owner) revert LockUp__PermissionDenied();
        _;
    }

    function createLockUp(address token, uint128 amount, uint40 unlockTime) external {
        if (token == address(0)) revert LockUp__InvalidParams('token');
        if (amount == 0) revert LockUp__InvalidParams('amount');
        if (unlockTime <= block.timestamp) revert LockUp__InvalidParams('unlockTime');

        // Deposit total amount of tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Create a new lockUp
        lockUps.push();
        LockUp storage lockUp = lockUps[lockUps.length - 1];
        lockUp.token = token;
        lockUp.amount = amount;
        lockUp.unlockTime = unlockTime;
        lockUp.owner = msg.sender;
        // lockUp.unlocked = false;

        emit LockedUp(lockUps.length - 1, msg.sender, amount, unlockTime);
    }



    // )

    // function createDistribution(
    //     address token,
    //     uint96 amountPerClaim,
    //     uint24 whitelistCount,
    //     uint40 endTime,
    //     bytes32 merkleRoot,
    //     string calldata title
    // ) external {
    //     if (token == address(0)) revert MerkleDistributor__InvalidDistributionParams('token');
    //     if (amountPerClaim == 0) revert MerkleDistributor__InvalidDistributionParams('amountPerClaim');
    //     if (whitelistCount == 0) revert MerkleDistributor__InvalidDistributionParams('whitelistCount');
    //     if (endTime <= block.timestamp) revert MerkleDistributor__InvalidDistributionParams('endTime');

    //     // Deposit total amount of tokens to this contract
    //     IERC20(token).safeTransferFrom(msg.sender, address(this), amountPerClaim * whitelistCount);

    //     // Create a new distribution
    //     distributions.push();
    //     Distribution storage distribution = distributions[distributions.length - 1];
    //     distribution.token = token;
    //     distribution.amountPerClaim = amountPerClaim;
    //     distribution.whitelistCount = whitelistCount;
    //     // distribution.claimedCount = 0;
    //     distribution.endTime = endTime;
    //     // distribution.refunded = false;
    //     distribution.merkleRoot = merkleRoot;
    //     distribution.title = title;
    //     distribution.owner = msg.sender;
    // }

    // function claim(uint256 distributionId, bytes32[] calldata merkleProof) external {
    //     Distribution storage distribution = distributions[distributionId];

    //     if (distribution.endTime < block.timestamp) revert MerkleDistributor__ClaimWindowFinished();
    //     if (distribution.isClaimed[msg.sender]) revert MerkleDistributor__AlreadyClaimed();

    //     // Verify the merkle proof
    //     if (!MerkleProof.verify(
    //         merkleProof,
    //         distribution.merkleRoot,
    //         keccak256(abi.encodePacked(msg.sender))
    //     )) revert MerkleDistributor__InvalidProof();

    //     // Mark it claimed and send the token
    //     distribution.isClaimed[msg.sender] = true;
    //     distribution.claimedCount += 1;

    //     IERC20(distribution.token).safeTransfer(msg.sender, distribution.amountPerClaim);

    //     emit Claimed(distributionId, msg.sender);
    // }

    // function refund(uint256 distributionId) external onlyOwner(distributionId) {
    //     Distribution storage distribution = distributions[distributionId];
    //     if (block.timestamp < distribution.endTime) revert MerkleDistributor__NoRefundDuringClaim();

    //     uint256 amountLeft = getAmountLeft(distributionId);
    //     if (amountLeft == 0) revert MerkleDistributor__NothingToRefund();

    //     distribution.refunded = true;
    //     IERC20(distribution.token).safeTransfer(distribution.owner, amountLeft);

    //     emit Refunded(distributionId, amountLeft);
    // }

    // // MARK: - Utility functions

    // function isWhitelisted(uint256 distributionId, address wallet, bytes32[] calldata merkleProof) external view returns (bool) {
    //     return MerkleProof.verify(
    //         merkleProof,
    //         distributions[distributionId].merkleRoot,
    //         keccak256(abi.encodePacked(wallet))
    //     );
    // }

    // function isClaimed(uint256 distributionId, address wallet) external view returns (bool) {
    //     return distributions[distributionId].isClaimed[wallet];
    // }

    // function getAmountLeft(uint256 distributionId) public view returns (uint256) {
    //     Distribution storage distribution = distributions[distributionId];

    //     return distribution.amountPerClaim * (distribution.whitelistCount - distribution.claimedCount);
    // }

    // function getAmountClaimed(uint256 distributionId) external view returns (uint256) {
    //     Distribution storage distribution = distributions[distributionId];

    //     return distribution.amountPerClaim * distribution.claimedCount;
    // }
}
