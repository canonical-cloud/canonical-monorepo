#!/usr/bin/env bash
# Unprivileged reproduction of the trusted resolver's read-only-cache pattern.
# Uses only public RustSec patch crates; never copies private sources.
set -euo pipefail
: "$RUNNER_TEMP" "$CARGO_HOME"
[[ "$CARGO_HOME" == "$RUNNER_TEMP/"* ]] || { echo "Disposable runner-local Cargo home required" >&2; exit 1; }
for name in PRIVATE_CARGO_TOKEN GIT_ASKPASS GH_TOKEN CANONICAL_LIB_READ_TOKEN; do
  value="$(printenv "$name" 2>/dev/null || true)"
  [[ -z "$value" ]] || { echo "Refusing credentials in public offline resolver smoke" >&2; exit 1; }
done
work="$(mktemp -d "$RUNNER_TEMP/canonical-offline-resolver.XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/src" "$work/proposed"
printf 'pub fn smoke() {}\n' > "$work/src/lib.rs"
cat > "$work/Cargo.toml" <<'TOML'
[package]
name = "canonical-offline-public-smoke"
version = "0.0.0"
edition = "2021"
[dependencies]
ctutils = "=0.4.2"
quinn-proto = "=0.11.16"
rustls = "=0.23.45"
rustls-webpki = "=0.103.15"
webpki-root-certs = "=1.0.9"
webpki-roots = "=1.0.9"
tokio = "=1.53.1"
TOML
# Host network available only BEFORE the isolated resolver starts.
cargo +1.95.0 generate-lockfile --manifest-path "$work/Cargo.toml"
cargo +1.95.0 fetch --locked --manifest-path "$work/Cargo.toml"
cat > "$work/Cargo.toml" <<'TOML'
[package]
name = "canonical-offline-public-smoke"
version = "0.0.0"
edition = "2021"
[dependencies]
ctutils = "^0.4.2"
quinn-proto = "^0.11.16"
rustls = "^0.23.45"
rustls-webpki = "^0.103.15"
webpki-root-certs = "^1.0.9"
webpki-roots = "^1.0.9"
tokio = "^1.53.1"
TOML
image='rust:1.95.0-bookworm'
docker pull "$image" >/dev/null
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker run --rm --pull=never --network none --ipc none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 3g --cpus 2 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /scratch:rw,nosuid,nodev,mode=1777,size=2g \
  --mount "type=bind,source=$work,target=/source,readonly" \
  --mount "type=bind,source=$CARGO_HOME,target=/cache,readonly" \
  --mount "type=bind,source=$work/proposed,target=/output" \
  -e CARGO_HOME=/scratch/cargo -e CARGO_NET_OFFLINE=true \
  -e RUSTUP_HOME=/usr/local/rustup -e HOME=/scratch \
  --workdir /scratch --entrypoint /bin/bash "$image_id" -euo pipefail -c '
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
  '
LOCK="$work/proposed/Cargo.lock" node --input-type=module -e '
  import fs from "node:fs";
  import assert from "node:assert/strict";
  const text=fs.readFileSync(process.env.LOCK,"utf8");
  const packages=text.split(/^\[\[package\]\]\s*$/m).slice(1);
  for(const [name,version] of [["ctutils","0.4.4"],["quinn-proto","0.11.18"],["rustls","0.23.46"],["rustls-webpki","0.103.16"],["webpki-root-certs","1.0.10"],["webpki-roots","1.0.10"],["tokio","1.53.3"]]){
    assert.ok(packages.some(p=>p.includes("name = \""+name+"\"") &&
      p.includes("version = \""+version+"\"")),name+" did not update offline");
  }
'
echo "Public offline resolver: network-disabled, read-only cache, seven Cargo updates passed."
