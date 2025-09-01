require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const CONTRACTS = {
    polygon: "0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65",
  };
  const Stake = await ethers.getContractFactory("Stake");
  const stake = Stake.attach(CONTRACTS[hre.network.name]);

  const current = await stake.creationFee();
  console.log(`Chain: ${hre.network.name}`);
  console.log(
    `Current fee: ${current} wei (${ethers.formatEther(current.toString())})`
  );

  const newCreationFee = getCreationFee(hre.network.name) * 5n; // creationFee x 5 = ~$10
  const tx = await stake.updateCreationFee(newCreationFee);
  await tx.wait(2); // Wait for 3 confirmation to make sure other RPCs updated

  const updated = await stake.creationFee();
  console.log(`Updated fee: ${updated} wei (${ethers.formatEther(updated)})`);
  console.log(`TX Hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network polygon scripts/update-staking-fee.js
