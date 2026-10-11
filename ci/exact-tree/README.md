# Private, exact-source GitHub Actions mirror verification

This is a CI **testing** mechanism, not an ORES Stack/Oreslang Stack migration or a transfer of project ownership.

1. Confirm the source repo and destination CI repo are both private and explicitly authorized for the same source content. Do not use public repos for private source trees.
2. Select a source commit SHA and its full Git tree SHA. Mirror the *exact tree* into the destination's temporary branch via the GitHub connector. Cross-organization `GITHUB_TOKEN` checkout cannot access the private source; don't add new secrets.
3. Record source owner/repo, immutable source commit, source Git tree and local mirror prefix in `manifest.json`.
4. Run `python3 ci/exact-tree/verify.py --manifest ci/exact-tree/manifest.json` on the destination checkout. An incorrect or absent subtree fails **before** any build begins.
5. Execute the language-specific test suite on the local mirror. Use pinned versioned dependencies and separately verify their provenance. The verifier itself is **not** compiler, release, deployment, AOT, hybrid or security certification.
6. Require real allocated runner IDs, non-empty executed steps, zero failures, source-tree identity and passing tests for *the exact PR head* before interpreting this as CI evidence. A green older SHA doesn't validate a changed branch.
7. Keep temporary mirrors and artifacts private. Once the evidence (commit/tree, test steps and run link) is recorded, clean up temporary branches and copies under approved repository retention policies.

Never substitute an authorized host's `main` contents for the source Git tree, silently rewrite source files before the identity gate, or execute commands supplied by a user-editable manifest. The manifest is **declarative**: only source identity is data.