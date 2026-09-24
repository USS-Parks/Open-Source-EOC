# Upgrade Guide

This guide says which databases upgrade in place, what is not supported, and
how to upgrade and go back on each deployment path. What each version changed
is in [the changelog](../../CHANGELOG.md).

## Versions

Every package in the repository carries the same
[semantic version](https://semver.org/spec/v2.0.0.html). `0.9.0` is the
evaluation build; `1.0.0` is set when the first release is tagged.

The running server reports its version, without sign-in, at
`GET /api/v1/health`:

```
{"status":"ok","version":"0.9.0"}
```

On a Docker host, read it with `curl http://127.0.0.1:8080/api/v1/health`.

## What upgrades in place

- A database created by `0.9.0` or later upgrades in place to any later
  version, including one several versions ahead.
- The API applies the migrations the database has not had yet as it starts,
  in order, each in its own transaction, and records each one. Starting the
  same version again applies nothing.
- Customized boards keep their local `x_` fields and every record, and a board
  moved to a newer template version keeps both
  (`server/src/__tests__/upgrade.test.ts`).
- Uploaded files are stored by content and never rewritten, so an upgrade
  does not touch them.

## The migration baseline boundary

Before `0.9.0` the database schema was built by 54 migration files numbered
`0001` to `0101`. On 2026-09-22 they were replaced by a single file,
`0001_baseline.sql`, that builds the same schema in one step. Migrations added
since are numbered from `0102`.

A database built from the source before that date still carries the records
of the old files in its `schema_migrations` table, and it cannot be upgraded
in place. The API checks those records before it applies anything. When it
finds one of the old names, it stops without changing the database, and the
error begins:

```
Refusing the pre-release schema baseline because schema_migrations contains retired rows:
```

followed by the names it found. It also stops when the table holds a name
that is not a numbered migration, or holds migrations but not
`0001_baseline.sql`.

If you see this error:

1. Do not delete or rename rows in `schema_migrations` to get past it. The
   baseline builds the whole schema from nothing; run over the old schema it
   fails or damages it.
2. Keep that database, and run it with the source version that created it,
   for as long as you need what it holds.
3. Install this version on a new, empty database: a new Docker install on
   another host or with new volumes, or, on the Windows desktop, a new profile
   after the old profile's directory is moved out of the data folder.
4. No tool moves data from a database older than the baseline into a new one.
   Carry the records you need across with the board import (CSV or Excel), or
   enter them again.

`0.9.0` is the first versioned build, and no deployed instance existed before
the baseline, so only evaluation databases built from source before
2026-09-22 are affected.

## Not supported

- **Going back to an older version with the same database.** Migrations only
  move forward, and an older version is not tested against a newer schema. To
  go back, restore the backup taken before the upgrade, with the older version
  installed, as described below for each path.
- **Upgrading without a backup.** `upgrade.sh` has no switch that skips its
  backup, and the desktop launcher does not migrate when its backup fails.
- **Two API processes against one database**, including an old and a new
  version side by side during an upgrade (see
  [One application node](../../deploy/README.md#one-application-node)).
- **A database built before the baseline**, as above.

## Upgrade a Docker install

1. Put the new release in the repository checkout on the host, for example
   `git fetch` and `git checkout` of the release. On an air-gapped host, copy
   the new source tree and any newer images across as for the
   [first install](../../deploy/README.md#air-gapped-install).
2. From `deploy/`, run:

   ```
   ./upgrade.sh
   ```

   It stops with a message at the first step that fails. In order, it:

   1. checks for Docker, the compose plugin and `curl`, and that
      `deploy/.env` has the host name and certificate choice (an install made
      before the HTTPS front end runs `./install.sh` once first);
   2. prints the running version;
   3. runs `backup.sh`, and stops, having changed nothing, if the backup
      fails, if the database dump is empty or does not end with pg_dump's
      completion line, or if the file archive is not a readable gzip file.
      The backup needs the `db` and `api` services running;
   4. builds the new images and recreates the stack; the API applies the new
      migrations as it starts;
   5. waits up to five minutes for `GET /api/v1/ready`, then prints the old
      and new versions and the two backup files.

   An optional argument names the backup directory; the default is
   `deploy/backups`.
3. Sign in and check the incident you are working. Copy the two backup files
   off the host and keep them until the new version has run through an
   operational period.

There is no switch to skip the backup. If it cannot be taken, the reason is
printed above the refusal; fix it and run `./upgrade.sh` again.

### Go back on Docker

If the new version does not start, or you need the previous one back, use the
backup `upgrade.sh` printed. Anything recorded after the upgrade is lost, so
export what you need first.

1. Check out the previous release in the repository checkout.
2. `docker compose build` and `docker compose up -d`.
3. `./restore.sh ./backups/openeoc-<timestamp>.sql.gz --yes-drop-and-restore`
4. `docker compose restart api`

`restore.sh` reads the whole dump before it drops anything and refuses one
that did not run to the end. It then drops the schema and replays the dump in
one transaction, so an error leaves the database as it was.

## Upgrade the Windows desktop

1. Stop each profile you use, for example
   `& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Stop -Profile production`.
   The setup program does not stop a running profile.
2. Copy the profile's whole directory,
   `%LOCALAPPDATA%\Open Source EOC\profiles\production`, somewhere safe. It
   holds the database, the uploaded files, the generated secrets and the
   configuration, and it is the complete backup.
3. Run the new setup program. It replaces the application files and leaves
   the data folder as it is.
4. Start the profile from the Start menu. When the new build has migrations
   the database has not had, the launcher first writes a dump of the database
   to `backups\pre-upgrade-<UTC time>.sql` in the profile directory, prints
   `PRE_UPGRADE_BACKUP path=` with its path, and only then migrates. If the
   dump fails or is empty, the launcher stops with the error and the database
   is not migrated.

The pre-upgrade dump holds the database only. The copy from step 2 is the
backup to go back to.

### Go back on the Windows desktop

With the profile copy: stop the profile, install the previous version's setup
program, replace the profile directory with the copy, and start the profile.

With the pre-upgrade dump, after installing the previous version and stopping
the profile, from PowerShell:

```powershell
$profileDir = "$env:LOCALAPPDATA\Open Source EOC\profiles\production"
$pgBin = "$env:LOCALAPPDATA\Programs\Open Source EOC\app\runtime\pgsql\bin"
$dump = "$profileDir\backups\pre-upgrade-<UTC time>.sql"
$config = Get-Content "$profileDir\profile.json" | ConvertFrom-Json
& "$pgBin\pg_ctl.exe" -D "$profileDir\pgdata" -o "-p $($config.pgPort) -h 127.0.0.1" -w start
$env:PGPASSWORD = (Get-Content "$profileDir\secrets\postgres.password").Trim()
& "$pgBin\psql.exe" -h 127.0.0.1 -p $config.pgPort -U postgres -d $config.database -1 -v ON_ERROR_STOP=1 -q `
  -c "drop schema public cascade; create schema public;" -f $dump
& "$pgBin\pg_ctl.exe" -D "$profileDir\pgdata" -m fast -w stop
Remove-Item Env:PGPASSWORD
```

The drop and the replay run in one transaction: if `psql` reports an error,
the database is left as it was. Uploaded files are not in the dump; files
uploaded after the upgrade stay on disk, and their records are gone with the
rest of the database.

## Restore drill

`server/src/__tests__/restore-drill.test.ts` runs the restore on both paths
against a synthetic activation on real PostgreSQL. It loads the demo incident,
adds 4,000 activity log entries, 1,000 road closures with locations and 200
file records, dumps the database with `pg_dump --no-owner` as `backup.sh` and
the desktop launcher do, and restores it into a second database twice: from
standard input in one transaction, as `restore.sh` does, and from a file with
the command above. After each restore every row of every table and every
sequence matches the source; afterwards the migration runner finds nothing to
apply, and the app signs in and serves the restored board.

Recorded on 2026-09-23 on the development workstation (Windows 11, PostgreSQL
16.15 test cluster shared with other test runs):

| Measure | Result |
|---|---|
| Tables and rows | 112 tables, 13,831 rows, 5,003 of them board records |
| Dump size | 1.9 MB plain SQL, 0.2 MB gzipped as `backup.sh` stores it |
| `pg_dump` | 425 ms |
| Restore from standard input (`restore.sh`) | 2,982 ms |
| Restore from a file (desktop) | 2,889 ms |

The synthetic records repeat a pattern, so they compress far better than real
records would. Time a restore of a copy of your own database before an
activation depends on it.
