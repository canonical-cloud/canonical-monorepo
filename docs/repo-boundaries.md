# Repository boundaries

`canonical-monorepo` is a git superproject: it stores exact source gitlinks plus
shared integration CI, documentation, and guarded build/audit scripts. It never
vendors application source.

## Gitlink-owned repositories

- **`canonical-web-server.rs`** — browser-facing Maud/HTMX application boundary.
  It verifies Canonical Shared Auth independently of Cloudflare, enforces
  Origin/CSRF for cookie mutations, renders `/u/quote`, and projects only the
  verified subject to the private quote API. Its modular Rust workspace also
  contains the no-ingress `services/canonical-session-revoker` process and the
  IndexedDB sync client. The web/session database identities remain separate
  from the quote API identities.
- **`canonical-api-server.rs`** — dedicated backend for `api.canonical.plus`.
  It owns versioned quote REST routes, authenticated owner-scoped WebSockets,
  SeaORM/PostgreSQL persistence, the server-controlled Markdown analysis
  policy, owner-scoped `canonical_context` selection, and Gemini provider
  orchestration. It does not serve browser HTML or trust caller-selected owner
  identity.
- **`canonical-marketing-site.web`** — Astro public marketing site. Sign-in and
  quote CTAs route to `https://app.canonical.plus/u/quote`; no session or token
  enters the static site.
- **`canonical-interfaces`** — public wire-contract authority: JSON Schema,
  generated adapters, SQL contracts, and versioned golden quote fixtures.
- **`canonical-mcp-server.rs`** — separately reviewed Rust MCP operations and
  diagnostics surface.

Each repository has its own CI, `agents.md`, package metadata, and release or
validation boundary. The superproject is the all-up integration view.

## Zed package direction

Reusable package relationships are not duplicate gitlinks:

```text
canonical-interfaces → canonical-lib → API / web / CLI / MCP
canonical-clients --------------------→ transport consumers
```

The monorepo’s `.zpkg.toml` names `canonical-interfaces`, `canonical-lib`, and
`canonical-clients`. Materialized dependencies live below ignored
`.vendor/.zed/`; deployable source remains under `apps/` as mode-160000 gitlinks.

## PostgreSQL ownership

The web/session and quote data planes have different owners and credentials.

### Web/session plane

- web migration owner: one-shot `MIGRATION_DATABASE_URL`;
- customer web runtime: non-owner, non-`BYPASSRLS` `DATABASE_URL`;
- no-ingress session revoker: separate non-owner
  `SESSION_REVOCATION_DATABASE_URL`;
- web startup never receives the migration or revoker URLs.

### Quote plane

The API owns the dedicated namespace and role contract:

```text
schema:   canonical_cloud__quote
migrator: canonical_cloud__quote__migrator
API:      canonical_cloud__quote__api_rw
web:      canonical_cloud__quote__web_ro
```

Only the migrator owns DDL. The API role receives explicit SELECT/INSERT/UPDATE
and sequence capabilities required by the current persistence code; it is a
non-owner, non-superuser, non-`BYPASSRLS` login with no CREATE privilege in the
owned schema or `public`. The web role has no direct quote-table access and
calls the authenticated API boundary instead. All quote tables use forced RLS,
and every transaction sets and predicates on the verified subject.

`canonical-api-server.rs/db/schema.sql` is declarative desired state.
`db/bootstrap.sql` and `db/grants.sql` remain separate so role creation and
runtime permissions are never hidden inside a schema diff. Production apply is
blocked until the exact database, roles, legacy object state, backup/restore
point, and generated `dpm` plan are reviewed.

## Authority table

| Concern | Authority |
| --- | --- |
| Static marketing | `canonical-marketing-site.web` |
| Browser session, CSRF, Maud/HTMX quote UI | `canonical-web-server.rs` |
| Quote REST/WebSocket and Gemini analysis | `canonical-api-server.rs` |
| Quote PostgreSQL desired state and roles | `canonical-api-server.rs/db` |
| Public quote payloads and golden fixtures | `canonical-interfaces` |
| Transport clients | `canonical-clients` |
| Domain validation | `canonical-lib` |
| Agent operations | `canonical-mcp-server.rs` |
| Exact source integration pins | `.gitmodules` and gitlinks here |
| Web/revoker image publication | monorepo release workflow |
| API image publication | API repository release workflow |
| Kubernetes promotion | `ORESoftware/k8s-cluster` GitOps |

Only this superproject's pinned-stack CI may write the monorepo-owned web and
revoker GHCR packages. The dedicated API repository owns its separate immutable
API package; neither application boundary may publish the other's image.

## Rules

- Change source in the owning repository, merge it there, then update only the
  reviewed gitlink here.
- Do not commit real `.env*` files. Track placeholder templates only.
- Browsers never receive database, migration, Gemini, Cloudflare, R2, Supabase
  service, or internal service credentials.
- Cloudflare may redirect or strip forged headers, but the origin remains the
  authorization authority.
- REST/PostgreSQL state is authoritative; WebSockets are disposable update
  hints and clients recover through REST.
- App repositories may validate their images. Promotion consumes immutable
  registry digests, never mutable tags.
- Passing source CI does not authorize production database, DNS, Worker, route,
  secret-store, or Kubernetes writes.
- Administrative capabilities stay outside both deployed processes. A future
  admin application requires a separate origin, binary, database identity,
  MFA-backed actor context, secret-manager scope, and immutable audit path.
- Keep destructive operations manual and reviewed. Repository helpers remain
  push-free and expose rehearsal/dirty-tree guards.
- Never remove a submodule checkout with a filesystem deletion command. Use git
  submodule operations or `git rm` for an intentional reviewed removal.
