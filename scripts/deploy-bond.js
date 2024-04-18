require("dotenv").config();
const hre = require("hardhat");
const {
  getMaxSteps,
  getWETHAddress,
  getCreationFee,
} = require("../test/utils/test-utils");

const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;

const TOKEN_IMPLEMENTATION = {
  // sepolia: '0x003E64dFcf66D597aDA5B151CA6C374f1A800e6c',
  // base: '0xeDeB9196B6648F5a4701067E851F3fEBcF62F549',
};

const MULTI_TOKEN_IMPLEMENTATION = {
  // sepolia: '0xf462a581E2977688bFD6984374F7aDFE5893e16F',
  // base: '0xF4567Fc564Bfd23F50Fe092f65146CAf7266d241',
};

const MAX_STEPS = getMaxSteps(hre.network.name);
const CREATION_FEE = getCreationFee(hre.network.name);
const WETH_ADDRESS = getWETHAddress(hre.network.name);

console.log(`--------------------------------------------------`);
console.log(
  `NETWORK: ${hre.network.name} | PROTOCOL_BENEFICIARY: ${PROTOCOL_BENEFICIARY}`
);
console.log(
  `CREATION_FEE: ${CREATION_FEE} | MAX_STEPS: ${MAX_STEPS} | WETH_ADDRESS: ${WETH_ADDRESS}`
);
console.log(`--------------------------------------------------`);

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const bond = await hre.ethers.deployContract("MCV2_Bond", [
    TOKEN_IMPLEMENTATION[hre.network.name],
    MULTI_TOKEN_IMPLEMENTATION[hre.network.name],
    PROTOCOL_BENEFICIARY,
    CREATION_FEE,
    MAX_STEPS,
  ]);
  await bond.waitForDeployment();
  console.log(` -> MCV2_Bond contract deployed at ${bond.target}`);

  const zap = await hre.ethers.deployContract("MCV2_ZapV1", [
    bond.target,
    WETH_ADDRESS,
  ]);
  await zap.waitForDeployment();
  console.log(` -> Zap contract deployed at ${zap.target}`);

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_Bond: ${bond.target}`);
  console.log(`- MCV2_ZapV1: ${zap.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${bond.target} ${
    TOKEN_IMPLEMENTATION[hre.network.name]
  } ${
    MULTI_TOKEN_IMPLEMENTATION[hre.network.name]
  } ${PROTOCOL_BENEFICIARY} ${CREATION_FEE} ${MAX_STEPS}
    npx hardhat verify --network ${hre.network.name} ${zap.target} ${
    bond.target
  } ${WETH_ADDRESS}
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-bond.js
npx hardhat compile && npx hardhat run --network base scripts/deploy-bond.js

*/
