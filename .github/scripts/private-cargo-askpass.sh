#!/bin/sh
# Credential helper for the strictly scoped, fetch-only Cargo CI step.
# Git normally asks for credentials using the literal HTTPS origin prompt.
# Never respond to attacker-controlled hosts such as evilgithub.com or
# github.com.attacker.invalid. Keep the token out of URLs and shell argv.
set -eu
case "${1-}" in
  "Username for 'https://github.com':" | "Username for 'https://github.com': ")
    printf '%s\n' 'x-access-token'
    ;;
  "Password for 'https://x-access-token@github.com':" | "Password for 'https://x-access-token@github.com': ")
    test -n "${PRIVATE_CARGO_TOKEN:-}" || exit 1
    printf '%s\n' "$PRIVATE_CARGO_TOKEN"
    ;;
  *)
    exit 1
    ;;
esac
