require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const wdegen = await hre.ethers.deployContract('WDEGEN');
  await wdegen.waitForDeployment();
  console.log(` -> WDEGEN contract deployed at ${wdegen.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log('```');
  console.log(`- WDEGEN: ${wdegen.target}`);
  console.log('```');

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${wdegen.target}
  `);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


/* Deploy script

npx hardhat compile && npx hardhat run --network degen scripts/deploy-wdegen.js

*/
