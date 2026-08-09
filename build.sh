#!/usr/bin/env bash
# Build the canonical.cloud Astro marketing site, authenticated HTMX /
# IndexedDB client, web/revoker workspace, and dedicated quote API pinned by
# this superproject. Each app keeps output in its own submodule.
#
# Runs against the submodule checkouts under apps/. Ensure they are initialized:
#   git submodule update --init --recursive
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETING_SITE="$ROOT/apps/canonical-marketing-site.web"
WEB_SERVER="$ROOT/apps/canonical-web-server.rs"
API_SERVER="$ROOT/apps/canonical-api-server.rs"
APP_CLIENT="$WEB_SERVER/client"

if [[ ! -d "$MARKETING_SITE/src" || ! -d "$WEB_SERVER/src" || ! -d "$API_SERVER/src" || ! -d "$APP_CLIENT/src" ]]; then
  echo "error: submodules not initialized. Run: git submodule update --init --recursive" >&2
  exit 1
fi

echo "==> Building Astro marketing site"
(cd "$MARKETING_SITE" && npm ci && npm run build)

echo "==> Verifying and building HTMX / IndexedDB application client"
(cd "$APP_CLIENT" && npm ci && npm run typecheck && npm test && npm run build)

echo "==> Building Rust workspace binaries (web server + session revoker)"
(cd "$WEB_SERVER" && cargo build --locked --release --workspace --bins)

echo "==> Building dedicated Canonical quote API"
(cd "$API_SERVER" && cargo build --locked --release --bin canonical-api-server)

echo "==> Done. Derive isolated ignored environments from repository templates, then run:"
echo "    # one-shot web/session migration environment"
echo "    ./apps/canonical-web-server.rs/target/release/canonical-web-server migrate"
echo "    # customer web environment (no migration or revoker database URL)"
echo "    unset MIGRATION_DATABASE_URL MIGRATION_DATABASE_MAX_CONNECTIONS SESSION_REVOCATION_DATABASE_URL SESSION_REVOCATION_DATABASE_MAX_CONNECTIONS"
echo "    ./apps/canonical-web-server.rs/target/release/canonical-web-server serve"
echo "    # separate no-ingress revoker environment"
echo "    ./apps/canonical-web-server.rs/target/release/canonical-session-revoker run"
echo "    # separate API environment for api.canonical.plus"
echo "    ./apps/canonical-api-server.rs/target/release/canonical-api-server"
