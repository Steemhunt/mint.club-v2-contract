const { expect } = require("chai");
const { setCode } = require("@nomicfoundation/hardhat-network-helpers");
const { PROTOCOL_BENEFICIARY } = require("./utils/test-utils");

describe("MCV2_BlastBond gas reporting", function () {
  it("should return accrued gas fees independently from native ETH yield", async function () {
    const mock = await ethers.deployContract("BlastReportingMock");
    const code = await ethers.provider.getCode(mock.target);
    for (const address of [
      "0x4300000000000000000000000000000000000002",
      "0x4300000000000000000000000000000000000003",
      "0x4300000000000000000000000000000000000004",
    ]) {
      await setCode(address, code);
    }

    const token = await ethers.deployContract("MCV2_Token");
    const multiToken = await ethers.deployContract("MCV2_MultiToken");
    const bond = await ethers.deployContract("MCV2_BlastBond", [
      token.target, multiToken.target, PROTOCOL_BENEFICIARY, 0, 1000,
    ]);
    const blast = await ethers.getContractAt("BlastReportingMock", await bond.BLAST());

    expect(await blast.readClaimableYield(bond.target)).to.equal(7n);
    expect(await bond.getClaimableGas()).to.equal(200n);
  });
});
