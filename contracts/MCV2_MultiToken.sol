// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {ERC1155Initializable} from "./lib/ERC1155Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MCV2_MultiToken
 * @dev A multi-token contract that implements the ERC1155 standard.
 */
contract MCV2_MultiToken is ERC1155Initializable {
    error MCV2_MultiToken__AlreadyInitialized();
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

    /**
     * @dev Initializes the contract with the provided name, symbol, and URI.
     * @param name_ The name of the multi-token contract.
     * @param symbol_ The symbol of the multi-token contract.
     * @param uri_ The base URI for token metadata.
     */
    function init(string calldata name_, string calldata symbol_, string calldata uri_) external {
        if(_initialized) revert MCV2_MultiToken__AlreadyInitialized();
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

    /**
     * @dev Mints tokens by the bonding curve contract.
     * Minting should also provide liquidity to the bonding curve contract.
     * @param to The address to which the tokens will be minted.
     * @param amount The amount of tokens to mint.
     */
    function mintByBond(address to, uint256 amount) external onlyBond {
        totalSupply += amount;
        _mint(to, 0, amount, "");
    }

    /**
     * @dev Burns tokens by the bonding curve contract.
     * Users can simply send tokens to the token contract address for the same burning effect without changing the totalSupply.
     * @param account The address from which the tokens will be burned.
     * @param amount The amount of tokens to burn.
     */
    function burnByBond(address account, uint256 amount) external onlyBond {
        if (amount > totalSupply) revert MCV2_MultiToken__BurnAmountExceedsTotalSupply();
        if(!isApprovedForAll(account, bond)) revert MCV2_MultiToken__NotApproved(); // `msg.sender` is always be `_bond`

        unchecked {
            totalSupply -= amount;
        }

        _burn(account, 0, amount);
    }

    /**
     * @dev Added to support a common interface with ERC20
     */
    function decimals() public pure returns (uint8) {
        return 0;
    }

    /**
     * @dev Returns the contract URI for OpenSea compatibility.
     * @return The contract URI.
     */
    function contractURI() external view returns (string memory) {
        return string(abi.encodePacked("https://mint.club/metadata/", Strings.toString(block.chainid), "/", symbol, ".json"));
    }
}
