const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Interface } = require('ethers');
const { parseOptions, createRpcClient, runReadiness } = require('./elysium-readiness.cjs');

const now = 1794209400000;
const options = parseOptions([], {});
const abi = new Interface([
  'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
  'function deposit() payable', 'function withdraw(uint256)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  'function arbOSVersion() view returns (uint256)', 'function arbBlockNumber() view returns (uint256)',
]);

function fixture({ wrongChain = false, staleHistory = false, feeHistory = true, sameTimestamp = false } = {}) {
  const calls = [];
  const head = { number: '0x7d0', timestamp: `0x${(now / 1000).toString(16)}`,
    hash: `0x${'a'.repeat(64)}`, gasLimit: '0x4000000000000' };
  const past = { ...head, number: sameTimestamp ? '0x7cf' : '0x3e8',
    timestamp: sameTimestamp ? head.timestamp : `0x${(now / 1000 - 100).toString(16)}` };
  async function call(method, params = []) {
    calls.push([method, params]);
    switch (method) {
      case 'eth_chainId': return wrongChain ? '0x3e7' : '0x1863d';
      case 'eth_syncing': return false;
      case 'eth_blockNumber': return head.number;
      case 'eth_getBlockByNumber': return params[0] === 'latest' ? head : past;
      case 'eth_getCode': return '0x60006000';
      case 'eth_gasPrice': return '0x5f5e100';
      case 'eth_feeHistory':
        if (!feeHistory) throw Object.assign(new Error('unsupported'), { code: -32601 });
        return { baseFeePerGas: ['0x1'] };
      case 'eth_getLogs': return [];
      case 'eth_call': {
        const fn = abi.getFunction(params[0].data.slice(0, 10));
        const values = {
          decimals: [18], symbol: ['WHYPE'], deposit: [], withdraw: [],
          getBlockNumber: [999999], // Parent-chain height intentionally differs.
          getCurrentBlockTimestamp: [BigInt(params[1] === past.number && !staleHistory ? past.timestamp : head.timestamp)],
          arbOSVersion: [40], arbBlockNumber: [BigInt(params[1] === past.number && !staleHistory ? past.number : head.number)],
        };
        return abi.encodeFunctionResult(fn, values[fn.name]);
      }
      default: throw new Error('Unexpected method');
    }
  }
  return { calls, call, batch: (items) => Promise.all(items.map(([method, params]) => call(method, params))) };
}

test('rejects malformed CLI settings without making network requests', () => {
  assert.throws(() => parseOptions(['--historical-block', '-1'], {}));
  assert.throws(() => parseOptions(['--log-span', '0'], {}));
  assert.throws(() => parseOptions(['--log-span', '10001'], {}));
  assert.throws(() => parseOptions(['--whype', '0x' + '0'.repeat(40)], {}));
  assert.throws(() => parseOptions(['--send'], {}));
  assert.equal(parseOptions(['--historical-block', '0'], {}).historicalBlock, 0n);
});

test('wrong chain stops before touching token contracts', async () => {
  const client = fixture({ wrongChain: true });
  const report = await runReadiness(options, client, now);
  assert.equal(report.rpcChecksPassed, false);
  assert.deepEqual(client.calls.map(([method]) => method), ['eth_chainId']);
});

test('passing read probes never claim deployment readiness; Orbit parent height is supported', async () => {
  const report = await runReadiness(options, fixture(), now);
  assert.equal(report.rpcChecksPassed, true);
  assert.equal(report.deploymentReady, false);
  assert.equal(report.checks.find((check) => check.name === 'multicall-block-context').value.sameHeight, false);
  assert.equal(report.checks.find((check) => check.name === 'historical-state').value.sampledSecondsPerBlock, 0.1);
});

test('provider ignoring the historical state tag fails historical validation', async () => {
  const report = await runReadiness(options, fixture({ staleHistory: true }), now);
  assert.equal(report.rpcChecksPassed, false);
  assert.equal(report.checks.find((check) => check.name === 'historical-state').status, 'fail');
});

test('unsupported feeHistory is recorded without declaring all RPC reads unusable', async () => {
  const report = await runReadiness(options, fixture({ feeHistory: false }), now);
  assert.equal(report.rpcChecksPassed, true);
  assert.equal(report.checks.find((check) => check.name === 'fee-history').code, -32601);
});

test('historical block identity is checked even when both blocks have the same timestamp', async () => {
  const sameSecondOptions = { ...options, historicalBlock: 1999n };
  const correct = await runReadiness(sameSecondOptions, fixture({ sameTimestamp: true }), now);
  assert.equal(correct.rpcChecksPassed, true);
  const ignoredTag = await runReadiness(sameSecondOptions, fixture({ sameTimestamp: true, staleHistory: true }), now);
  assert.equal(ignoredTag.rpcChecksPassed, false);
  assert.equal(ignoredTag.checks.find((check) => check.name === 'historical-state').status, 'fail');
});

test('reports never leak RPC paths, query keys or arbitrary error messages', async () => {
  const secret = 'TEST_SECRET_DO_NOT_PRINT';
  const report = await runReadiness({ ...options, rpc: `https://rpc.example/v2/${secret}?key=${secret}` }, {
    call: async () => { throw new Error(`connection failed: ${secret}`); },
  }, now);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.rpcOrigin, 'https://rpc.example');
  for (const code of [secret, { echoedSecret: secret }]) {
    const poisoned = await runReadiness(options, {
      call: async () => { throw { code, name: secret }; },
    }, now);
    assert.equal(JSON.stringify(poisoned).includes(secret), false);
  }
});

test('transport rejects broadcasting and correctly matches out-of-order batch IDs', async () => {
  let requests = 0;
  const client = createRpcClient('https://rpc.example', async (_, init) => {
    requests++;
    const payload = JSON.parse(init.body);
    return { ok: true, json: async () => payload.map((item) => ({ id: item.id,
      result: item.method === 'eth_chainId' ? '0x1863d' : '0x42',
    })).reverse() };
  });
  await assert.rejects(client.call('eth_sendRawTransaction', ['0xdead']));
  assert.equal(requests, 0);
  assert.deepEqual(await client.batch([['eth_chainId', []], ['eth_blockNumber', []]]), ['0x1863d', '0x42']);
});
