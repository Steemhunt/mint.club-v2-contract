require("dotenv").config();
const hre = require("hardhat");
const {
  getMaxSteps,
  getWETHAddress,
  getCreationFee,
} = require("../test/utils/test-utils");

const PROTOCOL_BENEFICIARY = process.env.PROTOCOL_BENEFICIARY;
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
  console.log(
    `Deploy from account: ${deployer} - Balance: ${
      Number(await hre.ethers.provider.getBalance(deployer)) / 1e18
    } ETH`
  );

  const tokenImplementation = await hre.ethers.deployContract("MCV2_Token");
  await tokenImplementation.waitForDeployment();
  await tokenImplementation.init("Token Implementation", "TOKEN_PLACEHOLDER");
  console.log(
    ` -> MCV2_Token contract deployed at ${tokenImplementation.target}`
  );

  const NFTImplementation = await hre.ethers.deployContract("MCV2_MultiToken");
  await NFTImplementation.waitForDeployment();
  await NFTImplementation.init(
    "MultiToken Implementation",
    "MULTI_TOKEN_PLACEHOLDER",
    ""
  );
  console.log(
    ` -> MCV2_MultiToken contract deployed at ${NFTImplementation.target}`
  );

  let bondContract = "MCV2_Bond";
  if (hre.network.name === "blastSepolia" || hre.network.name === "blast") {
    bondContract = "MCV2_BlastBond";
  }
  const bond = await hre.ethers.deployContract(bondContract, [
    tokenImplementation.target,
    NFTImplementation.target,
    PROTOCOL_BENEFICIARY,
    CREATION_FEE,
    MAX_STEPS,
  ]);
  await bond.waitForDeployment();
  console.log(` -> ${bondContract} contract deployed at ${bond.target}`);

  const zap = await hre.ethers.deployContract("MCV2_ZapV1", [
    bond.target,
    WETH_ADDRESS,
  ]);
  await zap.waitForDeployment();
  console.log(` -> Zap contract deployed at ${zap.target}`);

  const locker = await hre.ethers.deployContract("Locker");
  await locker.waitForDeployment();
  console.log(` -> Locker contract deployed at ${locker.target}`);

  const merkleDistributor = await hre.ethers.deployContract(
    "MerkleDistributor"
  );
  await merkleDistributor.waitForDeployment();
  console.log(
    ` -> MerkleDistributor contract deployed at ${merkleDistributor.target}`
  );

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_Token: ${tokenImplementation.target}`);
  console.log(`- MCV2_MultiToken: ${NFTImplementation.target}`);
  console.log(`- ${bondContract}: ${bond.target}`);
  console.log(`- MCV2_ZapV1: ${zap.target}`);
  console.log(`- Locker: ${locker.target}`);
  console.log(`- MerkleDistributor: ${merkleDistributor.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${tokenImplementation.target}
    npx hardhat verify --network ${hre.network.name} ${NFTImplementation.target}
    npx hardhat verify --network ${hre.network.name} ${bond.target} ${tokenImplementation.target} ${NFTImplementation.target} ${PROTOCOL_BENEFICIARY} ${CREATION_FEE} ${MAX_STEPS}
    npx hardhat verify --network ${hre.network.name} ${zap.target} ${bond.target} ${WETH_ADDRESS}
    npx hardhat verify --network ${hre.network.name} ${locker.target}
    npx hardhat verify --network ${hre.network.name} ${merkleDistributor.target}
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network sepolia scripts/deploy.js
npx hardhat compile && npx hardhat run --network baseSepolia scripts/deploy.js
npx hardhat compile && npx hardhat run --network blastSepolia scripts/deploy.js
npx hardhat compile && npx hardhat run --network avalancheFujiTestnet scripts/deploy.js
npx hardhat compile && npx hardhat run --network movementDevnet scripts/deploy.js
npx hardhat compile && npx hardhat run --network cyberTestnet scripts/deploy.js
npx hardhat compile && npx hardhat run --network overTestnet scripts/deploy.js

npx hardhat compile && npx hardhat run --network optimisticEthereum scripts/deploy.js
npx hardhat compile && npx hardhat run --network arbitrumOne scripts/deploy.js
npx hardhat compile && npx hardhat run --network base scripts/deploy.js
npx hardhat compile && npx hardhat run --network polygon scripts/deploy.js
npx hardhat compile && npx hardhat run --network bsc scripts/deploy.js
npx hardhat compile && npx hardhat run --network mainnet scripts/deploy.js

npx hardhat compile && npx hardhat run --network avalanche scripts/deploy.js
npx hardhat compile && npx hardhat run --network blast scripts/deploy.js
npx hardhat compile && npx hardhat run --network degen scripts/deploy.js
npx hardhat compile && npx hardhat run --network zora scripts/deploy.js
npx hardhat compile && npx hardhat run --network klaytn scripts/deploy.js
npx hardhat compile && npx hardhat run --network cyber scripts/deploy.js
npx hardhat compile && npx hardhat run --network ham scripts/deploy.js
npx hardhat compile && npx hardhat run --network apechain scripts/deploy.js
npx hardhat compile && npx hardhat run --network shibarium scripts/deploy.js

*/
