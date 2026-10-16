# Trusted pre-merge Canonical Rust validation

This process is **review-only**. It never publishes images, edits a deployment
pointer, pushes a Git commit, or bypasses the immutable mainline gitlink policy.

## Scope

- Untrusted PR workflows run without secrets.
- The manually dispatched `.github/workflows/trusted-cargo-review.yml`
  definition must be installed on protected `canonical-monorepo/main`.
- A preflight verifies an open same-repository
  `canonical-cloud/canonical-web-server.rs` PR targeting `main` and an
  explicitly supplied exact 40-character head SHA. It also verifies the
  `canonical-private-cargo-validation` environment has an independent reviewer
  rule, prevents self-review, and limits deployments to protected branches.
- That preflight calls the GitHub Environments REST API. If GitHub denies the
  workflow identity permission to read environment metadata, it **fails closed
  before any private credential is loaded**. An administrator must arrange
  supported read-only metadata access; do not weaken the check to make it pass.
- The approved environment must require independent human approval. Never
  allow `pull_request` or `pull_request_target` to invoke the credentialed job.
- `CANONICAL_PRIVATE_CARGO_READ_TOKEN` must grant only read access to the
  explicitly required Canonical private Git dependencies (currently
  `canonical-lib-core` and `canonical-orm-core`). Do not grant repo write,
  package publishing, or org administration. Prefer an expiring, rotateable
  approved credential kept in the protected environment. No credential is
  embedded in a clone URL.
- Public and private dependency Git URLs and immutable commits are checked
  against `scripts/check-cargo-git-sources.mjs` **before** credential usage.
  Changes to its allowlist require independent security review.

## Administrative checklist

1. Confirm `main` branch protection requires reviewed changes and all
   mandatory source/security checks. Current connector permissions cannot read
   detailed branch-protection or environment settings.
2. Configure the protected environment named
   `canonical-private-cargo-validation`: protected branch only, one or more
   independent required reviewers, and prevention of self-approval. Ensure the
   preflight identity can read its non-secret protection metadata.
3. Configure narrowly scoped read-only private dependency access. Test Git
   access only in the reviewed environment; never pass the token to a normal
   PR workflow, npm command, Rust compiler, or build script.
4. Review and land the **workflow definition itself** on protected monorepo
   `main` using an approved change. GitHub generally requires a workflow to
   exist on the default branch before it can be dispatched. Do not bypass
   required checks on PR #130 to do this.
5. Dispatch **Trusted reviewed web Cargo validation** with `ref=main`,
   `web_pr=195`, and the current exact head SHA of that open PR. Approval is
   explicit for the SHA; changed heads require a new dispatch.
6. Require the logged monorepo commit/tree and web candidate commit/tree to
   match the reviewed revisions. The API is read from its pinned public
   monorepo gitlink.
7. Verify credentialed `cargo fetch --locked` completes. All later
   lock regeneration, format, Clippy, Rust tests, and RustSec audits run
   **without the private token**. Missing credentials or missing dependency
   revisions are failures, never skips.
8. Close RustSec issues and rerun exact-head validation. Existing candidate
   locks still include web `quinn-proto 0.11.16` and `rustls 0.23.45`, and
   API `quinn-proto 0.11.16` and `rustls 0.23.43`. These versions should not
   be accepted as security-cleared. The narrow web `rkyv` exception is
   permitted only after the active dependency graph check proves it inactive.
9. Run PostgreSQL/CockroachDB RLS, browser E2E, container/image and actual
   release gates separately. A passing trusted Cargo review is not permission
   to publish and does not replace the monorepo protected-main CI.
10. After web-source review and merge to its protected `main`, update the
    monorepo gitlink to an ancestor of that `main`; verify that the full
    pinned-stack CI passes. Never merge preview PR #131 as a deployment pin.

## Evidence and unresolved dependencies

- Web source/security integration: PR #195, with 94/94 targeted tests passed
  but full Rust CI blocked by private dependency auth.
- Monorepo trust-boundary changes: PR #130.
- Separate no-release preview: PR #131 passed 39/39 policy/contract tests,
  then correctly failed Gitlink-to-main ancestry admission.
- Authorization, runner capacity and remaining blockers: monorepo issue #94.

The canonical source organization has functioning GitHub Actions runners.
No private-source cross-organization mirror is authorized or required for
this workflow. If funded capacity is later exhausted, obtain authorization
before any private Git-tree replication and verify exact tree identity.
