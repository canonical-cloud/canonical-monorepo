#!/usr/bin/env python3
"""Fail-closed documentation/source identity checks for the Oreslang Stack CLI.

This is a static contract check, NOT execution proof for the Oreslang compiler.
"""
from pathlib import Path


def require(ok: bool, description: str) -> None:
    if not ok:
        raise SystemExit(f"project identity contract failed: {description}")


readme = Path("README.md").read_text(encoding="utf-8")
bootstrap = Path("bin/oreslang-stack").read_text(encoding="utf-8")
sources = Path("src/main.ores").read_text(encoding="utf-8")

require(readme.startswith("# Oreslang Stack CLI\n"), "correct project heading")
require("## Project identity: Oreslang Stack is not ORES Stack" in readme,
        "explicit project distinction")
require("https://github.com/ores-truffle-oreslang/oreslang-stack-cli" in readme,
        "canonical Oreslang CLI URL")
require("https://github.com/ores-stack/ores-stack-cli" in readme,
        "cross-reference to distinct Rust CLI")
require("`oreslang-stack`" in readme and "`ores-stack`" in readme,
        "separate CLI commands")
require("**private**" in readme and "Git tree SHAs" in readme
        and "executed" in readme, "private exact-tree CI mirror constraints")
require("PR #496 is merged" in readme,
        "record merged source dependency; do not call it unmerged")
require("installed Java/Graal runtime" in readme,
        "separate merged source from installed runtime compatibility")
require("deploy` currently fails closed" in readme,
        "deployment must not be represented as certified")
require("This PR must remain" not in readme
        and "Until this dependency is merged" not in readme,
        "reject stale pull request claims")
require(r"|\n|" not in readme, "reject escaped newline breaking Markdown table")
table_rows = [row for row in readme.splitlines() if row.startswith("| `")]
require(len(table_rows) >= 7 and all(row.rstrip().endswith("|") for row in table_rows),
        "command-table rows must be well-formed")
require(Path("src/main.ores").is_file() and "oreslang-stack-cli" in sources,
        "the Oreslang source implementation exists")
require(Path("bin/oreslang-stack").is_file()
        and "ORESLANG_BIN" in bootstrap, "the POSIX runtime bootstrap exists")
require(not Path("Cargo.toml").exists() and not Path("src/main.rs").exists(),
        "Rust CLI must not be misidentified as this repository")
print("Oreslang Stack identity documentation contract passed (static only)")
