# Elysium deployment preparation

Elysium uses chain ID **99901** and native **HYPE** (18 decimals). Core Mint Club
contracts use a WETH9-compatible WHYPE reserve through ZapV1. Uniswap and USDC
are not prerequisites. No contracts have been deployed by this PR.

## Existing deployment flow

Use `hardhat.config.js`, `test/utils/test-utils.js`, and `scripts/deploy.js`, as
for the other chains. Set these values in `.env` before deployment:

| Setting | Required value |
| --- | --- |
| `RPC_ELYSIUM` | Accessible mainnet RPC; documented default: `https://rpc.elysium.kinetiq.xyz` |
| `MAINNET_PRIVATE_KEY` | Existing deployer key setting |
| `PROTOCOL_BENEFICIARY` | Existing nonzero beneficiary setting |
| `ELYSIUM_WRAPPED_NATIVE` | Verified mainnet WHYPE address |
| `ELYSIUM_CREATION_FEE_HYPE` | Explicit non-negative HYPE amount, up to 18 decimal places |
| `ELYSIUM_MAX_STEPS` | Integer 1–1000 selected after live transaction-gas checks |

Missing or invalid deployment inputs stop the core deploy script before its
first transaction. Elysium settings are only read by helpers for Elysium; other
chains retain their existing values. Address validation does not establish that
a wrapper is canonical or has the required deposit/withdraw behavior.

After the checks below, the existing deployment command is:

```sh
npx hardhat run --network elysium scripts/deploy.js
```

## Checks still required

- Verify RPC access, chain ID, canonical WHYPE bytecode and native deposit/withdraw.
  `0xbA876237B0F021A6c6D852d6c26E107997cC5E81` is a candidate from public Uniswap
  deployment records, not a verified default. Earlier official address docs
  listed testnet addresses; do not substitute those on mainnet.
- Confirm the transaction gas cap and rehearse on an Elysium fork. An earlier
  local mock-WETH run measured approximately **25.3M gas** to create 1,000 steps;
  this is not a live Elysium result. Existing maximum-step tests are skipped.
- Confirm deployment economics, fund native HYPE, and configure explorer
  verification before release. No Elysium verifier endpoint is configured yet.
- Record actual addresses, transaction hashes and receipt blocks. Use the
  earliest monitored deployment block for web indexing; validate HYPE pricing
  and create/mint/burn before enabling the chain in the web app.

The documented funding route is native HYPE from HyperEVM to Elysium. On
2026-11-09 at 17:19 KST the bridge UI required a partner access code; recheck
access before funding. No funds were transferred during preparation.

References: [connection details](https://elysium.kinetiq.xyz/docs/connecting-to-elysium),
[contract addresses](https://elysium.kinetiq.xyz/docs/contract-addresses),
[bridging](https://elysium.kinetiq.xyz/docs/token-bridging-on-elysium),
[WHYPE candidate](https://github.com/Uniswap/contracts/blob/8e258847e42c59a59228a885c320a7eec99c6871/deployments/json/99901.json).
