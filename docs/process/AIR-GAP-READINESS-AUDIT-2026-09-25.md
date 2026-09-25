# Air-Gap Readiness Audit: Open Source EOC

**Created:** 2026-09-25
**Author of record:** Basho Parks (audit compiled by a Claude Code session)
**Purpose:** States Basho's air-gap requirement as four scenarios, audits the tree against each with file and line evidence, credits what unit RD5 proved, names what RD5's definition does not test, ranks the remaining gaps for an air-gapped tribal EOC, and lists candidate work. Written to inform future rosters; its candidates are carried as units into the proposed [Veoci Integration and Air Gap PSPR](./VEOCI-AIR-GAP-PSPR-2026-09-25.md).
**Status:** AUDIT COMPLETE on `main` at `4ccad8e` (version 0.9.1, after the Operator Trust landing). Read-only: no code was changed. This document is not a roster and authorizes no work.
**Evidence:** code and documents read directly on `4ccad8e`; `path:line` references are to that commit. Receipts are cited by heading. Items marked *(inference)* are reasoned from the code and were not run.
**Relation to other documents:** unit RD5 of the [Operator Trust PSPR](./OPERATOR-TRUST-PSPR-2026-09-24.md) (defined in the [Readiness PSPR](./READINESS-PSPR-2026-09-24.md), decision 8) and its [report](../../AIR-GAP-REPORT.md); INV-3 and AR7 in [FACET-STATUS.md](../FACET-STATUS.md); Veoci's hosting model in [VEOCI-PLATFORM-RESEARCH-2026-09-24.md](./VEOCI-PLATFORM-RESEARCH-2026-09-24.md).

## Summary

Basho, 2026-09-25: "This hybridized open source EEOC software must have an airgap capability." Veoci runs as SaaS on commercial AWS, and no disconnected edition was found (Veoci research, grade M); when the uplink fails, everything but its mobile app's offline form edits is out of reach. Open Source EOC is built the other way round, and RD5 now proves it for the base system: a recorded run of the Windows network host with the North Coast Storm demo opened **no connection outside the machine and its local network** ("Readiness RD5: the air gap"; `AIR-GAP-REPORT.md`), and the console now opens offline after a restart.

RD5 defines "air gapped" as isolation: no outside connection from install through an exercise. That is necessary and it is not the whole requirement. Basho selected four scenarios, and three things RD5's definition does not test decide whether an isolated EOC keeps working for days:

1. **Outbound messages expire a few minutes into an outage.** Email, SMS, webhook and push deliveries dead-letter after 8 attempts, roughly 5 to 20 minutes of backoff, with no resend (`server/src/notify/outbox.ts:86`, `:173`).
2. **Nothing carries data across the gap on media.** Federation has no file path, the jurisdiction export has no import, incident records never federate, and peer trust is a bearer token, not the signature ADR-0006 describes.
3. **Federation can stall after a backfill or a long partition** *(inference)*: every waiting entry for a peer and board goes in one POST, and the receive route takes Fastify's 1 MiB default. RD10's new backfill makes an oversized batch reachable without any outage.

For a Yurok-sized EOC the base system is ready to run disconnected on one Windows host on the tribe's network, with California maps that cover Del Norte and Humboldt counties, local accounts and two-step sign-in, pending Basho's unplugged run. What would fail in a multi-day real outage is messaging continuity, data exchange with the county, and clocks.

## 1. The requirement: four scenarios

| Scenario | Meaning | Selected |
|---|---|---|
| A. Internet cut, LAN up | The EOC's own network and host keep working when the upstream link, cellular backhaul or county WAN is lost | Yes |
| B. Permanent isolated enclave | Installed, updated and operated on a network that never touches the internet: install media, local certificates, local identity, map data and updates carried in | Yes |
| C. Device fully offline | A laptop or tablet with no network keeps working, including after a restart, and reconciles when it rejoins the LAN | Yes |
| D. Carry data across the gap | Incident data moves between separate instances (for example the tribe's host and the county's) on removable media when no network link exists | Yes |

