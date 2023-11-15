// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TaxToken is ERC20 {
    address public immutable fund;

    constructor(uint256 initialSupply) ERC20("TaxToken", "TAXT") {
        fund = msg.sender;
        _mint(msg.sender, initialSupply);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        uint tax = (value * 1000) / 10000; // 10% tax

        super._update(from, to, value - tax);
        super._update(from, fund, tax);
    }
}
