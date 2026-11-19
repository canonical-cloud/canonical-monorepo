import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const secret = "$" + "{{ secrets.CANONICAL_PRIVATE_CARGO_READ_TOKEN }}";
const fetchStart = source.indexOf("      - name: Fetch immutable private Rust dependencies");
const testStart = source.indexOf("      - name: Verify Rust lockfiles, full target matrix, and isolated release smoke", fetchStart);
const stackStart = source.indexOf("  isolated-stack-build:", testStart);
const sideStart = source.indexOf("  private-sidecar-contract:", stackStart);
assert.ok(fetchStart >= 0 && testStart > fetchStart && stackStart > testStart && sideStart > stackStart);
const fetchStep = source.slice(fetchStart, testStart);
const testSteps = source.slice(testStart, stackStart);
const stackJob = source.slice(stackStart, sideStart);

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
  assert.match(fetchStep, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(fetchStep, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.doesNotMatch(fetchStep, /\bcargo (?:test|build|run|check)\b|npm (?:ci|install|run|test)/);
});
test("private Rust compilation is delegated only to networkless container runner", () => {
  assert.match(fetchStep, /export CARGO_HOME="\$CANONICAL_PRIVATE_CARGO_CACHE"/);
  assert.match(testSteps, /bash \.github\/scripts\/offline-rust-review\.sh "\$app" "\$mode"/);
  assert.match(testSteps, /for app in web api; do/);
  assert.match(testSteps, /for mode in lock fmt clippy test release; do/);
  assert.doesNotMatch(testSteps, /PRIVATE_CARGO_TOKEN|secrets\.|GIT_ASKPASS|(?:run:|\s)\.\/build\.sh/);
  assert.doesNotMatch(testSteps, /\bcargo (?:test|build|check|clippy|run)\b/);
});
test("public frontend verification is a separate required job with no private Rust cache", () => {
  assert.match(source, /integration-build:\s*\n\s+needs: \[test, isolated-stack-build, public-artifact-contract\]/);
  assert.match(stackJob, /github\.repository == 'canonical-cloud\/canonical-monorepo'/);
  assert.match(stackJob, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);
  assert.doesNotMatch(stackJob, /needs: integration-build/);
  assert.match(stackJob, /run: bash \.github\/scripts\/build-public-frontends\.sh/);
  assert.doesNotMatch(stackJob, /cargo (?:fetch|build|test)|\.\/build\.sh|secrets\.|PRIVATE_CARGO_TOKEN|CANONICAL_PRIVATE_CARGO_CACHE/);
});
test("private compilation includes release and smoke only inside the sandbox", () => {
  assert.match(testSteps, /for app in web api; do/);
  assert.match(testSteps, /for mode in lock fmt clippy test release; do/);
  assert.match(testSteps, /bash \.github\/scripts\/offline-rust-review\.sh "\$app" "\$mode"/);
  assert.doesNotMatch(testSteps, /run: \.\/build\.sh|actions\/upload-artifact|gh release|docker push/);
});
test("no private Cargo secret is embedded in Git URLs or persistent config", () => {
  assert.doesNotMatch(source, /https:\/\/[^\s/@]+:[^\s@]+@github\.com\//);
  assert.doesNotMatch(source, /https:\/\/\$\{\{[^\n]+\}\}@github\.com\//);
  assert.doesNotMatch(source, /git\s+config[^\n]*(?:extraheader|credential\.helper)[^\n]*PRIVATE_CARGO_TOKEN/i);
});

test("public frontend builder never invokes Cargo, handles private dependencies or uploads artifacts", async () => {
  const helper = await readFile(new URL("../.github/scripts/build-public-frontends.sh", import.meta.url), "utf8");
  assert.match(helper, /npm ci && npm run build/);
  assert.match(helper, /npm ci && npm run typecheck && npm test && npm run build/);
  assert.doesNotMatch(helper, /\bcargo\b|\bPRIVATE_CARGO_TOKEN\b|\bGIT_ASKPASS\b|docker\s+(?:build|push)|gh release/);
  assert.doesNotMatch(helper, /actions\/upload-artifact|\.\/build\.sh/);
});
