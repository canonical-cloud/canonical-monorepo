# ORES Stack CLI migration

## Immutable source baseline

- Source repository: `ORESoftware/ores-stack`
- Source commit: `d46c07e0f91c2dbda9b2fee64bdd82f6d52fc1ef`
- Source root tree: `2e0823161a32772273f8238a5f4d6fb0dc329d8d`
- Source CLI subtree: `crates/ores-stack-cli` / `844b2aa2791c4d22c5e01d4b9e12f464936e80db`
- Source core subtree: `crates/ores-stack-core` / `93d215a4433e7c0a6028b270dec0c01149918a86`
- Source process-tree subtree: `crates/ores-stack-process-tree` / `59d52cfd71783e5f70b4fe6241109fceea34d4f8`

The old repository stays intact until parity is proven. No history rewrite, deletion, or source-main mutation is part of this migration.

## RPC routing parity gate

The source history has two migration anchors that must not be conflated. The byte-reconstruction snapshot above is `d46c07e0f91c2dbda9b2fee64bdd82f6d52fc1ef`; the final pre-deprecation source tip recorded by the canonical README is `2fd66cfaaf0d014f0e27cf29eae6a943928724c5`, four commits later. The critical RPC blobs pinned by `migration/rpc-routing-parity.v1.json` are byte-identical across both anchors.

RPC migration must preserve the authority direction rather than merely copying filenames:

- route-less operations remain in the handlers-authoritative operation index while the persisted route map remains HTTP-only;
- canonical v3 client generation may project them through `POST /v1/rpc` in memory and represent the operation contract with `http: None`, but request/response typing still comes from admitted Contract IR;
- any route-map-only client lane that cannot type a selected route-less operation must fail closed rather than silently omit the operation;
- a secondary HTTP-client lane must not replace authoritative request/response shapes with empty defaults merely to keep the operation key present;
- native/custom `src/rpc/**/funcs.rs` operations must join the same aggregate RPC publication/client inventory as REST-derived RPC operations, with duplicate stable keys rejected;
- scaffolding, source admission, callable identity, publication, and dispatch must share one ASCII-lowercase dotted operation-key grammar; no case folding or Unicode normalization is allowed;
- partial HTTP projection metadata and stale persisted route-map entries for route-less operations fail closed.

The standalone checker in `tools/rpc_migration_parity_check.rs` enforces the evidence now and automatically begins checking the reconstructed core source as those files land. See `docs/rpc-routing-migration.md`.


## New-org contract baseline

The migration now targets the split contract repositories rather than recreating all contract ownership inside the CLI monorepo:

- `ores-stack/ores-stack-pub-lib-core` main includes the public `TypedModule` interface and `ores-stack.module-semantics/v2` policy/capability declarations.
- `ores-stack/ores-stack-lib-core` main includes runtime admission plus the server-only `InternalModule` interface.
- `ores-stack/ores-stack-lib-core` also retains independently authored TypeSpec and JSON Schema Draft 2020-12 module-descriptor authorities with a retained v2 fixture.
- Existing RPC `OperationSpec` / `TypedOperationContext`, page, middleware, and transport authorities remain independent; the module contract describes exported module/runtime boundaries rather than replacing those authorities.

## Cross-stack target compatibility

`contracts/stack-target-compatibility.v1.json` is the machine-readable portability contract for translating ORES Stack module semantics to other deployment stacks. Its JSON Schema is retained independently at `contracts/stack-target-compatibility.schema.json`.

`crates/ores-stack-cli/src/target_compatibility.rs` is the executable Rust projection of that policy. It provides `supports_kind`, `map_capability`, and fail-closed `validate_portability` checks, with standalone unit tests in the migration CI lane.

The initial contract is deliberately fail-closed:

- ORES Stack is the native baseline for lambda, HTTP, RPC, page, middleware, and worker modules.
- BeamScale admits direct lambda/HTTP/RPC/worker kind portability but does **not** silently translate ORES ambient capabilities into its hosted Context. Unsupported capability mappings are explicit `null` values and the Rust policy returns `UnsupportedCapability`.
- Scintilla admits direct lambda/HTTP/RPC/worker kind portability and maps compatible capabilities such as `http_client -> network_outbound` and `spawn -> process_spawn`.
- Lunatic Lorry and wasm-xprs initially admit only `lambda` modules. Both fail closed on ORES ambient capabilities until explicit host-capability mappings are reviewed; wasm-xprs separately admits only its fixed `wasmx-v1` input/output/log ABI.
- Lunatic Lorry uses a fresh Lunatic WebAssembly process/actor per invocation; module bytes or compiled code may be cached, but actor state may not be reused.
- wasm-xprs uses a fresh Wasmtime `Store` + `Instance` per invocation; the compiled `Module` may be cached, but guest memory/globals/tables are invocation-local.
- page and middleware are explicitly non-native on BeamScale and Scintilla until a separate adapter contract proves equivalent semantics.
- target-specific extra kinds (for example BeamScale actors or Scintilla containers) are not inferred from an ORES source module.

