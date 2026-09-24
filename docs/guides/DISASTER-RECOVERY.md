# Disaster Recovery Runbook

This runbook is for the county IT administrator who runs OpenEOC, on the
Docker server or the Windows desktop. It sets recovery targets, says what is
backed up and how often, how to keep copies off the host, how to restore in
each kind of failure, and how to prove every quarter that a restore works.

Every database restore here uses the same command as the recorded restore
drill: `deploy/restore.sh` on Docker, and the `psql` command in
[Restore the database on the desktop](#restore-the-database-on-the-desktop)
on Windows.

## Recovery targets

The recovery point objective (RPO) is how much recent work you can afford to
lose. The recovery time objective (RTO) is how long the EOC can work without
OpenEOC. These are defaults; the emergency manager sets the county's own and
the IT administrator schedules to meet them.

| Failure | Default RPO | Default RTO |
|---|---|---|
| Database damaged, host still working | 24 hours | 1 hour |
| Host lost (hardware, disk, fire, ransomware) | 24 hours | 4 hours, with a replacement host ready |
| An upgrade goes wrong | None: the upgrade backs up first | 30 minutes |
| One record deleted by mistake | Not a restore; see [Records deleted by mistake](#records-deleted-by-mistake) | Minutes |

**RPO** is the time between backups, as long as each backup reaches its
off-host copy before the next one is due. With the default daily schedule a
failure can cost up to a day of entries. To lose less during an activation,
back up more often (every six hours is shown under each path below) and copy
each backup off the host as it is made. If the host is lost with its local
backups, the RPO is the age of the newest off-host copy, not of the newest
backup.

**RTO** is the sum of these steps. Measure each one in the quarterly test and
set the target from your own numbers.

| Step | What to expect |
|---|---|
| Get a working host | The largest and most variable step. A standby virtual machine or a spare computer takes minutes; ordering hardware takes days |
| Install OpenEOC | `install.sh` is designed to finish in well under an hour; it has not yet been timed on a real Linux host. The Windows setup program takes minutes |
| Bring the backup back from its off-host copy | Depends on its size and where it is kept |
| Restore | The drill restored 13,831 rows from a 1.9 MB dump in about 3 seconds. A real county database is larger and compresses less; your quarterly test gives your number |
| Check and reopen | 15 to 30 minutes of the checks in [After any restore](#after-any-restore) |

While OpenEOC is down, the EOC works on paper ICS forms. Everything recorded
on paper, and everything entered in OpenEOC after the backup being restored,
is entered again afterwards.

## What is backed up

| Part | Docker | Windows desktop | How it is protected |
|---|---|---|---|
| The database: boards, records, incidents, people, the audit trail, file details | `openeoc-db` volume | `pgdata` in the profile | Scheduled backup |
| Uploaded files | `openeoc-blobs` volume | `blobs` in the profile | Scheduled backup, beside the database dump |
| Secrets: database passwords and the credential key | `deploy/.env` | `secrets\` in the profile | A separate private copy; see [Keep the secrets separately](#keep-the-secrets-separately) |
| A supplied TLS certificate and key | `deploy/tls/` | None; the desktop serves the local computer only | With the secrets |
| An automatic (ACME) certificate | `caddy-data` volume | None | Not backed up; Caddy obtains a new one |
| Map archives and the address search file | `deploy/basemap/` | `web\public\basemap` in the application | Not backed up; fetch them again from the release, checked against `SHA256SUMS` ([Map archives](../../deploy/README.md#map-archives)) |

The database and the uploaded files belong together. The database holds each
file's name and checksum; the bytes are only in the file store. A database
restored without its files lists attachments that cannot be opened.

## Scheduled backups on Docker

`deploy/backup.sh` writes two files under one UTC timestamp, readable only by
the account that ran it:

- `backups/openeoc-<timestamp>.sql.gz`, the database dump;
- `backups/openeoc-<timestamp>.blobs.tar.gz`, the uploaded files.

Each is written under a `.part` name and renamed only when it is complete. The
`db` and `api` services must be running. An upload still in progress is left
out; it is in the next backup.

### Schedule it

From `deploy/`, once, as the account that ran `install.sh`:

```
sudo ./schedule-backup.sh
```

It installs a systemd service, `openeoc-backup.service`, that runs
`backup.sh` as the owner of `deploy/.env`, and a timer,
`openeoc-backup.timer`, that starts it every day at 02:30 host time. It then
takes one backup through the service, so a schedule that cannot work fails
now, with its reason, rather than on the day it is needed.

A systemd timer is used because every current Linux distribution that runs
Docker Engine has one, no package is added, a run missed while the host was
off happens at the next boot, and each run's output is kept in the journal.

| Setting | Default | Meaning |
|---|---|---|
| First argument | `deploy/backups` | Backup directory, as an absolute path |
| `OPENEOC_BACKUP_SCHEDULE` | `*-*-* 02:30:00` | When to run, as a systemd calendar value |
| `OPENEOC_BACKUP_KEEP_DAYS` | `14` | Days of backups kept; see [Retention](#retention) |
| `OPENEOC_BACKUP_USER` | owner of `deploy/.env` | Account that runs the backup; it must be able to run `docker` |

Every six hours, keeping seven days:

```
sudo OPENEOC_BACKUP_SCHEDULE='*-*-* 02,08,14,20:30:00' OPENEOC_BACKUP_KEEP_DAYS=7 ./schedule-backup.sh
```

`systemd-analyze calendar '<value>'` shows when a calendar value falls. Run
the script again to change a setting.

Check it:

```
systemctl list-timers openeoc-backup.timer    # last and next run
journalctl -u openeoc-backup.service          # each run's output
sudo systemctl start openeoc-backup.service   # run one now
```

To stop scheduling: `sudo systemctl disable --now openeoc-backup.timer`, then
delete `/etc/systemd/system/openeoc-backup.service` and `.timer`.

On a host without systemd, add this line to the install account's crontab
(`crontab -e`), with the real path. Cron does not run a job missed while the
host was off.

```
30 2 * * * cd /path/to/deploy && ./backup.sh >> backups/backup.log 2>&1
```

`./backup.sh` can also be run by hand at any time, for example before a
risky change or at the end of an operational period.

## Scheduled backups on the Windows desktop

The launcher's `Backup` action dumps the profile's database with `pg_dump`,
as the upgrade does, and copies its file store. It writes, in the profile's
`backups` folder:

- `openeoc-<timestamp>.sql`, the database dump;
- `openeoc-<timestamp>.blobs`, a folder holding a copy of the uploaded files.

Both are written under a `.part` name and renamed only when complete. If the
profile is stopped, the action starts its database for the dump and stops it
again; if it is running, the backup is taken while people work. It prints
`BACKUP_WRITTEN` with the two paths.

In an installed copy, the profile is
`%LOCALAPPDATA%\Open Source EOC\profiles\production` and the launcher is in
`%LOCALAPPDATA%\Programs\Open Source EOC\app\deploy\windows`. In a source
checkout they are `deploy\windows\out\profiles\production` and
`deploy\windows`. Run one backup now:

```powershell
& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Backup -Profile production
```

### Schedule it

Register a task from PowerShell, signed in as the Windows account that runs
the profile:

```powershell
$launcher = "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open-Source-EOC.ps1"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -Action Backup -Profile production"
$trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'Open Source EOC backup' -Action $action -Trigger $trigger -Settings $settings
```

The task runs as that account, which owns the profile's private files, and
only while it is signed in. A run missed while the computer was off or the
account signed out runs as soon as it can. Every six hours instead: replace
the trigger line with

```powershell
$trigger = '02:30', '08:30', '14:30', '20:30' | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
```

To keep other than 14 days, add `-KeepDays 7` (for example) after
`-Profile production` in the argument.

Check it:

```powershell
Start-ScheduledTask -TaskName 'Open Source EOC backup'     # run one now
Get-ScheduledTaskInfo -TaskName 'Open Source EOC backup'   # LastTaskResult 0 means it worked
```

To stop scheduling:
`Unregister-ScheduledTask -TaskName 'Open Source EOC backup'`.

## Retention

Each scheduled backup removes the backups it made that are older than the
kept days: 14 by default, set with `OPENEOC_BACKUP_KEEP_DAYS` on Docker and
`-KeepDays` on Windows. It does this only after its own backup is complete,
so a run that fails removes nothing, and it judges age by the timestamp in
the name, so a file copied back in keeps its age. It never touches a file it
did not name.

- On Docker the backup `upgrade.sh` takes is made by `backup.sh`, so it is
  removed after the kept days like any other. Copy it off the host before
  then if you want it longer.
- On Windows the `pre-upgrade-<timestamp>.sql` dumps are never removed.
  Delete them by hand once the new version has run through an operational
  period.
- Every backup is a full copy of the database and the files. Keep free space
  for the kept days times the size of one backup, and check it after an
  activation adds many files.

Backups on the host protect against a damaged database and mistakes. They do
not protect against losing the host. That is what the off-host copies are for.

## Copies off the host

Follow the 3-2-1 rule: three copies of the data (the live system, the
backups on the host, and one more), on two kinds of storage, with one away
from the building. Copy each backup off the host after it is made, or at
least once a day, and at the end of each operational period during an
activation. How long to keep off-host copies (for example, one a month for a
year) is the county's records decision.

The backups hold everything in the system, including sensitive incident
records. Encrypt a copy before it leaves the host, and keep the means to
decrypt it off the host too.

### From Docker

Encrypt to a county backup key whose private half is kept away from the
server, so the server can make copies but cannot read old ones. With GnuPG,
after importing that public key once:

```
cd /path/to/deploy/backups
stamp="$(ls -1 openeoc-*.sql.gz | tail -n 1)"; stamp="${stamp%.sql.gz}"
sha256sum "$stamp.sql.gz" "$stamp.blobs.tar.gz" > "$stamp.sha256"
tar -cf - "$stamp.sql.gz" "$stamp.blobs.tar.gz" "$stamp.sha256" \
  | gpg --encrypt --recipient eoc-backup@county.example -o "/mnt/offsite/$stamp.tar.gpg"
rm "$stamp.sha256"
```

`/mnt/offsite` stands for removable media or a share at another site.

### From the Windows desktop

Copy the newest pair to a BitLocker To Go drive, or to an encrypted county
share at another site:

```powershell
$backups = "$env:LOCALAPPDATA\Open Source EOC\profiles\production\backups"
$target = 'E:\openeoc-backups'
$stamp = (Get-ChildItem $backups -Filter 'openeoc-*.sql' | Sort-Object Name | Select-Object -Last 1).BaseName
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item "$backups\$stamp.sql", "$backups\$stamp.blobs" -Destination $target -Recurse
```

### Verify a copy

A copy that has never been read back is not a backup. After each copy:

- Docker: on the machine that holds the private key, in an empty folder,
  `gpg --decrypt /mnt/offsite/<stamp>.tar.gpg | tar -xf -`, then
  `sha256sum -c <stamp>.sha256` and `gzip -t <stamp>.sql.gz <stamp>.blobs.tar.gz`.
  Delete the decrypted files afterwards.
- Windows: compare the checksums of every file in the copy with the source.
  No output means they match:

  ```powershell
  $hashes = { param($root) Get-ChildItem -LiteralPath "$root\$stamp.sql", "$root\$stamp.blobs" -Recurse -File | Get-FileHash | ForEach-Object Hash | Sort-Object }
  Compare-Object (& $hashes $backups) (& $hashes $target)
  ```

The quarterly restore test is the full proof: it restores from an off-host
copy.

### Keep the secrets separately

Keep one copy of the secrets in the county password manager or vault, or on
encrypted media stored apart from the backups. Never store them unencrypted
beside a backup: whoever holds both holds everything.

- **Docker:** `deploy/.env`, which holds the database password, the
  `app_runtime` password, `OPENEOC_SECRET_KEY`, the host name and the
  certificate choice; and `deploy/tls/` when you supplied the certificate.
  Copy them again after
  [rotating the secret key](../../deploy/README.md#rotating-the-secret-key).
- **Windows desktop:** the profile's `secrets\envelope.key`. Copy it again
  after [rotating the credential key](../WINDOWS-DESKTOP.md#rotating-the-credential-key).
  A new profile generates its own database passwords, so the other two files
  are not needed to restore a dump.

The credential key must be the same one the backup was made under. Without it
the restored database's stored credentials cannot be read: authenticator
codes for two-step sign-in, the IPAWS credential, collaboration and meeting
secrets and federation peer tokens. Signed audit exports also verify only
with the key they were made under. This runbook has no procedure for a
restore without the key.

## Restore

Before any restore:

1. The emergency manager agrees to lose what was entered after the backup
   being restored, and the EOC moves to paper forms.
2. Choose the newest backup made before the failure. Its timestamp is UTC.
3. A second person checks the backup name and the host before the database
   is replaced. `restore.sh` drops the database it is pointed at.

### Database damaged, host still working

**Docker**, from `deploy/`:

```
./restore.sh ./backups/openeoc-<timestamp>.sql.gz --yes-drop-and-restore
docker compose restart api
```

`restore.sh` reads the whole dump first and refuses one that did not run to
the end, changing nothing. It then drops the schema and replays the dump in
one transaction, so an error leaves the database as it was. Last, it unpacks
the matching `.blobs.tar.gz` into the file store. Files are named by their
content, so this only adds the ones that are missing.

If PostgreSQL itself will not start because its volume is damaged, keep the
volume for diagnosis if you can and follow [Host lost](#host-lost) on another
host. To reuse this host, stop the stack (`docker compose down`), remove the
database volume (`docker volume rm deploy_openeoc-db`; `docker volume ls`
shows its name), and follow Host lost from step 5.

**Windows desktop:**

1. Stop the profile:
   `& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Stop -Profile production`
2. Restore the database with the command in
   [Restore the database on the desktop](#restore-the-database-on-the-desktop),
   with `$dump` set to `$profileDir\backups\openeoc-<timestamp>.sql`.
3. Put back the files. Files are named by their content, so this only adds
   the ones that are missing:

   ```powershell
   robocopy "$profileDir\backups\openeoc-<timestamp>.blobs" "$profileDir\blobs" /E
   ```

4. Start the profile from the Start menu.

If PostgreSQL will not start because `pgdata` is damaged, rename the profile
folder to keep it (for example to `production-damaged`), take
`secrets\envelope.key` from it, and follow Host lost from step 2 on this
computer.

### Restore the database on the desktop

This is the command the upgrade guide uses to go back and the drill ran on
the desktop form. With the profile stopped, in PowerShell:

```powershell
$profileDir = "$env:LOCALAPPDATA\Open Source EOC\profiles\production"
$pgBin = "$env:LOCALAPPDATA\Programs\Open Source EOC\app\runtime\pgsql\bin"
$dump = "$profileDir\backups\openeoc-<timestamp>.sql"
$config = Get-Content "$profileDir\profile.json" | ConvertFrom-Json
& "$pgBin\pg_ctl.exe" -D "$profileDir\pgdata" -o "-p $($config.pgPort) -h 127.0.0.1" -w start
$env:PGPASSWORD = (Get-Content "$profileDir\secrets\postgres.password").Trim()
& "$pgBin\psql.exe" -h 127.0.0.1 -p $config.pgPort -U postgres -d $config.database -1 -v ON_ERROR_STOP=1 -q `
  -c "drop schema public cascade; create schema public;" -f $dump
& "$pgBin\pg_ctl.exe" -D "$profileDir\pgdata" -m fast -w stop
Remove-Item Env:PGPASSWORD
```

The drop and the replay run in one transaction: if `psql` reports an error,
the database is left as it was.

### Host lost

**Docker**, on a new Linux host with Docker:

1. Put the release the lost host ran in a repository checkout, if you know
   it, or a later one: a later release upgrades the restored database as it
   starts, as an upgrade does.
2. Copy the kept `.env` into `deploy/` (`chmod 600 deploy/.env`) and, for a
   supplied certificate, the kept `tls/` folder.
3. Put the map archives and their `SHA256SUMS` in `deploy/basemap/`, or set
   `OPENEOC_BASEMAP_URL` as for the first install.
4. If the new host has a different address, point the host name at it now;
   an automatic certificate is requested during the install.
5. Run `./install.sh` with the `OPENEOC_ADMIN_*` and `OPENEOC_JURISDICTION_*`
   variables of the [first install](../../deploy/README.md#one-command-install).
   It reuses the kept secrets, and on the empty database it creates a first
   administrator that the restore then replaces.
6. Bring the backup pair back from its off-host copy into `deploy/backups/`
   and verify it, as in [Verify a copy](#verify-a-copy).
7. `./restore.sh ./backups/openeoc-<timestamp>.sql.gz --yes-drop-and-restore`
8. `docker compose restart api`
9. Delete `deploy/admin-password.txt`; it belongs to the administrator the
   restore replaced.

**Windows desktop**, on another Windows computer:

1. Install the same version's setup program, or a later one.
2. Set up the production profile from the Start menu. The first
   administrator and jurisdiction it asks for are replaced by the restore;
   any values will do.
3. Stop the profile.
4. Copy the kept `envelope.key` over `secrets\envelope.key` in the profile.
5. Copy the backup back from its off-host copy into the profile's `backups`
   folder and verify it, as in [Verify a copy](#verify-a-copy).
6. Restore the database with the command in
   [Restore the database on the desktop](#restore-the-database-on-the-desktop).
7. Put back the files, as in step 3 of
   [Database damaged, host still working](#database-damaged-host-still-working).
8. Start the profile.

If you kept a copy of the whole profile folder taken while the profile was
stopped, as the [upgrade guide](./UPGRADE.md#upgrade-the-windows-desktop)
recommends before an upgrade, you can instead install, put that folder in
place of `%LOCALAPPDATA%\Open Source EOC\profiles\production`, and start.

### An upgrade goes wrong

Follow [Go back on Docker](./UPGRADE.md#go-back-on-docker) or
[Go back on the Windows desktop](./UPGRADE.md#go-back-on-the-windows-desktop).
They use the backup the upgrade took just before it changed anything.

### Records deleted by mistake

- **An archived record** is not deleted. Select it among the archived records
  and choose **Restore record**.
- **A deleted record** cannot be brought back from the screen, and there is
  no undelete ([Archive, delete and read a record's history](./OPERATOR-QUICKSTART.md#archive-delete-and-read-a-records-history)).
  The deletion writes every value the record held into the audit trail.
  **Situation / Chronology** with **All events** shows when it was deleted
  and by whom. An administrator's **Download audit CSV**
  ([Export the audit trail](./ADMIN.md#export-the-audit-trail)) has the
  deletion as a `board.record.deleted` row whose `payload` column holds the
  values; enter the record again from them. The new record has a new id:
  links from other records to the old one do not follow, and the old history
  stays with the deleted record.
- **A partial restore is not possible.** A backup restores the whole
  database. Restoring one to recover a record discards everything entered
  since that backup, in every incident. No tool restores one record, board or
  incident from a backup. When the history does not have what you need,
  restore the backup onto a separate test host or computer, as in the
  quarterly test, read what you need there, enter it again in the live
  system, and then erase the test copy.
- Do not change the database directly to undo a deletion. It bypasses the
  audit trail and is not supported.
- Rows removed by a retention period
  ([Retention and audit export](./ADMIN.md#retention-and-audit-export)) are
  gone from the live database. The same separate restore recovers them from a
  backup taken before the purge, while one is still kept.

## After any restore

1. The server answers and reports its version:
   `curl http://127.0.0.1:8080/api/v1/health` on Docker, or
   `-Action Status -Profile production` on the desktop.
2. Sign in with a real account and a two-step sign-in code. A code that is
   refused after a restore means the credential key is not the one the
   backup was made under.
3. Open the incident being worked, a board with records, and an attached
   file. The file opening shows the file store came back with the database.
4. The newest entry under **Situation / Chronology**, **All events**, shows
   the time the restored data runs to. Tell staff that time, and enter again
   what was recorded after it.
5. Take a backup and an off-host copy of the restored system.

## Quarterly restore test

Once a quarter, and after any change to the host, the release or the backup
setup, restore the newest off-host copy onto a separate test host or computer
and time each step. Never test on the production host: a restore replaces the
database it is pointed at. The test copy holds real records; erase it when
the test is done.

**Docker:** build a test host, and use a copy of the kept `.env` without its
`OPENEOC_DOMAIN` and `OPENEOC_TLS` lines, so the test host gets its own name
and certificate from the variables you give `install.sh`. Then follow
[Host lost](#host-lost) from step 2. Time the restore with
`time ./restore.sh ...`.

**Windows desktop:** on a second computer, follow [Host lost](#host-lost) for
the desktop. Time the database restore by wrapping the `psql` line in
`Measure-Command { ... }`.

Then run [After any restore](#after-any-restore), and record:

| Record | Example |
|---|---|
| Date, and who ran the test | |
| Backup used, and the off-host copy it came from | |
| Dump size, and the size of the file store | |
| Minutes to install, to bring the copy back, to restore, to check | |
| Checks passed | |
| Measured RPO and RTO against the targets | |

The reference is the drill recorded in the
[upgrade guide](./UPGRADE.md#restore-drill), run on real PostgreSQL by
`server/src/__tests__/restore-drill.test.ts` with the same restore commands:

| Measure | Drill result |
|---|---|
| Tables and rows | 112 tables, 13,831 rows |
| Dump size | 1.9 MB plain SQL, 0.2 MB gzipped |
| `pg_dump` | 425 ms |
| Restore, Docker form (`restore.sh`) | 2,982 ms |
| Restore, desktop form (`psql` from a file) | 2,889 ms |

Its synthetic records compress far better than real ones. If your restore
takes much longer than your RTO allows, or grows quarter to quarter, change
the target, the host or the schedule.

## Who does what

| Role | Before a failure | During recovery |
|---|---|---|
| County IT administrator | Schedules backups and checks them weekly; makes and verifies off-host copies; keeps the secrets copy; runs the quarterly test | Rebuilds the host, restores, runs the checks |
| Emergency manager or EOC director | Sets the RPO and RTO; approves the schedule | Decides to restore and accepts the lost window; moves the EOC to paper; tells staff what to enter again |
| OpenEOC administrator | Keeps an administrator account enrolled in two-step sign-in | Checks the restored system in the application; resets two-step sign-in where needed; enters deleted records again from their history |
| A second person | | Confirms the backup and the host before a restore replaces a database |

Weekly, the IT administrator confirms that the newest backup is less than a
day old, that its off-host copy exists and verified, and that there is room
for the kept days.
