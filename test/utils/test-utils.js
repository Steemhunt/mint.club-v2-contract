const web3 = require("web3");

exports.MAX_INT_256 = 2n ** 256n - 1n;
exports.NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
exports.ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
exports.DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

exports.PROTOCOL_BENEFICIARY = "0x00000B655d573662B9921e14eDA96DBC9311fDe6"; // a random address for testing
exports.MAX_ROYALTY_RANGE = 5000n; // 50%
const PROTOCOL_CUT = 2000n; // 20% of the royalty

exports.getCreationFee = function (network) {
  // Collect a little bit of asset creation fee to prevent spam
  const CREATION_FEE = {
    mainnet: 2n * 10n ** 15n, // 0.002 ETH (~$6)
    optimisticEthereum: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    arbitrumOne: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    base: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    polygon: 8n * 10n ** 18n, // 8 MATIC (~$2) - TODO: should update existing bond
    bsc: 5n * 10n ** 15n, // 0.005 BNB (~$2)
    avalanche: 5n * 10n ** 16n, // 0.05 AVAX (~$2)
    blast: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    degen: 50n * 10n ** 18n, // 50 DEGEN (~$2)
    zora: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    klaytn: 8n * 10n ** 18n, // 8 KLAY (~$2)
    cyber: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    ham: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    apechain: 10n ** 18n, // 1.0 APE (~$1.6)
    shibarium: 5n * 10n ** 18n, // 5 BONE (~$2)
    hashkey: 10n ** 18n, // 1 HSK (~$2)
    unichain: 7n * 10n ** 14n, // 0.0007 ETH (~$2)
    over: 50n * 10n ** 18n, // 50 OVER (~$1.4)
    // Testnets
    sepolia: 7n * 10n ** 14n, // 0.007 ETH - testnet
    baseSepolia: 0n, // 0 ETH - testnet
    blastSepolia: 0n, // 0 ETH - testnet
    avalancheFujiTestnet: 0n, // 0 ETH - testnet
    movementDevnet: 0n, // 0 MOVE - testnet
    cyberTestnet: 0n, // 0 ETH - testnet
    overTestnet: 0n, // 0 ETH - testnet
    puppynet: 0n, // 0 BONE - testnet
  };

  if (CREATION_FEE[network] === undefined) {
    throw new Error(`CREATION_FEE is not defined for ${network}`);
  }

  return CREATION_FEE[network];
};

exports.getWETHAddress = function (network) {
  const WETH_ADDRESS = {
    mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    optimisticEthereum: "0x4200000000000000000000000000000000000006", // WETH
    arbitrumOne: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
    base: "0x4200000000000000000000000000000000000006", // WETH
    polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
    bsc: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    avalanche: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", // WAVAX
    blast: "0x4300000000000000000000000000000000000004", // WETH
    degen: "0xEb54dACB4C2ccb64F8074eceEa33b5eBb38E5387", // WDEGEN - deployed ourselves
    zora: "0x4200000000000000000000000000000000000006", // WETH
    klaytn: "0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432", // WKLAY - (ref: https://hrl.sh/g6ccv7)
    cyber: "0x4200000000000000000000000000000000000006", // WETH
    ham: "0x4200000000000000000000000000000000000006", // WETH
    apechain: "0x48b62137EdfA95a428D35C09E44256a739F6B557", // WAPE
    shibarium: "0xC76F4c819D820369Fb2d7C1531aB3Bb18e6fE8d8", // WBONE
    hashkey: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1", // WHSK
    unichain: "0x4200000000000000000000000000000000000006", // WETH
    over: "0x59c914C8ac6F212bb655737CC80d9Abc79A1e273", // WOVER
    // Testnets
    sepolia: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // WETH
    baseSepolia: "0x4200000000000000000000000000000000000006", // WETH
    blastSepolia: "0x4200000000000000000000000000000000000023", // WETH (yield accumulating)
    avalancheFujiTestnet: "0xd00ae08403B9bbb9124bB305C09058E32C39A48c", // WAVAX
    movementDevnet: "0x4200000000000000000000000000000000000023", // FIXME: WMOVE?
    cyberTestnet: "0xf760686C2b40F7C526D040b979641293D2F55816", // WETH - TODO: double check
    overTestnet: "0x2eFE8DBa880813F1d988208Ad35c184593559a9D", // Wrapped OVER
    puppynet: "0x41c3F37587EBcD46C0F85eF43E38BcfE1E70Ab56", // WBONE
  };

  if (!WETH_ADDRESS[network]) {
    throw new Error(`WETH_ADDRESS is not defined for ${network}`);
  }

  return WETH_ADDRESS[network];
};

