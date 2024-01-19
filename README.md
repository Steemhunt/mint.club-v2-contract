![image](https://github.com/Steemhunt/mint.club-v2-contract/assets/1332279/66ce69bd-7ebd-4d58-b064-f82053b51b5a)

# Mint Club V2
## Overview
Mint Club is a bonding curve-based token (ERC20, ERC1155) creation and trading protocol. Users can create an asset with a custom bonding curve on top of any existing ERC20 token as collateral. By using a bonding curve, the new asset is immediately tradable without the need for liquidity creation on DEXs or CEXs.
- Docs: https://docs.mint.club (V2 documentaion is in progress)
- Demo Video: https://www.youtube.com/watch?v=BR_MJozU-DU

## Security Audit
- TODO: Add CertiK Emblem
- [Audit Report by CertiK](https://github.com/Steemhunt/mint.club-v2-contract/blob/main/security-audits/CertiK-20240118.pdf)
- [Skynet Monitoring](https://skynet.certik.com/ko/projects/mint-club)

## Key features
1. **Token Creation (ERC20 or ERC1155)**
   * Create a bonding curve token (ERC20) or NFT (ERC1155) by using another ERC20 token as the base asset for your token's bonding curve pool.
   * Choose from curve types such as linear, exponential, or flat line, and adjust the price variation intervals for your token's journey.
   * Set key token specifications like starting price, free minting allocation, maximum price, and supply.
   * Deploy your asset on various Layer 1 and 2 networks.

2. **Buy (= Mint) and Sell (= Burn) Bonding Curve Asset**
   * When a bonding curve token is bought, the price curve determines the amount of the base token to be paid, enabling a swap. The paid base tokens are stored in the bonding curve pool, and an equivalent amount of the bonding curve tokens is minted to the buyer.
   * Conversely, when a bonding curve token is sold, the curve calculates the amount of base tokens to be returned. These base tokens are then returned to the seller, and the equivalent bonding curve tokens are burned.

3. **Airdrop Tool**
   * Set up a public or private airdrop for ERC20 or ERC1155 (supports `id = 0` only) tokens.
   * For private airdrops, Mint Club offers a merkleRoot-based whitelist feature.

4. **Lock-up Tool**
   * Create a contract-bound lock-up schedule for ERC20 or ERC1155 (supports `id = 0` only) tokens.
   * Specify the unlock time and recipient address for after the lock-up period is completed.

## Gloals and Objectives
Mint Club aims to provide no-code, yet flexible, token creation tools for web3 creators who want to build their token economy. One of the biggest hurdles in building token economics is providing liquidity in the early stages, but this issue is eliminated with the Mint Club protocol.

## Contract addresses (Private Beta) 📜
🛑 **Do not use these contracts!** Even though these contracts are deployed on the mainnet, they are not meant for production use and are for testing purposes only.
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://etherscan.io">Ethereum</a></th>
         <th><a href="https://optimistic.etherscan.io/">Optimism</a></th>
         <th><a href="https://arbiscan.io">Arbitrum</a></th>
         <th><a href="https://basescan.org">Base</a></th>
         <th><a href="https://bscscan.com">BNB Chain</a></th>
         <th><a href="https://polygonscan.com">Polygon (PoS)</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td colspan="6">0xAa70bC79fD1cB4a6FBA717018351F0C3c64B79Df</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td colspan="6">0x6c61918eECcC306D35247338FDcf025af0f6120A</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td colspan="6">0xc5a076cad94176c2996B32d8466Be1cE757FAa27</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td colspan="6">0x91523b39813F3F4E406ECe406D0bEAaA9dE251fa</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td colspan="6">0xA3dCf3Ca587D9929d540868c924f208726DC9aB6</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td colspan="6">0x3bc6B601196752497a68B2625DB4f2205C3b150b</td>
      </tr>
      <tr>
         <td>MCV1_Wrapper</td>
         <td colspan="6">0x60432191893c4F742205a2C834817a1891feC435 (BNB Chain only)</td>
      </tr>
   </tbody>
</table>

### V1 Contract Wrapper (BSC Mainnet):
- MCV1_Wrapper: [0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89](https://bscscan.com/address/0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89#code)

## Design Choices 📐

### Discrete Bonding Curve (DBC)
Unlike Mint Club V1's linear bonding curve (`y = x` -> `total supply = token price`), the V2 contract uses a custom increasing price step array for the following reasons:
1. Utilizing `y = ax^b` bonding curves is challenging to test because we have to use approximation to calculate the power function of `(_baseN / _baseD) ^ (_expN / _expD)` ([Reference: Banchor's Bonding Curve implementation](https://github.com/relevant-community/bonding-curve/blob/master/contracts/Power.sol))
2. Employing a single bonding curve is hard to customize. Supporting various types of curve functions (e.g., Sigmoid, Logarithm, etc) might be too difficult to implement in Solidity, or even impossible in many cases
3. Therefore, we decided to use an array of price steps (called `BondStep[] { rangeTo, price }`), that is simple to calculate and fully customizable.

#### An example of a price step array:
![image](https://github.com/Steemhunt/mint.club-v2-contract/assets/1332279/51e64fbc-87bd-4bea-a4e0-67d36b416359)

Parameters example:
- stepRanges: [ 1000, 10000, 500000, 1000000, ..., 21000000 ]
- stepPrices: [ 0, 1, 2, 4, ..., 100 ]

### Custom ERC20 Tokens as Reserve Tokens
Some ERC20 tokens incorporate tax or rebasing functionalities, which could lead to unforeseen behaviors in our Bond contract. For instance, a taxed token might result in the undercollateralization of the reserve token, preventing the complete refund of minted tokens from the bond contract. A similar scenario could occur with Rebase Tokens, as they are capable of altering the balance within the Bond contract.

Due to the diverse nature of custom cases, it is impractical for our bond contract to address all of them. Therefore, we have chosen not to handle these cases explicitly. It's important to note that any behavior stemming from the custom ERC20 token is not considered a bug, as it is a consequence of the token's inherent code.

We plan to issue warnings on our official front-end for tokens known to potentially disrupt our bond contract. However, **it's crucial for users to conduct their own research and understand the potential implications of selecting a specific reserve token.**

The same issue applies to the `Locker` and `MerkleDistributor` tools, and appropriate warning messages will be provided on the front-end client.

## Run Tests 🧪
```bash
npx hardhat test
```

### Coverage ☂️
```m
------------------------|----------|----------|----------|----------|----------------|
File                    |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
------------------------|----------|----------|----------|----------|----------------|
 contracts/             |    99.08 |    79.39 |    95.89 |    99.08 |                |
  Locker.sol            |     97.5 |    84.09 |    85.71 |    98.21 |            107 |
  MCV2_Bond.sol         |    99.39 |    83.33 |    96.43 |    99.04 |        351,721 |
  MCV2_MultiToken.sol   |      100 |    58.33 |      100 |      100 |                |
  MCV2_Royalty.sol      |      100 |       85 |      100 |      100 |                |
  MCV2_Token.sol        |      100 |       50 |      100 |      100 |                |
  MCV2_ZapV1.sol        |      100 |    54.55 |      100 |      100 |                |
  MerkleDistributor.sol |    98.39 |    82.81 |    92.31 |    98.81 |            257 |
 contracts/interfaces/  |      100 |      100 |      100 |      100 |                |
  IMintClubBond.sol     |      100 |      100 |      100 |      100 |                |
  IWETH.sol             |      100 |      100 |      100 |      100 |                |
  MCV2_ICommonToken.sol |      100 |      100 |      100 |      100 |                |
------------------------|----------|----------|----------|----------|----------------|
All files               |    99.08 |    79.39 |    95.89 |    99.08 |                |
------------------------|----------|----------|----------|----------|----------------|
```

## Deploy 🚀
```bash
npx hardhat compile && HARDHAT_NETWORK=ethsepolia node scripts/deploy.js
```

## Gas Consumption ⛽️
```m
·---------------------------------------------------|---------------------------|---------------|-----------------------------·
|               Solc version: 0.8.20                ·  Optimizer enabled: true  ·  Runs: 50000  ·  Block limit: 30000000 gas  │
····················································|···························|···············|······························
|  Methods                                                                                                                    │
······················|·····························|·············|·············|···············|···············|··············
|  Contract           ·  Method                     ·  Min        ·  Max        ·  Avg          ·  # calls      ·  usd (avg)  │
······················|·····························|·············|·············|···············|···············|··············
|  Locker             ·  createLockUp               ·     118371  ·     177007  ·       147544  ·           40  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  Locker             ·  unlock                     ·      65465  ·      66722  ·        66024  ·            9  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  burn                       ·      95828  ·     130648  ·       118254  ·           43  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  burnRoyalties              ·          -  ·          -  ·        79831  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  claimRoyalties             ·          -  ·          -  ·        80107  ·            3  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createMultiToken           ·     394070  ·     495607  ·       489206  ·          104  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createToken                ·     299237  ·     521942  ·       495638  ·          146  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  mint                       ·     109458  ·     208974  ·       189745  ·          104  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateBondCreator          ·      26250  ·      29062  ·        28283  ·           15  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateCreationFee          ·      46917  ·      46929  ·        46924  ·            5  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateMaxRoyaltyRange      ·          -  ·          -  ·        29763  ·            2  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateProtocolBeneficiary  ·          -  ·          -  ·        30150  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  safeTransferFrom           ·          -  ·          -  ·        37867  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  setApprovalForAll          ·          -  ·          -  ·        48812  ·           26  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  approve                    ·      48964  ·      49312  ·        49220  ·           36  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  transfer                   ·          -  ·          -  ·        32280  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1         ·  burnToEth                  ·     164215  ·     169230  ·       166723  ·           12  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1         ·  mintWithEth                ·     207024  ·     210787  ·       208906  ·           24  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1         ·  rescueETH                  ·          -  ·          -  ·        34656  ·            2  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  claim                      ·      91708  ·      97812  ·        95785  ·           30  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  createDistribution         ·     140052  ·     203816  ·       188783  ·           69  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  refund                     ·      47602  ·      48912  ·        48257  ·            8  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  approve                    ·          -  ·          -  ·        46634  ·            4  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  transfer                   ·          -  ·          -  ·        54349  ·            4  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestMultiToken     ·  setApprovalForAll          ·      26214  ·      46114  ·        45529  ·           34  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  approve                    ·      24327  ·      46611  ·        46053  ·          169  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  transfer                   ·      34354  ·      51490  ·        50452  ·          117  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  Deployments                                      ·                                           ·  % of limit   ·             │
····················································|·············|·············|···············|···············|··············
|  Locker                                           ·          -  ·          -  ·      1311347  ·        4.4 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Bond                                        ·    4849625  ·    4849649  ·      4849630  ·       16.2 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_MultiToken                                  ·          -  ·          -  ·      1955155  ·        6.5 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Token                                       ·          -  ·          -  ·       858512  ·        2.9 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_ZapV1                                       ·          -  ·          -  ·      1454064  ·        4.8 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MerkleDistributor                                ·          -  ·          -  ·      2030076  ·        6.8 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TaxToken                                         ·          -  ·          -  ·       736527  ·        2.5 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TestMultiToken                                   ·    1380918  ·    1380930  ·      1380924  ·        4.6 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TestToken                                        ·     659419  ·     679683  ·       678180  ·        2.3 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  WETH9                                            ·          -  ·          -  ·       799725  ·        2.7 %  ·          -  │
·---------------------------------------------------|-------------|-------------|---------------|---------------|-------------·
```
