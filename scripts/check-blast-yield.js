require("dotenv").config();

async function main() {
  const BlastBond = await ethers.getContractFactory("MCV2_BlastBond");
  const blastBond = BlastBond.attach(
    "0x621c335b4BD8f2165E120DC70d3AfcAfc6628681"
  );

  // Query Blast directly so existing Bond deployments with the old getter report gas correctly.
  const Blast = await ethers.getContractAt("IBlast", await blastBond.BLAST());
  const [, accruedGas] = await Blast.readGasParams(blastBond.target);
  console.log(`Accrued gas before claim-rate adjustment: ${ethers.formatEther(accruedGas)} ETH`);

  const ERC20 = await ethers.getContractFactory("MCV2_Token");
  const WETH = ERC20.attach(await blastBond.WETH());
  const USDB = ERC20.attach(await blastBond.USDB());
  const wethYield = await blastBond.getClaimableYield(WETH.target);
  const usdbYield = await blastBond.getClaimableYield(USDB.target);
  const usdbDecimals = await USDB.decimals();

  console.log(`WETH yield: ${ethers.formatEther(wethYield)} ETH`);
  console.log(`USDB yield: ${ethers.formatUnits(usdbYield, usdbDecimals)} USDB`);

  const PROTOCOL_BENEFICIARY = await blastBond.protocolBeneficiary();
  console.log(
    `Claiming WETH and USDB yield.. Beneficiary: ${PROTOCOL_BENEFICIARY}`
  );
  // Get balqance of current address
  console.log(
    ` - WETH Balance before: ${ethers.formatEther(
      await WETH.balanceOf(PROTOCOL_BENEFICIARY)
    )} ETH`
  );
  console.log(
    ` - USDB Balance before: ${ethers.formatUnits(
      await USDB.balanceOf(PROTOCOL_BENEFICIARY),
      usdbDecimals
    )} USDB`
  );

  // Claim yield
  console.log(`UNCOMMENT for actual claiming`);
  // await blastBond.claimYield(WETH.target, PROTOCOL_BENEFICIARY);
  // await blastBond.claimYield(USDB);

  // Get balance after
  console.log(
    ` - WETH Balance after: ${ethers.formatEther(
      await WETH.balanceOf(PROTOCOL_BENEFICIARY)
    )} ETH`
  );
  console.log(
    ` - USDB Balance after: ${ethers.formatUnits(
      await USDB.balanceOf(PROTOCOL_BENEFICIARY),
      usdbDecimals
    )} USDB`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run --network blast scripts/check-blast-yield.js
