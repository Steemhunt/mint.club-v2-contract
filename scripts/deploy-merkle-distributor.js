require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;
const CREATION_FEE = getCreationFee(hre.network.name) / 10n; // 10% of creation fee for bond
const CLAIM_FEE = getCreationFee(hre.network.name) / 20n;

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  console.log(`-------------------------------------------------`);
  console.log(
    `PROTOCOL_BENEFICIARY: ${PROTOCOL_BENEFICIARY} | CREATION_FEE: ${CREATION_FEE} | CLAIM_FEE: ${CLAIM_FEE}`
  );
  console.log(`-------------------------------------------------`);

  const merkleDistributor = await hre.ethers.deployContract(
    "MerkleDistributorV2",
    [PROTOCOL_BENEFICIARY, CREATION_FEE, CLAIM_FEE]
  );
  await merkleDistributor.waitForDeployment();
  console.log(
    ` -> MerkleDistributorV2 contract deployed at ${merkleDistributor.target}`
  );

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MerkleDistributorV2: ${merkleDistributor.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${merkleDistributor.target} '${PROTOCOL_BENEFICIARY}' '${CREATION_FEE}' '${CLAIM_FEE}'
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-merkle-distributor.js

npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network base scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network mainnet scripts/deploy-merkle-distributor.js
npx hardhat compile && npx hardhat run --network avalanche scripts/deploy-merkle-distributor.js

npx hardhat compile && npx hardhat run --network degen scripts/deploy-merkle-distributor.js

*/
