#!/usr/bin/env python3
"""Static identity/visibility contract for the ORES Stack org README/profile."""
from pathlib import Path


def require(ok: bool, description: str) -> None:
    if not ok:
        raise SystemExit(f"organization identity contract failed: {description}")


readme = Path("README.md").read_text(encoding="utf-8")
profile = Path("profile/README.md").read_text(encoding="utf-8")
require(readme.startswith("# ORES Stack organization configuration\n"),
        "repository README identifies the owning organization")
require(profile.startswith("# ORES Stack\n"),
        "organization profile identifies ORES Stack")
for label, body in (("README", readme), ("profile", profile)):
    require("https://github.com/ores-stack/ores-stack-cli" in body,
            f"{label} canonical ORES Stack CLI link")
    require("https://github.com/ores-truffle-oreslang/oreslang-stack-cli" in body,
            f"{label} canonical Oreslang Stack CLI link")
    require("`ores-stack`" in body and "`oreslang-stack`" in body,
            f"{label} must distinguish the two CLI commands")
    require("private" in body.lower() and "mirror" in body.lower(),
            f"{label} must explicitly constrain temporary private CI mirrors")
    require("source" in body.lower() and "tree" in body.lower(),
            f"{label} must require source-tree identity")
require("currently **private**" in readme and "currently private" in profile,
        "private GitHub .github profile must not be described as public")
require("not a public organization landing page" in profile,
        "do not claim private profile content is publicly visible")
print("ORES Stack org identity documentation contract passed (static only)")
