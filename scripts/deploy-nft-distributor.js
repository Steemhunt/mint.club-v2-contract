require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;

  const BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27"; // Base: MCV2_Bond
  const BULK_SENDER = "0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1"; // Base: BulkSender

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

*/