**What an air gap cannot mean.** Public warning and outbound messaging need a carrier. IPAWS needs FEMA's servers, SMS needs a cellular network, email needs a relay. No software sends those with every link cut. For these functions the requirement is: hold the message without loss until a route exists or an operator decides otherwise, show its state, and use whatever local carrier remains (a relay on the LAN, a GSM modem while the towers stand, printed call-down sheets, radio).

## 2. What RD5 proved, and what its definition leaves out

| Item | State on `4ccad8e` | Evidence |
|---|---|---|
| No outside connection during setup step, first start, idle, a 14-section walk over HTTPS and a backup, with every Node, PostgreSQL, Caddy and page connection recorded | **Proven** (PASS, 2026-09-25) | "Readiness RD5: the air gap"; `AIR-GAP-REPORT.md` |
| Scan of the built app and sources for outside addresses | Proven: 20 hosts written in code (documentation links, schema identifiers, optional integrations), none contacted | same |
| Console opens offline after a restart | **Closed** | same; `web/src/app/auth/session.tsx:20`, `:194` |
| Reload offline before the app has cached its files | **Closed** | same |
| Unplugged check for Basho | Script written (`deploy/windows/Test-OpenEOCAirGap.ps1`); **Basho's run pending** | same |
| The setup program's install (services, firewall rule, trusted root) | Not in the recorded run; covered only by Basho's unplugged run | `AIR-GAP-REPORT.md`, "What ran" |
| Behavior with optional integrations configured (SMTP, SMS, webhooks, feeds, federation, IPAWS, collaboration) and the link cut | **Not tested**: the run used the demo with none configured | same |
| Scenario C beyond the two offline-start gaps | Not in RD5's scope | section 6 below |
| Scenario D | Not in RD5's scope | section 7 below |
| Operating for weeks in an enclave: time, certificate renewal, updates, map data | Not in RD5's scope | section 5 below |

Chrome's own background services (update, autofill, account) reached eight Google hosts during the walk; the report lists them apart as the browser's, governed by agency browser policy. An enclave build of the workstation image should set those policies; the project cannot.

## 3. Outbound connections the server opens when an administrator configures them

The base system opens none (RD5). Each of these opens only after configuration. The web client makes no request to another host: the static host sends `connect-src 'self'` and `img-src 'self' data: blob:` (`deploy/windows/lib/static-host.mjs:25`, `:28`), and fonts, glyphs, sprites, the basemap and the map worker are bundled.

| Connection | Code | When the target is unreachable | Loss risk |
|---|---|---|---|
| Email (SMTP), SMS (HTTP provider), webhook, ntfy push | `server/src/notify/outbox.ts` | 10 s timeout; backoff from 5 s doubling to a 15-minute cap; breaker after 5 failures; dead-lettered at attempt 8 (`:86`, `:88`, `:173`) and shown as "Delivery failed" (`web/src/notifications/NotificationTray.tsx:13`) | **Yes.** Roughly 5 to 20 minutes into an outage the message is gone; no resend route exists (`docs/API.md`, notifications routes) |
| Scheduled report email | `server/src/reports/job.ts:26` | Sent directly, not through the queue; "not retried" | That run's report is lost |
| Federation push to a peer | `server/src/notify/outbox.ts:18-21` | Never dead-lettered; backs off and waits | *(inference)* stall: see section 4 |
| Feed polls (CAP, GeoRSS, GeoJSON, CoT by URL) | `server/src/feeds/service.ts` | Last-good items kept and marked stale; the feed stays enabled; a "Feed failing" notice on every failed poll | Notices pile up, about 288 a day per feed at the default five-minute interval; a `feed_items` retention period can purge last-good items during the outage |
| IPAWS-OPEN | `server/src/ipaws/service.ts` ("did not answer") | Recorded as not accepted; a new two-person request is needed | Visible, not queued; unavoidable without FEMA's servers |
| Collaboration backend (Matrix, Mattermost) | `server/src/collab/service.ts:197`, `:331` | In-app fallback only when no backend is configured; with one configured and unreachable, the announcement call throws and the operator gets an error | The announcement is lost |
| Resource escalation to a peer tier | `server/src/resource/routes.ts` | Answers the operator with an error; no queue | The operator must retry |
| OIDC discovery and tokens | `server/src/auth/oidc.ts:46` | Sign-in through OIDC fails; local sign-in still works | None; no OIDC button exists in the web app (no match for "oidc" in `web/src`) |

