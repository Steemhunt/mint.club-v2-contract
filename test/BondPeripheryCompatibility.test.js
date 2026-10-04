const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { PROTOCOL_BENEFICIARY, wei } = require("./utils/test-utils");

describe("BondPeriphery reserve compatibility", function () {
  async function deployFixture() {
    const [owner, receiver] = await ethers.getSigners();
    const tokenImplementation = await ethers.deployContract("MCV2_Token");
    const multiTokenImplementation = await ethers.deployContract("MCV2_MultiToken");
    const bond = await ethers.deployContract("MCV2_Bond", [
      tokenImplementation.target, multiTokenImplementation.target, PROTOCOL_BENEFICIARY, 0, 1000,
    ]);
    const periphery = await ethers.deployContract("MCV2_BondPeriphery", [bond.target]);
    return { bond, periphery, owner, receiver };
  }

  async function createToken(bond, reserveToken, symbol, price = wei(3)) {
    await bond.createToken({ name: symbol, symbol }, {
      mintRoyalty: 0, burnRoyalty: 0, reserveToken,
      maxSupply: wei(100), stepRanges: [wei(100)], stepPrices: [price],
    });
    return ethers.getContractAt("MCV2_Token", await bond.tokens((await bond.tokenCount()) - 1n));
  }

  it("should estimate, mint, and burn an asset whose reserve is a Mint Club token", async function () {
    const { bond, periphery, owner, receiver } = await loadFixture(deployFixture);
    const base = await ethers.deployContract("TestToken", [wei(1000), "Base", "BASE", 18]);
    const reserve = await createToken(bond, base.target, "RESERVE", wei(1));
    const child = await createToken(bond, reserve.target, "CHILD", wei(1));
    await base.approve(bond.target, wei(10));
    await bond.mint(reserve.target, wei(10), wei(10), owner.address);
    await reserve.approve(periphery.target, wei(10));

    expect(await periphery.estimateSwap(reserve.target, wei(10), child.target)).to.equal(wei(10));
    await periphery.swap(reserve.target, wei(10), child.target, wei(10), receiver.address);
    expect(await child.balanceOf(receiver.address)).to.equal(wei(10));
    expect(await reserve.balanceOf(owner.address)).to.equal(0n);

    expect(await periphery.estimateSwap(child.target, wei(10), reserve.target)).to.equal(wei(10));
    await child.connect(receiver).approve(periphery.target, wei(10));
    await periphery.connect(receiver).swap(child.target, wei(10), reserve.target, wei(10), owner.address);
    expect(await reserve.balanceOf(owner.address)).to.equal(wei(10));
  });

  for (const omitReturn of [false, true]) {
    it(`should handle repeated mints and refunds with zero-first approvals and omitReturn=${omitReturn}`, async function () {
      const { bond, periphery, owner, receiver } = await loadFixture(deployFixture);
      const reserve = await ethers.deployContract("PeripheryReserveMock", [omitReturn, false]);
      const token = await createToken(bond, reserve.target, "ASSET");
      await reserve.approve(periphery.target, 20n);

      for (let i = 0; i < 2; i++) {
        await periphery.mintWithReserveAmount(token.target, 10n, 3n, receiver.address);
        expect(await reserve.allowance(periphery.target, bond.target)).to.equal(0n);
      }

      expect(await token.balanceOf(receiver.address)).to.equal(6n);
      expect(await reserve.balanceOf(receiver.address)).to.equal(2n);
      expect(await reserve.balanceOf(owner.address)).to.equal(980n);
      expect(await reserve.balanceOf(periphery.target)).to.equal(0n);
    });
  }

  it("should refund only the current caller's leftover reserve", async function () {
    const { bond, periphery, receiver } = await loadFixture(deployFixture);
    const reserve = await ethers.deployContract("PeripheryReserveMock", [false, false]);
    const token = await createToken(bond, reserve.target, "ASSET");
    await reserve.transfer(periphery.target, 100n);
    await reserve.approve(periphery.target, 10n);

    await periphery.mintWithReserveAmount(token.target, 10n, 3n, receiver.address);

    expect(await reserve.balanceOf(receiver.address)).to.equal(1n);
    expect(await reserve.balanceOf(periphery.target)).to.equal(100n);
  });

  it("should roll back the mint when the reserve token returns false on refund", async function () {
    const { bond, periphery, owner, receiver } = await loadFixture(deployFixture);
    const reserve = await ethers.deployContract("PeripheryReserveMock", [false, true]);
    const token = await createToken(bond, reserve.target, "ASSET");
    await reserve.approve(periphery.target, 10n);

    await expect(
      periphery.mintWithReserveAmount(token.target, 10n, 3n, receiver.address)
    ).to.be.revertedWithCustomError(periphery, "SafeERC20FailedOperation").withArgs(reserve.target);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await reserve.balanceOf(owner.address)).to.equal(1000n);
  });
});
