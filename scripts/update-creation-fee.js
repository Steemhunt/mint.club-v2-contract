require("dotenv").config();

async function main() {
  const Bond = await ethers.getContractFactory("MCV2_Bond");
  const bond = Bond.attach("0xc5a076cad94176c2996B32d8466Be1cE757FAa27");

  const current = await bond.creationFee();

  console.log(`Current creation fee: ${current} wei`);

  const newCreationFee = 0n;
  await bond.updateCreationFee(newCreationFee);

  const updated = await bond.creationFee();
  console.log(`Updated creation fee: ${updated} wei`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network base scripts/update-creation-fee.js
