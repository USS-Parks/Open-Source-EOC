# Deploying Open Source EOC

Open Source EOC runs on Windows and macOS machines. The whole system of record
is one PostgreSQL database with PostGIS; the API is a Node service; the web
application is static files served by the same process. Nothing in the
running system needs the internet.

There is no Linux or Docker deployment. See
[ADR-0010](../docs/adr/ADR-0010-windows-and-macos.md).

## What is built today

| Machine | How it runs | Status |
|---|---|---|
| Windows workstation | The setup in [`windows/installer`](windows/installer/README.md) installs Node, PostgreSQL with PostGIS, the web application and the offline map archives for the signed-in user. The server listens on `127.0.0.1` only. | Built |
| Windows host | The same setup, installed for all users with **Host for the network**: PostgreSQL, the server and Caddy run as Windows services, and every other computer and phone on the network reaches the host over HTTPS with the host's own certificate authority. See the [network host guide](../docs/guides/NETWORK-HOST.md). | Built; the scripted check on a real install is Basho's to run |
| macOS workstation and host | The same, on a Mac | Not built yet |

The macOS work is scheduled in
[the readiness plan](../docs/process/READINESS-PSPR-2026-09-24.md).

The [Windows desktop guide](../docs/WINDOWS-DESKTOP.md) covers the launcher's
profiles, setup, start, stop and status from a source checkout, and the
[installer guide](windows/installer/README.md) covers building and installing
the setup.

## One application node

Version 1 runs as exactly one API process against one PostgreSQL database. Do
not run two API processes against one database. Several safeguards keep their
state in that process's memory:

- the login and second-factor backoff (`server/src/auth/rate-limit.ts`);
- the per-client flood limiter (`server/src/security/rate-limit.ts`);
- the principal cache (`server/src/auth/principal-cache.ts`), which keeps the
  identity, roles and position behind an access token for up to
  `OPENEOC_PRINCIPAL_CACHE_MS` (default 5000 ms, `0` turns it off);
- the live board sync hub, which relays an edit only to WebSocket clients
  connected to the same process.

With a second process, login guesses could be split between them, each would
grant its own flood ceiling, a sign-out or role change made on one would reach
the other only when its cached principal expired, and people connected to
different processes would not see each other's live edits. On the single
process, a sign-out, position change, membership grant or guest grant made
through the API takes effect on the next request. A change made directly in
the database, such as a role edited or a person disabled in `psql`, takes
effect within `OPENEOC_PRINCIPAL_CACHE_MS`. The scheduler elects its leader
through a PostgreSQL advisory lock and the delivery worker claims its work
with leases, so neither is what holds v1 to one process.

## Behind a reverse proxy

The limiters key on the client address. Behind a reverse proxy every request
arrives from the proxy, so all clients would share one flood allowance. Set
`OPENEOC_TRUST_PROXY` to the proxy's address, or a comma-separated list of
addresses and CIDR ranges, and the API takes the client address from
`X-Forwarded-For` on requests from those peers only. `true` trusts the header
from any peer; use it only when nothing but the proxy can reach the API. Leave
the variable unset when clients connect directly, or any client could name its
own address and step around the limiters.

## The two database identities

Migrations and the running application use different roles on purpose, so
row-level security is always the second wall:

- **Owner** (`OPENEOC_DATABASE_URL`) runs migrations and seeds the standard
  templates. The migrations create the `app_runtime` role.
- **Runtime** (`OPENEOC_RUNTIME_URL`) is `app_runtime`; the application runs
  on it and row-level security applies to every query.

The server refuses to start when `OPENEOC_RUNTIME_URL` is unset, and when the
role it names bypasses row-level security: a superuser, a role with
`BYPASSRLS`, or a role that owns a table with row-level security. The error
names the cause. The Windows launcher generates both passwords at setup, keeps
them in the profile's private `secrets` directory, and never prints them.
`OPENEOC_ALLOW_OWNER_RUNTIME=1` overrides the refusal for a single-user
development server from a source checkout and logs a warning at startup; the
installed application has no override.

## First jurisdiction and admin

