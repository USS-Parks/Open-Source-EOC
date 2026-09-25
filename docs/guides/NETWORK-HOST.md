# The network host

One Windows computer serves Open Source EOC to every other computer, tablet
and phone on its network. The others need only a browser. Nothing between
them needs the internet: a building's own switch or Wi-Fi router, with its
internet line unplugged, is enough.

The host runs three Windows services under the LocalService account:

| Service | What it is |
|---|---|
| `OpenSourceEOC-PostgreSQL` | The database, listening on `127.0.0.1` only |
| `OpenSourceEOC-Server` | The Open Source EOC server with its delivery queue and scheduler, on `127.0.0.1` only |
| `OpenSourceEOC-Caddy` | Caddy, which answers HTTPS on port 443 (and redirects port 80) and passes each request to the server |

Caddy creates a certificate authority on the host the first time it starts
and issues the host's certificates from it, so no public certificate service
is involved. Each other computer trusts that authority once.

## What the host needs

- Windows 10 or 11, 64-bit. Windows Server 2019 and 2022 run the same setup
  but have not been tried.
- An administrator to install it.
- A fixed address on its network: a static address, or a reservation in the
  router's DHCP settings. The certificates name the addresses the host had
  at setup (see [When the address changes](#when-the-address-changes)).
- To stay on: power settings that never sleep, and a UPS for the host and the
  switch or router.

## Install

1. Run `Open-Source-EOC-Setup-<version>.exe` and choose **Install for all
   users**. Windows asks for administrator approval.
2. On **Select Additional Tasks**, tick **Host for the network** and choose
   one:
   - **With a new operational database and its first administrator**, for
     real use.
   - **With the North Coast Storm demonstration**, to try it across several
     devices. It signs in as the demonstration's people; see
     [Try it on Windows](../../TRY-IT-ON-WINDOWS.md) for the accounts.
3. For a new operational database, a window asks for the first
   administrator's email, name and password and the jurisdiction's short
   name and full name. The administrator adds an authenticator app at first
   sign-in.
4. The window ends with the addresses other devices use, one
   `HOST_ADDRESS https://...` line each. Press Enter to close it.
5. Leave **Check the host now** ticked on the last page. It runs
   `Test-OpenEOCHost.ps1`, which checks the services, the firewall rule, the
   backup task, the trusted authority, HTTPS on every address, the
   certificate download and the redirect from HTTP, runs one backup, and ends
   with `HOST CHECK PASSED` or `HOST CHECK FAILED`. It is also in the Start
   menu as **Check the Open Source EOC host**.

Setup also:

- adds the firewall rule **Open Source EOC host (HTTPS)**, which lets any
  network reach Caddy on ports 80 and 443 and nothing else;
- schedules **\Open Source EOC\Host backup** every day at 02:30;
- adds the host's certificate authority to this computer's trusted roots, so
  browsers on the host itself show no warning;
- keeps all data in `%ProgramData%\Open Source EOC`, readable only by
  administrators, SYSTEM and the services.

## Connecting another computer, tablet or phone

1. Open `https://` and one of the host's addresses, for example
   `https://eoc-host` or `https://192.168.1.20`. On a network without its own
   DNS server, Windows computers usually find the host by its computer name;
   phones and Macs may need the numeric address.
2. The first time, the browser warns that the connection is not private,
   because it does not know the host's authority yet. Choose **Advanced**,
   then continue to the page.
3. Under **Sign in**, open **Trust this server**, choose **Download the
   certificate**, and install it:
   - **Windows:** open the file, choose **Install Certificate**, then **Local
     Machine**, then **Place all certificates in the following store**, and
     choose **Trusted Root Certification Authorities**.
   - **macOS:** open the file to add it to the System keychain, open it in
     Keychain Access, expand **Trust** and set **When using this certificate**
     to **Always Trust**.
   - **iPhone and iPad:** open the file and allow the profile, install it in
     **Settings**, then turn it on under **Settings > General > About >
     Certificate Trust Settings**.
   - **Android:** **Settings > Security > Encryption & credentials > Install
     a certificate > CA certificate**, and choose the file. The menu names
     vary by maker.
4. Restart the browser. The address now opens with no warning, and the web
   app can be installed from the browser and opened without a connection
   after its first visit.

An agency that manages its computers can push the certificate to them as a
trusted root through its usual tools instead.

## When the address changes

The host's certificates name the computer name, its DNS name, and the IPv4
addresses it had when setup ran. If the host gets a new address, or a new
name should work, run the host setup again from an elevated PowerShell:

```powershell
& "C:\Program Files\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action HostInstall -Profile host
```

Use `-Profile host-demo` for a demonstration host. `-HostName eoc.county.local`
adds a name from the agency's own DNS. The authority stays the same, so
devices that already trust it need nothing new. Running it again never resets
the data.

## An agency certificate

An agency with its own certificate authority can use its certificate in place
of the host's own:

```powershell
& "C:\Program Files\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action HostInstall -Profile host `
  -Certificate C:\certs\eoc.pem -CertificateKey C:\certs\eoc.key
```

Both files are PEM. The certificate must name every address people use. The
sign-in page then offers no download, because the agency's computers already
trust its authority.

## Backups

The scheduled task dumps the database and copies the stored files into
`%ProgramData%\Open Source EOC\profiles\host\backups` every day, keeping 14
days. A backup on the host is lost with the host: copy the folder to a USB
drive or another computer regularly. Restoring is in the
[disaster recovery runbook](DISASTER-RECOVERY.md).

## Upgrade

Run the newer setup on the host, again for all users. It stops the services
before it replaces the programs, and the host setup it runs afterwards starts
them again. The server dumps the database before it applies a newer build's
changes to it, into the same backups folder.

## Remove

Uninstalling Open Source EOC removes the three services, the firewall rule,
the backup task and the trusted authority. The data in
`%ProgramData%\Open Source EOC` stays, for a later reinstall or for an
administrator to remove deliberately.

## Logs

`%ProgramData%\Open Source EOC\profiles\host\logs` holds the server's
`server.log`, PostgreSQL's `postgres-<day>.log`, Caddy's `caddy.log`, and each
service wrapper's own log. The `host-demo` profile's are under
`profiles\host-demo\logs`.

## One building with no internet

For a building or a site cut off from the internet:

1. Put the host and a switch or Wi-Fi router on backup power. The router's
   internet line can stay unplugged; it only needs to hand out local
   addresses.
2. Give the host a fixed address before setup, or reserve one for it in the
   router.
3. Install the host as above and connect each device once to trust the
   authority. Do this before an event where you can.
4. During the event, everyone works through the host: the map, lifelines,
   boards, requests, threads and live edits all stay on the local network.

What needs a connection outside the building waits: email and text alerts
need a mail relay or text provider (a relay inside the building works), and
IPAWS, federation with other agencies and outside data feeds need their own
connections. The outbound queue keeps what could not be sent and retries when
the connection returns. The maps cover what the setup carries: California
streets, and imagery and elevation for the North Coast.

## Limits

- One host per computer, holding one profile: `host` or `host-demo`. Remove
  one with `-Action HostRemove` before setting up the other.
- The host is one server process and one database, as described in the
  [deployment guide](../../deploy/README.md#one-application-node).
