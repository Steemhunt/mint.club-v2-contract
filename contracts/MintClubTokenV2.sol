// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.3;

import "./lib/ERC20Initializable.sol";

contract MintClubTokenV2 is ERC20Initializable {
    error MintClubTokenV2__PermissionDenied();

    bool private _initialized; // false by default
    address private _bond; // Bonding curve contract should have its minting permission

    function init(string memory name_, string memory symbol_) external {
        require(_initialized == false, "CONTRACT_ALREADY_INITIALIZED");

        _name = name_;
        _symbol = symbol_;
        _bond = _msgSender();

        _initialized = true;
    }

    modifier onlyBond() {
        if (_bond != _msgSender()) revert MintClubTokenV2__PermissionDenied();
        _;
    }

    function mint(address to, uint256 amount) public onlyBond {
        _mint(to, amount);
    }

    /* @dev Direct burn function call is disabled because it affects the bonding curve.
     * Users can simply send tokens to the token contract address for the same burning effect without changing the totalSupply.
     */
    function burnFrom(address account, uint256 amount) public onlyBond {
        _spendAllowance(account, _bond, amount); // `msg.sender` is always be `_bond`
        _burn(account, amount);
    }
}