# Agent guidelines — canonical-monorepo

Git superproject for the `canonical-cloud` repositories. Deployable and
integration-reviewed source repositories are pinned as gitlinks under `apps/`:

- `apps/canonical-web-server.rs` — browser-facing Maud/HTMX web application and
  isolated session-revoker process;
- `apps/canonical-api-server.rs` — dedicated quote REST/WebSocket API,
  PostgreSQL persistence, and Gemini orchestration;
- `apps/canonical-marketing-site.web` — Astro static marketing site;
- `apps/canonical-interfaces` — generated public contracts and schemas;
- `apps/canonical-mcp-server.rs` — agent-facing operational tooling.

Reusable source packages such as `canonical-lib` and `canonical-clients` are
Zed dependencies, not duplicate gitlinks. The superproject stores exact pins,
shared integration CI, docs, and build/audit scripts; it never vendors app
source directly.

## Working here

- Clone or refresh with `git submodule update --init --recursive`.
- Change app code inside its own repository, merge it there, then update only
  the reviewed gitlink here.
- Preserve forward-only semantic integration. Never choose a stale side merely
  to eliminate a textual conflict.
- `./build.sh` builds marketing, the HTMX/IndexedDB client, the web/revoker
  workspace, and the dedicated API from exact pins.
- `node --test tests/*.test.mjs` and `scripts/audit-repo-state.sh` enforce the
  topology, release boundaries, instruction hierarchy, and source contracts.

## Security and release boundaries

- Cloudflare is routing and defense in depth, not the authorization authority.
- The web origin verifies Shared Auth and CSRF; it projects only a verified
  subject to the private API under a separate service credential.
- The API owns the `canonical_cloud__quote` PostgreSQL namespace. Its runtime
  role is a non-owner, non-superuser, non-`BYPASSRLS` DML identity; only the
  protected migrator owns DDL.
- Browser, web, and Flutter code never receive database, Gemini, migration,
  Cloudflare, R2, or provider service credentials.
- Gitlinks identify reviewed source. Image promotion uses immutable registry
  digests, never mutable tags.
- No production database, DNS, Worker, route, secret-store, or Kubernetes write
  is authorized merely because source CI passes.

## Command safety

Agents working in this repository must not run destructive shell commands.

**Blacklisted:** `rm`, `rm -rf`, `rmdir`, `dd`, `mkfs`, `shred`, `truncate`,
`find … -delete`, `git clean -fdx`, `git reset --hard` on shared branches,
`git submodule deinit`, force pushes to protected branches, and disk-format or
`sudo`-prefixed commands.

**Whitelisted:** use `git rm` and `git mv` for tracked removals and moves, `git
restore` or `git revert` for reviewable undo, and `git submodule update` for
checkout reconciliation. The repository scripts remain push-free and expose
`--dry-run` or `--allow-dirty` where they modify git state.

Never remove a submodule checkout with a filesystem deletion command. Use git
submodule operations, or `git rm` only for an intentional reviewed removal.

## Git worktrees and synchronization

Create worktrees only below ignored `tmp/worktrees/<branch>`. Synchronization is
two-way: commit intended changes, fetch, merge the remote branch without
rebasing shared history, then push. A clean worktree alone does not prove the
remote contains the same commits.
