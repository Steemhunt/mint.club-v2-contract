require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
require('solidity-coverage');

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.20',
        settings: {
          optimizer: {
            enabled: true,
            runs: 50000
          }
        }
      },
      {
        version: '0.4.18', // For WETH mock contract
      }
    ]
  },
  networks: {
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_SEPOLIA_API_KEY}`,
      chainId: 11155111,
      accounts: [process.env.TEST_PRIVATE_KEY]
    },
    base: {
      url: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_BASE_API_KEY}`,
      chainId: 8453,
      accounts: [process.env.TEST_PRIVATE_KEY]
    },
    bsc: {
      url: 'https://bsc-dataseed.bnbchain.org',
      chainId: 56,
      accounts: [process.env.TEST_PRIVATE_KEY]
    }
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 15,
    coinmarketcap: null // process.env.COIN_MARKET_CAP_API
  },
  sourcify: {
    enabled: true
  },
  etherscan: {
    // network list: npx hardhat verify --list-networks
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
      base: process.env.BASESCAN_API_KEY,
      bsc: process.env.BSCSCAN_API_KEY
    }
  }
};
