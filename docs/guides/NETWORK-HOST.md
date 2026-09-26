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
   certificate download and the redirect from HTTP, what the server trusts
   for its own connections out and the clock, runs one backup, and ends with
   `HOST CHECK PASSED` or `HOST CHECK FAILED`. A `NOTE` line is advice and
   does not fail the check. It is also in the Start menu as **Check the Open
   Source EOC host**.

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
   certificate**, and before installing it compare its thumbprint with the
   one `Test-OpenEOCHost.ps1` shows on the host (on Windows, the
   **Thumbprint** on the certificate's **Details** tab). Install it only if
   they match:
   - **Windows:** open the file, choose **Install Certificate**, then **Local
     Machine** (or **Current User** without administrator rights), then
     **Place all certificates in the following store**, and choose **Trusted
     Root Certification Authorities**.
   - **macOS:** open the file to add it to the System keychain, open it in
     Keychain Access, expand **Trust** and set **When using this certificate**
     to **Always Trust**.
   - **iPhone, iPad and Android:** follow
     [Phones and tablets](#phones-and-tablets) below, which also installs
     the app.
4. Restart the browser. The address now opens with no warning, and the web
   app can be installed from the browser and opened without a connection
   after its first visit.

An agency that manages its computers can push the certificate to them as a
trusted root through its usual tools instead.

### From the installed app on Windows

A computer with the setup program installed can open the host in the app's
own window instead of running a server of its own. Choose **Open Source EOC on
a network host** in the Start menu; the first time, it asks for the host's
address, for example `https://eoc-host`, and keeps it for later. The same
from a terminal:

```powershell
& "$env:LOCALAPPDATA\Programs\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action Connect -Url https://eoc-host
```

Before opening the window it checks the connection against the computer's
own trusted roots, as the browser will. If the host's authority is not
trusted yet, the window stays open with the steps above (download, compare
the thumbprint, install), and the app window shows the browser's warning
until they are done. An address that does not answer, or a name the host's
certificate does not carry, is explained the same way. Plain `http://` is
refused except to this computer. `-Action Stop -Profile connect` closes the
window. This has been checked on Windows with Edge and Chrome; the Mac app
and Safari are not built or checked yet.

## Phones and tablets

A phone or tablet reaches the host through its browser. It trusts the
host's authority once, then installs the console from the browser as an
app; there is no app store app. Walk one phone of each kind the EOC uses
before an event, and record each in [the phone walk](#record-the-phone-walk).

These steps follow Apple's and Google's documented settings and have not
yet been walked on a phone against a host. Menu names vary with the system
version and, on Android, the maker.

### Before you start

- **The host's numeric address.** A phone on a network with no DNS server of
  its own may not find the host by its computer name. The host setup's
  `HOST_ADDRESS` lines, and the "HTTPS answers at" lines of
  `Test-OpenEOCHost.ps1`, list every address.
- **The thumbprint** `Test-OpenEOCHost.ps1` shows on its line "This computer
  trusts the host's certificate authority". A phone shows the same value as
  the certificate's SHA-1 fingerprint, in pairs separated by spaces or
  colons: compare the characters and ignore the separators and letter case.
- **The phone on the host's Wi-Fi, with mobile data off** for the walk. A
  phone that finds no internet on the Wi-Fi may send its traffic over mobile
  data instead, where the host cannot be reached. If Android asks whether to
  stay connected to a network with no internet, stay connected.
- **A screen lock.** Android installs an authority only on a phone with a PIN,
  pattern or password, and an iPhone or iPad asks for its passcode.

### iPhone and iPad

Use Safari for the certificate.

1. In Safari, open `https://` and the host's address, for example
   `https://192.168.1.20`. Safari warns that the connection is not private:
   choose **Show Details**, then **visit this website**, and confirm with
   **Visit Website**.
2. On the sign-in page, open **Trust this server** and choose **Download the
   certificate**. When Safari asks whether to allow a configuration profile
   to download, choose **Allow**, then **Close**.
3. Open **Settings** and choose **Profile Downloaded** near the top, or
   **General > VPN & Device Management** and the profile under **Downloaded
   Profile**. It is named "Open Source EOC", the host's name, and "Root".
4. Before installing, choose **More Details**, then the certificate, and
   compare its SHA-1 fingerprint with the host check's thumbprint. If they
   differ, go back, choose **Remove Downloaded Profile**, and stop.
5. Choose **Install**, enter the passcode, choose **Install** again at each
   warning, then **Done**.
6. Turn on full trust: **Settings > General > About > Certificate Trust
   Settings**, switch on the host's authority under **Enable full trust for
   root certificates**, and choose **Continue**.
7. Close Safari by swiping it away in the app switcher, open it, and open the
   host's address again. The page opens with no warning.

### Android

Use Chrome. Firefox for Android keeps its own list of authorities and does
not use one installed this way.

1. In Chrome, open `https://` and the host's address. Chrome warns that the
   connection is not private: choose **Advanced**, then **Proceed to** the
   address.
2. On the sign-in page, open **Trust this server** and choose **Download the
   certificate**. The file, `open-source-eoc-root.crt`, goes to
   **Downloads**. Opening it does not install it: Android 11 and later
   install an authority only from Settings.
3. Open **Settings** and search for "CA certificate", or go to **Security**
   (or **Security and privacy**), then **More security settings** or
   **Encryption & credentials**, then **Install a certificate > CA
   certificate**. Samsung phones name it **Install from device storage > CA
   certificate**. Choose **Install anyway**, confirm with the screen lock,
   and choose `open-source-eoc-root.crt` from Downloads.
4. Compare the thumbprint: under **Encryption & credentials > Trusted
   credentials**, the **User** tab lists the authority. Open it and find its
   SHA-1 fingerprint. If it differs from the host check's thumbprint, choose
   **Remove** and stop.
5. Close Chrome by swiping it away from the recent apps, open it, and open
   the host's address again. The page opens with no warning.

### Install the app

With the authority trusted, install the console and check that it opens
offline, as the [field user guide](FIELD-USER.md#install-the-app-and-work-offline)
describes: on an iPhone or iPad from Safari's **Share** menu with **Add to
Home Screen**; on Android from Chrome's menu with **Install app** or **Add to
Home screen**. On an iPhone or iPad the Home Screen app keeps its own
sign-in, apart from Safari, so sign in again inside it.

A host set up with [an agency certificate](#an-agency-certificate) offers
no download: install the agency's own root on each phone by the same steps,
from the file the agency provides.

### Record the phone walk

One column per phone. The first walk is Basho Parks's, on phones he
chooses. It has not happened yet; nothing below is a result.

| Field | iPhone or iPad | Android |
|---|---|---|
| Date, the host's build, and the address used | | |
| Model, system version and browser version | | |
| The warning on the first visit, and how it was passed | | |
| What the phone asked when the certificate downloaded | | |
| Where the phone showed the SHA-1 fingerprint, and whether it matched | | |
| The menu path taken to install and trust it, and any step that differed from this guide | | |
| The address opens with no warning after the browser restarts | | |
| The app installed, and its name on the home screen | | |
| Signed in inside the app | | |
| **Settings > This computer** reads "Kept on this computer" | | |
| Wi-Fi off, app closed and opened: "No connection · working offline" | | |
| A task completion or field report queued offline, and synced when Wi-Fi returned | | |
| Minutes from the first visit to a trusted, installed app | | |
| Problems, and what was done about each | | |

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

## Connections out through an agency authority

The server makes connections of its own: to the mail relay, a text gateway,
webhook targets and partner instances. It trusts the authorities Node carries
and those in the host's Windows certificate store, so an authority that Group
Policy put in the store works with nothing more. An authority kept elsewhere,
such as the one that signed an agency mail relay inside the building, can be
given to the setup as one PEM file:

```powershell
& "C:\Program Files\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action HostInstall -Profile host `
  -AuthorityFile C:\certs\agency-roots.pem
```

The setup refuses a file with no certificate or one that does not parse. It
keeps a copy as `%ProgramData%\Open Source EOC\host\authorities.pem`, which
the server reads at every start. A later setup run, such as an upgrade, keeps
that copy; delete it and run the setup again to stop trusting it.
`Test-OpenEOCHost.ps1` names the authorities the server trusts. Desktop
profiles trust the Windows store the same way.

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
connections. The outbound queue keeps what could not be sent and retries it
for its channel's window, 72 hours unless an administrator changed it under
**Administration > Channels**; a message still not sent then reads "Expired,
not sent" and an administrator can resend it. Federation waits for as long as
the partition lasts. The maps cover what the setup carries: California
streets, and imagery and elevation for the North Coast.

To check a computer with the internet unplugged, run **Check Open Source EOC
with no internet** from the Start menu (`Test-OpenEOCAirGap.ps1`).

## Keep time without the internet

Two-step sign-in accepts a code 30 seconds either side of the host's time, so
a host or phone clock more than 30 seconds off has its codes refused; the
server also settles competing edits by its own clock. Windows sets its clock
from the internet (`time.windows.com`) or a domain controller. With neither,
it keeps its own time, and a computer's clock can drift by a second or more a
day: a few days cut off is fine, weeks are not.

- `Test-OpenEOCHost.ps1` and `Test-OpenEOCAirGap.ps1` compare the clock with
  its time source: PASS within 30 seconds, FAIL beyond, and NOTE when there
  is no source or it does not answer. The host check also says whether the
  host serves time to the network.
- The console tells anyone whose device is more than 30 seconds off the
  server's clock, and which way.

For a site cut off for days or longer, give the network one clock:

1. Best, a GPS or radio time server on the network. On the host, in an
   administrator PowerShell, with the time server's name in place of
   `gps-clock`:

   ```powershell
   w32tm /config /manualpeerlist:"gps-clock,0x8" /syncfromflags:manual /update
   w32tm /resync
   ```

2. With no such clock, make the host the network's clock. Set its date and
   time by hand from a trusted source (a phone showing the cell network's or
   GPS time), then have it serve time:

   ```powershell
   Set-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer -Name Enabled -Value 1
   w32tm /config /syncfromflags:NO /reliable:YES /update
   Restart-Service w32time
   New-NetFirewallRule -Name OpenSourceEOC-Time -DisplayName "Open Source EOC host (time)" -Direction Inbound -Protocol UDP -LocalPort 123 -Action Allow -Profile Any
   ```

3. Point the other computers at the host (or the time server). Windows, in
   an administrator PowerShell, with the host's name in place of `eoc-host`:
   `w32tm /config /manualpeerlist:"eoc-host,0x8" /syncfromflags:manual /update`
   then `w32tm /resync`. A Mac: **System Settings > General > Date & Time**,
   **Set time and date automatically**, with the host's name as the source.
   Phones take their time from the cell network; with no service they keep
   their own, and the console says when one is off.

`w32tm /query /status` shows a computer's source and last update, and
`w32tm /stripchart /computer:eoc-host /samples:3 /dataonly` its offset from
the host.

## Limits

- One host per computer, holding one profile: `host` or `host-demo`. Remove
  one with `-Action HostRemove` before setting up the other.
- The host is one server process and one database, as described in the
  [deployment guide](../../deploy/README.md#one-application-node).
