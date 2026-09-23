# Security and Continuity Posture

This is the operator- and auditor-facing summary of the controls the platform
implements, and the knobs that tune them. Every control here is enforced in
code and covered by a test in CI; this document points at where. It complements
the deeper audit and capacity records:

- [SECURITY-AUDIT-VEOC-37.md](./process/SECURITY-AUDIT-VEOC-37.md) — the adversarial audit.
- [CAPACITY-VEOC-38.md](./process/CAPACITY-VEOC-38.md) — load, latency, and headroom.
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
- The principal derived from a token is cached in process for up to
  `OPENEOC_PRINCIPAL_CACHE_MS`, keyed by the token's hash, and never past the
  access token's expiry or a guest grant's (`server/src/auth/principal-cache.ts`).
  Sign-out, resume, position sign-in and sign-out, provisioning and guest grant
  changes made through the API drop the affected entries at once. A change made
  directly in the database takes effect within the TTL. RLS reads the database
  on every query, so it never sees a cached role.

## Rate limiting and timeouts

- Per-email login backoff: five failures lock an email for thirty seconds
  (`server/src/auth/rate-limit.ts`). Failures are forgotten fifteen minutes
  after the last one, and the table holds at most 10,000 keys, shedding
  forgotten and then the stalest keys, so a spray of invented addresses cannot
  exhaust memory. Second-factor codes share the same backoff, keyed by person.
- A shared per-client flood limiter fronts the API
  (`server/src/security/rate-limit.ts`), with a high default ceiling so heavy
  legitimate operation is never throttled and only abuse is. Health probes and
  live WebSocket sessions are exempt. Its table holds at most 20,000 clients.
- Both limiters key on the client address. `X-Forwarded-For` is ignored unless
  the request comes from a peer named in `OPENEOC_TRUST_PROXY`, so a client
  cannot pick its own address.
- Request headers must arrive within 60 seconds (Node's `headersTimeout`, the
  slowloris defense), and a whole request within five minutes, long enough for
  a maximum-size upload over a slow field link. Neither affects established
  WebSocket sessions.
- Every WebSocket, whatever its route, must send its authentication frame
  within 10 seconds, may not send a frame over 1 MiB, answers a ping every 30
  seconds or is terminated, and is closed rather than buffered when more than
  16 MiB is queued for it, so one slow reader cannot hold memory or delay the
  others.

## One application node

Version 1 is declared single node: one API process against one PostgreSQL
database. The login backoff, the flood limiter, the principal cache and the
live sync hub all hold their state in that process, so a second node would
split the limits, serve a revoked session or role until its cache entry
expired, and miss live edits made on the other node. On one node, identity
changes made through the API apply on the next request. A shared store is a
1.x item. Details: [../deploy/README.md](../deploy/README.md), "One
application node".

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
- Backups: `deploy/backup.sh` writes a database dump and a matching archive of
  uploaded file blobs; `deploy/restore.sh` restores both. The two files share a
  timestamp and must be retained together. A database-only restore leaves file
  metadata pointing at missing bytes.
- Portability: `GET /api/v1/jurisdictions/:jurisdictionId/export` (admin) pulls
  the jurisdiction's operational record as plain JSON, a no-lock-in guarantee
  and a migration building block (`server/src/export/service.ts`).

## Configuration knobs

| Variable | Effect | Default |
|---|---|---|
| `OPENEOC_DATABASE_URL` | Owner connection (migrations, seeding). Required. | — |
| `OPENEOC_RUNTIME_URL` | `app_runtime` connection the app serves on; RLS applies. The server refuses to start without it, or on a role that bypasses RLS. | none |
| `OPENEOC_ALLOW_OWNER_RUNTIME` | `1` overrides that refusal for a single-user development server. | unset |
| `OPENEOC_SECRET_KEY` | Key for credential envelopes (IPAWS, collaboration, Jitsi, MFA, peer tokens); rotate with `rotate-secret-key`. | none |
| `OPENEOC_DATA_DIR` | Blob storage directory. | `./data/blobs` |
| `OPENEOC_MAX_UPLOAD_MB` / `OPENEOC_JURISDICTION_QUOTA_MB` | Largest single upload, and total stored file bytes per jurisdiction, in megabytes. | `25` / `10240` |
| `OPENEOC_RATELIMIT_MAX` | Flood-limiter ceiling per client per window; `0` disables. | `1200` |
| `OPENEOC_RATELIMIT_WINDOW_MS` | Flood-limiter window. | `10000` |
| `OPENEOC_TRUST_PROXY` | Reverse proxy addresses or CIDRs (comma-separated) whose `X-Forwarded-For` is trusted; `true` trusts every peer. | off |
| `OPENEOC_PRINCIPAL_CACHE_MS` | How long a request principal is cached; `0` disables. | `5000` |
| `OPENEOC_CORS_ORIGINS` | Comma-separated exact origins allowed cross-origin. | off |
| `OPENEOC_BASEMAP_STYLE_URL` | A deployment's own MapLibre style, replacing the bundled basemap. | bundled |
| `OPENEOC_OIDC_ISSUER` (+ client id/secret/redirect) | Enables OIDC sign-in. | off |

## What is deferred

Mutual-TLS peer hardening for federation is an infrastructure step recorded in
the audit and capacity documents. A shared store for the limiters and the
principal cache, which horizontal scaling needs, is a 1.x item; v1 runs one
application node.
