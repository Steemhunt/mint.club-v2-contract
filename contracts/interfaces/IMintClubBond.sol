// SPDX-License-Identifier: BSD-3-Clause
pragma solidity =0.8.20;

// V1 Bond interface
interface IMintClubBond {
  function buy ( address tokenAddress, uint256 reserveAmount, uint256 minReward, address beneficiary ) external;
  function createAndBuy ( string memory name, string memory symbol, uint256 maxTokenSupply, uint256 reserveAmount, address beneficiary ) external;
  function createToken ( string memory name, string memory symbol, uint256 maxTokenSupply ) external returns ( address );
  function priceForNextMint ( address tokenAddress ) external view returns ( uint256 );
  function defaultBeneficiary (  ) external view returns ( address );
  function exists ( address tokenAddress ) external view returns ( bool );
  function getBurnRefund ( address tokenAddress, uint256 tokenAmount ) external view returns ( uint256, uint256 );
  function getMintReward ( address tokenAddress, uint256 reserveAmount ) external view returns ( uint256, uint256 );
  function maxSupply ( address ) external view returns ( uint256 );
  function owner (  ) external view returns ( address );
  function renounceOwnership (  ) external;
  function reserveBalance ( address ) external view returns ( uint256 );
  function reserveTokenAddress (  ) external view returns ( address );
  function sell ( address tokenAddress, uint256 tokenAmount, uint256 minRefund, address beneficiary ) external;
  function setDefaultBeneficiary ( address beneficiary ) external;
  function tokenCount (  ) external view returns ( uint256 );
  function tokenImplementation (  ) external view returns ( address );
  function tokens ( uint256 ) external view returns ( address );
  function transferOwnership ( address newOwner ) external;
  function updateTokenImplementation ( address implementation ) external;
}
