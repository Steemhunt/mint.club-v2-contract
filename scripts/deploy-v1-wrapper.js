require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const mcv1Wrapper = await hre.ethers.deployContract('MCV1_Wrapper');
  await mcv1Wrapper.waitForDeployment();
  console.log(` -> MCV1_Wrapper contract deployed at ${mcv1Wrapper.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log('```');
  console.log(`- MCV1_Wrapper: ${mcv1Wrapper.target}`);
  console.log('```');

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${mcv1Wrapper.target}
  `);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


/* Deploy script

npx hardhat compile && npx hardhat run --network bsc scripts/deploy-v1-wrapper.js

*/