`contracts/deploy-target.v2.tsp` and the independently authored Draft 2020-12 `contracts/deploy-target.v2.schema.json` define the next deployment target envelope. It separates `runtime_stack` from infrastructure `provider`, so combinations such as Scintilla-on-GCP and ORES-Stack-on-AWS are representable without conflating the runtime with the cloud. Hosted provider values `beamscale`, `scintilla`, `lunatic_lorry`, and `wasm_xprs` are constrained to their matching runtime stacks. Retained fixtures exercise the hosted and cloud-backed shapes; the WASM hosted providers are additionally constrained to `artifact_kind=lambda` and `module_kind=lambda`.

`contracts/lambda-adapter.v1.tsp` and `contracts/lambda-adapter.v1.schema.json` define the provider binding emitted by `ores-stack generate lambda-adapter`. The generated manifest binds a provider-neutral source digest to a runtime repository, runtime contract, execution boundary, isolation model, cache policy, instance-reuse policy, and ambient-import policy. It deliberately does not put provider lifecycle or business-routing semantics into `lambda.rs`.

The legacy `.ores-stack.yaml` deploy-v1 planner still needs to invoke `validate_portability` before provider mutation once the pinned legacy deploy/core dependency closure is reconstructed. The dedicated WASM Lambda deploy path is separately hardened: it materializes a provider-bound receipt, requires the runtime CLI to bind that receipt before daemon mutation, and verifies an exact normalized runtime acknowledgement after mutation.

## Why the CLI cannot be copied as an isolated directory

The current CLI crate has local path dependencies on `../ores-stack-core` and `../ores-stack-process-tree`, and its build script reads the workspace-root `.cli-flags.toml`. Copying only `crates/ores-stack-cli` would therefore create a repository that looks migrated but does not build.

The first import must preserve a buildable dependency closure. After parity, reusable/public contracts should move to `ores-stack-lib-core` and `ores-stack-pub-lib-core` deliberately rather than by silently changing behavior during the copy.

## Target layout

- `ores-stack-cli`: CLI/application migration target and transitional dependency closure.
- `ores-stack-lib-core`: internal runtime/build/admission projection plus server-only compile-time module interface.
- `ores-stack-pub-lib-core`: public compile-time traits/interfaces for user-exported lambda, HTTP, RPC, page, middleware, and worker modules.

## Reconstruction status

Copied from the pinned source snapshot unless explicitly marked as a migration change:

- [x] root workspace `Cargo.toml` (migration change: repository metadata now points at `ores-stack/ores-stack-cli`)
- [x] `rust-toolchain.toml`
- [x] root `.cli-flags.toml` (migration change: adds the typed `module create` command contract)
- [x] complete `crates/ores-stack-process-tree` crate
- [x] `crates/ores-stack-cli/Cargo.toml`
- [x] `crates/ores-stack-cli/build.rs`
- [x] `crates/ores-stack-cli/src/entry.rs` (migration change: dispatches typed module scaffolding)
- [x] `crates/ores-stack-cli/src/config_cli.rs` (byte-for-byte source reconstruction; blob `034f9ded1b28ae974c9d05b36f15e5445bf0f782`)
- [x] `crates/ores-stack-cli/src/deploy_cli.rs` (byte-for-byte source reconstruction; blob `ffd9c276409dfbe046a129532da74f5e93460f20`)
- [x] `crates/ores-stack-cli/src/docs_cli.rs` (byte-for-byte source reconstruction; blob `83f5584924945dc829f13d8a816fc387a6287ba9`)
- [x] `crates/ores-stack-cli/src/module_cli.rs` (new migration feature)
- [x] cross-stack target compatibility contract + Draft 2020-12 schema
- [x] deploy-target v2 TypeSpec + independent Draft 2020-12 schema + BeamScale/Scintilla fixtures
- [x] executable Rust target portability policy (`target_compatibility.rs`)
- [x] lambda adapter v1 TypeSpec/JSON Schema contract and `generate lambda-adapter` CLI projection
- [x] Lunatic Lorry + wasm-xprs lambda-only compatibility identities and deployment fixtures
- [x] Rust-only migration/parity checker (`tools/migration_contract_check.rs`)
- [ ] remaining source `crates/ores-stack-cli/src/**` modules and CLI tests
- [ ] complete `crates/ores-stack-core` dependency
- [ ] other source workspace members required by the original root manifest
- [ ] root lockfile/config/conformance fixtures required for parity checks

