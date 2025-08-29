require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const CONTRACTS = {
    polygon: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
  };
  const Bond = await ethers.getContractFactory("MCV2_Bond");
  const bond = Bond.attach(CONTRACTS[hre.network.name]);

  const current = await bond.creationFee();
  console.log(`Chain: ${hre.network.name}`);
  console.log(
    `Current fee: ${current} wei (${ethers.formatEther(current.toString())})`
  );

  const newCreationFee = getCreationFee(hre.network.name);
  const tx = await bond.updateCreationFee(newCreationFee);
  await tx.wait(2); // Wait for 2 confirmation to make sure other RPCs updated

  const updated = await bond.creationFee();
  console.log(`Updated fee: ${updated} wei (${ethers.formatEther(updated)})`);
  console.log(`TX Hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network polygon scripts/update-creation-fee.js
