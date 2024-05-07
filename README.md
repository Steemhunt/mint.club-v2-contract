![image](https://github.com/Steemhunt/mint.club-v2-contract/assets/1332279/66ce69bd-7ebd-4d58-b064-f82053b51b5a)

# Mint Club V2

## Overview 👀

Mint Club is a bonding curve-based token (ERC20, ERC1155) creation and trading protocol. Users can create an asset with a custom bonding curve on top of any existing ERC20 token as collateral. By using a bonding curve, the new asset is immediately tradable without the need for liquidity creation on DEXs or CEXs.

- Docs: https://docs.mint.club (V2 documentaion is in progress)
- Demo Video: https://www.youtube.com/watch?v=BR_MJozU-DU

## Security Audit 🔒

- TODO: Add CertiK Emblem
- [Audit Report by CertiK](https://github.com/Steemhunt/mint.club-v2-contract/blob/main/security-audits/CertiK-20240118.pdf)
- [Skynet Monitoring](https://skynet.certik.com/ko/projects/mint-club)

## Key features 🗝️

1. **Token Creation (ERC20 or ERC1155)**

   - Create a bonding curve token (ERC20) or NFT (ERC1155) by using another ERC20 token as the base asset for your token's bonding curve pool.
   - Choose from curve types such as linear, exponential, or flat line, and adjust the price variation intervals for your token's journey.
   - Set key token specifications like starting price, free minting allocation, maximum price, and supply.
   - Deploy your asset on various Layer 1 and 2 networks.

2. **Buy (= Mint) and Sell (= Burn) Bonding Curve Asset**

   - When a bonding curve token is bought, the price curve determines the amount of the base token to be paid, enabling a swap. The paid base tokens are stored in the bonding curve pool, and an equivalent amount of the bonding curve tokens is minted to the buyer.
   - Conversely, when a bonding curve token is sold, the curve calculates the amount of base tokens to be returned. These base tokens are then returned to the seller, and the equivalent bonding curve tokens are burned.

3. **Airdrop Tool**

   - Set up a public or private airdrop for ERC20 or ERC1155 (supports `id = 0` only) tokens.
   - For private airdrops, Mint Club offers a merkleRoot-based whitelist feature.

4. **Lock-up Tool**
   - Create a contract-bound lock-up schedule for ERC20 or ERC1155 (supports `id = 0` only) tokens.
   - Specify the unlock time and recipient address for after the lock-up period is completed.

## Gloals and Objectives ⛳️

Mint Club aims to provide no-code, yet flexible, token creation tools for web3 creators who want to build their token economy. One of the biggest hurdles in building token economics is providing liquidity in the early stages, but this issue is eliminated with the Mint Club protocol.

## Contract addresses (Beta) 📜

<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://etherscan.io">Ethereum</a></th>
         <th><a href="https://optimistic.etherscan.io">Optimism (L2)</a></th>
         <th><a href="https://arbiscan.io">Arbitrum (L2)</a></th>
         <th><a href="https://basescan.org">Base (L2)</a></th>
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
         <td colspan="6">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</td>
      </tr>
      <tr>
         <td>MCV1_Wrapper</td>
         <td colspan="6">0x60432191893c4F742205a2C834817a1891feC435 (BNB Chain only)</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://blastexplorer.io/">Blast (L2)</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td>0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td>0x5DaE94e149CF2112Ec625D46670047814aA9aC2a</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td>0x621c335b4BD8f2165E120DC70d3AfcAfc6628681</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td>0x06FD26c092Db44E5491abB7cDC580CE24D93030c</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td>0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td>0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://snowtrace.io">Avalanche (C-Chain)</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td>0x5DaE94e149CF2112Ec625D46670047814aA9aC2a</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td>0x621c335b4BD8f2165E120DC70d3AfcAfc6628681</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td>0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td>0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td>0x5b64cECC5cF3E4B1A668Abd895D16BdDC0c77a17</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td>0x841A2bD2fc97DCB865b4Ddb352540148Bad2dB09</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://explorer.degen.tips">Degen Chain</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td>0xaF987E88bf30581F7074E628c894A3FCbf4EE12e</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td>0x91523b39813F3F4E406ECe406D0bEAaA9dE251fa</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td>0x3bc6B601196752497a68B2625DB4f2205C3b150b</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td>0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td>0xF44939c1613143ad587c79602182De7DcF593e33</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td>0x5DaE94e149CF2112Ec625D46670047814aA9aC2a</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://explorer.zora.energy">Zora</a></th>
         <th><a href="https://klaytnscope.com/">Klaytn</a></th>
         <th><a href="https://cyberscan.co/">Cyber</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td colspan="3">0xAa70bC79fD1cB4a6FBA717018351F0C3c64B79Df</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td colspan="3">0x6c61918eECcC306D35247338FDcf025af0f6120A</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td colspan="3">0xc5a076cad94176c2996B32d8466Be1cE757FAa27</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td colspan="3">0x91523b39813F3F4E406ECe406D0bEAaA9dE251fa</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td colspan="3">0xA3dCf3Ca587D9929d540868c924f208726DC9aB6</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td colspan="3">0x3bc6B601196752497a68B2625DB4f2205C3b150b</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://sepolia.etherscan.io">Sepolia Testnet</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td>0x749bA94344521727f55a3007c777FbeB5F52C2Eb</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td>0x3cABE5125C5D8922c5f38c5b779F6E96F563cdc0</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td>0x8dce343A86Aa950d539eeE0e166AFfd0Ef515C0c</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td>0x1Bf3183acc57571BecAea0E238d6C3A4d00633da</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td>0x7c204B1B03A88D24088941068f6DFC809f2fd022</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td>0x0CD940395566d509168977Cf10E5296302efA57A</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://testnet.basescan.org">Base Sepolia Testnet</a></th>
         <th><a href="https://testnet.blastscan.io">Blast Sepolia Testnet</a></th>
         <th><a href="https://testnet.cyberscan.co">Cyber Testnet</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td colspan="3">0x37F540de37afE8bDf6C722d87CB019F30e5E406a</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td colspan="3">0x4bF67e5C9baD43DD89dbe8fCAD3c213C868fe881</td>
      </tr>
      <tr>
         <td>MCV2_Bond / MCV2_BlastBond</td>
         <td colspan="3">0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td colspan="3">0x40c7DC399e01029a51cAb316f8Bca7D20DE31bad</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td colspan="3">0x2c6B3fe4D6de27363cFEC95f703889EaF6b770fB</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td colspan="3">0xCbb23973235feA43E62C41a0c67717a92a2467f2</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://testnet.snowtrace.io">Avalanche Fuji Testnet</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td>0xAD5a113ee65F30269f7558f96483126B1FB60c4E</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td>0xB43826E079dFB2e2b48a0a473Efc7F1fe6391763</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td>0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td>0x60432191893c4F742205a2C834817a1891feC435</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td>0x789771E410527691729e54A84103594ee6Be6C3C</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td>0x6d1f4ecd17ddA7fb39C56Da566b66d63f06671d9</td>
      </tr>
   </tbody>
</table>

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
·-----------------------------------------------------|---------------------------|---------------|-----------------------------·
|                Solc version: 0.8.20                 ·  Optimizer enabled: true  ·  Runs: 50000  ·  Block limit: 30000000 gas  │
······················································|···························|···············|······························
|  Methods                                                                                                                      │
························|·····························|·············|·············|···············|···············|··············
|  Contract             ·  Method                     ·  Min        ·  Max        ·  Avg          ·  # calls      ·  usd (avg)  │
························|·····························|·············|·············|···············|···············|··············
|  Locker               ·  createLockUp               ·     118371  ·     177007  ·       147544  ·           40  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  Locker               ·  unlock                     ·      65465  ·      66722  ·        66024  ·            9  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  burn                       ·      95828  ·     130648  ·       118254  ·           43  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  burnRoyalties              ·          -  ·          -  ·        79831  ·            1  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  claimRoyalties             ·          -  ·          -  ·        80107  ·            3  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  createMultiToken           ·     394070  ·     495595  ·       489204  ·          104  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  createToken                ·     299237  ·     521942  ·       495817  ·          147  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  mint                       ·     109458  ·     208974  ·       189745  ·          104  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  updateBondCreator          ·      26250  ·      29062  ·        28283  ·           15  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  updateCreationFee          ·      46917  ·      46929  ·        46924  ·            5  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  updateMaxRoyaltyRange      ·          -  ·          -  ·        29763  ·            2  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond            ·  updateProtocolBeneficiary  ·          -  ·          -  ·        30050  ·            1  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken      ·  safeTransferFrom           ·          -  ·          -  ·        37867  ·            1  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken      ·  setApprovalForAll          ·          -  ·          -  ·        48812  ·           26  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Token           ·  approve                    ·      48964  ·      49312  ·        49220  ·           36  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_Token           ·  transfer                   ·          -  ·          -  ·        32280  ·            1  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1           ·  burnToEth                  ·     164215  ·     169230  ·       166723  ·           12  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1           ·  mintWithEth                ·     207024  ·     210787  ·       208906  ·           24  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MCV2_ZapV1           ·  rescueETH                  ·          -  ·          -  ·        34679  ·            2  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor    ·  claim                      ·      91708  ·      97812  ·        95785  ·           30  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor    ·  createDistribution         ·     140046  ·     203810  ·       188782  ·           69  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor    ·  refund                     ·      47624  ·      48934  ·        48279  ·            8  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributorV2  ·  claim                      ·      91871  ·     134678  ·        99511  ·           30  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributorV2  ·  createDistribution         ·     209647  ·     260947  ·       215024  ·          711  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributorV2  ·  refund                     ·      47590  ·      48912  ·        48251  ·            8  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributorV2  ·  updateClaimFee             ·          -  ·          -  ·        29724  ·            3  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  MerkleDistributorV2  ·  updateProtocolBeneficiary  ·          -  ·          -  ·        30049  ·            3  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TaxToken             ·  approve                    ·          -  ·          -  ·        46634  ·            4  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TaxToken             ·  transfer                   ·          -  ·          -  ·        54349  ·            4  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TestMultiToken       ·  safeTransferFrom           ·          -  ·          -  ·        52370  ·           28  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TestMultiToken       ·  setApprovalForAll          ·      26214  ·      46114  ·        45798  ·           63  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TestToken            ·  approve                    ·      24327  ·      46611  ·        46154  ·          257  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  TestToken            ·  transfer                   ·      34354  ·      51514  ·        49261  ·          204  ·          -  │
························|·····························|·············|·············|···············|···············|··············
|  Deployments                                        ·                                           ·  % of limit   ·             │
······················································|·············|·············|···············|···············|··············
|  Locker                                             ·          -  ·          -  ·      1311359  ·        4.4 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MCV2_Bond                                          ·    4849157  ·    4849181  ·      4849162  ·       16.2 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MCV2_MultiToken                                    ·          -  ·          -  ·      1955155  ·        6.5 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MCV2_Token                                         ·          -  ·          -  ·       858512  ·        2.9 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MCV2_ZapV1                                         ·    1466694  ·    1466706  ·      1466700  ·        4.9 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MerkleDistributor                                  ·          -  ·          -  ·      2053503  ·        6.8 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  MerkleDistributorV2                                ·          -  ·          -  ·      3173736  ·       10.6 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  TaxToken                                           ·          -  ·          -  ·       736527  ·        2.5 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  TestMultiToken                                     ·    1482000  ·    1482024  ·      1482016  ·        4.9 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  TestToken                                          ·     659419  ·     679719  ·       678799  ·        2.3 %  ·          -  │
······················································|·············|·············|···············|···············|··············
|  WETH9                                              ·          -  ·          -  ·       799725  ·        2.7 %  ·          -  │
·-----------------------------------------------------|-------------|-------------|---------------|---------------|-------------·
```
