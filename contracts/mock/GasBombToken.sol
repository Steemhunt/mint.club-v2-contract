// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title GasBombToken
 * @dev Malicious token that consumes excessive gas in metadata functions
 * Used for testing DoS protection in view functions
 */
contract GasBombToken is ERC20 {
    constructor() ERC20("GasBomb", "BOMB") {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }

    /**
     * @dev Gas bomb symbol function - consumes excessive gas
     */
    function symbol() public pure override returns (string memory) {
        // Consume excessive gas with a loop
        uint256 gasWaste = 0;
        for (uint256 i = 0; i < 50000; i++) {
            gasWaste += i * i;
        }
        return "BOMB";
    }

    /**
     * @dev Gas bomb name function - consumes excessive gas
     */
    function name() public pure override returns (string memory) {
        // Consume excessive gas with a loop
        uint256 gasWaste = 0;
        for (uint256 i = 0; i < 50000; i++) {
            gasWaste += i * i * i;
        }
        return "Gas Bomb Token";
    }

    /**
     * @dev Gas bomb decimals function - consumes excessive gas
     */
    function decimals() public pure override returns (uint8) {
        // Consume excessive gas with a loop
        uint256 gasWaste = 0;
        for (uint256 i = 0; i < 30000; i++) {
            gasWaste += i * i;
        }
        return 18;
    }
}
