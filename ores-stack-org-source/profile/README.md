# ORES Stack

> **Visibility:** this organization-profile repository is currently private. This text is available only where GitHub grants repository/profile access; it is **not a public organization landing page**. Making it public requires a separate security review and approval.

**ORES Stack** is a distinct project from **Oreslang Stack**. Despite the similar names, their CLIs, source implementations, ownership and release validation are not interchangeable.

| ORES Stack (this organization) | Oreslang Stack (separate project) |
| --- | --- |
| [`ores-stack/ores-stack-cli`](https://github.com/ores-stack/ores-stack-cli) | [`ores-truffle-oreslang/oreslang-stack-cli`](https://github.com/ores-truffle-oreslang/oreslang-stack-cli) |
| `ores-stack` command | `oreslang-stack` command |
| Rust/Cargo CLI, ORES Stack module contracts, provider-neutral RPC/Lambda adapter and WASM artifact tooling | Oreslang-native CLI source, API/web scaffolding, route discovery and source generation; Java/Graal runtime dependency |
| [ORES Stack migration/readiness](https://github.com/ores-stack/ores-stack-cli/blob/main/MIGRATION.md) | [Oreslang Stack CLI status](https://github.com/ores-truffle-oreslang/oreslang-stack-cli#not-yet-certified) |

**For ORES Stack users:** start with [ores-stack-cli](https://github.com/ores-stack/ores-stack-cli). Its release readiness and migration gates belong to ORES Stack.

**For Oreslang users:** start with [oreslang-stack-cli](https://github.com/ores-truffle-oreslang/oreslang-stack-cli). Oreslang Stack's CLI is not implemented in Rust and its deployment command is not yet certified.

**About GitHub Actions test branches:** Private Oreslang code may be copied only into an **authorized private** test branch when the source organization cannot allocate runners. CI checks out that local mirror, not a private cross-organization source repository with its default token. Never publish mirrored sources through public branches, artifacts, or logs; clean up temporary mirrors. That test fixture is **not** ORES Stack product code or a transfer of ownership. Only an exact source/mirror Git tree SHA match **and executed, passing tests** support the specific revision.
