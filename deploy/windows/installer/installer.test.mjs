import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("Inno Setup installer is per-user by default and leaves operational data outside its uninstall tree", () => {
  const source = read("Open-Source-EOC.iss");
  assert.match(source, /^PrivilegesRequired=lowest$/m);
  assert.match(source, /^PrivilegesRequiredOverridesAllowed=dialog$/m);
  // {autopf} is the user's own programs folder per user and Program Files for all users.
  assert.match(source, /^DefaultDirName=\{autopf\}\\Open Source EOC$/m);
  assert.match(source, /^\[UninstallRun\]$/m);
  assert.doesNotMatch(source, /^\[UninstallDelete\]$/m);
  assert.match(source, /Open Source EOC Demo/);
  assert.match(source, /#ifndef StagedAppRoot/);
  assert.ok(source.includes('Source: "{#StagedAppRoot}\\*";'));
});

test("installed launcher uses bundled runtime and an external per-user data root", () => {
  const launcher = read("../Open-Source-EOC.ps1");
  const desktop = read("../desktop.mjs");
  assert.match(launcher, /desktop-install\.json/);
  assert.match(launcher, /runtime\/node\/node\.exe/);
  assert.match(launcher, /OPENEOC_DESKTOP_DATA_ROOT/);
  assert.match(launcher, /\$profileDataRoot = \$env:OPENEOC_DESKTOP_DATA_ROOT/);
  assert.match(launcher, /Join-Path \$env:LOCALAPPDATA 'Open Source EOC'/);
  assert.match(launcher, /\$allowedProfiles = @\('production', 'demo'\)/);
  assert.match(launcher, /-not \$installed -and \$env:OPENEOC_ENABLE_ACCEPTANCE_PROFILE -eq '1'/);
  assert.match(launcher, /\$Profile -notin \$allowedProfiles/);
  assert.match(desktop, /OPENEOC_DESKTOP_PREBUILT/);
  assert.match(desktop, /desktopBuildSourceFingerprint/);
  assert.match(desktop, /if \(!prebuiltDesktop\) files\.push\(resolve\(repoRoot, "web\/node_modules\/vite/);
  assert.match(desktop, /async function launchProfile/);
  assert.match(desktop, /if \(action === "launch"\) return launchProfile/);
});

test("stager reads the launcher's canonical content fingerprint instead of reimplementing it", () => {
  const fingerprint = read("../lib/build-fingerprint.mjs");
  const bridge = read("source-fingerprint.mjs");
  assert.match(fingerprint, /DESKTOP_BUILD_SOURCE_INPUTS/);
  assert.match(fingerprint, /function desktopBuildSourceFingerprint/);
  assert.match(bridge, /import \{ desktopBuildSourceFingerprint \} from "\.\.\/lib\/build-fingerprint\.mjs"/);
  assert.doesNotMatch(bridge, /createHash|DESKTOP_BUILD_SOURCE_INPUTS/);
});

test("staging requires real local runtimes and excludes test cluster state", () => {
  const source = read("Stage-Installer.ps1");
  assert.match(source, /PostgreSQL runtime binary/);
  assert.match(source, /PostGIS extension control file/);
  assert.match(source, /must name the pgsql distribution directory/);
  assert.match(source, /forbidden test state/);
  assert.match(source, /-Directory -Recurse -Filter '__tests__' \| Remove-Item -Recurse -Force/);
  assert.match(source, /^#requires -Version 7\.0$/m);
  assert.match(source, /function Resolve-ReparsePoint/);
  assert.match(source, /function Assert-NoReparsePoints/);
  assert.match(source, /function Assert-IsolatedRuntimeGraph/);
  assert.match(source, /ISOLATED_RUNTIME_MODULES_READY/);
  assert.match(source, /deploy' '--prod' '--legacy' '--node-linker=hoisted/);
  assert.match(source, /cyclic reparse path/);
  assert.match(source, /repeats a reparse target/);
  assert.match(source, /outside the system temporary directory/);
  assert.match(source, /server\/migrations/);
  assert.match(source, /optionalBasemapsBundled/);
  assert.match(source, /if \(\$IncludeOptionalBasemaps\)/);
  assert.match(source, /function Require-FreshDesktopBuild/);
  assert.match(source, /source-fingerprint\.mjs/);
  assert.match(source, /Desktop build is stale/);
  assert.match(source, /sha256 = \(Get-FileHash/);
  assert.match(source, /schema = 2/);
  assert.match(source, /source = \$buildProvenance\.source/);
  assert.match(source, /build = \$buildProvenance\.build/);
});

test("compiler binds its explicit stage and refuses a mislabeled release", () => {
  const source = read("Build-Installer.ps1");
  assert.match(source, /^#requires -Version 7\.0$/m);
  assert.match(source, /Requested installer version \$Version does not match the staged runtime version/);
  assert.match(source, /function Assert-StageIntegrity/);
  assert.match(source, /Installer stage file count changed/);
  assert.match(source, /Installer stage file changed/);
  assert.match(source, /Get-FileHash/);
  assert.match(source, /"\/DStagedAppRoot=\$app"/);
});

test("installer version comes from the root package, with no stale default anywhere", () => {
  const packageVersion = JSON.parse(read("../../../package.json")).version;
  for (const script of ["Stage-Installer.ps1", "Build-Installer.ps1"])
    assert.match(read(script), /\[string\]\$Version = \(Get-Content -LiteralPath \(Join-Path .+package\.json'\) -Raw \| ConvertFrom-Json\)\.version/);
  assert.match(read("Open-Source-EOC.iss"), /#ifndef AppVersion\r?\n#error /);
  const readme = read("README.md");
  assert.doesNotMatch(readme, /0\.0\.0/);
  assert.ok(readme.includes(`Open-Source-EOC-Setup-${packageVersion}.exe`));
});

test("stage carries the install icons and, with the archives, the address search gazetteer", () => {
  const stager = read("Stage-Installer.ps1");
  const desktop = read("../desktop.mjs");
  assert.match(stager, /@\('fonts', 'napsg', 'icons'\)/);
  assert.match(stager, /Copy-File \(Join-Path \$OptionalBasemapRoot \$file\)/);
  assert.match(stager, /'tools\/basemap\/out\/gazetteer\.tsv'\) \(Join-Path \$appRoot 'tools\/basemap\/out\/gazetteer\.tsv'\)/);
  assert.match(desktop, /resolve\(repoRoot, "tools\/basemap\/out\/gazetteer\.tsv"\)/);
  assert.match(desktop, /process\.env\.OPENEOC_GAZETTEER_PATH = gazetteer/);
});

test("stage carries each runtime license text and the third-party notices that name them", () => {
  const stager = read("Stage-Installer.ps1");
  const notices = read("THIRD-PARTY-NOTICES.txt");
  const expected = {
    "node-LICENSE.txt": "NodeRuntime 'LICENSE'",
    "postgresql-server_license.txt": "PostgresRuntime 'server_license.txt'",
    "postgresql-commandlinetools_3rd_party_licenses.txt": "PostgresRuntime 'commandlinetools_3rd_party_licenses.txt'",
    "postgresql-StackBuilder_3rd_party_licenses.txt": "PostgresRuntime 'StackBuilder_3rd_party_licenses.txt'",
    "postgis-bundle-COPYING-GPL-2.0.txt": "PostgresRuntime 'bin/COPYING'",
    "postgis-bundle-LICENSE-Apache-2.0.txt": "PostgresRuntime 'LICENSE'",
    "pg_sphere-COPYRIGHT.txt": "PostgresRuntime 'COPYRIGHT.pg_sphere'",
    "ogr_fdw-LICENSE.md": "PostgresRuntime 'ogrfdw_LICENSE.md'",
    "pointcloud-COPYRIGHT.txt": "PostgresRuntime 'pgpointcloud_COPYRIGHT'",
    "gdal-LICENSE.txt": "PostgresRuntime 'gdal-data/LICENSE.TXT'",
    "caddy-LICENSE.txt": "CaddyRuntime 'LICENSE'",
    "winsw-LICENSE.txt": "WinswRuntime 'LICENSE.txt'",
  };
  const staged = Object.fromEntries(
    [...stager.matchAll(/^ {2}'([^']+)' = Join-Path \$(\w+ '[^']+')$/gm)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(staged, expected);
  assert.match(stager, /throw "Runtime license text is missing: /);
  assert.match(stager, /Copy-File \$license\.Value \(Join-Path \$appRoot "licenses\/\$\(\$license\.Key\)"\)/);
  assert.match(stager, /'installer\/THIRD-PARTY-NOTICES\.txt'\) \(Join-Path \$appRoot 'THIRD-PARTY-NOTICES\.txt'\)/);
  assert.match(stager, /default_version\\s\*=/);
  assert.match(stager, /does not name the shipped PostGIS/);
  // The notices name exactly the files the stage writes, so neither can drift from the other.
  const named = [...new Set([...notices.matchAll(/(?<![\w/])licenses\/([\w.+-]+)/g)].map((m) => m[1].replace(/\.$/, "")))];
  assert.deepEqual(named.sort(), Object.keys(expected).sort());
  assert.match(notices, /© OpenStreetMap contributors/);
  assert.match(notices, /https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\//);
  assert.match(notices, /WRITTEN OFFER FOR SOURCE CODE/);
  assert.match(notices, /PostGIS \d+\.\d+\.\d+\b/);
  assert.match(notices, /web\/public\/napsg\/CC-BY-4\.0\.txt/);
  assert.match(notices, /overlays\.pmtiles/);
  assert.ok(!notices.includes(String.fromCharCode(0x2014)), "the notices use no em dash");
});

test("installer ships only operator-facing production and demo profiles", () => {
  const source = read("Open-Source-EOC.iss");
  for (const profile of ["production", "demo"])
    assert.match(source, new RegExp(`-Action Stop -Profile ${profile}`));
  assert.match(source, /RunOnceId: "OpenSourceEOCStopProduction"/);
  assert.match(source, /RunOnceId: "OpenSourceEOCStopDemo"/);
  assert.doesNotMatch(source, /acceptance/i);
  assert.doesNotMatch(source, /RunOnceId: "OpenSourceEOCStopAcceptance"/);
});

test("installing for all users offers the network host, which the setup installs and the uninstaller removes", () => {
  const source = read("Open-Source-EOC.iss");
  assert.match(source, /^Name: "host"; .*Check: IsAdminInstallMode$/m);
  assert.match(source, /^Name: "host\\production"; .*Flags: exclusive$/m);
  assert.match(source, /^Name: "host\\demo"; .*Flags: exclusive unchecked$/m);
  assert.match(source, /Parameters: "-Action HostInstall -Profile host -Pause"; .*Tasks: host\\production; Flags: waituntilterminated$/m);
  assert.match(source, /Parameters: "-Action HostInstall -Profile host-demo -Pause"; .*Tasks: host\\demo; Flags: waituntilterminated$/m);
  assert.match(source, /Test-OpenEOCHost\.ps1""".*Tasks: host; Flags: postinstall nowait skipifsilent$/m);
  assert.match(source, /Parameters: "-Action HostRemove"; .*RunOnceId: "OpenSourceEOCHostRemove"$/m);
  // An upgrade stops the host's services before it replaces their programs.
  assert.match(source, /function PrepareToInstall[\s\S]+IsAdminInstallMode[\s\S]+Get-Service -Name ''OpenSourceEOC-\*''[\s\S]+Stop-Service -Force/);
  // The app can open a network host instead of its own server.
  assert.match(source, /^Name: "\{group\}\\Open Source EOC on a network host"; Filename: "\{app\}\\app\\deploy\\windows\\Open Source EOC\.cmd"; Parameters: "-Action Connect"/m);
  // The per-user demo opens as the person who ran the setup, never elevated.
  assert.match(source, /-Action Launch -Profile demo".*Tasks: not host; Flags: postinstall nowait skipifsilent runhidden runasoriginaluser$/m);

  const stager = read("Stage-Installer.ps1");
  assert.match(stager, /Copy-File \(Join-Path \$CaddyRuntime 'caddy\.exe'\) \(Join-Path \$appRoot 'runtime\/caddy\/caddy\.exe'\)/);
  assert.match(stager, /Copy-File \(Join-Path \$WinswRuntime 'WinSW-x64\.exe'\) \(Join-Path \$appRoot 'runtime\/winsw\/WinSW-x64\.exe'\)/);
  assert.match(stager, /'Open Source EOC\.cmd', 'Test-OpenEOCHost\.ps1'/);
  const desktop = read("../desktop.mjs");
  assert.match(desktop, /resolve\(repoRoot, "runtime\/caddy\/caddy\.exe"\)/);
  assert.match(desktop, /resolve\(repoRoot, "runtime\/winsw\/WinSW-x64\.exe"\)/);
  const launcher = read("../Open-Source-EOC.ps1");
  assert.match(launcher, /Join-Path \$env:ProgramData 'Open Source EOC'/);
});
