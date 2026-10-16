#!/usr/bin/env bash
# Run reviewed Cargo commands without network, credentials, writable sources,
# Docker sockets, or reusable outputs. Do not publish build-script logs.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "::error::usage: offline-rust-review.sh web|api lock|fmt|clippy|test|release|rkyv" >&2
  exit 2
fi
app="$1"
mode="$2"
case "$app" in
  web) source_dir="$GITHUB_WORKSPACE/apps/canonical-web-server.rs" ;;
  api) source_dir="$GITHUB_WORKSPACE/apps/canonical-api-server.rs" ;;
  *) echo "::error::unapproved application" >&2; exit 2 ;;
esac
case "$mode" in
  lock|fmt|clippy|test|release) ;;
  rkyv) [[ "$app" == web ]] || { echo "::error::rkyv proof is web-only" >&2; exit 2; } ;;
  *) echo "::error::unapproved Cargo operation" >&2; exit 2 ;;
esac

image="$CANONICAL_RUST_IMAGE_ID"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "::error::Rust build image must be an immutable SHA256 image ID" >&2
  exit 1
}
cache="$CANONICAL_PRIVATE_CARGO_CACHE"
[[ "$cache" == "$RUNNER_TEMP/"* && "$cache" != *$'\n'* ]] || {
  echo "::error::Cargo cache must live under the ephemeral runner directory" >&2
  exit 1
}
[[ -d "$cache" && -f "$source_dir/Cargo.toml" && -f "$source_dir/Cargo.lock" ]] || {
  echo "::error::missing reviewed Cargo source or private cache" >&2
  exit 1
}
docker image inspect "$image" >/dev/null
out="$(mktemp -d "$RUNNER_TEMP/canonical-offline-rust.XXXXXXXX")"
trap 'rm -rf -- "$out"' EXIT
chmod 0700 "$out"

# Build scripts, proc macros and Rust tests run native code. They get no token,
# no network, no Docker socket, no host home and only throwaway write access.
# Suppress stdout/stderr to prevent exfiltration through public Actions logs.
if docker run --rm --pull=never \
  --network none --ipc none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 7g --cpus 2 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --tmpfs /scratch:rw,nosuid,nodev,size=1g \
  --mount "type=bind,source=$source_dir,target=/src,readonly" \
  --mount "type=bind,source=$GITHUB_WORKSPACE,target=/review-repo,readonly" \
  --mount "type=bind,source=$cache,target=/cargo-cache,readonly" \
  --mount "type=bind,source=$out,target=/out" \
  -e CARGO_HOME=/scratch/cargo \
  -e CARGO_NET_OFFLINE=true \
  -e CARGO_INCREMENTAL=0 \
  -e CARGO_TERM_COLOR=never \
  -e CARGO_TARGET_DIR=/out/target \
  -e RUSTUP_HOME=/usr/local/rustup \
  -e HOME=/scratch \
  -e REVIEW_MODE="$mode" \
  -e REVIEW_APP="$app" \
  --workdir /src \
  --entrypoint /bin/bash "$image" -euo pipefail -c '
    # Cargo creates package lock/metadata files in CARGO_HOME, which must
    # never write into the source cache. Keep HOME writable but symlink only
    # immutable downloaded dependency subtrees from the read-only cache.
    mkdir -p /scratch/cargo
    for cached in git registry; do
      if test -d "/cargo-cache/$cached"; then
        ln -s "/cargo-cache/$cached" "/scratch/cargo/$cached"
      fi
    done
    case "$REVIEW_MODE" in
      lock)
        mkdir -p /scratch/src
        cp -a /src/. /scratch/src/
        cd /scratch/src
        cargo generate-lockfile --offline
        cmp Cargo.lock /src/Cargo.lock
        ;;
      fmt) cargo fmt --all --check --manifest-path /src/Cargo.toml ;;
      clippy)
        if test "$REVIEW_APP" = api; then
          cargo clippy --manifest-path /src/Cargo.toml --all-targets --all-features --locked -- -D warnings
        else
          cargo clippy --manifest-path /src/Cargo.toml --workspace --all-targets --locked -- -D warnings
        fi
        ;;
      test)
        if test "$REVIEW_APP" = api; then
          cargo test --manifest-path /src/Cargo.toml --all-targets --all-features --locked
        else
          cargo test --manifest-path /src/Cargo.toml --workspace --all-targets --locked
        fi
        ;;
      release)
        if test "$REVIEW_APP" = api; then
          cargo build --manifest-path /src/Cargo.toml --locked --release --bin canonical-api-server
          test -x /out/target/release/canonical-api-server
        else
          cargo build --manifest-path /src/Cargo.toml --locked --release --workspace --bins
          test -x /out/target/release/canonical-web-server
          test -x /out/target/release/canonical-session-revoker

          # Run the existing release-stack runtime smoke inside THIS sandbox,
          # while its network namespace remains disconnected from the host.
          # Only public build outputs and the reviewed smoke scripts are used.
          test -f /review-repo/apps/canonical-marketing-site.web/dist/index.html
          test -d /review-repo/apps/canonical-web-server.rs/client/dist
          test -f /review-repo/apps/canonical-interfaces/schema/api.schema.json
          command -v node >/dev/null
          command -v curl >/dev/null
          mkdir -p /scratch/site/scripts
          mkdir -p /scratch/site/apps/canonical-web-server.rs/target/release
          mkdir -p /scratch/site/apps/canonical-web-server.rs/client
          mkdir -p /scratch/site/apps/canonical-marketing-site.web
          mkdir -p /scratch/site/apps/canonical-interfaces/schema
          cp /review-repo/scripts/stack-smoke.sh /scratch/site/scripts/stack-smoke.sh
          cp /review-repo/scripts/validate-against-schema.mjs /scratch/site/scripts/validate-against-schema.mjs
          ln -s /out/target/release/canonical-web-server /scratch/site/apps/canonical-web-server.rs/target/release/canonical-web-server
          ln -s /out/target/release/canonical-session-revoker /scratch/site/apps/canonical-web-server.rs/target/release/canonical-session-revoker
          ln -s /review-repo/apps/canonical-web-server.rs/client/dist /scratch/site/apps/canonical-web-server.rs/client/dist
          ln -s /review-repo/apps/canonical-marketing-site.web/dist /scratch/site/apps/canonical-marketing-site.web/dist
          ln -s /review-repo/apps/canonical-interfaces/schema/api.schema.json /scratch/site/apps/canonical-interfaces/schema/api.schema.json
          bash /scratch/site/scripts/stack-smoke.sh
        fi
        ;;
      rkyv)
        test "$REVIEW_APP" = web
        bash /src/scripts/check-rkyv-active-graph.sh
        ;;
      *) exit 2 ;;
    esac
  ' >"$out/private-build.log" 2>&1; then
  echo "Network-disabled, token-free Cargo $mode passed for $app"
else
  echo "::error::Network-disabled Cargo $mode failed for $app. Raw build output was intentionally not published; inspect only in an authorized isolated environment." >&2
  exit 1
fi
