# ores-stack-cli

## Project identity: ORES Stack is not Oreslang Stack

**ORES Stack** (`ores-stack`) and **Oreslang Stack** (`oreslang-stack`) are **different projects, CLIs, codebases, and release tracks**. Similar names do not imply interchangeable commands or shared package ownership.

| | ORES Stack (this repository) | Oreslang Stack (separate project) |
| --- | --- | --- |
| CLI source | [`ores-stack/ores-stack-cli`](https://github.com/ores-stack/ores-stack-cli) | [`ores-truffle-oreslang/oreslang-stack-cli`](https://github.com/ores-truffle-oreslang/oreslang-stack-cli) |
| Command | `ores-stack` | `oreslang-stack` |
| Implementation | Rust/Cargo tooling and contracts | Oreslang command implementation in `src/main.ores`, with a POSIX bootstrap and Oreslang Java/Graal runtime dependency |
| Focus | ORES Stack modules, RPC/lambda adapters, provider-bound WASM builds and deployment plumbing | Oreslang-native application scaffolding, route discovery, source generation and checking; deployment is not yet certified |

**Repository and CI boundaries:** An Oreslang source branch copied into `ores-stack/ores-stack-cli` for GitHub Actions is a **temporary test fixture**, not ORES Stack product code. Only mirror private source into an explicitly authorized **private** repository with suitable access controls; do not expose it through public branches, artifacts, or logs. The test runner checks out the *local* mirror using its own repository permission—not a cross-organization `GITHUB_TOKEN` or new secret. Record the originating source commit, compare the exact mirrored Git subtree SHA against that source commit, require actual runner execution and passing checks, and keep review/release ownership with the source project. Remove temporary mirrors after evidence is retained. A zero-step runner failure or a green older tree never certifies current source.

This repository is being migrated from the private monorepo `ORESoftware/ores-stack`. The immutable migration baseline is pinned to the final pre-deprecation source commit:

`2fd66cfaaf0d014f0e27cf29eae6a943928724c5`

The source repository is deprecated and retained only as migration evidence. Do not treat this repository as the authoritative release source until the migration checklist in `MIGRATION.md` is complete and the imported dependency closure passes Rust 1.88 build/test checks.

Released binaries must expose build provenance with `ores-stack --version` (or `ores-stack version --json`), including this repository identity, package version, source commit, and supported contract versions. Consumer automation must pin an immutable release plus checksum rather than installing a floating branch or tag; see `contracts/cli-install-pin.v1.schema.json` and `docs/cli-release-provenance-and-pinning.md`.

The new organization also splits reusable contracts into:

- `ores-stack/ores-stack-lib-core` — internal runtime/build/admission projection;
- `ores-stack/ores-stack-pub-lib-core` — public compile-time user-module contracts.

Those contracts intentionally complement, rather than replace, the existing `OperationSpec` / `TypedOperationContext` RPC operation model.

## Lambda adapter generation

Provider-neutral `lambda.rs` source can be bound to a concrete runtime without moving handler semantics into the provider wrapper:

```sh
ores-stack generate lambda-adapter \
  --root . \
  --source src/routes/rest/users/lambda.rs \
  --provider wasm-xprs

ores-stack generate lambda-adapter \
  --root . \
  --source src/routes/rest/users/lambda.rs \
  --provider lunatic-lorry
```

The generator first rejects provider/runtime-specific source tokens, then writes an `ores.lambda.adapter/v1` manifest plus a byte-identical copy of the admitted provider-neutral `lambda.rs`. Supported adapter targets are AWS, GCP, Scintilla, Lunatic Lorry, and wasm-xprs.

The WASM targets deliberately use lightweight isolate/actor boundaries rather than an OS process as the invocation boundary. `wasm-xprs` may cache compiled Wasmtime `Module` code but creates a fresh `Store` and `Instance` for every invocation. Lunatic Lorry may cache module bytes or compiled code but creates a fresh Lunatic process/actor per invocation. Invocation state reuse is forbidden for both; durable state is external-only.

WASM host authority starts fail-closed. ORES capabilities do not automatically become Lunatic permissions or arbitrary Wasmtime host imports. wasm-xprs links only its reviewed `wasmx-v1` input/output/log ABI; any broader authority requires an explicit reviewed runtime capability contract.

## Rust to WebAssembly materialization and deployment

`ores-stack lambda build` closes the adapter-to-artifact gap. It revalidates the adapter and provider-neutral source digest, compiles the selected Cargo target for the runtime-specific WebAssembly target, discovers the exact compiler artifact from Cargo JSON, validates the WebAssembly carrier, copies it into `build/lambda/<provider>/module.wasm`, hashes the exact bytes, and writes a side-effect-free **WASM** artifact receipt (`ores.lambda.wasm-artifact.receipt/v1`). The separate `ores.lambda.artifact.receipt.v2` schema applies to the historical AWS/GCP native artifact lane, not to these WASM targets.

The Cargo manifest identifies the application package whose generated API `lambda.rs` is being materialized. The CLI creates its own deterministic wrapper target named `ores_wasm_lambda_unit`; callers cannot redirect the build to an arbitrary Cargo target. If `--manifest-path` names a multi-package workspace, pass `--package` to identify the application package.

WASM materialization currently admits generated **API lambdas** only. Page/web lambdas use a different typed HTTP/page carrier and are rejected rather than being misrepresented as direct RPC invocation.

```sh
ores-stack lambda build \
  --root . \
  --provider wasm-xprs \
  --manifest-path Cargo.toml \
  --package my-api-server

ores-stack lambda build \
  --root . \
  --provider lunatic-lorry \
  --manifest-path Cargo.toml \
  --package my-api-server
```

The target triples are fixed by provider identity:

- `wasm-xprs` -> `wasm32-unknown-unknown`, with ambient WASI rejected before deploy;
- `lunatic-lorry` -> `wasm32-wasip1`, consumed by the Lunatic runtime.

`ores-stack lambda deploy` performs the same deterministic build/materialization and then hands the exact module plus adapter manifest to the runtime desktop CLI. `--tenant` and `--deployment` are immutable runtime identities.

```sh
ores-stack lambda deploy \
  --root . \
  --provider wasm-xprs \
  --manifest-path Cargo.toml \
  --package my-api-server \
  --tenant acme \
  --deployment users-20260927

ores-stack lambda deploy \
  --root . \
  --provider lunatic-lorry \
  --manifest-path Cargo.toml \
  --package my-api-server \
  --tenant acme \
  --deployment users-20260927
```

The runtime clients are fixed by provider identity: `wasmx-desktop-cli` for wasm-xprs and `ll-desktop-cli` for Lunatic Lorry. The CLI intentionally rejects a `--runtime-cli` override so a deployment cannot redirect the trusted runtime handoff to an arbitrary executable. The runtime remains responsible for final host-side import/capability admission and fresh invocation isolation.

## WASM Lambda artifact provenance

`ores-stack lambda build` produces an immutable `ores.lambda.wasm-artifact.receipt/v1` receipt for Lunatic Lorry and wasm-xprs. It binds the runtime repository/contract, adapter contract and adapter digest, provider-neutral source digest, deterministic wrapper/unit-manifest digests, target triple, and final WebAssembly artifact digest.

The WASM receipt intentionally has its own contract identifier. It does not reuse the historical `ores.lambda.artifact.receipt.v2` identifier, whose schema describes the older AWS/GCP native artifact lane. `lambda deploy` reports deployment mutation in its command result; it never rewrites the build receipt after deployment.

