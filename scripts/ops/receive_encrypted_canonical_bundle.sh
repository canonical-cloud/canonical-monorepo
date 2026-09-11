#!/usr/bin/env bash
set -Eeuo pipefail

required=(
  REPOSITORY
  DEFAULT_BRANCH
  HANDSHAKE_NONCE
  PUBLIC_KEY_PATH
  CIPHERTEXT_PATH
  GITHUB_TOKEN_VALUE
  GITHUB_ENV
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'required environment variable is empty: %s\n' "$name" >&2
    exit 1
  fi
done

CIPHERTEXT_WAIT_ATTEMPTS="${CIPHERTEXT_WAIT_ATTEMPTS:-720}"
CIPHERTEXT_POLL_SECONDS="${CIPHERTEXT_POLL_SECONDS:-5}"
repo_api="https://api.github.com/repos/${REPOSITORY}"
private_key="${RUNNER_TEMP}/canonical-${HANDSHAKE_NONCE}.private.pem"
public_key="${RUNNER_TEMP}/canonical-${HANDSHAKE_NONCE}.public.pem"
encrypted_bundle="${RUNNER_TEMP}/canonical-${HANDSHAKE_NONCE}.bundle.enc"
plain_bundle="${RUNNER_TEMP}/canonical-${HANDSHAKE_NONCE}.bundle.json"

repo_api_call() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl --fail-with-body --silent --show-error \
      --request "$method" \
      --url "$url" \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${GITHUB_TOKEN_VALUE}" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      --data-binary "$data"
  else
    curl --fail-with-body --silent --show-error \
      --request "$method" \
      --url "$url" \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${GITHUB_TOKEN_VALUE}" \
      --header "X-GitHub-Api-Version: 2022-11-28"
  fi
}

put_file() {
  local path="$1"
  local source_file="$2"
  local message="$3"
  local content payload
  content="$(base64 -w0 "$source_file")"
  payload="$(jq -nc \
    --arg message "$message" \
    --arg content "$content" \
    --arg branch "$DEFAULT_BRANCH" \
    '{message:$message,content:$content,branch:$branch}')"
  repo_api_call PUT "${repo_api}/contents/${path}" "$payload" >/dev/null
}

delete_remote_if_present() {
  local path="$1"
  local message="$2"
  local metadata sha payload
  if metadata="$(repo_api_call GET "${repo_api}/contents/${path}?ref=${DEFAULT_BRANCH}" 2>/dev/null)"; then
    sha="$(jq -r '.sha // empty' <<<"$metadata")"
    if [[ -n "$sha" ]]; then
      payload="$(jq -nc \
        --arg message "$message" \
        --arg sha "$sha" \
        --arg branch "$DEFAULT_BRANCH" \
        '{message:$message,sha:$sha,branch:$branch}')"
      repo_api_call DELETE "${repo_api}/contents/${path}" "$payload" >/dev/null || true
    fi
  fi
}

cleanup_remote_handoff() {
  delete_remote_if_present "$PUBLIC_KEY_PATH" "ci: remove expired Canonical credential public key"
  delete_remote_if_present "$CIPHERTEXT_PATH" "ci: remove consumed Canonical credential ciphertext"
}
trap cleanup_remote_handoff EXIT

# The workflow runs on an ephemeral GitHub-hosted runner. Local key material is
# intentionally confined to RUNNER_TEMP and never enters Git, logs, outputs, or
# artifacts. Repository instructions forbid destructive shell deletion, so the
# runner teardown is the local disposal boundary.
delete_remote_if_present "$PUBLIC_KEY_PATH" "ci: remove stale Canonical credential public key"
delete_remote_if_present "$CIPHERTEXT_PATH" "ci: remove stale Canonical credential ciphertext"

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:4096 \
  -out "$private_key" >/dev/null 2>&1
openssl pkey \
  -in "$private_key" \
  -pubout \
  -out "$public_key" >/dev/null 2>&1

put_file \
  "$PUBLIC_KEY_PATH" \
  "$public_key" \
  "ci: publish ephemeral Canonical credential key"
printf 'CANONICAL_HANDSHAKE_READY nonce=%s path=%s\n' "$HANDSHAKE_NONCE" "$PUBLIC_KEY_PATH"

ciphertext=""
for _ in $(seq 1 "$CIPHERTEXT_WAIT_ATTEMPTS"); do
  if metadata="$(repo_api_call GET "${repo_api}/contents/${CIPHERTEXT_PATH}?ref=${DEFAULT_BRANCH}" 2>/dev/null)"; then
    ciphertext="$(jq -r '.content // empty' <<<"$metadata" \
      | tr -d '\n' \
      | base64 -d \
      | tr -d '\r\n')"
    [[ -z "$ciphertext" ]] || break
  fi
  sleep "$CIPHERTEXT_POLL_SECONDS"
done

if [[ -z "$ciphertext" ]]; then
  printf 'encrypted Canonical bundle was not received for handshake %s\n' "$HANDSHAKE_NONCE" >&2
  exit 1
fi

printf '%s' "$ciphertext" | base64 -d > "$encrypted_bundle"
openssl pkeyutl \
  -decrypt \
  -inkey "$private_key" \
  -in "$encrypted_bundle" \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 \
  > "$plain_bundle"

bundle_b64="$(python3 - "$plain_bundle" <<'PY'
import base64
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
payload = json.loads(raw)
if not isinstance(payload, dict) or set(payload) != {"cloudflare"}:
    raise SystemExit("bundle must contain only cloudflare")
cloudflare = payload.get("cloudflare")
if not isinstance(cloudflare, dict) or set(cloudflare) != {"account_id", "api_token"}:
    raise SystemExit("cloudflare bundle must contain exactly account_id and api_token")
account_id = cloudflare.get("account_id")
token = cloudflare.get("api_token")
if not isinstance(account_id, str) or len(account_id) != 32:
    raise SystemExit("invalid account_id")
if not isinstance(token, str) or not token or any(ch.isspace() for ch in token):
    raise SystemExit("invalid api_token")
print(base64.b64encode(raw).decode())
PY
)"
api_token="$(python3 - "$plain_bundle" <<'PY'
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text())["cloudflare"]["api_token"])
PY
)"
printf '::add-mask::%s\n' "$api_token"
printf '::add-mask::%s\n' "$bundle_b64"
printf 'CANONICAL_CREDENTIAL_BUNDLE_B64=%s\n' "$bundle_b64" >> "$GITHUB_ENV"

cleanup_remote_handoff
trap - EXIT
printf 'CANONICAL_ENCRYPTED_BUNDLE_READY\n'
