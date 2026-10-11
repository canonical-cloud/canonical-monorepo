#!/usr/bin/env python3
"""Static project-identity README contract; does not replace Rust build tests."""
from pathlib import Path


def require(ok: bool, description: str) -> None:
    if not ok:
        raise SystemExit(f"project identity contract failed: {description}")


readme = Path("README.md").read_text(encoding="utf-8")
cargo = Path("Cargo.toml").read_text(encoding="utf-8")
require(readme.startswith("# ores-stack-cli\n"), "correct ORES Stack heading")
require("## Project identity: ORES Stack is not Oreslang Stack" in readme,
        "explicit separation from Oreslang Stack")
require("https://github.com/ores-stack/ores-stack-cli" in readme,
        "canonical Rust CLI link")
require("https://github.com/ores-truffle-oreslang/oreslang-stack-cli" in readme,
        "canonical Oreslang-native CLI cross-link")
require("`ores-stack`" in readme and "`oreslang-stack`" in readme,
        "distinct command names")
require("Rust/Cargo" in readme and "Oreslang" in readme,
        "implementation-language distinction")
require("**private**" in readme and "Git subtree SHA" in readme
        and "actual runner" in readme, "temporary private exact-tree CI mirror controls")
require("ores.lambda.wasm-artifact.receipt/v1" in readme,
        "WASM-specific artifact receipt identifier")
require("ores.lambda.artifact.receipt.v2" in readme,
        "historical native artifact receipt identifier")
require("writes a side-effect-free `ores.lambda.artifact.receipt.v2` receipt"
        not in readme, "reject mislabeling WASM builds with native receipt")
require("repository = \"https://github.com/ores-stack/ores-stack-cli\"" in cargo,
        "Cargo workspace provenance")
require('members = [' in cargo and 'crates/ores-stack-cli' in cargo,
        "Rust CLI crate is part of the Cargo workspace")
require(Path("MIGRATION.md").is_file(), "migration documentation exists")
require(not Path("src/main.ores").is_file(), "not the Oreslang Stack command source")
print("ORES Stack identity documentation contract passed (static only)")
