import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

async function workflow() {
  return readFile(workflowUrl, "utf8");
}

test("private Cargo auth is one step-scoped integration credential", async () => {
  const source = await workflow();
  const secretRef = "${{ secrets.CANONICAL_PRIVATE_CARGO_READ_TOKEN }}";

  assert.equal(
    source.split(secretRef).length - 1,
    1,
    "private Cargo secret must be referenced exactly once",
  );
  assert.match(
    source,
    /- name: Rust private Cargo contracts[\s\S]*?PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}[\s\S]*?GIT_ASKPASS=/,
    "private Cargo token must be scoped to the cross-consumer integration step and consumed through GIT_ASKPASS",
  );
  assert.match(source, /CARGO_NET_GIT_FETCH_WITH_CLI=true/);
  assert.match(source, /GIT_TERMINAL_PROMPT=0/);
  for (const manifest of [
    "apps/canonical-web-server.rs/Cargo.toml",
    "apps/canonical-api-server.rs/Cargo.toml",
    "apps/canonical-mcp-server.rs/Cargo.toml",
  ]) {
    assert.match(
      source,
      new RegExp(manifest.replaceAll(".", "\\.")),
      `private integration must exercise ${manifest}`,
    );
  }
  assert.doesNotMatch(
    source,
    /https:\/\/[^\s/@]+:[^\s@]+@github\.com\//,
    "workflow must never embed username/password credentials in a GitHub URL",
  );
  assert.doesNotMatch(
    source,
    /https:\/\/\$\{\{[^\n]+\}\}@github\.com\//,
    "workflow must never interpolate a secret into a GitHub URL",
  );
  assert.doesNotMatch(
    source,
    /git\s+config[^\n]*(?:extraheader|credential\.helper)[^\n]*PRIVATE_CARGO_TOKEN/i,
    "workflow must not persist the private Cargo token in git configuration",
  );
});

test("missing private Cargo auth fails as an explicit admission boundary", async () => {
  const source = await workflow();
  assert.match(source, /if \[ -z "\$\{PRIVATE_CARGO_TOKEN:-\}" \]; then/);
  assert.match(
    source,
    /CANONICAL_PRIVATE_CARGO_READ_TOKEN with read-only access to canonical-cloud\/canonical-lib-core/,
  );
  assert.match(source, /exit 1/);
});
