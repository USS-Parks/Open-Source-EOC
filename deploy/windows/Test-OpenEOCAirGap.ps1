<#
Checks that Open Source EOC keeps working with no internet at all. Run it
with the network cable unplugged and Wi-Fi off, or with this computer on a
switch or hotspot that has no connection onward.

It first checks that the internet really is out of reach, then checks every
Open Source EOC this computer runs: the network host (after the setup
program's "Host for the network" choice) and each desktop profile, such as
the North Coast Storm demo, that is open. Open the desktop app first if you
want it checked. Every line reads PASS or FAIL, and the last line gives the
result. It changes nothing on this computer.

Then follow the steps it prints: sign in, open the screens, and for a host,
reach it from a second computer or phone on the same switch or hotspot.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:checked = 0
# The check body runs in this function's scope, so its parameters are named to stay clear of the bodies' own variables.
function Check([string]$CheckLabel, [scriptblock]$CheckBody) {
  try {
    $checkDetail = & $CheckBody
    if ($checkDetail) { Write-Host "PASS  $CheckLabel ($checkDetail)" -ForegroundColor Green } else { Write-Host "PASS  $CheckLabel" -ForegroundColor Green }
  } catch {
    $script:failures++
    Write-Host "FAIL  $CheckLabel - $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Reachable([string]$Address, [int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $attempt = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $attempt.AsyncWaitHandle.WaitOne(3000)) { return $false }
    $client.EndConnect($attempt)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

Write-Host "Open Source EOC air-gap check, $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Write-Host ''

Check 'The internet is out of reach' {
  $reached = @(foreach ($target in @(@('1.1.1.1', 443), @('8.8.8.8', 53), @('9.9.9.9', 443))) {
    if (Reachable $target[0] $target[1]) { "$($target[0]):$($target[1])" }
  })
  if ($reached.Count -gt 0) { throw "reached $($reached -join ', '); unplug the cable or turn off Wi-Fi, or use a switch or hotspot with no connection onward, then run this again" }
  $named = $true
  try { [void][Net.Dns]::GetHostAddresses('www.example.com') } catch { $named = $false }
  if ($named) { throw 'a public name still resolves; this computer can still reach a name server outside' }
  $adapters = @(Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object Name)
  if ($adapters.Count -eq 0) { 'no network adapter is up' } else { "adapters up with no route out: $($adapters -join ', ')" }
}

$hostConfig = Join-Path $env:ProgramData 'Open Source EOC\host\host.json'
$hostRecord = $null
if (Test-Path -LiteralPath $hostConfig) {
  try {
    $hostRecord = Get-Content -LiteralPath $hostConfig -Raw | ConvertFrom-Json
  } catch {
    Write-Host "FAIL  The host's record could not be read; run this again as administrator to check the host." -ForegroundColor Red
    $script:failures++
  }
}
if ($hostRecord) {
  $script:checked++
  Write-Host ''
  Write-Host "Network host: profile $($hostRecord.profile)"
  foreach ($name in @('OpenSourceEOC-PostgreSQL', 'OpenSourceEOC-Server', 'OpenSourceEOC-Caddy')) {
    Check "Service $name runs" {
      $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$name'"
      if (-not $service) { throw 'it is not installed' }
      if ($service.State -ne 'Running') { throw "it is $($service.State); start it from Services or restart this computer" }
      "process $($service.ProcessId)"
    }
  }
  foreach ($name in $hostRecord.names) {
    Check "HTTPS answers at https://$name" {
      $response = Invoke-WebRequest -Uri "https://$name/api/v1/ready" -UseBasicParsing -TimeoutSec 20
      if ($response.StatusCode -ne 200) { throw "status $($response.StatusCode)" }
      'ready'
    }
  }
}

$profiles = Join-Path $env:LOCALAPPDATA 'Open Source EOC\profiles'
if (Test-Path -LiteralPath $profiles) {
  foreach ($file in @(Get-ChildItem -LiteralPath $profiles -Filter 'profile.json' -Recurse -Depth 1)) {
    $desktop = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $url = "http://127.0.0.1:$($desktop.httpPort)"
    if (-not (Reachable '127.0.0.1' ([int]$desktop.httpPort))) {
      Write-Host ''
      Write-Host "Desktop profile $($desktop.profile): not open. Open it from the Start menu and run this check again to include it."
      continue
    }
    $script:checked++
    Write-Host ''
    Write-Host "Desktop profile $($desktop.profile)"
    Check "The console answers at $url" {
      $response = Invoke-WebRequest -Uri "$url/api/v1/ready" -UseBasicParsing -TimeoutSec 20
      if ($response.StatusCode -ne 200) { throw "status $($response.StatusCode)" }
      'ready'
    }
    Check 'The console page and its map files load' {
      $page = Invoke-WebRequest -Uri "$url/" -UseBasicParsing -TimeoutSec 20
      if ($page.StatusCode -ne 200) { throw "the page returned $($page.StatusCode)" }
      $basemap = Invoke-WebRequest -Uri "$url/basemap/basemap.pmtiles" -Method Head -UseBasicParsing -TimeoutSec 20
      if ($basemap.StatusCode -ne 200) { throw "the bundled basemap returned $($basemap.StatusCode)" }
      "basemap $([math]::Round([int64]$basemap.Headers['Content-Length'] / 1MB, 1)) MB"
    }
  }
}

Write-Host ''
if ($script:checked -eq 0) {
  Write-Host 'FAIL  No Open Source EOC is running on this computer: open the desktop app, or set up the network host, and run this again.' -ForegroundColor Red
  $script:failures++
}
if ($script:failures -gt 0) {
  Write-Host "AIR-GAP CHECK FAILED: $($script:failures) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host 'AIR-GAP CHECK PASSED' -ForegroundColor Green
Write-Host ''
Write-Host 'Now, still with no internet:'
Write-Host '  1. In the app or browser, sign in and open Overview, Map, ESFs & Lifelines, Boards, Resources and Field Reports.'
Write-Host '     The map should draw its basemap; nothing should wait on a connection.'
Write-Host '  2. Add a point on the map and a field report, then close the app and open it again: both should still be there.'
if ($hostRecord) {
  Write-Host '  3. On a second computer or phone on the same switch or hotspot, open one of these addresses and sign in:'
  foreach ($name in $hostRecord.names) {
    if ($name -ne 'localhost' -and $name -ne '127.0.0.1') { Write-Host "       https://$name" }
  }
  Write-Host '     A browser that has not trusted this host yet warns first: continue, open "Trust this server" under Sign in,'
  Write-Host '     download the certificate, install it as the page describes, and restart the browser.'
  Write-Host '  4. Edit a record on one device and watch it change on the other.'
}
Write-Host 'Note anything that waited, failed or looked wrong beside this output.'
