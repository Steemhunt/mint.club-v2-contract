// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {IMintClubBond} from "./interfaces/IMintClubBond.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";

/**
 * @title A wrapper contract for the MintClub V1 Bond contract to provide a common interface for V2 front-end.
 */
contract MCV1_Wrapper {
    error MCV1_Wrapper__TokenNotFound();
    error MCV1_Wrapper__InvalidPaginationParameters();

    IMintClubBond public constant BOND = IMintClubBond(0x8BBac0C7583Cc146244a18863E708bFFbbF19975);

    /**
     * @dev Modifier to check if the bond exists for a given token.
     * @param token The address of the token.
     */
    modifier _checkBondExists(address token) {
        if(BOND.maxSupply(token) <= 0) revert MCV1_Wrapper__TokenNotFound();
        _;
    }

    /**
     * @dev Get the reserve amount and royalty for a given token and the number of tokens to mint.
     * @param token The address of the token.
     * @param tokensToMint The number of tokens to mint.
     * @return reserveAmount The reserve amount required for minting the tokens.
     * @return royalty The royalty amount for minting the tokens.
     */
    function getReserveForToken(address token, uint256 tokensToMint) public view _checkBondExists(token)
        returns (uint256 reserveAmount, uint256 royalty) {

        uint256 totalSupply = MCV2_ICommonToken(token).totalSupply();

        uint256 newTokenSupply = totalSupply + tokensToMint;
        reserveAmount = (newTokenSupply ** 2 - totalSupply ** 2) / (2 * 1e18);
        royalty = reserveAmount * 3 / 1000; // Buy tax of V1 is 0.3%
    }

    /**
     * @dev Get the refund amount and royalty for a given token and the number of tokens to burn.
     * @param token The address of the token.
     * @param tokensToBurn The number of tokens to burn.
     * @return refundAmount The refund amount for burning the tokens.
     * @return royalty The royalty amount for burning the tokens.
     */
    function getRefundForTokens(address token, uint256 tokensToBurn) external view _checkBondExists(token)
        returns (uint256 refundAmount, uint256 royalty) {
        (refundAmount, royalty) = BOND.getBurnRefund(token, tokensToBurn);
    }

    // MARK: - Utility functions

    /**
     * @dev Get the total number of tokens in the MintClub V1 Bond contract.
     * @return The total number of tokens.
     */
    function tokenCount() external view returns(uint256) {
        return BOND.tokenCount();
    }

    /**
     * @dev Get the token address at the specified index in the MintClub V1 Bond contract.
     * @param index The index of the token.
     * @return The address of the token.
     */
    function tokens(uint256 index) external view returns(address) {
        return BOND.tokens(index);
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
        uint256 priceForNextMint;
        // address reserveToken; // Always MINT_CONTRACT
        // uint8 reserveDecimals; // Always 18
        // string reserveSymbol; // Always "MINT"
        // string reserveName; // Always "Mint.club"
        uint256 reserveBalance;
    }

    /**
     * @dev Get the bond information for a given token.
     * @param token The address of the token.
     * @return info The bond information.
     */
    function _getBondInfo(address token) private view returns(BondInfo memory info) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 totalSupply = t.totalSupply();

        info = BondInfo({
            token: token,
            symbol: t.symbol(),
            name: t.name(),
            currentSupply: totalSupply,
            maxSupply: BOND.maxSupply(token),
            priceForNextMint: totalSupply,
            reserveBalance: BOND.reserveBalance(token)
        });
    }

    /**
     * @dev Get the list of bond information for tokens in the specified range.
     * @param start The start index of the tokens.
     * @param stop The stop index of the tokens.
     * @return info The list of bond information.
     */
    function getList(uint256 start, uint256 stop) external view returns(BondInfo[] memory info) {
        if (start >= stop || stop - start > 1000) revert MCV1_Wrapper__InvalidPaginationParameters();

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
        uint16 buyRoyalty;
        uint16 sellRoyalty;
        BondInfo info;
    }

    /**
     * @dev Get the bond detail for a given token.
     * @param token The address of the token.
     * @return detail The bond detail.
     */
    function getDetail(address token) external view returns(BondDetail memory detail) {
        detail = BondDetail({
            buyRoyalty: 30, // 0.3%
            sellRoyalty: 130, // 1.3%
            info: _getBondInfo(token)
        });
    }
}