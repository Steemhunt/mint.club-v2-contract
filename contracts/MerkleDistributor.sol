// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleDistributor {
    using SafeERC20 for IERC20;

    error MerkleDistributor__ClaimWindowFinished();
    error MerkleDistributor__AlreadyClaimed();
    error MerkleDistributor__InvalidProof();
    error MerkleDistributor__EndTimeInPast();
    error MerkleDistributor__NoWithdrawDuringClaim();

    event Withdrawn(uint256 distributionId, uint256 amount);
    event Claimed(uint256 distributionId, uint256 index, address account, uint256 amount);

    struct Distribution {
        address token;
        uint96 amountPerClaim; // 160 + 96 = 256 bits
        uint24 whitelistCount;
        uint24 claimedCount;
        uint40 endTime; // supports up to year 36,825
        bool refunded;
        address owner; // 24 + 24 + 40 + 8 + 160 = 256 bits
        bytes32 merkleRoot; // 256 bits

        mapping(uint256 => uint256) claimedBitMap;
    }

    Distribution[] public distributions;

    modifier onlyOwner(uint256 distributionId) {
        require(msg.sender == distributions[distributionId].owner, "Not the owner");
        _;
    }

    function createDistribution(
        address token,
        uint96 amountPerClaim,
        uint24 whitelistCount,
        uint40 endTime,
        bytes32 merkleRoot
    ) external {
        if (endTime <= block.timestamp) revert MerkleDistributor__EndTimeInPast();

        distributions.push();
        Distribution storage distribution = distributions[distributions.length - 1];
        distribution.token = token;
        distribution.amountPerClaim = amountPerClaim;
        distribution.whitelistCount = whitelistCount;
        // distribution.claimedCount = 0;
        distribution.endTime = endTime;
        // distribution.refunded = false;
        distribution.merkleRoot = merkleRoot;
        distribution.owner = msg.sender;

        // TODO: Transfer amountPerClaim * whitelistCount tokens to the contract
    }

    function isClaimed(uint256 distributionId, uint256 index) public view returns (bool) {
        Distribution storage distribution = distributions[distributionId];
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = distribution.claimedBitMap[claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 distributionId, uint256 index) private {
        Distribution storage distribution = distributions[distributionId];
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        distribution.claimedBitMap[claimedWordIndex] = distribution.claimedBitMap[claimedWordIndex] | (1 << claimedBitIndex);
    }

    function claim(uint256 distributionId, uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof) external {
        Distribution storage distribution = distributions[distributionId];

        if (block.timestamp > distribution.endTime) revert MerkleDistributor__ClaimWindowFinished();
        if (isClaimed(distributionId, index)) revert MerkleDistributor__AlreadyClaimed();

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        if (!MerkleProof.verify(merkleProof, distribution.merkleRoot, node)) revert MerkleDistributor__InvalidProof();

        // Mark it claimed and send the token.
        _setClaimed(distributionId, index);
        IERC20(distribution.token).safeTransfer(account, amount);

        emit Claimed(distributionId, index, account, amount);
    }

    function withdraw(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (block.timestamp < distribution.endTime) revert MerkleDistributor__NoWithdrawDuringClaim();

        uint256 balance = IERC20(distribution.token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        IERC20(distribution.token).safeTransfer(distribution.owner, balance);

        emit Withdrawn(distributionId, balance);
    }
}