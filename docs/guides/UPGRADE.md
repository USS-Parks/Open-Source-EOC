# Upgrade Guide

This guide says which databases upgrade in place, what is not supported, and
how to upgrade and go back on Windows. The shared Windows host and macOS are
scheduled in [the readiness plan](../process/READINESS-PSPR-2026-09-24.md);
their steps join this guide when they are built. What each version changed is
in [the changelog](../../CHANGELOG.md).

## Versions

Every package in the repository carries the same
[semantic version](https://semver.org/spec/v2.0.0.html). `0.9.0` is the
evaluation build; `1.0.0` is set when the first release is tagged.

The running server reports its version, without sign-in, at
`GET /api/v1/health`:

```
{"status":"ok","version":"0.9.0"}
```

On Windows, `-Action Status -Profile production` reports it with the rest of
the profile's state.

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
3. Install this version on a new, empty database: a new profile, after the old
   profile's directory is moved out of the data folder.
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
  installed, as described below.
- **Upgrading without a backup.** The launcher does not migrate when its
  pre-upgrade backup fails.
- **Two API processes against one database**, including an old and a new
  version side by side during an upgrade (see
  [One application node](../../deploy/README.md#one-application-node)).
- **A database built before the baseline**, as above.

## Upgrade on Windows

1. The setup program stops the production and demo profiles, and a host's
   services, before it replaces their files. To stop a profile yourself, for
   example to copy it in the next step, run
   `& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Stop -Profile production`.
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
   is not migrated. After migrating it writes a report beside the dump,
   `backups\pre-upgrade-<UTC time>.txt`, and prints `UPGRADE_REPORT path=`:
   each migration applied with what it changes, what an upgrade keeps, and
   the way back.
5. Sign in and check the incident you are working. Keep the profile copy
   until the new version has run through an operational period.

The pre-upgrade dump holds the database only. The copy from step 2 is the
backup to go back to.

### Go back

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

`server/src/__tests__/restore-drill.test.ts` runs the restore against a
synthetic activation on real PostgreSQL. It loads the demo incident, adds
4,000 activity log entries, 1,000 road closures with locations and 200 file
records, dumps the database with `pg_dump --no-owner` as the launcher does,
and restores it into a second database twice: streamed into `psql` in one
transaction, and from a file with the command above. After each restore every
row of every table and every sequence matches the source; afterwards the
migration runner finds nothing to apply, and the app signs in and serves the
restored board.

Recorded on 2026-09-23 on the development workstation (Windows 11, PostgreSQL
16.15 test cluster shared with other test runs):

| Measure | Result |
|---|---|
| Tables and rows | 112 tables, 13,831 rows, 5,003 of them board records |
| Dump size | 1.9 MB plain SQL, 0.2 MB gzipped |
| `pg_dump` | 425 ms |
| Restore streamed into `psql` | 2,982 ms |
| Restore from a file | 2,889 ms |

The synthetic records repeat a pattern, so they compress far better than real
records would. Time a restore of a copy of your own database before an
activation depends on it.

The [disaster recovery runbook](./DISASTER-RECOVERY.md) uses these numbers as
the reference for its quarterly restore test, and schedules the backups these
restores start from.
