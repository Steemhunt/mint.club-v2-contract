require("dotenv").config();
const hre = require("hardhat");
const {
  getWETHAddress,
  getBondAddress,
  getUniversalRouterAddress,
} = require("../test/utils/test-utils");

async function main() {
  const network = hre.network.name;
  const BOND_ADDRESS = getBondAddress(network);
  const WETH_ADDRESS = getWETHAddress(network);
  const UNIVERSAL_ROUTER_ADDRESS = getUniversalRouterAddress(network);

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);
  console.log(`Network: ${network}`);
  console.log(`BOND: ${BOND_ADDRESS}`);
  console.log(`WETH: ${WETH_ADDRESS}`);
  console.log(`UNIVERSAL_ROUTER: ${UNIVERSAL_ROUTER_ADDRESS}`);

  const zapV2 = await hre.ethers.deployContract("MCV2_ZapV2", [
    BOND_ADDRESS,
    WETH_ADDRESS,
    UNIVERSAL_ROUTER_ADDRESS,
  ]);
  await zapV2.waitForDeployment();
  console.log(` -> MCV2_ZapV2 contract deployed at ${zapV2.target}`);

  console.log(`\n\nNetwork: ${network}`);
  console.log("```");
  console.log(`- MCV2_ZapV2: ${zapV2.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${network} ${zapV2.target} "${BOND_ADDRESS}" "${WETH_ADDRESS}" "${UNIVERSAL_ROUTER_ADDRESS}"
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script — only chains where BOTH Mint Club V2 AND Uniswap UniversalRouter are deployed

npx hardhat compile && npx hardhat run --network mainnet scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network base scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network blast scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network zora scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network avalanche scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network unichain scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network robinhood scripts/deploy-zap-v2.js

# Testnets
npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-zap-v2.js
npx hardhat compile && npx hardhat run --network baseSepolia scripts/deploy-zap-v2.js

*/
