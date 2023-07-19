// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleDistributor {
    error ClaimWindowFinished();
    error AlreadyClaimed();
    error InvalidProof();
    error EndTimeInPast();
    error NoWithdrawDuringClaim();

    event Withdrawn(uint256 distributionId, uint256 amount);
    event Claimed(uint256 distributionId, uint256 index, address account, uint256 amount);

    struct Distribution {
        address token;
        bytes32 merkleRoot; // 192 bits
        uint64 endTime;
        address owner; // 224 bits
        mapping(uint256 => uint256) claimedBitMap;
    }

    Distribution[] public distributions;

    modifier onlyOwner(uint256 distributionId) {
        require(msg.sender == distributions[distributionId].owner, "Not the owner");
        _;
    }

    function createDistribution(address token_, bytes32 merkleRoot_, uint64 endTime_) external {
        if (endTime_ <= block.timestamp) revert EndTimeInPast();

        distributions.push();
        Distribution storage distribution = distributions[distributions.length - 1];

        distribution.token = token_;
        distribution.merkleRoot = merkleRoot_;
        distribution.endTime = endTime_;
        distribution.owner = msg.sender;
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

        if (block.timestamp > distribution.endTime) revert ClaimWindowFinished();
        if (isClaimed(distributionId, index)) revert AlreadyClaimed();

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        if (!MerkleProof.verify(merkleProof, distribution.merkleRoot, node)) revert InvalidProof();

        // Mark it claimed and send the token.
        _setClaimed(distributionId, index);
        IERC20(distribution.token).transfer(account, amount);

        emit Claimed(distributionId, index, account, amount);
    }

    function withdraw(uint256 distributionId) external onlyOwner(distributionId) {
        Distribution storage distribution = distributions[distributionId];

        if (block.timestamp < distribution.endTime) revert NoWithdrawDuringClaim();

        uint256 balance = IERC20(distribution.token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        IERC20(distribution.token).transfer(distribution.owner, balance);

        emit Withdrawn(distributionId, balance);
    }
}