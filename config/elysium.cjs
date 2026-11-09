const { getAddress, ZeroAddress, parseEther } = require("ethers");

const ELYSIUM = Object.freeze({
  chainId: 99901,
  nativeSymbol: "HYPE",
  nativeDecimals: 18,
  publicRpcUrl: "https://rpc.elysium.kinetiq.xyz",
  // Public Uniswap deployment PR evidence only; validate live before use.
  wrappedNativeCandidate: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
  wrappedNativeSource:
    "https://github.com/Uniswap/contracts/blob/8e258847e42c59a59228a885c320a7eec99c6871/deployments/json/99901.json",
});

function addressSetting(env, key) {
  if (!env[key]) throw new Error(`${key} is required`);
  const address = getAddress(env[key]);
  if (address === ZeroAddress) throw new Error(`${key} cannot be zero`);
  return address;
}

// A plan only. Nothing here loads a signer, broadcasts, or treats candidates as verified.
function readElysiumDeploymentSettings(env = process.env) {
  const beneficiary = addressSetting(env, "ELYSIUM_PROTOCOL_BENEFICIARY");
  const wrappedNative = addressSetting(env, "ELYSIUM_WRAPPED_NATIVE");
  const fee = env.ELYSIUM_CREATION_FEE_HYPE;
  if (fee === undefined || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(fee)) {
    throw new Error("ELYSIUM_CREATION_FEE_HYPE must be an explicit non-negative decimal (up to 18 places)");
  }
  const steps = env.ELYSIUM_MAX_STEPS;
  if (!steps || !/^[1-9]\d*$/.test(steps) || BigInt(steps) > 1000n) {
    throw new Error("ELYSIUM_MAX_STEPS must be an explicit integer from 1 to 1000; confirm the live transaction gas limit first");
  }
  return {
    chainId: ELYSIUM.chainId,
    nativeSymbol: ELYSIUM.nativeSymbol,
    beneficiary,
    wrappedNative,
    creationFeeWei: parseEther(fee),
    maxSteps: BigInt(steps),
  };
}

module.exports = { ELYSIUM, readElysiumDeploymentSettings };
