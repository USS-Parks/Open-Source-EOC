# Air gap: connections the system makes

Run 2026-09-26T03:09:04.186Z, from commit `2991317` with uncommitted changes, on Windows 10.0.26200. Written by `deploy/windows/prove-airgap.mjs --stand-ins`; the raw records are in `deploy/test-runtime/out/rd5-airgap-stand-ins/`.
Result: **PASS**, no connection outside this computer and its local network, and 0 page errors.

## What ran

The network host profile with the North Coast Storm demo (`host-demo`), in phases:

1. **Set up and first start:** the step the setup program runs after copying files (`desktop.mjs setup`), which creates a PostgreSQL cluster, migrates it and seeds the scenario; then PostgreSQL from the host settings file, the server with its delivery queue and scheduler, and Caddy with the host's own certificate authority, each started as its generated service definition says, on the loopback address with spare ports. A second host profile, the federation partner, was set up and started beside it the same way.
2. **Stand-ins set up:** each optional integration pointed at a stand-in on this computer through the host's own API, and one record sent with every route up (see [Integrations on local stand-ins](#integrations-on-local-stand-ins)).
3. **The cut:** every stand-in and the partner host's server stopped; then a mass notification and a record that fires a rule, so email, SMS, a webhook, a push and a federation update wait for their routes.
4. **Idle:** ten seconds with nobody signed in, while the scheduler and delivery queue run.
5. **North Coast walk:** Chromium over HTTPS, trusting the host's authority by its keys: Jordan Lee signs in and opens every section in the rail (14: Overview, Map, ESFs & Lifelines, SITREP, Boards, Resources, Tasks, Field Reports, Operational Periods, IAP, Participants, Messages, Settings, Help), zooms the map in and out, opens the notifications panel and the account menu.
6. **Backup:** the scheduled backup task's command against the running host.
7. **Routes return:** the relay, the SMS provider, the push receiver, the feed server and the partner host come back; the webhook receiver stays down.
8. **SMS gateway:** SMS switched to a gateway phone on the site network that is off, a send, the phone on, and replies read back from it.
9. **Webhook expiry and resend:** the webhook queued at the cut expires at the end of its window, its receiver comes back, and the administrator resends it.

Installing with the setup program was not part of the run: its file copy has no network step, and the services, firewall rule and trusted root it adds change this computer's settings, which a session does not do. Basho's unplugged run covers the installed system.

## Integrations on local stand-ins

Run with `--stand-ins`: each optional integration the host can reach, and a stand-in on this computer can play, was configured through the host's own API as its administrator, Jordan Lee, then taken through an outage and back. The stand-ins listen on 127.0.0.1 in the proof's own process; the federation partner is a second network host profile set up and started beside the first, as the first is. Every count below is read from the host's own records (the delivery queue and its notifications, the federation outbox, the feed and its notice, the mass notification recipients); the stand-ins' own logs confirm what reached them.

### Settings made

- **Notification allowlist:** `http://127.0.0.1:60590`, `http://127.0.0.1:60591`, `http://127.0.0.1:60592` (the SMS provider, the webhook receiver and the ntfy server).
- **Email:** an SMTP relay at `127.0.0.1:60589` with no sign-in and connection security "none", the relay the server tests use (`server/src/__tests__/smtp-relay.ts`). **Send test email** answered `250 2.0.0 Ok: queued as Q1`.
- **SMS:** the HTTP provider at `http://127.0.0.1:60590/sms` with an account and token; **Send test SMS** was accepted. From the SMS gateway step on, a gateway phone at `http://127.0.0.1:60594` instead: the SMS Gateway for Android stand-in the server tests use (`server/src/__tests__/sms-gateway-fixture.ts`).
- **When a message cannot go out:** webhooks 1 hour, the shortest window the product allows, so one expiry falls inside the run; email, SMS and push at the 72-hour default.
- **Rule:** on a new board, "Stand-in drill log", a record created sends a webhook to `http://127.0.0.1:60591/drill`, an ntfy push to `http://127.0.0.1:60592/eoc-drill`, an email and an SMS.
- **Contacts:** a group, "Stand-in drill players", of two contacts with an email address and a phone number each, the first linked to Jordan Lee.
- **Feed:** GeoJSON, polled every 30 seconds from `http://127.0.0.1:60593/drill.geojson`; its first poll landed 1 item.
- **Federation:** each host registered the other and recorded its public key; this host shares "Stand-in drill log" with the partner at `http://127.0.0.1:52505`, into a receiving board that takes the partner's writes.

