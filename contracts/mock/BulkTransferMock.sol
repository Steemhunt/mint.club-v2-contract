// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {TestToken} from "./TestToken.sol";

contract BulkTransferMock is TestToken {
    bool private immutable _omitReturn;
    address private immutable _failedRecipient;

    constructor(bool omitReturn, address failedRecipient)
        TestToken(1000, "Bulk Transfer Mock", "BULK", 18)
    {
        _omitReturn = omitReturn;
        _failedRecipient = failedRecipient;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (to == _failedRecipient) return false;
        bool success = super.transferFrom(from, to, amount);
        if (_omitReturn) {
            assembly { return(0, 0) }
        }
        return success;
    }
}
