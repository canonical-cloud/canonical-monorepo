# Canonical quote-stack certification

Certification record for the authenticated `canonical.plus` quote stack as of
August 8, 2026.

## Exact source pins

| Component | Reviewed source |
| --- | --- |
| Browser web boundary | `canonical-web-server.rs@dcb979956a247f35a8470280717d0750109f2320` |
| Durable quote API | `canonical-api-server.rs@26967bed96b1b48ea846c3fd418018ea40f4b9e1` |
| Public quote contracts | the existing monorepo interface gitlink, a reviewed descendant of golden-fixture merge `c4944fcb1a35fae99a76897a0fedf37263fd11ad` |
| Declarative PostgreSQL tool | `declarative-postgres-migrate.rs@d05a7880987ddaa271fa88b52c787390ef12b899` |

The web pin delegates signed-in quote analysis to the dedicated API while
retaining origin-side Shared Auth verification, CSRF, and verified-subject
projection. The API pin contains the dedicated PostgreSQL namespace and
least-privilege role contract.

## PostgreSQL certification

The declarative source SHA-256 is:

```text
1933121f6db97e53ea6b51ef3dcf63c77c717839a92281086be454874e41da4a
```

The exact API source passed:

- Rust formatting, strict Clippy, and all-target/all-feature tests;
- distroless non-root container build and health smoke;
- PostgreSQL 17 schema bootstrap and `dpm` shadow replay;
- migrator/API/web role and object-ownership checks;
- forced RLS and owner isolation;
- forged-owner rejection;
- rejection of web reads and API DDL;
- idempotent replay and row preservation;
- out-of-band drift detection;
- destructive-change refusal without explicit consent; and
- consented remediation followed by an empty final diff.

Independent test-organization evidence:

- `declarative-migrations-test/postgres-forward-rollback` merge
  `b0e84a1ec2051319c3d6f89ed8edc606047f0118`;
- `declarative-migrations-test/schema-drift-detection` merge
  `a6db236618763fc3645e4d41c77f8c51ebde4124`.

The second lane retained its PostgreSQL/CockroachDB unauthorized-drift suite in
addition to running the exact Canonical PostgreSQL 17 contract.

`canonical-cloud-test` did not resolve through the connected GitHub
installation, so it was not silently replaced by an ambiguous owner. The
purpose-built `declarative-migrations-test` organization provided the available
isolated certification boundary.

## Published API image

The API repository published the merged commit as an immutable GHCR image:

```text
source: canonical-api-server.rs@26967bed96b1b48ea846c3fd418018ea40f4b9e1
image digest: sha256:788f51365a7d97ba0d6368e9c7ab2939d03d7cd2582bd22bd485473b53766e68
```

GitOps promotion must use this digest rather than a mutable tag.

## Semantic web-pin reconciliation

The prior superproject web pin diverged from current reviewed web `main` by one
stale uppercase `AGENTS.md` duplication. Its merge base was the previously
reviewed quote-web pin. Current web `main` contains the functional API cutover
and the canonical lowercase-instructions hierarchy; advancing to it discards no
unique application behavior from the old pin. The monorepo also converts its
own uppercase entrypoint into the same pointer arrangement.

## Activation boundary

This certification authorizes source integration only. It does not prove or
change the production database, legacy `public`-schema state, backups, secrets,
Supabase project, Kubernetes cluster, Cloudflare account/zone/Worker/routes,
DNS, TLS, or R2 resources. Those targets require exact authenticated inventory
and separate reviewed activation gates before any write.
