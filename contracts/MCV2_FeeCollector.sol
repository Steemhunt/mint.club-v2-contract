// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract MCV2_FeeCollector {
    uint256 internal constant PROTOCOL_FEE = 10; // 0.1%
    address private protocolBeneficiary;

    // User => Token => Fee Balance
    mapping(address => mapping(address => uint256)) public userTokenFeeBalance;

    constructor(address protocolBeneficiary_) {
        protocolBeneficiary = protocolBeneficiary_;
    }

    function addFee(address tokenAddress, address walletAddress, uint256 amount) internal {
        userTokenFeeBalance[walletAddress][tokenAddress] += amount;
    }
}