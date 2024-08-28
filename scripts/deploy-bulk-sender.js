require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;
  const CREATION_FEE = getCreationFee(hre.network.name); // ~$2.6
  const FEE_PER_RECIPIENT = CREATION_FEE / 50n; // ~$0.05 per recipient
  // 10 recipients = 10 * $0.05 = $0.5
  // 100 recipients = 100 * $0.05 = $5.0
  // 1000 recipients = 1000 * $0.05 = $50.0

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
npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network mainnet scripts/deploy-bulk-sender.js

npx hardhat compile && npx hardhat run --network avalanche scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network blast scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network degen scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network zora scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network klaytn scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network cyber scripts/deploy-bulk-sender.js
npx hardhat compile && npx hardhat run --network ham scripts/deploy-bulk-sender.js

*/
