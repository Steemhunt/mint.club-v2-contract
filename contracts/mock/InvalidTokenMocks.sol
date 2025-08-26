// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.30;

/**
 * Mock contracts for testing token validation logic in _isTokenTypeValid
 */

// Contract that supports ERC1155 interface but is marked as ERC20 (should be rejected)
contract ERC1155ClaimingToBeERC20 {
    function supportsInterface(
        bytes4 interfaceId
    ) external pure returns (bool) {
        return interfaceId == 0xd9b67a26; // ERC1155 interface id
    }

    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }
}

// Contract that has supportsInterface but returns wrong data format
contract WrongSupportsInterfaceReturn {
    function supportsInterface(
        bytes4
    ) external pure returns (uint256, uint256) {
        return (1, 2); // Wrong return type/length (64 bytes instead of 32)
    }

    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function totalSupply() external pure returns (uint256) {
        return 1000; // Add totalSupply to pass that validation
    }
}

// Contract that reverts on supportsInterface but has valid balanceOf
contract RevertingSupportsInterface {
    function supportsInterface(bytes4) external pure returns (bool) {
        revert("Interface check failed");
    }

    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function totalSupply() external pure returns (uint256) {
        return 1000; // Add totalSupply to pass that validation
    }
}

// Contract that doesn't implement balanceOf at all
contract NoBalanceOf {
    function someOtherFunction() external pure returns (uint256) {
        return 123;
    }
}

// Contract with wrong ERC20 balanceOf signature (missing address parameter)
contract WrongERC20BalanceOfSignature {
    function balanceOf() external pure returns (uint256) {
        return 100;
    }
}

// Contract with wrong ERC1155 balanceOf signature (missing uint256 parameter)
contract WrongERC1155BalanceOfSignature {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }
}

// Contract that returns wrong data length for balanceOf
contract WrongBalanceOfReturnLength {
    function balanceOf(address) external pure returns (uint256, uint256) {
        return (100, 200); // Returns 64 bytes instead of 32
    }

    function balanceOf(
        address,
        uint256
    ) external pure returns (uint256, uint256) {
        return (100, 200); // Returns 64 bytes instead of 32
    }
}

// Contract that reverts on balanceOf calls
contract RevertingBalanceOf {
    function balanceOf(address) external pure returns (uint256) {
        revert("BalanceOf failed");
    }

    function balanceOf(address, uint256) external pure returns (uint256) {
        revert("BalanceOf failed");
    }
}

// Contract that consumes excessive gas (tests METADATA_GAS_STIPEND)
contract GasConsumingContract {
    function balanceOf(address) external pure returns (uint256) {
        // Consume excessive gas to test gas stipend protection
        uint256 sum = 0;
        for (uint256 i = 0; i < 10000; i++) {
            sum += i;
        }
        return sum;
    }

    function balanceOf(address, uint256) external pure returns (uint256) {
        // Consume excessive gas to test gas stipend protection
        uint256 sum = 0;
        for (uint256 i = 0; i < 10000; i++) {
            sum += i;
        }
        return sum;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        // Also consume gas in interface check
        uint256 sum = 0;
        for (uint256 i = 0; i < 10000; i++) {
            sum += i;
        }
        return false;
    }
}

// Contract that returns empty data
contract EmptyReturnData {
    function balanceOf(address) external pure {
        assembly {
            return(0, 0)
        }
    }

    function balanceOf(address, uint256) external pure {
        assembly {
            return(0, 0)
        }
    }
}

// Contract that doesn't implement totalSupply (for staking token validation)
contract NoTotalSupply {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    // Missing totalSupply() function
}

// Contract that reverts on totalSupply calls
contract RevertingTotalSupply {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function totalSupply() external pure returns (uint256) {
        revert("TotalSupply failed");
    }
}

// Contract that returns wrong data length for totalSupply
contract WrongTotalSupplyReturnLength {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function totalSupply() external pure {
        // Return no data at all, which should cause ABI decoding to fail
        assembly {
            return(0, 0)
        }
    }
}

// Contract that doesn't implement decimals (for reward token validation)
contract NoDecimals {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure returns (bool) {
        return true;
    }

    // Missing decimals() function
}

// Contract that reverts on decimals calls
contract RevertingDecimals {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure returns (bool) {
        return true;
    }

    function decimals() external pure returns (uint8) {
        revert("Decimals failed");
    }
}

// Contract that returns wrong data length for decimals
contract WrongDecimalsReturnLength {
    function balanceOf(address) external pure returns (uint256) {
        return 100;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure returns (bool) {
        return true;
    }

    function decimals() external pure {
        // Return no data at all, which should cause ABI decoding to fail
        assembly {
            return(0, 0)
        }
    }
}
