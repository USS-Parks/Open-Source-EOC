# Deploying OpenEOC (VEOC-40)

Single-node deployment for a county-IT skill level, including the air-gapped
path. The whole system of record is one PostgreSQL database; the API is a
Node service; the web bundle is static files.

## One-command install

On a Linux host with Docker Engine, the compose plugin, `curl` and
`sha256sum`, from the repository's `deploy` directory:

```
OPENEOC_DOMAIN=eoc.county.example \
OPENEOC_ACME_EMAIL=it@county.example \
OPENEOC_ADMIN_EMAIL=chief@county.example \
OPENEOC_ADMIN_NAME="County Chief" \
OPENEOC_JURISDICTION_SLUG=county-oes \
OPENEOC_JURISDICTION_NAME="County OES" \
OPENEOC_BASEMAP_URL=https://downloads.county.example/openeoc-basemap \
./install.sh
```

`install.sh` stops with a message naming the problem at the first step that
fails. In order, it:

1. checks for Docker, the compose plugin, a running daemon, `curl` and
   `sha256sum`;
2. on the first run, generates the database password, the `app_runtime`
   password and `OPENEOC_SECRET_KEY` into `deploy/.env` (mode 600); they are
   never printed;
3. records the host name and the certificate choice in `deploy/.env` (see
   [Certificates](#certificates));
4. fetches and checks the map archives (see [Map archives](#map-archives));
5. starts the database, sets the `app_runtime` password and builds the `api`
   and `web` images;
6. creates the first jurisdiction and administrator with the
   [bootstrap command](#first-jurisdiction-and-admin), unless an instance
   administrator already exists;
7. starts the stack and waits until `https://<OPENEOC_DOMAIN>/` serves the
   sign-in page and the API behind it answers, then prints the address.

The first administrator's password is generated, passed to the bootstrap
command through the environment, never printed, and written to
`deploy/admin-password.txt`, readable only by the account that ran the script.
Sign in with it, store it in the county's password manager, and delete the
file. The administrator enrolls in two-step sign-in at the first sign-in.

Running `./install.sh` again keeps the secrets, the certificate choice and the
verified archives, checks the archives again, and does not bootstrap again;
the administrator variables are then not needed. Values already in
`deploy/.env` win over the environment; edit the file to change them.

### The stack

| Service | Image | What it does |
|---|---|---|
| `db` | `postgis/postgis:16-3.4` | PostgreSQL and PostGIS, the system of record |
| `api` | `deploy/Dockerfile`, target `api`, on `node:22-slim` | The API on port 8080, published on the host's loopback only |
| `web` | `deploy/Dockerfile`, target `web`, on `caddy:2.10.0-alpine` | TLS on 443 and a redirect from 80; proxies `/api/`, WebSocket streams included, to `api`; serves the web bundle and the map archives |

The `web` image builds the bundle with `pnpm --filter @openeoc/web build` and
adds a `<script src="/runtime-config.js">` tag to its page, as the Windows
desktop host does. The API trusts `X-Forwarded-For` from private addresses
(`OPENEOC_TRUST_PROXY=uniquelocal`), because only Caddy on the compose network
and the host's loopback can reach it.

### Certificates

Choose one on the first run:

- **Automatic (ACME).** Set `OPENEOC_ACME_EMAIL`. `OPENEOC_DOMAIN` must resolve
  in public DNS to this host, and ports 80 and 443 must reach it from the
  internet. Caddy obtains and renews the certificate and keeps it in the
  `caddy-data` volume.
- **A supplied pair.** Set `OPENEOC_TLS_CERT` and `OPENEOC_TLS_KEY` to PEM files:
  the certificate with its chain, and its private key. The script copies them
  to `deploy/tls/`. This is the choice for an air-gapped host or a certificate
  from the county's own CA. To replace the pair, copy the new files over
  `deploy/tls/cert.pem` and `deploy/tls/key.pem` and run
  `docker compose restart web`.

Either way, HTTP on port 80 redirects to HTTPS.

### Map archives

The street basemap, buildings, overlays and the address search gazetteer
(built as in [the basemap toolchain](../tools/basemap/README.md)) are
published as release files beside a `SHA256SUMS` list in the format
`sha256sum` writes: `<sha256>  <file name>` per line. The names the stack
uses are `california.pmtiles`, `buildings.pmtiles`, `overlays.pmtiles`,
`overlays-manifest.json` and `gazetteer.tsv`.

- With `OPENEOC_BASEMAP_URL` set to the directory holding them, the script
  fetches `SHA256SUMS` and every file it lists that is not yet in
  `deploy/basemap/`. A download is checked before it is kept.
- Every listed file is checked against its SHA-256 on every run. A file that
  does not match stops the install; nothing is served from it.
- A `SHA256SUMS` already in `deploy/basemap/` is used as it is. The list
  fetched from the release protects against a damaged or cut-short download,
  not against a replaced release; to guard against that, copy a `SHA256SUMS`
  obtained from a trusted source into `deploy/basemap/` before the first run.
- No public release location exists yet, so there is no default. Without
  `OPENEOC_BASEMAP_URL` and without a `SHA256SUMS`, the map shows the bundled
  California basemap and address search reports unavailable.

The script writes `deploy/basemap/runtime-config.js`, which names only the
archives that passed their check. The API reads `gazetteer.tsv` from the same
directory.

### Caching

Caddy's `file_server` serves the static files with the same rules as the
Windows static host:

| Files | `Cache-Control` |
|---|---|
| The bundle's `/assets/`, named by content hash | `public, max-age=31536000, immutable` |
| Map archives, glyphs, the overlays manifest and other static files | `no-cache`, with `ETag` and `Last-Modified`; an unchanged file answers 304 |
| The page and `/runtime-config.js` | `no-store` |

Byte-range requests and `If-Range` are answered by `file_server`, and nothing
in the stack compresses these responses, so the map's range reads of the
archives work.

The service worker `sw.js` and `manifest.webmanifest` sit beside the page and
fall under the `no-cache` row, so browsers find a new build on their next
check. Browsers run a service worker only over HTTPS or from localhost.

### What has been verified

`deploy/install.test.mjs` runs `install.sh` against stand-ins for `docker` and
`curl`: the first run, a re-run, a checksum mismatch, the refusals and a
supplied pair. `deploy/upgrade.test.mjs` runs `upgrade.sh`, `backup.sh` and
`restore.sh` against the same kind of stand-ins. `docker compose config`
accepts the compose file. No image has
been built or pulled, Caddy has not loaded the Caddyfile, and no certificate
has been issued. The first real run on a Linux host is still to be done.

## One application node

Version 1 runs as exactly one API process against one PostgreSQL database. Do
not put two API containers behind a load balancer. Several safeguards keep
their state in that process's memory:

- the login and second-factor backoff (`server/src/auth/rate-limit.ts`);
- the per-client flood limiter (`server/src/security/rate-limit.ts`);
- the principal cache (`server/src/auth/principal-cache.ts`), which keeps the
  identity, roles and position behind an access token for up to
  `OPENEOC_PRINCIPAL_CACHE_MS` (default 5000 ms, `0` turns it off);
- the live board sync hub, which relays an edit only to WebSocket clients
  connected to the same process.

With a second node, login guesses could be split across nodes, each node would
grant its own flood ceiling, a sign-out or role change made on one node would
reach the other only when its cached principal expired, and people connected
to different nodes would not see each other's live edits. On the single node,
a sign-out, position change, membership grant or guest grant made through the
API takes effect on the next request. A change made directly in the database,
such as a role edited or a person disabled in `psql`, takes effect within
`OPENEOC_PRINCIPAL_CACHE_MS`. The scheduler elects its leader through a
PostgreSQL advisory lock and the delivery worker claims its work with leases,
so neither is what holds v1 to one node. A shared store for the limiters and
the principal cache is a 1.x item.

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

Migrations and the running app use different roles on purpose, so Row-Level
Security is always the second wall:

- **Owner** (`OPENEOC_DATABASE_URL`) runs migrations and seeds the standard
  templates. The migrations create the `app_runtime` role.
- **Runtime** (`OPENEOC_RUNTIME_URL`) is `app_runtime`; the app runs on it and
  RLS applies to every query.

The server refuses to start when `OPENEOC_RUNTIME_URL` is unset, and when the
role it names bypasses RLS: a superuser, a role with `BYPASSRLS`, or a role
that owns a table with row-level security. The error names the cause.
`OPENEOC_ALLOW_OWNER_RUNTIME=1` overrides the refusal for a single-user
development server and logs a warning at startup; never set it in production.

`install.sh` generates the `app_runtime` password, creates the role with it
before the first migration, and writes `OPENEOC_RUNTIME_URL` to `deploy/.env`.
An `.env` from an earlier install with an empty `OPENEOC_RUNTIME_URL` gains the
password and URL on the next run. To set it by hand instead:

```
docker compose exec db psql -U openeoc_owner -d openeoc \
  -c "alter role app_runtime login password 'a-strong-password'"
```

then put its URL in `deploy/.env` and re-apply with `docker compose up -d`:

```
OPENEOC_RUNTIME_URL=postgres://app_runtime:a-strong-password@db:5432/openeoc
```

## The web bundle

```
pnpm --filter @openeoc/web build
```

The compose stack's `web` image does this itself. To serve `web/dist` from
another static host instead, add the `runtime-config.js` script tag to its
page, serve that file, and apply the rules under [Caching](#caching).

## First jurisdiction and admin

`install.sh` runs this step on the first install. To run it by hand:
the `bootstrap` command creates the instance administrator and the first
jurisdiction, with that person as its admin and the standard ICS positions.
It runs the migrations first, reads the password from
`OPENEOC_BOOTSTRAP_PASSWORD` or, when that is unset, from standard input, and
never prints it. The password needs at least 12 characters.

```
read -rs OPENEOC_BOOTSTRAP_PASSWORD && export OPENEOC_BOOTSTRAP_PASSWORD
docker compose run --rm -e OPENEOC_BOOTSTRAP_PASSWORD api \
  tsx server/src/main.ts bootstrap \
  --admin-email=chief@county.example --admin-name="County Chief" \
  --jurisdiction-slug=county-oes --jurisdiction-name="County OES"
unset OPENEOC_BOOTSTRAP_PASSWORD
```

Running it again once any instance administrator exists changes nothing and
exits 0. The administrator enrolls in two-step sign-in at first sign-in. Then
activate an incident from a scenario template and you have a working EOC.

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
reported as delivered.

## Rotating the secret key

`OPENEOC_SECRET_KEY` encrypts stored credentials: TOTP secrets, the IPAWS
credential, collaboration and meeting secrets, and federation peer tokens. The
`rotate-secret-key` command re-encrypts all of them from the current key to a
new one in one transaction. Each value is decrypted with the current key and
the new value is checked before it is written; if any value fails, nothing
changes. It prints the count per table.

1. Back up first (`./backup.sh`), and keep the current key until the new one
   is confirmed.
2. Stop the API: `docker compose stop api`.
3. Run the rotation with the new key:

   ```
   new_key="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 44)"
   docker compose run --rm -e OPENEOC_NEW_SECRET_KEY="$new_key" api \
     tsx server/src/main.ts rotate-secret-key
   ```

4. Replace `OPENEOC_SECRET_KEY` in `deploy/.env` with the new key.
5. Start the API: `docker compose up -d`.

Signed audit export pages are keyed from `OPENEOC_SECRET_KEY`. Pages exported
before a rotation verify only with the old key, so record it with those
exports if they may need verifying later. On the Windows desktop the key is
the profile's `secrets/envelope.key`; see
[the desktop guide](../docs/WINDOWS-DESKTOP.md#rotating-the-credential-key).

## Air-gapped install

Nothing in the running stack calls out: the API talks only to PostgreSQL, the
map basemap is served from local PMTiles, and there are no external tile or
font fetches at runtime. The one exception is Caddy's certificate requests
when an ACME email is chosen. To install with networking disabled:

1. On a connected machine, pull and save the images:
   `docker save postgis/postgis:16-3.4 node:22-slim caddy:2.10.0-alpine -o openeoc-images.tar`,
   and vendor the pnpm store (`pnpm fetch`) into the transfer bundle.
2. Move the bundle and the repository to the air-gapped host, with the map
   archives and their `SHA256SUMS` copied into `deploy/basemap/`.
3. `docker load -o openeoc-images.tar`, then `./install.sh` with networking
   off, a supplied certificate pair and no `OPENEOC_BASEMAP_URL`. The build
   installs from the vendored store, the archives are checked in place, and
   no fetch leaves the host.

The install is designed to reach a working demo incident in well under an hour
on a clean machine.

## Backup and restore

```
./backup.sh              # writes a database dump and matching blob archive
./restore.sh ./backups/openeoc-<timestamp>.sql.gz --yes-drop-and-restore
```

Each backup consists of `openeoc-<timestamp>.sql.gz` and the matching
`openeoc-<timestamp>.blobs.tar.gz`. Keep both files together and off the box.
The database holds file metadata; the blob archive holds the uploaded bytes.
Restore is destructive to the database and refuses to run without the explicit
confirmation flag. If the matching blob archive is absent, restore warns and
file downloads remain unavailable until those bytes are recovered.

Both files are written readable only by the account that ran the script, each
under a `.part` name until its command succeeds, so a failed run leaves no file
that looks like a backup. Restore reads the whole dump first and refuses one
that did not run to the end; it then drops the schema and replays the dump in
one transaction, so an error leaves the database as it was.

### Scheduled backups

```
sudo ./schedule-backup.sh   # daily at 02:30, as the owner of deploy/.env, keeping 14 days
```

It installs `openeoc-backup.service`, which runs `backup.sh`, and a
persistent `openeoc-backup.timer`, then takes one backup through the service
so a schedule that cannot work fails at once. `OPENEOC_BACKUP_SCHEDULE`,
`OPENEOC_BACKUP_KEEP_DAYS` and `OPENEOC_BACKUP_USER` change the time, the days
kept and the account. After both of its files are complete, `backup.sh`
removes its own backups older than `OPENEOC_BACKUP_KEEP_DAYS` (default 14); a
failed run removes nothing. The
[disaster recovery runbook](../docs/guides/DISASTER-RECOVERY.md) covers the
recovery targets, the Windows desktop's `Backup` action, copies off the host,
restores and the quarterly restore test.

`deploy/upgrade.test.mjs` runs the retention, and `schedule-backup.sh` against
a `systemctl` stand-in that runs the unit's command. No real systemd has run
the timer yet.

## Scheduler

Every API process runs one scheduler, in both the Docker and the Windows
desktop deployments. The process holding a PostgreSQL advisory lock on the
runtime database is the leader and the only one that runs the scheduled jobs;
the others retry the lock and one takes over when the leader stops or loses
its database session. No cron job or manual call is needed.

| Job | Interval variable | Default |
|---|---|---|
| Scheduled notification rules | `OPENEOC_SCHEDULER_RULES_MS` | 30000 |
| Due briefings (only with the `meetings` integration) | `OPENEOC_SCHEDULER_BRIEFINGS_MS` | 60000 |
| Feed polls (each feed keeps its own poll interval) | `OPENEOC_SCHEDULER_FEEDS_MS` | 60000 |
| Outbound webhook, push and federation deliveries | `OPENEOC_SCHEDULER_OUTBOX_MS` | 2000 |
| Mass notification call-downs | `OPENEOC_SCHEDULER_CALLDOWNS_MS` | 30000 |
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

Rotation:

- **Docker.** All three services use the `json-file` driver with
  `max-size: 10m` and `max-file: 5`. Read the API log with
  `docker compose logs api` and Caddy's with `docker compose logs web`.
- **Windows desktop.** The server writes `server.log` in the profile's `logs`
  directory and rotates it at 10 MB, keeping `server.log.1` through
  `server.log.5`. `app.log`, `app-error.log` and `postgres.log` hold console
  output, crash traces and PostgreSQL messages; each is rotated the same way
  when the launcher starts the process that writes it. The desktop app listens
  on loopback only; set `OPENEOC_METRICS_TOKEN` in the environment of the
  launcher to scrape it.

## Upgrades

Upgrades preserve customization (INV-5), proven by
`server/src/__tests__/upgrade.test.ts`:

The pre-1.0 migration history was consolidated into `0001_baseline.sql` on
2026-09-22 before any deployed instance existed. The runner deliberately
refuses that baseline when `schema_migrations` contains a retired 0001 through
0101 row. Do not erase or rename those receipts to force an upgrade. Preserve
the database and use the source version that created it; the supported V1
upgrade path begins with a database whose first receipt is
`0001_baseline.sql`. New migrations continue at 0102.

1. Put the new release in the repository checkout.
2. Run `./upgrade.sh`. It takes a backup with `backup.sh` first and stops,
   changing nothing, unless the dump is complete and the file archive
   readable; no switch skips it. It then builds the images, runs
   `docker compose up -d`, waits for the API to report ready, and prints the
   old and new versions and the backup to go back to. The API runs the
   forward-only migrations on boot; re-running them is a clean no-op. An
   install made before the HTTPS front end has no `OPENEOC_DOMAIN` or
   `OPENEOC_TLS` in `deploy/.env`, and compose refuses every command until
   they are there: run `./install.sh` once with a host name and a
   certificate choice first.
3. Customized boards keep their local `x_` fields and all records; a board
   template version upgrade re-converges to the new template while keeping
   local fields and data.

The [upgrade guide](../docs/guides/UPGRADE.md) states what upgrades in place
and what does not, how to go back to the previous version, and the recorded
restore drill.

## Configuration reference

| Variable | Purpose |
|---|---|
| `OPENEOC_DATABASE_URL` | Owner connection: migrations and seeding |
| `OPENEOC_RUNTIME_URL` | `app_runtime` connection: the app under RLS; required |
| `OPENEOC_ALLOW_OWNER_RUNTIME` | `1` lets a development server run without RLS; never in production |
| `OPENEOC_SECRET_KEY` | Server key for credential envelopes (IPAWS, collab, Jitsi, MFA secrets) and signed audit export |
| `OPENEOC_NEW_SECRET_KEY` | The new key, read only by `rotate-secret-key` |
| `OPENEOC_BOOTSTRAP_PASSWORD` | First admin's password, read only by `bootstrap` |
| `OPENEOC_MAX_UPLOAD_MB` / `OPENEOC_JURISDICTION_QUOTA_MB` | Upload limits; see [Uploads](#uploads) |
| `OPENEOC_REQUIRE_ADMIN_MFA` | Admins must enroll in two-step sign-in (default on; `0` turns it off) |
| `HOST` / `PORT` | API bind address (default `0.0.0.0:8080`) |
| `OPENEOC_LOG_LEVEL` | Log level (default `info`) |
| `OPENEOC_SLOW_REQUEST_MS` | Slow request threshold in milliseconds (default 1000) |
| `OPENEOC_METRICS_TOKEN` | Scrape token for `GET /api/v1/metrics`; unset serves 404 |
| `OPENEOC_TRUSTED_TEMPLATE_KEYS` | Path to a PEM file of template publisher public keys; signed template packages from other publishers are refused, and unset refuses all |
| `OPENEOC_SCHEDULER_*_MS` | Scheduler intervals; see [Scheduler](#scheduler) |
| `OPENEOC_TRUST_PROXY` | Reverse proxy addresses or CIDRs whose `X-Forwarded-For` is trusted, or `true`; unset trusts none |
| `OPENEOC_PRINCIPAL_CACHE_MS` | How long a request principal is cached, in milliseconds (default 5000; `0` turns it off) |
| `OPENEOC_PUBLIC_URL` | Address mass notification acknowledgement links point at, such as `https://eoc.example.org`; unset uses the address the sender reached the server on. See the [administrator guide](../docs/guides/ADMIN.md#contacts-and-mass-notification) |
| `OPENEOC_SYSLOG_URL` | Forward audit events to syslog, `udp://host:514` or `tcp://host:514`; unset is off. See the [administrator guide](../docs/guides/ADMIN.md#forward-the-audit-trail-to-syslog) |
| `OPENEOC_GAZETTEER_PATH` | Path to the offline address search file, read once at startup; unset or unreadable reports search unavailable and the server runs on. The compose stack sets `/basemap/gazetteer.tsv`. See [building the gazetteer](../tools/basemap/README.md#10-offline-address-search-gazetteer) |
| `OPENEOC_DOMAIN` | The host name Caddy serves and certifies; required by compose, written to `deploy/.env` by `install.sh` |
| `OPENEOC_TLS` | Caddy's `tls` argument: an ACME email, or the container paths of a supplied pair; written by `install.sh` from the next two rows |
| `OPENEOC_ACME_EMAIL` | `install.sh` only: request an automatic certificate with this ACME account email. See [Certificates](#certificates) |
| `OPENEOC_TLS_CERT` / `OPENEOC_TLS_KEY` | `install.sh` only: PEM certificate (with chain) and key to use instead of ACME |
| `OPENEOC_BASEMAP_URL` | `install.sh` only: directory URL of the map archive release and its `SHA256SUMS`; no default. See [Map archives](#map-archives) |
| `OPENEOC_ADMIN_EMAIL` / `OPENEOC_ADMIN_NAME` | `install.sh` only: the first administrator, needed until one exists |
| `OPENEOC_JURISDICTION_SLUG` / `OPENEOC_JURISDICTION_NAME` | `install.sh` only: the first jurisdiction, needed until an administrator exists |
