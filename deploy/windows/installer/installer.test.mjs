import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("Inno Setup installer is per-user and leaves operational data outside its uninstall tree", () => {
  const source = read("Open-Source-EOC.iss");
  assert.match(source, /^PrivilegesRequired=lowest$/m);
  assert.match(source, /^DefaultDirName=\{localappdata\}\\Programs\\Open Source EOC$/m);
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

test("installer ships only operator-facing production and demo profiles", () => {
  const source = read("Open-Source-EOC.iss");
  for (const profile of ["production", "demo"])
    assert.match(source, new RegExp(`-Action Stop -Profile ${profile}`));
  assert.match(source, /RunOnceId: "OpenSourceEOCStopProduction"/);
  assert.match(source, /RunOnceId: "OpenSourceEOCStopDemo"/);
  assert.doesNotMatch(source, /acceptance/i);
  assert.doesNotMatch(source, /RunOnceId: "OpenSourceEOCStopAcceptance"/);
});
