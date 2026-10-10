#!/usr/bin/env bash
# Run on an authorized workstation with TWO already-cloned repositories.
# No private cross-org checkout token or repository secret is used by CI.
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 /path/to/oreslang-source.java /path/to/canonical-monorepo" >&2
  exit 2
fi

src="$(cd "$1" && pwd -P)"
dst="$(cd "$2" && pwd -P)"
expected_commit="6bacba6fd85db3a436a266efd4b2b13aaf930678"
expected_tree="812e717572347e611c0b0652dbce8c800a924687"
expected_branch="ci/oreslang-pr538-exact-on-canonical-20261010"

test "$(git -C "$src" rev-parse HEAD)" = "$expected_commit" || {
  echo "Source HEAD changed: pin and review a new source revision first" >&2; exit 1;
}
test "$(git -C "$src" rev-parse 'HEAD^{tree}')" = "$expected_tree" || {
  echo "Source tree mismatched the pinned revision" >&2; exit 1;
}
test "$(git -C "$dst" branch --show-current)" = "$expected_branch" || {
  echo "Refusing to mutate a different destination branch" >&2; exit 1;
}
test -z "$(git -C "$dst" status --porcelain)" || {
  echo "Destination worktree must be clean before mirroring" >&2; exit 1;
}

mkdir -p "$dst/oreslang-source"
rsync -a --delete --exclude='.git' -- "$src/" "$dst/oreslang-source/"
git -C "$dst" add -A -- oreslang-source
root_tree="$(git -C "$dst" write-tree)"
actual_tree="$(git -C "$dst" rev-parse "${root_tree}:oreslang-source")"

if [[ "$actual_tree" != "$expected_tree" ]]; then
  echo "FAIL CLOSED: mirrored tree $actual_tree != source tree $expected_tree" >&2
  exit 1
fi

printf 'PR538 source commit: %s\nExact source tree: %s\n' "$expected_commit" "$expected_tree" > "$dst/mirror-ready.txt"
printf 'PR538 pipe suite source commit: %s\nExact source tree: %s\n' "$expected_commit" "$expected_tree" > "$dst/pipe-ready.txt"
git -C "$dst" add -- mirror-ready.txt pipe-ready.txt
git -C "$dst" commit -m "ci: verify and run exact PR538 source tree $expected_tree"
git -C "$dst" push origin "$expected_branch"
echo "Pushed $expected_commit; CI must independently verify HEAD:oreslang-source = $expected_tree"
