import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
const w=await readFile(new URL("../.github/workflows/trusted-cargo-remediation.yml",import.meta.url),"utf8");
const resolver=await readFile(new URL("../.github/scripts/offline-rust-remediate.sh",import.meta.url),"utf8");
const pre=w.slice(w.indexOf("  admission:"),w.indexOf("  resolve-only:"));
const trusted=w.slice(w.indexOf("  resolve-only:"));
const credentialStart=trusted.indexOf("      - name: Fetch only reviewed immutable private Git");
const credentialEnd=trusted.indexOf("      - name: Propose Cargo-resolved lockfile",credentialStart);
const credential=trusted.slice(credentialStart,credentialEnd);
test("remediation is manual, main-only, read-only, without publisher power",()=>{
  assert.match(w,/workflow_dispatch:/);
  assert.doesNotMatch(w,/\n\s+pull_request:|\n\s+pull_request_target:|\n\s+push:/);
  assert.match(pre,/github\.ref == 'refs\/heads\/main'/);
  assert.match(pre,/github\.repository == 'canonical-cloud\/canonical-monorepo'/);
  assert.doesNotMatch(w,/id-token:\s*write|contents:\s*write|packages:\s*write/);
});
test("separate protected independent reviewer environment is verified before auth",()=>{
  assert.match(pre,/canonical-private-cargo-remediation/);
  assert.match(pre,/prevent_self_review == true/);
  assert.match(pre,/protected_branches == true/);
  assert.match(trusted,/environment: canonical-private-cargo-remediation/);
});
test("all admission outputs have a valid source step ID",()=>{
  assert.match(pre,/id: verify/);
  for(const key of ["web_pr","web_sha","web_tree"]){
    assert.ok(pre.includes("steps.verify.outputs."+key));
    assert.ok(pre.includes('echo "'+key+'=$'));
  }
});
test("revalidates current exact head and Git tree after environment approval",()=>{
  assert.match(trusted,/EXPECTED_TREE|TREE_SHA/);
  assert.match(trusted,/git -C apps\/canonical-web-server\.rs rev-parse 'HEAD\^\{tree\}'/);
  assert.match(trusted,/recheck-reviews\.json/);
  assert.match(trusted,/trusted-remediation-admission\.mjs/);
  assert.ok(trusted.indexOf("Recheck independent review")<credentialStart);
});
test("public corrected registry patches are staged before any private token",()=>{
  const stage=trusted.indexOf("Prestage fixed public crates with no private source or tokens");
  const recheck=trusted.indexOf("Recheck independent review and immutable Cargo origins before token");
  assert.ok(stage>=0&&stage<recheck&&recheck<credentialStart);
  const body=trusted.slice(stage,recheck);
  for(const version of ["=0.4.4","=0.11.18","=0.23.46","=0.103.16","=1.0.10","=1.53.3"])
    assert.ok(body.includes(version),"missing pinned public fix "+version);
  assert.match(body,/cargo \\+1\\.95\\.0 fetch --manifest-path/);
  assert.doesNotMatch(body,/secrets\\.|PRIVATE_CARGO_TOKEN|GIT_ASKPASS/);
});
test("only the fetch step obtains private credential",()=>{
  assert.match(credential,/secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN/);
  assert.match(credential,/cargo \+1\.95\.0 fetch --locked/);
  assert.doesNotMatch(w.slice(0,w.indexOf("      - name: Fetch only")),/secrets\./);
  assert.doesNotMatch(trusted.slice(credentialEnd),/secrets\./);
  assert.doesNotMatch(credential,/cargo (?:test|build|run|clippy|update)/);
});
test("the resolution container cannot access the network or host secrets",()=>{
  assert.match(resolver,/--network none/);
  assert.match(resolver,/--cap-drop ALL/);
  assert.match(resolver,/--read-only/);
  assert.match(resolver,/CARGO_NET_OFFLINE=true/);
  assert.match(resolver,/source=\$src,target=\/source,readonly/);
  assert.doesNotMatch(resolver,/PRIVATE_CARGO_TOKEN|GIT_ASKPASS|--network host/);
});
test("only a proposed Cargo.lock is uploaded and no push or publish occurs",()=>{
  assert.match(trusted,/actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(trusted,/path: \$\{\{ runner\.temp \}\}\/canonical-remediated-lock\/Cargo\.lock/);
  assert.doesNotMatch(trusted,/^\s*(?:git push|gh pr create|docker push|cargo publish)\b/m);
});
