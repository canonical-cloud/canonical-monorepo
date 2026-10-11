# Oreslang Stack CLI security and correctness audit

**Audit date:** 2026-10-08 (America/Lima)
**Scope:** `oreslang-stack-cli` PR #2 and its Java/Graal stdlib dependency
[`oreslang-source.java` PR #496](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/496).
The CLI code is `src/main.ores`; the shell launcher is strictly an argv,
runtime invocation and distribution-packaging adapter. No Rust generator exists.

## Verified execution evidence

The original ores-truffle-oreslang GitHub organization had workflow failures
with no executed steps, so a **separate private CI-only branch** in
`ores-stack/ores-stack-cli` mirrored the source at the audited commit without
using any cross-organization checkout token. No mirrored source was published
in a public repository. All three scoped workflows passed:

- Real `flags-2-env` parser compilation, schema audit, Bash syntax and mocked
  bootstrap/negative tests:
  https://github.com/ores-stack/ores-stack-cli/actions/runs/37884619749
- Real GraalVM 25 / Maven/JUnit `NativeCliIoTest`: 5 tests passed,
  including compile/typecheck of complete `src/main.ores`, scoped
  directory-metadata access, atomic writes, and symlink escapes:
  https://github.com/ores-stack/ores-stack-cli/actions/runs/37884619591
- Full Java/Graal application CLI integration using the pinned `flags-2-env`,
  including deterministic route inventory, Oreslang RPC/Lambda generation,
  compiler validation, drift detection, authored-file refusal, web/API
  distinctions, ambiguous route rejection, source bundling and unsupported
  deployment refusal:
  https://github.com/ores-stack/ores-stack-cli/actions/runs/37884619670

The last suite is a **real Oreslang runtime** test, not a mocked interpreter.
Passing these tests does not certify deployment, memory-safe hostile workspace
handling, or performance at large source-tree scale.

## Concrete bugs fixed during audit

1. `flags2env shell-env` includes synthetic argv[0] in the positionals
   collection. The launcher now admits only the exact expected token and
   rejects unknown options/structured parse errors explicitly.
2. Build previously moved the source archive twice, failing after the first
   rename. There is now only one final rename.
3. Project sources were copied without an explicit allowlist. Bundle staging
   now includes only `.ores` source, the project manifest,
   route inventory, exact entrypoint receipt, and source runner; `.env` and
   unrelated workspace files cannot be copied through the default pipeline.
4. Runtime-generated artifacts were overwritten by truncation; the stdlib now
   provides scoped `fs.write_text_atomic` with a same-directory temporary
   file and atomic replace, refusing symlink output slots.
5. Read-only commands previously received write capability. Route listing,
   compiler check and generation `--check` now receive only read permission.
6. The generator could change route adapters before rejecting an unowned
   existing JSON route manifest. Manifest ownership is now admitted before
   any adapter mutation, and regression-tested.
7. Shell compiler inventory previously used a process substitution that could
   mask a failed `find`; it now propagates enumeration errors and rejects
   symlinked sources before compiling.
8. The bundle runner required Bash `-v` and always used `src/main.ores`.
   It now supports older macOS Bash and a validated, recorded alternate
   source entrypoint.
9. The Graal Oreslang compiler exposed literal String inference, ownership,
   and general boolean-expression grammar mismatches with the initial
   generator. The Oreslang generator now uses explicit `String` bindings
   and native `if` conditions; full-source typechecking passes.
10. The interpreter did not resolve file-level `const` values at nested
    callable execution, so the generator uses callable markers.
11. Original route/RPC/Lambda examples were not compiler-compatible named
    modules. The sources and emitted wrappers now use actual `define module`
    declarations, and the full generated import graph passes compilation.
12. The stdlib now exposes literal-string tokenization, validation and
    filesystem enumeration through capability-scoped Oreslang APIs.

## Follow-up hardening (PR #8, 2026-10-09)

The current draft branch, pending exact-head Java/Graal execution, adds:

- Top-level and nested route-role exclusivity: incompatible `pages` and
  `routes` trees cannot be silently ignored by inventory and generation.
- File-type validation for the project manifest, sources, handlers, generated
  targets, and entrypoints, including directory collision refusals.
- Source-bundle runner validation of physical entrypoint parent paths and
  lexical traversal/double-separator components, preventing entrypoint
  redirection outside the extracted `src` directory through a symlink.
- The distributable source bundle excludes `.oreslangc.cfg.toml` by
  default; local compiler configuration may contain credentials and private
  paths. Runtime config must be supplied separately.
- Negative regression coverage for fail-closed cases and no-write preflight
  properties. These cases have not yet passed a real Oreslang test run.

**Do not carry forward the earlier passing audit runs as PR #8 validation.**
PR #8 must remain draft until its exact head executes real Java/Graal
compiler and end-to-end checks.

## Remaining security and product constraints

**These are explicit non-goals/unresolved risks, not verified features:**

- The Java/Graal filesystem metadata + path-scoped grants are not
  race-free `openat`/directory capabilities against a concurrently
  malicious process mutating source directories. All-source write transactions
  are not currently atomic as a group. Treat input repositories as locally
  trusted workspaces.
- File contents and total route tree bytes do not yet have end-to-end
  admission budgets; the stdlib caps one directory listing at 20,000 entries
  and the CLI caps nesting at 32.
- Oreslang's route handler interface remains a transport-neutral
  `String -> String` envelope, not verified typed GraphQL/Protobuf/RPC/Lambda
  transport schemas or a production Lambda runtime.
- `dev` launches once, with compiler preflight, but has no file watcher,
  supervisor/actor hot-replacement or rollback policy.
- `build` produces a checked, runnable **source distribution**, not a
  native executable, AOT/JVM distribution, signed provenance, or a portable
  WASM/LLVM artifact.
- `deploy` always fails closed and has no verified target host, artifact
  signature, auth/isolation or successful deployment receipt.
- The Oreslang LLVM backend does not yet support the language/runtime features
  needed by this CLI; Java/Graal green checks do not imply LLVM parity.
- The private CI mirror is disposable test evidence; its branch is not a
  source of upstream production code and must not be merged into
  `ores-stack-cli`.

Both upstream PRs should remain draft until the desired production build,
hot reload, and deployment capabilities have separate acceptance contracts.