A production profile's first setup asks for the first administrator's email,
display name and password and for the first jurisdiction, then creates that
person as the instance administrator and the jurisdiction with the standard
ICS positions. See [First setup](../docs/WINDOWS-DESKTOP.md#first-setup). The
server's `bootstrap` command does the same from a source checkout: it runs the
migrations first, reads the password from `OPENEOC_BOOTSTRAP_PASSWORD` or,
when that is unset, from standard input, never prints it, and needs at least
12 characters. Running it again once any instance administrator exists changes
nothing and exits 0. The administrator enrolls in two-step sign-in at the
first sign-in.

## Uploads

Files upload as `multipart/form-data`: the text fields `name`, and optionally
`attachedKind`, `attachedId` and `supersedes`, followed by one `file` part
whose own content type is the stored type. The bytes stream to disk while
their SHA-256 is computed; nothing holds a whole file in memory.

- `OPENEOC_MAX_UPLOAD_MB` (default 25) caps one file. A larger file is refused
  with 413 and nothing is kept.
- `OPENEOC_JURISDICTION_QUOTA_MB` (default 10240) caps the total size of every
  stored file version in one jurisdiction. An upload that would pass it is
  refused with 409 and a message giving the bytes in use. Two uploads that
  race for the last of the quota are checked one after the other, so only
  one can take it. Identical content is stored once on disk but counts
  against the quota each time it is uploaded.

## Outbound timeouts

Every outbound HTTP call carries a timeout: collaboration backends and peer
escalation 15 seconds, IPAWS-OPEN 30 seconds, webhook, push and federation
deliveries and feed polls 10 seconds, and OpenID Connect requests 30 seconds
(the client library's default). A call that times out fails; it is never
reported as delivered. None of these calls is made unless an administrator
configures the integration it belongs to.

## Rotating the secret key

The key encrypts stored credentials: TOTP secrets, the IPAWS credential,
collaboration and meeting secrets, and federation peer tokens. The
`rotate-secret-key` command re-encrypts all of them from the current key to a
new one in one transaction; if any value fails, nothing changes. On Windows
the key is the profile's `secrets/envelope.key`, and the steps are in
[the desktop guide](../docs/WINDOWS-DESKTOP.md#rotating-the-credential-key).

Signed audit export pages are keyed from the same key. Pages exported before a
rotation verify only with the old key, so record it with those exports if
they may need verifying later.

## Signing solution packages

A solution package carries board, incident, dashboard, report and rule
templates and forms in one signed file, and an instance imports it only when
it trusts the publisher's key. A publisher makes a key pair once and signs
each package with it; neither command needs a database or a connection:

```sh
node server/dist/main.js new-package-key --private publisher.key.pem --public publisher.pub.pem
node server/dist/main.js sign-package --key publisher.key.pem --in package.json --out package.signed.json
```

`new-package-key` refuses to overwrite either file. Keep the private key off
shared drives: whoever holds it can sign. `sign-package` checks the package
as an instance will, so a mistake is named before the file is shipped, and
prints the key's fingerprint. `package.json` holds `publisher`, `name`,
`version`, an optional `description`, and `contents` with any of
`boardTemplates`, `incidentTemplates`, `forms`, `dashboardTemplates`,
`reportTemplates` and `ruleTemplates`.

An instance trusts a publisher once the public key file is in the PEM bundle
`OPENEOC_TRUSTED_TEMPLATE_KEYS` names; the same bundle serves signed board
template packages. A Windows install reads the bundle from
`trusted-template-keys.pem` in its profile folder, when the variable is not
set otherwise: `%LOCALAPPDATA%\Open Source EOC\profiles\production` on a
single computer, `%ProgramData%\Open Source EOC\profiles\host` on a network
host. Copy the publisher's `.pub.pem` file there under that name (or append
it to the file already there) and restart Open Source EOC. The import is in the board designer's **Import** tab; see
[the designer guide](../docs/guides/DESIGNER.md#import-definitions).
`deploy/packs/` holds packages ready to sign: the
[small EOC starter pack](packs/small-eoc-starter/README.md) and the
[hotline and shelter registration pack](packs/hotline-and-shelter/README.md).

## Map archives

The street basemap, buildings, overlays, the North Coast imagery and
elevation, and the address search gazetteer are built by
[the basemap toolchain](../tools/basemap/README.md) and carried inside the
setup, so a machine with no network has the full map. The launcher configures
each archive it finds and leaves out any that is missing; the bundled
California basemap is always present.

## Air-gapped install

Nothing in the running system calls out: the API talks only to its own
PostgreSQL, the map, fonts and icons are served from local files, and no
update check, telemetry or tile fetch exists. The setup carries every runtime
it needs, so it installs on a machine that has never had a network
connection. A network host serves a building or a site over its own local
network, a switch or a Wi-Fi router with no internet line, with its own
certificate authority in place of a public one. The proof (a recorded run of
every connection the installed system makes, and a run with the network
unplugged) is scheduled in
[the readiness plan](../docs/process/READINESS-PSPR-2026-09-24.md).

## Backup and restore

On Windows, `-Action Backup -Profile production` dumps the running profile's
database and copies its file store into the profile's `backups` directory,
keeping 14 days by default. A network host runs the same backup for its
`host` or `host-demo` profile every day at 02:30 from its own scheduled task.
The
[disaster recovery runbook](../docs/guides/DISASTER-RECOVERY.md) covers the
recovery targets, the scheduled task, copies off the machine, restores and
the quarterly restore test.

## Scheduler

Every API process runs one scheduler. The process holding a PostgreSQL
advisory lock on the runtime database is the leader and the only one that runs
the scheduled jobs; the others retry the lock and one takes over when the
leader stops or loses its database session. No task or manual call is
needed.

| Job | Interval variable | Default |
|---|---|---|
| Scheduled notification rules | `OPENEOC_SCHEDULER_RULES_MS` | 30000 |
| Due briefings (only with the `meetings` integration) | `OPENEOC_SCHEDULER_BRIEFINGS_MS` | 60000 |
| Feed polls (each feed keeps its own poll interval) | `OPENEOC_SCHEDULER_FEEDS_MS` | 60000 |
| Outbound webhook, push and federation deliveries | `OPENEOC_SCHEDULER_OUTBOX_MS` | 2000 |
| Mass notification call-downs | `OPENEOC_SCHEDULER_CALLDOWNS_MS` | 30000 |
| Replies read from an SMS gateway on the site network | `OPENEOC_SCHEDULER_REPLIES_MS` | 30000 |
| Scheduled reports, run as each report's owner | `OPENEOC_SCHEDULER_REPORTS_MS` | 60000 |
| Retention purge (only classes a jurisdiction admin has given a period) | `OPENEOC_SCHEDULER_RETENTION_MS` | 3600000 |
| Audit forwarding to syslog (only with `OPENEOC_SYSLOG_URL`) | `OPENEOC_SCHEDULER_SYSLOG_MS` | 10000 |

`OPENEOC_SCHEDULER_LEADER_MS` (default 10000) sets how often a follower retries
the lock and the leader confirms it still holds it. Each job waits its interval
after a run finishes, so a run never overlaps itself; a failed run logs
`scheduled job failed` at `error` with the job name and the next run proceeds.
Scheduled rules and briefings run under an enabled admin of their
jurisdiction, preferring the author of the due item.

## Logs and metrics

The API writes one JSON line per event through Fastify's pino logger.
Authorization headers, cookies, peer tokens, passwords, tokens and secrets are
redacted before a line is written.

- **Level.** `OPENEOC_LOG_LEVEL` is one of `fatal`, `error`, `warn`, `info`,
  `debug`, `trace` or `silent`. The default is `info`, and `silent` under the
  test runner.
- **Request ids.** Every response carries an `x-request-id` header, and every
  line logged for that request carries the same value as `reqId`. An incoming
  `x-request-id` from a proxy is kept when it is 1 to 64 letters, digits,
  `.`, `_`, `:` or `-`; anything else is replaced with a new id.
- **Slow requests.** Each request logs one `request completed` line with its
  route, path, status and `durationMs`. A request slower than
  `OPENEOC_SLOW_REQUEST_MS` (default 1000) logs `slow request` at `warn`
  instead.
- **Failed deliveries.** The delivery worker logs `delivery retry scheduled`
  at `warn` and `delivery dead-lettered` at `error`, with the delivery id, the
  target origin (never the full URL), the attempt count and the error. A
  federation push that fails logs `federation push deferred`.

`GET /api/v1/metrics` serves Prometheus text format when
`OPENEOC_METRICS_TOKEN` is set, to a scraper that sends
`Authorization: Bearer <token>`. While the token is unset the route answers
404. It reports request counts by method, route pattern and status class, a
duration histogram, slow request counts by route, open WebSocket connections,
sync hub counters, delivery queue depth (pending and dead), undelivered
federation entries, delivery worker outcomes, whether the process is the
scheduler leader and when each scheduled job last ran, the database client's
configured maximum connections and the runtime role's open connections by
state.

To find a slow request, look for `openeoc_http_slow_requests_total` rising on a
route, then search the log for `"msg":"slow request"` on that route; its
`reqId` identifies the request. To find a failed delivery, look for
`openeoc_delivery_queue{status="dead"}` above zero, then search the log for
`"msg":"delivery dead-lettered"`; its `deliveryId` is the `delivery_outbox`
row.

On Windows the server writes `server.log` in the profile's `logs` directory and
rotates it at 10 MB, keeping `server.log.1` through `server.log.5`. `app.log`,
`app-error.log` and `postgres.log` hold console output, crash traces and
PostgreSQL messages; each is rotated the same way when the launcher starts the
process that writes it. Set `OPENEOC_METRICS_TOKEN` in the launcher's
environment to scrape the metrics.

## Upgrades

Installing a newer setup over an existing install keeps every profile's data:
the launcher runs the forward-only migrations on the next start, and
re-running them is a clean no-op. Upgrades preserve customization (INV-5),
proven by `server/src/__tests__/upgrade.test.ts`: customized boards keep their
local `x_` fields and all records, and a board template version upgrade
re-converges to the new template while keeping local fields and data. Back up
before upgrading.

The pre-1.0 migration history was consolidated into `0001_baseline.sql` on
2026-09-22 before any deployed instance existed. The runner deliberately
refuses that baseline when `schema_migrations` contains a retired 0001 through
0101 row. Do not erase or rename those receipts to force an upgrade. The
supported V1 upgrade path begins with a database whose first receipt is
`0001_baseline.sql`. New migrations continue at 0102.

The [upgrade guide](../docs/guides/UPGRADE.md) states what upgrades in place
and what does not, how to go back to the previous version, and the recorded
restore drill.

## Configuration reference

| Variable | Purpose |
|---|---|
| `OPENEOC_DATABASE_URL` | Owner connection: migrations and seeding |
| `OPENEOC_RUNTIME_URL` | `app_runtime` connection: the application under row-level security; required |
| `OPENEOC_ALLOW_OWNER_RUNTIME` | `1` lets a source-checkout development server run without row-level security; never in production |
| `OPENEOC_SECRET_KEY` | Server key for credential envelopes (IPAWS, collaboration, meetings, MFA secrets) and signed audit export |
| `OPENEOC_NEW_SECRET_KEY` | The new key, read only by `rotate-secret-key` |
| `OPENEOC_BOOTSTRAP_PASSWORD` | First admin's password, read only by `bootstrap` |
| `OPENEOC_MAX_UPLOAD_MB` / `OPENEOC_JURISDICTION_QUOTA_MB` | Upload limits; see [Uploads](#uploads) |
| `OPENEOC_REQUIRE_ADMIN_MFA` | Admins must enroll in two-step sign-in (default on; `0` turns it off) |
| `HOST` / `PORT` | API bind address for a source-checkout server (default `0.0.0.0:8080`); the Windows launcher binds `127.0.0.1` on the profile's port |
| `OPENEOC_LOG_LEVEL` | Log level (default `info`) |
| `OPENEOC_SLOW_REQUEST_MS` | Slow request threshold in milliseconds (default 1000) |
| `OPENEOC_METRICS_TOKEN` | Scrape token for `GET /api/v1/metrics`; unset serves 404 |
| `OPENEOC_TRUSTED_TEMPLATE_KEYS` | Path to a PEM file of publisher public keys, for signed board template packages and signed solution packages; packages from other publishers are refused, and unset refuses all. See [Signing solution packages](#signing-solution-packages) |
| `OPENEOC_SCHEDULER_*_MS` | Scheduler intervals; see [Scheduler](#scheduler) |
| `OPENEOC_TRUST_PROXY` | Reverse proxy addresses or CIDRs whose `X-Forwarded-For` is trusted, or `true`; unset trusts none |
| `OPENEOC_PRINCIPAL_CACHE_MS` | How long a request principal is cached, in milliseconds (default 5000; `0` turns it off) |
| `OPENEOC_PUBLIC_URL` | Address mass notification acknowledgement links point at, such as `https://eoc.example.org`; unset uses the address the sender reached the server on. See the [administrator guide](../docs/guides/ADMIN.md#contacts-and-mass-notification) |
| `OPENEOC_SYSLOG_URL` | Forward audit events to syslog, `udp://host:514` or `tcp://host:514`; unset is off. See the [administrator guide](../docs/guides/ADMIN.md#forward-the-audit-trail-to-syslog) |
| `OPENEOC_GAZETTEER_PATH` | Path to the offline address search file, read once at startup; unset or unreadable reports search unavailable and the server runs on. The Windows launcher sets it to the installed gazetteer. See [building the gazetteer](../tools/basemap/README.md#10-offline-address-search-gazetteer) |
