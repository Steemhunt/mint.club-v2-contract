require('dotenv').config();

async function main() {
  const BlastBond = await ethers.getContractFactory('MCV2_BlastBond');
  const blastBond = BlastBond.attach('0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d');

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
  const balanceBefore = await WETH.balanceOf(PROTOCOL_BENEFIARY);
  console.log(`Balance before: ${ethers.formatEther(balanceBefore)} ETH`);

  // Claim yield
  await blastBond.claimYield(WETH.target, PROTOCOL_BENEFIARY);
  // await blastBond.claimYield(USDB);

  // Get balance after
  const balanceAfter = await WETH.balanceOf(PROTOCOL_BENEFIARY);
  console.log(`Balance after: ${ethers.formatEther(balanceAfter)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network blastSepolia scripts/check-blast.js
