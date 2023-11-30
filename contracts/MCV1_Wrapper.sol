// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import {IMintClubBond} from "./lib/IMintClubBond.sol";
import {MCV2_ICommonToken} from "./lib/MCV2_ICommonToken.sol";

/**
* @title A wrapper contract for the MintClub V1 Bond contract to provide a common interface for V2 front-end.
*/

contract MCV1_Wrapper {
    error MCV1_Wrapper__TokenNotFound();
    error MCV1_Wrapper__SlippageLimitExceeded();

    address private constant BENEFICIARY = address(0x82CA6d313BffE56E9096b16633dfD414148D66b1);
    IMintClubBond public constant BOND = IMintClubBond(0x8BBac0C7583Cc146244a18863E708bFFbbF19975);
    address public constant MINT_CONTRACT = address(0x1f3Af095CDa17d63cad238358837321e95FC5915);

    modifier _checkBondExists(address token) {
        if(BOND.maxSupply(token) <= 0) revert MCV1_Wrapper__TokenNotFound();
        _;
    }

    function getReserveForToken(address token, uint256 tokensToMint) public view _checkBondExists(token)
        returns (uint256 reserveAmount, uint256 royalty) {

        uint256 totalSupply = MCV2_ICommonToken(token).totalSupply();

        uint256 newTokenSupply = totalSupply + tokensToMint;
        reserveAmount = (newTokenSupply ** 2 - totalSupply ** 2) / (2 * 1e18);
        royalty = reserveAmount * 3 / 1000; // Buy tax of V1 is 0.3%
    }

    function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount) external {
        (uint256 reserveAmount, uint256 royalty) = getReserveForToken(token, tokensToMint);
        uint256 reserveRequired = reserveAmount + royalty;

        if (maxReserveAmount < reserveRequired) revert MCV1_Wrapper__SlippageLimitExceeded();

        BOND.buy(token, reserveRequired, tokensToMint, BENEFICIARY);
    }

    function getRefundForTokens(address token, uint256 tokensToBurn) public view _checkBondExists(token)
        returns (uint256 refundAmount, uint256 royalty) {
        (refundAmount, royalty) = BOND.getBurnRefund(token, tokensToBurn);
    }

    function burn(address token, uint256 tokensToBurn, uint256 minRefund) external {
        BOND.sell(token, tokensToBurn, minRefund, BENEFICIARY);
    }

    // MARK: - Utility functions

    function tokenCount() external view returns(uint256) {
        return BOND.tokenCount();
    }

    struct BondInfo {
        // address creator; // off-chain data
        address token;
        // uint8 decimals; // always 18
        string symbol;
        string name;
        // string logo; // off-chain data
        // string website; // off-chain data
        // uint40 createdAt; // off-chain data
        uint256 currentSupply;
        uint256 maxSupply;
        uint256 currentPrice;
        // address reserveToken; // Always MINT_CONTRACT
        // uint8 reserveDecimals; // Always 18
        // string reserveSymbol; // Always "MINT"
        // string reserveName; // Always "Mint.club"
        uint256 reserveBalance;
    }
    function _getBondInfo(address token) private view returns(BondInfo memory info) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 totalSupply = t.totalSupply();
        // Bond memory bond = tokenBond[token];
        // MetaData memory metaData = tokenMetaData[token];
        // IERC20Metadata r = IERC20Metadata(bond.reserveToken);

        info = BondInfo({
            token: token,
            symbol: t.symbol(),
            name: t.name(),
            currentSupply: totalSupply,
            maxSupply: BOND.maxSupply(token),
            currentPrice: totalSupply,
            reserveBalance: BOND.reserveBalance(token)
        });
    }

    // Get all tokens and their bond parameters in the range where start <= id < stop
    function getList(uint256 start, uint256 stop) external view returns(BondInfo[] memory info) {
        unchecked {
            uint256 tokensLength = BOND.tokenCount();
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 arrayLength = stop - start;
            info = new BondInfo[](arrayLength);

            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                info[j++] = _getBondInfo(BOND.tokens(i));
            }
        }
    }

    struct BondDetail {
        // uint16 royalty; // V1 has different buy and sell royalties
        uint16 buyRoyalty;
        uint16 sellRoyalty;
        BondInfo info;
        // BondStep[] steps;
    }
    function getDetail(address token) external view returns(BondDetail memory detail) {
        detail = BondDetail({
            buyRoyalty: 30, // 0.3%
            sellRoyalty: 130, // 1.3%
            info: _getBondInfo(token)
        });
    }
}