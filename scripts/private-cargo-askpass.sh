#!/bin/sh
# Prompt-gated GitHub read access for the private Cargo dependency lane.
# This helper never prints a token for foreign hosts or malformed prompts.
# Require the entire single-quoted Git URL, not just its prefix.
set -eu
prompt="${1:-}"
case "$prompt" in
  "Username for 'https://github.com':"|"Username for 'https://github.com/"*"':")
    printf '%s\n' 'x-access-token'
    ;;
  "Password for 'https://x-access-token@github.com':"|"Password for 'https://x-access-token@github.com/"*"':")
    test -n "${PRIVATE_CARGO_TOKEN:-}" || exit 1
    printf '%s\n' "$PRIVATE_CARGO_TOKEN"
    ;;
  *)
    exit 1
    ;;
esac
