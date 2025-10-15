![image](https://github.com/Steemhunt/mint.club-v2-contract/assets/1332279/66ce69bd-7ebd-4d58-b064-f82053b51b5a)

# Mint Club V2

## Overview 👀

Mint Club is a bonding curve-based token (ERC20, ERC1155) creation and trading protocol. Users can create an asset with a custom bonding curve on top of any existing ERC20 token as collateral. By using a bonding curve, the new asset is immediately tradable without the need for liquidity creation on DEXs or CEXs.

- Docs: https://docs.mint.club (V2 documentaion is in progress)
- Demo Video: https://www.youtube.com/watch?v=BR_MJozU-DU

## Security Audit 🔒

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

## Contract addresses 📜

<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://etherscan.io">Ethereum</a></th>
         <th><a href="https://optimistic.etherscan.io">Optimism</a></th>
         <th><a href="https://arbiscan.io">Arbitrum One</a></th>
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
         <td colspan="6">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</td>
      </tr>
      <tr>
         <td>MCV1_Wrapper</td>
         <td colspan="6">0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724 (BNB Chain only)</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://blastexplorer.io/">Blast</a></th>
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
         <th><a href="https://snowtrace.io">Avalanche (C (C-Chain)-Chain)</a></th>
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
         <th><a href="https://explorer.zora.energy/">Zora</a></th>
         <th><a href="https://kaiascan.io/">Kaia</a></th>
         <th><a href="https://cyberscan.co/">Cyber</a></th>
         <th><a href="https://ham.calderaexplorer.xyz/">Ham</a></th>
         <th><a href="https://apescan.io/">APEChain</a></th>
         <th><a href="https://shibariumscan.io/">Shibarium</a></th>
         <th><a href="https://explorer.hsk.xyz/">HashKey</a></th>
         <th><a href="https://uniscan.xyz/">Unichain</a></th>
         <th><a href="https://scan.over.network/">Over</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td colspan="9">0xAa70bC79fD1cB4a6FBA717018351F0C3c64B79Df</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td colspan="9">0x6c61918eECcC306D35247338FDcf025af0f6120A</td>
      </tr>
      <tr>
         <td>MCV2_Bond</td>
         <td colspan="9">0xc5a076cad94176c2996B32d8466Be1cE757FAa27</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td colspan="9">0x91523b39813F3F4E406ECe406D0bEAaA9dE251fa</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td colspan="9">0xA3dCf3Ca587D9929d540868c924f208726DC9aB6</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td colspan="9">0x3bc6B601196752497a68B2625DB4f2205C3b150b</td>
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
         <th><a href="https://dolphin.view.over.network">Over Testnet</a></th>
         <th><a href="https://puppyscan.shib.io">Shibarium Testnet (Puppynet)</a></th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>MCV2_Token</td>
         <td colspan="5">0x37F540de37afE8bDf6C722d87CB019F30e5E406a</td>
      </tr>
      <tr>
         <td>MCV2_MultiToken</td>
         <td colspan="5">0x4bF67e5C9baD43DD89dbe8fCAD3c213C868fe881</td>
      </tr>
      <tr>
         <td>MCV2_Bond / MCV2_BlastBond</td>
         <td colspan="5">0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d</td>
      </tr>
      <tr>
         <td>MCV2_ZapV1</td>
         <td colspan="5">0x40c7DC399e01029a51cAb316f8Bca7D20DE31bad</td>
      </tr>
      <tr>
         <td>Locker</td>
         <td colspan="5">0x2c6B3fe4D6de27363cFEC95f703889EaF6b770fB</td>
      </tr>
      <tr>
         <td>MerkleDistributor</td>
         <td colspan="5">0xCbb23973235feA43E62C41a0c67717a92a2467f2</td>
      </tr>
   </tbody>
</table>
<table>
   <thead>
      <tr>
         <th>Contract /  Chain</th>
         <th><a href="https://testnet.snowtrace.io">Avalanche Fu (C-Chain)ji Testnet</a></th>
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

### Bulk Sender

<table>
   <thead>
      <tr>
         <th>Chain / Contract</th>
         <th>Contract Address</th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>Ethereum</td>
         <td><a href="https://etherscan.io/address/0x621c335b4BD8f2165E120DC70d3AfcAfc6628681#code">0x621c335b4BD8f2165E120DC70d3AfcAfc6628681</a></td>
      </tr>
      <tr>
         <td>Base</td>
         <td><a href="https://basescan.org/address/0x95BDA90196c4e737933360F4639c46Ace657AAb7#code">0x95BDA90196c4e737933360F4639c46Ace657AAb7</a></td>
      </tr>
      <tr>
         <td>Optimism</td>
         <td><a href="https://optimistic.etherscan.io/address/0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1#code">0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</a></td>
      </tr>
      <tr>
         <td>Arbitrum One</td>
         <td><a href="https://arbiscan.io/address/0x841A2bD2fc97DCB865b4Ddb352540148Bad2dB09#code">0x841A2bD2fc97DCB865b4Ddb352540148Bad2dB09</a></td>
      </tr>
      <tr>
         <td>Polygon (PoS)</td>
         <td><a href="https://polygonscan.com/address/0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724#code">0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724</a></td>
      </tr>
      <tr>
         <td>BNB Chain</td>
         <td><a href="https://bscscan.com/address/0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1#code">0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</a></td>
      </tr>
      <tr>
         <td>Avalanche (C-Chain)</td>
         <td><a href="https://snowtrace.io/address/0x3a8a4BFCC487d0FE9D342B6180bf0323989f251B#code">0x3a8a4BFCC487d0FE9D342B6180bf0323989f251B</a></td>
      </tr>
      <tr>
         <td>Blast</td>
         <td><a href="https://blastexplorer.io/address/0x9a176d09b3824cf50417e348696cBbBc43d7818d#code">0x9a176d09b3824cf50417e348696cBbBc43d7818d</a></td>
      </tr>
      <tr>
         <td>Degen</td>
         <td><a href="https://explorer.degen.tips/address/0x7B09b728ee8c6a714dC3F10367b5DF9b217FE633?tab=contract">0x7B09b728ee8c6a714dC3F10367b5DF9b217FE633</a></td>
      </tr>
      <tr>
         <td>Zora</td>
         <td><a href="https://explorer.zora.energy/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Kaia</td>
         <td><a href="https://kaiascan.io/account/0xa4021a8907197Df92341F1218B32E26b250F6798?tabId=contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Cyber</td>
         <td><a href="https://cyberscan.co/address/0xa4021a8907197Df92341F1218B32E26b250F6798#contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Ham</td>
         <td><a href="https://ham.calderaexplorer.xyz/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=read_contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>APEChain</td>
         <td><a href="https://apescan.io/address/0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4?tab=contract#code">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</a></td>
      </tr>
      <tr>
         <td>Shibarium</td>
         <td><a href="https://www.shibariumscan.io/address/0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4?tab=contract">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</a></td>
      </tr>
      <tr>
         <td>HashKey</td>
         <td><a href="https://explorer.hsk.xyz/address/0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4?tab=contract">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</a></td>
      </tr>
      <tr>
         <td>Unichain</td>
         <td><a href="https://uniscan.xyz/address/0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4?tab=contract">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</a></td>
      </tr>
      <tr>
         <td>Over</td>
         <td><a href="https://scan.over.network/address/0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4?tab=contract">0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4</a></td>
      </tr>
      <tr>
         <td>Sepolia</td>
         <td><a href="https://sepolia.etherscan.io/address/0x7A6995CE649FA025a8792a375510d2B7C3c48581#code">0x7A6995CE649FA025a8792a375510d2B7C3c48581</a></td>
      </tr>
   </tbody>
</table>

### Stake (V1.2)

<table>
   <thead>
      <tr>
         <th>Chain / Contract</th>
         <th>Contract Address</th>
      </tr>
   </thead>
   <tbody>
      <tr>
         <td>Ethereum</td>
         <td><a href="https://etherscan.io/address/0x841A2bD2fc97DCB865b4Ddb352540148Bad2dB09#code">0x841A2bD2fc97DCB865b4Ddb352540148Bad2dB09</a></td>
      </tr>
      <tr>
         <td>Base</td>
         <td>
            <a href="https://basescan.org/address/0x364e0f814a2c5524d26e82937815c574f8bB86C1#code">0x364e0f814a2c5524d26e82937815c574f8bB86C1 (V1.0)</a>
            <a href="https://basescan.org/address/0x3460E2fD6cBC9aFB49BF970659AfDE2909cf3399#code">0x3460E2fD6cBC9aFB49BF970659AfDE2909cf3399 (V1.1)</a>
            <a href="https://basescan.org/address/0x9Ab05EcA10d087f23a1B22A44A714cdbBA76E802#code">0x9Ab05EcA10d087f23a1B22A44A714cdbBA76E802 (V1.2)</a>
         </td>
      </tr>
      <tr>
         <td>Optimism</td>
         <td><a href="https://optimistic.etherscan.io/address/0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65#code">0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65</a></td>
      </tr>
      <tr>
         <td>Arbitrum One</td>
         <td><a href="https://arbiscan.io/address/0xf7e2cDe9E603F15118E6E389cF14f11f19C1afbc#code">0xf7e2cDe9E603F15118E6E389cF14f11f19C1afbc</a></td>
      </tr>
      <tr>
         <td>Polygon (PoS)</td>
         <td>
            <a href="https://polygonscan.com/address/0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65#code">0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65 (V1.1)</a>
            <a href="https://polygonscan.com/address/0x95BDA90196c4e737933360F4639c46Ace657AAb7#code">0x95BDA90196c4e737933360F4639c46Ace657AAb7 (V1.2)</a>
         </td>
      </tr>
      <tr>
         <td>BNB Chain</td>
         <td><a href="https://bscscan.com/address/0x7B09b728ee8c6a714dC3F10367b5DF9b217FE633#code">0x7B09b728ee8c6a714dC3F10367b5DF9b217FE633</a></td>
      </tr>
      <tr>
         <td>Avalanche (C-Chain)</td>
         <td><a href="https://snowtrace.io/address/0x68f54a53d3E69e2191bCF586fB507c81E5353413#code">0x68f54a53d3E69e2191bCF586fB507c81E5353413</a></td>
      </tr>
      <tr>
         <td>Blast</td>
         <td><a href="https://blastexplorer.io/address/0x68f54a53d3E69e2191bCF586fB507c81E5353413#code">0x68f54a53d3E69e2191bCF586fB507c81E5353413</a></td>
      </tr>
      <tr>
         <td>Degen</td>
         <td><a href="https://explorer.degen.tips/address/0x5FBdC7941a735685eB08c51776bA77098ebe1eb7?tab=contract">0x5FBdC7941a735685eB08c51776bA77098ebe1eb7</a></td>
      </tr>
      <tr>
         <td>Zora</td>
         <td><a href="https://explorer.zora.energy/address/0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1?tab=contract">0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</a></td>
      </tr>
      <tr>
         <td>Kaia</td>
         <td><a href="https://kaiascan.io/account/0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724?tabId=contract">0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724</a></td>
      </tr>
      <tr>
         <td>Cyber</td>
         <td><a href="https://cyberscan.co/address/0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1#contract">0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1</a></td>
      </tr>
      <tr>
         <td>Ham</td>
         <td>Not Deployed</td>
      </tr>
      <tr>
         <td>APEChain</td>
         <td><a href="https://apescan.io/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=contract#code">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Shibarium</td>
         <td><a href="https://www.shibariumscan.io/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>HashKey</td>
         <td><a href="https://explorer.hsk.xyz/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Unichain</td>
         <td><a href="https://uniscan.xyz/address/0xa4021a8907197Df92341F1218B32E26b250F6798?tab=contract">0xa4021a8907197Df92341F1218B32E26b250F6798</a></td>
      </tr>
      <tr>
         <td>Over</td>
         <td><a href="https://scan.over.network/address/0x621c335b4BD8f2165E120DC70d3AfcAfc6628681?tab=contract">0x621c335b4BD8f2165E120DC70d3AfcAfc6628681</a></td>
      </tr>
      <tr>
         <td>Sepolia</td>
         <td><a href="https://sepolia.etherscan.io/address/0xd1cFAf476c8311792c329359B012bA515399f3a4#code">0xd1cFAf476c8311792c329359B012bA515399f3a4</a></td>
      </tr>
   </tbody>
</table>

### BuyBackBurner (Base)

[0xcEF6a6AB0f74c9cE97f7D1EB9bD99EA49E71Ec1d](https://basescan.org/address/0xcEF6a6AB0f74c9cE97f7D1EB9bD99EA49E71Ec1d)

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
--------------------------|----------|----------|----------|----------|----------------|
File                      |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
--------------------------|----------|----------|----------|----------|----------------|
 contracts/               |    97.05 |    78.74 |    91.89 |    96.33 |                |
  BulkSender.sol          |      100 |    84.62 |      100 |    97.87 |             74 |
  Locker.sol              |     97.5 |    84.09 |    85.71 |    98.21 |            107 |
  MCV2_BlastBond.sol      |        0 |        0 |        0 |        0 |... 56,57,61,65 |
  MCV2_Bond.sol           |     99.4 |    80.56 |     96.3 |    99.05 |        348,717 |
  MCV2_MultiToken.sol     |      100 |    58.33 |      100 |      100 |                |
  MCV2_NFTDistributor.sol |      100 |       50 |      100 |    84.21 |       31,39,47 |
  MCV2_Royalty.sol        |      100 |    92.86 |      100 |      100 |                |
  MCV2_Token.sol          |      100 |       50 |      100 |      100 |                |
  MCV2_ZapV1.sol          |    94.74 |    52.63 |      100 |    95.12 |          89,90 |
  MerkleDistributor.sol   |    98.39 |    82.81 |    92.31 |    98.81 |            257 |
  MerkleDistributorV2.sol |     98.8 |    91.18 |    95.45 |    96.18 |... 164,291,414 |
 contracts/interfaces/    |      100 |      100 |      100 |      100 |                |
  IBulkSender.sol         |      100 |      100 |      100 |      100 |                |
  IMCV2_Bond.sol          |      100 |      100 |      100 |      100 |                |
  IMintClubBond.sol       |      100 |      100 |      100 |      100 |                |
  IWETH.sol               |      100 |      100 |      100 |      100 |                |
  MCV2_ICommonToken.sol   |      100 |      100 |      100 |      100 |                |
 contracts/lib/           |        0 |        0 |        0 |        0 |                |
  WDEGEN.sol              |        0 |        0 |        0 |        0 |... 74,75,77,79 |
--------------------------|----------|----------|----------|----------|----------------|
All files                 |    94.26 |    77.29 |    86.44 |    93.47 |                |
--------------------------|----------|----------|----------|----------|----------------|
```

## Deploy 🚀

```bash
npx hardhat compile && HARDHAT_NETWORK=ethsepolia node scripts/deploy.js
```

## Gas Consumption ⛽️

```m
························································································································
|  Solidity and Network Configuration                                                                                  │
···································|················|·················|················|································
|  Solidity: 0.8.30                ·  Optim: true   ·  Runs: 50000    ·  viaIR: true   ·     Block: 30,000,000 gas     │
···································|················|·················|················|································
|  Methods                                                                                                             │
···································|················|·················|················|················|···············
|  Contracts / Methods             ·  Min           ·  Max            ·  Avg           ·  # calls       ·  usd (avg)   │
···································|················|·················|················|················|···············
|  BulkSender                      ·                                                                                   │
···································|················|·················|················|················|···············
|      sendERC1155                 ·             -  ·              -  ·       169,298  ·             3  ·           -  │
···································|················|·················|················|················|···············
|      sendERC20                   ·             -  ·              -  ·       154,771  ·             3  ·           -  │
···································|················|·················|················|················|···············
|      sendNative                  ·             -  ·              -  ·        94,278  ·             3  ·           -  │
···································|················|·················|················|················|···············
|      updateFeePerRecipient       ·             -  ·              -  ·        26,928  ·             1  ·           -  │
···································|················|·················|················|················|···············
|      updateProtocolBeneficiary   ·             -  ·              -  ·        27,193  ·             1  ·           -  │
···································|················|·················|················|················|···············
|  Locker                          ·                                                                                   │
···································|················|·················|················|················|···············
|      createLockUp                ·       118,371  ·        177,007  ·       147,544  ·            40  ·           -  │
···································|················|·················|················|················|···············
|      unlock                      ·        65,465  ·         66,722  ·        66,024  ·             9  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_BlastBond                  ·                                                                                   │
···································|················|·················|················|················|···············
|      createMultiToken            ·             -  ·              -  ·       495,607  ·            14  ·           -  │
···································|················|·················|················|················|···············
|      createToken                 ·             -  ·              -  ·       399,047  ·            14  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_Bond                       ·                                                                                   │
···································|················|·················|················|················|···············
|      burn                        ·        95,816  ·        130,660  ·       118,254  ·            43  ·           -  │
···································|················|·················|················|················|···············
|      burnRoyalties               ·             -  ·              -  ·        79,831  ·             1  ·           -  │
···································|················|·················|················|················|···············
|      claimRoyalties              ·             -  ·              -  ·        80,107  ·             3  ·           -  │
···································|················|·················|················|················|···············
|      createMultiToken            ·       394,070  ·        493,330  ·       488,210  ·            90  ·           -  │
···································|················|·················|················|················|···············
|      createToken                 ·       299,249  ·        521,942  ·       491,490  ·           152  ·           -  │
···································|················|·················|················|················|···············
|      mint                        ·       109,446  ·        208,986  ·       188,945  ·           106  ·           -  │
···································|················|·················|················|················|···············
|      updateBondCreator           ·        26,250  ·         29,062  ·        28,283  ·            15  ·           -  │
···································|················|·················|················|················|···············
|      updateCreationFee           ·        46,917  ·         46,929  ·        46,924  ·             5  ·           -  │
···································|················|·················|················|················|···············
|      updateMaxRoyaltyRange       ·             -  ·              -  ·        29,763  ·             2  ·           -  │
···································|················|·················|················|················|···············
|      updateProtocolBeneficiary   ·             -  ·              -  ·        30,050  ·             1  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_BondPeriphery              ·                                                                                   │
···································|················|·················|················|················|···············
|      mintWithReserveAmount       ·       179,142  ·        233,167  ·       191,969  ·             7  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_BuyBackBurner              ·                                                                                   │
···································|················|·················|················|················|···············
|      buyBackBurn                 ·     1,835,276  ·      1,886,576  ·     1,863,903  ·            21  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_MultiToken                 ·                                                                                   │
···································|················|·················|················|················|···············
|      safeTransferFrom            ·        37,867  ·         56,928  ·        56,242  ·            28  ·           -  │
···································|················|·················|················|················|···············
|      setApprovalForAll           ·        46,114  ·         48,812  ·        47,146  ·            68  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_NFTDistributor             ·                                                                                   │
···································|················|·················|················|················|···············
|      createAndDistribute         ·             -  ·              -  ·       628,771  ·             4  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_Token                      ·                                                                                   │
···································|················|·················|················|················|···············
|      approve                     ·        24,271  ·         49,312  ·        47,002  ·            47  ·           -  │
···································|················|·················|················|················|···············
|      transfer                    ·        32,280  ·         51,454  ·        41,867  ·             2  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_ZapV1                      ·                                                                                   │
···································|················|·················|················|················|···············
|      burnToEth                   ·       164,215  ·        169,230  ·       166,723  ·            12  ·           -  │
···································|················|·················|················|················|···············
|      mintWithEth                 ·       207,024  ·        210,787  ·       208,906  ·            24  ·           -  │
···································|················|·················|················|················|···············
|      rescueETH                   ·             -  ·              -  ·        34,679  ·             2  ·           -  │
···································|················|·················|················|················|···············
|  MerkleDistributor               ·                                                                                   │
···································|················|·················|················|················|···············
|      claim                       ·        91,708  ·         97,812  ·        95,785  ·            30  ·           -  │
···································|················|·················|················|················|···············
|      createDistribution          ·       140,046  ·        203,822  ·       188,786  ·            69  ·           -  │
···································|················|·················|················|················|···············
|      refund                      ·        47,624  ·         48,934  ·        48,279  ·             8  ·           -  │
···································|················|·················|················|················|···············
|  MerkleDistributorV2             ·                                                                                   │
···································|················|·················|················|················|···············
|      claim                       ·        91,871  ·        109,678  ·        97,844  ·            30  ·           -  │
···································|················|·················|················|················|···············
|      createDistribution          ·       223,471  ·        297,089  ·       231,557  ·           711  ·           -  │
···································|················|·················|················|················|···············
|      refund                      ·        47,590  ·         48,912  ·        48,251  ·             8  ·           -  │
···································|················|·················|················|················|···············
|      updateClaimFee              ·             -  ·              -  ·        29,724  ·             3  ·           -  │
···································|················|·················|················|················|···············
|      updateProtocolBeneficiary   ·             -  ·              -  ·        30,049  ·             3  ·           -  │
···································|················|·················|················|················|···············
|  Stake                           ·                                                                                   │
···································|················|·················|················|················|···············
|      cancelPool                  ·        39,881  ·        109,331  ·        71,601  ·            22  ·           -  │
···································|················|·················|················|················|···············
|      claim                       ·        50,138  ·        185,964  ·       129,326  ·            34  ·           -  │
···································|················|·················|················|················|···············
|      createPool                  ·       157,348  ·        204,108  ·       180,404  ·           404  ·           -  │
···································|················|·················|················|················|···············
|      emergencyUnstake            ·        55,808  ·        104,855  ·        88,883  ·             8  ·           -  │
···································|················|·················|················|················|···············
|      stake                       ·        87,128  ·        211,565  ·       130,250  ·           255  ·           -  │
···································|················|·················|················|················|···············
|      unstake                     ·        57,360  ·        206,940  ·       147,170  ·            29  ·           -  │
···································|················|·················|················|················|···············
|      updateClaimFee              ·        27,373  ·         47,297  ·        42,915  ·            13  ·           -  │
···································|················|·················|················|················|···············
|      updateCreationFee           ·        25,194  ·         47,166  ·        44,420  ·             8  ·           -  │
···································|················|·················|················|················|···············
|      updateProtocolBeneficiary   ·             -  ·              -  ·        30,181  ·             2  ·           -  │
···································|················|·················|················|················|···············
|  TaxToken                        ·                                                                                   │
···································|················|·················|················|················|···············
|      approve                     ·        46,323  ·         46,634  ·        46,538  ·            19  ·           -  │
···································|················|·················|················|················|···············
|      transfer                    ·        26,754  ·         54,361  ·        45,786  ·            10  ·           -  │
···································|················|·················|················|················|···············
|  TestMultiToken                  ·                                                                                   │
···································|················|·················|················|················|···············
|      safeTransferFrom            ·        52,224  ·         52,370  ·        52,365  ·            29  ·           -  │
···································|················|·················|················|················|···············
|      setApprovalForAll           ·        24,202  ·         46,114  ·        45,517  ·            70  ·           -  │
···································|················|·················|················|················|···············
|  TestToken                       ·                                                                                   │
···································|················|·················|················|················|···············
|      approve                     ·        24,327  ·         46,611  ·        45,611  ·          1256  ·           -  │
···································|················|·················|················|················|···············
|      transfer                    ·        34,306  ·         51,562  ·        50,845  ·           916  ·           -  │
···································|················|·················|················|················|···············
|  Deployments                                      ·                                  ·  % of limit    ·              │
···································|················|·················|················|················|···············
|  BulkSender                      ·             -  ·              -  ·     1,104,472  ·         3.7 %  ·           -  │
···································|················|·················|················|················|···············
|  EmptyReturnData                 ·             -  ·              -  ·       105,271  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  ERC1155ClaimingToBeERC20        ·             -  ·              -  ·       125,063  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  GasBombToken                    ·             -  ·              -  ·       636,019  ·         2.1 %  ·           -  │
···································|················|·················|················|················|···············
|  GasConsumingContract            ·             -  ·              -  ·       162,759  ·         0.5 %  ·           -  │
···································|················|·················|················|················|···············
|  Locker                          ·             -  ·              -  ·     1,311,359  ·         4.4 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_Bond                       ·     4,849,169  ·      4,869,093  ·     4,852,019  ·        16.2 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_BondPeriphery              ·             -  ·              -  ·     1,038,637  ·         3.5 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_BuyBackBurner              ·             -  ·              -  ·       877,760  ·         2.9 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_MultiToken                 ·             -  ·              -  ·     1,955,155  ·         6.5 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_NFTDistributor             ·             -  ·              -  ·       905,348  ·           3 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_Token                      ·             -  ·              -  ·       858,512  ·         2.9 %  ·           -  │
···································|················|·················|················|················|···············
|  MCV2_ZapV1                      ·             -  ·              -  ·     1,466,706  ·         4.9 %  ·           -  │
···································|················|·················|················|················|···············
|  MerkleDistributor               ·             -  ·              -  ·     2,053,503  ·         6.8 %  ·           -  │
···································|················|·················|················|················|···············
|  MerkleDistributorV2             ·             -  ·              -  ·     3,273,797  ·        10.9 %  ·           -  │
···································|················|·················|················|················|···············
|  NoBalanceOf                     ·             -  ·              -  ·        86,019  ·         0.3 %  ·           -  │
···································|················|·················|················|················|···············
|  NoDecimals                      ·             -  ·              -  ·       139,947  ·         0.5 %  ·           -  │
···································|················|·················|················|················|···············
|  NoTotalSupply                   ·             -  ·              -  ·        92,519  ·         0.3 %  ·           -  │
···································|················|·················|················|················|···············
|  RevertingBalanceOf              ·             -  ·              -  ·       128,195  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  RevertingDecimals               ·             -  ·              -  ·       172,243  ·         0.6 %  ·           -  │
···································|················|·················|················|················|···············
|  RevertingSupportsInterface      ·             -  ·              -  ·       150,413  ·         0.5 %  ·           -  │
···································|················|·················|················|················|···············
|  RevertingTotalSupply            ·             -  ·              -  ·       126,311  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  Stake                           ·     3,950,417  ·      3,970,389  ·     3,963,732  ·        13.2 %  ·           -  │
···································|················|·················|················|················|···············
|  TaxToken                        ·             -  ·              -  ·       736,527  ·         2.5 %  ·           -  │
···································|················|·················|················|················|···············
|  TestERC1155                     ·     1,407,279  ·      1,407,291  ·     1,407,289  ·         4.7 %  ·           -  │
···································|················|·················|················|················|···············
|  TestMultiToken                  ·     1,508,407  ·      1,508,491  ·     1,508,425  ·           5 %  ·           -  │
···································|················|·················|················|················|···············
|  TestToken                       ·       639,203  ·        861,483  ·       681,151  ·         2.3 %  ·           -  │
···································|················|·················|················|················|···············
|  WETH9                           ·             -  ·              -  ·       799,725  ·         2.7 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongBalanceOfReturnLength      ·             -  ·              -  ·       113,731  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongDecimalsReturnLength       ·             -  ·              -  ·       155,827  ·         0.5 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongERC1155BalanceOfSignature  ·             -  ·              -  ·        92,519  ·         0.3 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongERC20BalanceOfSignature    ·             -  ·              -  ·        86,019  ·         0.3 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongSupportsInterfaceReturn    ·             -  ·              -  ·       134,431  ·         0.4 %  ·           -  │
···································|················|·················|················|················|···············
|  WrongTotalSupplyReturnLength    ·             -  ·              -  ·       103,963  ·         0.3 %  ·           -  │
···································|················|·················|················|················|···············
```
