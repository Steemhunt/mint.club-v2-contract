// SPDX-License-Identifier: BSD-3-Clause
pragma solidity =0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    uint8 immutable private _decimals;

    constructor(uint256 initialSupply, string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
