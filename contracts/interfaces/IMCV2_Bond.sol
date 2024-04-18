// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

interface IMCV2_Bond {
    function creationFee() external view returns (uint256);

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
