import test from "node:test";
import assert from "node:assert/strict";
import {verifyPairedSourceChecks} from "../src/paired-proof.mjs";

const sha40 = "a".repeat(40);
const fixture = "c".repeat(64);
function run(backend) {
  return {
    backend,
    configured: true,
    ok: true,
    failed: 0,
    verified: 2,
    declaredSourceSha: sha40,
    executableSha256: "b".repeat(64),
    results: [
      {id: "int-arithmetic", status: "VERIFIED", fixtureSha256: fixture},
      {id: "unresolved-identifier", status: "VERIFIED", fixtureSha256: "d".repeat(64)},
    ],
  };
}

test("paired gate records only exact-source compiler admission, not runtime parity", () => {
  const value = verifyPairedSourceChecks(run("java"), run("llvm"));
  assert.equal(value.status, "PAIRED_SOURCE_CHECKS_PASS");
  assert.equal(value.cases, 2);
  assert.equal(value.certifiesRuntimeParity, false);
  assert.equal(value.certifiesCompilerBuildProvenance, false);
});

test("reject missing compiler and false positive zero-test suites", () => {
  const llvm = run("llvm");
  llvm.configured = false;
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
  llvm.configured = true;
  llvm.results = [];
  llvm.verified = 0;
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
});

test("reject stale or partial fixture provenance", () => {
  const llvm = run("llvm");
  llvm.results[0].fixtureSha256 = "e".repeat(64);
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm), /mismatch/);
  llvm.results[0].fixtureSha256 = fixture;
  llvm.results[0].status = "UNCONFIGURED";
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
  llvm.results[0].status = "VERIFIED";
  llvm.declaredSourceSha = "uncommitted";
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
});

test("reject duplicate IDs, fixture count drift and executable digest omission", () => {
  const llvm = run("llvm");
  llvm.results[1].id = llvm.results[0].id;
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
  llvm.results[1].id = "unresolved-identifier";
  llvm.results.pop();
  llvm.verified = 1;
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm), /different fixture sets/);
  llvm.results = run("llvm").results;
  llvm.verified = 2;
  llvm.executableSha256 = null;
  assert.throws(() => verifyPairedSourceChecks(run("java"), llvm));
});
