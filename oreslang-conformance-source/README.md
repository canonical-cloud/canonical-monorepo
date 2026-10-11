# Oreslang platform conformance

Cross-platform, **evidence-first** language and runtime conformance suite. A harness that has not run a real compiler must never claim parity.

## Current deliverable

- Versioned fixture manifest and minimal positive/negative .ores sources.
- Safe subprocess-based command runner with an argv template; no shell interpolation.
- Executable harness unit tests (using a **fake checker** to verify the harness only).
- Explicit status: unconfigured, verified, mismatch, spawn failure, timeout.
- CI tests the harness. It does **not** claim Java/LLVM/Wasm feature parity without configured external compiler binaries.

## Examples

~~~sh
npm test
# A compiler that supports a non-executing --check mode:
node bin/conformance.mjs --backend=java --argv='["/absolute/path/to/java","-jar","/path/to/compiler.jar","--check","{file}"]' --source-sha=FULL_COMMIT_SHA --require
# A separate exact-head native compiler:
node bin/conformance.mjs --backend=llvm --argv='["/absolute/path/to/oreslang-llvmc","{file}"]' --source-sha=FULL_COMMIT_SHA --require
~~~

The first argv token must be an **absolute executable path** (never a PATH lookup), and the placeholder {file} is replaced with an absolute fixture path. Provide the exact committed compiler binary/revision. The harness records SHA-256 hashes of the executable and each fixture. The user-provided source commit SHA is explicitly marked **declared, not cryptographically attested to the compiler binary**; include independent build provenance to prove the relationship. The harness does **not** install/checkout compiler source or infer that one backend supports another backend's features.

When no backend command is supplied, the run exits non-success with explicit UNCONFIGURED status if --require is used. Without --require it can emit an explicit skipped summary for discovery; that is **not** a passing parity report. CI only exercises harness self-tests.

## Ownership and future steps
1. Pin compilation frontend/host revisions, profile registry contract and all fixture hashes.
2. Feed actual Java and LLVM non-executing check entrypoints into this harness; verify positive and negative cases.
3. Add runtime-output cases only after explicit backend support; compare typed values, actor messages, ownership, async and resource limits.
4. Add Wasm compile+instantiate and browser tests once the compiler emits actual Oreslang guest modules.
5. Extend environment-header fixtures when Java PR #586 is merged and LLVM implements equivalent checks.
6. Publish provenance (platform, toolchain, source/tree commit, raw logs, status) for each real evidence run.

**Security**: never mirror private compiler source into public repos. Same-org private GitHub repositories are not automatically readable with the test repo GITHUB_TOKEN. Use authorized credentials or approved private exact-tree CI mirroring; keep SHA evidence and delete temporary mirrors.

See https://ores-truffle-oreslang.github.io/logs/2/
