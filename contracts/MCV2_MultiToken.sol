// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import {ERC1155Initializable} from "./lib/ERC1155Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract MCV2_MultiToken is ERC1155Initializable {
    error MCV2_MultiToken__PermissionDenied();
    error MCV2_MultiToken__BurnAmountExceedsTotalSupply();
    error MCV2_MultiToken__NotApproved();

    // ERC1155 spec does not include a name and symbol by default, but we have added them here for consistency.
    string public name;
    string public symbol;

    // Implement custom totalSupply tracking, since we only need to track the supply for tokenId = 0
    uint256 public totalSupply;

    bool private _initialized; // false by default
    address public bond; // Bonding curve contract should have its minting permission

    function init(string calldata name_, string calldata symbol_, string calldata uri_) external {
        require(_initialized == false, "CONTRACT_ALREADY_INITIALIZED");
        _initialized = true;

        name = name_;
        symbol = symbol_;

        _setURI(uri_);
        bond = _msgSender();
    }

    modifier onlyBond() {
        if (bond != _msgSender()) revert MCV2_MultiToken__PermissionDenied();
        _;
    }

    /* @dev Mint tokens by bonding curve contract
     * Minting should also provide liquidity to the bonding curve contract
     */
    function mintByBond(address to, uint256 amount) public onlyBond {
        totalSupply += amount;
        _mint(to, 0, amount, "");
    }

    /* @dev Direct burn function call is disabled because it affects the bonding curve.
     * Users can simply send tokens to the token contract address for the same burning effect without changing the totalSupply.
     */
    function burnByBond(address account, uint256 amount) public onlyBond {
        if (amount > totalSupply) revert MCV2_MultiToken__BurnAmountExceedsTotalSupply();
        if(!isApprovedForAll(account, bond)) revert MCV2_MultiToken__NotApproved(); // `msg.sender` is always be `_bond`

        unchecked {
            totalSupply -= amount;
        }

        _burn(account, 0, amount);
    }

    // MARK: - Metadata for OpenSea compatibility
    // Ref: https://docs.opensea.io/docs/contract-level-metadata
    function contractURI() external view returns (string memory) {
        return string(abi.encodePacked("https://mint.club/metadata/", Strings.toString(block.chainid), "/", symbol, ".json"));
    }
}