exports.getBondAddress = function (network) {
  const BOND_ADDRESS = {
    mainnet: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    optimisticEthereum: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    arbitrumOne: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    base: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    bsc: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    polygon: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    blast: "0x621c335b4BD8f2165E120DC70d3AfcAfc6628681",
    avalanche: "0x3Fd5B4DcDa968C8e22898523f5343177F94ccfd1",
    degen: "0x3bc6B601196752497a68B2625DB4f2205C3b150b",
    zora: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    kaia: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    cyber: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    ham: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    apechain: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    shibarium: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    hashkey: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    unichain: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    over: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
    sepolia: "0x8dce343A86Aa950d539eeE0e166AFfd0Ef515C0c",
    baseSepolia: "0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d",
    // skip other testnets
  };
  if (!BOND_ADDRESS[network]) {
    throw new Error(`BOND_ADDRESS is not defined for ${network}`);
  }

  return BOND_ADDRESS[network];
};

exports.getMaxSteps = function (network) {
  // 1,000 steps reqruies about 15M gas
  const MAX_STEPS = {
    mainnet: 1000n, // 30M gas limit
    optimisticEthereum: 1000n, // 30M gas limit
    arbitrumOne: 1000n, // over 30M gas limit
    base: 1000n, // 30M gas limit
    polygon: 1000n, // 30M gas limit
    bsc: 1000n, // 30M gas limit
    avalanche: 1000n, // 15M gas limit
    blast: 1000n, // 30M gas limit
    degen: 1000n, // 30M gas limit
    zora: 1000n, // 30M gas limit
    klaytn: 1000n, // 100M execution cost (ref: https://hrl.sh/eylozo)
    cyber: 1000n, // 30M gas limit
    ham: 1000n, // 30M gas limit
    apechain: 1000n, // 1T gas limit??
    shibarium: 1000n, // 20M gas limit
    hashkey: 1000n, // 30M gas limit
    unichain: 1000n, // 30M gas limit
    over: 1000n, // 30M gas limit
    // Testnets
    sepolia: 1000n, // 30M gas limit
    baseSepolia: 1000n, // 30M gas limit
    blastSepolia: 1000n, // 30M gas limit
    avalancheFujiTestnet: 1000n, // ? gas limit
    movementDevnet: 1000n, // ? gas limit
    cyberTestnet: 1000n, // ? gas limit
    overTestnet: 1000n, // ? gas limit
    puppynet: 1000n, // ? gas limit
  };
  if (!MAX_STEPS[network]) {
    throw new Error(`MAX_STEPS is not defined for ${network}`);
  }

  return MAX_STEPS[network];
};

exports.wei = function (num, decimals = 18) {
  return BigInt(num) * 10n ** BigInt(decimals);
};

exports.modifiedValues = function (object, overrides) {
  return Object.values(Object.assign({}, object, overrides));
};

// Calculate deterministic address for create2
// NOTE: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L68
exports.computeCreate2Address = function (saltHex, implementation, deployer) {
  const creationCode = [
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
    implementation.replace(/0x/, "").toLowerCase(),
    "5af43d82803e903d91602b57fd5bf3",
  ].join("");

  return web3.utils.toChecksumAddress(
    `0x${web3.utils
      .sha3(
        `0x${["ff", deployer, saltHex, web3.utils.soliditySha3(creationCode)]
          .map((x) => x.replace(/0x/, ""))
          .join("")}`
      )
      .slice(-40)}`
  );
};

exports.calculateMint = function (
  tokensToMint,
  stepPrice,
  royaltyRatio,
  tokenDecimals = 18n
) {
  const reserveToBond = (tokensToMint * stepPrice) / 10n ** tokenDecimals; // assume BASE token has 18 decimals
  const royalty = (reserveToBond * royaltyRatio) / 10000n;
  const protocolCut = (royalty * PROTOCOL_CUT) / 10000n;
  const creatorCut = royalty - protocolCut;
  const reserveRequired = reserveToBond + royalty;

  return { royalty, creatorCut, protocolCut, reserveToBond, reserveRequired };
};

exports.calculateBurn = function (
  tokensToBurn,
  stepPrice,
  royaltyRatio,
  tokenDecimals = 18n
) {
  const reserveFromBond = (tokensToBurn * stepPrice) / 10n ** tokenDecimals; // assume BASE token has 18 decimals
  const royalty = (reserveFromBond * royaltyRatio) / 10000n;
  const protocolCut = (royalty * PROTOCOL_CUT) / 10000n;
  const creatorCut = royalty - protocolCut;
  const reserveToRefund = reserveFromBond - royalty; // after fee -

  return { royalty, creatorCut, protocolCut, reserveFromBond, reserveToRefund };
};

exports.calculateRoyalty = function (reserveAmount, royaltyRatio) {
  const total = (reserveAmount * royaltyRatio) / 10000n;
  const protocolCut = (total * PROTOCOL_CUT) / 10000n;
  const creatorCut = total - protocolCut;

  return { total, creatorCut, protocolCut };
};
