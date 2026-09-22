[CmdletBinding()]
param(
  [ValidateSet('Build', 'Setup', 'Start', 'Status', 'Stop', 'Launch')]
  [string]$Action = 'Launch',
  [ValidateSet('production', 'demo', 'acceptance')]
  [string]$Profile = 'production',
  [ValidateRange(1024, 65535)]
  [int]$PgPort,
  [ValidateRange(1024, 65535)]
  [int]$HttpPort,
  [switch]$NoBrowser,
  [string]$AdminEmail,
  [string]$AdminName,
  [string]$JurisdictionSlug,
  [string]$JurisdictionName
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '../..'))
$entry = Join-Path $scriptRoot 'desktop.mjs'
$installedMarker = Join-Path $repoRoot 'desktop-install.json'
$profileDataRoot = Join-Path $scriptRoot 'out'
if (Test-Path -LiteralPath $installedMarker) {
  $bundledNode = Join-Path $repoRoot 'runtime/node/node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) { throw "Installed Node runtime is missing: $bundledNode" }
  if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required for installed Open Source EOC data.' }
  $env:OPENEOC_DESKTOP_PREBUILT = '1'
  $env:OPENEOC_DESKTOP_DATA_ROOT = Join-Path $env:LOCALAPPDATA 'Open Source EOC'
  $env:OPENEOC_DESKTOP_DIST_ROOT = Join-Path $repoRoot 'web/dist'
  $env:OPENEOC_DESKTOP_PUBLIC_ROOT = Join-Path $repoRoot 'web/public'
  $env:OPENEOC_PG_DIST = Join-Path $repoRoot 'runtime/pgsql'
  $profileDataRoot = $env:OPENEOC_DESKTOP_DATA_ROOT
  $node = $bundledNode
} else {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
}
Set-Location -LiteralPath $repoRoot

$arguments = @($entry, $Action.ToLowerInvariant())
if ($Action -ne 'Build') {
  $arguments += "--profile=$Profile"
}
if ($PSBoundParameters.ContainsKey('PgPort')) {
  $arguments += "--pg-port=$PgPort"
}
if ($PSBoundParameters.ContainsKey('HttpPort')) {
  $arguments += "--http-port=$HttpPort"
}
if (($Action -eq 'Start' -or $Action -eq 'Launch') -and $NoBrowser) {
  $arguments += '--no-browser'
}

$secretPointer = [IntPtr]::Zero
$plainPassword = $null
try {
  if (($Action -eq 'Setup' -or $Action -eq 'Launch') -and $Profile -eq 'production') {
    $profileConfig = Join-Path $profileDataRoot 'profiles/production/profile.json'
    $profileRoot = Split-Path -Parent $profileConfig
    $emptyProfile = -not (Test-Path -LiteralPath $profileRoot) -or @((Get-ChildItem -LiteralPath $profileRoot -Force -ErrorAction SilentlyContinue)).Count -eq 0
    if (-not (Test-Path -LiteralPath $profileConfig) -and $emptyProfile) {
      if (-not $AdminEmail) { $AdminEmail = Read-Host 'Initial administrator email' }
      if (-not $AdminName) { $AdminName = Read-Host 'Initial administrator display name' }
      if (-not $JurisdictionSlug) { $JurisdictionSlug = Read-Host 'Jurisdiction slug (lowercase letters, numbers, hyphens)' }
      if (-not $JurisdictionName) { $JurisdictionName = Read-Host 'Jurisdiction name' }
      $securePassword = Read-Host 'Initial administrator password (12 or more characters)' -AsSecureString
      $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
      $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
      if ($plainPassword.Length -lt 12) { throw 'Initial administrator password must contain at least 12 characters.' }
      $env:OPENEOC_BOOTSTRAP_PASSWORD = $plainPassword
      $arguments += "--admin-email=$AdminEmail"
      $arguments += "--admin-name=$AdminName"
      $arguments += "--jurisdiction-slug=$JurisdictionSlug"
      $arguments += "--jurisdiction-name=$JurisdictionName"
    }
  }

  & $node @arguments
  $commandExit = $LASTEXITCODE
} finally {
  Remove-Item Env:OPENEOC_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  $plainPassword = $null
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
}

if ($commandExit -ne 0) { exit $commandExit }