## Typed module scaffolding

The migration branch now exposes:

`ores-stack module create --root <repo> --name <snake_case> --kind <lambda|http|rpc|page|middleware|worker>`

It can infer public/internal scope from `*-pub-lib-core` vs `*-lib-core` / `*-lib-code`, or accept `--scope`. It emits compiler-constrained `TypedModule` or `InternalModule` implementations, static assertions, v2 execution policy, explicit capability requests, and descriptor projection. It refuses authored-file overwrites, duplicate/unknown capability requests, invalid identifiers, zero concurrency, and symlinked output directories.

This command is additive. It does not replace `OperationSpec`, `#[ores_page]`, middleware composition, REST route, GraphQL, or WebSocket authorities.

## Independently proven migration slice

The draft branch has a migration-only CI lane that does not depend on the not-yet-copied legacy workspace members. On Rust 1.88 it verifies:

- `rustfmt --check` for migration-authored Rust (`module_cli.rs`, `target_compatibility.rs`, and the Rust migration verifier);
- exact Git blob identity for immutable source reconstructions, including CLI manifest/build/config/deploy/docs and the process-tree crate;
- standalone compilation and tests for `module_cli.rs`;
- standalone compilation and tests for the executable target portability policy;
- `.cli-flags.toml` `module create` authority;
- `entry.rs` module command dispatch;
- Rust 1.88 + new-org workspace metadata;
- required BeamScale/Scintilla target-compatibility identities and capability mappings;
- deploy-target v2 runtime/provider separation and hosted-stack binding rules;
- explicit BeamScale capability non-widening;
- parity between the retained machine-readable policy and required executable-policy symbols/mappings.

The source blob gate intentionally does **not** reformat the historical source snapshot: the old `config_cli.rs` and `docs_cli.rs` are not rustfmt-clean under Rust 1.88, so byte identity is the stronger migration invariant until a later intentional formatting-only change is reviewed separately.

These migration/parity assertions are implemented in Rust, not Python, via `tools/migration_contract_check.rs`.

The full workspace is still intentionally not called green until the immutable source dependency closure is reconstructed.

## Promotion checklist

- [ ] Reconstruct the immutable source snapshot/dependency closure in this repository.
- [x] Preserve and extend the authored `.cli-flags.toml` authority used by the CLI build script.
- [ ] Preserve all generated/runtime expectations, tests, and source-relative behavior.
- [x] Make repository/workspace metadata point at `https://github.com/ores-stack/ores-stack-cli` without changing existing user-facing CLI semantics.
- [x] Establish split public/internal module contract authorities in the new org.
- [x] Add typed module scaffolding that targets those split contracts.
- [x] Add fail-closed BeamScale/Scintilla target compatibility authority.
- [x] Add deploy-target v2 runtime-stack/provider contract with independent TypeSpec + JSON Schema authorities.
- [x] Add an executable Rust target portability policy with positive/negative unit tests.
- [x] Add AWS/GCP/Scintilla/Lunatic-Lorry/wasm-xprs lambda adapter generation without widening provider-neutral handler semantics.
- [x] Move migration/parity verification to Rust and SHA-gate immutable source copies.
- [x] Add public and internal Rust compile-conformance fixtures for module interface constraints.
- [ ] Wire target compatibility into the real deploy planner before provider mutation.
- [ ] Run `cargo fmt --check` on the complete migrated Rust 1.88 workspace after deciding whether source-format drift is an explicit migration change.
- [ ] Run clippy with warnings denied on the complete migrated workspace.
- [ ] Run the imported CLI/core/process-tree test suites.
- [ ] Reconstruct and harden RPC authority/client generation so route-less operations are preserved without synthetic REST routes, silent omission, or schema downgrades.
- [ ] Wire native/custom `src/rpc/**/funcs.rs` leaves into production RPC client publication; do not leave `build_rpc_publication_inventory` test-only/dead.
- [ ] Reconcile scaffold operation-key validation with the core wire-key grammar before migrating `scaffold_cli.rs` unchanged.
- [ ] Prove scaffold/RPC/deploy behavior against the source baseline.
- [ ] Only then make this repository the release authority and mark the old repo as migrated/read-only.

## Actions-runner note

A temporary source-repo export workflow was attempted from a migration-only PR, but the GitHub Actions job received no executed steps because the source account had no runner capacity available. The temporary PR was closed without merge. This does not constitute a build or export failure and did not alter source `main`.
