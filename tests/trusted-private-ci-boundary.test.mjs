import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const mainOnly = "if: github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'canonical-cloud/canonical-monorepo'";

function job(name, next) {
  const beginning = workflow.indexOf("  " + name + ":\n");
  assert.ok(beginning >= 0, name + " job missing");
  const ending = next ? workflow.indexOf("  " + next + ":\n", beginning) : workflow.length;
  assert.ok(ending > beginning, next + " section missing");
  return workflow.slice(beginning, ending);
}
const publicTest = job("test", "integration-build");
const privateCargo = job("integration-build", "isolated-stack-build");
const separateStack = job("isolated-stack-build", "private-sidecar-contract");
const privateSidecar = job("private-sidecar-contract");

test("workflow scope contains no private credential env", () => {
  const preamble = workflow.slice(0, workflow.indexOf("\njobs:\n"));
  assert.doesNotMatch(preamble, /CANONICAL_PRIVATE_|PRIVATE_SUBMODULE_TOKEN|PRIVATE_CARGO_TOKEN/);
});
test("public PR tests have no access to private tokens", () => {
  assert.match(publicTest, /node --test tests\/\*\.test\.mjs/);
  assert.doesNotMatch(publicTest, /secrets\./);
  assert.doesNotMatch(publicTest, /PRIVATE_CARGO_TOKEN|PRIVATE_SUBMODULE_TOKEN/);
});
test("private Cargo job runs only on main push in source repository", () => {
  assert.ok(privateCargo.includes(mainOnly));
  assert.match(privateCargo, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(privateCargo, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
});
test("private sidecar job runs only on main push in source repository", () => {
  assert.ok(privateSidecar.includes(mainOnly));
  assert.match(privateSidecar, /ref: \$\{\{ github\.sha \}\}/);
});
test("private Cargo token only exists in fetch step, not compiled or cached on host", () => {
  assert.equal((workflow.match(/secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN/g) || []).length, 1);
  const at = privateCargo.indexOf("      - name: Fetch immutable private Rust dependencies");
  const testsAt = privateCargo.indexOf("      - name: Verify Rust lockfiles, full target matrix, and isolated release smoke", at);
  assert.ok(at >= 0 && testsAt > at);
  const fetch = privateCargo.slice(at, testsAt);
  const execution = privateCargo.slice(testsAt);
  assert.match(fetch, /PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}/);
  assert.match(fetch, /GIT_ASKPASS/);
  assert.match(fetch, /trap 'rm -f -- "\$askpass"' EXIT/);
  assert.match(fetch, /CARGO_NET_GIT_FETCH_WITH_CLI=true/);
  assert.match(fetch, /export CARGO_HOME="\$CANONICAL_PRIVATE_CARGO_CACHE"/);
  assert.match(fetch, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(fetch, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.match(execution, /bash \.github\/scripts\/offline-rust-review\.sh "\$app" "\$mode"/);
  assert.doesNotMatch(execution, /PRIVATE_CARGO_TOKEN|GIT_ASKPASS|secrets\.|\.\/build\.sh|cargo test/);
  assert.doesNotMatch(privateCargo, /Swatinem\/rust-cache|shared-cache|run: \.\/build\.sh/);
  assert.doesNotMatch(workflow, /https:\/\/[^\s/"']+:[^\s@"']+@github\.com\//);
});
test("public frontends are mandatory on independent runner and cannot compile private Rust", () => {
  assert.ok(separateStack.includes(mainOnly));
  assert.match(privateCargo, /needs: \[test, isolated-stack-build\]/);
  assert.doesNotMatch(separateStack, /needs: integration-build/);
  assert.match(separateStack, /run: bash scripts\/build-public-frontends\.sh/);
  assert.doesNotMatch(separateStack, /cargo (?:build|fetch|test)|\.\/build\.sh|secrets\.|PRIVATE_CARGO_TOKEN|CANONICAL_PRIVATE_CARGO_CACHE|actions\/upload-artifact/);
});
test("release binaries never leave the sandbox for GitHub Actions artifacts", () => {
  assert.match(privateCargo, /for mode in lock fmt clippy test release; do/);
  assert.match(privateCargo, /bash \.github\/scripts\/offline-rust-review\.sh "\$app" "\$mode"/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact|actions\/download-artifact|gh release upload/);
});
test("missing sidecar credential fails closed only after exact pinned SHA is captured", () => {
  assert.match(privateSidecar, /- name: Require approved read-only private sidecar credential/);
  assert.match(privateSidecar, /if \[\[ -z "\$\{PRIVATE_SUBMODULE_TOKEN:-\}" \]\]; then[\s\S]*?exit 1/);
  assert.match(privateSidecar, /id: pinned_sidecar/);
  assert.match(privateSidecar, /pinned_sha="\$\(git rev-parse HEAD:apps\/canonical-sidecar\.rs\)"/);
  assert.match(privateSidecar, /echo "sha=\$pinned_sha" >> "\$GITHUB_OUTPUT"/);
});
test("sidecar token is never job-wide and checkout uses exact immutable Gitlink", () => {
  assert.equal((workflow.match(/secrets\.CANONICAL_PRIVATE_SUBMODULES_READ_TOKEN/g) || []).length, 2);
  const firstStep = privateSidecar.indexOf("\n    steps:\n");
  assert.ok(firstStep >= 0);
  assert.doesNotMatch(privateSidecar.slice(0, firstStep), /PRIVATE_SUBMODULE_TOKEN|secrets\./);
  assert.match(privateSidecar, /ref: \$\{\{ steps\.pinned_sidecar\.outputs\.sha \}\}/);
  assert.doesNotMatch(privateSidecar, /ref: main/);
  assert.match(privateSidecar, /PINNED_SIDECAR_SHA: \$\{\{ steps\.pinned_sidecar\.outputs\.sha \}\}/);
  assert.match(privateSidecar, /test "\$\(git -C apps\/canonical-sidecar\.rs rev-parse HEAD\)" = "\$PINNED_SIDECAR_SHA"/);
  assert.match(privateSidecar, /merge-base --is-ancestor "\$PINNED_SIDECAR_SHA" refs\/remotes\/origin\/main/);
  assert.doesNotMatch(publicTest, /secrets\./);
  assert.doesNotMatch(privateCargo, /CANONICAL_PRIVATE_SUBMODULES_READ_TOKEN/);
});
