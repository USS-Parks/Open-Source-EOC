# Readiness PSPR: Windows and macOS, 150 users, air gap, completion

**Status:** APPROVED 2026-09-24. Basho: "Yes, run it STS with my full
approval now. All necessary or unknown permissions are granted with my
express authorization having been attained with this statement. Do not report
back that you are 'finished' until there is a working downloadable .exe file
for me to install and test out, aesthetically matching the three screenshot
dashboard proofs submitted numerous times now. I don't need CalTrans or
Wildfire or whatever else to be mirrored; I need the functions and features
found on those proofs to work flawlessly, along with LOOK exactly as
presented."
**Prepared:** 2026-09-24, after the partner sharing plan's PS5 lands.
**Authority:** Basho, 2026-09-24:

- "This will be run on Windows and Mac OS machines. Make sure that is the
  case. I do not want a Linux docker build, and NEVER specified that as a
  preference."
- "I want a working demo so that I can test it on my windows machine. I want
  the system to work for 150 concurrent users, and if you can't simulate that
  type of traffic and use load, too bad."
- "I want a platform that can successfully and demonstrably be air gapped in
  a time of organizational vulnerability or black out of internet
  connections."
- The earlier question, why engineering work remained open: the open list in
  `RELEASE-DECISION.md` section 3 is scheduled here, so nothing known is left
  unplanned.

## 1. Goal

A county can install Open Source EOC on Windows or Mac machines, run an
incident for 150 people working at once, and keep running with no internet
at all. Basho can install a working demo on his own Windows machine and see
the North Coast Storm exercise he reviewed. Every known gap is closed or
explicitly accepted by Basho.

## 2. Where it stands

- **Windows workstation:** built (`deploy/windows/`): an Inno Setup installer
  bundling Node, PostgreSQL with PostGIS and the web app, serving on
  `127.0.0.1` only. Built once from an older commit, never installed on a
  clean machine. Its demo profile seeds a small generic dataset
  ("SYNTHETIC Ridge Wildfire Exercise"), not the North Coast Storm scenario
  the design review used.
- **Windows host** (other machines connecting): not built.
- **macOS:** nothing. The launcher refuses to run outside Windows.
- **Linux/Docker:** built, unwanted. It came from the original roster's
  deployment prompt (2026-09-17), written by a planning session, not from
  Basho.
- **150 users:** `scripts/soak.mjs` holds 150 sync sockets for two hours and
  checks memory, and the W2 gate ran it on a test database. It has never run
  against an installed build, never on Basho's machine, and never with 150
  people signing in and working the screens at once.
- **Air gap:** the design keeps everything local (map archives, gazetteer,
  fonts, icons; invariant INV-3), and browser tests block outside addresses.
  No run has recorded every network connection the installed system makes,
  and no one has installed and run it with the network unplugged.
- **CI:** Ubuntu runners, and not running at all since the GitHub billing
  failure.

