# Mint Club Elysium preparation — 2026-11-09

## Decision

Core ERC20/ERC1155 bonding curves can be prepared independently of Uniswap,
an Elysium stablecoin, and external DEX liquidity. Start with a verified,
WETH9-compatible WHYPE reserve. Native HYPE funds transactions; ZapV1 wraps it
into WHYPE for the Bond and unwraps on sells.

This change is preparation, not a production chain activation. It adds offline
execution tests, an unsigned parameter plan and read-only RPC checks. It does
not add remote Hardhat signing networks, publish packages, deploy contracts,
change Solidity, or enable Elysium in mint.club.

## Evidence and remaining gates

| Item | Status |
| --- | --- |
| Mainnet | Chain ID 99901, HYPE with 18 decimals |
| Public RPC | `https://rpc.elysium.kinetiq.xyz`, registered in Chainlist |
| RPC live test | Failed locally with DNS `ENOTFOUND` on 2026-11-09; this is not evidence of a chain-wide outage |
| WHYPE candidate | `0xbA876237B0F021A6c6D852d6c26E107997cC5E81`, from public Uniswap deployment records; canonical identity and live bytecode remain unverified |
| USDC | No mainnet address verified; unnecessary for a WHYPE-only initial reserve list |
| Mainnet transaction gas cap | Not verified; a 300 Mgas/s throughput target or Nitro's header gasLimit cannot establish it |
| Creation fee / beneficiary | Must be explicitly chosen; no HYPE-denominated fee is guessed |
| Mint Club deployment addresses | Not deployed/assumed; use actual receipts and earliest monitored deployment block |
| Frontend USD pricing | Requires validated HYPE/USD data; missing price must remain unavailable rather than be treated as zero value |

The official contract-address page still labels its addresses **testnet**.
Do not use testnet WHYPE `0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234`
or testnet USDC `0x7D29d8047B905000459c0E80c34a26CeedcB47b2` on mainnet.

Sources:

- https://elysium.kinetiq.xyz/docs/connecting-to-elysium
- https://elysium.kinetiq.xyz/docs/contract-addresses
- https://elysium.kinetiq.xyz/docs/building-on-elysium
- https://elysium.kinetiq.xyz/docs/blocks-fees-and-ordering
- https://github.com/DefiLlama/chainlist/blob/main/constants/additionalChainRegistry/chainid-99901.js
- https://github.com/Uniswap/contracts/blob/8e258847e42c59a59228a885c320a7eec99c6871/deployments/json/99901.json
- https://www.alchemy.com/docs/reference/elysium-api-faq

## Local verification

```sh
npm run elysium:local
npm run elysium:rpc:test
```

The local profile does not load dotenv, private keys, remote RPCs or the normal
Base fork. It uses an in-process Cancun VM with chain ID 99901 and the existing
Paris compiler settings. Its 60M local block ceiling is only for measurement,
not a claim about Elysium limits. The wrapper is a mock WETH9.

Five contract tests passed: ERC20 and ERC1155 creation with 3 and 1,000 steps,
full native mint/burn, exact overpayment refund, zero residual Zap balances,
and explicit deployment-parameter validation. All six core production contract
runtime sizes fit EIP-170; the largest, Bond, is 21,970 bytes.

| Transaction | Local measured gas |
| --- | ---: |
| ERC20 create, 1,000 steps | 25,325,558 |
| ERC1155 create, 1,000 steps | 25,288,196 |
| Native mint crossing 1,000 steps | approximately 4.87M |
| Native burn crossing 1,000 steps | approximately 5.64M |
| Create a 3-step curve | approximately 351k–376k |

The previous helper comment's 15M estimate is stale. Keep the actual
`MAX_STEPS` decision pending live transaction limits and a fork rehearsal.

Environment limitation: fresh compilation could not run because the installed
cached native solc 0.8.20 is x86_64 on this ARM host. Tests instead used existing
artifacts after checking every retained target's transitive source/dependency
closure from Solidity metadata against current files and recorded source hashes,
plus release compiler version/settings, compilation target, ABI and bytecode.
Unrelated compilation-unit inputs, such as the removed Blast-only contract, do
not invalidate retained targets. This validates execution of those matched
artifacts, not a fresh compilation.

The optional fallback command performs those checks before copying anything:

```sh
node scripts/elysium-use-existing-artifacts.cjs /path/to/existing/artifacts
npm run elysium:local -- --no-compile
node --test scripts/elysium-artifact-validation.test.cjs
```

RPC-probe tests cover wrong-chain rejection, stale historical state, Orbit
parent block numbering, unsupported feeHistory, credential-redacted reports,
out-of-order batch responses, and rejection of transaction submission methods.

## Read-only mainnet checks

```sh
npm run elysium:rpc
# Use a provider URL via the environment, rather than putting API keys in shell history.
# ELYSIUM_RPC_URL is read; .env is not loaded automatically.
npm run elysium:rpc -- --historical-block DEPLOYMENT_BLOCK --log-span 1000
```

