#!/usr/bin/env node
// Read-only RPC checks. No wallet, dotenv loading, signing, or broadcasting.
const { Interface, isAddress, keccak256 } = require('ethers');

const CHAIN_ID = 99901n;
const DEFAULT_RPC = 'https://rpc.elysium.kinetiq.xyz';
// Candidate from Uniswap/contracts PR #179, not a substitute for canonical verification.
const CANDIDATE_WHYPE = '0xbA876237B0F021A6c6D852d6c26E107997cC5E81';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ARBSYS = '0x0000000000000000000000000000000000000064';
const PROBE_ACCOUNT = '0x000000000000000000000000000000000000dEaD';
const READ_METHODS = new Set([
  'eth_chainId', 'eth_syncing', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getCode', 'eth_call', 'eth_getLogs', 'eth_gasPrice', 'eth_feeHistory',
]);
const abi = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function deposit() payable',
  'function withdraw(uint256)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  'function arbOSVersion() view returns (uint256)',
  'function arbBlockNumber() view returns (uint256)',
]);
const quantity = (n) => `0x${BigInt(n).toString(16)}`;
const SAFE_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'AbortError', 'TimeoutError', 'TypeError', 'Error', 'VALIDATION_FAILED', 'RPC_ERROR',
]);
function safeErrorCode(error) {
  for (const code of [error?.code, error?.cause?.code, error?.name]) {
    if (Number.isSafeInteger(code)) return code;
    if (typeof code === 'string' && (SAFE_ERROR_CODES.has(code) || /^HTTP_[45]\d{2}$/.test(code))) return code;
  }
  return 'ERROR';
}

function parseOptions(args, env = process.env) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (!['--rpc', '--whype', '--historical-block', '--log-span'].includes(args[i])) {
      throw new Error('Unknown argument; use --help');
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value');
    values[args[i].slice(2)] = args[++i];
  }
  const rpc = values.rpc || env.ELYSIUM_RPC_URL || DEFAULT_RPC;
  if (!['https:', 'http:'].includes(new URL(rpc).protocol)) throw new Error('RPC must use HTTP(S)');
  const whype = values.whype || CANDIDATE_WHYPE;
  if (!isAddress(whype) || /^0x0{40}$/i.test(whype)) throw new Error('Invalid WHYPE address');
  const parseInteger = (value) => {
    if (!/^\d+$/.test(value)) throw new Error('Block options must be unsigned decimal integers');
    return BigInt(value);
  };
  const logSpan = parseInteger(values['log-span'] || '1000');
  if (logSpan < 1n || logSpan > 10000n) throw new Error('Log span must be between 1 and 10000');
  return {
    rpc, whype, logSpan,
    historicalBlock: values['historical-block'] === undefined ? undefined : parseInteger(values['historical-block']),
  };
}

function createRpcClient(url, fetcher = fetch) {
  let nextId = 0;
  const envelope = (method, params = []) => {
    if (!READ_METHODS.has(method)) throw new Error('Only allowlisted read methods are supported');
    return { jsonrpc: '2.0', id: ++nextId, method, params };
  };
  async function send(payload) {
    const response = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Object.assign(new Error('HTTP request failed'), { code: `HTTP_${response.status}` });
    return response.json();
  }
  function result(response, request) {
    if (!response || response.id !== request.id) throw new Error('RPC response ID mismatch');
    if (response.error) throw Object.assign(new Error('RPC method returned an error'), {
      code: Number.isSafeInteger(response.error.code) ? response.error.code : 'RPC_ERROR',
    });
    if (!Object.hasOwn(response, 'result')) throw new Error('RPC response has no result');
    return response.result;
  }
  return {
    async call(method, params = []) {
      const request = envelope(method, params);
      return result(await send(request), request);
    },
    async batch(calls) {
      const requests = calls.map(([method, params]) => envelope(method, params));
      const responses = await send(requests);
      if (!Array.isArray(responses) || responses.length !== requests.length) throw new Error('Invalid batch response');
      return requests.map((request) => result(responses.find((response) => response.id === request.id), request));
    },
  };
}

