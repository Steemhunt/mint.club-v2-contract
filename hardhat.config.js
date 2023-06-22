require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
require("solidity-coverage");

module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 50000
      }
    }
  },
  networks: {
    goerli: {
      url: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_GOERLI_API_KEY}`,
      chainId: 5,
      accounts: [process.env.GOERLI_TEST_PRIVATE_KEY]
    },
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 15,
    coinmarketcap: process.env.COIN_MARKET_CAP_API
  },
  etherscan: {
    // network list: npx hardhat verify --list-networks
    apiKey: {
      goerli: process.env.ETHERSCAN_API_KEY
    }
  }
};
