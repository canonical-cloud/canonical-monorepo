# Public SDK boundary governance

`ores-stack-pub-lib-core` is the publishable, user-facing Rust projection and compile-time boundary for ORES Stack. It must remain safe to depend on from user code without pulling in runtime orchestration, provider policy, process execution, or CLI parsing.

The language-neutral semantic authority lives in `ores-stack/ores-stack-interfaces`:

- schema version: `ores.stack.sdk/v1`
- authority merge: `e24f1e516186a9f68bf0f938f41e445f2a1cb4b9`
- TypeSpec: `contracts/stack-sdk.tsp`
- JSON Schema Draft 2020-12: `contracts/stack-sdk.schema.json`
- shared corpus: `conformance/stack-sdk-dev-v1.json`

This crate must project that contract rather than becoming a peer semantic authority.

## Allowed dependency direction

```text
ores-stack-interfaces semantic authority
  -> ores-stack-pub-lib-core::sdk Rust projection
  -> ores-stack-lib-core runtime implementation
```

The public crate must not depend back on `ores-stack-lib-core`; doing so would create a cycle and collapse the public/internal trust boundary.

The public SDK must not spawn `ores-stack`, `ores-compose`, or any other process. It defines typed requests, traits, stable semantic target identities, and facades only. Concrete runtime execution belongs in `ores-stack-lib-core` and downstream adapters.

## Projection rules

- `STACK_SDK_SCHEMA_VERSION` must remain `ores.stack.sdk/v1` for this contract generation.
- `StackDevTargetKind::GeneratedInfra` projects exactly to `generated_infra`.
- `StackDevTargetKind::Repository` projects exactly to `repository`.
- `StackDevTarget` must keep generated-infra and repository as distinct variants.
- Construction is not runtime admission: `PathBuf` can represent platform-specific states outside the portable contract, so a conforming backend must reject values that violate the shared root rules before executor invocation.
- No `Auto` variant or path-name inference may be introduced inside the public SDK contract.

## Compatibility

Changes to `StackSdkBackend`, `StackDevOptions`, `StackDevTarget`, `StackDevTargetKind`, or the SDK schema version are public API/contract projection changes. They require compile-time conformance evidence and an explicit compatibility/versioning decision. Breaking semantic changes require a new interfaces contract version rather than reinterpretation of `ores.stack.sdk/v1`.

## Regression gates

`tests/sdk_boundary.rs` rejects:

- a reverse dependency on `ores-stack-lib-core`;
- process-command execution introduced into `src/sdk.rs`.

SDK unit tests lock the v1 target spellings and the exact interfaces authority revision used by this projection. The ordinary Rust CI gate must continue to run formatting, warnings-denied Clippy, and all tests on the exact PR source.