## 3. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | How agencies share one incident | One Windows or Mac computer is the **host**; everyone else connects to it with Edge, Chrome or Safari, or the installed app, over the local network or a VPN. No internet is needed between them. |
| 2 | HTTPS on a local network | The host creates its own certificate authority at setup; the sign-in page offers a one-time "trust this server" download with steps for Windows and macOS. An agency may install its own certificate instead. Caddy (Apache-2.0, one binary for Windows and macOS) terminates HTTPS on the host. |
| 3 | The Linux/Docker path | Removed from the repository (git history keeps it), the documents, the gates and the release assets. |
| 4 | Supported versions | Windows 10 and 11, 64-bit; macOS 13 or later on Apple Silicon and Intel. Windows Server 2019 and 2022 run the same setup, unproven unless a machine is provided. |
| 5 | Background services | Windows: PostgreSQL through `pg_ctl register`; the server and Caddy through WinSW (MIT); backups through Task Scheduler. macOS: launchd daemons and a launchd backup schedule. |
| 6 | The demo | The Windows (and later macOS) setup offers **Demo: North Coast Storm**, which seeds the reference scenario with its times moved to the day it is installed. Demo accounts are the scenario's people; administrators enroll an authenticator app on first sign-in, as in production (TOTP works offline). |
| 7 | "150 concurrent users" | 150 simulated people, each with its own account and session, working at the same time for two hours: signing in, reading the overview, map, lifelines and boards, editing records, posting in threads, submitting and moving requests, holding live sync sockets. Pass: no errors; 95th-percentile response under 1 second for reads and 2 seconds for writes; live edits reach other users within 2 seconds at the 95th percentile; server memory growth under 10% after warm-up. Run on Basho's Windows machine against the installed host. The load generator runs on the same machine, so the result understates what a dedicated host does; a second machine can drive it later. |
| 8 | "Air gapped" | From install through a full exercise, the system opens no network connection outside the machine and its local network: no internet, no DNS lookups of outside names, no update checks, no map, font or icon fetches. Proven two ways: an automated run that records every connection attempt of every process (must be zero outside), and Basho's check with the network unplugged. |
| 9 | Where installs are proven | Installing services and firewall rules changes system settings, which a session does not do. Basho (or someone he names) runs each setup and its scripted check on a real Windows machine and a real Mac; the output is the receipt. Everything else is automated. The 150-user run needs no system change and runs from this session. |
| 10 | macOS builds | A macOS package can only be built, signed and tested on a Mac: GitHub Actions macOS runners once billing is restored, and Basho's Mac for the install check. |
| 11 | Code signing | Unsigned until the certificates exist (SmartScreen warning on Windows; right-click Open on macOS). An Apple Developer ID and a Windows code-signing certificate are Basho's inputs. |
| 12 | Federation of record edits and deletes (F3) | Built in RD10, so organizations on separate hosts stay in step. Basho may instead accept the current limit and drop the unit. |

## 4. Units, in order

Each unit ends with its tests green, a receipt appended to
`docs/process/V1-LEDGER.md`, one commit and a push. Reports named below land
at the repository root.

### Phase A: Windows, and a demo Basho can install

| Unit | Work | Proof |
|---|---|---|
| RD1 | **Remove the Linux/Docker path.** Delete the Docker and shell deployment files and their tests; replace `deploy/README.md` with a Windows and macOS guide; ADR-0010 (Windows and macOS are the platforms) superseding the deployment parts of ADR-0004 and ADR-0007; strip Docker and Linux deployment from README, EVALUATOR, ROADMAP, SECURITY, the upgrade, recovery and admin guides, the asset inventory and the changelog; rewrite gate 9. | `pnpm check:static`; the link checker; no Docker or Linux deployment instruction left outside the ledgers and archived rosters. |
| RD2 | **Windows demo setup.** Rebuild the installer from the current commit with the offline map archives; fix the license inputs that stop the stage (Node and PostgreSQL/PostGIS license files, the remaining third-party texts); add the "Demo: North Coast Storm" choice; a one-page `TRY-IT-ON-WINDOWS.md`. | The installer tests; a clean install, demo sign-in and the three reference screens run in a Windows sandbox profile; the setup file and its SHA-256 at `deploy/windows/installer/out/`. Basho installs it. |
| RD3 | **Windows host.** A "Host for the network" choice: all users, Program Files, services for PostgreSQL, the server (with its outbox worker and scheduler) and Caddy, a firewall rule for HTTPS, the certificate authority and trust download, scheduled backups, upgrade in place keeping data, clean uninstall. | Automated: generated service, firewall and schedule definitions checked; the server behind Caddy with its own certificate reached from a browser that trusts it; backup, restore and upgrade on a profile. Basho runs the host setup and `Test-OpenEOCHost.ps1`. |

### Phase B: proof of 150 users and of the air gap

| Unit | Work | Proof |
|---|---|---|
| RD4 | **150 concurrent users.** Extend the soak into a 150-person activation harness (decision 7) with its own synthetic accounts, run it for two hours against the installed Windows host on this machine, and write `LOAD-TEST-REPORT.md`: the machine, the mix, request and sync latencies, errors, memory over time, and whether each threshold passed. Fix whatever fails and run again. | The report, with the raw samples beside it. Gate 3 and R1 recorded against it. |
| RD5 | **Air gap.** A connection recorder around every process the system starts (server, PostgreSQL, Caddy, the app window) during install, first run and a full North Coast walk; a scan of the built web app and server for outside addresses; the offline gaps closed (opening the console offline after a restart; a reload offline before the app has cached its files); an unplugged check script for Basho; `AIR-GAP-REPORT.md`. | Zero connections outside the machine and its local network in the recorded run; Basho's unplugged run of install, demo and a host with a second machine on a switch or hotspot with no uplink. AR7 and INV-3 recorded against it. |

