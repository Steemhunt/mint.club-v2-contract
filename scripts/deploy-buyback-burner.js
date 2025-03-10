require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0].address;
  console.log(`Deploy from account: ${deployer}`);

  const buybackBurner = await hre.ethers.deployContract("MCV2_BuyBackBurner");
  await buybackBurner.waitForDeployment();
  console.log(
    ` -> MCV2_BuyBackBurner contract deployed at ${buybackBurner.target}`
  );

  console.log(`\n\nNetwork: ${hre.network.name}`);
  console.log("```");
  console.log(`- MCV2_BuyBackBurner: ${buybackBurner.target}`);
  console.log("```");

  console.log(`
    npx hardhat verify --network ${hre.network.name} ${buybackBurner.target}
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script

npx hardhat compile && npx hardhat run --network base scripts/deploy-buyback-burner.js

*/
