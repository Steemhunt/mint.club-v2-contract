const web3 = require('web3');

exports.MAX_INT_256 = 2n**256n - 1n;
exports.NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
exports.ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

exports.PROTOCOL_BENEFICIARY = '0x00000B655d573662B9921e14eDA96DBC9311fDe6'; // a random address for testing
exports.MAX_ROYALTY_RANGE = 5000n; // 50%
exports.MAX_STEPS = 1000;
const PROTOCOL_CUT = 2000n; // 20% of the royalty

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

exports.calculateMint = function(tokensToMint, stepPrice, royaltyRatio) {
  const reserveToBond = tokensToMint * stepPrice / 10n**18n; // assume BASE token has 18 decimals
  const royalty = reserveToBond * royaltyRatio / 10000n;
  const protocolCut = royalty * PROTOCOL_CUT / 10000n;
  const creatorCut = royalty - protocolCut;
  const reserveRequired = reserveToBond + royalty;

  return { royalty, creatorCut, protocolCut, reserveToBond, reserveRequired };
};

exports.calculateBurn = function(tokensToBurn, stepPrice, royaltyRatio) {
  const reserveFromBond = tokensToBurn * stepPrice / 10n**18n; // assume BASE token has 18 decimals
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
