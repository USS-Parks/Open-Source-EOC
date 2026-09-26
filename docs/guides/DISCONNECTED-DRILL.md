# The Disconnected Drill

Two exercises that show whether Open Source EOC keeps an EOC working with no
internet:

- **Part 1, the unplugged run:** about half a day. The system is installed
  from removable media on a network with no way out, checked, used from a
  second device, and restarted, all with the internet unplugged.
- **Part 2, the 72-hour drill:** three days of disconnection with the
  outside services an EOC depends on replaced by stand-ins on the host,
  played by the staff for about two hours a day, so everyone sees what waits,
  what expires and what catches up when a route returns.

Record both on the [drill report](DISCONNECTED-DRILL-REPORT.md). Neither has
been run yet; the first runs are Basho Parks's.

## What each part covers

| Situation | Part 1 | Part 2 |
|---|---|---|
| The internet is cut and the building's network stays up | Steps 4 to 10 | The whole drill |
| A network that never touches the internet: install, certificates and time | Steps 1 to 5 | The clock checks |
| A device with no network, which catches up when it rejoins | Step 9 | The field play on day 1 |
| Data carried to another instance on removable media | Step 11, a backup copy only | Day 3, a backup copy only |

This build has no way to carry incident records to another instance on
media: federation needs a network path, and the jurisdiction export has no
import. Both parts record only that a backup reaches removable media.

## Part 1: the unplugged run

**People:** an administrator, and a helper for the second device.

**What you need:**

- **Computer A**, the host: Windows 10 or 11, 64-bit, that has never had
  Open Source EOC, with administrator rights.
- **Computer B**, a Windows laptop that has never had Open Source EOC: it
  proves the install from media on a second computer and then serves as the
  second device.
