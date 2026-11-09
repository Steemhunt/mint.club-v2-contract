const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const keccak256 = require("keccak256");
const { validateArtifactSources } = require("./elysium-artifact-validation.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "elysium-artifact-validation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = {
    "contracts/Core.sol": { content: 'import "@test/Dependency.sol"; contract Core is Dependency {}' },
    "@test/Dependency.sol": { content: "contract Dependency {}" },
    "contracts/RetiredChain.sol": { content: "contract RetiredChain {}" },
  };
  const metadata = {
    compiler: { version: "0.8.20+commit.a1b79de6" },
    settings: { compilationTarget: { "contracts/Core.sol": "Core" } },
    output: { abi: [] },
    sources: {},
  };
  for (const filename of ["contracts/Core.sol", "@test/Dependency.sol"]) {
    const local = path.join(root, filename.startsWith("contracts/") ? filename : `node_modules/${filename}`);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, sources[filename].content);
    metadata.sources[filename] = { keccak256: `0x${keccak256(sources[filename].content).toString("hex")}` };
  }
  return {
    root,
    build: { solcLongVersion: metadata.compiler.version, input: { sources } },
    compiled: { metadata: JSON.stringify(metadata), abi: [] },
    sourceName: "contracts/Core.sol",
    name: "Core",
  };
}

test("removed unrelated compilation input does not invalidate a retained target", (t) => {
  const input = fixture(t);
  assert.equal(fs.existsSync(path.join(input.root, "contracts/RetiredChain.sol")), false);
  assert.doesNotThrow(() => validateArtifactSources(input));
});

test("modified transitive dependency is rejected", (t) => {
  const input = fixture(t);
  fs.appendFileSync(path.join(input.root, "node_modules/@test/Dependency.sol"), " // modified");
  assert.throws(() => validateArtifactSources(input), /source mismatch: @test\/Dependency.sol/);
});

test("compiler input changed to match a tampered dependency is still rejected by metadata hash", (t) => {
  const input = fixture(t);
  input.build.input.sources["@test/Dependency.sol"].content += " // modified";
  fs.writeFileSync(path.join(input.root, "node_modules/@test/Dependency.sol"), input.build.input.sources["@test/Dependency.sol"].content);
  assert.throws(() => validateArtifactSources(input), /metadata source hash mismatch: @test\/Dependency.sol/);
});

test("missing referenced source and mismatched compilation target are rejected", (t) => {
  const input = fixture(t);
  delete input.build.input.sources["@test/Dependency.sol"];
  assert.throws(() => validateArtifactSources(input), /missing compiler input: @test\/Dependency.sol/);
  assert.throws(() => validateArtifactSources({ ...input, name: "AnotherContract" }));
});

test("metadata compiler and ABI must agree with the build output", (t) => {
  const input = fixture(t);
  assert.throws(() => validateArtifactSources({ ...input, build: { ...input.build, solcLongVersion: "0.8.30" } }), /metadata compiler must match/);
  assert.throws(() => validateArtifactSources({ ...input, compiled: { ...input.compiled, abi: [{ type: "constructor" }] } }), /metadata ABI must match/);
});
