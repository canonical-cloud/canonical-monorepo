# ores-stack-lib-core

Internal ORES Stack runtime/build contracts.

`ModuleDescriptor` is the serialized/admission projection of the statically typed exports from `ores-stack-pub-lib-core`. It validates the contract version, semantic module kind, public interface identity, portable module name, concrete runtime entrypoint, execution policy, and requested capability set.

`AdmissionProfile` is the provider/runtime boundary. A deployment profile explicitly determines which capabilities are allowed, whether streaming/event invocation is admitted, and which timeout/concurrency budgets are acceptable. Capability declarations are therefore requests rather than ambient authority.

The v2 semantic fields are additive: a v1 descriptor without `semantics_version`, policy overrides, or capabilities remains valid. That lets the CLI/runtime adopt stronger admission incrementally without breaking existing module descriptors.

This layer does not replace RPC operation authority: `OperationSpec` and `TypedOperationContext` remain the per-operation semantic contract used by the CLI/API docs pipeline.

## Typed Stack SDK runtime

The public programmatic SDK contract lives in `ores-stack-pub-lib-core::sdk`. This crate pins that public contract by immutable Git revision and implements the runtime-side `StackSdkBackend` boundary through `sdk::StackRuntimeBackend`.

The dependency direction is intentionally one-way:

1. callers depend on `ores-stack-pub-lib-core` for typed requests and the `StackSdk` facade;
2. `ores-stack-lib-core` implements runtime admission and typed dispatch;
3. the `ores-stack` CLI must be a thin argument parser over the same backend rather than a second runtime authority;
4. when stack runtime execution needs compose supervision, the concrete executor imports a pinned `ORESoftware/ores-compose` Rust SDK and calls `ores_compose::sdk::ComposeSdk` in-process;
5. SDK-owned paths must not spawn the `ores-stack` or `ores-compose` executables;
6. `ores-compose` must not depend on `ores-stack`.

Generated-infra and ordinary-repository development remain distinct typed targets. Runtime admission rejects an empty root before invoking an executor, so CLI path-shape inference does not leak into the public SDK contract.
