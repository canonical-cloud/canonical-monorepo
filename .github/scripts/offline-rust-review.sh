#!/usr/bin/env bash
# Run reviewed Cargo commands without network, credentials, writable sources,
# Docker sockets, or reusable outputs. Do not publish build-script logs.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "::error::usage: offline-rust-review.sh web|api lock|fmt|clippy|test" >&2
  exit 2
fi
app="$1"
mode="$2"
case "$app" in
  web) source_dir="$GITHUB_WORKSPACE/apps/canonical-web-server.rs" ;;
  api) source_dir="$GITHUB_WORKSPACE/apps/canonical-api-server.rs" ;;
  *) echo "::error::unapproved application" >&2; exit 2 ;;
esac
case "$mode" in lock|fmt|clippy|test) ;; *)
  echo "::error::unapproved Cargo operation" >&2; exit 2 ;;
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
        cargo clippy --manifest-path /src/Cargo.toml --workspace --all-targets --locked -- -D warnings
        ;;
      test) cargo test --manifest-path /src/Cargo.toml --workspace --all-targets --locked ;;
      *) exit 2 ;;
    esac
  ' >"$out/private-build.log" 2>&1; then
  echo "Network-disabled, token-free Cargo $mode passed for $app"
else
  echo "::error::Network-disabled Cargo $mode failed for $app. Raw build output was intentionally not published; inspect only in an authorized isolated environment." >&2
  exit 1
fi
