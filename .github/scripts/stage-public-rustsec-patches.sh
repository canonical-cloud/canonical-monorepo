#!/usr/bin/env bash
# Public registry dependency staging ONLY: no candidate source or private token.
set -euo pipefail
: "$RUNNER_TEMP" "$CARGO_HOME"
if [[ "$CARGO_HOME" != "$RUNNER_TEMP/"* || "$CARGO_HOME" == *$'\n'* ]]; then
  echo '::error::Public Cargo cache must be under RUNNER_TEMP' >&2
  exit 1
fi
if { [[ -v PRIVATE_CARGO_TOKEN ]] && [[ -n "$PRIVATE_CARGO_TOKEN" ]]; } ||
   { [[ -v GIT_ASKPASS ]] && [[ -n "$GIT_ASKPASS" ]]; } ||
   { [[ -v GH_TOKEN ]] && [[ -n "$GH_TOKEN" ]]; }; then
  echo '::error::Public Cargo staging refuses private credentials or Git askpass' >&2
  exit 1
fi
mkdir -p "$CARGO_HOME"
chmod 0700 "$CARGO_HOME"
stage="$(mktemp -d "$RUNNER_TEMP/canonical-public-rustsec.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/src"
printf 'pub fn public_registry_only() {}\n' > "$stage/src/lib.rs"
cat > "$stage/Cargo.toml" <<'TOML'
[package]
name = "canonical-public-rustsec-patch-probe"
version = "0.0.0"
edition = "2021"
[dependencies]
ctutils = "=0.4.4"
quinn-proto = "=0.11.18"
rustls = "=0.23.46"
rustls-webpki = "=0.103.16"
webpki-root-certs = "=1.0.10"
webpki-roots = "=1.0.10"
tokio = "=1.53.3"
TOML
cargo +1.95.0 generate-lockfile --manifest-path "$stage/Cargo.toml"
cargo +1.95.0 fetch --locked --manifest-path "$stage/Cargo.toml"
cargo +1.95.0 metadata --offline --locked --no-deps \
  --format-version 1 --manifest-path "$stage/Cargo.toml" >/dev/null
echo 'Verified seven exact public RustSec patches; no private source or token accessed.'