Checks include identity, head freshness, batch reads, WHYPE code hash and ABI,
Multicall3, ArbOS, fees, filtered logs and pinned historical state. The
`deploymentReady` field is always false: a successful read probe cannot replace
canonical-address verification, actual mint/burn rehearsal, and deployment
review. Default historical depth is only 1,000 blocks; use an explicit old block
with Multicall3 deployed to verify the retention needed for production replay.
Browser CORS, WebSocket reconnects, rate limits and silent log truncation need
separate verification. Unsupported feeHistory is recorded as optional; fee
handling must match the endpoint rather than being assumed from another chain.

## Unsigned parameter plan

Set all four explicit inputs, then run `npm run elysium:plan`:

- `ELYSIUM_PROTOCOL_BENEFICIARY`: reviewed nonzero address.
- `ELYSIUM_WRAPPED_NATIVE`: verified mainnet WHYPE address.
- `ELYSIUM_CREATION_FEE_HYPE`: non-negative HYPE decimal, up to 18 decimals.
- `ELYSIUM_MAX_STEPS`: integer 1–1000, selected after gas validation.

This prints the constructor settings and deployment contract list; it neither
loads a signer nor sends a transaction. No private key is needed.

## Web and SDK activation

The accompanying web patch adds inclusive `startBlock` configuration and tests
for initialization, retry and saved-checkpoint behavior. Use the earliest
monitored deployment receipt; the old head-minus-500 default covers only about
50 seconds at a sustained 100ms cadence. A saved checkpoint still takes
precedence and is never silently rewound. See the web repository's
`docs/elysium-preparation.md` for exact activation files.

The web uses `mint.club-v2-sdk@1.5.7`; the adjacent SDK main is the different
package `@mint.club/v2-sdk@3.1.0`. Legacy client injection cannot register an
unknown chain: support is checked before the injected client is used.

For the web, the SDK is used at three pricing/history call sites:

- `app/utils/pricing.ts`: token/NFT USD fallback.
- `app/hooks/price/mintclub.ts`: timestamp-to-block lookup.
- `app/hooks/price/use24PriceDiff.ts`: reserve 24h price change.

Two valid follow-up paths are an Elysium-only direct-Viem pricing/history adapter
(keep legacy SDK behavior for all existing chains), or a chain-only 1.x SDK
backport from v1.5.7 if external SDK users also need support. A v3 migration is
not required for core Mint Club deployment. No SDK package has been changed.

For a WHYPE-only launch, validate an asset-level HYPE price feed independently
of an Elysium stablecoin or DEX. DefiLlama `coingecko:hyperliquid` and CoinGecko
`hyperliquid` are candidate mappings, not verified live feeds in this session.
Match the verified wrapper address, never just the symbol. Historical block
lookups should use RPC timestamps rather than assuming a fixed block rate.

## Funding deployment gas

Official route: native HYPE on HyperEVM (999) to native HYPE on Elysium
(99901), 1:1. Native HYPE uses no token wrapper or ERC20 approval. Leave
enough HYPE on HyperEVM for the source transaction and bridge fees. If the
funds are on HyperCore, first move HYPE to HyperEVM using the official
Hyperliquid transfer interface.

On 2026-11-09 at approximately 08:19 UTC / 17:19 KST, opening
https://elysium.kinetiq.xyz/bridge redirected to
`/partner-access?next=%2Fbridge`, displaying an access-code requirement until
launch. Its navigation still linked to the testnet bridge. The mainnet route
is documented, but public UI access was not open in that check; an authorized
partner code or public launch is needed to use that UI. Do not substitute
testnet funds or send native HYPE to an ERC20 gateway address.

Sources:

- https://elysium.kinetiq.xyz/docs/token-bridging-on-elysium
- https://elysium.kinetiq.xyz/bridge
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers

## Deployment wiring still required

The preparation commands above do not deploy. Before an Elysium deployment
command can run, add an explicit remote Hardhat network with chain ID 99901,
the validated RPC and the operator's signer, and wire the reviewed Elysium
parameters into the deployment entry point. The existing `scripts/deploy.js`
reads network-specific helpers, so running it with a new network name alone
is insufficient. It also labels native balances as ETH; the Elysium path must
label them HYPE.

Deploy Token and MultiToken implementations and initialize them, then deploy
Bond with their addresses, beneficiary, creation fee and MAX_STEPS. Deploy
ZapV1 with Bond and verified WHYPE, then Locker and MerkleDistributor. Capture
transaction hashes, addresses and receipt blocks throughout. The six local
contract deployments used about 12.5M execution gas before initialization
transactions and Nitro fee overhead; this is not a mainnet HYPE budget. Use
live estimates and fee data to fund the signer, including a mint/burn smoke
test and margin.

## Release order

1. Verify the selected RPC and canonical WHYPE, including full native
   deposit/withdraw behavior, and confirm the live transaction gas cap.
2. Choose fee, beneficiary and MAX_STEPS; perform an exact-chain fork rehearsal
   with existing Paris bytecode.
3. Deploy the reviewed core contracts, verify source and capture every receipt.
4. Register actual addresses, HYPE metadata/pricing, wallet/API allowlists and
   the receipt-derived monitor startBlock; start and validate indexing.
5. Enable the public chain only after create/mint/burn and data replay agree.

Uniswap, ZapV2, USDC-based presets, staking and lptoken.fun mappings are optional
later features, not prerequisites for a WHYPE-backed core launch.
