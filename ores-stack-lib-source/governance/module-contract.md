# Module contract governance

ORES Stack module exports are governed by independent but parity-checked authorities:

- `contracts/module-descriptor.tsp` — authored TypeSpec semantic authority;
- `contracts/module-descriptor.schema.json` — independently authored JSON Schema Draft 2020-12 wire authority;
- `src/lib.rs` — Rust runtime/admission implementation;
- `ores-stack-pub-lib-core` — public compile-time module interface surface.

No representation is generated and then silently treated as the sole source of truth. Changes must preserve semantic parity across authored authorities and the runtime implementation, or explicitly introduce a new contract/semantics/interface version.

## Compatibility rules

- `ores-stack-module-contract-v1` is the descriptor envelope.
- `ores-stack.module-semantics/v2` opts into policy/capability semantics.
- module kind determines a canonical interface identity (`ores-stack.<kind>.v1`).
- capability lists are requested authority; deployment admission determines granted authority.
- duplicate capabilities and `max_concurrency = 0` are invalid.
- provider/runtime adapters may strengthen resource or isolation policy but must not silently widen requested capabilities or weaken declared semantics.

## RPC layering

`ModuleDescriptor(kind = rpc)` describes an exported RPC module/dispatcher boundary. It does not replace the existing `OperationSpec` / `TypedOperationContext` operation authority. Operation IDs, DTOs, audiences, HTTP/GraphQL projections, and operation-level authorization remain governed by that existing RPC contract pipeline.

## Conformance expectations

Each contract change should retain positive fixtures and add negative tests for every newly rejected state. The authored TypeSpec and JSON Schema vocabularies must remain aligned with Rust wire names, and public SDK/static descriptors must project to descriptors accepted by internal admission without hidden translation.
