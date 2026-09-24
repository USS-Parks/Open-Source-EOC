# Disaster Recovery Runbook

This runbook is for the county IT administrator who runs Open Source EOC on
Windows. It sets recovery targets, says what is backed up and how often, how
to keep copies off the computer, how to restore in each kind of failure, and
how to prove every quarter that a restore works. The shared Windows host and
macOS are scheduled in
[the readiness plan](../process/READINESS-PSPR-2026-09-24.md); their backup
steps join this runbook when they are built.

Every database restore here uses the same command as the recorded restore
drill: the `psql` command in
[Restore the database](#restore-the-database).

## Recovery targets

The recovery point objective (RPO) is how much recent work you can afford to
lose. The recovery time objective (RTO) is how long the EOC can work without
Open Source EOC. These are defaults; the emergency manager sets the county's
own and the IT administrator schedules to meet them.

| Failure | Default RPO | Default RTO |
|---|---|---|
| Database damaged, computer still working | 24 hours | 1 hour |
| Computer lost (hardware, disk, fire, ransomware) | 24 hours | 4 hours, with a replacement computer ready |
| An upgrade goes wrong | None: the upgrade backs up first | 30 minutes |
| One record deleted by mistake | Not a restore; see [Records deleted by mistake](#records-deleted-by-mistake) | Minutes |

**RPO** is the time between backups, as long as each backup reaches its
off-computer copy before the next one is due. With the default daily schedule
a failure can cost up to a day of entries. To lose less during an activation,
back up more often (every six hours is shown below) and copy each backup off
the computer as it is made. If the computer is lost with its local backups,
the RPO is the age of the newest off-computer copy, not of the newest backup.

**RTO** is the sum of these steps. Measure each one in the quarterly test and
set the target from your own numbers.

| Step | What to expect |
|---|---|
| Get a working computer | The largest and most variable step. A spare computer takes minutes; ordering hardware takes days |
| Install Open Source EOC | The Windows setup program takes minutes |
| Bring the backup back from its off-computer copy | Depends on its size and where it is kept |
| Restore | The drill restored 13,831 rows from a 1.9 MB dump in about 3 seconds. A real county database is larger and compresses less; your quarterly test gives your number |
| Check and reopen | 15 to 30 minutes of the checks in [After any restore](#after-any-restore) |

While Open Source EOC is down, the EOC works on paper ICS forms. Everything
recorded on paper, and everything entered after the backup being restored, is
entered again afterwards.

## What is backed up

| Part | Where it is | How it is protected |
|---|---|---|
| The database: boards, records, incidents, people, the audit trail, file details | `pgdata` in the profile | Scheduled backup |
| Uploaded files | `blobs` in the profile | Scheduled backup, beside the database dump |
| Secrets: database passwords and the credential key | `secrets\` in the profile | A separate private copy; see [Keep the secrets separately](#keep-the-secrets-separately) |
| Map archives and the address search file | Inside the installed application | Not backed up; the setup program carries them |

The database and the uploaded files belong together. The database holds each
file's name and checksum; the bytes are only in the file store. A database
restored without its files lists attachments that cannot be opened.

## Scheduled backups

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

`-Action Backup` can also be run by hand at any time, for example before a
risky change or at the end of an operational period.

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
kept days: 14 by default, set with `-KeepDays`. It does this only after its
own backup is complete, so a run that fails removes nothing, and it judges age
by the timestamp in the name, so a file copied back in keeps its age. It never
touches a file it did not name.

- The `pre-upgrade-<timestamp>.sql` dumps are never removed. Delete them by
  hand once the new version has run through an operational period.
- Every backup is a full copy of the database and the files. Keep free space
  for the kept days times the size of one backup, and check it after an
  activation adds many files.

Backups on the computer protect against a damaged database and mistakes. They
do not protect against losing the computer. That is what the off-computer
copies are for.

## Copies off the computer

Follow the 3-2-1 rule: three copies of the data (the live system, the
backups on the computer, and one more), on two kinds of storage, with one away
from the building. Copy each backup off the computer after it is made, or at
least once a day, and at the end of each operational period during an
activation. How long to keep off-computer copies (for example, one a month
for a year) is the county's records decision.

The backups hold everything in the system, including sensitive incident
records. Keep a copy encrypted, and keep the means to decrypt it off the
computer too. Copy the newest pair to a BitLocker To Go drive, or to an
encrypted county share at another site:

```powershell
$backups = "$env:LOCALAPPDATA\Open Source EOC\profiles\production\backups"
$target = 'E:\openeoc-backups'
$stamp = (Get-ChildItem $backups -Filter 'openeoc-*.sql' | Sort-Object Name | Select-Object -Last 1).BaseName
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item "$backups\$stamp.sql", "$backups\$stamp.blobs" -Destination $target -Recurse
```

### Verify a copy

A copy that has never been read back is not a backup. After each copy, compare
the checksums of every file in the copy with the source. No output means they
match:

```powershell
$hashes = { param($root) Get-ChildItem -LiteralPath "$root\$stamp.sql", "$root\$stamp.blobs" -Recurse -File | Get-FileHash | ForEach-Object Hash | Sort-Object }
Compare-Object (& $hashes $backups) (& $hashes $target)
```

The quarterly restore test is the full proof: it restores from an
off-computer copy.

### Keep the secrets separately

Keep one copy of the profile's `secrets\envelope.key` in the county password
manager or vault, or on encrypted media stored apart from the backups. Never
store it unencrypted beside a backup: whoever holds both holds everything.
Copy it again after
[rotating the credential key](../WINDOWS-DESKTOP.md#rotating-the-credential-key).
A new profile generates its own database passwords, so the other secret files
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
3. A second person checks the backup name and the computer before the
   database is replaced. The restore drops the database it is pointed at.

### Database damaged, computer still working

1. Stop the profile:
   `& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Stop -Profile production`
2. Restore the database with the command in
   [Restore the database](#restore-the-database), with `$dump` set to
   `$profileDir\backups\openeoc-<timestamp>.sql`.
3. Put back the files. Files are named by their content, so this only adds
   the ones that are missing:

   ```powershell
   robocopy "$profileDir\backups\openeoc-<timestamp>.blobs" "$profileDir\blobs" /E
   ```

4. Start the profile from the Start menu.

If PostgreSQL will not start because `pgdata` is damaged, rename the profile
folder to keep it (for example to `production-damaged`), take
`secrets\envelope.key` from it, and follow
[Computer lost](#computer-lost) from step 2 on this computer.

### Restore the database

This is the command the upgrade guide uses to go back and the drill ran. With
the profile stopped, in PowerShell:

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

### Computer lost

On another Windows computer:

1. Install the same version's setup program, or a later one: a later release
   upgrades the restored database as it starts, as an upgrade does.
2. Set up the production profile from the Start menu. The first
   administrator and jurisdiction it asks for are replaced by the restore;
   any values will do.
3. Stop the profile.
4. Copy the kept `envelope.key` over `secrets\envelope.key` in the profile.
5. Copy the backup back from its off-computer copy into the profile's
   `backups` folder and verify it, as in [Verify a copy](#verify-a-copy).
6. Restore the database with the command in
   [Restore the database](#restore-the-database).
7. Put back the files, as in step 3 of
   [Database damaged, computer still working](#database-damaged-computer-still-working).
8. Start the profile.

If you kept a copy of the whole profile folder taken while the profile was
stopped, as the [upgrade guide](./UPGRADE.md#upgrade-on-windows) recommends
before an upgrade, you can instead install, put that folder in place of
`%LOCALAPPDATA%\Open Source EOC\profiles\production`, and start.

### An upgrade goes wrong

Follow [Go back](./UPGRADE.md#go-back). It uses the backup the upgrade took
just before it changed anything.

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
  restore the backup onto a separate test computer, as in the quarterly
  test, read what you need there, enter it again in the live system, and then
  erase the test copy.
- Do not change the database directly to undo a deletion. It bypasses the
  audit trail and is not supported.
- Rows removed by a retention period
  ([Retention and audit export](./ADMIN.md#retention-and-audit-export)) are
  gone from the live database. The same separate restore recovers them from a
  backup taken before the purge, while one is still kept.

## After any restore

1. The server answers and reports its version:
   `-Action Status -Profile production`.
2. Sign in with a real account and a two-step sign-in code. A code that is
   refused after a restore means the credential key is not the one the
   backup was made under.
3. Open the incident being worked, a board with records, and an attached
   file. The file opening shows the file store came back with the database.
4. The newest entry under **Situation / Chronology**, **All events**, shows
   the time the restored data runs to. Tell staff that time, and enter again
   what was recorded after it.
5. Take a backup and an off-computer copy of the restored system.

## Quarterly restore test

Once a quarter, and after any change to the computer, the release or the
backup setup, restore the newest off-computer copy onto a second computer and
time each step. Never test on the production computer: a restore replaces the
database it is pointed at. The test copy holds real records; erase it when
the test is done.

On the second computer, follow [Computer lost](#computer-lost). Time the
database restore by wrapping the `psql` line in `Measure-Command { ... }`.
Then run [After any restore](#after-any-restore), and record:

| Record | Example |
|---|---|
| Date, and who ran the test | |
| Backup used, and the off-computer copy it came from | |
| Dump size, and the size of the file store | |
| Minutes to install, to bring the copy back, to restore, to check | |
| Checks passed | |
| Measured RPO and RTO against the targets | |

The reference is the drill recorded in the
[upgrade guide](./UPGRADE.md#restore-drill), run on real PostgreSQL by
`server/src/__tests__/restore-drill.test.ts` with the same restore command:

| Measure | Drill result |
|---|---|
| Tables and rows | 112 tables, 13,831 rows |
| Dump size | 1.9 MB plain SQL, 0.2 MB gzipped |
| `pg_dump` | 425 ms |
| Restore from a file with `psql` | 2,889 ms |

Its synthetic records compress far better than real ones. If your restore
takes much longer than your RTO allows, or grows quarter to quarter, change
the target, the computer or the schedule.

## Who does what

| Role | Before a failure | During recovery |
|---|---|---|
| County IT administrator | Schedules backups and checks them weekly; makes and verifies off-computer copies; keeps the secrets copy; runs the quarterly test | Rebuilds the computer, restores, runs the checks |
| Emergency manager or EOC director | Sets the RPO and RTO; approves the schedule | Decides to restore and accepts the lost window; moves the EOC to paper; tells staff what to enter again |
| Open Source EOC administrator | Keeps an administrator account enrolled in two-step sign-in | Checks the restored system in the application; resets two-step sign-in where needed; enters deleted records again from their history |
| A second person | | Confirms the backup and the computer before a restore replaces a database |

Weekly, the IT administrator confirms that the newest backup is less than a
day old, that its off-computer copy exists and verified, and that there is
room for the kept days.
