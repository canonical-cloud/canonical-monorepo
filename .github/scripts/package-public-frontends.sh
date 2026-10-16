#!/usr/bin/env bash
# Package only PUBLIC frontend dist files; never the private Cargo cache.
set -euo pipefail
root="${GITHUB_WORKSPACE:?}"
tmp="${RUNNER_TEMP:?}"
sha="${CANONICAL_SOURCE_SHA:-${GITHUB_SHA:?}}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "::error::invalid source SHA" >&2; exit 1; }
stage="$(mktemp -d "$tmp/canonical-public-stage.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
for location in apps/canonical-marketing-site.web/dist apps/canonical-web-server.rs/client/dist; do
  test -d "$root/$location"
  mkdir -p "$stage/$(dirname "$location")"
  cp -a -- "$root/$location" "$stage/$location"
done
test -f "$stage/apps/canonical-marketing-site.web/dist/index.html"
test -n "$(find "$stage/apps/canonical-web-server.rs/client/dist" -type f \( -name '*.js' -o -name '*.css' \) -print -quit)"
printf '%s\n' "$sha" >"$stage/source-commit.txt"
tar -C "$stage" -czf "$tmp/canonical-public-frontends.tar.gz" \
  source-commit.txt apps/canonical-marketing-site.web/dist apps/canonical-web-server.rs/client/dist
echo "Packaged public-only frontends for $sha"
