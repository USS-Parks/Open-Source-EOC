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
$testRoot = 'C:/Users/17076/Documents/Open Source EOC/deploy/test-runtime/out'
$testPassword = [IO.File]::ReadAllText("$testRoot/test-password.txt").Trim()
$lane = 'gate' # a, b, c, d for lanes; main for the integrator; gate for milestones
$env:OPENEOC_TEST_DB_TAG = $lane
$env:OPENEOC_DATABASE_URL = 'postgres://postgres:' + [Uri]::EscapeDataString($testPassword) + '@127.0.0.1:55439/openeoc_test'
$env:OPENEOC_CHROMIUM = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:OPENEOC_TEST_BUILD_ROOT = "$testRoot/lanes/$lane/browser"
$env:OPENEOC_SHOT_DIR = "$testRoot/lanes/$lane/browser-shots"
$env:OPENEOC_DATA_DIR = "$testRoot/lanes/$lane/blobs"
pnpm check --maxWorkers=2
```

Each concurrent run needs a different tag containing 1 to 12 lowercase letters
or digits. Never run two suites with the same tag at once. An omitted tag keeps
the legacy untagged namespace; an empty or invalid tag fails before connecting.
Teardown drops only the current namespace. Only the integrating session controls
the cluster. Lane commands set the absolute canonical testRoot shown above,
their own working directory, and all environment variables in each invocation.

If interrupted runs leave databases behind, the integrator may inspect names
matching `^t_([a-z0-9]{1,12}_)?[0-9a-z]{10}$`. Manual cleanup is allowed only
after every test run is stopped and ownership is verified. The broader pattern
is for idle-cluster recovery, never for automatic teardown of a live run.

Stop only this project's cluster after verification work ends:

```powershell
& "$testRoot/pgsql/bin/pg_ctl.exe" -D "$testRoot/data" -m fast -w stop
```

These test binaries are external development tools, not vendored application
dependencies or shipped product artifacts. Archive fingerprints and test
results belong in the execution ledger. Preserve the runtime while active;
account for its size at closeout and obtain authorization before removing it.
