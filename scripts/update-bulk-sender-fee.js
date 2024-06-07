require("dotenv").config();

async function main() {
  const CONTRACTS = {
    mainnet: "0xF44939c1613143ad587c79602182De7DcF593e33",
    base: "0xf7e2cDe9E603F15118E6E389cF14f11f19C1afbc",
    optimisticEthereum: "0xa4021a8907197Df92341F1218B32E26b250F6798",
    arbitrumOne: "0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724",
    polygon: "0x621c335b4BD8f2165E120DC70d3AfcAfc6628681",
    bsc: "0xa4021a8907197Df92341F1218B32E26b250F6798",
    avalanche: "0x9a176d09b3824cf50417e348696cBbBc43d7818d",
    blast: "0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65",
    degen: "0x5b64cECC5cF3E4B1A668Abd895D16BdDC0c77a17",
    zora: "0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4",
    klaytn: "0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4",
    cyber: "0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4",
    ham: "0x1349A9DdEe26Fe16D0D44E35B3CB9B0CA18213a4",
  };
  const BulkSender = await ethers.getContractFactory("BulkSender");
  const bulkSender = BulkSender.attach(CONTRACTS[hre.network.name]);

  const current = await bulkSender.feePerRecipient();
  console.log(`Chain: ${hre.network.name}`);
  console.log(
    `Current fee: ${current} wei (${ethers.formatEther(current.toString())})`
  );

  const newCreationFee = current / 10n; // 90% discount
  const tx = await bulkSender.updateFeePerRecipient(newCreationFee);
  await tx.wait(2); // Wait for 3 confirmation to make sure other RPCs updated

  const updated = await bulkSender.feePerRecipient();
  console.log(`Updated fee: ${updated} wei (${ethers.formatEther(updated)})`);
  console.log(`TX Hash: ${tx.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network optimisticEthereum scripts/update-bulk-sender-fee.js
// npx hardhat run --network arbitrumOne scripts/update-bulk-sender-fee.js
// npx hardhat run --network base scripts/update-bulk-sender-fee.js
// npx hardhat run --network polygon scripts/update-bulk-sender-fee.js
// npx hardhat run --network bsc scripts/update-bulk-sender-fee.js
// npx hardhat run --network avalanche scripts/update-bulk-sender-fee.js
// npx hardhat run --network blast scripts/update-bulk-sender-fee.js
// npx hardhat run --network degen scripts/update-bulk-sender-fee.js
// npx hardhat run --network zora scripts/update-bulk-sender-fee.js
// npx hardhat run --network klaytn scripts/update-bulk-sender-fee.js
// npx hardhat run --network cyber scripts/update-bulk-sender-fee.js
// npx hardhat run --network ham scripts/update-bulk-sender-fee.js
// npx hardhat run --network mainnet scripts/update-bulk-sender-fee.js
