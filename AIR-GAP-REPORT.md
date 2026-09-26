# Air gap: connections the system makes

Run 2026-09-26T05:20:49.970Z, from commit `5079670` with uncommitted changes, on Windows 10.0.26200. Written by `deploy/windows/prove-airgap.mjs --stand-ins`; the raw records are in `deploy/test-runtime/out/rd5-airgap-stand-ins/`.
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

- **Notification allowlist:** `http://127.0.0.1:55553`, `http://127.0.0.1:55554`, `http://127.0.0.1:55555` (the SMS provider, the webhook receiver and the ntfy server).
- **Email:** an SMTP relay at `127.0.0.1:55552` with no sign-in and connection security "none", the relay the server tests use (`server/src/__tests__/smtp-relay.ts`). **Send test email** answered `250 2.0.0 Ok: queued as Q1`.
- **SMS:** the HTTP provider at `http://127.0.0.1:55553/sms` with an account and token; **Send test SMS** was accepted. From the SMS gateway step on, a gateway phone at `http://127.0.0.1:55557` instead: the SMS Gateway for Android stand-in the server tests use (`server/src/__tests__/sms-gateway-fixture.ts`).
- **When a message cannot go out:** webhooks 1 hour, the shortest window the product allows, so one expiry falls inside the run; email, SMS and push at the 72-hour default.
- **Rule:** on a new board, "Stand-in drill log", a record created sends a webhook to `http://127.0.0.1:55554/drill`, an ntfy push to `http://127.0.0.1:55555/eoc-drill`, an email and an SMS.
- **Contacts:** a group, "Stand-in drill players", of two contacts with an email address and a phone number each, the first linked to Jordan Lee.
- **Feed:** GeoJSON, polled every 30 seconds from `http://127.0.0.1:55556/drill.geojson`; its first poll landed 1 item.
- **Federation:** each host registered the other and recorded its public key; this host shares "Stand-in drill log" with the partner at `http://127.0.0.1:49249`, into a receiving board that takes the partner's writes.

### What happened

| Time (UTC) | Step |
|---|---|
| 05:22:52 | Stand-ins started and configured; the test email and test SMS were accepted, the feed's first poll landed its item, and a record on the drill log went out by webhook, ntfy, email and SMS and reached the partner host |
| 05:22:52 | The cut: the SMTP relay, the SMS provider, the webhook and ntfy receivers and the feed server stopped, and the partner host's server stopped |
| 05:22:54 | A mass notification to the drill players by in-app notice, email and SMS, and a record on the drill log; every email, SMS, webhook and push read "Waiting for a route" |
| 05:24:57 | Routes returned: the SMTP relay, the SMS provider, the ntfy receiver and the feed server started again on their ports, and the partner host's server restarted; the webhook receiver stayed down |
| 05:24:59 | Every email, SMS and push that waited was delivered |
| 05:25:03 | The partner host received the record made during the cut |
| 05:25:47 | The feed answered again and its notice turned to "Feed recovered" |
| 05:25:49 | SMS switched to a gateway phone on the site network, which is off; a mass notification by SMS read "Waiting for a route" |
| 05:25:55 | The phone came back and took every text that waited |
| 05:25:55 | Both players replied by text; the replies read from the phone acknowledged the send |
| 06:22:56 | The webhook queued during the cut read "Expired, not sent" at the end of its window (held until 2026-09-26T06:22:52.917Z) |
| 06:22:56 | The webhook receiver started again and the administrator resent the expired webhook |
| 06:23:54 | The resent webhook was delivered |

### Deliveries, by integration