- A switch or Wi-Fi router with its internet line unplugged, and cables.
- A USB drive with the setup and its `.sha256` file, written on a connected
  computer as step 1 of the installer's
  [second-machine transfer check](../../deploy/windows/installer/README.md#second-machine-transfer-check)
  describes.
- An authenticator app on the administrator's phone.
- The [drill report](DISCONNECTED-DRILL-REPORT.md), printed.

**Steps.** Write each result, time and anything that looked wrong in the
report as you go.

1. **Computer B, from media.** Disconnect B and follow steps 2 to 9 of the
   [second-machine transfer check](../../deploy/windows/installer/README.md#second-machine-transfer-check):
   the hash, the setup, the demonstration, sign-in, the map and an address
   search. Record its two timings.
2. **Disconnect computer A.** Connect it only to the switch or router, and
   give it a fixed address there: a reservation in the router, or a static
   address.
3. **Install the host from the media.** Copy the setup and its `.sha256`
   file to A and check the hash, with your setup's name in place of this
   one; it must print `True`:

   ```powershell
   $setup = "$env:USERPROFILE\Downloads\Open-Source-EOC-Setup-0.9.2.exe"
   (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() -ceq (Get-Content "$setup.sha256").Trim()
   ```

   Run the setup, choose **Install for all users**, tick **Host for the
   network** and **With a new operational database and its first
   administrator**, and answer the window's questions, as the
   [network host guide](NETWORK-HOST.md) describes. Record the time from
   starting the setup to the `HOST_ADDRESS` lines.
4. **The host check.** Leave **Check the host now** ticked on the last page.
   It must end with `HOST CHECK PASSED`. Copy its lines into the report,
   with the thumbprint. On a network with no time source the clock line
   reads NOTE, which does not fail the check.
5. **The unplugged check.** Run **Check Open Source EOC with no internet**
   from the Start menu. It must end with `AIR-GAP CHECK PASSED`. Copy its
   lines into the report.
6. **Sign in and activate.** On A, open `https://localhost`, sign in as the
   first administrator, set up two-step sign-in, and keep the recovery
   codes. Tick **Settings > General > Show every section**. On **Incident
   Setup**, under **Activate an incident**, choose **Severe Storm**, name it
   "DRILL unplugged run", choose **Incident type** "Exercise", and choose
   **Activate**.
7. **Walk the screens.** Open **Overview**, **Map**, **ESFs & Lifelines**,
   **Boards**, **Resources** and **Field Reports**. The map draws its
   basemap; zoom to your own area. On **Map**, choose **Add point**, pick
   the road closures board, click the map, fill the form and save. On
   **Boards**, add a **New record** to the field reports board; a new
   database has no field forms, so **Smart Forms** says "No field forms
   available". Close the browser and open it again: both records are still
   there. Nothing should wait on a connection.
8. **The second device.** Connect B to the switch. On A, under
   **Administration > People**, create a Member account for the helper, and
   assign them a position under **Positions**. On B, open `https://` and A's
   address, trust the host's authority after comparing its thumbprint, as
   [Connecting another computer, tablet or phone](NETWORK-HOST.md#connecting-another-computer-tablet-or-phone)
   describes, and sign in as the helper. Edit a record on B and watch it
   change on A, then the other way round.
9. **A device with no network.** On B, open **Settings > This computer** and
   wait until **Offline copy** reads "Kept on this computer". Unplug B from
   the switch, close the browser and open A's address again: the console
   opens marked "No connection · working offline". Plug B back in; it signs
   in again when the host answers.
10. **A restart, still unplugged.** Restart computer A. When it is back, run
    the unplugged check again, sign in from B, and find the records from
    step 7.
11. **A backup on media.** Copy the newest backup, its `openeoc-*.sql` file
    and the `.blobs` folder of the same name, from
    `%ProgramData%\Open Source EOC\profiles\host\backups` to the USB drive,
    and verify the copy as the
    [disaster recovery runbook](DISASTER-RECOVERY.md#verify-a-copy)
    describes.

Part 1 passes when both checks pass, the second-machine check completes,
and steps 6 to 11 work with nothing waiting on the internet. A phone can
join at step 8 by the network host guide's
[phone walk](NETWORK-HOST.md#record-the-phone-walk), which has its own
record.

## Part 2: the 72-hour drill

**People:** the EOC's staff in their positions; a controller, who runs the
stand-ins and reads the injects; and an evaluator, who keeps the report and
plays no part.

**Where:** the host from Part 1 before it holds real data, or a host set up
for drills. Never a host whose channels reach real people.

**Shape:** the clock starts at the cut, hour 0, and runs for 72 hours. The
staff play for about two hours on each of the three days; between them
the system is left running, as it would be overnight in an activation. The
controller also acts at the hours the timeline names.

### The stand-ins

Each outside service the EOC relies on is replaced by a stand-in on the
host that the controller can stop and start. Caddy, which the setup
installed for the host, serves three of them. Run each command in its own
PowerShell window on the host and leave the window open; closing it stops
the stand-in.

```powershell
$caddy = 'C:\Program Files\Open Source EOC\app\runtime\caddy\caddy.exe'
# The text message provider: answers every message with success.
& $caddy respond --listen 127.0.0.1:8083 --access-log
# The webhook receiver.
& $caddy respond --listen 127.0.0.1:8082 --access-log
# The feed server.
& $caddy file-server --listen 127.0.0.1:8084 --root C:\OSEOC-drill\feed --access-log
```

The feed server needs a file to serve. Make it once, with your EOC's
longitude and latitude in place of these:

```powershell
New-Item -ItemType Directory -Force C:\OSEOC-drill\feed | Out-Null
Set-Content -Path C:\OSEOC-drill\feed\drill.geojson -Encoding ascii -Value '{"type":"FeatureCollection","features":[{"type":"Feature","id":"drill-1","geometry":{"type":"Point","coordinates":[-124.0,41.5]},"properties":{"title":"DRILL feed item"}}]}'
```

| Service | Stand-in | Set up in Open Source EOC |
|---|---|---|
| Email | An SMTP test relay on the host that takes mail with no sign-in and shows what arrived, carried in on media. Mailpit (MIT license) is one: by default it takes mail on port 1025 and shows it at `http://localhost:8025`. A relay the agency already runs inside the building serves as well | **Administration > Channels**, **Email (SMTP relay)**: **Relay host** `127.0.0.1`, **Relay port** `1025`, **Connection security** "None (local relay without sign-in)", a **From address** in your own domain |
| Text messages | Caddy on port 8083 | First, on **Administration > Notifications**, put `http://127.0.0.1:8082` and `http://127.0.0.1:8083` under **Allowed destinations** and **Save allowlist**. Then on **Channels**, **SMS**: **SMS provider** "HTTP provider", **Provider URL** `http://127.0.0.1:8083/sms`, **Provider account** and **Provider token** `drill`, and a **From number** such as `+15555550100` |
| Webhook | Caddy on port 8082 | Once the drill incident is open (see below), on **Notifications**, **Add a notification rule** on its significant events board: **When** "A record is created", **Condition** "Every record", **Channel kind** Webhook, **Webhook URL** `http://127.0.0.1:8082/drill`, then **Create rule** and store the signing secret it shows once |
| Feed | Caddy on port 8084 | **Feeds**, **Add a feed**: a **Feed name**, **Format** geojson, **Delivery** "Poll an upstream URL", **Source URL** `http://127.0.0.1:8084/drill.geojson`, **Poll interval** 5 minutes, **Freshness window** 15 minutes |
| Federation, if you have a second computer | A second host, set up as in Part 1 on another computer on the same switch | Each host trusts the other's authority ([Connections out through an agency authority](NETWORK-HOST.md#connections-out-through-an-agency-authority)); then each registers the other, sets the push link and shares one board on **Federation** ([Federation setup](FEDERATION-SETUP.md)) |
| IPAWS | None: an alert needs FEMA's servers | Leave it off, and record "not configured" |

Collaboration channels and meetings are left out: they need their
integrations switched on in the server's environment, which the Windows
setup does not do.

### Before the cut

With every stand-in running:

1. Enter each player on **Contacts** with an email address the test relay
   takes and a fictional number such as `+15555550101`, linked to their
   account, and put them in a group named "Drill players".
2. On **Incident Setup**, activate "DRILL 72-hour" from **Severe Storm**,
   with **Incident type** "Exercise" and **Notify people when it
   activates** unticked. Add the webhook rule on its significant events
   board, as the table above describes.
3. On **Channels**, choose **Send test email** and **Send test SMS**. The
   email shows on the relay's page, and the message as a POST in the text
   stand-in's window. Add a record to the significant events board: the
   webhook shows as a POST in its window.
4. On **Channels**, under **When a message cannot go out**, set
   **Webhooks: hours to wait** to 24 and **Save webhooks window**, so a
   webhook expires inside the drill. Leave email and SMS at 72 hours.
5. Check that the feed shows as current under **Feed readiness**, and, if
   federated, that the partner's badge reads "Up to date".
6. Record the baseline in the report.

### Timeline

Hours count from the cut. The controller writes the clock time of every
event in the report's log.

| Hour | Who | What happens | What to record |
|---|---|---|---|
| 0 | Controller | The cut: close the relay and all three Caddy windows, and unplug the partner host from the switch | The time |
| 0 | Administrator | On **Mass Notification**, tell the "Drill players" group the EOC is activated, **Everyone at once**, by **In app**, **Email** and **SMS** | In-app notices arrive; email and SMS read "Waiting for a route" in the notification center |
| 0 to 2 | Staff | **Day 1 play.** Work the incident on the building's network: resource requests, map points, board records, the period's ICS forms. Add a record to the significant events board, which fires the webhook rule | What worked; the webhook reads "Waiting for a route" |
| 0 to 2 | Staff | A mass notification to "Drill players" with **Call-down, one contact at a time**, by email and SMS | Its receipts |
| 0 to 2 | Field user | Put one phone or laptop in airplane mode for an hour: close and reopen the app, complete an assigned task, queue a field report if the organization has a form; then reconnect and reconcile | Queued, synced, conflicts |
| 0 to 2 | Evaluator | One "Feed failing" notification for the feed, its count rising with each failed poll rather than a new notice each time; the feed's item stays on the map, marked stale | The count |
| 8 | Controller | Start the email relay again | When each waiting email arrived on the relay's page |
| 24 to 26 | Staff | **Day 2 play**, and the day's clock check: run **Check Open Source EOC with no internet** | The clock line |
| 24 | Evaluator | The webhooks queued at hour 0 read "Expired, not sent" | Count and time |
| 26 | Controller and administrator | Start the webhook stand-in; the administrator opens each expired webhook in the notification center and chooses **Resend** | Each resend's result |
| 30 | Controller | Restart the host computer, as a power loss would | Services back; waiting SMS still waiting |
| 48 | Controller | Plug the partner host back in | When its badge read "Up to date" again; what **Received from partners** lists on each side |
| 48 to 50 | Staff | **Day 3 play**, and the day's clock check. Copy the newest backup to removable media, as in Part 1 step 11 | The clock line; the copy verified |
| 72 | Evaluator | The SMS queued at hour 0 read "Expired, not sent" | Count and time |
| 72 | Controller and administrator | Start the text stand-in and the feed server; resend one expired SMS | The resend; the feed current again, with a "Feed recovered" notification |
| 72 | Everyone | Hotwash | Strengths, areas for improvement, corrective actions |

The windows count from when each message was queued, so a message queued
later in the day expires that much later. What the evaluator needs
at the end, per service: how many messages waited, how many were delivered
when their route returned and how long after, how many expired, and how
many were resent.
