#!/usr/bin/env bash
# Build only public frontend artifacts. Intentionally must not read private
# Cargo sources, start Rust binaries, or publish release artifacts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARKETING="$ROOT/apps/canonical-marketing-site.web"
CLIENT="$ROOT/apps/canonical-web-server.rs/client"

test -d "$MARKETING/src"
test -d "$CLIENT/src"
echo "==> Building public marketing frontend"
(cd "$MARKETING" && npm ci && npm run build)
echo "==> Typecheck, test and build public HTMX/IndexedDB client"
(cd "$CLIENT" && npm ci && npm run typecheck && npm test && npm run build)
test -f "$MARKETING/dist/index.html"
test -d "$CLIENT/dist"
asset="$(find "$CLIENT/dist" -type f \( -name '*.js' -o -name '*.css' \) -print -quit)"
test -n "$asset"
echo "Public frontend builds passed; no private Cargo source was accessed."
