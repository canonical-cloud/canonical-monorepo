#!/usr/bin/env python3
"""Fail-closed Git tree identity gate for authorized, private CI mirrors.

This checks the already-mirrored commit; it never fetches another repository
or assumes a cross-organization GITHUB_TOKEN can access private source.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SHA = re.compile(r"[0-9a-f]{40}\Z")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


def fail(message):
    raise ValueError(message)


def hex_sha(value, field):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        fail(f"{field} must be a full lowercase 40-character Git SHA")
    return value


def safe_rel(value, field):
    if not isinstance(value, str) or not value or len(value) > 512:
        fail(f"{field} is not a nonempty relative Git path")
    if "\\" in value or value.startswith("/") or any(ord(ch) < 32 or ord(ch) == 127 for ch in value) or any(
        component in ("", ".", "..") for component in value.split("/")
    ):
        fail(f"{field} contains an unsafe path component")
    return value


def git(repo, *args):
    command = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True, capture_output=True, check=False,
    )
    if command.returncode:
        fail(f"git {args[0]} failed: {command.stderr.strip()}")
    return command.stdout.strip()


def verify(manifest_path, checkout, attestation_path=None):
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema") != "ores.exact-tree.v1":
        fail("unrecognized exact-tree manifest schema")
    source = document.get("source")
    if not isinstance(source, dict) or not REPO.fullmatch(str(source.get("repository", ""))):
        fail("source.repository must be owner/name")
    commit = hex_sha(source.get("commit"), "source.commit")
    expected_tree = hex_sha(source.get("tree"), "source.tree")
    mirror = safe_rel(source.get("mirror_path"), "source.mirror_path")
    pins = document.get("blobs")
    if not isinstance(pins, list) or not pins:
        fail("at least one exact blob pin is required")
    if len(pins) > 10000:
        fail("too many blob pins")

    checkout = checkout.resolve(strict=True)
    repository_root = Path(git(checkout, "rev-parse", "--show-toplevel")).resolve(strict=True)
    if checkout != repository_root:
        fail("checkout must be the Git repository root")
    tested_commit = git(checkout, "rev-parse", "--verify", "HEAD^{commit}")
    mirrored_tree = git(checkout, "rev-parse", f"HEAD:{mirror}")
    if git(checkout, "cat-file", "-t", mirrored_tree) != "tree":
        fail("mirror path must be a Git tree, not a file or symlink")
    if mirrored_tree != expected_tree:
        fail(f"mirror tree mismatch: got {mirrored_tree}, expected {expected_tree}")
    if git(checkout, "status", "--porcelain", "--ignored", "--untracked-files=all", "--", mirror):
        fail("working mirror has dirty, untracked or ignored files")

    seen = set()
    checked = []
    for entry in pins:
        if not isinstance(entry, dict):
            fail("blob pin must be an object")
        path = safe_rel(entry.get("path"), "blobs[].path")
        if path in seen:
            fail(f"duplicate blob pin: {path}")
        seen.add(path)
        expected = hex_sha(entry.get("sha"), f"blobs[{path}].sha")
        actual = git(checkout, "rev-parse", f"HEAD:{mirror}/{path}")
        if git(checkout, "cat-file", "-t", actual) != "blob":
            fail(f"not a regular Git blob: {path}")
        tree_row = git(checkout, "ls-tree", "-r", "--full-tree", "HEAD", "--", f"{mirror}/{path}")
        if not (tree_row.startswith(f"100644 blob {actual}" + chr(9)) or tree_row.startswith(f"100755 blob {actual}" + chr(9))):
            fail(f"pinned path is not a regular file: {path}")
        if actual != expected:
            fail(f"blob mismatch: {path}: {actual} != {expected}")
        checked.append({"path": path, "sha": actual})

    receipt = {
        "schema": "ores.exact-tree.receipt.v1",
        "mirror_commit": tested_commit,
        "source_repository": source["repository"],
        "declared_source_commit": commit,
        "verified_source_tree": mirrored_tree,
        "mirror_path": mirror,
        "verified_blobs": checked,
    }
    rendered = json.dumps(receipt, sort_keys=True, indent=2) + "\n"
    if attestation_path is not None:
        attestation_path.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--checkout", type=Path, default=Path.cwd())
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    try:
        verify(args.manifest, args.checkout, args.receipt)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f"exact-tree verification FAILED: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
