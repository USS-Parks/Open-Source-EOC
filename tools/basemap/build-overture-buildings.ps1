# Offline candidate-archive builder; not part of the deployed runtime.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OverturePath,
  [Parameter(Mandatory = $true)][string]$OsmPath,
  [Parameter(Mandatory = $true)][string]$PlanetilerJar,
  [Parameter(Mandatory = $true)][string]$PythonPath,
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [string]$OutputDirectory,
  [string]$StateBoundary,
  [string]$DuckDbExtensions
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here "..\..")).Path
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $here "out\h14"
}
if (-not $StateBoundary) {
  $StateBoundary = Join-Path $repo "web\public\basemap\ca_state.geojson"
}
if (-not $DuckDbExtensions) {
  $DuckDbExtensions = Join-Path (Split-Path -Parent $OverturePath) "duckdb-extensions"
}

$java = Join-Path $JavaHome "bin\java.exe"
$javac = Join-Path $JavaHome "bin\javac.exe"
$required = @(
  $OverturePath,
  $OsmPath,
  $PlanetilerJar,
  $PythonPath,
  $java,
  $javac,
  $StateBoundary,
  $DuckDbExtensions
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required local H14 input does not exist: $path"
  }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$lookup = Join-Path $output "building-enrichment.tsv"
$archive = Join-Path $output "buildings.pmtiles"
$temp = Join-Path $output "planetiler-tmp"
$classes = Join-Path $output "classes"
$manifest = Join-Path $output "build-manifest.json"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
New-Item -ItemType Directory -Path $classes -Force | Out-Null

& $PythonPath (Join-Path $here "build-overture-enrichment.py") `
  --source $OverturePath `
  --state $StateBoundary `
  --extensions $DuckDbExtensions `
  --output $lookup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $javac -proc:none -cp $PlanetilerJar -d $classes (Join-Path $here "OvertureBuildings.java")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$classpath = "$classes;$PlanetilerJar"
& $java -Xmx4g -cp $classpath org.openeoc.basemap.OvertureBuildings `
  $OsmPath `
  $lookup `
  $archive `
  $temp `
  $manifest `
  --threads=2 `
  --process_threads=2 `
  --write_threads=1 `
  --force=true
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "H14 candidate archive: $archive"
Write-Output "H14 lookup manifest: $(Join-Path $output 'lookup-manifest.json')"
Write-Output "H14 build manifest: $manifest"
