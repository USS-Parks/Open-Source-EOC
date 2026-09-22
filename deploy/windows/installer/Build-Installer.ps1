#requires -Version 7.0
[CmdletBinding()]
param(
  [string]$StageRoot = (Join-Path $PSScriptRoot '../out/installer-stage'),
  [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$')]
  [string]$Version = '0.0.0',
  [string]$Iscc
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function RelativeFiles([string]$Root) {
  $rootPath = (Resolve-Path -LiteralPath $Root).Path
  return @(Get-ChildItem -LiteralPath $rootPath -File -Recurse | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
      path = [System.IO.Path]::GetRelativePath($rootPath, $_.FullName).Replace('\', '/')
      bytes = [int64]$_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  })
}

function Assert-StageIntegrity($StageManifest, [string]$AppRoot) {
  if ($StageManifest.schema -ne 2) { throw 'Installer stage schema is unsupported.' }
  if (-not $StageManifest.source -or -not $StageManifest.build) { throw 'Installer stage provenance is missing.' }
  if ([string]$StageManifest.source.repoRoot -eq '' -or [string]$StageManifest.source.sha256 -notmatch '^[a-f0-9]{64}$' -or [int64]$StageManifest.source.files -le 0) {
    throw 'Installer stage source provenance is invalid.'
  }
  if ([string]$StageManifest.build.root -eq '' -or [string]$StageManifest.build.stampPath -eq '' -or [string]$StageManifest.build.sourceHash -cne [string]$StageManifest.source.sha256 -or [int64]$StageManifest.build.sourceFiles -ne [int64]$StageManifest.source.files) {
    throw 'Installer stage build provenance does not match its source.'
  }
  $rootPath = (Resolve-Path -LiteralPath $AppRoot).Path
  $expected = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($file in @($StageManifest.files)) {
    $relativePath = [string]$file.path
    if ($relativePath -eq '' -or $relativePath -match '(^|/)\.\.(/|$)' -or $relativePath.StartsWith('/') -or $relativePath.Contains('\')) {
      throw "Installer manifest path is invalid: $relativePath"
    }
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relativePath.Replace('/', '\')))
    if (-not $resolved.StartsWith($rootPath + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Installer manifest path escapes the staged application: $relativePath"
    }
    if ([int64]$file.bytes -lt 0 -or [string]$file.sha256 -notmatch '^[a-f0-9]{64}$') {
      throw "Installer manifest integrity entry is invalid: $relativePath"
    }
    if (-not $expected.TryAdd($relativePath, $file)) { throw "Installer manifest contains a duplicate path: $relativePath" }
  }
  $actual = RelativeFiles $rootPath
  if ($actual.Count -ne $expected.Count) {
    throw "Installer stage file count changed ($($expected.Count) expected, $($actual.Count) found). Restage before compiling."
  }
  foreach ($file in $actual) {
    if (-not $expected.ContainsKey($file.path)) { throw "Installer stage contains an unmanifested file: $($file.path)" }
    $recorded = $expected[$file.path]
    if ([int64]$recorded.bytes -ne [int64]$file.bytes -or [string]$recorded.sha256 -cne [string]$file.sha256) {
      throw "Installer stage file changed: $($file.path). Restage before compiling."
    }
  }
}

$StageRoot = [System.IO.Path]::GetFullPath($StageRoot)
$manifest = Join-Path $StageRoot 'package-manifest.json'
$app = Join-Path $StageRoot 'app'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Generated stage marker is missing: $manifest" }
if (-not (Test-Path -LiteralPath (Join-Path $app 'desktop-install.json') -PathType Leaf)) {
  throw "Installed layout marker is missing: $app"
}
$stageManifest = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$layout = Get-Content -LiteralPath (Join-Path $app 'desktop-install.json') -Raw | ConvertFrom-Json
if ($layout.schema -ne 1) { throw 'Installer stage schema is unsupported.' }
if ([string]$stageManifest.version -cne $Version -or [string]$layout.version -cne $Version) {
  throw "Requested installer version $Version does not match the staged runtime version. Restage before compiling."
}
Assert-StageIntegrity $stageManifest $app
if (-not $Iscc) {
  $candidate = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if (-not $candidate) { throw 'Inno Setup 6 is required. Install it, then pass -Iscc with the absolute iscc.exe path.' }
  $Iscc = $candidate.Source
}
if (-not (Test-Path -LiteralPath $Iscc -PathType Leaf)) { throw "Inno Setup compiler is missing: $Iscc" }

$manifestPath = Join-Path $PSScriptRoot 'Open-Source-EOC.iss'
& $Iscc "/DAppVersion=$Version" "/DStagedAppRoot=$app" $manifestPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "INSTALLER_BUILD_READY version=$Version output=$(Join-Path $PSScriptRoot '../out/installer')"
