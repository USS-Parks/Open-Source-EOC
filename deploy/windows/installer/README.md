# Windows installer

This directory produces a per-user, installable Windows `.exe` for the existing
loopback desktop runtime. The setup executable is made by Inno Setup. The
installed application contains the portable Node runtime, PostgreSQL with
PostGIS, the prebuilt web application, server and shared TypeScript sources,
and the runtime dependency trees needed by `ts-loader.mjs`.

The installer never creates a Windows service. Each profile starts PostgreSQL
and the Fastify static host on `127.0.0.1`, then opens a Chrome or Edge app
window when available. Production first launch prompts for the initial
administrator and jurisdiction. The demo shortcut creates the existing,
clearly labeled synthetic fixture. No production credentials are placed in the
installer.

The acceptance profile is test harness infrastructure, not an installed
operator profile. From a source checkout only, test owners may enable it for a
single command by setting `OPENEOC_ENABLE_ACCEPTANCE_PROFILE=1`. The installed
launcher ignores that switch and accepts only `production` and `demo`.

## Data and uninstall behavior

Application files install below `%LOCALAPPDATA%\Programs\Open Source EOC`.
Operational data is deliberately separate at `%LOCALAPPDATA%\Open Source EOC`:

- PostgreSQL profile data and generated secrets
- uploads and blobs
- logs, process ownership records, and per-profile browser state

The uninstaller stops owned production and demo processes, removes application
files, and preserves that data directory. This allows recovery after reinstall
and prevents an uninstall from destroying operational records. Removing the
data directory is an explicit administrator action outside this installer.

## Required build inputs

`Stage-Installer.ps1` does not download software. It requires these local,
reviewed inputs:

1. A portable Node distribution directory containing `node.exe` and the
   Node.js `LICENSE`. The official Node Windows zip carries it; the directory
   the Node MSI installs, `C:/Program Files/nodejs`, does not.
