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
const privateCargo = job("integration-build", "private-sidecar-contract");
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
test("private Cargo token only exists in one trusted step", () => {
  assert.equal((workflow.match(/secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN/g) || []).length, 1);
  const at = privateCargo.indexOf("      - name: Rust API contracts");
  assert.ok(at >= 0);
  const step = privateCargo.slice(at, privateCargo.indexOf("      - name: Stack smoke", at));
  assert.match(step, /PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}/);
  assert.match(step, /GIT_ASKPASS/);
  assert.match(step, /trap 'rm -f -- "\$askpass"' EXIT/);
  assert.match(step, /CARGO_NET_GIT_FETCH_WITH_CLI=true/);
  assert.match(step, /apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(step, /apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.match(step, /\.\/build\.sh/);
  assert.doesNotMatch(workflow, /https:\/\/[^\s/"']+:[^\s@"']+@github\.com\//);
});
test("a missing private sidecar credential fails closed on trusted main", () => {
  assert.match(privateSidecar, /- name: Require private sidecar read access before release/);
  assert.match(privateSidecar, /if: env\.PRIVATE_SUBMODULE_TOKEN == ''[\s\S]*?exit 1/);
});
test("only the private sidecar job can consume its secret", () => {
  assert.equal((workflow.match(/secrets\.CANONICAL_PRIVATE_SUBMODULES_READ_TOKEN/g) || []).length, 2);
  assert.doesNotMatch(publicTest, /secrets\./);
  assert.doesNotMatch(privateCargo, /CANONICAL_PRIVATE_SUBMODULES_READ_TOKEN/);
});