### Phase C: macOS

| Unit | Work | Proof |
|---|---|---|
| RD6 | **macOS workstation, host and demo.** Port the launcher; stage Node and PostgreSQL with PostGIS for both architectures, recorded in the asset inventory with the GPL source offer; a `.pkg` with workstation, host and demo choices (launchd, HTTPS, backups, upgrade, uninstall). | On a macOS runner: launcher and installer tests and the full server suite. Basho runs the package and `test-openeoc-host.sh` on a Mac. |
| RD7 | **Connecting to a host.** The installed app on either platform can point at a host instead of running its own server; the trust download and steps; checks in Edge, Chrome and Safari against a host. | Browser tests against a host with its own certificate authority; Safari on the Mac run. |

### Phase D: the open engineering list

| Unit | Work | Proof |
|---|---|---|
| RD8 | **Screens.** Choice labels in change history, record detail, kanban cards and the calendar; `.xlsx` on the WebEOC migration screen; creating from a published template for a jurisdiction admin who is not an instance admin; a console-wide lockdown banner; saving conditions, sorts and groups into template views; drilldown from kanban and calendar widgets; the pool status badges' case; renaming boards activated before the title change. | A browser test per item. |
| RD9 | **Engine.** Workflow reject and cancel with names on history; badge revocation and ICS-211 history; facility registry edit and removal; a status request list; per-resource history, a cap per request, editing local kinds and changing a pool resource's kind or type; an index on `resource_requests(incident_id)`; refusing a duplicate `originRequestId` on the peer; gazetteer reverse lookup, containment, containing city and "St" as "Saint"; parcel vector tiles. | Real-database tests per item; a screen for each operator-facing one. |
| RD10 | **Federation of record edits and deletes** (decision 12), with conflict rules and an audit trail on both sides. | Two-instance tests on real PostgreSQL. |
| RD11 | **Remaining checks.** Coverage measured at `00deba5` and now (gate 20); the scheduler run in an installed profile; the unreproduced `esf-workspace-browser` wait found at its root; the intermittent test worker crash (Windows exit code `0xC0000409`, seen once in `authorized-viewing-browser` and `scheduler` during a full serial run on 2026-09-24, both passing alone) found at its root; the inject-card file and the launcher note on the administrator two-step; stopping running profiles before the setup replaces files; hard links for file store copies. | The measurements in the receipt; tests for each fix. |

### Phase E: CI and the final gate

| Unit | Work | Proof |
|---|---|---|
| RD12 | **CI and reconciliation.** `ci.yml` on Windows and macOS runners with the bundled PostgreSQL and PostGIS, no container; the parity matrix, facet register, README and `RELEASE-DECISION.md` reconciled; the full serial gate. | `pnpm check:gate` green; hosted CI green once billing is restored. |

## 5. Not in this plan

- Any Linux or Docker deployment.
- Native phone apps: phones and tablets use the web app.
- Tagging and publishing a release, which stay Basho's act.

## 6. What only Basho can supply

- Running the Windows setups (RD2, RD3) and the unplugged check (RD5) on his
  machine, and a second machine or phone on a switch or hotspot with no
  internet for the host part of RD5.
- A Mac for the install check (RD6, RD7).
- GitHub Actions billing restored (RD6, RD12).
- An Apple Developer ID and a Windows code-signing certificate, for signed
  installers.
- The remaining gate inputs, unchanged: the screen-reader pass, a second
  maintainer or waiver, acceptance of the release candidate, a pilot
  jurisdiction.

## 7. Completion

Done when: Basho has installed and used the Windows demo; the Windows and Mac
hosts have passed their scripted checks with other machines connecting over
HTTPS; `LOAD-TEST-REPORT.md` shows 150 users passing every threshold for two
hours; `AIR-GAP-REPORT.md` shows zero outside connections and Basho's
unplugged run passed; the open engineering list is closed or accepted item by
item; no Linux or Docker deployment path remains; CI runs on Windows and
macOS; and the full gate is green.
