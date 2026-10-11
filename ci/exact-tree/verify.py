#!/usr/bin/env python3
"""Fail-closed local Git-object proof for authorized private source mirrors.

This script DOES NOT copy repositories, authenticate across organizations,
determine which organizations have Actions minutes, or execute arbitrary
commands from the manifest. It only verifies pinned Git objects already present
in the checked-out private destination repository.
"""
import argparse
import json
import re
import subprocess
from pathlib import PurePosixPath

SHA = re.compile(r"[0-9a-f]{40}\Z")
OWNER_REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


def git(*args):
    return subprocess.run(
        ["git", *args], check=True, text=True, capture_output=True
    ).stdout.strip()


def valid_prefix(path):
    p = PurePosixPath(path)
    return bool(path and not path.startswith("/") and
                p.parts and all(part not in (".", "..") for part in p.parts)
                and "\\" not in path and ":" not in path)


def verify(manifest):
    if manifest.get("schema") != "ores.private-exact-tree-ci/v1":
        raise ValueError("unsupported manifest schema")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("manifest requires sources")
    seen = set()
    for src in sources:
        origin = src.get("origin")
        commit = src.get("commit")
        tree = src.get("tree")
        prefix = src.get("mirror_prefix")
        if not isinstance(origin, str) or not OWNER_REPO.fullmatch(origin):
            raise ValueError("invalid source origin")
        if not all(isinstance(v, str) and SHA.fullmatch(v) for v in [commit, tree]):
            raise ValueError("source commit and tree must be exact immutable SHAs")
        if not isinstance(prefix, str) or not valid_prefix(prefix):
            raise ValueError("unsafe destination path")
        if prefix in seen:
            raise ValueError("duplicate mirror prefix")
        seen.add(prefix)
        current = git("rev-parse", f"HEAD:{prefix}")
        kind = git("cat-file", "-t", current)
        if kind != "tree" or current != tree:
            raise ValueError(f"{origin}@{commit}: mirror tree SHA mismatch")
        print(f"verified {origin}@{commit} mirrored as tree {tree} at {prefix}")
    print("Exact-tree identity gate PASSED; this is not a compiler/test result.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    with open(args.manifest, "r", encoding="utf-8") as stream:
        verify(json.load(stream))