2. A PostgreSQL distribution directory named `pgsql`, including the PostGIS
   extension and the license files listed under
   [License notices](#license-notices). The approved local source may be
   `deploy/test-runtime/out/pgsql`; pass that directory itself, never its
   parent. The script refuses a runtime that contains test cluster data,
   passwords, or logs.
3. A fresh desktop build at `deploy/windows/out/build/app-dist` with its
   adjacent `build-stamp.json`. Staging recalculates the launcher's canonical
   content fingerprint from the supplied `-RepoRoot` and rejects a stamp that
   was built from different or changed UI sources.
4. pnpm 10.33.0, the version pinned in the repository manifest. The staging
   script uses its production deploy mode to resolve the server runtime
   closure, including the workspace shared package, without copying root
   development dependencies or retaining canonical-workspace junctions.
5. PowerShell 7. The staging and compiler scripts declare this requirement;
   the installed application launcher remains compatible with Windows
   PowerShell 5.1.
6. Inno Setup 6, which supplies `iscc.exe`, to compile the final executable.
7. The network host's two programs, unpacked from their official releases:
   a folder holding `caddy.exe` and Caddy's `LICENSE`, from
   `caddy_2.11.4_windows_amd64.zip` checked against the SHA-512 in
   `caddy_2.11.4_checksums.txt` on the Caddy release page; and a folder
   holding `WinSW-x64.exe` from the WinSW 2.12.0 release with its
   `LICENSE.txt` beside it.

The default package includes the baseline offline PMTiles map,
`ca_counties.geojson`, local fonts, NAPSG assets, the install icons, and the
selected application build. Large California street, building, and overlay
archives are excluded by default. Add `-IncludeOptionalBasemaps` only for a
release whose size budget and source receipts cover those assets. With it, the
stage requires all thirteen archive files (`california.pmtiles`,
`buildings.pmtiles`, `buildings-overture.json`, `overlays.pmtiles`,
`overlays-manifest.json`, `facilities.pmtiles`, `facilities-manifest.json`,
`boundaries.pmtiles`, `boundaries-manifest.json`, `risk.pmtiles`, `risk-manifest.json`,
and the North Coast `north-coast-imagery.pmtiles`
and `north-coast-terrain.pmtiles` the demo's maps show) from
`-OptionalBasemapRoot`, default
`web/public/basemap`, and the address search gazetteer at
`tools/basemap/out/gazetteer.tsv` (built by `tools/basemap/build-gazetteer.mjs`
from `california.pmtiles`); a missing file stops the stage. The static host
discovers the archives, and the launcher sets `OPENEOC_GAZETTEER_PATH` to the
gazetteer, which stays outside `web/public` so it is never served as a file.

The version defaults to the root `package.json` version in both scripts, and
the compiler refuses a stage made for a different version. Pass `-Version` to
both only when a release deliberately names another.

## License notices

The stage writes `THIRD-PARTY-NOTICES.txt` beside `LICENSE` and `NOTICE` at
the root of the installed application, `%LOCALAPPDATA%\Programs\Open Source
EOC\app`, and the runtimes' own license texts to its `licenses` folder. The
setup's wildcard `[Files]` entry installs both. The notices, kept in this
directory as `THIRD-PARTY-NOTICES.txt`, list each shipped component with its
license and where its text is, carry the OpenStreetMap attribution and ODbL
notice for the map archives and the gazetteer, and hold the written offer for
the source of PostGIS and the other GPL- or LGPL-licensed components of the
PostGIS bundle.

The stage stops before copying anything unless the runtime inputs carry these
files:

| Input file | Staged as `licenses/...` | Source |
|---|---|---|
| `<node>/LICENSE` | `node-LICENSE.txt` | Official Node Windows zip |
| `<pgsql>/server_license.txt` | `postgresql-server_license.txt` | EDB PostgreSQL zip, `pgsql/` |
| `<pgsql>/commandlinetools_3rd_party_licenses.txt` | `postgresql-commandlinetools_3rd_party_licenses.txt` | EDB PostgreSQL zip, `pgsql/` |
| `<pgsql>/StackBuilder_3rd_party_licenses.txt` | `postgresql-StackBuilder_3rd_party_licenses.txt` | EDB PostgreSQL zip, `pgsql/` |
| `<pgsql>/bin/COPYING` | `postgis-bundle-COPYING-GPL-2.0.txt` | PostGIS bundle |
| `<pgsql>/LICENSE` | `postgis-bundle-LICENSE-Apache-2.0.txt` | PostGIS bundle root |
| `<pgsql>/COPYRIGHT.pg_sphere` | `pg_sphere-COPYRIGHT.txt` | PostGIS bundle root |
| `<pgsql>/ogrfdw_LICENSE.md` | `ogr_fdw-LICENSE.md` | PostGIS bundle root |
| `<pgsql>/pgpointcloud_COPYRIGHT` | `pointcloud-COPYRIGHT.txt` | PostGIS bundle root |
| `<pgsql>/gdal-data/LICENSE.TXT` | `gdal-LICENSE.txt` | PostGIS bundle |
| `<caddy>/LICENSE` | `caddy-LICENSE.txt` | Caddy release zip |
| `<winsw>/LICENSE.txt` | `winsw-LICENSE.txt` | WinSW repository at the release tag |

The bundle's files land at those paths when the bundle is copied over the
PostgreSQL directory, as its `README.txt` directs. The stage also reads the
PostGIS version from `share/extension/postgis.control` and stops if the
notices' source offer names another version. Of these files, the unpacked
runtime in `deploy/test-runtime/out/pgsql` holds only `bin/COPYING`, and the
MSI-installed Node directory holds no `LICENSE`, so a release stage needs
inputs prepared from the official archives:

- **Node:** unpack the official `node-v24.15.0-win-x64.zip` after checking it
  against the `SHASUMS256.txt` published beside it on nodejs.org, and pass
  the unpacked folder.
- **PostgreSQL with PostGIS:** from the EDB `postgresql-16.15-4.zip`, copy
  `pgsql/bin`, `pgsql/lib`, `pgsql/share` and its three license text files
  into a new `pgsql` folder, leaving out pgAdmin, StackBuilder, the headers
  and the documentation, which the application never runs. Then copy the
  PostGIS bundle `postgis-bundle-pg16-3.6.2x64.zip` (checked against its
  published MD5) over it, as the bundle's `README.txt` directs: its `bin`,
  `gdal-data`, `lib`, `share` and `utils` folders and its top-level license
  and version files. The result is about 400 MB.

## Stage and compile

Run from the repository root after the desktop build and runtime inputs are
ready. The examples use absolute paths so the generated package is
reproducible from a release workspace.

```powershell
$repo = 'C:/Users/17076/Documents/Open Source EOC'
# Both runtimes must carry the license files listed under License notices.
$nodeRuntime = 'C:/runtimes/node-win-x64' # the official Node Windows zip, unpacked
$postgresRuntime = "$repo/deploy/test-runtime/out/pgsql"
$hostTools = 'C:/runtimes/host-tools' # caddy/ and winsw/, unpacked as in step 7
& pwsh.exe -NoLogo -NoProfile -File "$repo/deploy/windows/installer/Stage-Installer.ps1" `
  -RepoRoot $repo `
  -NodeRuntime $nodeRuntime `
  -PostgresRuntime $postgresRuntime `
  -CaddyRuntime "$hostTools/caddy" `
  -WinswRuntime "$hostTools/winsw" `
  -DesktopBuildRoot "$repo/deploy/windows/out/build/app-dist" `
  -IncludeOptionalBasemaps `
  -Clean
node --test "$repo/deploy/windows/installer/installer.test.mjs"
& pwsh.exe -NoLogo -NoProfile -File "$repo/deploy/windows/installer/Build-Installer.ps1" `
  -Iscc 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'
```

The result is
`deploy/windows/out/installer/Open-Source-EOC-Setup-0.9.9.exe`. The stage is
an ignored generated artifact. Inspect its `package-manifest.json` before
publishing a release. It records source and desktop-build provenance, each
staged file's byte count and SHA-256, and whether optional map archives were
deliberately included. `Build-Installer.ps1` verifies the recorded file count,
paths, sizes, and hashes immediately before calling Inno Setup; any mutation of
the staged application requires a fresh stage.

## Finite acceptance commands

These commands are for the packaging owner after the release build exists.
They are not a substitute for the application gate.

```powershell
$repo = 'C:/Users/17076/Documents/Open Source EOC'
$setup = "$repo/deploy/windows/out/installer/Open-Source-EOC-Setup-0.9.9.exe"
Test-Path "$repo/deploy/windows/out/installer-stage/package-manifest.json"
Test-Path $setup
Start-Process -FilePath $setup -Wait
$app = "$env:LOCALAPPDATA/Programs/Open Source EOC/app/deploy/windows/Open Source EOC.cmd"
& $app -Action Launch -Profile demo -NoBrowser
$profile = Get-Content "$env:LOCALAPPDATA/Open Source EOC/profiles/demo/profile.json" -Raw | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($profile.httpPort)/api/v1/ready"
& $app -Action Stop -Profile demo
Test-Path "$env:LOCALAPPDATA/Open Source EOC/profiles/demo/profile.json"
```

Use the Start Menu **Open Source EOC** shortcut for production. Its first
launch collects the production bootstrap details in PowerShell. Use **Open
Source EOC Demo** only for synthetic exercise data. Uninstall invokes the
bounded owned-process stop action for production and demo profiles
once each; it still preserves their operational data directories.

## Second-machine transfer check

This check proves provisioning with no network on a computer that has never
held this repository or its tools. Use a Windows 10 or 11 x64 computer with no
earlier Open Source EOC install. Edge, which Windows includes, serves as the
app window. Record each timing and take each screenshot named below.

On the build computer:

1. Write the setup's hash beside it, then copy both files to removable media:

   ```powershell
   $setup = 'deploy/windows/out/installer/Open-Source-EOC-Setup-0.9.9.exe'
   (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() | Set-Content "$setup.sha256"
   ```

On the target computer:

2. Disconnect it: unplug the network cable and turn on airplane mode. Keep it
   disconnected until the last step.
3. Copy both files from the media to `Downloads`, then check the hash. The
   command must print `True`, and the hash must equal the one in the receipt
   for this build:

   ```powershell
   $setup = "$env:USERPROFILE\Downloads\Open-Source-EOC-Setup-0.9.9.exe"
   (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() -ceq (Get-Content "$setup.sha256").Trim()
   ```

4. Run the setup and accept the defaults. The setup is not code-signed; if
   Windows warns about an unknown publisher, choose **More info**, then **Run
   anyway**. Record the time from starting the setup to **Finish**.
5. Start **Open Source EOC Demo** from the Start Menu. The first launch creates
   the demo database and synthetic data. Record the time from the click to the
   sign-in page.
6. Sign in as `jordan.lee@humboldt.example` with `north-coast-exercise`; the
   demo's synthetic accounts sign in with a password alone. Screenshot the
   console.
7. Open **Map** and zoom to Eureka until street names show. Screenshot the
   county view and the street view; the attribution should name
   OpenStreetMap.
8. In **Search addresses and places**, type `816 3rd street eureka` and choose
   the first result. The map should center on the address. Screenshot it.
9. Confirm the profile and stop it:

   ```powershell
   $app = "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd"
   & $app -Action Status -Profile demo
   & $app -Action Stop -Profile demo
   ```

Report the hash result, the two timings, the screenshots and anything that
failed or needed a workaround. The disconnected-provisioning rows in the parity
matrix move to verified only on that record.
