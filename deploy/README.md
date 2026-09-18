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
./backup.sh              # writes ./backups/openeoc-<timestamp>.sql.gz
./restore.sh ./backups/openeoc-<timestamp>.sql.gz --yes-drop-and-restore
```

The dump is the whole database, which is the whole system of record. Keep
copies off the box. Restore is destructive and refuses to run without the
explicit confirmation flag.

## Upgrades

Upgrades preserve customization (INV-5), proven by
`server/src/__tests__/upgrade.test.ts`:

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
| `OPENEOC_SECRET_KEY` | Server key for credential envelopes (IPAWS, collab, Jitsi) |
| `HOST` / `PORT` | API bind address (default `0.0.0.0:8080`) |
