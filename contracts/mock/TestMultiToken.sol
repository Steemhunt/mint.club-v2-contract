// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract TestMultiToken is ERC1155 {
    constructor(uint256 initialSupply) ERC1155("https://hunt.town/token.json") {
        _mint(msg.sender, 0, initialSupply, "");
    }
}