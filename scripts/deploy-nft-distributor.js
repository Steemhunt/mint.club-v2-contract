require("dotenv").config();
const hre = require("hardhat");
const { getBondAddress } = require("../test/utils/test-utils");

async function main() {
  const bulkSenderAddresses = {
    base: "0x95BDA90196c4e737933360F4639c46Ace657AAb7",
    sepolia: "0x7A6995CE649FA025a8792a375510d2B7C3c48581",
    baseSepolia: "0xeDeB9196B6648F5a4701067E851F3fEBcF62F549",
  };
  const BULK_SENDER = bulkSenderAddresses[hre.network.name];
  if (!BULK_SENDER) {
    throw new Error(`NFT distributor deployment is not configured for ${hre.network.name}`);
  }
  const BOND = getBondAddress(hre.network.name);
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;

  console.log(`Deploy from account: ${deployer}`);
  console.log(`BOND: ${BOND} | BULK_SENDER: ${BULK_SENDER}`);

  const nftDistributor = await hre.ethers.deployContract(
    "MCV2_NFTDistributor",
    [BOND, BULK_SENDER]
  );
  await nftDistributor.waitForDeployment();
  console.log(
    ` -> MCV2_NFTDistributor contract deployed at ${nftDistributor.target}`
  );

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_NFTDistributor: ${nftDistributor.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${nftDistributor.target} "${BOND}" "${BULK_SENDER}"
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network base scripts/deploy-nft-distributor.js
npx hardhat compile && npx hardhat run --network sepolia scripts/deploy-nft-distributor.js
npx hardhat compile && npx hardhat run --network baseSepolia scripts/deploy-nft-distributor.js

*/