### What happened

| Time (UTC) | Step |
|---|---|
| 03:11:07 | Stand-ins started and configured; the test email and test SMS were accepted, the feed's first poll landed its item, and a record on the drill log went out by webhook, ntfy, email and SMS and reached the partner host |
| 03:11:07 | The cut: the SMTP relay, the SMS provider, the webhook and ntfy receivers and the feed server stopped, and the partner host's server stopped |
| 03:11:09 | A mass notification to the drill players by in-app notice, email and SMS, and a record on the drill log; every email, SMS, webhook and push read "Waiting for a route" |
| 03:13:00 | Routes returned: the SMTP relay, the SMS provider, the ntfy receiver and the feed server started again on their ports, and the partner host's server restarted; the webhook receiver stayed down |
| 03:13:22 | Every email, SMS and push that waited was delivered |
| 03:13:22 | The partner host received the record made during the cut |
| 03:13:57 | The feed answered again and its notice turned to "Feed recovered" |
| 03:13:58 | SMS switched to a gateway phone on the site network, which is off; a mass notification by SMS read "Waiting for a route" |
| 03:14:02 | The phone came back and took every text that waited |
| 03:14:02 | Both players replied by text; the replies read from the phone acknowledged the send |
| 04:11:13 | The webhook queued during the cut read "Expired, not sent" at the end of its window (held until 2026-09-26T04:11:07.863Z) |
| 04:11:13 | The webhook receiver started again and the administrator resent the expired webhook |
| 04:12:11 | The resent webhook was delivered |

### Deliveries, by integration

| Integration | Before the cut | Queued while its route was down | Read "Waiting for a route" | Delivered when the route returned | Expired | Resent | Still waiting or failed |
|---|---|---|---|---|---|---|---|
| Email, SMTP relay | 1 of 1 delivered | 3 | 3 | 3, 18 s after it returned | 0 | 0 | 0 |
| SMS, HTTP provider | 1 of 1 delivered | 3 | 3 | 3, 18 s after it returned | 0 | 0 | 0 |
| SMS, gateway phone | none | 2 | 2 | 2, 4 s after it returned | 0 | 0 | 0 |
| Webhook | 1 of 1 delivered | 1 | 1 | 0 | 1 | 1, 1 delivered 57 s after the resend | 0 |
| Push, ntfy | 1 of 1 delivered | 1 | 1 | 1, 26 s after it returned | 0 | 0 | 0 |

