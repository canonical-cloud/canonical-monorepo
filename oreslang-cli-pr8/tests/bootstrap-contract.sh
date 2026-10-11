#!/usr/bin/env bash
# Host only: this mock NEVER establishes Oreslang compiler correctness.
set -euo pipefail
repo="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/project/src"
printf '[repository]\nrole = "api"\n' > "$tmp/project/oreslang-stack.toml"
printf 'pub routine main(): void { return; }\n' > "$tmp/project/src/main.ores"
cat > "$tmp/fake-oreslang" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--check" ]]; then
  [[ -f "$2" ]] || exit 1
  exit 0
fi
if [[ "$1" == --allow-env=* ]]; then
  if [[ "$ORESLANG_STACK_COMMAND" == "routes" || "$ORESLANG_STACK_COMMAND" == "check" ||
        ( "$ORESLANG_STACK_COMMAND" == "generate" && "$ORESLANG_STACK_CHECK" == "true" ) ]]; then
    for option in "$@"; do
      if [[ "$option" == --allow-write=* ]]; then
        echo "ERROR: read-only command was granted filesystem write access"
        exit 3
      fi
    done
  fi
  if [[ "$ORESLANG_STACK_BACKEND" != graal ]]; then
    echo 'ERROR: LLVM not supported'
    exit 0
  fi
  case "$ORESLANG_STACK_COMMAND" in
    dev|build|check)
      mkdir -p "$ORESLANG_STACK_ROOT/generated"
      printf '{"schema": "oreslang.stack.inventory/v1"}\n' > "$ORESLANG_STACK_ROOT/generated/route-manifest.json"
      printf 'ORESLANG_STACK_ACTION_v1:%s\n' "$ORESLANG_STACK_COMMAND" ;;
    routes) printf 'ORESLANG_STACK_JSON_v1:{"schema":"oreslang.stack.inventory/v1"}\n' ;;
    generate) printf 'ORESLANG_STACK_ACTION_v1:generated\n' ;;
    deploy) printf 'ERROR: deployment denied\n' ;;
    *) printf 'ERROR: unrecognized\n' ;;
  esac
  exit 0
fi
printf 'app started\n'
EOS
chmod +x "$tmp/fake-oreslang"
export ORESLANG_BIN="$tmp/fake-oreslang"
test "$("$repo/bin/oreslang-stack" dev --root "$tmp/project")" = "app started"
"$repo/bin/oreslang-stack" build --root "$tmp/project" | grep -F 'NOT a compiled'
test -s "$tmp/project/dist/oreslang-stack-source.tar.gz"
tar -tzf "$tmp/project/dist/oreslang-stack-source.tar.gz" | grep -F "bin/oreslang-stack-run"
"$repo/bin/oreslang-stack" routes --root "$tmp/project" | grep -F '"schema"'
"$repo/bin/oreslang-stack" generate --kind all --root "$tmp/project" | grep -F 'generated'
"$repo/bin/oreslang-stack" generate --kind all --check --root "$tmp/project" | grep -F 'generated'
env ORESLANG_STACK_COMMAND=deploy "$repo/bin/oreslang-stack" routes --root "$tmp/project" | grep -F '"schema"'
"$repo/bin/oreslang-stack" check --root "$tmp/project" | grep -F 'verified'
tar -tzf "$tmp/project/dist/oreslang-stack-source.tar.gz" | grep -F 'src/main.ores'
tar -tzf "$tmp/project/dist/oreslang-stack-source.tar.gz" | grep -F '.oreslang-stack-entry'
printf 'do-not-include\n' > "$tmp/project/src/.env"
"$repo/bin/oreslang-stack" build --root "$tmp/project" >/dev/null
if tar -tzf "$tmp/project/dist/oreslang-stack-source.tar.gz" | grep -F '.env'; then
  echo "bundle must not contain .env secrets" >&2
  exit 1
fi
printf 'pub routine main(): void { return; }\n' > "$tmp/project/src/other.ores"
"$repo/bin/oreslang-stack" build --root "$tmp/project" --entry src/other.ores >/dev/null
tar -xzOf "$tmp/project/dist/oreslang-stack-source.tar.gz" ./.oreslang-stack-entry | grep -Fx 'src/other.ores'
rm -f "$tmp/project/dist/oreslang-stack-source.tar.gz"
mkdir "$tmp/project/dist/oreslang-stack-source.tar.gz"
if "$repo/bin/oreslang-stack" build --root "$tmp/project"; then
  echo "directory destination must be rejected" >&2
  exit 1
