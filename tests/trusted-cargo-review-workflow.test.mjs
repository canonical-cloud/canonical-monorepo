import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/trusted-cargo-review.yml", import.meta.url), "utf8");
const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  trusted-cargo:"));
const trusted = workflow.slice(workflow.indexOf("  trusted-cargo:"));
const beginning = trusted.indexOf("      - name: Fetch pinned private dependencies only");
const ending = trusted.indexOf("      - name: Verify regenerated Cargo.lock parity", beginning);
assert.ok(beginning >= 0 && ending > beginning);
const fetchStep = trusted.slice(beginning, ending);
const afterFetch = trusted.slice(ending);

test("manual trusted review has no pull_request or publisher trigger", () => {
  const preamble = workflow.slice(0, workflow.indexOf("\njobs:\n"));
  assert.match(preamble, /\bon:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(preamble, /pull_request|workflow_run|push:|pull_request_target/);
  assert.doesNotMatch(workflow, /(?:packages|attestations|id-token)\s*:\s*write|permissions:\s*write-all/);
});
test("preflight verifies immutable web PR HEAD from same repository targeting main", () => {
  assert.match(preflight, /github\.ref == 'refs\/heads\/main'/);
  assert.match(preflight, /github\.repository == 'canonical-cloud\/canonical-monorepo'/);
  assert.match(preflight, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(preflight, /repos\/canonical-cloud\/canonical-web-server\.rs\/pulls\/\$WEB_PR/);
  for (const fragment of [".state == \"open\"", ".head.sha == $expected",
    ".base.ref == \"main\"", ".head.repo.full_name == \"canonical-cloud/canonical-web-server.rs\""]) {
    assert.ok(preflight.includes(fragment), "missing PR admission condition " + fragment);
  }
});
test("environment metadata must prove independent reviewers and protected branches", () => {
  assert.match(preflight, /environments\/canonical-private-cargo-validation/);
  assert.match(preflight, /deployment_branch_policy\.protected_branches == true/);
  assert.match(preflight, /\.type == "required_reviewers"/);
  assert.match(preflight, /\.prevent_self_review == true/);
  assert.match(trusted, /environment: canonical-private-cargo-validation/);
  assert.match(trusted, /needs: preflight/);
});
test("trusted checkout and both candidate Git trees must be proven exact", () => {
  assert.match(trusted, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(trusted, /repository: canonical-cloud\/canonical-web-server\.rs/);
  assert.match(trusted, /ref: \$\{\{ needs\.preflight\.outputs\.web_sha \}\}/);
  assert.match(trusted, /git -C apps\/canonical-web-server\.rs rev-parse HEAD/);
  assert.match(trusted, /git -C apps\/canonical-api-server\.rs rev-parse HEAD/);
});
test("no credential is used before fixed allowlist and cargo config checks", () => {
  const gate = trusted.indexOf("      - name: Pre-credential immutable Git source admission");
  assert.ok(gate >= 0 && gate < beginning);
  assert.match(trusted.slice(gate, beginning), /node scripts\/check-cargo-git-sources\.mjs/);
  assert.match(trusted.slice(gate, beginning), /test ! -e "\$app\/\.cargo\/config\.toml"/);
  assert.doesNotMatch(trusted.slice(0, beginning), /secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN/);
});
test("Cargo token only lives inside fetch step, with no builds or publishing", () => {
  assert.equal((workflow.match(/secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN/g) || []).length, 1);
  assert.match(fetchStep, /PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}/);
  assert.match(fetchStep, /install -m 0700 .github\/scripts\/private-cargo-askpass\.sh "\$askpass"/);
  assert.match(fetchStep, /export GIT_ASKPASS="\$askpass"/);
  assert.match(fetchStep, /trap 'rm -f -- "\$askpass"' EXIT/);
  assert.match(fetchStep, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-web-server\.rs\/Cargo\.toml/);
  assert.match(fetchStep, /cargo \+1\.95\.0 fetch --locked --manifest-path apps\/canonical-api-server\.rs\/Cargo\.toml/);
  assert.doesNotMatch(fetchStep, /\bcargo .*?\b(?:test|run|build|check)\b|\bnpm\b/);
  assert.doesNotMatch(workflow, /docker\/(?:login-action|build-push-action)|packages:\s*write/);
});
test("after fetch, lock regeneration and Rust tests are offline and token-free", () => {
  assert.doesNotMatch(afterFetch, /PRIVATE_CARGO_TOKEN|GIT_ASKPASS|secrets\./);
  assert.match(afterFetch, /CARGO_NET_OFFLINE: "true"/);
  assert.match(afterFetch, /cargo \+1\.95\.0 generate-lockfile --offline/);
  assert.match(afterFetch, /cmp "\$app\/Cargo\.lock"/);
  assert.match(afterFetch, /cargo \+1\.95\.0 clippy/);
  assert.match(afterFetch, /cargo \+1\.95\.0 test/);
});
test("RustSec auditing is strict and any rkyv exception requires a graph proof", () => {
  assert.match(afterFetch, /cargo \+1\.95\.0 install cargo-audit --locked --version 0\.22\.2/);
  assert.match(afterFetch, /bash scripts\/check-rkyv-active-graph\.sh/);
  assert.match(afterFetch, /cargo audit --deny unmaintained --deny unsound --deny yanked/);
  assert.match(afterFetch, /--ignore RUSTSEC-2026-0173 --ignore RUSTSEC-2026-0235/);
  const audits = afterFetch.match(/cargo audit --deny unmaintained/g) || [];
  assert.equal(audits.length, 2, "both Rust lockfiles must be audited");
  assert.doesNotMatch(fetchStep, /\bcargo audit\b/);
});
test("workflow does not publish artifacts or modify release pointers", () => {
  assert.doesNotMatch(workflow, /docker\s+push|--push|git\s+push|curl.*POST.*\/releases/);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|id-token:\s*write/);
});

test("preflight grants only the read access GitHub needs for environment metadata", () => {
  assert.match(preflight, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
  assert.doesNotMatch(preflight, /actions: write|contents: write|secrets\./);
});
test("all pages of reviews are combined before source admission", () => {
  assert.match(preflight, /gh api --paginate "repos\/\$repo\/pulls\/\$WEB_PR\/reviews\?per_page=100" \|\s*\n\s+jq -s 'add'/);
  assert.match(trusted, /gh api --paginate "repos\/\$repo\/pulls\/\$WEB_PR\/reviews\?per_page=100" \|\s*\n\s+jq -s 'add'/);
  assert.doesNotMatch(workflow, /reviews\?per_page=100" > /);
});
test("post-approval source review is rechecked immediately before token boundary", () => {
  const afterGate = trusted.indexOf("      - name: Revalidate candidate reviews after environment approval");
  const staticAdmission = trusted.indexOf("      - name: Pre-credential immutable Git source admission");
  assert.ok(afterGate >= 0 && staticAdmission > afterGate && beginning > staticAdmission);
  const fresh = trusted.slice(afterGate, staticAdmission);
  assert.match(fresh, /node scripts\/trusted-candidate-admission\.mjs/);
  assert.match(fresh, /WEB_SHA: \$\{\{ needs\.preflight\.outputs\.web_sha \}\}/);
  assert.match(fresh, /WEB_TREE: \$\{\{ needs\.preflight\.outputs\.web_tree \}\}/);
  assert.match(fresh, /WEB_PR: \$\{\{ needs\.preflight\.outputs\.web_pr \}\}/);
  assert.doesNotMatch(fresh, /secrets\./);
});
test("preflight tree is confirmed against immutable checked-out Git tree", () => {
  assert.match(preflight, /echo "web_tree=\$tree" >> "\$GITHUB_OUTPUT"/);
  assert.match(trusted, /EXPECTED_TREE: \$\{\{ needs\.preflight\.outputs\.web_tree \}\}/);
  assert.match(trusted, /test "\$\(git -C apps\/canonical-web-server\.rs rev-parse 'HEAD\^\{tree\}'\)" = "\$EXPECTED_TREE"/);
});
