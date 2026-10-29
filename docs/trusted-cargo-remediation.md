# Independently approved private Cargo.lock proposal

This is a separate protected-main-only manual workflow. It does not run on pull_request, push, or pull_request_target and never edits main or publishes.

Require a non-draft exact-head same-repo web PR, label trusted-lock-remediation, an independent current-head GitHub approval, and no outstanding trusted changes requests. The allowed bases are main or the existing reviewed consolidation branch.

The canonical-private-cargo-remediation environment requires protected branches, required independent reviewers, and prevention of self-review. Its read-only CANONICAL_PRIVATE_CARGO_READ_TOKEN must be scoped to the pinned canonical-lib-core and canonical-orm-core sources. This environment is distinct from canonical-private-cargo-validation.

Only cargo fetch --locked receives credentials. The exact reviewed source and tree are checked twice, and trusted main admission rules reject unapproved Git sources. The Cargo resolver runs without network, tokens, source write access or a Docker socket. No candidate-owned scripts or build scripts are executed.

The sole artifact is a proposed Cargo.lock. A human must review and commit genuine Cargo-resolved checksums into the source PR and run the full RustSec audit and all compilation/integration gates. A green remediation artifact is NOT a merge, compiler, audit or release verdict.

If offline resolution fails because the local registry cache lacks new versions, fail closed; extend the public-index staging plan in a separate reviewed change, never grant network access inside the private-source resolution container.

Administrative configuration and independent approvals are prerequisites. The draft workflow cannot be dispatched before it is approved and merged to protected main.
