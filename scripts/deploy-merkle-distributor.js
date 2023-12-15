require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const merkleDistributor = await hre.ethers.deployContract('MerkleDistributor');
  await merkleDistributor.waitForDeployment();
  console.log(` -> MerkleDistributor contract deployed at ${merkleDistributor.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log('```');
  console.log(`- MerkleDistributor: ${merkleDistributor.target}`);
  console.log('```');

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${merkleDistributor.target}
  `);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-bond.js
npx hardhat compile && npx hardhat run --network base scripts/deploy-bond.js

*/
