const web3 = require('web3');

exports.MAX_INT_256 = 2n**256n - 1n;
exports.NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
exports.ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
exports.DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

exports.PROTOCOL_BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
exports.MAX_ROYALTY_RANGE = 5000n; // 50%
const PROTOCOL_CUT = 2000n; // 20% of the royalty

exports.getCreationFee = function(network) {
  // Collect ~ $5 of asset creation fee to prevent spam
  const CREATION_FEE = {
    mainnet: 2n*10n**15n, // 0.002 ETH
    optimisticEthereum: 2n*10n**15n, // 0.002 ETH
    arbitrumOne: 2n*10n**15n, // 0.002 ETH
    base: 2n*10n**15n, // 0.002 ETH
    sepolia: 0n, // 0 ETH - testnet
    polygon: 5n*10n**18n, // 5 MATIC
    bsc: 15n*10n**15n, // 0.015 BNB
  };

  if (!CREATION_FEE[network]) {
    throw new Error(`CREATION_FEE is not defined for ${network}`);
  }

  return CREATION_FEE[network];
}

exports.getWETHAddress = function(network) {
  const WETH_ADDRESS = {
    mainnet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    optimisticEthereum: '0x4200000000000000000000000000000000000006', // WETH
    arbitrumOne: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    base: '0x4200000000000000000000000000000000000006', // WETH
    sepolia: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // WETH
    polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    bsc: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  };

  if (!WETH_ADDRESS[network]) {
    throw new Error(`WETH_ADDRESS is not defined for ${network}`);
  }

  return WETH_ADDRESS[network];
};

exports.getMaxSteps = function(network) {
  // 1,000 steps reqruies about 15M gas
  const MAX_STEPS = {
    mainnet: 1000n, // 30M gas limit
    optimisticEthereum: 1000n, // 30M gas limit
    arbitrumOne: 1000n, // over 30M gas limit
    base: 1000n, // 30M gas limit
    sepolia: 1000n, // 30M gas limit
    polygon: 1000n, // 30M gas limit
    bsc: 1000n // 30M gas limit
  };
  if (!MAX_STEPS[network]) {
    throw new Error(`MAX_STEPS is not defined for ${network}`);
  }

  return MAX_STEPS[network];
};

exports.wei = function(num, decimals = 18) {
  return BigInt(num) * 10n**BigInt(decimals);
};

exports.modifiedValues = function(object, overrides) {
  return Object.values(Object.assign({}, object, overrides));
};

// Calculate deterministic address for create2
// NOTE: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L68
exports.computeCreate2Address = function(saltHex, implementation, deployer) {
  const creationCode = [
    '0x3d602d80600a3d3981f3363d3d373d3d3d363d73',
    implementation.replace(/0x/, '').toLowerCase(),
    '5af43d82803e903d91602b57fd5bf3',
  ].join('');

  return web3.utils.toChecksumAddress(
    `0x${web3.utils
      .sha3(`0x${['ff', deployer, saltHex, web3.utils.soliditySha3(creationCode)].map(x => x.replace(/0x/, '')).join('')}`)
      .slice(-40)}`,
  );
};

exports.calculateMint = function(tokensToMint, stepPrice, royaltyRatio, tokenDecimals = 18n) {
  const reserveToBond = tokensToMint * stepPrice / 10n**tokenDecimals; // assume BASE token has 18 decimals
  const royalty = reserveToBond * royaltyRatio / 10000n;
  const protocolCut = royalty * PROTOCOL_CUT / 10000n;
  const creatorCut = royalty - protocolCut;
  const reserveRequired = reserveToBond + royalty;

  return { royalty, creatorCut, protocolCut, reserveToBond, reserveRequired };
};

exports.calculateBurn = function(tokensToBurn, stepPrice, royaltyRatio, tokenDecimals = 18n) {
  const reserveFromBond = tokensToBurn * stepPrice / 10n**tokenDecimals; // assume BASE token has 18 decimals
  const royalty = reserveFromBond * royaltyRatio / 10000n;
  const protocolCut = royalty * PROTOCOL_CUT / 10000n;
  const creatorCut = royalty - protocolCut;
  const reserveToRefund = reserveFromBond - royalty; // after fee -

  return { royalty, creatorCut, protocolCut, reserveFromBond, reserveToRefund };
};

exports.calculateRoyalty = function(reserveAmount, royaltyRatio) {
  const total = reserveAmount * royaltyRatio / 10000n;
  const protocolCut = total * PROTOCOL_CUT / 10000n;
  const creatorCut = total - protocolCut;

  return { total, creatorCut, protocolCut };
};