## 4. Scenario A: internet cut, LAN still up

| Capability | State | Evidence | Note |
|---|---|---|---|
| Other computers and phones reach the host | Works | "Readiness RD3: the Windows network host"; `docs/guides/NETWORK-HOST.md:97` (certificates name the computer name, DNS name and IPv4 address) | A workstation install serves only its own computer (`deploy/windows/desktop.mjs:706`), by design; the host choice is the LAN path |
| Certificates | Works | The host's own authority through Caddy; the root is offered for download on the sign-in page (`deploy/windows/desktop.mjs:703-704`) | Leaf renewal by Caddy on the host needs no outside call (Caddy's documented internal-authority behavior; not tested in this repository) |
| Local sign-in and two-step codes | Works | `server/src/auth/totp.ts` | OIDC works only with an identity provider on the LAN |
| Boards, map, sync, in-app notices, reports on screen | Works | RD5 walk | |
| Map and address search | Works, California only | `tools/basemap/build-bundled-basemap.sh:26-27` | Covers the Yurok Reservation's counties |
| Email, SMS, webhook, push to internet hosts | **Breaks, then loses the message** | Section 3 | The first and worst gap in a real event |
| Email through a relay on the LAN | Works over plain or trusted TLS | `server/src/notify/channels.ts` | *(inference)* a relay on a private authority fails verification: the server service is not started with `--use-system-ca` (only the Connect action is, `deploy/windows/Open-Source-EOC.ps1:71`) and no `NODE_EXTRA_CA_CERTS` is set anywhere in `deploy/windows` or `server/src` |
| Federation with a peer across the internet | Degraded: store and forward | `server/src/notify/outbox.ts:18-21` | *(inference)* stall: `claim_federation_batches` puts every waiting entry for a peer and board into one POST (`server/migrations/0142_federated_deletes.sql:50-64`); the receive route sets no body limit (`server/src/federation/routes.ts:102`) and the server sets none (`server/src/app.ts:191-195`), so Fastify's 1 MiB default applies; an oversized batch is refused and retried without end. RD10's backfill of a whole board (`queue_federation_to`) reaches that size with no outage |
| Federation with a second host on the LAN | *(inference)* likely fails TLS | Same trust gap as the LAN relay | Each host has its own authority and the server trusts neither the other's root nor the Windows store; no test covers two hosts |
| Feeds from the internet | Degraded | Section 3 | Last-good shown stale; alarm flood |
| IPAWS | Breaks | By definition | |
| Collaboration backend off the LAN | Breaks | Section 3 | No fallback when configured |
| Meetings | Only with a Jitsi on the LAN | `server/src/meetings/service.ts` | |

## 5. Scenario B: permanent isolated enclave

