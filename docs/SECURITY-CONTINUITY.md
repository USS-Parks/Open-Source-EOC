# Security and Continuity Posture

This is the operator- and auditor-facing summary of the controls the platform
implements, and the knobs that tune them. Every control here is enforced in
code and covered by a test in CI; this document points at where. It complements
the deeper audit and capacity records:

- [SECURITY-AUDIT-VEOC-37.md](./SECURITY-AUDIT-VEOC-37.md) — the adversarial audit.
- [CAPACITY-VEOC-38.md](./CAPACITY-VEOC-38.md) — load, latency, and headroom.
- [../deploy/README.md](../deploy/README.md) — deployment, backup, and restore.

## Transport and response headers

Every API response carries hardening headers (`server/src/security/headers.ts`):
`x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy:
no-referrer`, `cross-origin-resource-policy: same-origin`,
`cross-origin-opener-policy: same-origin`, a `permissions-policy` denying
geolocation, camera, and microphone, and `strict-transport-security`. The data
API serves no document, so its `content-security-policy` is the strictest
possible (`default-src 'none'`). These ride error responses as well as
successes (`server/src/__tests__/security-headers.test.ts`).

The browser client is served by its own static host, which must set a document
CSP. A safe starting point, given the app's inline styles and MapLibre's blob
workers: `default-src 'self'; script-src 'self'; worker-src 'self' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src
'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`.

## Authentication and authorization

- Bearer tokens only; the token is the sole caller input trusted, and identity,
  roles, and position come from the database (INV-7). Access tokens live 15
  minutes and are renewed against a resume token, transparently to the client.
- Row-Level Security is a second wall behind every application check: the app
  normally runs on the `app_runtime` role, so a missed check in code still
  cannot cross a jurisdiction boundary.
- Roles are per-jurisdiction (`admin`, `member`, `viewer`); viewers are
  structurally read-only and never metered (INV-1). Time-boxed, scope-limited
  guest grants allow narrow cross-jurisdiction reads.

## Rate limiting and timeouts

- Per-email login backoff: five consecutive failures lock an email for thirty
  seconds (`server/src/auth/rate-limit.ts`).
- A shared per-client flood limiter fronts the API
  (`server/src/security/rate-limit.ts`), with a high default ceiling so heavy
  legitimate operation is never throttled and only abuse is. Health probes and
  live WebSocket sessions are exempt.
- A 30-second request timeout caps unfinished requests (slowloris defense)
  without affecting established WebSocket sessions.

## Audit and integrity

Every mutation records an attributed audit event, and `audit_events` is
append-only: `UPDATE` and `DELETE` are rejected by a trigger and by a revoked
grant, proven in the security suite. Attribution is total (INV-2).

## Health, readiness, and continuity

- `GET /api/v1/health` (liveness) and `GET /api/v1/ready` (database reachable)
  serve load balancers and orchestration; both are unauthenticated and exempt
  from the flood limiter.
- The field client operates offline and syncs on reconnect; federation is
  store-and-forward. Disconnection is the normal case (INV-3).
- Backups: `deploy/backup.sh` and `deploy/restore.sh` cover the full database.
- Portability: `GET /api/v1/jurisdictions/:jurisdictionId/export` (admin) pulls
  the jurisdiction's operational record as plain JSON, a no-lock-in guarantee
  and a migration building block (`server/src/export/service.ts`).

## Configuration knobs

| Variable | Effect | Default |
|---|---|---|
| `OPENEOC_DATABASE_URL` | Owner connection (migrations, seeding). Required. | — |
| `OPENEOC_RUNTIME_URL` | `app_runtime` connection the app serves on; RLS applies. | owner URL |
| `OPENEOC_SECRET_KEY` | Key for credential envelopes (IPAWS, collaboration, Jitsi). | — |
| `OPENEOC_DATA_DIR` | Blob storage directory. | `./data/blobs` |
| `OPENEOC_RATELIMIT_MAX` | Flood-limiter ceiling per client per window; `0` disables. | `1200` |
| `OPENEOC_RATELIMIT_WINDOW_MS` | Flood-limiter window. | `10000` |
| `OPENEOC_CORS_ORIGINS` | Comma-separated exact origins allowed cross-origin. | off |
| `OPENEOC_BASEMAP_STYLE_URL` | A deployment's own MapLibre style, replacing the bundled basemap. | bundled |
| `OPENEOC_OIDC_ISSUER` (+ client id/secret/redirect) | Enables OIDC sign-in. | off |

## What is deferred

Mutual-TLS peer hardening for federation and a shared rate-limit store for
horizontal scaling are infrastructure steps recorded in the audit and capacity
documents; they are out of band for a single instance.
