# Infra and Lambda repository profiles (candidate only)

The Oreslang Stack CLI has two **non-deployable** repository profiles:

- `oreslang-stack init --role infra --root <empty-existing-dir>`
  creates `oreslang-stack.toml`, `src/main.ores`,
  `src/infra/config.ores`, and `.oreslang-stack-infra.candidate.toml`.
- `oreslang-stack init --role lambdas --root <empty-existing-dir>`
  creates `oreslang-stack.toml`, `src/main.ores`,
  `src/functions/hello/handler.ores`, and
  `.oreslang-stack-lambdas.candidate.toml`.

The candidate manifest is strict and must remain:

```toml
[candidate]
role = "infra" # or "lambdas"
deployable = false
```

A passing `oreslang-stack check` means only that the candidate manifest and
source layout passed local admission and **every Oreslang source passed the
compiler's --check**, not that cloud infrastructure, a function ABI,
or a server has been validated. The check rejects a changed candidate
manifest and route/page trees masquerading as infra or independent Lambdas.

## Infrastructure responsibilities

Real infrastructure integration must be defined by the owning repository,
including its `.ores-infra.toml` and existing provider-native configuration
(Crossplane, Terraform, Kubernetes, Cloudflare, Neon, Supabase, etc.).
The CLI **does not write** a production `.ores-infra.toml`, guess an
environment or module path, or provision anything. Integration requires:

- Exact reviewed environment and provider target(s), workspace/backend/state
  isolation, drift and plan validation, and deny-by-default credentials.
- Source-closure provenance, explicit toolchain/provider versions, independent
  checks on proposed plans, safe dry-run before apply, and audited promotion.
- A certified adapter with a real deployment/rollback receipt before enabling
  any provisioning action.

## Lambda responsibilities

The generated `handler.ores` is a **source-only sample** with a
`String -> String` signature, not an AWS Lambda handler ABI. In particular,
`provided.al2023` needs a Linux-compatible root `bootstrap` executable;
the current JVM/Graal Oreslang CLI `build` emits a **source tarball**, not
that executable, and may not be mislabelled an AWS Lambda zip or OCI image.

Future admission needs independent per-function compilation/packaging,
x86_64/arm64 targets, precise bootstrap/OCI contract, no secrets or compiler
source in runtime artifact when disallowed, provenance bound to exact Git
source SHA, cold-start isolation, timeouts, concurrency cancellation,
and full positive/negative TJSV TypeSpec+JSON Schema fixture conformance.
There is no deployment receipt today.

## Allowed operations

| Role | `init` | `check` | `routes/generate/dev/build/deploy` |
| --- | --- | --- | --- |
| `api/admin-api` | scaffold | schema-agnostic source/route check | existing restricted source-only behavior |
| `web/admin-web` | scaffold | schema-agnostic source/page check | existing restricted source-only behavior |
| `infra` | candidate scaffold | candidate drift + compiler | **denied** |
| `lambdas` | candidate scaffold | candidate drift + compiler | **denied** |

This is not a migration mechanism. Existing repos with `src/`, `generated/`,
`oreslang-stack.toml`, or either candidate manifest are *never overwritten*
by `init`. Use a reviewed migration PR for existing code and preserve all
pre-existing governance, contract, and provider directories.
