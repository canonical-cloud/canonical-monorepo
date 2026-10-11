/**
 * Conservative paired Java+LLVM source-check evidence gate.
 *
 * Two individually passing checks are not runtime-output parity. Both compiler
 * binaries must additionally be tied to the declared source commits by an
 * independent build provenance attestation before calling this release evidence.
 */
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;

function verifyOne(run, backend) {
  if (!run || run.backend !== backend || run.configured !== true ||
      run.ok !== true || run.failed !== 0 ||
      !SHA40.test(run.declaredSourceSha || "") ||
      !SHA64.test(run.executableSha256 || "") ||
      !Array.isArray(run.results) || run.results.length === 0 ||
      run.verified !== run.results.length) {
    throw new Error(backend + " has no complete exact-head source-check evidence");
  }
  const ids = new Set();
  const evidence = new Map();
  for (const item of run.results) {
    if (typeof item.id !== "string" || !/^[a-z0-9-]+$/.test(item.id) ||
        ids.has(item.id) || item.status !== "VERIFIED" ||
        !SHA64.test(item.fixtureSha256 || "")) {
      throw new Error(backend + " has incomplete, duplicate, or invalid fixtures");
    }
    ids.add(item.id);
    evidence.set(item.id, item.fixtureSha256);
  }
  return evidence;
}

export function verifyPairedSourceChecks(javaRun, llvmRun) {
  const java = verifyOne(javaRun, "java");
  const llvm = verifyOne(llvmRun, "llvm");
  if (java.size !== llvm.size) {
    throw new Error("Java and LLVM ran different fixture sets");
  }
  for (const [id, sha] of java) {
    if (llvm.get(id) !== sha) {
      throw new Error("Java/LLVM fixture identity mismatch: " + id);
    }
  }
  return {
    status: "PAIRED_SOURCE_CHECKS_PASS",
    cases: java.size,
    sourceCommits: {
      java: javaRun.declaredSourceSha,
      llvm: llvmRun.declaredSourceSha,
    },
    executableSha256: {
      java: javaRun.executableSha256,
      llvm: llvmRun.executableSha256,
    },
    certifiesRuntimeParity: false,
    certifiesCompilerBuildProvenance: false,
    note: "Compilation admission only. Independent binary build attestation, runtime execution, ownership, actor scheduling and output equivalence remain separate gates.",
  };
}
