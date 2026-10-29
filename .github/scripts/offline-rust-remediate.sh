#!/usr/bin/env bash
# Only trusted monorepo/main invokes this; no network, credentials or source scripts.
set -euo pipefail
: "$GITHUB_WORKSPACE" "$RUNNER_TEMP" "$CANONICAL_RUST_IMAGE_ID" "$CANONICAL_PRIVATE_CARGO_CACHE"
[[ "$CANONICAL_RUST_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
[[ "$CANONICAL_PRIVATE_CARGO_CACHE" == "$RUNNER_TEMP/"* ]] || exit 1
src="$GITHUB_WORKSPACE/apps/canonical-web-server.rs"
test -f "$src/Cargo.lock"
test -d "$CANONICAL_PRIVATE_CARGO_CACHE"
destination="$RUNNER_TEMP/canonical-remediated-lock"
mkdir -p "$destination"; chmod 0700 "$destination"
test ! -e "$destination/Cargo.lock"
if docker run --rm --pull=never --network none --ipc none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 6g --cpus 2 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /scratch:rw,nosuid,nodev,size=3g \
  --mount "type=bind,source=$src,target=/source,readonly" \
  --mount "type=bind,source=$CANONICAL_PRIVATE_CARGO_CACHE,target=/cache,readonly" \
  --mount "type=bind,source=$destination,target=/output" \
  -e CARGO_HOME=/scratch/cargo -e CARGO_NET_OFFLINE=true \
  -e RUSTUP_HOME=/usr/local/rustup -e HOME=/scratch \
  --workdir /scratch --entrypoint /bin/bash "$CANONICAL_RUST_IMAGE_ID" -euo pipefail -c '
    mkdir -p /scratch/cargo /scratch/source
    for name in git registry; do
      if test -d "/cache/$name"; then ln -s "/cache/$name" "/scratch/cargo/$name"; fi
    done
    cp -a /source/. /scratch/source/
    cd /scratch/source
    cargo update --offline -p ctutils@0.4.2 --precise 0.4.4
    cargo update --offline -p quinn-proto@0.11.16 --precise 0.11.18
    cargo update --offline -p rustls@0.23.45 --precise 0.23.46
    cargo update --offline -p rustls-webpki@0.103.15 --precise 0.103.16
    cargo update --offline -p webpki-root-certs@1.0.9 --precise 1.0.10
    cargo update --offline -p webpki-roots@1.0.9 --precise 1.0.10
    cargo update --offline -p tokio@1.53.1 --precise 1.53.3
    test -s Cargo.lock
    cp Cargo.lock /output/Cargo.lock
  ' >"$destination/offline-resolution.log" 2>&1; then
  test -s "$destination/Cargo.lock"
  echo 'Offline Cargo generated a proposed lockfile only; no audit or build clearance.'
else
  echo '::error::Offline Cargo resolution failed; inspect logs only on authorized runner.' >&2
  rm -f "$destination/Cargo.lock"
  exit 1
fi
