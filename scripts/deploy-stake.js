require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;
  const CREATION_FEE = getCreationFee(hre.network.name) * 5n; // creationFee x 5 = ~$10

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);
  console.log(
    `PROTOCOL_BENEFICIARY: ${PROTOCOL_BENEFICIARY} | POOL_CREATION_FEE: ${CREATION_FEE}`
  );

  const stake = await hre.ethers.deployContract("Stake", [
    PROTOCOL_BENEFICIARY,
    CREATION_FEE,
  ]);
  await stake.waitForDeployment();
  console.log(` -> Stake contract deployed at ${stake.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- Stake: ${stake.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${stake.target} "${PROTOCOL_BENEFICIARY}" "${FEE_PER_RECIPIENT}"
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script
npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-stake.js

npx hardhat compile && npx hardhat run --network base scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network mainnet scripts/deploy-stake.js

npx hardhat compile && npx hardhat run --network avalanche scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network blast scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network degen scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network zora scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network klaytn scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network cyber scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network ham scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network apechain scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network shibarium scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network hashkey scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network unichain scripts/deploy-stake.js
npx hardhat compile && npx hardhat run --network over scripts/deploy-stake.js

*/