| Capability | State | Evidence | Note |
|---|---|---|---|
| Install from media | Designed to work; the recorded run covered the setup step, not the setup program | `AIR-GAP-REPORT.md`, "What ran" | Basho's unplugged run covers the installed system. The setup is not code-signed (`deploy/windows/installer/README.md:227`), so SmartScreen warns on every machine |
| Runtime dependencies | None | The setup carries Node, PostgreSQL with PostGIS and the built app | |
| Upgrade | Works from new media | "Operator trust TP8: upgrades keep configuration" (upgrade report beside the pre-upgrade dump); "Readiness RD11: the remaining checks" (running profiles stopped first) | |
| Backup and restore | Works, same instance | "Readiness RD11: the remaining checks" (hard-linked file store copies) | |
| Identity | Works: local accounts and two-step codes | `docs/guides/ADMIN.md` | Administrators must enroll an authenticator; phones that hold the authenticator app need no network for codes |
| Time | **Unaddressed** | No time-source guidance in `docs/guides` or `deploy/windows` (no match for w32tm, time service or clock drift) | Two-step codes accept one 30-second step either way (`server/src/auth/totp.ts:66-70`); federation settles competing edits by server clock (`docs/adr/ADR-0003-sync-architecture.md:40-44`). A host that drifts during weeks of isolation locks administrators out of two-step sign-in, leaving the ten recovery codes |
| Certificates over months | Works *(Caddy behavior, untested here)* | Section 4 | No expiry or authority-age monitoring found |
| Map data outside California | Needs an internet build | `tools/basemap/` scripts download their sources | Not a gap for the Yurok Tribe; a gap for any tribe or county elsewhere |
| macOS | Not built | "Readiness RD6: macOS, not started" | Windows only |

## 6. Scenario C: a device with no network

| Capability | State | Evidence | Note |
|---|---|---|---|
| Install the app and cache it | Works after one online visit | `web/src/offline/register.ts` (secure origin required) | Every device must trust the host's authority; installing on a phone is still unproven (G-PWA) |
| Open the console offline after a restart | **Works** since RD5 | `web/src/app/auth/session.tsx:20`, `:194` | `docs/guides/FIELD-USER.md:30-34` still describes the old behavior |
| First sign-in with no connection | Breaks, by design | `docs/guides/FIELD-USER.md:30` | Sign in before leaving coverage |
| Smart form reports and task completions | Queue and send later | `web/src/field/field-submissions.ts:71`, `:73` | 10 MB per file, 50 MB per person per incident |
| Request intake and board record drafts | Kept on the device | "Operator trust TP4: durable work and explicit state" | A draft is not a queued send: sending waits for the server, with the work kept and a Retry |
| Map capture, messaging, task creation | Need the connection | `docs/guides/OPERATOR-QUICKSTART.md:398-404` ("two bounded operational paths"); `docs/guides/FIELD-USER.md:69`, `:96` | No offline queue |
| Boards with record rules | Never synced offline | `web/src/offline/field-client.ts:36-37`; `server/src/sync/hub.ts:34` | Refused as restricted; re-entered while connected |
| Incident closed while the device was offline | Queued work refused | `server/src/sync/hub.ts:360` (409) | Stays on the device with no path forward |
| Reconciliation on return | Works | `server/src/sync/hub.ts` | A console edit beats a crossing field edit with no conflict entry (`docs/adr/ADR-0003-sync-architecture.md:40-44`) |
| Storage | The browser decides | `web/src/offline/register.ts` asks for persistence | Eviction is possible on a full device |

## 7. Scenario D: data across the gap on removable media

