const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const keccak256 = require("keccak256");

function validateArtifactSources({ root, build, compiled, sourceName, name }) {
  const metadata = JSON.parse(compiled.metadata);
  assert.equal(metadata.compiler.version, build.solcLongVersion, "metadata compiler must match build info");
  assert.deepEqual(metadata.settings.compilationTarget, { [sourceName]: name });
  assert.deepEqual(metadata.output.abi, compiled.abi, "metadata ABI must match compiled output");
  assert(metadata.sources[sourceName], "metadata must include the target source");

  // Solidity metadata lists this target's complete transitive source closure.
  // Other targets can share the build input without being dependencies (e.g. a
  // retired chain-specific contract). Their removal need not invalidate this target.
  for (const [filename, sourceMetadata] of Object.entries(metadata.sources)) {
    const input = build.input.sources[filename];
    assert.equal(typeof input?.content, "string", `missing compiler input: ${filename}`);
    assert.equal(
      `0x${keccak256(input.content).toString("hex")}`,
      sourceMetadata.keccak256,
      `metadata source hash mismatch: ${filename}`
    );
    const local = path.resolve(root, filename.startsWith("contracts/") ? filename : `node_modules/${filename}`);
    assert(local.startsWith(path.resolve(root) + path.sep), "source must be inside the project");
    assert.equal(fs.readFileSync(local, "utf8"), input.content, `source mismatch: ${filename}`);
  }
}

module.exports = { validateArtifactSources };