- **Waiting.** When the routes came back, 8 deliveries were waiting, after 3 to 5 tries each, with the last error `circuit open`, `fetch failed`. The mass notification's in-app notice needed no route: 1 of 1 delivered at once.
- **Expired and resent.** The webhook queued during the cut was held until 04:11:07 and read expired at 04:11:13 (checked every 5 seconds): "Expired, not sent: no route before 2026-09-26T04:11:07.863Z. Last error: fetch failed". The administrator resent it once its receiver was back.
- **What the stand-ins took.** The SMTP relay 5 messages, the SMS provider 5 requests, the webhook receiver 2, the ntfy server 2, the gateway phone 2 texts, and the feed server 60 polls; the test email and test SMS are among them.
- **Feed.** 1 notice for the whole outage, raised at 03:11:56, its count reaching 2 failed polls; when the feed answered again at 03:13:56 it became "Feed recovered: Stand-in GeoJSON feed": "Answered again after 2 failed tries over 2 minutes. Last error: fetch failed"
- **Federation.** 2 updates queued for the partner, 1 of them during the cut, which waited after up to 5 tries with the last error `fetch failed` and went out 9 s after the partner's server was ready again. The partner's receiving board holds "Stand-in check with every route up" and "Stand-in check during the cut".
- **Gateway replies.** Both players answered by text; **Read replies now** read 2 (the scheduler's replies job may read first), and 2 of 2 recipients of the send read acknowledged by text reply.
- **Not configured.** IPAWS-OPEN, FEMA's system, which no stand-in can play honestly; collaboration (Matrix, Mattermost) and meetings, which need `OPENEOC_INTEGRATIONS` in the server's environment, which the Windows setup does not set; OIDC sign-in, which the web app offers no button for.

## The recorders

- **Node processes** (the setup step, the server, the backup): every TCP and TLS connection, name lookup and UDP datagram they asked for, recorded inside each process through `lib/net-recorder.mjs`. 171 records from 5 processes.
- **Connection sampler:** half a second after each sample ends, the TCP connections of every process descended from the proof (the Node processes, Caddy, Chromium, the proof itself with its stand-ins) and of the PostgreSQL servers and their backends. 2660 samples, up to 50 processes at once.
- **Chromium's network log:** every request the browser made, with who started it. A request a page started names the page's origin, and every one is counted. The browser's own services (updates, autofill, account sign-in) start theirs with no origin; they belong to the browser, not to this system, an agency's own browser policy governs them, and they are listed apart below. The flags that switch those services off were set and do not stop them all.
- **The page:** every request the console made.

Limits: without administrator rights a session cannot trace UDP destinations of processes other than Node, or attribute lookups the Windows DNS client makes on a process's behalf. PostgreSQL and Caddy are configured with only loopback and local names, and Node's lookups are recorded in-process.

## Destinations

| Recorder | Destination | Count |
|---|---|---|
| Node | tcp 127.0.0.1:60593 | 62 |
| Node | tcp 127.0.0.1:52504 | 25 |
| Node | tcp 127.0.0.1:61498 | 17 |
| Node | tcp 127.0.0.1:60591 | 15 |
| Node | tcp 127.0.0.1:60589 | 14 |
| Node | tcp 127.0.0.1:60590 | 13 |
| Node | name 127.0.0.1 | 9 |
| Node | tcp 127.0.0.1:60592 | 7 |
| Node | tcp 127.0.0.1:52505 | 7 |
| Node | tcp 127.0.0.1:60594 | 2 |
| Sampler, node.exe | 127.0.0.1:61498 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 26090 |
| Sampler, postgres.exe | 127.0.0.1:61505 (set up and first start) | 32 |
| Sampler, postgres.exe | 127.0.0.1:51254 (set up and first start) | 26 |
| Sampler, caddy.exe | 127.0.0.1:52502 (set up and first start) | 33 |
| Sampler, node.exe | 127.0.0.1:52503 (set up and first start, stand-ins set up, the cut) | 41 |
| Sampler, node.exe | 127.0.0.1:52499 (set up and first start) | 33 |
| Sampler, postgres.exe | 127.0.0.1:52491 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2614 |
| Sampler, postgres.exe | 127.0.0.1:52498 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1224 |
| Sampler, postgres.exe | 127.0.0.1:52497 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1983 |
| Sampler, postgres.exe | 127.0.0.1:52496 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1260 |
| Sampler, postgres.exe | 127.0.0.1:52492 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2365 |
| Sampler, postgres.exe | 127.0.0.1:52494 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1808 |
| Sampler, postgres.exe | 127.0.0.1:52493 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1859 |
| Sampler, postgres.exe | 127.0.0.1:52500 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2481 |
| Sampler, postgres.exe | 127.0.0.1:52495 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1428 |
| Sampler, postgres.exe | 127.0.0.1:52489 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1368 |
| Sampler, caddy.exe | 127.0.0.1:61499 (set up and first start, stand-ins set up, the cut, North Coast walk, backup, routes return) | 1549 |
| Sampler, node.exe | 127.0.0.1:61500 (set up and first start) | 33 |
| Sampler, node.exe | 127.0.0.1:61499 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 326 |
| Sampler, createdb.exe | 127.0.0.1:52504 (set up and first start) | 1 |
| Sampler, postgres.exe | 127.0.0.1:65301 (set up and first start) | 1 |
| Sampler, node.exe | 127.0.0.1:52504 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 20993 |
| Sampler, postgres.exe | 127.0.0.1:65302 (set up and first start) | 24 |
| Sampler, postgres.exe | 127.0.0.1:51434 (set up and first start) | 18 |
| Sampler, postgres.exe | 127.0.0.1:53243 (set up and first start) | 1 |
| Sampler, postgres.exe | 127.0.0.1:63043 (stand-ins set up) | 4 |
| Sampler, node.exe | 127.0.0.1:60595 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return) | 61 |
| Sampler, node.exe | 127.0.0.1:60596 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return) | 61 |
| Sampler, node.exe | 127.0.0.1:52505 (stand-ins set up, routes return, SMS gateway, webhook expiry and resend) | 68 |
| Sampler, caddy.exe | 127.0.0.1:52505 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:52506 (stand-ins set up, the cut) | 4 |
| Sampler, caddy.exe | 127.0.0.1:60587 (stand-ins set up, the cut) | 4 |
| Sampler, node.exe | 127.0.0.1:60588 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:60585 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:60598 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:60597 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63048 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:60583 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63049 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63051 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63047 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63050 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63052 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63046 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:59497 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2190 |
| Sampler, node.exe | 127.0.0.1:60590 (stand-ins set up, routes return) | 8 |
| Sampler, node.exe | 127.0.0.1:59496 (stand-ins set up) | 2 |
| Sampler, node.exe | 127.0.0.1:60600 (stand-ins set up) | 2 |
| Sampler, node.exe | 127.0.0.1:60593 (stand-ins set up, SMS gateway, webhook expiry and resend) | 127 |
| Sampler, node.exe | 127.0.0.1:60592 (stand-ins set up, routes return) | 3 |
| Sampler, node.exe | 127.0.0.1:60591 (stand-ins set up) | 1 |
| Sampler, node.exe | 127.0.0.1:60839 (stand-ins set up) | 1 |
| Sampler, node.exe | 127.0.0.1:60838 (stand-ins set up) | 1 |
| Sampler, node.exe | 127.0.0.1:60840 (stand-ins set up) | 1 |
| Sampler, postgres.exe | 127.0.0.1:60842 (the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1942 |
| Sampler, chrome.exe | 2607:f8b0:4023:1c07::54:443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2001:4860:4828:7700:::443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2001:4860:4846:400:::443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2600:1900:4110:86f:::80 (North Coast walk) | 15 |
| Sampler, caddy.exe | 127.0.0.1:51165 (North Coast walk) | 15 |
| Sampler, node.exe | 127.0.0.1:51180 (North Coast walk, backup, routes return) | 65 |
| Sampler, node.exe | 127.0.0.1:51173 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:64500 (North Coast walk, backup, routes return) | 71 |
| Sampler, node.exe | 127.0.0.1:51179 (North Coast walk, backup, routes return) | 70 |
| Sampler, node.exe | 127.0.0.1:51176 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51178 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51171 (North Coast walk, backup, routes return) | 62 |
| Sampler, node.exe | 127.0.0.1:51175 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51174 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51166 (North Coast walk, backup, routes return) | 70 |
| Sampler, node.exe | 127.0.0.1:51170 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51177 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51168 (North Coast walk, backup, routes return) | 62 |
| Sampler, node.exe | 127.0.0.1:51182 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51167 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51172 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51181 (North Coast walk, backup, routes return) | 62 |
| Sampler, node.exe | 127.0.0.1:51183 (North Coast walk, backup, routes return) | 62 |
| Sampler, node.exe | 127.0.0.1:51169 (North Coast walk, backup, routes return) | 59 |
| Sampler, chrome.exe | 127.0.0.1:61500 (North Coast walk) | 29 |
| Sampler, caddy.exe | 127.0.0.1:58798 (North Coast walk) | 14 |
| Sampler, node.exe | 127.0.0.1:58804 (North Coast walk, backup, routes return) | 58 |
| Sampler, node.exe | 127.0.0.1:58800 (North Coast walk, backup, routes return) | 69 |
| Sampler, node.exe | 127.0.0.1:58803 (North Coast walk, backup, routes return) | 72 |
| Sampler, node.exe | 127.0.0.1:58799 (North Coast walk) | 14 |
| Sampler, node.exe | 127.0.0.1:58802 (North Coast walk, backup, routes return) | 61 |
| Sampler, node.exe | 127.0.0.1:58801 (North Coast walk, backup, routes return) | 61 |
| Sampler, postgres.exe | 127.0.0.1:58805 (North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2562 |
| Sampler, postgres.exe | 127.0.0.1:58806 (North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2200 |
| Sampler, chrome.exe | 2607:f8b0:4005:809::200e:443 (North Coast walk) | 10 |
| Sampler, chrome.exe | 142.251.214.46:443 (North Coast walk) | 10 |
| Sampler, chrome.exe | 2607:f8b0:4023:c0b::bc:5228 (North Coast walk) | 9 |
| Sampler, postgres.exe | 127.0.0.1:50715 (backup) | 1 |
| Sampler, pg_dump.exe | 127.0.0.1:61498 (backup) | 1 |
| Sampler, node.exe | 127.0.0.1:55491 (routes return) | 5 |
| Sampler, postgres.exe | 127.0.0.1:55488 (routes return, SMS gateway, webhook expiry and resend) | 1998 |
| Sampler, postgres.exe | 127.0.0.1:55481 (routes return, SMS gateway, webhook expiry and resend) | 1232 |
| Sampler, postgres.exe | 127.0.0.1:55484 (routes return, SMS gateway, webhook expiry and resend) | 2036 |
| Sampler, postgres.exe | 127.0.0.1:55485 (routes return, SMS gateway, webhook expiry and resend) | 1646 |
| Sampler, postgres.exe | 127.0.0.1:55486 (routes return, SMS gateway, webhook expiry and resend) | 2210 |
| Sampler, postgres.exe | 127.0.0.1:55489 (routes return, SMS gateway, webhook expiry and resend) | 1741 |
| Sampler, postgres.exe | 127.0.0.1:55492 (routes return, SMS gateway, webhook expiry and resend) | 1481 |
| Sampler, postgres.exe | 127.0.0.1:55487 (routes return, SMS gateway, webhook expiry and resend) | 2182 |
| Sampler, postgres.exe | 127.0.0.1:55490 (routes return, SMS gateway, webhook expiry and resend) | 1269 |
| Sampler, postgres.exe | 127.0.0.1:55483 (routes return, SMS gateway, webhook expiry and resend) | 2482 |
| Sampler, node.exe | 127.0.0.1:55496 (routes return, SMS gateway, webhook expiry and resend) | 53 |
| Sampler, node.exe | 127.0.0.1:55502 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:55500 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:55501 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:55503 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:61743 (SMS gateway) | 2 |
| Sampler, node.exe | 127.0.0.1:61208 (SMS gateway, webhook expiry and resend) | 40 |
| Sampler, node.exe | 127.0.0.1:61207 (SMS gateway, webhook expiry and resend) | 43 |
| Sampler, node.exe | 127.0.0.1:60594 (SMS gateway, webhook expiry and resend) | 2478 |
| Sampler, node.exe | 127.0.0.1:61209 (SMS gateway, webhook expiry and resend) | 2436 |
| Sampler, node.exe | 127.0.0.1:61210 (SMS gateway, webhook expiry and resend) | 42 |
| Sampler, node.exe | 127.0.0.1:61730 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:58393 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:61349 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64169 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:50394 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64327 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:55598 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:54562 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:65166 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:59857 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:62696 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:59903 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:57743 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:58510 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:50887 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:54253 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:61833 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:59581 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:51372 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:56291 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:63845 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:55368 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:53127 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64124 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:55864 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:62877 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:56994 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:52704 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:62902 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:54152 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:50845 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:55524 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53541 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:60357 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:62434 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:52624 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:60790 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:52063 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64012 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:55068 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53059 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53981 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:57498 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:58764 (webhook expiry and resend) | 2 |
| Sampler, postgres.exe | 127.0.0.1:52480 (webhook expiry and resend) | 432 |
| Sampler, node.exe | 127.0.0.1:55462 (webhook expiry and resend) | 1 |
| Sampler, postgres.exe | 127.0.0.1:64103 (webhook expiry and resend) | 385 |
| Sampler, node.exe | 127.0.0.1:64104 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64109 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:57099 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:52316 (webhook expiry and resend) | 1 |
| Sampler, postgres.exe | 127.0.0.1:50291 (webhook expiry and resend) | 271 |
| Sampler, node.exe | 127.0.0.1:55122 (webhook expiry and resend) | 1 |
| Sampler, postgres.exe | 127.0.0.1:56722 (webhook expiry and resend) | 248 |
| Sampler, node.exe | 127.0.0.1:64266 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:57082 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:51760 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:61120 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:56468 (webhook expiry and resend) | 1 |
| Sampler, node.exe | 127.0.0.1:55175 (webhook expiry and resend) | 2 |
| Sampler, postgres.exe | 127.0.0.1:55004 (webhook expiry and resend) | 57 |
| Sampler, node.exe | 127.0.0.1:55002 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:65180 (webhook expiry and resend) | 44 |
| Sampler, node.exe | 127.0.0.1:65179 (webhook expiry and resend) | 44 |
| Sampler, node.exe | 127.0.0.1:52893 (webhook expiry and resend) | 3 |
| Chromium log, a page's request | localhost | 466 |
| Page | localhost:61500 | 641 |

## Outside addresses written in the code

None is contacted in the run above. Each is text: documentation and attribution links a person may follow, schema and namespace identifiers, example values in help text, error messages from bundled libraries, and addresses of optional integrations and catalog sources an administrator must configure and switch on (IPAWS, feeds, catalog data sources, federation peers). Here the integrations point at stand-ins on this computer and none of these addresses is configured, so none is contacted; on an air-gapped network any that is configured fails without affecting the rest.

| Host | Where |
|---|---|
| cwwp2.dot.ca.gov | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| docs.oasis-open.org | server/src/ipaws/connector.ts |
| emilms.fema.gov | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/dictionary/lifelines.ts |
| eoc.example.org | server/src/notify/mass.ts |
| gis.data.ca.gov | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| github.com | deploy/windows/out/build/app-dist/assets/CopMap-Cu83TJZP.js, deploy/windows/out/build/app-dist/assets/field-submissions-jWDg49XZ.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-worker-CNLXcz58.js |
| gov.fema.ipaws.services | server/src/ipaws/connector.ts |
| hifld-geoplatform.opendata.arcgis.com | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| hooks.example.org | deploy/windows/out/build/app-dist/assets/AdminSurface-BELQgGY3.js, server/src/notify/allowlist.ts |
| humboldtgov.org | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| incidents.fire.ca.gov | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| json-schema.org | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js |
| maplibre.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| react.dev | deploy/windows/out/build/app-dist/assets/index-CJ_3NYAO.js, deploy/windows/out/build/app-dist/assets/react-dom-hf6EcyAr.js |
| schemas.openxmlformats.org | server/src/boards/transfer.ts |
| schemas.xmlsoap.org | server/src/ipaws/connector.ts |
| wiki.openstreetmap.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| www.caloes.ca.gov | shared/src/dictionary/esf.ts |
| www.census.gov | deploy/windows/out/build/app-dist/assets/src-BGUJbKxa.js, shared/src/data-packs/catalog.ts |
| www.opengis.net | server/src/geo/routes.ts |
| www.w3.org | deploy/windows/out/build/app-dist/assets/CopMap-Cu83TJZP.js, deploy/windows/out/build/app-dist/assets/Icon-BV0fzTPS.js, deploy/windows/out/build/app-dist/assets/MapSurface-BYq4GWdH.css, deploy/windows/out/build/app-dist/assets/index-CJ_3NYAO.js, and 4 more |

## The browser's own requests

Chromium reached these for its own services while it ran, in requests no page started. They are not the system's connections and are not counted above.

- clients2.google.com (1 request)
- update.googleapis.com (3 requests)
- www.gstatic.com (1 request)
- accounts.google.com (1 request)
- www.google.com (2 requests)
- edgedl.me.gvt1.com (1 request)
- content-autofill.googleapis.com (10 requests)
- android.clients.google.com (4 requests)
- socket 2607:f8b0:4023:1c07::54:443 (North Coast walk)
- socket 2001:4860:4828:7700:::443 (North Coast walk)
- socket 2001:4860:4846:400:::443 (North Coast walk)
- socket 2600:1900:4110:86f:::80 (North Coast walk)
- socket 2607:f8b0:4005:809::200e:443 (North Coast walk)
- socket 142.251.214.46:443 (North Coast walk)
- socket 2607:f8b0:4023:c0b::bc:5228 (North Coast walk)

## Outside connections

None.
