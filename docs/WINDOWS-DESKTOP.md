# Windows desktop setup

This launcher runs Open Source EOC as a local Windows application from the current checkout. It uses only dependencies and assets already present on the computer. It does not use Docker, Electron, an installer service, an online registry, or an external API.

## Local prerequisites

The checkout must already contain:

- Node.js 24 and pnpm from the approved local toolchain;
- the installed workspace dependencies, including TypeScript and Vite;
- PostgreSQL 16.15 with PostGIS 3.6.2 at `deploy/test-runtime/out/pgsql` or the directory named by `OPENEOC_PG_DIST`;
- the bundled map and fonts under `web/public`;
- Chrome or Edge only when an application window is requested.

The PostgreSQL binaries, package store, browser, and ignored large map assets are referenced in place. They are not copied into `deploy/windows/out`.

## Profiles

The source launcher accepts two operator profiles. Their data never shares a database cluster, blob directory, browser profile, secret file, log, or PID file.

| Profile | Purpose | PostgreSQL | HTTP | Database |
|---|---|---:|---:|---|
| `production` | Persistent operator data | 55440 | 8080 | `openeoc` |
| `demo` | Clearly labeled synthetic demonstration | 55441 | 8081 | `openeoc_demo` |

The project test harness can additionally expose an isolated synthetic
`acceptance` profile on PostgreSQL 55442, HTTP 8082 and database
`openeoc_acceptance` by setting `OPENEOC_ENABLE_ACCEPTANCE_PROFILE=1` in a
source checkout. The shipped installer does not expose or accept that profile.

Ports can be changed during first setup with `-PgPort` and `-HttpPort`. The launcher rejects privileged, duplicate, or occupied ports. A configured profile keeps its original ports.

Each profile is stored below `deploy/windows/out/profiles/<profile>/`:

- `pgdata` contains that profile's PostgreSQL cluster;
- `blobs` contains file attachments;
- `secrets` contains generated owner and `app_runtime` passwords with inheritance removed and access limited to the current Windows identity;
- `browser` is the Chrome or Edge user data directory;
- `logs` contains PostgreSQL and application logs;
- `run` contains private PID ownership records.

Do not copy secret files into tickets or logs. No command prints a generated password.

## Build the current interface

From the repository root:

```powershell
.\deploy\windows\Open-Source-EOC.ps1 -Action Build
```

The build uses Vite with `publicDir: false`, so it does not duplicate the large local basemap collection. Static assets continue to be served from the checkout's validated `web/public` path. The build writes a content hash and Git revision to `deploy/windows/out/build/build-stamp.json`.

Start refuses a stale build when a web or shared source input changes. A docs-only commit does not force a rebuild. Run the Build command again after an interface or shared-source change.

## First setup

Build once before creating a profile.

For a synthetic demo:

```powershell
.\deploy\windows\Open-Source-EOC.ps1 -Action Setup -Profile demo
```

For the isolated acceptance profile:

```powershell
$env:OPENEOC_ENABLE_ACCEPTANCE_PROFILE = '1'
.\deploy\windows\Open-Source-EOC.ps1 -Action Setup -Profile acceptance
```

Both synthetic profiles use `ensureDemoData`. Their demonstration administrator is `demo-admin@example.org` with password `correct-horse-battery`. Never use either profile for real incident information.

For production:

```powershell
.\deploy\windows\Open-Source-EOC.ps1 -Action Setup -Profile production
```

PowerShell prompts for the first administrator email, display name, jurisdiction slug, jurisdiction name, and a password of at least 12 characters. The password is masked, passed only to the setup child process, removed from the environment, and never stored by the launcher. Setup creates the person, marks that person as the instance administrator, and provisions the first jurisdiction with the standard ICS positions.

Setup is idempotent for a ready profile and does not rotate passwords. If a profile directory or configuration records a partial or failed setup, the launcher stops and preserves it for diagnosis. It never resets or deletes unexplained data.

## Start and open

Start production and open it in an installed Chrome or Edge application window:

```powershell
.\deploy\windows\Open-Source-EOC.ps1 -Action Start -Profile production
```

The plain launcher `deploy/windows/Open Source EOC.cmd` runs that command when double-clicked. It is the user-facing production shortcut.

For automation or headless acceptance, keep the foreground browser closed:

```powershell
$env:OPENEOC_ENABLE_ACCEPTANCE_PROFILE = '1'
.\deploy\windows\Open-Source-EOC.ps1 -Action Start -Profile acceptance -NoBrowser
```

The application binds PostgreSQL and HTTP to `127.0.0.1` only. The launch process runs current lexical migrations through the PostgreSQL owner, closes the owner connection, and starts the server with the separate `app_runtime` credential. Row-level security therefore remains active for every application request. The server does not use the owner fallback in `server/src/main.ts`.

The same Fastify process serves the API and stamped frontend. It validates every static path, supports bounded single byte ranges for PMTiles, serves approved local public assets without copying them, and provides runtime map and font URLs through a same-origin script. The document policy permits local MapLibre workers, styles, images, and fonts while API responses keep their existing strict policy.

## Status and stop

```powershell
.\deploy\windows\Open-Source-EOC.ps1 -Action Status -Profile production
.\deploy\windows\Open-Source-EOC.ps1 -Action Stop -Profile production
```

Status reports configuration state, build freshness, exact profile-owned processes, database state, readiness, and URL. It does not expose credentials.

Stop checks the application command line and ownership token, the browser user-data directory, and the PostgreSQL data directory before stopping anything. It does not kill a process merely because that process occupies a configured port. Configuration, database data, blobs, logs, and browser state remain in place for the next start.

Stop a profile before making a filesystem backup. Preserve its entire profile directory so the database, attachments, configuration, and generated credentials remain together. Restore only to the same trusted Windows account and keep the secret directory private.

## Large local map assets

The small bundled PMTiles map and bundled fonts are required. If these approved ignored files exist under `web/public/basemap`, the launcher also exposes them automatically:

- `california.pmtiles` for detailed local streets;
- `buildings.pmtiles` for building footprints;
- `overlays.pmtiles` and `overlays-manifest.json` for jurisdiction overlays.

Their absence leaves the bundled map available and does not trigger a download.

## Evidence boundary

This launcher supports cold setup from the dependencies and assets on this computer, persistent profile restart, and an RLS-backed local runtime. The combined `85-PROOF` unit must still exercise the finished interface against a real isolated profile.

This is not an independent transfer bundle. The local pnpm store, PostgreSQL and PostGIS binaries, Node.js, a browser, and ignored map assets remain machine prerequisites. AR7 stays open until a separately transferred, disconnected package proves provisioning on another prepared machine without relying on this checkout's ignored tools or assets.

Copyright Basho Parks - 2026
