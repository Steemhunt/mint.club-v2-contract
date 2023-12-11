// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {ERC20Initializable} from "./lib/ERC20Initializable.sol";

/**
 * @title MCV2_Token
 * @dev A token contract that implements a bonding curve and allows minting and burning of tokens.
 */
contract MCV2_Token is ERC20Initializable {
    error MCV2_Token__AlreadyInitialized();
    error MCV2_Token__PermissionDenied();

    bool private _initialized; // false by default
    address public bond; // Bonding curve contract should have its minting permission

    /**
     * @dev Initializes the token contract with the provided name and symbol.
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function init(string calldata name_, string calldata symbol_) external {
        if(_initialized) revert MCV2_Token__AlreadyInitialized();
        _initialized = true;

        _name = name_;
        _symbol = symbol_;
        bond = _msgSender();
    }

    modifier onlyBond() {
        if (bond != _msgSender()) revert MCV2_Token__PermissionDenied();
        _;
    }

    /**
     * @dev Mint tokens by the bonding curve contract.
     * Minting should also provide liquidity to the bonding curve contract.
     * @param to The address to which the minted tokens will be transferred.
     * @param amount The amount of tokens to mint.
     */
    function mintByBond(address to, uint256 amount) external onlyBond {
        _mint(to, amount);
    }

    /**
     * @dev Burns tokens by the bonding curve contract.
     * Burning tokens affects the bonding curve.
     * Users can simply send tokens to the token contract address for the same burning effect without changing the totalSupply.
     * @param account The address from which the tokens will be burned.
     * @param amount The amount of tokens to burn.
     */
    function burnByBond(address account, uint256 amount) external onlyBond {
        _spendAllowance(account, bond, amount); // `msg.sender` is always `bond`
        _burn(account, amount);
    }
}