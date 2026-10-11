# ores-stack-pub-lib-core

Public, user-facing Rust contracts for code exported through ORES Stack entrypoints.

The primary module API is `TypedModule`. A module selects a type-level semantic kind (`Lambda`, `Http`, `Rpc`, `Page`, `Middleware`, or `Worker`) and declares its input/output/error/context types. Generated and scaffolded entrypoints can call `assert_module::<T>()` so a bad export fails at compile time.

## Typed Stack SDK

`ores_stack_pub_lib_core::sdk` is the public programmatic boundary for invoking ORES Stack without shelling out to the `ores-stack` CLI.

The first stable surface is typed development invocation:

```rust
use ores_stack_pub_lib_core::sdk::{StackDevOptions, StackSdk};

let sdk = StackSdk::new(runtime_backend);
sdk.dev(StackDevOptions::generated_infra("./alpha-infra"))?;
```

The dependency direction is intentional:

- callers import typed requests and the SDK facade from `ores-stack-pub-lib-core`;
- `ores-stack-lib-core` owns the runtime backend implementation and admission;
- the `ores-stack` CLI is a thin argument-parsing adapter over the same typed implementation;
- when ORES Stack needs compose supervision, it imports a pinned `ores-compose` Rust SDK revision and calls it in-process;
- `ores-stack` must not spawn the `ores-compose` executable for SDK-owned paths, and `ores-compose` must not depend on `ores-stack`.

This keeps versions explicit in Cargo metadata, preserves compile-time checked calls, and prevents CLI argument text from becoming an internal API.

## Execution semantics

`TypedModule` also declares a provider-neutral `ModulePolicy` and requested `Capability` set. These describe how the module expects to run without granting ambient authority:

- invocation: request/response, stream, or event;
- concurrency: concurrent, serial, or keyed-serial;
- cancellation: cooperative or deadline-bound;
- timeout/concurrency hints;
- idempotency and retry-safety declarations;
- explicit capability requests such as HTTP, database, queue, storage, secrets, spawn, and filesystem access.

The runtime/deployment profile decides which capabilities and budgets are actually admitted. User code therefore describes requirements; it does not reach directly into AWS, GCP, Scintilla, BeamScale, or another provider API.

RPC operation semantics remain owned by the existing `OperationSpec` / `TypedOperationContext` model used by `ores-stack` and `api-docs`; `Rpc` here describes the exported module/dispatcher boundary rather than replacing per-operation contracts.

Runtime serialization, validation, deployment admission, and concrete SDK backend implementations belong in `ores-stack-lib-core`.
