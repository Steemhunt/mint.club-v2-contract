require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const CONTRACTS = {
    polygon: "0x29b0E6D2C2884aEa3FB4CB5dD1C7002A8E10c724",
  };
  const BulkSender = await ethers.getContractFactory("BulkSender");
  const bulkSender = BulkSender.attach(CONTRACTS[hre.network.name]);

  const current = await bulkSender.feePerRecipient();
  console.log(`Chain: ${hre.network.name}`);
  console.log(
    `Current fee: ${current} wei (${ethers.formatEther(current.toString())})`
  );

  const newCreationFee = getCreationFee(hre.network.name) / 50n; // ~$0.05 per recipient
  const tx = await bulkSender.updateFeePerRecipient(newCreationFee);
  await tx.wait(2); // Wait for 3 confirmation to make sure other RPCs updated

  const updated = await bulkSender.feePerRecipient();
  console.log(`Updated fee: ${updated} wei (${ethers.formatEther(updated)})`);
  console.log(`TX Hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network polygon scripts/update-bulk-sender-fee.js
