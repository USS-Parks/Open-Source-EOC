# Local database verification on Windows

This optional test setup uses PostgreSQL 16.15 and PostGIS 3.6.2 binaries
inside `deploy/test-runtime/out/`. It creates no Windows service and does
not require Docker. The directory is ignored by Git. Never commit its
password file, database cluster, binary archives or browser outputs.

The runtime was explicitly approved by Basho on 2026-09-20. Official sources:
- [PostgreSQL Windows binaries](https://www.enterprisedb.com/download-postgresql-binaries).
- [PostGIS Windows releases](https://postgis.net/documentation/getting_started/install_windows/released_versions/).

The initialized cluster listens only on 127.0.0.1:55439 and uses SCRAM host
authentication. Its generated test password is local, not a deployment secret.
The bootstrap database is openeoc_test; tests create isolated databases.

From the repository root, start the existing cluster when needed:

```powershell
$testRoot = (Resolve-Path deploy/test-runtime/out).Path
& "$testRoot/pgsql/bin/pg_ctl.exe" -D "$testRoot/data" -l "$testRoot/postgres.log" -o '-h 127.0.0.1 -p 55439' -w start
```

Run the complete verification gate without displaying credentials:

```powershell
$testPassword = [IO.File]::ReadAllText("$testRoot/test-password.txt").Trim()
$env:OPENEOC_DATABASE_URL = 'postgres://postgres:' + [Uri]::EscapeDataString($testPassword) + '@127.0.0.1:55439/openeoc_test'
$env:OPENEOC_CHROMIUM = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:OPENEOC_TEST_BUILD_ROOT = "$testRoot/browser"
$env:OPENEOC_SHOT_DIR = "$testRoot/browser-shots"
$env:OPENEOC_DATA_DIR = "$testRoot/blobs"
pnpm check --maxWorkers=2
```

Stop only this project's cluster after verification work ends:

```powershell
& "$testRoot/pgsql/bin/pg_ctl.exe" -D "$testRoot/data" -m fast -w stop
```

These test binaries are external development tools, not vendored application
dependencies or shipped product artifacts. Archive fingerprints and test
results belong in the execution ledger. Preserve the runtime while active;
account for its size at closeout and obtain authorization before removing it.
