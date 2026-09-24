#requires -Version 7.0
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path,
  [string]$StageRoot = (Join-Path $PSScriptRoot '../out/installer-stage'),
  [Parameter(Mandatory)]
  [string]$NodeRuntime,
  [Parameter(Mandatory)]
  [string]$PostgresRuntime,
  [string]$DesktopBuildRoot = (Join-Path $RepoRoot 'deploy/windows/out/build/app-dist'),
  [string]$Pnpm = 'pnpm.cmd',
  # The release version is the root package version unless a release names another.
  [string]$Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version,
  [switch]$IncludeOptionalBasemaps,
  # The large archives are ignored files; a release workspace may keep them outside the checkout.
  [string]$OptionalBasemapRoot = (Join-Path $RepoRoot 'web/public/basemap'),
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') { throw "Installer version is invalid: $Version" }
$script:SeenReparseTargets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

function AbsolutePath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Require-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
}

function Require-Directory([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label is missing: $Path" }
}

function Resolve-ReparsePoint([System.IO.FileSystemInfo]$Item) {
  $target = @($Item.Target | Select-Object -First 1)[0]
  if (-not $target) { throw "Packaging input link has no target: $($Item.FullName)" }
  $parent = if ($Item -is [System.IO.DirectoryInfo]) { $Item.Parent } else { $Item.Directory }
  if (-not $parent) { throw "Packaging input link has no parent: $($Item.FullName)" }
  $candidate = if ([System.IO.Path]::IsPathRooted($target)) { $target } else { Join-Path $parent.FullName $target }
  if (-not (Test-Path -LiteralPath $candidate)) { throw "Packaging input link target is missing: $candidate" }
  return Get-Item -LiteralPath $candidate -Force
}

function Copy-Tree(
  [string]$Source,
  [string]$Destination,
  [System.Collections.Generic.HashSet[string]]$Lineage = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
) {
  Require-Directory $Source 'Packaging input directory'
  $sourceItem = Get-Item -LiteralPath $Source -Force
  if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    $sourceItem = Resolve-ReparsePoint $sourceItem
    if (-not $script:SeenReparseTargets.Add($sourceItem.FullName)) {
      throw "Packaging input repeats a reparse target and is not a bounded portable closure: $($sourceItem.FullName)"
    }
  }
  if (-not $Lineage.Add($sourceItem.FullName)) {
    throw "Packaging input contains a cyclic reparse path: $($sourceItem.FullName)"
  }
  try {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($child in @(Get-ChildItem -LiteralPath $sourceItem.FullName -Force)) {
      $childDestination = Join-Path $Destination $child.Name
      if ($child.PSIsContainer) {
        Copy-Tree $child.FullName $childDestination $Lineage
      } else {
        Copy-File $child.FullName $childDestination
      }
    }
  } finally {
    [void]$Lineage.Remove($sourceItem.FullName)
  }
}

function Copy-File([string]$Source, [string]$Destination) {
  Require-File $Source 'Packaging input file'
  $sourceItem = Get-Item -LiteralPath $Source -Force
  if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    $sourceItem = Resolve-ReparsePoint $sourceItem
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $sourceItem.FullName -Destination $Destination -Force
}

function Assert-NoReparsePoints([string]$Root) {
  $links = @(Get-ChildItem -LiteralPath $Root -Force -Recurse | Where-Object {
    ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  })
  if ($links.Count -gt 0) {
    throw "Staged runtime contains reparse points and could resolve outside the installer: $($links[0].FullName)"
  }
}

