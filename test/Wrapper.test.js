const { expect } = require("chai");
const { loadFixture, setCode } = require("@nomicfoundation/hardhat-network-helpers");

describe("MCV1_Wrapper pagination", function () {
  async function deployFixture() {
    return ethers.deployContract("MCV1_Wrapper");
  }

  for (const tokenCount of [0, 3]) {
    it(`should return empty pages at or beyond a token count of ${tokenCount}`, async function () {
      const wrapper = await loadFixture(deployFixture);
      const mock = await ethers.deployContract("WrapperPaginationMock", [tokenCount]);
      await setCode(await wrapper.BOND(), await ethers.provider.getCode(mock.target));

      expect(await wrapper.getList(tokenCount, tokenCount + 1)).to.deep.equal([]);
      expect(await wrapper.getList(tokenCount + 1, tokenCount + 2)).to.deep.equal([]);
    });
  }

  it("should retain pagination validation", async function () {
    const wrapper = await loadFixture(deployFixture);
    for (const [start, stop] of [[1, 1], [2, 1], [0, 1001]]) {
      await expect(wrapper.getList(start, stop)).to.be.revertedWithCustomError(
        wrapper,
        "MCV1_Wrapper__InvalidPaginationParameters"
      );
    }
  });
});
