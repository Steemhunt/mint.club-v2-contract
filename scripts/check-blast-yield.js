require('dotenv').config();

async function main() {
  const BlastBond = await ethers.getContractFactory('MCV2_BlastBond');
  const blastBond = BlastBond.attach('0x621c335b4BD8f2165E120DC70d3AfcAfc6628681');

  const claimableGas = await blastBond.getClaimableGas();
  console.log(`Claimable Gas: ${ethers.formatEther(claimableGas)} ETH`);

  const ERC20 = await ethers.getContractFactory('MCV2_Token');
  const WETH = ERC20.attach(await blastBond.WETH());
  const USDB = ERC20.attach(await blastBond.USDB());
  const wethYield = await blastBond.getClaimableYield(WETH.target);
  const usdbYield = await blastBond.getClaimableYield(USDB.target);

  console.log(`WETH yield: ${ethers.formatEther(wethYield)} ETH`);
  console.log(`USDB yield: ${ethers.formatUnits(usdbYield, 6)} USDB`);

  const PROTOCOL_BENEFIARY = await blastBond.protocolBeneficiary();
  console.log(`Claiming WETH and USDB yield.. Beneficiary: ${PROTOCOL_BENEFIARY}`);
  // Get balqance of current address
  console.log(` - WETH Balance before: ${ethers.formatEther(await WETH.balanceOf(PROTOCOL_BENEFIARY))} ETH`);
  console.log(` - USDB Balance before: ${ethers.formatUnits(await USDB.balanceOf(PROTOCOL_BENEFIARY), 6)} USDB`)

  // Claim yield
  console.log(`UNCOMMENT for actual claiming`)
  // await blastBond.claimYield(WETH.target, PROTOCOL_BENEFIARY);
  // await blastBond.claimYield(USDB);

  // Get balance after
  console.log(` - WETH Balance after: ${ethers.formatEther(await WETH.balanceOf(PROTOCOL_BENEFIARY))} ETH`);
  console.log(` - USDB Balance after: ${ethers.formatUnits(await USDB.balanceOf(PROTOCOL_BENEFIARY), 6)} USDB`)
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network blast scripts/check-blast-yield.js
