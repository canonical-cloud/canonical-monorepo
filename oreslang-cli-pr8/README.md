# Oreslang Stack CLI

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
oreslang-stack dev --root examples/hello-api
oreslang-stack routes --root examples/hello-api
oreslang-stack generate --kind all --root examples/hello-api
oreslang-stack generate --kind all --check --root examples/hello-api
oreslang-stack check --root examples/hello-api
oreslang-stack build --root examples/hello-api
oreslang-stack deploy --root examples/hello-api --target oreslang-stack
```

| Command | Behavior |
|---|---|
| `dev` | Oreslang discovers and generates adapters, then launches the app with the Java/Graal runtime; launch-once, not a live-reload watcher |
| `routes` | Native Oreslang recursive discovery produces deterministic JSON route inventory |
| `generate` | Native Oreslang writes `rpc.ores`, `lambda.ores` and a route manifest; `--check` verifies byte equality without writes |
| `check` | Native generation drift check followed by real Oreslang compiler `--check` on each `.ores` source |
| `build` | Generation, compiler checks, a source distribution containing a runnable `bin/oreslang-stack-run` (requires installed Oreslang); **not a compiled native/JVM/WASM executable** |
| `deploy` | Explicit **hard failure** until a backend-specific certified deploy adapter exists |

## Source layout

The project declares the role in `oreslang-stack.toml` as
`api`, `admin-api`, `web` or `admin-web`. API repositories author
`src/routes/**/route.ores` with sibling `handlers.ores` and
`// @ores-route GET /users/{id} show` annotations. Web repositories author
`src/pages/**/page.ores` with `// @ores-page /users/{id} render`.
Generated API routes have `rpc.ores` and `lambda.ores`, while web pages
receive only `lambda.ores`.
The selected role is exclusive: an API repository cannot also contain
`src/pages`, and a web repository cannot also contain `src/routes`.
The CLI refuses conflicting trees, invalid directory-valued source files and
non-file entrypoints instead of silently omitting them.

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

Source distributions include checked `.ores` files, the repository role manifest,
generated route inventory, and a runtime-dependent entrypoint. Project-local
`.oreslangc.cfg.toml` is intentionally excluded from archives because it may
contain secrets or machine-local paths; arrange any required non-secret runtime
configuration separately. The bundled runner validates the entrypoint and its
physical parent path before execution. Neither this check nor the native
generator provides race-free isolation from a malicious process changing files
concurrently.

## Dependencies

- A Java/Graal Oreslang executable available as `oreslang` (or
  `ORESLANG_BIN=/path/to/executable`).
- `flags2env` from canonical `flags-2-env/flags-2-env`.
- Oreslang stdlib additions from
  [`oreslang-source.java` PR #496](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/496):
  directory enumeration, symlink metadata, and safe literal string operations.
  **Until this dependency is merged and packaged, a stock compiler may not
  run this CLI.**

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
still experimental and is not usable as the CLI runtime. This PR must remain
draft until Java/Graal integration tests and the stdlib dependency are green.