function Assert-IsolatedRuntimeGraph([string]$AppRoot) {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/'))
  $probeRoot = Join-Path $tempRoot "openeoc-installer-probe-$PID"
  if (-not $probeRoot.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary module probe escaped the system temporary directory: $probeRoot"
  }
  if (Test-Path -LiteralPath $probeRoot) { throw "Temporary module probe already exists: $probeRoot" }
  try {
    New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
    Copy-File (Join-Path $AppRoot 'package.json') (Join-Path $probeRoot 'package.json')
    foreach ($directory in @('server', 'node_modules', 'deploy/windows')) {
      Copy-Tree (Join-Path $AppRoot $directory) (Join-Path $probeRoot $directory)
    }
    Push-Location $probeRoot
    try {
      & (Join-Path $AppRoot 'runtime/node/node.exe') --import './deploy/windows/ts-loader.mjs' --input-type=module --eval 'await import("./server/src/app.ts"); console.log("ISOLATED_RUNTIME_MODULES_READY")'
      if ($LASTEXITCODE -ne 0) { throw 'Isolated staged server runtime module graph did not load.' }
    } finally {
      Pop-Location
    }
  } finally {
    if (Test-Path -LiteralPath $probeRoot) {
      $resolvedProbe = (Resolve-Path -LiteralPath $probeRoot).Path
      if (-not $resolvedProbe.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a module probe outside the system temporary directory: $resolvedProbe"
      }
      Remove-Item -LiteralPath $resolvedProbe -Recurse -Force
    }
  }
}

function RelativeFiles([string]$Root) {
  $rootPath = (Resolve-Path -LiteralPath $Root).Path
  return @(Get-ChildItem -LiteralPath $rootPath -File -Recurse | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
      path = [System.IO.Path]::GetRelativePath($rootPath, $_.FullName).Replace('\', '/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  })
}

function Require-FreshDesktopBuild([string]$Root, [string]$BuildRoot, [string]$RuntimeRoot) {
  $stampPath = Join-Path (Split-Path -Parent $BuildRoot) 'build-stamp.json'
  Require-File $stampPath 'Desktop build stamp'
  $stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
  if ($stamp.schema -ne 1) { throw "Desktop build stamp schema is unsupported: $stampPath" }
  if ([string]$stamp.sourceHash -notmatch '^[a-f0-9]{64}$' -or [int64]$stamp.sourceFiles -le 0 -or [string]$stamp.revision -eq '' -or [string]$stamp.builtAt -eq '') {
    throw "Desktop build stamp is incomplete: $stampPath"
  }
  $fingerprintTool = Join-Path $Root 'deploy/windows/installer/source-fingerprint.mjs'
  Require-File $fingerprintTool 'Desktop source fingerprint tool'
  $fingerprintJson = & (Join-Path $RuntimeRoot 'node.exe') $fingerprintTool $Root
  if ($LASTEXITCODE -ne 0) { throw 'Desktop source fingerprint could not be calculated.' }
  $fingerprint = $fingerprintJson | ConvertFrom-Json
  if ($fingerprint.schema -ne 1 -or [string]$fingerprint.repoRoot -cne $Root) {
    throw 'Desktop source fingerprint is not bound to the requested repository root.'
  }
  if ([string]$fingerprint.sourceHash -notmatch '^[a-f0-9]{64}$' -or [int64]$fingerprint.sourceFiles -le 0) {
    throw 'Desktop source fingerprint is incomplete.'
  }
  if ([string]$stamp.sourceHash -cne [string]$fingerprint.sourceHash -or [int64]$stamp.sourceFiles -ne [int64]$fingerprint.sourceFiles) {
    throw "Desktop build is stale for $Root. Rebuild before staging the installer."
  }
  return [ordered]@{
    source = [ordered]@{
      repoRoot = $Root
      sha256 = [string]$fingerprint.sourceHash
      files = [int64]$fingerprint.sourceFiles
    }
    build = [ordered]@{
      root = $BuildRoot
      stampPath = $stampPath
      revision = [string]$stamp.revision
      builtAt = [string]$stamp.builtAt
      sourceHash = [string]$stamp.sourceHash
      sourceFiles = [int64]$stamp.sourceFiles
    }
  }
}

