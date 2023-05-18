// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.3;

import "./MintClubTokenV2.sol";

/**
* @title MintClub Token Factory V2
* Create an ERC20 token using proxy pattern to save gas
*/
abstract contract MintClubFactoryV2 {
    error MintClubFactoryV2__MaxSupplyMustBePositive();

    /**
     *  ERC20 Token implementation contract
     *  We use "EIP-1167: Minimal Proxy Contract" in order to save gas cost for each token deployment
     *  REF: https://github.com/optionality/clone-factory
     */
    address public tokenImplementation;

    // Array of all created tokens
    address[] public tokens;

    // Token => Max Supply
    mapping (address => uint256) public maxSupply;

    event TokenCreated(address tokenAddress, string name, string symbol, uint256 maxTokenSupply);

    constructor(address implementation) {
        tokenImplementation = implementation;
    }

    // REF: https://github.com/optionality/clone-factory
    function _createClone(address target) private returns (address result) {
        bytes20 targetBytes = bytes20(target);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            result := create(0, clone, 0x37)
        }
    }

    function createToken(string memory name, string memory symbol, uint256 maxTokenSupply) public returns (address) {
        if (maxTokenSupply == 0) revert MintClubFactoryV2__MaxSupplyMustBePositive();

        address tokenAddress = _createClone(tokenImplementation);
        MintClubTokenV2 newToken = MintClubTokenV2(tokenAddress);
        newToken.init(name, symbol);

        // NOTE: We don't need to check the existence of the token because the collision is almost impossible (one in 2^160)
        tokens.push(tokenAddress);
        maxSupply[tokenAddress] = maxTokenSupply;

        emit TokenCreated(tokenAddress, name, symbol, maxTokenSupply);

        return tokenAddress;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address tokenAddress) external view returns (bool) {
        return maxSupply[tokenAddress] > 0;
    }
}