| Integration | Before the cut | Queued while its route was down | Read "Waiting for a route" | Delivered when the route returned | Expired | Resent | Still waiting or failed |
|---|---|---|---|---|---|---|---|
| Email, SMTP relay | 1 of 1 delivered | 3 | 3 | 3, 6 s after it returned | 0 | 0 | 0 |
| SMS, HTTP provider | 1 of 1 delivered | 3 | 3 | 3, 6 s after it returned | 0 | 0 | 0 |
| SMS, gateway phone | none | 2 | 2 | 2, 6 s after it returned | 0 | 0 | 0 |
| Webhook | 1 of 1 delivered | 1 | 1 | 0 | 1 | 1, 1 delivered 58 s after the resend | 0 |
| Push, ntfy | 1 of 1 delivered | 1 | 1 | 1, 2 s after it returned | 0 | 0 | 0 |

- **Waiting.** When the routes came back, 8 deliveries were waiting, after 2 to 6 tries each, with the last error `circuit open`, `fetch failed`. The mass notification's in-app notice needed no route: 1 of 1 delivered at once.
- **Expired and resent.** The webhook queued during the cut was held until 06:22:52 and read expired at 06:22:56 (checked every 5 seconds): "Expired, not sent: no route before 2026-09-26T06:22:52.917Z. Last error: fetch failed". The administrator resent it once its receiver was back.
- **What the stand-ins took.** The SMTP relay 5 messages, the SMS provider 5 requests, the webhook receiver 2, the ntfy server 2, the gateway phone 2 texts, and the feed server 60 polls; the test email and test SMS are among them.
- **Feed.** 1 notice for the whole outage, raised at 05:23:47, its count reaching 2 failed polls; when the feed answered again at 05:25:47 it became "Feed recovered: Stand-in GeoJSON feed": "Answered again after 2 failed tries over 2 minutes. Last error: fetch failed"
- **Federation.** 2 updates queued for the partner, 1 of them during the cut, which waited after up to 5 tries with the last error `fetch failed` and went out 6 s after the partner's server was ready again. The partner's receiving board holds "Stand-in check with every route up" and "Stand-in check during the cut".
- **Gateway replies.** Both players answered by text; **Read replies now** read 2 (the scheduler's replies job may read first), and 2 of 2 recipients of the send read acknowledged by text reply.
- **Not configured.** IPAWS-OPEN, FEMA's system, which no stand-in can play honestly; collaboration (Matrix, Mattermost) and meetings, which need `OPENEOC_INTEGRATIONS` in the server's environment, which the Windows setup does not set; OIDC sign-in, which the web app offers no button for.

## The recorders

- **Node processes** (the setup step, the server, the backup): every TCP and TLS connection, name lookup and UDP datagram they asked for, recorded inside each process through `lib/net-recorder.mjs`. 167 records from 5 processes.
- **Connection sampler:** half a second after each sample ends, the TCP connections of every process descended from the proof (the Node processes, Caddy, Chromium, the proof itself with its stand-ins) and of the PostgreSQL servers and their backends. 3515 samples, up to 49 processes at once.
- **Chromium's network log:** every request the browser made, with who started it. A request a page started names the page's origin, and every one is counted. The browser's own services (updates, autofill, account sign-in) start theirs with no origin; they belong to the browser, not to this system, an agency's own browser policy governs them, and they are listed apart below. The flags that switch those services off were set and do not stop them all.
- **The page:** every request the console made.

Limits: without administrator rights a session cannot trace UDP destinations of processes other than Node, or attribute lookups the Windows DNS client makes on a process's behalf. PostgreSQL and Caddy are configured with only loopback and local names, and Node's lookups are recorded in-process.

## Destinations

| Recorder | Destination | Count |
|---|---|---|
| Node | tcp 127.0.0.1:55556 | 62 |
| Node | tcp 127.0.0.1:49248 | 23 |
| Node | tcp 127.0.0.1:62619 | 17 |
| Node | tcp 127.0.0.1:55554 | 15 |
| Node | tcp 127.0.0.1:55552 | 13 |
| Node | tcp 127.0.0.1:55553 | 12 |
| Node | name 127.0.0.1 | 9 |
| Node | tcp 127.0.0.1:55555 | 7 |
| Node | tcp 127.0.0.1:49249 | 7 |
| Node | tcp 127.0.0.1:55557 | 2 |
| Sampler, postgres.exe | 127.0.0.1:53708 (set up and first start) | 1 |
| Sampler, pg_isready.exe | 127.0.0.1:62619 (set up and first start) | 1 |
| Sampler, postgres.exe | 127.0.0.1:53710 (set up and first start) | 32 |
| Sampler, node.exe | 127.0.0.1:62619 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend, done) | 32881 |
| Sampler, postgres.exe | 127.0.0.1:53712 (set up and first start) | 26 |
| Sampler, caddy.exe | 127.0.0.1:49246 (set up and first start) | 36 |
| Sampler, node.exe | 127.0.0.1:49247 (set up and first start, stand-ins set up, the cut, idle) | 50 |
| Sampler, node.exe | 127.0.0.1:49244 (set up and first start) | 36 |
| Sampler, postgres.exe | 127.0.0.1:49240 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2916 |
| Sampler, postgres.exe | 127.0.0.1:49238 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1484 |
| Sampler, postgres.exe | 127.0.0.1:49242 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1816 |
| Sampler, postgres.exe | 127.0.0.1:49236 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend, done) | 3469 |
| Sampler, postgres.exe | 127.0.0.1:49243 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1858 |
| Sampler, postgres.exe | 127.0.0.1:49241 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1749 |
| Sampler, postgres.exe | 127.0.0.1:49237 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2301 |
| Sampler, postgres.exe | 127.0.0.1:49239 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2817 |
| Sampler, postgres.exe | 127.0.0.1:50934 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 1538 |
| Sampler, caddy.exe | 127.0.0.1:62620 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return) | 1374 |
| Sampler, node.exe | 127.0.0.1:62621 (set up and first start) | 36 |
| Sampler, node.exe | 127.0.0.1:62620 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend, done) | 387 |
| Sampler, node.exe | 127.0.0.1:49248 (set up and first start, stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend, done) | 25185 |
| Sampler, postgres.exe | 127.0.0.1:60042 (set up and first start) | 27 |
| Sampler, postgres.exe | 127.0.0.1:57445 (set up and first start) | 22 |
| Sampler, postgres.exe | 127.0.0.1:55530 (set up and first start) | 1 |
| Sampler, postgres.exe | 127.0.0.1:55537 (set up and first start, stand-ins set up) | 4 |
| Sampler, caddy.exe | 127.0.0.1:49249 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:49250 (stand-ins set up, the cut) | 4 |
| Sampler, node.exe | 127.0.0.1:49249 (stand-ins set up, routes return, SMS gateway, webhook expiry and resend) | 67 |
| Sampler, caddy.exe | 127.0.0.1:55549 (stand-ins set up, the cut) | 4 |
| Sampler, node.exe | 127.0.0.1:55550 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:55547 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55546 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55545 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55544 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55543 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55542 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55541 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55540 (stand-ins set up) | 3 |
| Sampler, postgres.exe | 127.0.0.1:55539 (stand-ins set up) | 3 |
| Sampler, node.exe | 127.0.0.1:55559 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return) | 56 |
| Sampler, node.exe | 127.0.0.1:55558 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return) | 56 |
| Sampler, node.exe | 127.0.0.1:55553 (stand-ins set up, routes return) | 11 |
| Sampler, node.exe | 127.0.0.1:52751 (stand-ins set up) | 2 |
| Sampler, node.exe | 127.0.0.1:55564 (stand-ins set up) | 2 |
| Sampler, node.exe | 127.0.0.1:55556 (stand-ins set up, SMS gateway, webhook expiry and resend) | 170 |
| Sampler, node.exe | 127.0.0.1:55561 (stand-ins set up) | 2 |
| Sampler, node.exe | 127.0.0.1:55560 (stand-ins set up) | 2 |
| Sampler, postgres.exe | 127.0.0.1:62140 (stand-ins set up, the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2329 |
| Sampler, postgres.exe | 127.0.0.1:50575 (the cut, idle, North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2723 |
| Sampler, chrome.exe | 2607:f8b0:4005:815::200e:443 (North Coast walk) | 8 |
| Sampler, chrome.exe | 2607:f8b0:4005:801::2003:443 (North Coast walk) | 1 |
| Sampler, chrome.exe | 2001:4860:4828:7700:::443 (North Coast walk) | 13 |
| Sampler, chrome.exe | 2607:f8b0:4005:80a::200e:80 (North Coast walk) | 1 |
| Sampler, chrome.exe | 2001:4860:4842:400:::443 (North Coast walk) | 12 |
| Sampler, chrome.exe | 2607:f8b0:4023:1c03::54:443 (North Coast walk) | 12 |
| Sampler, chrome.exe | 2001:4860:482a:7700:::443 (North Coast walk) | 12 |
| Sampler, chrome.exe | 2600:1900:4110:86f:::80 (North Coast walk) | 12 |
| Sampler, caddy.exe | 127.0.0.1:54560 (North Coast walk) | 12 |
| Sampler, caddy.exe | 127.0.0.1:62291 (North Coast walk) | 12 |
| Sampler, node.exe | 127.0.0.1:51374 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51369 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51377 (North Coast walk, backup, routes return) | 67 |
| Sampler, node.exe | 127.0.0.1:51373 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51375 (North Coast walk, backup, routes return) | 56 |
| Sampler, node.exe | 127.0.0.1:51358 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51370 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:62292 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51360 (North Coast walk, backup, routes return) | 68 |
| Sampler, node.exe | 127.0.0.1:51367 (North Coast walk, backup, routes return) | 67 |
| Sampler, node.exe | 127.0.0.1:51364 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51368 (North Coast walk, backup, routes return) | 69 |
| Sampler, node.exe | 127.0.0.1:51366 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51359 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51356 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:54562 (North Coast walk) | 12 |
| Sampler, node.exe | 127.0.0.1:51376 (North Coast walk, backup, routes return) | 56 |
| Sampler, node.exe | 127.0.0.1:51372 (North Coast walk, backup, routes return) | 59 |
| Sampler, node.exe | 127.0.0.1:51371 (North Coast walk, backup, routes return) | 56 |
| Sampler, node.exe | 127.0.0.1:51365 (North Coast walk, backup, routes return) | 55 |
| Sampler, node.exe | 127.0.0.1:51363 (North Coast walk, backup, routes return) | 67 |
| Sampler, node.exe | 127.0.0.1:51362 (North Coast walk, backup, routes return) | 67 |
| Sampler, node.exe | 127.0.0.1:51357 (North Coast walk, backup, routes return) | 59 |
| Sampler, postgres.exe | 127.0.0.1:54565 (North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 3062 |
| Sampler, postgres.exe | 127.0.0.1:54564 (North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend) | 2109 |
| Sampler, postgres.exe | 127.0.0.1:54563 (North Coast walk, backup, routes return, SMS gateway, webhook expiry and resend, done) | 3416 |
| Sampler, chrome.exe | 127.0.0.1:62621 (North Coast walk) | 24 |
| Sampler, chrome.exe | 2607:f8b0:4023:c0d::bc:5228 (North Coast walk) | 7 |
| Sampler, chrome.exe | 142.251.218.238:443 (North Coast walk) | 7 |
| Sampler, node.exe | 127.0.0.1:49159 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:55555 (routes return) | 2 |
| Sampler, node.exe | 127.0.0.1:55179 (routes return) | 4 |
| Sampler, postgres.exe | 127.0.0.1:57361 (routes return, SMS gateway, webhook expiry and resend) | 2123 |
| Sampler, postgres.exe | 127.0.0.1:57358 (routes return, SMS gateway, webhook expiry and resend) | 1799 |
| Sampler, postgres.exe | 127.0.0.1:57362 (routes return, SMS gateway, webhook expiry and resend) | 2048 |
| Sampler, postgres.exe | 127.0.0.1:57365 (routes return, SMS gateway, webhook expiry and resend) | 2085 |
| Sampler, postgres.exe | 127.0.0.1:57363 (routes return, SMS gateway, webhook expiry and resend) | 2975 |
| Sampler, postgres.exe | 127.0.0.1:57364 (routes return, SMS gateway, webhook expiry and resend) | 2459 |
| Sampler, postgres.exe | 127.0.0.1:57368 (routes return, SMS gateway, webhook expiry and resend, done) | 3330 |
| Sampler, postgres.exe | 127.0.0.1:57366 (routes return, SMS gateway, webhook expiry and resend) | 1912 |
| Sampler, postgres.exe | 127.0.0.1:57360 (routes return, SMS gateway, webhook expiry and resend, done) | 3330 |
| Sampler, node.exe | 127.0.0.1:63679 (routes return) | 3 |
| Sampler, node.exe | 127.0.0.1:63680 (routes return) | 3 |
| Sampler, node.exe | 127.0.0.1:63678 (routes return) | 3 |
| Sampler, node.exe | 127.0.0.1:53105 (routes return, SMS gateway, webhook expiry and resend) | 56 |
| Sampler, node.exe | 127.0.0.1:58172 (SMS gateway) | 3 |
| Sampler, node.exe | 127.0.0.1:58173 (SMS gateway, webhook expiry and resend) | 59 |
| Sampler, node.exe | 127.0.0.1:58174 (SMS gateway, webhook expiry and resend) | 52 |
| Sampler, node.exe | 127.0.0.1:52445 (SMS gateway, webhook expiry and resend) | 58 |
| Sampler, node.exe | 127.0.0.1:52444 (SMS gateway, webhook expiry and resend, done) | 3289 |
| Sampler, node.exe | 127.0.0.1:55557 (SMS gateway, webhook expiry and resend, done) | 3347 |
| Sampler, node.exe | 127.0.0.1:51196 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:54098 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:63099 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:57676 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:54848 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:51523 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:52637 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:54407 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:51806 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:57609 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:49655 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:54925 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:52778 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:59202 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:49469 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:55964 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:55867 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:55570 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:49313 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:60911 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:50677 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53878 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:61774 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:61645 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:64068 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53692 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:57532 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:59556 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:64611 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:58101 (webhook expiry and resend) | 2 |
| Sampler, node.exe | 127.0.0.1:58981 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:54937 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:55646 (webhook expiry and resend) | 4 |
| Sampler, node.exe | 127.0.0.1:57308 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:50227 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:64461 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:63959 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:49452 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:49912 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:65096 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:63914 (webhook expiry and resend) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63915 (webhook expiry and resend, done) | 1096 |
| Sampler, node.exe | 127.0.0.1:64713 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:56993 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:63842 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:64035 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:64501 (webhook expiry and resend) | 4 |
| Sampler, node.exe | 127.0.0.1:52951 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:56822 (webhook expiry and resend) | 4 |
| Sampler, node.exe | 127.0.0.1:60621 (webhook expiry and resend) | 3 |
| Sampler, postgres.exe | 127.0.0.1:63684 (webhook expiry and resend, done) | 529 |
| Sampler, node.exe | 127.0.0.1:63685 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:57588 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:53637 (webhook expiry and resend) | 4 |
| Sampler, postgres.exe | 127.0.0.1:57094 (webhook expiry and resend, done) | 334 |
| Sampler, node.exe | 127.0.0.1:57093 (webhook expiry and resend) | 3 |
| Sampler, postgres.exe | 127.0.0.1:57101 (webhook expiry and resend, done) | 323 |
| Sampler, node.exe | 127.0.0.1:59128 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:65373 (webhook expiry and resend) | 4 |
| Sampler, node.exe | 127.0.0.1:57663 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:64115 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:61026 (webhook expiry and resend, done) | 64 |
| Sampler, node.exe | 127.0.0.1:61027 (webhook expiry and resend, done) | 64 |
| Sampler, node.exe | 127.0.0.1:64277 (webhook expiry and resend) | 3 |
| Sampler, node.exe | 127.0.0.1:55554 (done) | 1 |
| Sampler, node.exe | 127.0.0.1:56269 (done) | 1 |
| Chromium log, a page's request | localhost | 488 |
| Page | localhost:62621 | 660 |

## Outside addresses written in the code

None is contacted in the run above. Each is text: documentation and attribution links a person may follow, schema and namespace identifiers, example values in help text, error messages from bundled libraries, and addresses of optional integrations and catalog sources an administrator must configure and switch on (IPAWS, feeds, catalog data sources, federation peers). Here the integrations point at stand-ins on this computer and none of these addresses is configured, so none is contacted; on an air-gapped network any that is configured fails without affecting the rest.

| Host | Where |
|---|---|
| cwwp2.dot.ca.gov | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| docs.oasis-open.org | server/src/ipaws/connector.ts |
| emilms.fema.gov | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/dictionary/lifelines.ts |
| eoc.example.org | server/src/notify/mass.ts |
| gis.data.ca.gov | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| github.com | deploy/windows/out/build/app-dist/assets/CopMap-GIoOzo_J.js, deploy/windows/out/build/app-dist/assets/field-submissions-CHYHCQTY.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-worker-CNLXcz58.js |
| gov.fema.ipaws.services | server/src/ipaws/connector.ts |
| hifld-geoplatform.opendata.arcgis.com | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| hooks.example.org | deploy/windows/out/build/app-dist/assets/AdminSurface-CNB6vFFO.js, server/src/notify/allowlist.ts |
| humboldtgov.org | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| incidents.fire.ca.gov | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| json-schema.org | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js |
| maplibre.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| react.dev | deploy/windows/out/build/app-dist/assets/index-CTgCKCmm.js, deploy/windows/out/build/app-dist/assets/react-dom-hf6EcyAr.js |
| schemas.openxmlformats.org | server/src/boards/transfer.ts |
| schemas.xmlsoap.org | server/src/ipaws/connector.ts |
| wiki.openstreetmap.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| www.caloes.ca.gov | shared/src/dictionary/esf.ts |
| www.census.gov | deploy/windows/out/build/app-dist/assets/src-wgY3pEvL.js, shared/src/data-packs/catalog.ts |
| www.opengis.net | server/src/geo/routes.ts |
| www.w3.org | deploy/windows/out/build/app-dist/assets/CopMap-GIoOzo_J.js, deploy/windows/out/build/app-dist/assets/Icon-BV0fzTPS.js, deploy/windows/out/build/app-dist/assets/MapSurface-BYq4GWdH.css, deploy/windows/out/build/app-dist/assets/index-CTgCKCmm.js, and 4 more |

## The browser's own requests

Chromium reached these for its own services while it ran, in requests no page started. They are not the system's connections and are not counted above.

- clients2.google.com (1 request)
- www.gstatic.com (1 request)
- update.googleapis.com (3 requests)
- accounts.google.com (1 request)
- www.google.com (2 requests)
- edgedl.me.gvt1.com (1 request)
- content-autofill.googleapis.com (10 requests)
- android.clients.google.com (4 requests)
- socket 2607:f8b0:4005:815::200e:443 (North Coast walk)
- socket 2607:f8b0:4005:801::2003:443 (North Coast walk)
- socket 2001:4860:4828:7700:::443 (North Coast walk)
- socket 2607:f8b0:4005:80a::200e:80 (North Coast walk)
- socket 2001:4860:4842:400:::443 (North Coast walk)
- socket 2607:f8b0:4023:1c03::54:443 (North Coast walk)
- socket 2001:4860:482a:7700:::443 (North Coast walk)
- socket 2600:1900:4110:86f:::80 (North Coast walk)
- socket 2607:f8b0:4023:c0d::bc:5228 (North Coast walk)
- socket 142.251.218.238:443 (North Coast walk)

## Outside connections

None.
