[CmdletBinding()]
param(
  [ValidateSet('Build', 'Setup', 'Start', 'Status', 'Stop', 'Launch', 'Backup', 'HostInstall', 'HostRemove')]
  [string]$Action = 'Launch',
  [string]$Profile = 'production',
  [ValidateRange(1024, 65535)]
  [int]$PgPort,
  [ValidateRange(1024, 65535)]
  [int]$HttpPort,
  [ValidateRange(1, 36500)]
  [int]$KeepDays,
  [switch]$NoBrowser,
  [string]$AdminEmail,
  [string]$AdminName,
  [string]$JurisdictionSlug,
  [string]$JurisdictionName,
  # HostInstall: more names other computers use for this host, and an agency certificate in place of the host's own authority.
  [string[]]$HostName,
  [string]$Certificate,
  [string]$CertificateKey,
  # Keep the window open at the end, for a run the setup program opens.
  [switch]$Pause
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '../..'))
$entry = Join-Path $scriptRoot 'desktop.mjs'
$installedMarker = Join-Path $repoRoot 'desktop-install.json'
$profileDataRoot = Join-Path $scriptRoot 'out'
$installed = Test-Path -LiteralPath $installedMarker
$hostProfiles = @('host', 'host-demo')
$allowedProfiles = @('production', 'demo') + $hostProfiles
if (-not $installed -and $env:OPENEOC_ENABLE_ACCEPTANCE_PROFILE -eq '1') {
  $allowedProfiles += 'acceptance'
}
if ($Action -ne 'Build' -and $Profile -notin $allowedProfiles) {
  throw "Profile must be one of: $($allowedProfiles -join ', ')"
}
# The network host keeps its data for the whole computer; every other profile, for its Windows user.
$hostData = $Action -in @('HostInstall', 'HostRemove') -or $Profile -in $hostProfiles
if ($installed) {
  $bundledNode = Join-Path $repoRoot 'runtime/node/node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) { throw "Installed Node runtime is missing: $bundledNode" }
  $env:OPENEOC_DESKTOP_PREBUILT = '1'
  if ($hostData) {
    if (-not $env:ProgramData) { throw 'ProgramData is required for the Open Source EOC host data.' }
    $env:OPENEOC_DESKTOP_DATA_ROOT = Join-Path $env:ProgramData 'Open Source EOC'
  } else {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required for installed Open Source EOC data.' }
    $env:OPENEOC_DESKTOP_DATA_ROOT = Join-Path $env:LOCALAPPDATA 'Open Source EOC'
  }
  $env:OPENEOC_DESKTOP_DIST_ROOT = Join-Path $repoRoot 'web/dist'
  $env:OPENEOC_DESKTOP_PUBLIC_ROOT = Join-Path $repoRoot 'web/public'
  $env:OPENEOC_PG_DIST = Join-Path $repoRoot 'runtime/pgsql'
  $profileDataRoot = $env:OPENEOC_DESKTOP_DATA_ROOT
  $node = $bundledNode
} else {
  if ($env:OPENEOC_DESKTOP_DATA_ROOT) { $profileDataRoot = $env:OPENEOC_DESKTOP_DATA_ROOT }
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
if ($Action -eq 'Backup' -and $PSBoundParameters.ContainsKey('KeepDays')) {
  $arguments += "--keep-days=$KeepDays"
}
if (($Action -eq 'Start' -or $Action -eq 'Launch') -and $NoBrowser) {
  $arguments += '--no-browser'
}
if ($Action -eq 'HostInstall') {
  if ($HostName) { $arguments += "--host-name=$($HostName -join ',')" }
  if ($Certificate) {
    if (-not $CertificateKey) { throw 'An agency certificate needs its key: -CertificateKey' }
    $arguments += "--certificate=$Certificate"
    $arguments += "--certificate-key=$CertificateKey"
  }
}

$secretPointer = [IntPtr]::Zero
$plainPassword = $null
$commandExit = 1
try {
  $firstAdministrator = (($Action -eq 'Setup' -or $Action -eq 'Launch') -and $Profile -eq 'production') -or ($Action -eq 'HostInstall' -and $Profile -eq 'host')
  if ($firstAdministrator) {
    $profileConfig = Join-Path $profileDataRoot "profiles/$Profile/profile.json"
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
} catch {
  if (-not $Pause) { throw }
  Write-Host $_ -ForegroundColor Red
} finally {
  Remove-Item Env:OPENEOC_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  $plainPassword = $null
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
}

if ($Pause) {
  Write-Host ''
  Read-Host 'Press Enter to close this window' | Out-Null
}
if ($commandExit -ne 0) { exit $commandExit }
