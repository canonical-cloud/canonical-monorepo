# Canonical Cloud project tracking

This document defines how Canonical Cloud uses Linear, GitHub issues and pull
requests, and the organization GitHub Project without hard-coding workspace- or
project-specific identifiers into source control.

## System of record

- **Linear** owns product intent, priority, sequencing, acceptance criteria, and
  cross-repository initiatives.
- **GitHub issues** own repository-local implementation work when a durable code
  discussion, security record, or community-visible task is useful.
- **Pull requests and checks** own the exact code change, review evidence, and
  merge state.
- **The canonical-cloud organization GitHub Project** is the delivery portfolio:
  it combines Linear links, repository issues, pull requests, releases, and
  deployment readiness across the organization.

Do not copy full requirements into every system. Link the records and keep each
system authoritative for its own concern.

## Repository ownership

| Repository | Delivery responsibility |
| --- | --- |
| `canonical-monorepo` | cross-app integration, exact submodule pins, all-up CI, release boundaries, and GitOps handoff |
| `canonical-api-server.rs` | `api.canonical.plus` REST/WebSocket, persistence, owner isolation, and model orchestration |
| `canonical-web-server.rs` | `app.canonical.plus` HTML/HTMX, sessions, offline sync, and revocation worker |
| `canonical-marketing-site.web` | public marketing and authenticated quote entry links |
| `canonical-interfaces` | generated wire and database contracts |
| `canonical-lib` | reusable domain validation and context assembly |
| `canonical-clients` | language-specific transport clients |
| `canonical-cli` | operator and customer command-line workflows |
| `canonical-mcp-server.rs` | agent-facing diagnostics and organization operations |
| `canonical.cloud` | superseded read-only compatibility mirror; no new planning items |

## Linking convention

When a Linear issue exists, include its key in the pull-request body and, when
practical, the branch name or title. A repository issue should link the Linear
issue instead of duplicating its roadmap discussion. The GitHub Project item
should link both records and automatically surface the associated pull request.

Recommended pull-request section:

```markdown
## Tracking

- Linear: CAN-123
- GitHub issue: #456
- GitHub Project: Canonical Cloud / Quote Platform
```

Omit unavailable rows rather than inventing identifiers.

## Status mapping

| Linear | GitHub Project | Code signal |
| --- | --- | --- |
| Triage / Backlog | Backlog | no implementation branch |
| Ready | Ready | acceptance criteria and owner assigned |
| In Progress | In progress | branch or draft pull request exists |
| In Review | In review | non-draft pull request with required checks running |
| Blocked | Blocked | blocker and next decision recorded |
| Done | Done | merged and, when applicable, deployed or explicitly release-ready |
| Canceled | Canceled | closed with rationale; no silent deletion |

Pull-request state should update the GitHub Project automatically. Linear
priority and product status should not be overwritten solely because a branch
or pull request exists.

## GitHub Project fields

Use organization-level fields consistently:

- Status
- Owning repository
- Workstream
- Linear issue
- Pull request
- Target milestone or release
- Risk / blocker
- Deployment state

Store GitHub Project, Linear workspace, and team identifiers in organization or
repository variables used by automation. Never commit API tokens, project IDs,
webhook secrets, or service-account credentials.

## Review cadence

During the weekly Canonical operating review:

1. reconcile blocked and in-review items between Linear and the GitHub Project;
2. verify every active item has one owning repository and one accountable owner;
3. review cross-repository changes in `canonical-monorepo` only after component
   CI is green and exact component commits are pinned;
4. close stale duplicate issues rather than maintaining parallel task copies;
5. record deployment readiness separately from code merge state.

Automation should be idempotent, preserve manual notes, and fail closed when a
Linear or GitHub Project identifier is missing or ambiguous.
