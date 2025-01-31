// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

interface IMerkleDistributor {
    function claim(
        uint256 distributionId,
        bytes32[] calldata merkleProof
    ) external;

    function createDistribution(
        address token,
        bool isERC20,
        uint176 amountPerClaim,
        uint40 walletCount,
        uint40 startTime,
        uint40 endTime,
        bytes32 merkleRoot,
        string calldata title,
        string calldata ipfsCID
    ) external;

    function distributionCount() external view returns (uint256);

    function distributions(
        uint256
    )
        external
        view
        returns (
            address token,
            bool isERC20,
            uint40 walletCount,
            uint40 claimedCount,
            uint176 amountPerClaim,
            uint40 startTime,
            uint40 endTime,
            address owner,
            uint40 refundedAt,
            bytes32 merkleRoot,
            string memory title,
            string memory ipfsCID
        );

    function getAmountClaimed(
        uint256 distributionId
    ) external view returns (uint256);

    function getAmountLeft(
        uint256 distributionId
    ) external view returns (uint256);

    function getDistributionIdsByOwner(
        address owner,
        uint256 start,
        uint256 stop
    ) external view returns (uint256[] memory ids);

    function getDistributionIdsByToken(
        address token,
        uint256 start,
        uint256 stop
    ) external view returns (uint256[] memory ids);

    function isClaimed(
        uint256 distributionId,
        address wallet
    ) external view returns (bool);

    function isWhitelistOnly(
        uint256 distributionId
    ) external view returns (bool);

    function isWhitelisted(
        uint256 distributionId,
        address wallet,
        bytes32[] calldata merkleProof
    ) external view returns (bool);

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) external pure returns (bytes4);

    function refund(uint256 distributionId) external;
}
