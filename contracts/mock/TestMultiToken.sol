// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract TestMultiToken is ERC1155 {
    // ERC1155 spec does not include a name and symbol by default, but we have added them here for consistency.
    string public name;
    string public symbol;

    constructor(uint256 initialSupply) ERC1155("https://hunt.town/token.json") {
        _mint(msg.sender, 0, initialSupply, "");

        name = "Test Multi Token";
        symbol = "TEST_MULTI";
    }

    /**
     * @dev Added to support a common interface with ERC20
     */
    function decimals() public pure returns (uint8) {
        return 0;
    }
}
