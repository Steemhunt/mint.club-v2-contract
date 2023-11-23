require('dotenv').config();
const hre = require('hardhat');

const PROTOCOL_BENEFIARY = process.env.PROTOCOL_BENEFIARY;

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  // Reuse existing implementations
  const tokenImplementation = '0x37F540de37afE8bDf6C722d87CB019F30e5E406a';
  const NFTImplementation = '0xbba7de9897F8bB07D5070994efE44B8c203a02A8';

  const bond = await hre.ethers.deployContract('MCV2_Bond', [
    tokenImplementation, NFTImplementation, PROTOCOL_BENEFIARY
  ]);
  await bond.waitForDeployment();
  console.log(` -> MCV2_Bond contract deployed at ${bond.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log('```');
  console.log(`- MCV2_Bond: ${bond.target}`);
  console.log('```');

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${bond.target} ${tokenImplementation} ${NFTImplementation} ${PROTOCOL_BENEFIARY}
  `);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


/* Deploy script

npx hardhat compile && npx hardhat run --network base scripts/deploy-bond.js

*/
