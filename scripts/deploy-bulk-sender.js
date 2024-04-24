require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;
  const FEE_PER_RECIPIENT = 0n;

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);
  console.log(
    `PROTOCOL_BENEFICIARY: ${PROTOCOL_BENEFICIARY} | FEE_PER_RECIPIENT: ${FEE_PER_RECIPIENT}`
  );

  const bulkSender = await hre.ethers.deployContract("BulkSender", [
    PROTOCOL_BENEFICIARY,
    FEE_PER_RECIPIENT,
  ]);
  await bulkSender.waitForDeployment();
  console.log(` -> BulkSender contract deployed at ${bulkSender.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- BulkSender: ${bulkSender.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${bulkSender.target} "${PROTOCOL_BENEFICIARY}" "${FEE_PER_RECIPIENT}"
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network base scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-bulk-sender.js

*/
