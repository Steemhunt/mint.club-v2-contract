require('dotenv').config();
const hre = require('hardhat');

const PROTOCOL_BENEFIARY = process.env.PROTOCOL_BENEFIARY;
const DEFAULT_PROTOCOL_FEE = 10;

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const tokenImplementation = await hre.ethers.deployContract('MCV2_Token');
  await tokenImplementation.waitForDeployment();
  console.log(` -> MCV2_Token contract deployed at ${tokenImplementation.target}`);

  const bond = await hre.ethers.deployContract('MCV2_Bond', [
    tokenImplementation.target, PROTOCOL_BENEFIARY, DEFAULT_PROTOCOL_FEE
  ]);
  await bond.waitForDeployment();
  console.log(` -> MCV2_Bond contract deployed at ${bond.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log('```');
  console.log(`- MCV2_Token: ${tokenImplementation.target}`);
  console.log(`- MCV2_Bond: ${bond.target}`);
  console.log('```');

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${tokenImplementation.target}
    npx hardhat verify --network ${hre.network.name} ${bond.target} ${PROTOCOL_BENEFIARY} ${DEFAULT_PROTOCOL_FEE}
  `);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy.js

*/
