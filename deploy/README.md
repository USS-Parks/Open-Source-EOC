# Deploying OpenEOC (VEOC-40)

Single-node deployment for a county-IT skill level, including the air-gapped
path. The whole system of record is one PostgreSQL database; the API is a
Node service; the web bundle is static files.

## Quick start (connected)

```
cd deploy
./install.sh
```

`install.sh` checks Docker, generates secrets into `deploy/.env` on first run,
builds and starts [docker-compose.yml](./docker-compose.yml), and waits for the
database and API to answer. The API comes up on `http://localhost:8080`.

## The two database identities

Migrations and the running app use different roles on purpose, so Row-Level
Security is always the second wall:

- **Owner** (`OPENEOC_DATABASE_URL`) runs migrations and seeds the standard
  templates. The migrations create the `app_runtime` role.
- **Runtime** (`OPENEOC_RUNTIME_URL`) is `app_runtime`; the app runs on it and
  RLS applies to every query.

First boot: leave `OPENEOC_RUNTIME_URL` empty so the app can migrate and come
up on the owner connection (a warning is logged). Then set the `app_runtime`
password once:

```
docker compose exec db psql -U openeoc_owner -d openeoc \
  -c "alter role app_runtime login password 'a-strong-password'"
```

put its URL in `deploy/.env`:

```
OPENEOC_RUNTIME_URL=postgres://app_runtime:a-strong-password@db:5432/openeoc
```

and re-apply: `docker compose up -d`. From now on the app runs under RLS.

## The web bundle

```
pnpm --filter @openeoc/web build
```

Serve `web/dist` with any static host. The commented `web` service in
[docker-compose.yml](./docker-compose.yml) shows an nginx sidecar; point it at
the built `web/dist`.

## First incident

Create the first jurisdiction and admin (an instance bootstrap; do it once via
`psql` or the provisioning endpoint), sign in, activate an incident from a
scenario template, and you have a working EOC. The full scripted path is in the
VEOC-41 quickstart.

## Air-gapped install

Nothing in the running stack calls out: the API talks only to PostgreSQL, the
map basemap is served from local PMTiles, and there are no external tile or
font fetches at runtime. To install with networking disabled:

1. On a connected machine, pull and save the images:
   `docker save postgis/postgis:16-3.4 node:22-slim -o openeoc-images.tar`,
   and vendor the pnpm store (`pnpm fetch`) into the transfer bundle.
2. Move the bundle and the repository to the air-gapped host.
3. `docker load -o openeoc-images.tar`, then `./install.sh` with networking
   off. The build installs from the vendored store; no fetch leaves the host.
4. Provide the PMTiles basemap file locally and point the web config at it.

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

- **Docker.** Both services use the `json-file` driver with `max-size: 10m`
  and `max-file: 5`. Read the API log with `docker compose logs api`.
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

1. Back up first (`./backup.sh`).
2. Pull the new code and `docker compose up -d --build`. The API runs the
   forward-only migrations on boot; re-running them is a clean no-op.
3. Customized boards keep their local `x_` fields and all records; a board
   template version upgrade re-converges to the new template while keeping
   local fields and data.

## Configuration reference

| Variable | Purpose |
|---|---|
| `OPENEOC_DATABASE_URL` | Owner connection: migrations and seeding |
| `OPENEOC_RUNTIME_URL` | `app_runtime` connection: the app under RLS |
| `OPENEOC_SECRET_KEY` | Server key for credential envelopes (IPAWS, collab, Jitsi, MFA secrets) |
| `OPENEOC_REQUIRE_ADMIN_MFA` | Admins must enroll in two-step sign-in (default on; `0` turns it off) |
| `HOST` / `PORT` | API bind address (default `0.0.0.0:8080`) |
| `OPENEOC_LOG_LEVEL` | Log level (default `info`) |
| `OPENEOC_SLOW_REQUEST_MS` | Slow request threshold in milliseconds (default 1000) |
| `OPENEOC_METRICS_TOKEN` | Scrape token for `GET /api/v1/metrics`; unset serves 404 |
| `OPENEOC_SCHEDULER_*_MS` | Scheduler intervals; see [Scheduler](#scheduler) |