| Capability | State | Evidence | Note |
|---|---|---|---|
| Federation batches written to a file and read back | **No such feature** | `server/src/federation/routes.ts`; the federation screen has no file action | The scenario Basho selected has no supported path today |
| Manual workaround | Possible, undocumented | `GET /api/v1/peers/:peerId/pending`, then `POST /api/v1/federation/receive` with the peer token (`server/src/federation/routes.ts:102`) | 1 MiB per POST, board ids mapped by hand, entries never marked delivered |
| Trust in a carried batch | **Token, not signature** | `server/src/federation/routes.ts:102`; `docs/guides/FEDERATION-SETUP.md:124` ("Peer authentication is by token today") | ADR-0006 describes Ed25519-signed payloads verified before ingestion (`docs/adr/ADR-0006-federation-trust.md:7-12`); with no channel to authenticate, a file's only trust is a signature, which does not exist |
| Incident records | Never federate, by network or otherwise | "Readiness RD10: federation of record deletes and earlier records" ("Not built: incident records"); `docs/guides/FEDERATION-SETUP.md:84-89` | RD10 named the safe design (an opt-in on the agreement, the partner's copy under its own incident) as Basho's decision |
| Jurisdiction export | Export only | `server/src/export/routes.ts:12` | Archival; no import |
| Board CSV and Excel | Creates records only | `server/src/boards/transfer.ts:209` | Re-importing duplicates; no attachments; the importer is recorded as author |
| CAP and EDXL-RM as files | API only | No web caller of the import routes | A liaison cannot carry a 213RR in as EDXL from a screen |
| Board templates and forms | Works | Designer import of JSON or a signed package; XLSForm import | Configuration crosses the gap; data does not |
| Audit export | Verifiable only by its origin | `server/src/audit/export.ts:26` (HMAC keyed from the instance secret) | The county cannot verify the tribe's chronology pages |

## 8. Gaps, ranked for an air-gapped tribal EOC

1. **High: outbound messages lost a few minutes into an outage** (section 3). The failure is visible but final, and it hits exactly when a small staff most needs the call-down to go out once the link returns.
2. **High: no data exchange by media** (section 7), with no signature to trust a carried file and no incident records in any exchange.
3. **High *(inference)*: federation stall** on a batch over 1 MiB, reachable now through RD10's backfill.
4. **High: field offline is narrow.** Only form reports and task completions queue; map capture, messages and task creation need the connection; boards with record rules and incidents closed while offline strand work.
5. **Medium-high: no local carrier path.** When the internet is gone, nothing helps staff send by a LAN relay, a GSM modem or an SMS phone, or run a printed call-down with acknowledgements entered afterward.
6. **Medium: time.** No guidance or check, and two-step codes tolerate 30 seconds.
7. **Medium *(inference)*: private authorities.** The server trusts neither another host's authority nor the Windows store, so a LAN relay or a second host on a private authority fails verification.
8. **Medium: phones.** Installing the host's root and the app on iOS and Android is unproven.
9. **Medium-low: collaboration configured but unreachable** fails without the in-app fallback.
10. **Low-medium: feed alarms** repeat on every failed poll; retention can purge last-good items.
11. **Low for the Yurok Tribe: maps beyond California** need an internet build.
12. **Evidence: AR7 and INV-3 stay partial** until Basho's unplugged run of install, demo and a host with a second device.

## 9. The project's disconnection claims on `4ccad8e`

**Supported:**
- `deploy/README.md:5-6`, "Nothing in the running system needs the internet": the RD5 run, for the base system.
- `docs/EVALUATOR.md:44`, the app "starts without a connection": true since RD5 for a device that signed in before.
- `docs/guides/FEDERATION-SETUP.md:103`, queued entries "never expire": true, subject to the stall in section 4.

**Unproven:**
- INV-3 as written (`docs/process/archive/VIRTUAL-EOC-PSPR-2026-09-17.md:84`): "Every user-facing function works offline or degraded and reconciles on reconnect; provisioning itself works air-gapped." Messaging, map capture and task creation have no offline path, and provisioning from media awaits Basho's run.
- AR7, full function disconnected including provisioning: the same run.

**Stale or contradicted:**
- `docs/guides/FIELD-USER.md:30-34` describes the offline restart as it was before RD5.
- `docs/SECURITY-CONTINUITY.md:94-95`, the field client "operates offline and syncs on reconnect": only forms, task completions and drafts.
- `docs/adr/ADR-0006-federation-trust.md:7-12` (signed payloads) and `:17` (revocation stops flow immediately): peers use a token, and no revoke route exists in `server/src/federation/routes.ts`.
- `docs/adr/ADR-0003-sync-architecture.md:17` ("never silently") against its own addendum at `:40-44`.
- `CLAUDE.md:98` still describes `field-node/` as a placeholder; the directory is gone (ADR-0008).
- `.githooks/pre-commit` is tracked as mode 100644, so git skips it on Linux and macOS clones, which RD6's Mac work will use; Git for Windows runs it regardless of mode.

## 10. A proposed air-gap clause for future units

For Basho to adopt or reject; it is not in force.

1. Every unit that adds or changes a network path states its behavior in scenarios A to D in its receipt.
2. RD5's proof runs again at each phase gate with every optional integration configured against local stand-ins (an SMTP relay, an SMS provider, a second instance), not only the base system, and records what queued, what expired and what reconciled.
3. No outbound path discards work on an attempt count alone while its target is unreachable; expiry is a time an operator can see and change.
4. Any file that carries operational data between instances is signed by the sending instance and verified before import.

## 11. Candidate work

Candidates only. Sizes as the Finish PSPR defines them (S under a day, M about a day, L two to three, XL split). The proposed [Veoci Integration and Air Gap PSPR](./VEOCI-AIR-GAP-PSPR-2026-09-25.md) places them as units VA1 to VA5, VA19 to VA24 and VA35, and leaves AG-13 to Basho's decision.

| ID | Candidate | Closes | Size | Depends on |
|---|---|---|---|---|
| AG-01 | **Hold, do not drop.** Replace the attempt-count dead letter with an operator-set hold window per channel (default 72 hours), a "waiting for a route" state, a resend for failed deliveries, scheduled report email through the queue with retry | Gap 1 | M | none |
| AG-02 | **Federation batch sizing.** Claim by size so every POST stays under the receive limit; an explicit receive body limit; a two-instance test with a backfill and a backlog over 1 MiB | Gap 3 | S | none |
| AG-03 | **Signed peer identity** as ADR-0006 states: an Ed25519 key per instance, signed batches verified before ingestion, and a revoke route for agreements | Gap 2 (trust) | M | none |
| AG-04 | **Exchange by file.** Export a peer's waiting batch (updates and deletes) as a signed file; import it through the receive lane; a receipt file marks it delivered on the sender; board ids resolved by the agreement | Gap 2 | L | AG-02, AG-03 |
| AG-05 | **Local carriers.** SMS through a phone's SIM or a GSM modem behind the existing HTTP SMS channel; printable call-down sheets with acknowledgements entered afterward; a radio and runner log template | Gap 5 | M | AG-01 |
| AG-06 | **Private authorities and time.** Start the server with the Windows store trusted (or a configured authority file); a clock-offset check in `Test-OpenEOCHost.ps1` and `Test-OpenEOCAirGap.ps1`; a console warning when a device's clock and the server's differ by more than 30 seconds; enclave time guidance | Gaps 6, 7 | S | none |
| AG-07 | **Field breadth.** Queue map captures, messages and task creation offline; sync boards with record rules per record instead of refusing the board; hand work queued against a closed incident to its owner as a late submission | Gap 4 | L | none |
| AG-08 | **Collaboration and feed behavior in an outage.** In-app fallback when a configured backend is unreachable; one open alarm per failing feed; retention that keeps a failing feed's last-good items | Gaps 9, 10 | S | none |
| AG-09 | **Phones on a host's authority.** Installing the root and the app on iOS and Android, walked and documented | Gap 8 | S, plus devices | Basho's phones |
| AG-10 | **The disconnected drill.** Basho's unplugged run, then a 72-hour disconnected tabletop with integrations configured against local stand-ins, recording what queued, expired and reconciled | Gap 12 | S, plus Basho | AG-01 to AG-06 |
| AG-11 | **Document corrections** listed in section 9, including the pre-commit hook's mode | Section 9 | S | none |
| AG-12 | **Region map packs.** A documented procedure to build archives for another region on a connected machine and carry them in, verified by checksum | Gap 11 | S | none |
| AG-13 | **Incident records across instances**, by network and by file: an opt-in on the agreement and the partner's copy under its own incident | Gap 2 (incident data) | XL | Basho's decision, as RD10 recorded; AG-04 |
