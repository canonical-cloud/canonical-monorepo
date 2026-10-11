# Oreslang-native CLI command/host boundary

The command state machine, source discovery and generation are implemented in
`src/main.ores`. The Bash bootstrap `bin/oreslang-stack` only maps
`flags-2-env` output to read/write-scoped Oreslang invocation and orchestrates
external compiler and archive operations. It does **not** contain a Rust, JS or
Bash source generator.

## Admission receipts

- `ORESLANG_STACK_ACTION_v1:dev`: run the Oreslang entrypoint.
- `ORESLANG_STACK_ACTION_v1:build`: compiler-check all `.ores` files and
  package a runtime-dependent executable source bundle (`bin/oreslang-stack-run`). This is not a native binary.
- `ORESLANG_STACK_ACTION_v1:generated`: successful native generation.
- `ORESLANG_STACK_ACTION_v1:check`: successful drift verification, followed
  by host-invoked Oreslang compiler type checks.
- `ORESLANG_STACK_JSON_v1:...`: route manifest output, only for `routes`.
- Any unmatched/error receipt is a nonzero CLI failure.
- `deploy` never issues an accepted receipt; no target is deployable.

The bootstrapped runtime receives only env and read/write scoped to the
selected project. Production hardening should replace mutable pathname-based
metadata checks with directory-capability handles and atomic write/rename
primitives. A build-time tool must not execute arbitrary user source, and a
deploy command must not upload before compatibility proof.

## Runtime dependency

[`oreslang-source.java` PR #496](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/496)
adds `fs.list_dir/is_dir/is_symlink`, `String.split_literal/trim/starts_with/
ends_with/contains_literal/is_identifier/is_route_segment`. Both the CLI and
runtime PRs require independent Java compiler test evidence before merge.

## Remaining engineering milestones

1. Prove CLI `.ores` source typechecks and generated adapters compile using
   the Java/Graal toolchain. No GHA status can substitute for real tests.
2. Typed TypeSpec/GraphQL/Protobuf/RPC transport generation with domain contracts.
3. Actor-aware hot reload and dev watching, supervisor lifecycle and rollback.
4. Actual self-contained compiled backend artifacts and reproducible provenance.
5. Host-specific adapters and real deploy receipts. All remain disabled until
   implemented; supported target planning is not deployment proof.
