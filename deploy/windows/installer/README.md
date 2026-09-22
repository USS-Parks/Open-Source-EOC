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

## Data and uninstall behavior

Application files install below `%LOCALAPPDATA%\Programs\Open Source EOC`.
Operational data is deliberately separate at `%LOCALAPPDATA%\Open Source EOC`:

- PostgreSQL profile data and generated secrets
- uploads and blobs
- logs, process ownership records, and per-profile browser state

The uninstaller stops owned production, demo and acceptance processes, removes application
files, and preserves that data directory. This allows recovery after reinstall
and prevents an uninstall from destroying operational records. Removing the
data directory is an explicit administrator action outside this installer.

## Required build inputs

`Stage-Installer.ps1` does not download software. It requires these local,
reviewed inputs:

1. A portable Node distribution directory containing `node.exe`.
2. A PostgreSQL distribution directory named `pgsql`, including the PostGIS
   extension. The approved local source may be
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

The default package includes the baseline offline PMTiles map,
`ca_counties.geojson`, local fonts, NAPSG assets, and the selected application
build. Large California street, building, and overlay archives are excluded by
default. Add `-IncludeOptionalBasemaps` only for a release whose size budget
and source receipts cover those assets. The static host automatically discovers
those optional files when they are included.

## Stage and compile

Run from the repository root after the desktop build and runtime inputs are
ready. The examples use absolute paths so the generated package is
reproducible from a release workspace.

```powershell
$repo = 'C:/Users/17076/Documents/Open Source EOC'
$nodeRuntime = 'C:/Program Files/nodejs'
$postgresRuntime = "$repo/deploy/test-runtime/out/pgsql"
& pwsh.exe -NoLogo -NoProfile -File "$repo/deploy/windows/installer/Stage-Installer.ps1" `
  -RepoRoot $repo `
  -NodeRuntime $nodeRuntime `
  -PostgresRuntime $postgresRuntime `
  -DesktopBuildRoot "$repo/deploy/windows/out/build/app-dist" `
  -Version '0.0.0' `
  -Clean
node --test "$repo/deploy/windows/installer/installer.test.mjs"
& pwsh.exe -NoLogo -NoProfile -File "$repo/deploy/windows/installer/Build-Installer.ps1" `
  -Version '0.0.0' `
  -Iscc 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'
```

The result is
`deploy/windows/out/installer/Open-Source-EOC-Setup-0.0.0.exe`. The stage is
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
$setup = "$repo/deploy/windows/out/installer/Open-Source-EOC-Setup-0.0.0.exe"
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
bounded owned-process stop action for production, demo, and acceptance profiles
once each; it still preserves their operational data directories.
