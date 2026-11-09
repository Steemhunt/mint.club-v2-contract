// Optional offline fallback for machines unable to run their cached native solc.
// Reuses only artifacts whose target sources/dependencies match the current tree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateArtifactSources } = require("./elysium-artifact-validation.cjs");

const root = path.resolve(__dirname, "..");
const source = process.argv[2] && path.resolve(process.argv[2]);
if (!source) throw new Error("Usage: node scripts/elysium-use-existing-artifacts.cjs /path/to/existing/artifacts");
const destination = path.join(root, "artifacts-elysium-local");
assert.notEqual(source, destination, "source and destination must differ");
const contracts = [
  ["contracts/MCV2_Token.sol", "MCV2_Token"],
  ["contracts/MCV2_MultiToken.sol", "MCV2_MultiToken"],
  ["contracts/MCV2_Bond.sol", "MCV2_Bond"],
  ["contracts/mock/WETH9.sol", "WETH9"],
  ["contracts/MCV2_ZapV1.sol", "MCV2_ZapV1"],
  ["contracts/Locker.sol", "Locker"],
  ["contracts/MerkleDistributor.sol", "MerkleDistributor"],
];
const copies = new Map();
const verified = [];
for (const [sourceName, name] of contracts) {
  const artifactPath = path.join(source, sourceName, `${name}.json`);
  const debugPath = path.join(source, sourceName, `${name}.dbg.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const debug = JSON.parse(fs.readFileSync(debugPath, "utf8"));
  const buildPath = path.resolve(path.dirname(debugPath), debug.buildInfo);
  assert(buildPath.startsWith(source + path.sep), "build info must be inside the artifact directory");
  const build = JSON.parse(fs.readFileSync(buildPath, "utf8"));
  const compiler = name === "WETH9" ? "0.4.18" : "0.8.20";
  assert.equal(build.solcVersion, compiler);
  if (compiler === "0.8.20") {
    assert.equal(build.input.settings.evmVersion, "paris");
    assert.equal(build.input.settings.optimizer.enabled, true);
    assert.equal(build.input.settings.optimizer.runs, 50000);
    assert(!build.input.settings.viaIR, "core contracts use the release non-IR profile");
  }
  const compiled = build.output.contracts[sourceName][name];
  validateArtifactSources({ root, build, compiled, sourceName, name });
  assert.equal(artifact.bytecode, `0x${compiled.evm.bytecode.object}`);
  assert.equal(artifact.deployedBytecode, `0x${compiled.evm.deployedBytecode.object}`);
  assert.deepEqual(artifact.abi, compiled.abi);
  for (const filename of [artifactPath, debugPath, buildPath]) {
    copies.set(filename, path.join(destination, path.relative(source, filename)));
  }
  verified.push({
    name,
    compiler: build.solcLongVersion,
    artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex"),
  });
}
// Only write after every source and artifact has passed validation.
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(JSON.stringify({ verified, next: "npm run elysium:local -- --no-compile" }, null, 2));
