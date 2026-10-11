# SDK dependency-direction governance

The ORES Stack SDK is an in-process typed API, not a wrapper around CLI subprocesses.

The language-neutral semantic authority lives in `ores-stack/ores-stack-interfaces` and is pinned for this implementation line at merge `e24f1e516186a9f68bf0f938f41e445f2a1cb4b9`:

- `contracts/stack-sdk.tsp`
- `contracts/stack-sdk.schema.json`
- `conformance/stack-sdk-dev-v1.json`

The Rust public projection is pinned from `ores-stack-pub-lib-core` at `5901b05f82b8985e522f59828a01c35ef3a9727a`. That projection itself records the same interfaces authority revision and the exact `generated_infra` / `repository` semantic spellings.

## Required graph

```text
ores-stack-interfaces semantic authority
  -> Rust caller / ores-stack-pub-lib-core::sdk projection
  -> ores-stack-lib-core runtime backend
  -> pinned runtime adapters
  -> ores_compose::sdk::ComposeSdk when compose supervision is required
```

The following reverse or process boundaries are forbidden for SDK-owned operations:

- `ores-stack-lib-core -> spawn("ores-stack")`
- `ores-stack-lib-core -> spawn("ores-compose")`
- `ores-stack CLI -> a separate runtime implementation that bypasses the core backend`
- `ores-compose -> ores-stack`

CLI argument parsing is an adapter only. It must project into the same typed request structures used by non-CLI Rust callers.

## Portable admission

Before any concrete executor is called, the runtime backend must preserve the portable v1 root contract:

- root is non-empty;
- root is valid UTF-8 for the language-neutral projection;
- root is at most 4096 Unicode characters;
- root contains no NUL;
- generated-infra and repository targets remain explicit distinct variants.

Filesystem canonicalization, symlink policy, trusted-root checks, generated authority markers, and product-specific permissions are stricter runtime admission layers. They may narrow admission but must not reinterpret the portable target kind.

## Pinning and private dependency auth

Cross-repository dependencies that define runtime or public SDK semantics must use immutable Git revisions until a reviewed release/versioning policy provides equivalent immutability. Floating branches are not acceptable for these boundaries.

Private sibling dependencies require a fine-grained read-only credential such as `ORES_CLI_READ_TOKEN`. CI must fail closed when it is unavailable. Tokens must not be embedded in dependency URLs, printed, persisted through checkout credentials, or written into repository files. Temporary credential helpers/files must use restrictive permissions and be removed with an `always()` cleanup step.

## Tests

Changes to the SDK runtime boundary must prove:

- explicit typed dispatch for each public target variant;
- portable invalid roots fail before runtime execution;
- the SDK backend module contains no process-spawn boundary;
- shared interfaces/conformance authority is pinned and reviewed;
- CI runs Rust formatting, warnings-denied Clippy, and tests on the exact PR head.

Concrete executors may spawn user-declared workloads, build tools, container runtimes, or trusted helpers as required by their own contracts. The prohibition is specifically against turning `ores-stack` or `ores-compose` CLI executables into an internal SDK protocol.
