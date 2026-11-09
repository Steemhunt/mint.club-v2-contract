const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { readElysiumDeploymentSettings } = require("../config/elysium.cjs");

describe("Elysium local preparation (not a live-chain compatibility test)", function () {
  const gas = {};

  before(async function () {
    expect(network.name, "this suite must never send to a remote network").to.equal("hardhat");
    expect(network.config.forking, "this suite must be offline").to.equal(undefined);
    expect((await ethers.provider.getNetwork()).chainId).to.equal(99901n);
  });

  async function deployed() {
    const [creator, buyer, receiver, beneficiary] = await ethers.getSigners();
    const deploy = async (name, args = []) => {
      const contract = await ethers.deployContract(name, args);
      const receipt = await contract.deploymentTransaction().wait();
      gas[`deploy.${name}`] = receipt.gasUsed.toString();
      const code = await ethers.provider.getCode(contract.target);
      expect((code.length - 2) / 2, `${name} EIP-170 runtime size`).to.be.at.most(24576);
      return contract;
    };
    const token = await deploy("MCV2_Token");
    await (await token.init("Token Implementation", "TOKEN_PLACEHOLDER")).wait();
    const nft = await deploy("MCV2_MultiToken");
    await (await nft.init("MultiToken Implementation", "MULTI_TOKEN_PLACEHOLDER", "")).wait();
    const bond = await deploy("MCV2_Bond", [token.target, nft.target, beneficiary.address, 0n, 1000n]);
    const wrapper = await deploy("WETH9");
    const zap = await deploy("MCV2_ZapV1", [bond.target, wrapper.target]);
    await deploy("Locker");
    await deploy("MerkleDistributor");
    return { creator, buyer, receiver, beneficiary, bond, wrapper, zap };
  }

  for (const isERC20 of [true, false]) {
    const label = isERC20 ? "ERC20" : "ERC1155";
    for (const count of [3, 1000]) {
      it(`${label}: create ${count} steps, native mint with overpayment refund, full burn`, async function () {
        const { buyer, receiver, bond, wrapper, zap } = await loadFixture(deployed);
        const scale = isERC20 ? 10n ** 18n : 1n;
        const stepRanges = Array.from({ length: count }, (_, i) => BigInt(i + 1) * scale);
        const stepPrices = Array.from({ length: count }, (_, i) => BigInt(i + 1) * 10n ** 12n);
        const amount = stepRanges.at(-1);
        const params = {
          mintRoyalty: 100n,
          burnRoyalty: 150n,
          reserveToken: wrapper.target,
          maxSupply: amount,
          stepRanges,
          stepPrices,
        };
        const tokenParams = { name: `Local ${label}`, symbol: `LOCAL${count}` };
        const create = isERC20
          ? await bond.createToken(tokenParams, params, { gasLimit: 55000000 })
          : await bond.createMultiToken({ ...tokenParams, uri: "ipfs://local-readiness" }, params, { gasLimit: 55000000 });
        gas[`${label}.${count}.create`] = (await create.wait()).gasUsed.toString();
        const tokenAddress = await bond.tokens(0);
        const token = await ethers.getContractAt(isERC20 ? "MCV2_Token" : "MCV2_MultiToken", tokenAddress);
        expect((await bond.getSteps(tokenAddress)).length).to.equal(count);

        const [cost] = await bond.getReserveForToken(tokenAddress, amount);
        const before = await ethers.provider.getBalance(buyer.address);
        const mint = await zap.connect(buyer).mintWithEth(tokenAddress, amount, buyer.address, {
          value: cost + ethers.parseEther("1"),
          gasLimit: 55000000,
        });
        const mintReceipt = await mint.wait();
        gas[`${label}.${count}.nativeMint`] = mintReceipt.gasUsed.toString();
        const after = await ethers.provider.getBalance(buyer.address);
        expect(before - after - mintReceipt.fee, "overpayment must return to buyer").to.equal(cost);
        expect(await ethers.provider.getBalance(zap.target)).to.equal(0n);
        expect(await wrapper.balanceOf(zap.target)).to.equal(0n);
        expect(isERC20 ? await token.balanceOf(buyer.address) : await token.balanceOf(buyer.address, 0)).to.equal(amount);

        if (isERC20) await (await token.connect(buyer).approve(zap.target, amount)).wait();
        else await (await token.connect(buyer).setApprovalForAll(zap.target, true)).wait();
        const [refund] = await bond.getRefundForTokens(tokenAddress, amount);
        const receiverBefore = await ethers.provider.getBalance(receiver.address);
        const burn = await zap.connect(buyer).burnToEth(tokenAddress, amount, refund, receiver.address, { gasLimit: 55000000 });
        gas[`${label}.${count}.nativeBurn`] = (await burn.wait()).gasUsed.toString();
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(receiverBefore + refund);
        expect(await token.totalSupply()).to.equal(0n);
        expect((await bond.tokenBond(tokenAddress)).reserveBalance).to.equal(0n);
        expect(await ethers.provider.getBalance(zap.target)).to.equal(0n);
        expect(await wrapper.balanceOf(zap.target)).to.equal(0n);
      });
    }
  }

  it("requires explicit deployment economics and nonzero addresses", function () {
    const env = {
      ELYSIUM_PROTOCOL_BENEFICIARY: "0x0000000000000000000000000000000000000001",
      ELYSIUM_WRAPPED_NATIVE: "0x0000000000000000000000000000000000000002",
      ELYSIUM_CREATION_FEE_HYPE: "0",
      ELYSIUM_MAX_STEPS: "1000",
    };
    expect(readElysiumDeploymentSettings(env).creationFeeWei).to.equal(0n);
    for (const key of Object.keys(env)) {
      expect(() => readElysiumDeploymentSettings({ ...env, [key]: undefined }), key).to.throw();
    }
    expect(() => readElysiumDeploymentSettings({ ...env, ELYSIUM_CREATION_FEE_HYPE: "-1" })).to.throw();
    expect(() => readElysiumDeploymentSettings({ ...env, ELYSIUM_MAX_STEPS: "1001" })).to.throw();
    expect(() => readElysiumDeploymentSettings({ ...env, ELYSIUM_PROTOCOL_BENEFICIARY: ethers.ZeroAddress })).to.throw();
  });

  after(function () {
    console.log("LOCAL_GAS_MEASUREMENTS=" + JSON.stringify(gas));
    console.log("Local Cancun VM, Paris bytecode, mock WETH9, no fork. Elysium's gas schedule/limits and real WHYPE remain to be validated.");
  });
});
