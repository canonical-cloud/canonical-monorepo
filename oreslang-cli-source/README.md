# Oreslang Stack CLI

## Project identity: Oreslang Stack is not ORES Stack

**Oreslang Stack** and **ORES Stack** are **separate projects with different CLIs and release tracks**. This repository provides the **Oreslang-native `oreslang-stack` CLI**, not the Rust `ores-stack` CLI.

| | Oreslang Stack (this repository) | ORES Stack (separate project) |
| --- | --- | --- |
| CLI source | [`ores-truffle-oreslang/oreslang-stack-cli`](https://github.com/ores-truffle-oreslang/oreslang-stack-cli) | [`ores-stack/ores-stack-cli`](https://github.com/ores-stack/ores-stack-cli) |
| Command | `oreslang-stack` | `ores-stack` |
| Implementation | Oreslang `src/main.ores`, POSIX bootstrap, and Oreslang Java/Graal compiler/runtime | Rust/Cargo tooling and ORES Stack contracts |
| Focus | Oreslang API/web scaffolding, route discovery, native-source generation, checks and source packaging | ORES Stack module/admission workflows, lambda adapter generation, provider-bound WASM materialization and deployment tooling |

Do **not** substitute the other CLI, its config/manifest, binary, tests, or deployment claims. In particular, Oreslang Stack's `deploy` currently fails closed; an ORES Stack deployment feature does not make an Oreslang Stack deployment supported.

**CI mirror rule:** An exact copy of private Oreslang source placed temporarily in an `ores-stack` repository (or another funded test organization) is **only a CI fixture**. Use only an explicitly authorized **private** destination with controlled access. The test repo's `GITHUB_TOKEN` cannot implicitly check out the private source across organizations: copy the source Git tree into the test repo through an authorized GitHub client, then let Actions check out **its own local mirror** with read-only permissions. Require the source commit and mirrored subtree Git tree SHAs to match, plus allocated runner steps and **executed, passing checks** on that exact tree. Do not expose source through public branches/artifacts/logs, and remove the temporary mirror after retaining evidence. Source ownership, review, and releases remain in `ores-truffle-oreslang`.

**The CLI implementation is Oreslang source.** The command dispatcher,
recursive file-route discovery, role validation, route JSON inventory, and
RPC/Lambda source generation live in [`src/main.ores`](src/main.ores).
There is no Rust executable and no Cargo dependency.

`bin/oreslang-stack` is a narrow POSIX host/bootstrap bridge for
[`flags-2-env`](https://github.com/flags-2-env/flags-2-env),
launching the installed Oreslang Java/Graal compiler/runtime,
and packaging the checked application sources. It does not discover routes
or generate source adapters.

## Commands

```bash
oreslang-stack init --root /path/to/new-api-repo --role api
oreslang-stack init --root /path/to/new-web-repo --role web
oreslang-stack init --root /path/to/new-infra-repo --role infra
oreslang-stack init --root /path/to/new-lambdas-repo --role lambdas
oreslang-stack dev --root examples/hello-api
oreslang-stack routes --root examples/hello-api
oreslang-stack generate --kind all --root examples/hello-api
oreslang-stack generate --kind all --check --root examples/hello-api
oreslang-stack check --root examples/hello-api
oreslang-stack build --root examples/hello-api
# Expected to fail closed: deployment has no certified backend yet.
oreslang-stack deploy --root examples/hello-api --target oreslang-stack
```

| Command | Behavior |
|---|---|
| `init` | Oreslang-native fresh API/web sources and candidate-only infra/Lambda scaffolds; refuses existing `src/`, `generated/`, or project manifests |
| `dev` | Oreslang discovers and generates adapters, then launches the app with the Java/Graal runtime; launch-once, not a live-reload watcher |
| `routes` | Native Oreslang recursive discovery produces deterministic JSON route inventory |
| `generate` | Native Oreslang writes `rpc.ores`, `lambda.ores` and a route manifest; `--check` verifies byte equality without writes |
| `check` | Native generation drift check followed by real Oreslang compiler `--check` on each `.ores` source |
| `build` | Generation, compiler checks, a source distribution containing a runnable `bin/oreslang-stack-run` (requires installed Oreslang); **not a compiled native/JVM/WASM executable** |
| `deploy` | Explicit **hard failure** until a backend-specific certified deploy adapter exists |

## Multi-repository bootstrap

Use the exact same CLI for fresh repositories of roles `api`, `admin-api`, `web` and `admin-web`. For example, once the required GitHub repositories are cloned and the Java/Graal Oreslang runtime and `flags2env` are installed:

```bash
# In an existing empty project checkout (a README/.git is fine):
oreslang-stack init --root . --role api
oreslang-stack routes --root .
oreslang-stack generate --kind all --check --root .
oreslang-stack check --root .
oreslang-stack build --root .
```

`init` is intentionally non-destructive: a preexisting `oreslang-stack.toml`, `src/` or `generated/` is a hard refusal, **not** an invitation to migrate existing code. It creates a minimal route/page, entrypoint, role manifest and generated adapters via native Oreslang and compiler-checks the result. It does not provision GitHub repositories, authenticate to an organization, build a native binary, certify deploy, or imply that the generated route is a running HTTP server.

All filesystem writes are scoped to the selected repository. Project initialization is not a single atomic transaction across multiple files; if the actual compiler/generator fails after creating output, inspect it before retrying rather than overwriting any authored work.

## Infra and Lambda repositories

`infra` and `lambdas` have a separate fail-closed candidate profile. `init` creates source-only examples and explicit `deployable = false` manifests. `check` typechecks their sources but **does not** run cloud deployments or create AWS Lambda bootstraps; `routes`, `generate`, `dev`, `build`, and `deploy` are denied for these two roles. See [the infra/Lambda admission guide](docs/INFRA_LAMBDAS.md) for actual provider and runtime requirements.

## Source layout

For API/web repositories, `oreslang-stack.toml` declares one of
`api`, `admin-api`, `web` or `admin-web`. The additional `infra` and
`lambdas` roles use the non-deployable candidate profile described above.
API repositories author
`src/routes/**/route.ores` with sibling `handlers.ores` and
`// @ores-route GET /users/{id} show` annotations. Web repositories author
`src/pages/**/page.ores` with `// @ores-page /users/{id} render`.
Generated API routes have `rpc.ores` and `lambda.ores`, while web pages
receive only `lambda.ores`.

The original Rust proof-of-concept forwarded String requests/responses. This
native Oreslang port maintains that **source adapter envelope** for parity;
typed GraphQL, protobuf and host transport bindings are separate dependencies,
not represented as implemented.

Generated code is owned by a marker and never overwrites authored code.
The native generator checks duplicate route method/exports, identical dynamic
route shapes (`[id]` vs `[name]`), orphan adapters, symlinks, role mismatches,
missing handler functions and stale output. Generation performs a read-only
validation phase before materializing files; the filesystem APIs are **not
race-free openat handles**, so hostile mutable project trees are not supported.

## Dependencies

- A Java/Graal Oreslang executable available as `oreslang` (or
  `ORESLANG_BIN=/path/to/executable`).
- `flags2env` from canonical `flags-2-env/flags-2-env`.
- Oreslang stdlib additions from
  [`oreslang-source.java` PR #496](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/496):
  directory enumeration, symlink metadata, and safe literal string operations.
  **PR #496 is merged into the source repository (October 9, 2026).** The CLI still needs a **built/installed Java/Graal runtime that actually includes these APIs**; a merged PR by itself does not establish packaged runtime compatibility.

Use `FLAGS2ENV_BIN` to locate a custom flags parser executable.
The schema is [`.cli-flags.toml`](.cli-flags.toml), not a home-grown argv parser.

```sh
bash tests/bootstrap-contract.sh
# Only after installing a real Oreslang runtime with PR #496:
bash tests/native-generator-contract.sh
```

Tests using a mock Oreslang command only prove host bootstrap behavior,
**not native language compilation**. Full native generator tests require the
real interpreter and its filesystem permission APIs. See
[`docs/GENERATION.md`](docs/GENERATION.md) and
[`docs/NATIVE-CLI.md`](docs/NATIVE-CLI.md).

## Not yet certified

A working `deploy` requires a genuine compiled artifact, target/runtime ABI,
isolation/admission policies and a live deployment receipt. Oreslang LLVM is
still experimental and is not usable as the CLI runtime. Do not claim deployment certification until executed Java/Graal integration tests, the installed stdlib/runtime dependency, and backend-specific deployment receipts have been verified.
