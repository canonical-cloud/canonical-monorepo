import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/web-boundary-candidate-preview.yml", import.meta.url), "utf8");
test("candidate boundary preview has no private credentials or release power", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target:|permissions:\s*write-all|contents:\s*write|packages:\s*write|id-token:\s*write/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets(?:\.|\[)|github\.token|GIT_ASKPASS|PRIVATE_CARGO_TOKEN/);
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(workflow.includes("submodules: false"));
  assert.doesNotMatch(workflow, /^\s*(?:git push|gh pr merge|gh pr create|docker push|cargo publish)\b/m);
});
test("preview checks exact approved SHA and root Git tree, without rewriting monorepo Gitlink", () => {
  assert.match(workflow, /WEB_SOURCE_SHA: 7353c6dab5e8e6a4f5cabcbf7d37796e6e90224c/);
  assert.match(workflow, /WEB_SOURCE_TREE: 3d9d86f2d191f9fa5b85d7c2c43c212fad6b1b73/);
  assert.match(workflow, /git -C apps\/canonical-web-server\.rs rev-parse HEAD/);
  assert.match(workflow, /git -C apps\/canonical-web-server\.rs rev-parse 'HEAD\^\{tree\}'/);
  assert.match(workflow, /git rev-parse HEAD:apps\/canonical-web-server\.rs/);
  assert.doesNotMatch(workflow, /git update-index|git submodule set-branch|git add|git commit|git push/);
});
test("preview executes the existing monorepo release boundary, not a new weaker allowlist", () => {
  assert.ok(workflow.includes("tests/ci-cd-contract.test.mjs"));
  assert.ok(workflow.includes("--test-name-pattern="));
  assert.ok(workflow.includes("pinned app workflows cannot publish or declare a competing release"));
});
