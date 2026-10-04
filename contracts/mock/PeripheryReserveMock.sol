// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {TestToken} from "./TestToken.sol";

contract PeripheryReserveMock is TestToken {
    bool private immutable _omitReturn;
    bool private immutable _failTransfer;

    constructor(bool omitReturn, bool failTransfer)
        TestToken(1000, "Periphery Reserve Mock", "RESERVE", 18)
    {
        _omitReturn = omitReturn;
        _failTransfer = failTransfer;
    }

    function approve(address spender, uint256 value) public override returns (bool) {
        require(value == 0 || allowance(msg.sender, spender) == 0, "Reset allowance first");
        bool success = super.approve(spender, value);
        if (_omitReturn) {
            assembly { return(0, 0) }
        }
        return success;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (_failTransfer) return false;
        bool success = super.transfer(to, value);
        if (_omitReturn) {
            assembly { return(0, 0) }
        }
        return success;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool success = super.transferFrom(from, to, value);
        if (_omitReturn) {
            assembly { return(0, 0) }
        }
        return success;
    }
}
