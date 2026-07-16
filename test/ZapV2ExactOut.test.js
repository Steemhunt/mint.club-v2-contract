const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { wei } = require("./utils/test-utils");

describe("MCV2_ZapV2 exact-output flows", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const tokenImplementation = await ethers.deployContract("MCV2_Token");
    const multiTokenImplementation = await ethers.deployContract(
      "MCV2_MultiToken"
    );
    const weth = await ethers.deployContract("WETH9");
    const bond = await ethers.deployContract("MCV2_Bond", [
      tokenImplementation.target,
      multiTokenImplementation.target,
      owner.address,
      0,
      1000,
    ]);
    const router = await ethers.deployContract("MockUniversalRouter");
    const zap = await ethers.deployContract("MCV2_ZapV2", [
      bond.target,
      weth.target,
      router.target,
    ]);
    const inputToken = await ethers.deployContract("TestToken", [
      wei(1000000, 9),
      "Input Token",
      "INPUT",
      9,
    ]);
    const outputToken = await ethers.deployContract("TestToken", [
      wei(1000000, 9),
      "Output Token",
      "OUTPUT",
      9,
    ]);

    await bond.createToken(
      { name: "Exact Output Token", symbol: "EXACT" },
      {
        mintRoyalty: 100,
        burnRoyalty: 150,
        reserveToken: weth.target,
        maxSupply: wei(4000),
        stepRanges: [wei(1000), wei(2000), wei(4000)],
        stepPrices: [wei(1, 15), wei(2, 15), wei(4, 15)],
      }
    );

    const mcToken = await ethers.getContractAt(
      "MCV2_Token",
      await bond.tokens(0)
    );

    return {
      owner,
      alice,
      bob,
      bond,
      weth,
      router,
      zap,
      inputToken,
      outputToken,
      mcToken,
    };
  }

  function findEvent(receipt, contract, name) {
    const log = receipt.logs.find((item) => {
      try {
        return contract.interface.parseLog(item)?.name === name;
      } catch {
        return false;
      }
    });
    return contract.interface.parseLog(log).args;
  }

  async function mintExactWithEth(fixture, tokensOut, receiver) {
    const { bond, zap, mcToken, alice } = fixture;
    const [reserveRequired] = await bond.getReserveForToken(
      mcToken.target,
      tokensOut
    );
    const maxInput = reserveRequired + wei(1);

    const tx = await zap
      .connect(alice)
      .zapMintExactOut(
        mcToken.target,
        ethers.ZeroAddress,
        tokensOut,
        maxInput,
        "0x",
        [],
        0,
        receiver,
        { value: maxInput }
      );

    return { receipt: await tx.wait(), reserveRequired };
  }

  it("keeps exact-input minting accurate across curve steps", async function () {
    const fixture = await loadFixture(deployFixture);
    const { alice, bond, zap, mcToken } = fixture;
    const inputAmount = wei(3);
    const [estimatedTokens, estimatedReserve] = await zap.estimateZapMint(
      mcToken.target,
      inputAmount
    );
    const [nextReserve] = await bond.getReserveForToken(
      mcToken.target,
      estimatedTokens + 1n
    );

    const tx = await zap
      .connect(alice)
      .zapMint(
        mcToken.target,
        ethers.ZeroAddress,
        inputAmount,
        1,
        "0x",
        [],
        0,
        alice.address,
        { value: inputAmount }
      );
    const event = findEvent(await tx.wait(), zap, "ZapMint");

    expect(await mcToken.balanceOf(alice.address)).to.equal(estimatedTokens);
    expect(event.reserveUsed).to.equal(estimatedReserve);
    expect(estimatedReserve).to.be.lte(inputAmount);
    expect(nextReserve).to.be.gt(inputAmount);
  });

  it("mints the exact MC amount with ETH and refunds the unused maximum", async function () {
    const fixture = await loadFixture(deployFixture);
    const { alice, bob, zap, mcToken } = fixture;
    const tokensOut = wei(1500);

    const { receipt, reserveRequired } = await mintExactWithEth(
      fixture,
      tokensOut,
      bob.address
    );
    const event = findEvent(receipt, zap, "ZapMint");

    expect(await mcToken.balanceOf(bob.address)).to.equal(tokensOut);
    expect(event.inputAmount).to.equal(reserveRequired);
    expect(event.tokensReceived).to.equal(tokensOut);
    expect(await ethers.provider.getBalance(zap.target)).to.equal(0);
    expect(await fixture.weth.balanceOf(zap.target)).to.equal(0);
    expect(await mcToken.balanceOf(alice.address)).to.equal(0);
  });

  it("mints exact output through the router and refunds unused input tokens", async function () {
    const fixture = await loadFixture(deployFixture);
    const { owner, alice, bob, bond, weth, router, zap, inputToken, mcToken } =
      fixture;
    const tokensOut = wei(500);
    const [reserveRequired] = await bond.getReserveForToken(
      mcToken.target,
      tokensOut
    );
    const maxInput = wei(1000, 9);
    const inputUsed = wei(375, 9);

    await weth.connect(owner).deposit({ value: reserveRequired });
    await weth.connect(owner).transfer(router.target, reserveRequired);
    await inputToken.connect(owner).transfer(alice.address, maxInput);
    await inputToken.connect(alice).approve(zap.target, maxInput);
    await router.configure(
      inputToken.target,
      weth.target,
      inputUsed,
      reserveRequired
    );

    const inputBefore = await inputToken.balanceOf(alice.address);
    const tx = await zap
      .connect(alice)
      .zapMintExactOut(
        mcToken.target,
        inputToken.target,
        tokensOut,
        maxInput,
        "0x01",
        ["0x"],
        0,
        bob.address
      );
    const receipt = await tx.wait();
    const event = findEvent(receipt, zap, "ZapMint");

    expect(inputBefore - (await inputToken.balanceOf(alice.address))).to.equal(
      inputUsed
    );
    expect(await mcToken.balanceOf(bob.address)).to.equal(tokensOut);
    expect(event.inputAmount).to.equal(inputUsed);
    expect(await inputToken.balanceOf(zap.target)).to.equal(0);
    expect(await weth.balanceOf(zap.target)).to.equal(0);
  });

  it("burns the minimum MC amount for an exact direct ETH output", async function () {
    const fixture = await loadFixture(deployFixture);
    const { alice, bob, bond, zap, mcToken } = fixture;
    await mintExactWithEth(fixture, wei(1500), alice.address);

    const outputAmount = wei(250, 15);
    const tokensToBurn = await zap.estimateZapBurnExactOut(
      mcToken.target,
      outputAmount
    );
    const [refund] = await bond.getRefundForTokens(
      mcToken.target,
      tokensToBurn
    );
    const [previousRefund] = await bond.getRefundForTokens(
      mcToken.target,
      tokensToBurn - 1n
    );
    expect(refund).to.be.gte(outputAmount);
    expect(previousRefund).to.be.lt(outputAmount);

    await mcToken.connect(alice).approve(zap.target, tokensToBurn);
    const receiverBefore = await ethers.provider.getBalance(bob.address);
    const tx = await zap
      .connect(alice)
      .zapBurnExactOut(
        mcToken.target,
        tokensToBurn,
        ethers.ZeroAddress,
        outputAmount,
        outputAmount,
        "0x",
        [],
        0,
        bob.address
      );
    const receipt = await tx.wait();
    const event = findEvent(receipt, zap, "ZapBurn");

    expect(
      (await ethers.provider.getBalance(bob.address)) - receiverBefore
    ).to.equal(outputAmount);
    expect(event.tokensBurned).to.equal(tokensToBurn);
    expect(event.outputAmount).to.equal(outputAmount);
  });

  it("finds the minimum burn across multiple curve steps and royalty rounding", async function () {
    const fixture = await loadFixture(deployFixture);
    const { alice, bond, zap, mcToken } = fixture;
    await mintExactWithEth(fixture, wei(3000), alice.address);

    const reserveTargets = [1n, wei(500, 15), wei(2500, 15), wei(6000, 15)];
    for (const reserveTarget of reserveTargets) {
      const tokensToBurn = await zap.estimateZapBurnExactOut(
        mcToken.target,
        reserveTarget
      );
      const [refund] = await bond.getRefundForTokens(
        mcToken.target,
        tokensToBurn
      );

      expect(refund).to.be.gte(reserveTarget);
      if (tokensToBurn > 1n) {
        const [previousRefund] = await bond.getRefundForTokens(
          mcToken.target,
          tokensToBurn - 1n
        );
        expect(previousRefund).to.be.lt(reserveTarget);
      }
    }
  });

  it("burns enough for the routed reserve maximum and refunds unused reserve", async function () {
    const fixture = await loadFixture(deployFixture);
    const { owner, alice, bob, bond, weth, router, zap, outputToken, mcToken } =
      fixture;
    await mintExactWithEth(fixture, wei(1500), alice.address);

    const outputAmount = wei(100, 9);
    const maxReserveAmount = wei(400, 15);
    const reserveUsed = wei(275, 15);
    const tokensToBurn = await zap.estimateZapBurnExactOut(
      mcToken.target,
      maxReserveAmount
    );
    const [reserveReceived] = await bond.getRefundForTokens(
      mcToken.target,
      tokensToBurn
    );

    await outputToken.connect(owner).transfer(router.target, outputAmount);
    await router.configure(
      weth.target,
      outputToken.target,
      reserveUsed,
      outputAmount
    );
    await mcToken.connect(alice).approve(zap.target, tokensToBurn);

    const reserveBefore = await weth.balanceOf(alice.address);
    const outputBefore = await outputToken.balanceOf(bob.address);
    await zap
      .connect(alice)
      .zapBurnExactOut(
        mcToken.target,
        tokensToBurn,
        outputToken.target,
        outputAmount,
        maxReserveAmount,
        "0x01",
        ["0x"],
        0,
        bob.address
      );

    expect((await outputToken.balanceOf(bob.address)) - outputBefore).to.equal(
      outputAmount
    );
    expect((await weth.balanceOf(alice.address)) - reserveBefore).to.equal(
      reserveReceived - reserveUsed
    );
    expect(await weth.balanceOf(zap.target)).to.equal(0);
  });

  it("enforces max input, max burn, and exact router output", async function () {
    const fixture = await loadFixture(deployFixture);
    const { owner, alice, bond, weth, router, zap, inputToken, mcToken } =
      fixture;
    const tokensOut = wei(500);
    const [reserveRequired] = await bond.getReserveForToken(
      mcToken.target,
      tokensOut
    );

    await expect(
      zap
        .connect(alice)
        .zapMintExactOut(
          mcToken.target,
          ethers.ZeroAddress,
          tokensOut,
          reserveRequired - 1n,
          "0x",
          [],
          0,
          alice.address,
          { value: reserveRequired - 1n }
        )
    ).to.be.revertedWithCustomError(zap, "MCV2_ZapV2__SlippageLimitExceeded");

    const maxInput = wei(1000, 9);
    await weth.connect(owner).deposit({ value: reserveRequired - 1n });
    await weth.connect(owner).transfer(router.target, reserveRequired - 1n);
    await inputToken.connect(owner).transfer(alice.address, maxInput);
    await inputToken.connect(alice).approve(zap.target, maxInput);
    await router.configure(
      inputToken.target,
      weth.target,
      wei(300, 9),
      reserveRequired - 1n
    );
    await expect(
      zap
        .connect(alice)
        .zapMintExactOut(
          mcToken.target,
          inputToken.target,
          tokensOut,
          maxInput,
          "0x01",
          ["0x"],
          0,
          alice.address
        )
    ).to.be.revertedWithCustomError(zap, "MCV2_ZapV2__ExactOutputMismatch");

    await mintExactWithEth(fixture, wei(1500), alice.address);
    const reserveTarget = wei(200, 15);
    const tokensToBurn = await zap.estimateZapBurnExactOut(
      mcToken.target,
      reserveTarget
    );
    await mcToken.connect(alice).approve(zap.target, tokensToBurn);
    await expect(
      zap
        .connect(alice)
        .zapBurnExactOut(
          mcToken.target,
          tokensToBurn - 1n,
          ethers.ZeroAddress,
          reserveTarget,
          reserveTarget,
          "0x",
          [],
          0,
          alice.address
        )
    ).to.be.revertedWithCustomError(zap, "MCV2_ZapV2__SlippageLimitExceeded");
  });
});
