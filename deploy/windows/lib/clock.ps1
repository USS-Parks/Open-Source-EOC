<#
Clock checks shared by Test-OpenEOCHost.ps1 and Test-OpenEOCAirGap.ps1.

Two-step sign-in accepts a code one 30-second step either side of the
server's time, so a server or phone clock more than 30 seconds off has its
codes refused; the server also settles competing edits by its own clock.
These functions change nothing on the computer. They read Windows Time's
settings and ask the time source once over NTP (UDP 123), with no administrator
rights needed.
#>

# The NTP server Windows sets this computer's clock from, from Windows Time's settings; $null when it keeps its own time.
function Select-TimeSource([string]$Type, [string]$NtpServer, [string]$LogonServer, [string]$ComputerName) {
  if ($Type -eq 'NoSync') { return $null }
  if ($Type -eq 'NT5DS') {
    # A computer in a domain takes its time from a domain controller.
    $controller = $LogonServer.TrimStart('\')
    if ($controller -and $controller -ne $ComputerName) { return $controller }
    return $null
  }
  $peers = @($NtpServer -split '\s+' | Where-Object { $_ })
  if ($peers.Count -eq 0) { return $null }
  return ($peers[0] -split ',')[0]
}

function Get-TimeSource {
  $parameters = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Parameters' -ErrorAction SilentlyContinue
  if (-not $parameters) { return $null }
  return Select-TimeSource "$($parameters.Type)" "$($parameters.NtpServer)" "$env:LOGONSERVER" "$env:COMPUTERNAME"
}

# This computer's clock against an NTP server, in seconds: positive when this computer is behind. $null when the server does not answer within three seconds.
function Get-ClockOffset([string]$Server, [int]$Port = 123) {
  $client = New-Object Net.Sockets.UdpClient
  try {
    $client.Client.ReceiveTimeout = 3000
    $client.Connect($Server, $Port)
    $request = New-Object byte[] 48
    $request[0] = 0x1B # version 3, client
    $sent = [DateTime]::UtcNow
    [void]$client.Send($request, $request.Length)
    $from = New-Object Net.IPEndPoint ([Net.IPAddress]::Any), 0
    $reply = $client.Receive([ref]$from)
    $received = [DateTime]::UtcNow
    if ($reply.Length -lt 48) { return $null }
    # An NTP time: seconds since 1900 and a binary fraction, big-endian, at the given byte.
    $era = New-Object DateTime 1900, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)
    $times = foreach ($index in @(32, 40)) {
      $seconds = 0.0
      $fraction = 0.0
      for ($i = 0; $i -lt 4; $i++) {
        $seconds = $seconds * 256 + $reply[$index + $i]
        $fraction = $fraction * 256 + $reply[$index + 4 + $i]
      }
      $era.AddTicks([long](($seconds + $fraction / 4294967296.0) * 10000000))
    }
    return ((($times[0] - $sent).TotalSeconds + ($times[1] - $received).TotalSeconds) / 2)
  } catch {
    return $null
  } finally {
    $client.Close()
  }
}

# This computer's clock against its time source, as a PASS, FAIL or NOTE line.
function Test-ClockAgainstSource([string]$Source = (Get-TimeSource), [int]$Port = 123) {
  $guide = 'see "Keep time without the internet" in the network host guide'
  if (-not $Source) {
    return @{ Level = 'NOTE'; Text = "This computer has no time source and keeps its own time. Two-step sign-in refuses codes once its clock and the phones' differ by more than 30 seconds; $guide." }
  }
  $offset = Get-ClockOffset $Source $Port
  if ($null -eq $offset) {
    return @{ Level = 'NOTE'; Text = "The time source $Source does not answer, so this computer keeps its own time until it does. With no internet, give the network a clock of its own; $guide." }
  }
  $seconds = [math]::Round([math]::Abs($offset), 1)
  if ($offset -gt 0) { $side = 'behind' } else { $side = 'ahead of' }
  if ([math]::Abs($offset) -gt 30) {
    return @{ Level = 'FAIL'; Text = "The clock is $seconds seconds $side $Source; two-step sign-in refuses codes past 30 seconds. Set it with: w32tm /resync" }
  }
  return @{ Level = 'PASS'; Text = "The clock is within 30 seconds of $Source ($seconds seconds $side it)" }
}

# Whether this host serves time to the other computers on its network.
function Test-TimeServer {
  $provider = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer' -ErrorAction SilentlyContinue
  $service = Get-Service -Name 'W32Time' -ErrorAction SilentlyContinue
  if ($provider -and $provider.Enabled -eq 1 -and $service -and "$($service.Status)" -eq 'Running') {
    return @{ Level = 'PASS'; Text = 'This host serves time to the network (Windows Time, NTP on UDP 123)' }
  }
  return @{ Level = 'NOTE'; Text = 'This host does not serve time to the network. In an enclave with no other clock, make it the network''s clock; see "Keep time without the internet" in the network host guide.' }
}

# Print a clock line; returns 1 for a FAIL, else 0, for the caller's failure count.
function Write-ClockCheck([hashtable]$Result) {
  if ($Result.Level -eq 'PASS') { Write-Host "PASS  $($Result.Text)" -ForegroundColor Green; return 0 }
  if ($Result.Level -eq 'FAIL') { Write-Host "FAIL  $($Result.Text)" -ForegroundColor Red; return 1 }
  Write-Host "NOTE  $($Result.Text)" -ForegroundColor Yellow
  return 0
}