$RepoRoot = AbsolutePath $RepoRoot
$StageRoot = AbsolutePath $StageRoot
$NodeRuntime = AbsolutePath $NodeRuntime
$PostgresRuntime = AbsolutePath $PostgresRuntime
$DesktopBuildRoot = AbsolutePath $DesktopBuildRoot
$OptionalBasemapRoot = AbsolutePath $OptionalBasemapRoot
$Pnpm = (Get-Command $Pnpm -CommandType Application -ErrorAction Stop | Select-Object -First 1).Path
$windowsRoot = AbsolutePath (Join-Path $RepoRoot 'deploy/windows')
$allowedStageRoot = AbsolutePath (Join-Path $windowsRoot 'out')
if (-not $StageRoot.StartsWith($allowedStageRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "StageRoot must stay below $allowedStageRoot"
}

Require-Directory $RepoRoot 'Repository root'
Require-Directory $DesktopBuildRoot 'Fresh desktop web build'
Require-File (Join-Path $DesktopBuildRoot 'index.html') 'Fresh desktop web build index'
Require-File (Join-Path $NodeRuntime 'node.exe') 'Portable Node runtime'
foreach ($binary in @('createdb.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe')) {
  Require-File (Join-Path $PostgresRuntime "bin/$binary") 'PostgreSQL runtime binary'
}
Require-File (Join-Path $PostgresRuntime 'share/extension/postgis.control') 'PostGIS extension control file'

# The stage takes only the PostgreSQL distribution, never the parent test-runtime
# directory or its cluster, password, logs, browser state, or other user data.
if ((Split-Path -Leaf $PostgresRuntime).ToLowerInvariant() -ne 'pgsql') {
  throw 'PostgresRuntime must name the pgsql distribution directory, not a test-runtime parent.'
}
foreach ($forbidden in @('data', 'test-password.txt', 'postgres.log')) {
  if (Test-Path -LiteralPath (Join-Path $PostgresRuntime $forbidden)) {
    throw "PostgresRuntime contains forbidden test state: $forbidden"
  }
}

Require-File (Join-Path $RepoRoot 'node_modules/typescript/lib/typescript.js') 'TypeScript runtime loader dependency'
$buildProvenance = Require-FreshDesktopBuild $RepoRoot $DesktopBuildRoot $NodeRuntime

if (Test-Path -LiteralPath $StageRoot) {
  if (-not $Clean) { throw "StageRoot already exists: $StageRoot. Re-run with -Clean after inspecting it." }
  $marker = Join-Path $StageRoot 'package-manifest.json'
  Require-File $marker 'Existing generated stage marker'
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}

$temporary = "$StageRoot.$PID.tmp"
if (Test-Path -LiteralPath $temporary) { throw "Temporary stage already exists: $temporary" }
$appRoot = Join-Path $temporary 'app'
try {
  New-Item -ItemType Directory -Force -Path $appRoot | Out-Null

  foreach ($file in @('package.json', 'LICENSE', 'NOTICE')) {
    Copy-File (Join-Path $RepoRoot $file) (Join-Path $appRoot $file)
  }
  foreach ($file in @('desktop.mjs', 'ts-loader.mjs', 'Open-Source-EOC.ps1', 'Open Source EOC.cmd')) {
    Copy-File (Join-Path $windowsRoot $file) (Join-Path $appRoot "deploy/windows/$file")
  }
  Copy-Tree (Join-Path $windowsRoot 'lib') (Join-Path $appRoot 'deploy/windows/lib')

  Copy-File (Join-Path $RepoRoot 'server/package.json') (Join-Path $appRoot 'server/package.json')
  Copy-Tree (Join-Path $RepoRoot 'server/src') (Join-Path $appRoot 'server/src')
  # Test sources carry synthetic fixture accounts; the installed app keeps only the demo's.
  Get-ChildItem -LiteralPath (Join-Path $appRoot 'server/src') -Directory -Recurse -Filter '__tests__' | Remove-Item -Recurse -Force
  Copy-Tree (Join-Path $RepoRoot 'server/migrations') (Join-Path $appRoot 'server/migrations')
  # pnpm resolves the complete production graph, including a package's virtual
  # store siblings. Hoisted linking makes that closure portable before this
  # script materializes it without canonical-workspace junctions.
  $resolvedServerRoot = Join-Path $temporary '.resolved-server'
  & $Pnpm '--filter=@openeoc/server' 'deploy' '--prod' '--legacy' '--node-linker=hoisted' $resolvedServerRoot
  if ($LASTEXITCODE -ne 0) { throw 'pnpm could not resolve the server production runtime closure.' }
  try {
    Require-Directory (Join-Path $resolvedServerRoot 'node_modules') 'Resolved server production dependency tree'
    Require-File (Join-Path $resolvedServerRoot 'node_modules/fastify/fastify.js') 'Resolved Fastify runtime dependency'
    Require-File (Join-Path $resolvedServerRoot 'node_modules/postgres/src/index.js') 'Resolved PostgreSQL client runtime dependency'
    Require-File (Join-Path $resolvedServerRoot 'node_modules/@openeoc/shared/package.json') 'Resolved shared runtime dependency'
    Copy-Tree (Join-Path $resolvedServerRoot 'node_modules') (Join-Path $appRoot 'server/node_modules')
  } finally {
    if (Test-Path -LiteralPath $resolvedServerRoot) { Remove-Item -LiteralPath $resolvedServerRoot -Recurse -Force }
  }
  Copy-Tree (Join-Path $RepoRoot 'node_modules/typescript') (Join-Path $appRoot 'node_modules/typescript')
  Copy-Tree $DesktopBuildRoot (Join-Path $appRoot 'web/dist')

  $publicRoot = Join-Path $RepoRoot 'web/public'
  Require-File (Join-Path $publicRoot 'basemap/basemap.pmtiles') 'Bundled offline basemap'
  foreach ($file in @(Get-ChildItem -LiteralPath $publicRoot -File -ErrorAction SilentlyContinue)) {
    Copy-File $file.FullName (Join-Path $appRoot "web/public/$($file.Name)")
  }
  foreach ($directory in @('fonts', 'napsg', 'icons')) {
    $source = Join-Path $publicRoot $directory
    if (Test-Path -LiteralPath $source -PathType Container) {
      Copy-Tree $source (Join-Path $appRoot "web/public/$directory")
    }
  }
  foreach ($file in @('basemap.pmtiles', 'ca_counties.geojson')) {
    $source = Join-Path $publicRoot "basemap/$file"
    if (Test-Path -LiteralPath $source -PathType Leaf) {
      Copy-File $source (Join-Path $appRoot "web/public/basemap/$file")
    }
  }
  if ($IncludeOptionalBasemaps) {
    # A release that asks for the archives gets every one or fails; Copy-File refuses a missing input.
    foreach ($file in @('california.pmtiles', 'buildings.pmtiles', 'buildings-overture.json', 'overlays.pmtiles', 'overlays-manifest.json')) {
      Copy-File (Join-Path $OptionalBasemapRoot $file) (Join-Path $appRoot "web/public/basemap/$file")
    }
    # Address search reads the gazetteer built from california.pmtiles. It keeps the
    # builder's output path, outside web/public, so the static host never serves it.
    Copy-File (Join-Path $RepoRoot 'tools/basemap/out/gazetteer.tsv') (Join-Path $appRoot 'tools/basemap/out/gazetteer.tsv')
  }

  Copy-Tree $NodeRuntime (Join-Path $appRoot 'runtime/node')
  Copy-Tree $PostgresRuntime (Join-Path $appRoot 'runtime/pgsql')
  Assert-NoReparsePoints $appRoot
  [ordered]@{ schema = 1; version = $Version; prebuilt = $true } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'desktop-install.json') -Encoding utf8NoBOM

  Assert-IsolatedRuntimeGraph $appRoot

  $manifest = [ordered]@{
    schema = 2
    version = $Version
    createdAt = [DateTime]::UtcNow.ToString('o')
    nodeRuntime = 'runtime/node/node.exe'
    postgresRuntime = 'runtime/pgsql'
    optionalBasemapsBundled = [bool]$IncludeOptionalBasemaps
    source = $buildProvenance.source
    build = $buildProvenance.build
    files = RelativeFiles $appRoot
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $temporary 'package-manifest.json') -Encoding utf8NoBOM
  Move-Item -LiteralPath $temporary -Destination $StageRoot
  Write-Output "INSTALLER_STAGE_READY root=$StageRoot files=$($manifest.files.Count) optionalBasemaps=$([bool]$IncludeOptionalBasemaps)"
} catch {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  throw
}
