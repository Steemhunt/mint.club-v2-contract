// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

interface IMCV2_Bond {
    function exists(address token) external view returns (bool);

    function tokenBond(
        address token
    )
        external
        view
        returns (
            address creator,
            uint16 mintRoyalty,
            uint16 burnRoyalty,
            uint40 createdAt,
            address reserveToken,
            uint256 reserveBalance
        );

    struct BondStep {
        uint128 rangeTo;
        uint128 price;
    }

    function getSteps(address token) external view returns (BondStep[] memory);

    function mint(
        address token,
        uint256 tokensToMint,
        uint256 maxReserveAmount,
        address receiver
    ) external returns (uint256);

    function burn(
        address token,
        uint256 tokensToBurn,
        uint256 minRefund,
        address receiver
    ) external returns (uint256);

    function creationFee() external view returns (uint256);

    function getReserveForToken(
        address token,
        uint256 tokensToMint
    ) external view returns (uint256 reserveAmount, uint256 royalty);

    function getRefundForTokens(
        address token,
        uint256 tokensToBurn
    ) external view returns (uint256 refundAmount, uint256 royalty);

    struct MultiTokenParams {
        string name;
        string symbol;
        string uri;
    }

    struct BondParams {
        uint16 mintRoyalty;
        uint16 burnRoyalty;
        address reserveToken;
        uint128 maxSupply;
        uint128[] stepRanges;
        uint128[] stepPrices;
    }

    function createMultiToken(
        MultiTokenParams calldata tp,
        BondParams calldata bp
    ) external payable returns (address);

    function updateBondCreator(address token, address creator) external;
}
