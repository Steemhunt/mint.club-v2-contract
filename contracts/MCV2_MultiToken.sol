// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "./lib/ERC1155Initializable.sol";

contract MCV2_MultiToken is ERC1155Initializable {
    error MCV2_MultiToken__PermissionDenied();

    // ERC1155 spec does not have name and symbol by default, but we add them here for consistency
    string private _name;
    string private _symbol;

    bool private _initialized; // false by default
    address private _bond; // Bonding curve contract should have its minting permission

    function init(string memory name_, string memory symbol_, string memory uri_) external {
        require(_initialized == false, "CONTRACT_ALREADY_INITIALIZED");

        _name = name_;
        _symbol = symbol_;
        _setURI(uri_);
        _bond = _msgSender();
        _initialized = true;
    }

    modifier onlyBond() {
        if (_bond != _msgSender()) revert MCV2_MultiToken__PermissionDenied();
        _;
    }

    /* @dev Mint tokens by bonding curve contract
     * Minting should also provide liquidity to the bonding curve contract
     */
    function mintByBond(address to, uint256 amount) public onlyBond {
        _mint(to, 0, amount, "");
    }

    /* @dev Direct burn function call is disabled because it affects the bonding curve.
     * Users can simply send tokens to the token contract address for the same burning effect without changing the totalSupply.
     */
    function burnByBond(address account, uint256 amount) public onlyBond {
        _burn(account, 0, amount);
    }
}