async function runReadiness(options, client = createRpcClient(options.rpc), now = Date.now()) {
  const report = {
    checkedAt: new Date(now).toISOString(), rpcOrigin: new URL(options.rpc).origin,
    chainId: Number(CHAIN_ID), whypeCandidate: options.whype, rpcChecksPassed: false,
    deploymentReady: false, checks: [],
    remaining: [
      'Verify canonical mainnet WHYPE and review its runtime code hash; ABI checks alone do not establish identity.',
      'Rehearse mint/burn/refunds and maximum-curve creation on a fork of this exact endpoint.',
      'Select the HYPE creation fee and protocol beneficiary; verify live per-transaction gas limits.',
      'After deployment, record receipts/start blocks and activate web with a per-chain pricing adapter or SDK 1.x backport.',
      'Historical reads at one height do not prove full archive retention or complete event delivery.',
      'Browser CORS, WebSocket behavior, HYPE pricing and indexer replay remain separate checks.',
    ],
  };
  async function check(name, required, action) {
    try {
      const value = await action();
      report.checks.push({ name, required, status: 'pass', value });
      return value;
    } catch (error) {
      // Do not print provider URLs, API keys, or arbitrary upstream error bodies.
      report.checks.push({ name, required, status: 'fail', code: safeErrorCode(error) });
      return undefined;
    }
  }
  const assert = (ok) => { if (!ok) throw Object.assign(new Error('Unexpected RPC result'), { code: 'VALIDATION_FAILED' }); };
  const identity = await check('chain-id', true, async () => {
    const value = BigInt(await client.call('eth_chainId'));
    assert(value === CHAIN_ID);
    return Number(value);
  });
  if (identity === undefined) return report;
  await check('sync-status', true, async () => {
    const value = await client.call('eth_syncing'); assert(value === false); return value;
  });
  const head = await check('latest-block', true, async () => {
    const block = await client.call('eth_getBlockByNumber', ['latest', false]);
    assert(block && /^0x[0-9a-f]{64}$/i.test(block.hash));
    const ageSeconds = Math.floor(now / 1000) - Number(BigInt(block.timestamp));
    assert(ageSeconds >= -60 && ageSeconds <= 120);
    return { number: BigInt(block.number).toString(), hash: block.hash, timestamp: Number(BigInt(block.timestamp)),
      ageSeconds, reportedGasLimit: BigInt(block.gasLimit).toString(),
      note: 'Nitro header gasLimit is not the effective per-transaction execution cap.' };
  });
  if (!head) return report;
  const headNumber = BigInt(head.number);
  const tag = quantity(headNumber);
  const call = async (to, name, args = []) => {
    const raw = await client.call('eth_call', [{ to, from: PROBE_ACCOUNT, data: abi.encodeFunctionData(name, args) }, tag]);
    return abi.decodeFunctionResult(name, raw);
  };
  await check('json-rpc-batch', true, async () => {
    const values = await client.batch([['eth_chainId', []], ['eth_blockNumber', []]]);
    assert(BigInt(values[0]) === CHAIN_ID && BigInt(values[1]) >= headNumber); return 'supported';
  });
  await check('whype-code', true, async () => {
    const code = await client.call('eth_getCode', [options.whype, tag]);
    assert(/^0x[0-9a-f]+$/i.test(code) && code.length > 2);
    return { bytes: (code.length - 2) / 2, runtimeCodeHash: keccak256(code) };
  });
  await check('whype-interface', true, async () => {
    const decimals = Number((await call(options.whype, 'decimals'))[0]);
    const symbol = (await call(options.whype, 'symbol'))[0];
    assert(decimals === 18 && symbol.toUpperCase() === 'WHYPE');
    await call(options.whype, 'deposit');
    await call(options.whype, 'withdraw', [0n]);
    return { decimals, symbol, note: 'Zero-value eth_call only; full native reserve behavior still requires fork testing.' };
  });
  await check('multicall-block-context', true, async () => {
    const code = await client.call('eth_getCode', [MULTICALL, tag]); assert(code !== '0x');
    const blockNumber = (await call(MULTICALL, 'getBlockNumber'))[0];
    const timestamp = (await call(MULTICALL, 'getCurrentBlockTimestamp'))[0];
    assert(timestamp === BigInt(head.timestamp));
    return { runtimeCodeHash: keccak256(code), evmBlockNumber: blockNumber.toString(), rpcBlockNumber: head.number,
      sameHeight: blockNumber === headNumber };
  });
  await check('arbos', false, async () => ({
    version: (await call(ARBSYS, 'arbOSVersion'))[0].toString(),
    blockNumber: (await call(ARBSYS, 'arbBlockNumber'))[0].toString(),
  }));
  await check('gas-price', true, async () => BigInt(await client.call('eth_gasPrice')).toString());
  await check('fee-history', false, async () => {
    const value = await client.call('eth_feeHistory', ['0x4', tag, [50]]);
    assert(Array.isArray(value.baseFeePerGas)); return 'supported';
  });
  await check('filtered-logs', true, async () => {
    const from = headNumber >= options.logSpan - 1n ? headNumber - options.logSpan + 1n : 0n;
    const logs = await client.call('eth_getLogs', [{ address: options.whype,
      fromBlock: quantity(from), toBlock: tag,
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
    }]);
    assert(Array.isArray(logs));
    for (const log of logs) assert(BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= headNumber &&
      log.address.toLowerCase() === options.whype.toLowerCase() && log.removed !== true);
    return { fromBlock: from.toString(), toBlock: head.number, count: logs.length,
      note: 'A successful/empty response is not proof that the provider never truncates logs.' };
  });
  const historical = options.historicalBlock ?? (headNumber > 1000n ? headNumber - 1000n : 0n);
  await check('historical-state', true, async () => {
    assert(historical < headNumber);
    const block = await client.call('eth_getBlockByNumber', [quantity(historical), false]);
    assert(block && BigInt(block.number) === historical);
    const code = await client.call('eth_getCode', [MULTICALL, quantity(historical)]); assert(code !== '0x');
    const raw = await client.call('eth_call', [{ to: MULTICALL, data: abi.encodeFunctionData('getCurrentBlockTimestamp') }, quantity(historical)]);
    const timestamp = abi.decodeFunctionResult('getCurrentBlockTimestamp', raw)[0];
    assert(timestamp === BigInt(block.timestamp));
    // Timestamp alone is insufficient: many subsecond blocks share a second.
    const arbRaw = await client.call('eth_call', [{ to: ARBSYS, data: abi.encodeFunctionData('arbBlockNumber') }, quantity(historical)]);
    assert(abi.decodeFunctionResult('arbBlockNumber', arbRaw)[0] === historical);
    return { blockNumber: historical.toString(), explicitHistoricalBlock: options.historicalBlock !== undefined,
      sampledSecondsPerBlock: (head.timestamp - Number(timestamp)) / Number(headNumber - historical),
      note: 'Use a block at/after deployment for retention checks; default is only 1000 blocks behind head.' };
  });
  report.rpcChecksPassed = report.checks.every((entry) => !entry.required || entry.status === 'pass');
  return report;
}

if (require.main === module) {
  (async () => {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log('Read-only: node scripts/elysium-readiness.cjs [--rpc URL] [--whype ADDRESS] [--historical-block DECIMAL] [--log-span 1..10000]\nRPC defaults to ELYSIUM_RPC_URL or the public mainnet RPC. No .env or private key is loaded.');
      return;
    }
    const report = await runReadiness(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.rpcChecksPassed) process.exitCode = 1;
  })().catch(() => { console.error('Readiness check could not start. Check arguments/dependencies; use --help.'); process.exitCode = 1; });
}
module.exports = { parseOptions, createRpcClient, runReadiness };
