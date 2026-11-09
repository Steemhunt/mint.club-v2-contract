const { readElysiumDeploymentSettings } = require("../config/elysium.cjs");

try {
  const parameters = readElysiumDeploymentSettings();
  console.log(JSON.stringify({
    mode: "unsigned-plan-only",
    parameters,
    contracts: ["MCV2_Token", "MCV2_MultiToken", "MCV2_Bond", "MCV2_ZapV1", "Locker", "MerkleDistributor"],
    outstandingChecks: [
      "Verify chain ID, canonical wrapper runtime code and deposit/withdraw behavior on the mainnet endpoint",
      "Confirm per-transaction execution gas limit against the measured max-step create transaction",
      "Review beneficiary, creation fee and max steps before signing",
      "Record deployment receipts and first deployment block for the indexer",
    ],
  }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
