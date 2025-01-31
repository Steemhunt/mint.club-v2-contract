require("dotenv").config();
const hre = require("hardhat");
const { Deployer } = require("@matterlabs/hardhat-zksync");
const { Wallet } = require("zksync-ethers");
const {
  getMaxSteps,
  getWETHAddress,
  getCreationFee,
} = require("../test/utils/test-utils");

async function main() {
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

  const wallet = new Wallet(
    hre.network.name === "abstractMainnet"
      ? process.env.MAINNET_PRIVATE_KEY
      : process.env.TEST_PRIVATE_KEY
  );

  const deployer = new Deployer(hre, wallet);
  const deployerAddress = await wallet.getAddress();
  const balance = await hre.ethers.provider.getBalance(deployerAddress);

  console.log(
    `Deploy from account: ${deployerAddress} - Balance: ${
      Number(balance) / 1e18
    } ETH`
  );

  // ---------------------------------------------------------------------------
  // Deploy MCV2_Token
  // ---------------------------------------------------------------------------
  const tokenArtifact = await deployer.loadArtifact("MCV2_Token");
  const tokenImplementation = await deployer.deploy(tokenArtifact, []);
  const tokenAddress = await tokenImplementation.getAddress();
  console.log(` -> MCV2_Token contract deployed at ${tokenAddress}`);
  await (
    await tokenImplementation.init("Token Implementation", "TOKEN_PLACEHOLDER")
  ).wait();

  // ---------------------------------------------------------------------------
  // Deploy MCV2_MultiToken
  // ---------------------------------------------------------------------------
  const nftArtifact = await deployer.loadArtifact("MCV2_MultiToken");
  const NFTImplementation = await deployer.deploy(nftArtifact, []);
  const nftAddress = await NFTImplementation.getAddress();
  console.log(` -> MCV2_MultiToken contract deployed at ${nftAddress}`);
  await (
    await NFTImplementation.init(
      "MultiToken Implementation",
      "MULTI_TOKEN_PLACEHOLDER",
      ""
    )
  ).wait();

  // ---------------------------------------------------------------------------
  // Deploy MCV2_Bond
  // ---------------------------------------------------------------------------
  const bondArtifact = await deployer.loadArtifact("MCV2_Bond");
  const bond = await deployer.deploy(bondArtifact, [
    tokenAddress,
    nftAddress,
    PROTOCOL_BENEFICIARY,
    String(CREATION_FEE),
    String(MAX_STEPS),
  ]);
  const bondAddress = await bond.getAddress();
  console.log(` -> MCV2_Bond contract deployed at ${bondAddress}`);

  // ---------------------------------------------------------------------------
  // Deploy MCV2_ZapV1
  // ---------------------------------------------------------------------------
  const zapArtifact = await deployer.loadArtifact("MCV2_ZapV1");
  const zap = await deployer.deploy(zapArtifact, [bondAddress, WETH_ADDRESS]);
  const zapAddress = await zap.getAddress();
  console.log(` -> Zap contract deployed at ${zapAddress}`);

  // ---------------------------------------------------------------------------
  // Deploy Locker
  // ---------------------------------------------------------------------------
  const lockerArtifact = await deployer.loadArtifact("Locker");
  const locker = await deployer.deploy(lockerArtifact, []);
  const lockerAddress = await locker.getAddress();
  console.log(` -> Locker contract deployed at ${lockerAddress}`);

  // ---------------------------------------------------------------------------
  // Deploy MerkleDistributor
  // ---------------------------------------------------------------------------
  const distArtifact = await deployer.loadArtifact("MerkleDistributor");
  const merkleDistributor = await deployer.deploy(distArtifact, []);
  const merkleDistributorAddress = await merkleDistributor.getAddress();
  console.log(
    ` -> MerkleDistributor contract deployed at ${merkleDistributorAddress}`
  );

  // ---------------------------------------------------------------------------
  // Print summary
  // ---------------------------------------------------------------------------
  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_Token: ${tokenAddress}`);
  console.log(`- MCV2_MultiToken: ${nftAddress}`);
  console.log(`- MCV2_Bond: ${bondAddress}`);
  console.log(`- MCV2_ZapV1: ${zapAddress}`);
  console.log(`- Locker: ${lockerAddress}`);
  console.log(`- MerkleDistributor: ${merkleDistributorAddress}`);
  console.log("```");

  // ---------------------------------------------------------------------------
  // Print verification commands
  // ---------------------------------------------------------------------------
  console.log(`
    npx hardhat verify --network ${hre.network.name} ${tokenAddress}
    npx hardhat verify --network ${hre.network.name} ${nftAddress}
    npx hardhat verify --network ${hre.network.name} ${bondAddress} ${tokenAddress} ${nftAddress} ${PROTOCOL_BENEFICIARY} ${CREATION_FEE} ${MAX_STEPS}
    npx hardhat verify --network ${hre.network.name} ${zapAddress} ${bondAddress} ${WETH_ADDRESS}
    npx hardhat verify --network ${hre.network.name} ${lockerAddress}
    npx hardhat verify --network ${hre.network.name} ${merkleDistributorAddress}
  `);
}

module.exports = main;

/* Deploy script

npx hardhat compile --network abstractTestnet && npx hardhat deploy-zksync --script scripts/deploy-on-abstract.js --network abstractTestnet

*/
