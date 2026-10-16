#!/usr/bin/env python3
"""Fail-closed extraction of a public frontend artifact on a private-Cargo runner.

Never use tar.extractall: reject links, path escapes and non-public entries.
"""
import os
import pathlib
import shutil
import sys
import tarfile

PREFIXES = ("apps/canonical-marketing-site.web/dist/",
            "apps/canonical-web-server.rs/client/dist/")
MAX_SIZE = 128 * 1024 * 1024
MAX_MEMBERS = 20000


def unpack(archive_name, output_name, expected_sha):
    if len(expected_sha) != 40 or any(c not in "0123456789abcdef" for c in expected_sha):
        raise ValueError("invalid expected source SHA")
    output = pathlib.Path(output_name)
    if output.exists():
        raise ValueError("output destination already exists")
    output.mkdir(parents=True, mode=0o700)
    total = 0
    count = 0
    with tarfile.open(archive_name, "r:gz") as tar:
        for member in tar:
            count += 1
            if count > MAX_MEMBERS:
                raise ValueError("excessive artifact entries")
            name = member.name
            parts = name.split("/")
            if (name.startswith("/") or any(p in ("", ".", "..") for p in parts)
                    or "\\" in name):
                raise ValueError("unsafe archive path")
            if not (name == "source-commit.txt" or
                    any(name == p[:-1] or name.startswith(p) for p in PREFIXES)
                    or any(p.startswith(name + "/") for p in PREFIXES)):
                raise ValueError("nonpublic artifact path")
            if not member.isfile() and not member.isdir():
                raise ValueError("nonregular artifact entry")
            total += member.size
            if total > MAX_SIZE:
                raise ValueError("artifact exceeds size cap")
            dest = output.joinpath(*parts)
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, dest.open("xb") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                dest.chmod(0o600)
    assert (output / "source-commit.txt").read_text().strip() == expected_sha, (
        "public asset artifact does not match exact mainline commit")
    assert (output / "apps/canonical-marketing-site.web/dist/index.html").is_file()
    client = output / "apps/canonical-web-server.rs/client/dist"
    assert client.is_dir()
    assert any(f.suffix in (".js", ".css") for f in client.rglob("*") if f.is_file())
    print("Verified regular public frontend artifacts and exact source SHA:", expected_sha)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: verify-public-frontends.py <archive> <empty-output-directory> <expected-commit-sha>")
    try:
        unpack(*sys.argv[1:])
    except (ValueError, AssertionError, OSError, tarfile.TarError) as error:
        sys.exit("::error::Public frontend artifact rejected: " + str(error))
