require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;

  // const BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27"; // Base: MCV2_Bond
  // const BULK_SENDER = "0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1"; // Base: BulkSender

  // const BOND = "0x8dce343A86Aa950d539eeE0e166AFfd0Ef515C0c"; // Sepolia: MCV2_Bond
  // const BULK_SENDER = "0x480c09C58D658a14F6CCF62C5C0fA4e3186f2C70"; // Sepolia: BulkSender

  const BOND = "0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d"; // BaseSepolia: MCV2_Bond
  const BULK_SENDER = "0xeDeB9196B6648F5a4701067E851F3fEBcF62F549"; // BaseSepolia: BulkSender

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
