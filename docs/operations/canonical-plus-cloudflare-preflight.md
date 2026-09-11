# Canonical Plus Cloudflare preflight

This repository owns a one-time, read-only inventory for the Canonical Plus
edge. The workflow exists because the permanent `canonical-cloud/canonical-infra`
repository has not yet been provisioned. It must not deploy or mutate Cloudflare.

## Exact reviewed target

- zone name: `canonical.plus`
- Worker script: `canonical-plus-auth-edge`
- Worker environment: Wrangler's top-level/default production environment
- routes:
  - `app.canonical.plus/u/*`
  - `app.canonical.plus/api/v1/quotes*`
  - `app.canonical.plus/ws/quotes*`
- DNS names inspected independently:
  - `app.canonical.plus`
  - `api.canonical.plus`

The reviewed Worker configuration declares no R2 binding. The preflight therefore
does not accept R2 credentials, call an R2 endpoint, enumerate buckets, or infer a
bucket name. A future R2 requirement must first add an exact bucket binding to the
reviewed desired state.

## Safety contract

The workflow:

1. accepts the Cloudflare account ID and API token only through a run-specific
   RSA-4096 OAEP/SHA-256 handoff;
2. compares the account ID to the reviewed SHA-256 digest before making any API
   request;
3. verifies the token is active;
4. resolves the account directly and requires an exact ID match;
5. resolves exactly one zone named `canonical.plus` belonging to that account;
6. inventories the exact Worker script, exact route patterns, and only the two
   Canonical DNS names;
7. fails if an exact route is already owned by a different Worker or if an exact
   DNS name is ambiguous;
8. exposes no Cloudflare POST, PUT, PATCH, or DELETE method;
9. redacts account, zone, token, route, DNS-record, and origin identifiers from
   uploaded evidence; and
10. removes the ephemeral public-key and ciphertext files from GitHub after the
    bundle is consumed.

The evidence always states `cloudflare_write_performed=false`. Missing resources
are reported as activation blockers rather than created automatically.

## Activation boundary

A later deployment may write only after this preflight proves the exact account
and zone and a reviewed infrastructure change supplies:

- the exact Worker source digest and deployment command;
- the exact route create/update plan;
- the exact DNS record type and reviewed origin target;
- origin health and TLS evidence;
- confirmation that no R2 binding is required, or an explicit reviewed bucket
  name and binding if that changes.

Never use this workflow for another account, zone, domain, Worker, route, DNS
record, bucket, or environment.
