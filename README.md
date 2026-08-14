# canonical-monorepo

Git superproject for the [canonical-cloud](https://github.com/canonical-cloud)
repositories.

Deployable and integration-reviewed repositories are git **submodules** below
`apps/`. The superproject pins every gitlink to an exact commit while
`.gitmodules` records `branch = main` as update metadata. Reusable source
packages remain separate Zed dependencies: the domain direction is
`canonical-interfaces` → `canonical-lib` → API/web/CLI/MCP consumers, with
`canonical-clients` owning shared transport behavior.

## Apps

| Submodule | Stack and responsibility | Repository |
| --- | --- | --- |
| `apps/canonical-web-server.rs` | Maud/HTMX browser BFF, Shared Auth verification, CSRF, session revocation, IndexedDB sync | `canonical-cloud/canonical-web-server.rs` |
| `apps/canonical-api-server.rs` | Axum/SeaORM quote REST and WebSockets, PostgreSQL persistence, Gemini analysis | `canonical-cloud/canonical-api-server.rs` |
| `apps/canonical-marketing-site.web` | Astro public marketing site and authenticated quote CTA | `canonical-cloud/canonical-marketing-site.web` |
| `apps/canonical-interfaces` | JSON Schema, SQL, generated language contracts, and golden quote fixtures | `canonical-cloud/canonical-interfaces` |
| `apps/canonical-mcp-server.rs` | Rust MCP operations and diagnostics surface | `canonical-cloud/canonical-mcp-server.rs` |

The public quote journey starts at `https://app.canonical.plus/u/quote`.
`canonical-web-server.rs` independently verifies the Canonical Shared Auth
browser session, enforces Origin/CSRF, renders Maud/HTMX pages, and projects only
the verified subject to the private API. `canonical-api-server.rs` owns durable
quote state, owner-scoped REST/WebSocket behavior, the
`canonical_cloud__quote` PostgreSQL namespace, and Gemini orchestration. The
browser cannot choose an owner, context UUID, model credential, database role,
or internal service token.

`canonical.cloud` is a frozen compatibility mirror. New source, package,
release, and deployment work belongs in this superproject and its real source
repositories.

## Clone

```sh
git clone --recurse-submodules git@github.com:canonical-cloud/canonical-monorepo.git
```

For an existing checkout:

```sh
git submodule update --init --recursive
```

## Build the pinned stack

```sh
./build.sh
```

This performs locked or lockfile-strict builds for:

1. the Astro marketing site;
2. the HTMX/IndexedDB browser client;
3. the web server and isolated session revoker; and
4. the dedicated quote API.

Run each process with a separate ignored environment derived from the owning
repository’s `.env.example`. Never load all database identities or secrets into
one process.

### Web/session data plane

Apply the web/session migration with its privileged one-shot identity, then
launch the customer web process and no-ingress revoker independently:

```sh
set -a; source .env.migration; set +a
./apps/canonical-web-server.rs/target/release/canonical-web-server migrate
psql "$MIGRATION_DATABASE_URL" \
  --file apps/canonical-web-server.rs/deploy/postgres/bootstrap_runtime_role.sql
psql "$MIGRATION_DATABASE_URL" \
  --file apps/canonical-web-server.rs/deploy/postgres/bootstrap_session_revoker_role.sql
unset MIGRATION_DATABASE_URL MIGRATION_DATABASE_MAX_CONNECTIONS

set -a; source .env.web; set +a
./apps/canonical-web-server.rs/target/release/canonical-web-server serve

# Separate no-ingress process:
set -a; source .env.revoker; set +a
./apps/canonical-web-server.rs/target/release/canonical-session-revoker run
```

### Quote data plane

The API repository owns a separate declarative PostgreSQL contract:

```text
schema:   canonical_cloud__quote
migrator: canonical_cloud__quote__migrator
API:      canonical_cloud__quote__api_rw
web:      canonical_cloud__quote__web_ro (no direct table surface)
```

`db/schema.sql` in the API repository is applied with the reviewed
`declarative-postgres-migrate.rs` (`dpm`) workflow. Bootstrap, desired state,
and grants remain separate. Production apply must use the exact migration
identity, a verified backup/restore point, and a reviewed generated plan. The
long-lived API receives only the non-owner, non-superuser, non-`BYPASSRLS` DML
URL plus the Canonical internal service token and Gemini configuration:

```sh
set -a; source .env.api; set +a
./apps/canonical-api-server.rs/target/release/canonical-api-server
```

The pinned API source was certified on PostgreSQL 17 in its repository and in
two independent `declarative-migrations-test` lanes covering forward/rollback,
forced RLS, owner isolation, drift detection, destructive-change gating, row
preservation, and final shadow convergence. See
`docs/quote-stack-certification.md`.

## Update pins

```sh
scripts/pin-submodules.sh main
git status
git diff --cached --submodule
git commit -m "Pin canonical apps to main"
```

The script verifies branch existence, refuses dirty submodule checkouts,
fast-forwards each source repository, and stages only gitlink changes. Preview
with `--dry-run`.

## Release and promotion

The monorepo release workflow remains the release authority for the pinned web
and revoker images. The dedicated API repository publishes its own immutable
commit-SHA image and digest after exact-head CI. GitOps must consume immutable
digests rather than mutable tags. Deployment state and promotion live in
`ORESoftware/k8s-cluster`; Argo CD, not source CI, reconciles Kubernetes.

Source or image certification does **not** authorize a production database,
secret-store, Cloudflare, DNS, R2, Supabase, or Kubernetes mutation. Those
operations require exact target inventory and the later activation gates.

## Feature branches

Switch the superproject and every app checkout to a matching feature branch:

```sh
scripts/checkout-feature-branch.sh feature/new-landing
```

## Audit

```sh
scripts/audit-repo-state.sh
python3 scripts/verify-zed-submodules.py
node --test tests/*.test.mjs
```

## Layout

```text
apps/                  # exact source gitlinks
.vendor/.zed/          # ignored materialized Zed dependencies
scripts/               # guarded pin, checkout, smoke, and audit helpers
tests/                 # superproject contract tests
docs/                  # boundaries, deployment, certification
.github/               # integration CI and release workflows
build.sh               # complete pinned-stack build
```
