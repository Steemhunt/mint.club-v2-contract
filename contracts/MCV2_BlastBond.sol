// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {MCV2_Bond} from "./MCV2_Bond.sol";

enum YieldMode {
  AUTOMATIC,
  VOID,
  CLAIMABLE
}

interface IERC20Rebasing {
  // changes the yield mode of the caller and update the balance
  // to reflect the configuration
  function configure(YieldMode) external returns (uint256);
  // "claimable" yield mode accounts can call this this claim their yield
  // to another address
  function claim(address recipient, uint256 amount) external returns (uint256);
  // read the claimable amount for an account
  function getClaimableAmount(address account) external view returns (uint256);
}

interface IBlast {
  // Note: the full interface for IBlast can be found below
  function configureClaimableGas() external;
  function readClaimableYield(address contractAddress) external view returns (uint256);
  function claimAllGas(address contractAddress, address recipient) external returns (uint256);
}

contract MCV2_BlastBond is MCV2_Bond {
  // NOTE: these addresses differ on the Blast mainnet and testnet; the lines below are the mainnet addresses
  IERC20Rebasing public constant USDB = IERC20Rebasing(0x4300000000000000000000000000000000000003); // Mainnet USDB
  IERC20Rebasing public constant WETH = IERC20Rebasing(0x4300000000000000000000000000000000000004); // Mainnet WETH
  IBlast public constant BLAST = IBlast(0x4300000000000000000000000000000000000002);

  constructor(
    address tokenImplementation,
    address multiTokenImplementation,
    address protocolBeneficiary_,
    uint256 creationFee_,
    uint256 maxSteps
  ) MCV2_Bond(tokenImplementation, multiTokenImplementation, protocolBeneficiary_, creationFee_, maxSteps) {
    USDB.configure(YieldMode.CLAIMABLE); //configure claimable yield for USDB
    WETH.configure(YieldMode.CLAIMABLE); //configure claimable yield for WETH

    BLAST.configureClaimableGas();
  }

  function getClaimableYield(address tokenAddress) external view returns (uint256) {
    return IERC20Rebasing(tokenAddress).getClaimableAmount(address(this));
  }

  function claimYield(address tokenAddress, address recipient) external onlyOwner returns (uint256 claimAmount) {
    IERC20Rebasing token = IERC20Rebasing(tokenAddress);
    claimAmount = token.getClaimableAmount(address(this));
    token.claim(recipient, claimAmount);
  }

  function getClaimableGas() external view returns (uint256) {
    return BLAST.readClaimableYield(address(this));
  }

  function claimGas(address recipient) external onlyOwner returns (uint256) {
    return BLAST.claimAllGas(address(this), recipient);
  }
}
