// Offline preparation profile. No dotenv, real keys, RPCs, or remote networks.
// Keep compiler settings aligned with hardhat.config.js for production bytecode.
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.30",
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 50000 },
          viaIR: true,
        },
      },
      {
        version: "0.8.20",
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 50000 },
        },
      },
      { version: "0.4.18" },
    ],
    overrides: {
      "contracts/MCV2_ZapV2.sol": {
        version: "0.8.20",
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 50000 },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 99901,
      hardfork: "cancun",
      // Measurement ceiling, NOT a claimed Elysium transaction/block limit.
      blockGasLimit: 60000000,
    },
  },
  paths: {
    cache: "./cache-elysium-local",
    artifacts: "./artifacts-elysium-local",
  },
  gasReporter: { enabled: false },
  mocha: { timeout: 120000 },
};
