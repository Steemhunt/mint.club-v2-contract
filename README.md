# Mint Club V2
The inherited token creator employs a bonding curve to generate new tokens using base tokens as collateral

## Contract addresses 📜
### Ethereum Sepolia Testnet
- MCV2_Token: [0xAbd0087147958a164BCb41e7aD8Ee4a4af57b4a2](https://sepolia.etherscan.io/address/0xAbd0087147958a164BCb41e7aD8Ee4a4af57b4a2#code)
- MCV2_MultiToken: [0xCFe883f228822214fC82868Cd5d4Cf6Df72699b2](https://sepolia.etherscan.io/address/0xCFe883f228822214fC82868Cd5d4Cf6Df72699b2#code)
- MCV2_Bond: [0x81d60F3d5dB8586E09d20a96fAFB8437A79D8d94](https://sepolia.etherscan.io/address/0x81d60F3d5dB8586E09d20a96fAFB8437A79D8d94#code)
- Locker: [0xD77AeD25FC2CE8F425c9a0d65c823EdA32531d1d](https://sepolia.etherscan.io/address/0xD77AeD25FC2CE8F425c9a0d65c823EdA32531d1d#code)
- MerkleDistributor: [0x94792B59D2f1a9051Af2c27482FfB095eE4ba084](https://sepolia.etherscan.io/address/0x94792B59D2f1a9051Af2c27482FfB095eE4ba084#code)

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
|  Methods                                          ·                15 gwei/gas                ·       2238.82 usd/eth       │
······················|·····························|·············|·············|···············|···············|··············
|  Contract           ·  Method                     ·  Min        ·  Max        ·  Avg          ·  # calls      ·  usd (avg)  │
······················|·····························|·············|·············|···············|···············|··············
|  Locker             ·  createLockUp               ·     118348  ·     176984  ·       147521  ·           40  ·       4.95  │
······················|·····························|·············|·············|···············|···············|··············
|  Locker             ·  unlock                     ·      65465  ·      66722  ·        66024  ·            9  ·       2.22  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  burn                       ·      94940  ·     129759  ·       117789  ·           42  ·       3.96  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  burnRoyalties              ·          -  ·          -  ·        79820  ·            1  ·       2.68  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  claimRoyalties             ·          -  ·          -  ·        80096  ·            3  ·       2.69  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createMultiToken           ·     389126  ·     490329  ·       485037  ·           88  ·      16.29  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  createToken                ·     293212  ·     522446  ·       507661  ·          119  ·      17.05  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  mint                       ·     108597  ·     208639  ·       190941  ·           98  ·       6.41  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateBondCreator          ·      26227  ·      29039  ·        28260  ·           15  ·       0.95  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateProtocolBeneficiary  ·          -  ·          -  ·        28995  ·            1  ·       0.97  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Bond          ·  updateTokenMetaData        ·      39934  ·     118836  ·       106697  ·           13  ·       3.58  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  safeTransferFrom           ·          -  ·          -  ·        37867  ·            1  ·       1.27  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_MultiToken    ·  setApprovalForAll          ·          -  ·          -  ·        48812  ·           20  ·       1.64  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  approve                    ·      49012  ·      49312  ·        49210  ·           29  ·       1.65  │
······················|·····························|·············|·············|···············|···············|··············
|  MCV2_Token         ·  transfer                   ·          -  ·          -  ·        32280  ·            1  ·       1.08  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  claim                      ·      91728  ·      97832  ·        95802  ·           30  ·       3.22  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  createDistribution         ·     140040  ·     203810  ·       188389  ·           67  ·       6.33  │
······················|·····························|·············|·············|···············|···············|··············
|  MerkleDistributor  ·  refund                     ·      47640  ·      48950  ·        48295  ·            6  ·       1.62  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  approve                    ·          -  ·          -  ·        46634  ·            4  ·       1.57  │
······················|·····························|·············|·············|···············|···············|··············
|  TaxToken           ·  transfer                   ·          -  ·          -  ·        54349  ·            4  ·       1.83  │
······················|·····························|·············|·············|···············|···············|··············
|  TestMultiToken     ·  setApprovalForAll          ·      26214  ·      46114  ·        45511  ·           33  ·       1.53  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  approve                    ·      24327  ·      46611  ·        46046  ·          164  ·       1.55  │
······················|·····························|·············|·············|···············|···············|··············
|  TestToken          ·  transfer                   ·      34354  ·      51490  ·        50459  ·          113  ·       1.69  │
······················|·····························|·············|·············|···············|···············|··············
|  Deployments                                      ·                                           ·  % of limit   ·             │
····················································|·············|·············|···············|···············|··············
|  Locker                                           ·          -  ·          -  ·      1251400  ·        4.2 %  ·      42.02  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Bond                                        ·    4713102  ·    4713126  ·      4713110  ·       15.7 %  ·     158.28  │
····················································|·············|·············|···············|···············|··············
|  MCV2_MultiToken                                  ·          -  ·          -  ·      1965461  ·        6.6 %  ·      66.00  │
····················································|·············|·············|···············|···············|··············
|  MCV2_Token                                       ·          -  ·          -  ·       868864  ·        2.9 %  ·      29.18  │
····················································|·············|·············|···············|···············|··············
|  MerkleDistributor                                ·          -  ·          -  ·      1975319  ·        6.6 %  ·      66.34  │
····················································|·············|·············|···············|···············|··············
|  TaxToken                                         ·          -  ·          -  ·       736527  ·        2.5 %  ·      24.73  │
····················································|·············|·············|···············|···············|··············
|  TestMultiToken                                   ·    1380918  ·    1380930  ·      1380924  ·        4.6 %  ·      46.37  │
····················································|·············|·············|···············|···············|··············
|  TestToken                                        ·     659419  ·     679683  ·       678180  ·        2.3 %  ·      22.77  │
·---------------------------------------------------|-------------|-------------|---------------|---------------|-------------·
```