fi
# Restore the test fixture: subsequent successful builds need a file destination.
rmdir "$tmp/project/dist/oreslang-stack-source.tar.gz"
if "$repo/bin/oreslang-stack" dev --root "$tmp/project" --entry src/../escape.ores; then
  echo "entrypath traversal must fail" >&2
  exit 1
fi
if "$repo/bin/oreslang-stack" deploy --root "$tmp/project" --target oreslang-stack; then
  echo "deploy must never succeed" >&2
  exit 1
fi
if "$repo/bin/oreslang-stack" dev --root "$tmp/project" --bad-flag; then
  echo "unknown flags must fail" >&2
  exit 1
fi
if "$repo/bin/oreslang-stack" build --backend llvm --root "$tmp/project"; then
  echo "llvm not admitted" >&2
  exit 1
fi
ln -s "$tmp/project" "$tmp/project-link"
if "$repo/bin/oreslang-stack" dev --root "$tmp/project-link"; then
  echo "symlink root must fail" >&2
  exit 1
fi
# Sensitive local compiler config may be useful when building, but it must
# not leak into the exported source-only distribution by default.
printf '[local]\ntoken = "do-not-bundle-this"\n' > "$tmp/project/.oreslangc.cfg.toml"
"$repo/bin/oreslang-stack" build --root "$tmp/project" >/dev/null
if tar -tzf "$tmp/project/dist/oreslang-stack-source.tar.gz" | grep -F '.oreslangc.cfg.toml'; then
  echo "source distribution must omit private compiler configuration" >&2
  exit 1
fi

# The unpacked runner must refuse entrypoint parents redirected via symlinks,
# even if the final entry itself is a regular source file.
mkdir -p "$tmp/unpacked" "$tmp/outside-source"
printf 'pub routine main(): void { return; }\n' > "$tmp/outside-source/main.ores"
tar -xzf "$tmp/project/dist/oreslang-stack-source.tar.gz" -C "$tmp/unpacked"
ln -s "$tmp/outside-source" "$tmp/unpacked/src/escaped"
printf 'src/escaped/main.ores\n' > "$tmp/unpacked/.oreslang-stack-entry"
if ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run"; then
  echo "bundle entrypoint must not escape via parent symlink" >&2
  exit 1
fi
rm "$tmp/unpacked/src/escaped"
printf 'src/../src/main.ores\n' > "$tmp/unpacked/.oreslang-stack-entry"
if ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run"; then
  echo "bundle traversal segments must be denied" >&2
  exit 1
fi
printf 'src/./main.ores\n' > "$tmp/unpacked/.oreslang-stack-entry"
if ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run"; then
  echo "bundle dot segments must be denied" >&2
  exit 1
fi
printf 'src//main.ores\n' > "$tmp/unpacked/.oreslang-stack-entry"
if ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run"; then
  echo "bundle duplicate separators must be denied" >&2
  exit 1
fi
printf 'src/main.ores\n' > "$tmp/unpacked/.oreslang-stack-entry"
test "$(ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run")" = 'app started'

# A linked application entry must be rejected even if it resolves to a file.
mkdir -p "$tmp/project/src/linked"
ln -s "$tmp/outside-source/main.ores" "$tmp/project/src/linked/entry.ores"
if "$repo/bin/oreslang-stack" dev --root "$tmp/project" --entry src/linked/entry.ores; then
  echo "symlinked application entry must fail" >&2
  exit 1
fi
printf 'pub routine main(): void { return; }\n' > "$tmp/project/src/entry.txt"
if "$repo/bin/oreslang-stack" build --root "$tmp/project" --entry src/entry.txt; then
  echo "non-Oreslang entrypoint must fail" >&2
  exit 1
fi
if "$repo/bin/oreslang-stack" build --root "$tmp/project" --entry src//main.ores; then
  echo "noncanonical path with double slash must fail" >&2
  exit 1
fi
printf 'src/entry.txt\n' > "$tmp/unpacked/.oreslang-stack-entry"
if ORESLANG_BIN="$tmp/fake-oreslang" "$tmp/unpacked/bin/oreslang-stack-run"; then
  echo "non-Oreslang source receipt must fail" >&2
  exit 1
fi
echo 'host bootstrap contract checks passed (mock interpreter; not native compilation)'
