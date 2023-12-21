# Mint Club V2
## Overview
Mint Club is a bonding curve-based token (ERC20, ERC1155) creation and trading protocol. Users can create an asset with a custom bonding curve on top of any existing ERC20 token as collateral. By using a bonding curve, the new asset is immediately tradable without the need for liquidity creation on DEXs or CEXs.
- Docs: https://docs.mint.club (V2 documentaion is in progress)
- Demo Video: https://www.youtube.com/watch?v=BR_MJozU-DU

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
   * Set up a public or private airdrop for ERC20 or ERC1155 tokens created on Mint Club V2.
   * For private airdrops, Mint Club offers a merkleRoot-based whitelist feature.

4. **Lock-up Tool**
   * Create a contract-bound lock-up schedule for ERC20 or ERC1155 tokens created on Mint Club V2.
   * Specify the unlock time and recipient address for after the lock-up period is completed.

## Gloals and Objectives
Mint Club aims to provide no-code, yet flexible, token creation tools for web3 creators who want to build their token economy. One of the biggest hurdles in building token economics is providing liquidity in the early stages, but this issue is eliminated with the Mint Club protocol.

## Contract addresses 📜
### Ethereum Sepolia Testnet
- MCV2_Token: [0xAbd0087147958a164BCb41e7aD8Ee4a4af57b4a2](https://sepolia.etherscan.io/address/0xAbd0087147958a164BCb41e7aD8Ee4a4af57b4a2#code)
- MCV2_MultiToken: [0xCFe883f228822214fC82868Cd5d4Cf6Df72699b2](https://sepolia.etherscan.io/address/0xCFe883f228822214fC82868Cd5d4Cf6Df72699b2#code)
- MCV2_Bond: [0x81d60F3d5dB8586E09d20a96fAFB8437A79D8d94](https://sepolia.etherscan.io/address/0x81d60F3d5dB8586E09d20a96fAFB8437A79D8d94#code)
- Locker: [0xD77AeD25FC2CE8F425c9a0d65c823EdA32531d1d](https://sepolia.etherscan.io/address/0xD77AeD25FC2CE8F425c9a0d65c823EdA32531d1d#code)
- MerkleDistributor: [0x2c386c3711eF9548d43b6A332e8AAce60AF04Fc5](https://sepolia.etherscan.io/address/0x2c386c3711eF9548d43b6A332e8AAce60AF04Fc5#code)

### V1 Contract Wrapper (BSC Mainnet):
- MCV1_Wrapper: [0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89](https://bscscan.com/address/0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89#code)

## Design Choices 📐

### Discrete Bonding Curve (DBC)
Unlike Mint Club V1's linear bonding curve (`y = x` -> `total supply = token price`), the V2 contract uses a custom increasing price step array for the following reasons:
1. Utilizing `y = ax^b` bonding curves is challenging to test because we have to use approximation to calculate the power function of `(_baseN / _baseD) ^ (_expN / _expD)` ([Reference: Banchor's Bonding Curve implementation](https://github.com/relevant-community/bonding-curve/blob/master/contracts/Power.sol))
2. Employing a single bonding curve is hard to customize. Supporting various types of curve functions (e.g., Sigmoid, Logarithm, etc) might be too difficult to implement in Solidity, or even impossible in many cases
3. Therefore, we decided to use an array of price steps (called `BondStep[] { rangeTo, price }`), that is simple to calculate and fully customizable.

#### An example of a price step array:
![image](https://i.imgur.com/FVhTsk4.png)

Parameters example:
- stepRanges: [ 1000, 10000, 500000, 1000000, ..., 21000000 ]
- stepPrices: [ 0, 1, 2, 4, ..., 100 ]

### Custom ERC20 Tokens as Reserve Tokens
Some ERC20 tokens incorporate tax or rebasing functionalities, which could lead to unforeseen behaviors in our Bond contract. For instance, a taxed token might result in the undercollateralization of the reserve token, preventing the complete refund of minted tokens from the bond contract. A similar scenario could occur with Rebase Tokens, as they are capable of altering the balance within the Bond contract.

Due to the diverse nature of custom cases, it is impractical for our bond contract to address all of them. Therefore, we have chosen not to handle these cases explicitly. It's important to note that any behavior stemming from the custom ERC20 token is not considered a bug, as it is a consequence of the token's inherent code.

We plan to issue warnings on our official front-end for tokens known to potentially disrupt our bond contract. However, **it's crucial for users to conduct their own research and understand the potential implications of selecting a specific reserve token.**

## Run Tests 🧪
```bash
npx hardhat test
```

### Coverage ☂️
```m
------------------------|----------|----------|----------|----------|----------------|
File                    |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
------------------------|----------|----------|----------|----------|----------------|
 contracts/             |    98.88 |    88.99 |    95.31 |    98.92 |                |
  Locker.sol            |    97.37 |    97.22 |    85.71 |    98.15 |             83 |
  MCV2_Bond.sol         |    99.32 |    91.35 |    96.43 |    98.95 |        268,546 |
  MCV2_MultiToken.sol   |      100 |    58.33 |      100 |      100 |                |
  MCV2_Royalty.sol      |      100 |    83.33 |      100 |      100 |                |
  MCV2_Token.sol        |      100 |       50 |      100 |      100 |                |
  MerkleDistributor.sol |    98.28 |    92.31 |    92.31 |    98.75 |            182 |
 contracts/lib/         |      100 |      100 |      100 |      100 |                |
  IMintClubBond.sol     |      100 |      100 |      100 |      100 |                |
  MCV2_ICommonToken.sol |      100 |      100 |      100 |      100 |                |
------------------------|----------|----------|----------|----------|----------------|
All files               |    98.88 |    88.99 |    95.31 |    98.92 |                |
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
|  MCV2_Bond          ·  burn                       ·      94980  ·     129799  ·       117407  ·           43  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  burnRoyalties              ·          -  ·          -  ·        79820  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  claimRoyalties             ·          -  ·          -  ·        80096  ·            3  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createMultiToken           ·     391207  ·     490467  ·       485231  ·           88  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createToken                ·     296396  ·     519077  ·       502653  ·          129  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  mint                       ·     108561  ·     208077  ·       189807  ·          100  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateBondCreator          ·      26272  ·      29084  ·        28305  ·           15  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateCreationFee          ·      46873  ·      46885  ·        46880  ·            5  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateProtocolBeneficiary  ·          -  ·          -  ·        30049  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateTokenMetaData        ·      39934  ·     118835  ·       106696  ·           13  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  safeTransferFrom           ·          -  ·          -  ·        37867  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  setApprovalForAll          ·          -  ·          -  ·        48812  ·           20  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  approve                    ·      48964  ·      49312  ·        49202  ·           30  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  transfer                   ·          -  ·          -  ·        32280  ·            1  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  claim                      ·      91708  ·      97812  ·        95785  ·           30  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  createDistribution         ·     140040  ·     203810  ·       188773  ·           69  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  refund                     ·      47602  ·      48912  ·        48257  ·            8  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  approve                    ·          -  ·          -  ·        46634  ·            4  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  transfer                   ·          -  ·          -  ·        54349  ·            4  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestMultiToken     ·  setApprovalForAll          ·      26214  ·      46114  ·        45529  ·           34  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  approve                    ·      24327  ·      46611  ·        46050  ·          167  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  transfer                   ·      34354  ·      51490  ·        50476  ·          115  ·          -  │
······················|·····························|·············|·············|···············|···············|··············
|  Deployments                                      ·                                           ·  % of limit   ·             │
····················································|·············|·············|···············|···············|··············
|  Locker                                           ·          -  ·          -  ·      1311359  ·        4.4 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Bond                                        ·    4965034  ·    4965058  ·      4965042  ·       16.6 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_MultiToken                                  ·          -  ·          -  ·      1955155  ·        6.5 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Token                                       ·          -  ·          -  ·       858512  ·        2.9 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  MerkleDistributor                                ·          -  ·          -  ·      2027907  ·        6.8 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TaxToken                                         ·          -  ·          -  ·       736527  ·        2.5 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TestMultiToken                                   ·    1380918  ·    1380930  ·      1380924  ·        4.6 %  ·          -  │
····················································|·············|·············|···············|···············|··············
|  TestToken                                        ·     659419  ·     679683  ·       678180  ·        2.3 %  ·          -  │
·---------------------------------------------------|-------------|-------------|---------------|---------------|-------------·
```
