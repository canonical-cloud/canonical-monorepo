# Trusted pre-merge Canonical Rust validation

This process is **review-only**. It never publishes images, edits a deployment
pointer, pushes a Git commit, or bypasses the immutable mainline gitlink policy.

## Scope

- Untrusted PR workflows run without secrets.
- The manually dispatched `.github/workflows/trusted-cargo-review.yml`
  definition must be installed on protected `canonical-monorepo/main`.
- A preflight verifies an open, **non-draft**, same-repository
  `canonical-cloud/canonical-web-server.rs` PR targeting `main` and an
  explicitly supplied exact 40-character head SHA. The PR requires the
  `trusted-private-ci` opt-in label and a trusted independent approval of
  the **current exact commit**, with no outstanding trusted changes requests.
  All pages of GitHub reviews are examined, not only the first 100.
  The preflight verifies that the `canonical-private-cargo-validation`
  environment requires independent reviewers, prevents self-review, and limits
  deployments to protected branches.
- The preflight calls the GitHub Environments REST API using a `GITHUB_TOKEN`
  with **Actions: read** and **Contents: read**, as required for environment
  inspection. If GitHub denies metadata access, it **fails closed before any
  private credential is loaded**; an administrator must arrange supported
  read-only access instead of weakening the check.
- After human environment approval, the trusted job checks the PR's current
  head, opt-in label, all paginated review states and exact source tree **again
  before** the private dependency token is attached to its fetch step. A
  changed/dismissed approval or changed PR head requires fresh review.
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
- Private dependencies are fetched into a **dedicated ephemeral Cargo cache**.
  Rust lock regeneration, fmt, Clippy and tests then run in a disposable
  `rust:1.95.0-bookworm` image resolved to its local SHA256 image ID **before
  any token is provided**. The build container has `--network none`, a
  read-only root filesystem, capability removal, `no-new-privileges`,
  restricted process/memory limits, read-only source and Cargo cache mounts,
  and only disposable writable output/tmp mounts. No Docker socket or host
  credentials are mounted. Raw build-script output is deliberately withheld
  from public Actions logs to avoid copying private dependency source there.
- Docker isolation shares the host kernel; it is defense in depth, not a
  substitute for code review and separate hardened or ephemeral runners.
  The workflow still requires independent human approval of each exact SHA.
  Review the Rust image supply-chain provenance and use a vendor-approved
  immutable registry digest before treating this as a production release gate.
  An isolated Cargo test pass never authorizes a public release.


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
5. Only after web PR #195 is non-draft, independently approved at its current
   exact commit and labeled `trusted-private-ci`, dispatch **Trusted reviewed
   web Cargo validation** with `ref=main`, `web_pr=195`, and the exact head
   SHA. Approval is explicit for that SHA; changed heads require a new dispatch.
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
