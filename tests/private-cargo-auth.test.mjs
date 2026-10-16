import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const secret = "$" + "{{ secrets.CANONICAL_PRIVATE_CARGO_READ_TOKEN }}";
const fetchStart = source.indexOf("      - name: Fetch immutable private Rust dependencies");
const testStart = source.indexOf("      - name: Rust web modularization contracts", fetchStart);
const apiStart = source.indexOf("      - name: Rust API contracts without credentials", testStart);
const buildStart = source.indexOf("      - name: Build the pinned public stack without credentials", apiStart);
const smokeStart = source.indexOf("      - name: Stack smoke", buildStart);
assert.ok(fetchStart >= 0 && testStart > fetchStart && apiStart > testStart &&
  buildStart > apiStart && smokeStart > buildStart);
const fetchStep = source.slice(fetchStart, testStart);
const testSteps = source.slice(testStart, smokeStart);

test("Cargo secret is referenced exactly once in fetch-only step", () => {
  assert.equal(source.split(secret).length - 1, 1);
  assert.ok(fetchStep.includes("PRIVATE_CARGO_TOKEN: " + secret));
  assert.doesNotMatch(testSteps, /PRIVATE_CARGO_TOKEN|secrets\.|GIT_ASKPASS/);
});
test("missing private Cargo admission fails before any private build", () => {
  assert.match(fetchStep, /if \[ -z "\$\{PRIVATE_CARGO_TOKEN:-\}" \]; then/);
  assert.match(fetchStep, /Missing CANONICAL_PRIVATE_CARGO_READ_TOKEN/);
  assert.match(fetchStep, /exit 1/);
});
test("fetch step restricts GitHub host and removes temporary askpass script", () => {
  assert.match(fetchStep, /install -m 0700 .github\/scripts\/private-cargo-askpass\.sh "\$askpass"/);
  assert.match(fetchStep, /trap 'rm -f -- "\$askpass"' EXIT/);
  assert.match(fetchStep, /export GIT_ASKPASS/);
  assert.match(fetchStep, /export GIT_TERMINAL_PROMPT=0/);
  assert.match(fetchStep, /export CARGO_NET_GIT_FETCH_WITH_CLI=true/);
});
test("both pinned Rust dependency graphs are fetched without executing code", () => {
  assert.match(fetchStep, /cargo fetch --locked --manifest-path apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(fetchStep, /cargo fetch --locked --manifest-path apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.doesNotMatch(fetchStep, /\bcargo (?:test|build|run|check)\b|npm (?:ci|install|run|test)/);
});
test("Rust test and full stack build commands execute offline and token-free", () => {
  assert.match(testSteps, /CARGO_NET_OFFLINE: "true"/g);
  assert.match(testSteps, /cargo test --locked[\s\S]*?apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(testSteps, /cargo test --locked[\s\S]*?apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.match(testSteps, /run: \.\/build\.sh/);
  assert.doesNotMatch(testSteps, /PRIVATE_CARGO_TOKEN|secrets\.|GIT_ASKPASS/);
});
test("no private Cargo secret is embedded in Git URLs or persistent config", () => {
  assert.doesNotMatch(source, /https:\/\/[^\s/@]+:[^\s@]+@github\.com\//);
  assert.doesNotMatch(source, /https:\/\/\$\{\{[^\n]+\}\}@github\.com\//);
  assert.doesNotMatch(source, /git\s+config[^\n]*(?:extraheader|credential\.helper)[^\n]*PRIVATE_CARGO_TOKEN/i);
});
