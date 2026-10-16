#!/usr/bin/env bash
# Prepare all public Rust tooling before any private dependency credentials.
set -euo pipefail
base='rust:1.95.0-bookworm'
docker pull "$base" >"$RUNNER_TEMP/canonical-rust-base-pull.log" 2>&1
base_id="$(docker image inspect --format '{{.Id}}' "$base")"
[[ "$base_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "::error::unverified Rust base image identity" >&2
  exit 1
}
# FROM resolves the already-downloaded exact local image ID, not the tag.
if ! docker build --pull=false --build-arg "BASE_ID=$base_id" \
  --tag canonical-rust-reviewed:local - >"$RUNNER_TEMP/canonical-rust-tools-build.log" 2>&1 <<'DOCKERFILE'
ARG BASE_ID
FROM ${BASE_ID}
RUN rustup component add rustfmt clippy
DOCKERFILE
then
  echo "::error::failed to prepare complete Rust review toolchain before credentials" >&2
  # Only public Rust toolchain installation output can appear here. This script
  # runs before and outside every step carrying private dependency credentials.
  tail -n 50 "$RUNNER_TEMP/canonical-rust-tools-build.log" >&2
  exit 1
fi
id="$(docker image inspect --format '{{.Id}}' canonical-rust-reviewed:local)"
[[ "$id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "::error::Rust review image identity is not a SHA256 image ID" >&2
  exit 1
}
docker run --rm --pull=never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges "$id" /bin/bash -euo pipefail -c '
    rustc --version
    cargo --version
    cargo fmt --version
    cargo clippy --version
  '
echo "RUST_SMOKE_IMAGE=$id" >> "$GITHUB_ENV"
echo "CANONICAL_RUST_IMAGE_ID=$id" >> "$GITHUB_ENV"
echo "Prepared complete review toolchain using image ID: $id"
