// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

interface IWETH {
    function deposit() external payable;
    function withdraw(uint) external;
    function approve(address, uint) external returns (bool);
    function balanceOf(address) external view returns (uint);
}
