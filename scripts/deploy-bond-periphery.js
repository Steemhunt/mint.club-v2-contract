require("dotenv").config();
const hre = require("hardhat");
const { getBondAddress } = require("../test/utils/test-utils");

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const bondAddress = getBondAddress(hre.network.name);

  const periphery = await hre.ethers.deployContract("MCV2_BondPeriphery", [
    bondAddress,
  ]);
  await periphery.waitForDeployment();
  console.log(
    ` -> MCV2_BondPeriphery contract deployed at ${periphery.target}`
  );

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_BondPeriphery: ${periphery.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${periphery.target} "${bondAddress}"
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network baseSepolia scripts/deploy-bond-periphery.js

npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network base scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network mainnet scripts/deploy-bond-periphery.js

npx hardhat compile && npx hardhat run --network avalanche scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network blast scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network degen scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network zora scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network klaytn scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network cyber scripts/deploy-bond-periphery.js
// npx hardhat compile && npx hardhat run --network ham scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network apechain scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network shibarium scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network hashkey scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network unichain scripts/deploy-bond-periphery.js
npx hardhat compile && npx hardhat run --network over scripts/deploy-bond-periphery.js

*/
