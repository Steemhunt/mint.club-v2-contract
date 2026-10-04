// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

contract BlastReportingMock {
    function configure(uint8) external pure returns (uint256) {
        return 0;
    }

    function configureClaimableGas() external pure {}

    function readClaimableYield(address) external pure returns (uint256) {
        return 7;
    }

    function readGasParams(address) external pure returns (uint256, uint256, uint256, uint8) {
        return (99, 200, 44, 1);
    }
}
