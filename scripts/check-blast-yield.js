require('dotenv').config();

async function main() {
  const BlastBond = await ethers.getContractFactory('MCV2_BlastBond');
  const blastBond = BlastBond.attach('0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d');

  const claimableGas = await blastBond.getClaimableGas();
  console.log(`Claimable Gas: ${ethers.formatEther(claimableGas)} ETH`);

  const WETH = await blastBond.WETH();
  const USDB = await blastBond.USDB();
  const wethYield = await blastBond.getClaimableYield(WETH);
  const usdbYield = await blastBond.getClaimableYield(USDB);

  console.log(`WETH yield: ${ethers.formatEther(wethYield)} ETH`);
  console.log(`USDB yield: ${ethers.formatUnits(usdbYield, 6)} USDB`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network blastSepolia scripts/check-blast.js
