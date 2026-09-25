<#
Checks the Open Source EOC network host on this computer after the setup
program's "Host for the network" choice: the three services, the firewall
rule, the backup task, the trusted root, HTTPS on every host name, the
certificate download and the redirect from HTTP. It also runs the backup task
once and checks that it wrote a backup; -SkipBackup leaves that out.

Run it on the host. It asks for administrator rights, which reading the host's
data folder needs. Every line reads PASS or FAIL, and the last line gives the
result.
#>
[CmdletBinding()]
param([switch]$SkipBackup)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
  if ($SkipBackup) { $arguments += '-SkipBackup' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
  exit
}

$script:failures = 0
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

$dataRoot = Join-Path $env:ProgramData 'Open Source EOC'
$hostConfig = Join-Path $dataRoot 'host\host.json'
if (-not (Test-Path -LiteralPath $hostConfig)) {
  Write-Host "FAIL  No host is set up on this computer: $hostConfig is missing." -ForegroundColor Red
  Write-Host 'HOST CHECK FAILED'
  exit 1
}
$hostRecord = Get-Content -LiteralPath $hostConfig -Raw | ConvertFrom-Json
Write-Host "Open Source EOC host: profile $($hostRecord.profile), set up $($hostRecord.installedAt)"
Write-Host ''

foreach ($name in @('OpenSourceEOC-PostgreSQL', 'OpenSourceEOC-Server', 'OpenSourceEOC-Caddy')) {
  Check "Service $name runs, starts automatically, as LocalService" {
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$name'"
    if (-not $service) { throw 'it is not installed' }
    if ($service.State -ne 'Running') { throw "it is $($service.State)" }
    if ($service.StartMode -ne 'Auto') { throw "its start mode is $($service.StartMode)" }
    if ($service.StartName -notmatch 'LocalService') { throw "it runs as $($service.StartName)" }
    "process $($service.ProcessId)"
  }
}

Check 'The firewall lets other computers reach HTTPS' {
  $rule = Get-NetFirewallRule -Name 'OpenSourceEOC-Host'
  if ("$($rule.Enabled)" -ne 'True' -or "$($rule.Action)" -ne 'Allow' -or "$($rule.Direction)" -ne 'Inbound') { throw 'the rule is not an enabled inbound allow' }
  $ports = @(($rule | Get-NetFirewallPortFilter).LocalPort)
  if ($ports -notcontains '443') { throw "it opens ports $($ports -join ', ')" }
  "ports $($ports -join ', '), networks $($rule.Profile)"
}

Check 'The daily backup is scheduled' {
  $task = Get-ScheduledTask -TaskPath '\Open Source EOC\' -TaskName 'Host backup'
  if ("$($task.State)" -eq 'Disabled') { throw 'the task is disabled' }
  if ($task.Principal.UserId -notmatch 'LOCAL ?SERVICE|S-1-5-19') { throw "it runs as $($task.Principal.UserId)" }
  "next run $((Get-ScheduledTaskInfo -InputObject $task).NextRunTime)"
}

$internal = $hostRecord.certificate -eq 'internal'
if ($internal) {
  Check "This computer trusts the host's certificate authority" {
    # The thumbprint is what a person compares before trusting the authority on another computer.
    "$((Get-Item -LiteralPath "Cert:\LocalMachine\Root\$($hostRecord.rootThumbprint)").Subject), thumbprint $($hostRecord.rootThumbprint)"
  }
}

foreach ($name in $hostRecord.names) {
  Check "HTTPS answers at https://$name" {
    $response = Invoke-WebRequest -Uri "https://$name/api/v1/ready" -UseBasicParsing -TimeoutSec 20
    if ($response.StatusCode -ne 200) { throw "status $($response.StatusCode)" }
    'ready, certificate trusted'
  }
}

if ($internal) {
  Check 'The sign-in page offers the certificate authority for download' {
    $response = Invoke-WebRequest -Uri "$($hostRecord.publicUrl)/trust/openeoc-root.crt" -UseBasicParsing -TimeoutSec 20
    $served = [Convert]::ToBase64String($response.RawContentStream.ToArray())
    $stored = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $dataRoot 'host\caddy\pki\authorities\local\root.crt')))
    if ($served -ne $stored) { throw 'the download is not the host root certificate' }
    "$($hostRecord.publicUrl)/trust/openeoc-root.crt"
  }
}

Check 'Plain HTTP redirects to HTTPS' {
  $name = @($hostRecord.names)[0]
  $request = [Net.HttpWebRequest]::Create("http://$name/")
  $request.AllowAutoRedirect = $false
  $request.Timeout = 20000
  $response = $request.GetResponse()
  try {
    $location = $response.Headers['Location']
    if ([int]$response.StatusCode -lt 300 -or [int]$response.StatusCode -ge 400 -or $location -notlike 'https://*') { throw "status $([int]$response.StatusCode) to $location" }
    $location
  } finally {
    $response.Close()
  }
}

if (-not $SkipBackup) {
  Check 'The backup task writes a backup' {
    $backups = Join-Path $dataRoot "profiles\$($hostRecord.profile)\backups"
    $before = @(Get-ChildItem -LiteralPath $backups -Filter 'openeoc-*.sql' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    Start-ScheduledTask -TaskPath '\Open Source EOC\' -TaskName 'Host backup'
    Start-Sleep -Seconds 3
    $deadline = (Get-Date).AddMinutes(15)
    while ("$((Get-ScheduledTask -TaskPath '\Open Source EOC\' -TaskName 'Host backup').State)" -eq 'Running' -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 5
    }
    $result = (Get-ScheduledTaskInfo -TaskPath '\Open Source EOC\' -TaskName 'Host backup').LastTaskResult
    if ($result -ne 0) { throw "the task ended with $result; see the logs in $(Join-Path $dataRoot "profiles\$($hostRecord.profile)\logs")" }
    $new = @(Get-ChildItem -LiteralPath $backups -Filter 'openeoc-*.sql' | Where-Object { $before -notcontains $_.Name })
    if ($new.Count -eq 0) { throw 'no new backup was written' }
    Join-Path $backups $new[-1].Name
  }
}

Write-Host ''
if ($script:failures -gt 0) {
  Write-Host "HOST CHECK FAILED: $($script:failures) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host 'HOST CHECK PASSED' -ForegroundColor Green
Write-Host ''
Write-Host 'Next, on another computer or phone on the same network, open one of these addresses:'
foreach ($name in $hostRecord.names) {
  if ($name -ne 'localhost' -and $name -ne '127.0.0.1') { Write-Host "  https://$name" }
}
if ($internal) {
  Write-Host 'The browser warns the first time. Continue to the page, open "Trust this server" under Sign in,'
  Write-Host 'download the certificate, install it as the page describes, and restart the browser.'
}
