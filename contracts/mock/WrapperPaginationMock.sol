// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

contract WrapperPaginationMock {
    uint256 private immutable _tokenCount;

    constructor(uint256 tokenCount_) {
        _tokenCount = tokenCount_;
    }

    function tokenCount() external view returns (uint256) {
        return _tokenCount;
    }
}
