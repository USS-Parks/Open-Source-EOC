# Operator Trust and Readiness PSPR

Plan date: September 24, 2026
Approval state: **APPROVED 2026-09-24.** Basho: "I approve all for STS in
this session with full permissions granted throughout." This plan is the live
roster; it supersedes the Readiness PSPR for everything not yet landed.
Author of record: Basho Parks.

## 1. Purpose

Finish the Windows and macOS readiness work already approved, land the fixes
from Basho's first hands-on review of the demo, and then make the console's
core operational tasks trustworthy for an occasional operator under pressure:
submitting a request, finding it again, knowing who owns it, making a routine
update, handing work to the next shift, and knowing whether what the screen
shows is current.

The research basis for the new work is
`docs/process/EOC-USER-EXPERIENCE-RESEARCH-2026-09-24.md` (Veoci, WebEOC and
Esri: user friction and selective parity), reproduced in full as Appendix A.
The research itself authorizes nothing; this plan turns its Essential
recommendations into units, and its finite acceptance scenarios into the gates
those units must pass.

## 2. Relationship to the other plans

- `docs/process/READINESS-PSPR-2026-09-24.md` is approved and in execution:
  RD1, RD2 (parts one and two) and RD3 are landed. On approval, this plan
  supersedes it for everything not yet landed. Units RD4 to RD12 carry over
  here unchanged in scope unless a line below says otherwise; their receipts
  keep the RD numbers.
- `docs/process/FINISH-PSPR-2026-09-22.md` remains the execution contract
  where neither plan supersedes it (commit, ledger and landing discipline).
  The root `CLAUDE.md` still names the Finish PSPR as the only live roster;
  when this plan is approved, that section needs the same update the
  Readiness PSPR should already have had.
- `docs/process/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` stays a
  historical research artifact. Unit TP0 adds a dated corrections addendum to
  it (Appendix A, section 8) without rewriting it.
- The canonical frames in `Reference Screenshots/` and
  `docs/design/canonical-references/` remain the visual authority. Competitor
  friction informs behavior and priorities, not a new visual direction.

## 3. Where things stand at plan date

| Item | State |
|---|---|
| RD1 Linux and Docker path removed | Landed, `2c12d73` |
| RD2 part one, the three frames' look | Landed, `65002a3` |
| RD2 part two, the Windows demo setup | Landed, `c1cee52`; setup copied to `deploy/` in `0d1d8df` |
| Icon registry test repaired | Landed, `b37f677` (a failure RD2 part one left on `main`) |
| RD3 Windows network host | Landed, `aa0578a`; setup `deploy/Open-Source-EOC-Setup-0.9.0.exe`, SHA-256 `a118fc6e424fd8827fa137d9118e34a2c1dd0c216df4d0d2f1cc3ba7b52f195e`; Basho has not yet run the host choice or `Test-OpenEOCHost.ps1` |
| Basho's first review (bell, dropdowns, map, ESF scroll, Field Reports, Settings, overview overlap) | Implemented in the working tree, **uncommitted**; targeted tests green; full suite and setup rebuild not yet run. See `SESSION-HANDOFF-2026-09-24.md` at the repository root. |
| RD4 to RD12 | Not started |

## 4. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | Order of work | Land the first review (TP-A), then the load and air-gap proofs Basho asked for by name (RD4, RD5), then the operator trust units (TP1 to TP9), then macOS, the open engineering list, CI and the final gate. Basho may reorder. |
| 2 | Test viewports | Every layout check runs at the frames' 1586 by 992 and at 1534 by 790, the CSS size of a 1920 by 1080 screen at Windows' 125% scaling (Basho's machine). A screen must fit or scroll at both, never overlap or cut off its parts. |
| 3 | Request identity | Every resource request and mission keeps the human-readable number it already shows (REQ-1001 style) as its stable identifier across routing, partner handoff, closure and export. |
| 4 | Request stages | Separate stages for received, accepted (someone owns it), assigned, in progress, fulfilled and closed, plus declined and cancelled with a reason. Receipt never implies acceptance. The existing state machine is extended, not replaced; stored values migrate. |
| 5 | Shift handoff period | The operational period. "Since my last shift" uses the viewer's last sign-out or position change, whichever is later. |
| 6 | Quick transitions | Acknowledge, start, done and hand back are one-click actions with an optional note; decline, cancel and reassign across organizations ask for a reason. |
| 7 | Recipient preview | Available to jurisdiction administrators for any role or partner grant in their jurisdiction; it renders what that recipient can read and names each item the recipient cannot. |
| 8 | Public publishing | Out of scope (FOUO access model). Partner and guest access only. |
| 9 | AI assistance | Out of scope for this plan. |
| 10 | Specialist hazard analysis | Out of scope; would need authoritative methods and qualified ownership first. |
| 11 | Reduced motion and higher contrast overrides in Settings | Deferred: they follow the operating system today. An app-level override touches CSS media queries, JavaScript and tests in several places and is its own small unit if Basho wants it (TP-B). |
| 12 | Where installs are proven | As in the Readiness PSPR: installing services, firewall rules and trusted roots changes system settings, which a session does not do. Basho runs the setups and their scripted checks. |

## 5. Execution model

One unit at a time, in order, each on current `main`. Fan-out lanes are
permitted under the standing grant (lane branches, worktrees, fast-forward
zipper) only for units that own disjoint files; the integrating session lands
them one at a time. Commit and push discipline follows `CLAUDE.md` and
`CANON.md`: plain commit messages, the hook-appended footer, no AI credit,
never `--no-verify`, files staged individually.

Every unit ends with:

1. Its gate green (section 7).
2. A receipt appended to `docs/process/V1-LEDGER.md` (what changed,
   defaults and deviations, verification with the commands and results,
   what was not run and why, evidence level, rollback).
3. One focused commit and a push.

Every phase ends with a rebuilt Windows setup copied to `deploy/` with its
SHA-256 in the receipt, so Basho always has a current build to install.

## 6. Units, in order

### Phase TP-A: land Basho's first review

| Unit | Work | Proof |
|---|---|---|
| TP-A1 | **The first review, landed.** Finish and land the working-tree changes: the bell opens a notifications panel flush under it (items addressed to the person, unread first, opening one in the notification center marks it read; the Context drawer no longer carries the tray); the incident, period and position lists and the account menu hang flush from the command bar (Chrome and Edge customizable selects; other browsers keep their native list); every workspace scrolls instead of clipping (the ESF coordination grid); the Map screen's map fills the page with the layers column foldable, Add point and its form floating over the map and the impact indicators opening over its foot on request; Field Reports is a triage screen (counts, unverified first, reporter and time, verify and unverify, show on map, open record) backed by `createdAt` and `createdByName` on board view records; Settings has General, Account (change password, which ends other sessions and is audited: migration `0137_change_own_password.sql`, `POST /api/v1/auth/password`), Notifications (desktop alerts and a sound for arrivals), Map (distance units, coordinate format, grid references), This computer (offline copy, storage, clear) and About; the theme is chosen only at the rail's foot; the overview's lifeline rows and map legend no longer overlap or clip on a short screen. | `pnpm check:static`; `pnpm test:desktop`; `pnpm test:ci` green (the suite was started and stopped at plan date, not completed); `console-controls-browser.test.ts` (six checks at 1534 by 790), `password-change.test.ts`, the updated field reports, map, shell, KPI, viewing, cross-boundary, D33 and fidelity tests; fidelity captures at 1586 by 992 unchanged against the frames; setup rebuilt and copied to `deploy/`. Receipt heading: "Readiness RD2 part three: the first review". |

### Phase RD-B: the proofs Basho named

| Unit | Work | Proof |
|---|---|---|
| RD4 | **150 concurrent users**, as the Readiness PSPR defines it (decision 7 there): 150 synthetic people with their own accounts and sessions, two hours, against the installed Windows host on this machine. Note from RD3: behind Caddy the flood limiter keys on the forwarded client address (`OPENEOC_TRUST_PROXY=127.0.0.1`); a load generator on one machine presents one address, so the harness must spread client addresses or the run must account for the limiter explicitly and say so. | `LOAD-TEST-REPORT.md` at the repository root with raw samples; every threshold recorded pass or fail. |
| RD5 | **Air gap**, unchanged: a connection recorder over every process, a scan for outside addresses, the offline gaps closed, an unplugged check script for Basho, `AIR-GAP-REPORT.md`. | Zero outside connections recorded; Basho's unplugged run. |

### Phase TP-C: operator trust (from the research, Appendix A)

Each unit names the research findings it answers and the acceptance scenario
(Appendix A, section 7) that gates it. A scenario runs as a browser test on
the North Coast Storm scenario at both test viewports, as the role it names.

| Unit | Work | Research basis | Gate |
|---|---|---|---|
| TP0 | **Corrections addendum** to the September 17 platform research: the five qualifications in Appendix A section 8, dated, appended, not rewritten. | Section 8 | Link check; review by Basho. |
| TP1 | **Request lifecycle and findability.** Durable receipt on submit (number, time, stage, where it went); the stages in decision 4 with receipt, acceptance and ownership kept distinct; the owner and next action on every request; readable history; search across open and closed authorized requests with every active filter shown and explained; a request routed to a partner shows its destination and whether anyone accepted it; the submitter keeps sight of it after routing. | W2, W4, V1, section 5 rows 2 and 3 | Scenario 3 (request crosses a handoff). |
| TP2 | **My work.** A role-based queue for the acting position and person: my assignments, unowned work in my section, overdue work, and quick transitions (decision 6) without opening the whole record; a team view for section chiefs; dense, detachable tables kept for EOC staff. | W3, V1, section 6 Essential rows | Scenario 1 (occasional operator returns). |
| TP3 | **Shift handoff.** A briefing view for the period: material changes since the viewer's last shift, unresolved requests and overdue work with owners, decisions awaiting action, each linked to its source record; the reporting period stated; the full log kept behind each item. | W1 | Scenario 4 (shift change). |
| TP4 | **Durable work and explicit state.** One state language across board records, requests and field reports: draft, saved on this computer, received by the server, failed (with the reason and a retry); unfinished forms survive navigation, a phone call, a closed tab and session expiry, attachments included, and reconcile on return with any conflict shown. Builds on the existing offline queue and saved-session work. | V2, section 5 rows 1 and 7 | Scenario 2 (request survives interruption). |
| TP5 | **Information state you can read.** Observation time and last-received time on lifelines, feeds, datasets and map layers; stale and unknown never shown as healthy or zero; an empty list or map says which of no records, active filters, no permission or an unavailable source it is; sign-in and access failures name the cause (wrong organization, expired session, unreachable server, insufficient permission, integration unavailable). | W5, E6, E7, section 5 rows 4 and 9 | Scenario 6 (map and records agree). |
| TP6 | **Partner invitations and recipient preview.** An invitation names the organization, the incident and the access granted; a deep link returns to the intended item after sign-in; a refusal explains who the item is for and what to ask for without disclosing it; administrators preview what a role or partner grant can read (decision 7), with each restricted dependency named; sharing shows scope and delivery state and says plainly that revoking access does not recall copies already delivered. | V3, E3, W4 | Scenario 5 (partner follows a link). |
| TP7 | **Incident close and reopen.** An end-of-incident workflow that states what stays active, what becomes historical and how to find or reopen it; the active incident always prominent; searching across incidents a deliberate act. Extends the existing archival. | E2 | Scenario 7 (incident closes). |
| TP8 | **Upgrades keep configuration.** A supported upgrade keeps local templates, fields, views, dashboards and role grants, or produces a reviewable migration with a recovery path; the pre-upgrade backup (RD3) covers the database; a test upgrades a configured profile across a migration and checks the roles keep their capabilities. | E4, E5 | Scenario 8 (configuration moves forward). |
| TP9 | **From the map to the action.** Selecting a facility, shelter, closure or report on the map opens its current status, observation time, source and responsible person beside the map without losing the map's view; map, list and detail stay coordinated on the same record; coverage limits shown where a count is partial. | E1, E7 | Scenario 6, map half. |

The research's Valuable rows (templates, resource custody, forms and plans,
interagency exchange, local fields) are covered in part by work already on
`main` and by RD8 to RD10; anything beyond that is a later plan's scope.

### Phase RD-D: macOS and connecting to a host (carried)

| Unit | Work | Proof |
|---|---|---|
| RD6 | macOS workstation, host and demo, as the Readiness PSPR states. | macOS runner; Basho's Mac run. |
| RD7 | Connecting to a host from the installed app and from Edge, Chrome and Safari, with the trust download. RD3 already serves the download and the sign-in page's steps; RD7 adds the installed app's "connect to a host" choice and the Safari run. | Browser tests against a host with its own authority; Safari on a Mac. |

### Phase RD-E: the open engineering list (carried)

| Unit | Work | Proof |
|---|---|---|
| RD8 | Screens, as listed in the Readiness PSPR. | A browser test per item. |
| RD9 | Engine items, as listed. | Real-database tests; a screen for each operator-facing one. |
| RD10 | Federation of record edits and deletes (Basho may drop it and accept the limit). | Two-instance tests. |
| RD11 | Remaining checks, as listed, with one lead added: the intermittent Windows exit `0xC0000409` also stopped the Vite dev server during this session (not only test workers), so the root cause is outside the test harness. | Measurements and tests in the receipt. |
| TP-B | Optional: reduced motion and higher contrast as app-level settings (decision 11). Only if Basho asks. | Tests for each override. |

### Phase RD-F: CI and the final gate (carried)

| Unit | Work | Proof |
|---|---|---|
| RD12 | `ci.yml` on Windows and macOS runners; the parity matrix, facet register, README and `RELEASE-DECISION.md` reconciled, now including scenarios 1 to 8; the full serial gate; the final setup. | `pnpm check:gate` green; hosted CI green once billing is restored. |

## 7. Verification gates

Cheapest first, per CANON section 2:

1. `pnpm check:static` (typecheck, lint, license scan, link check).
2. `pnpm test:desktop` when anything under `deploy/windows` changed.
3. The unit's own tests, then `pnpm test:ci`.
4. For a unit with a screen: its acceptance scenario as a browser test at
   1586 by 992 and 1534 by 790, no page errors, no request outside the
   machine.
5. At each phase end: `pnpm check:gate` (serial), the setup rebuilt and
   copied to `deploy/` with its SHA-256.

A passing gate is a stopping point. No reassurance runs beyond the gate
unless something changed or failed (CANON section 13). The known Windows
worker crash (`0xC0000409`) keeps its precedent until RD11 finds the cause:
one isolated retry of the crashed file, stated plainly in the receipt.

## 8. Not in this plan

- Any Linux or Docker deployment.
- Public warning or public information publishing.
- AI summaries or assistance.
- Specialist hazard analysis (ERG, threat plumes and the like).
- Native phone apps; phones and tablets use the web app.
- Tagging and publishing a release, which stay Basho's act.

## 9. What only Basho can supply

- Approval of this plan, and any reordering.
- Running the Windows host choice and `Test-OpenEOCHost.ps1`, the unplugged
  check with a second device, and the Mac install checks.
- GitHub Actions billing restored (RD6, RD12).
- An Apple Developer ID and a Windows code-signing certificate for signed
  setups.
- Representative users, if time, click-count or completion-rate targets are
  wanted for scenarios 1 to 8 (Appendix A, section 7).
- The standing release inputs: the screen-reader pass, a second maintainer or
  waiver, acceptance of the release candidate, a pilot jurisdiction.

## 10. Completion

Done when: the first review is landed and Basho has installed the rebuilt
demo; `LOAD-TEST-REPORT.md` shows 150 users passing every threshold for two
hours; `AIR-GAP-REPORT.md` shows zero outside connections and Basho's
unplugged run passed; acceptance scenarios 1 to 8 pass as browser tests on
the North Coast Storm scenario at both test viewports; the Windows and Mac
hosts have passed their scripted checks with other machines connecting over
HTTPS; the open engineering list is closed or accepted item by item; CI runs
on Windows and macOS; the full gate is green; and a final setup with its
SHA-256 sits in `deploy/`.

## Appendix A. Research basis

The research below is reproduced from
`docs/process/EOC-USER-EXPERIENCE-RESEARCH-2026-09-24.md` without change
except that its headings are demoted two levels to sit inside this appendix.
As its own status line says, it is research and design recommendations and
does not by itself authorize implementation; this plan's approval does.

### VEOCI, WebEOC, and Esri emergency management: user friction and selective parity

Research date: September 24, 2026  
Purpose: Decide which operational capabilities Open Source EOC should match, and which interaction burdens it should avoid.  
Status: Research and design recommendations. This document does not authorize implementation, alter the approved roster, or establish that our current application passes these recommendations.

#### 1. What the evidence says

The strongest opportunity is to make operational work understandable and dependable: submitting a request, finding it again, knowing who owns it, making a routine update, and handing work to the next shift. A large feature catalog does not establish that an occasional EOC operator can do those things under pressure.

The three products have different strengths and different friction patterns:

| Platform | Most useful capabilities to learn from | Friction supported by the sources | Recommended parity stance |
| --- | --- | --- | --- |
| Veoci | Configurable incident workspaces, plans, forms, partner participation, resource custody, communications | Workflow-building effort; confusing conversation organization; dated but repeated mobile complaints about navigation, interruptions, authentication, and lost work | Match adaptable operations and partner participation. Make the default workflow usable before anyone builds a custom one. |
| WebEOC | Structured resource coordination, shared operational records, incident boards, agency interoperability | Historical board fragmentation, laborious updates and shift catchup; deployment-specific request findability concerns; current exchange and identity configuration requirements | Match coordination depth. Put a coherent request lifecycle and role-based work queue in front of the board structure. |
| Esri emergency management solutions | Spatial context, lifelines, impact analysis, linked maps and dashboards, reusable GIS applications | Configuration and sharing dependencies; upgrade maintenance; migration changes in who can use a feature; some confusing incident lifecycle controls | Match the connection between place, impact, and action. Keep GIS administration out of routine operator work. |

These are qualitative findings, not a ranking of defect rates or overall product quality. Public complaints do not establish how frequently a problem occurs.

##### Research boundaries

The evidence includes an official disaster after-action report, an academic exercise study, named customer reviews, mobile app reviews, user support threads, and current vendor documentation. The source register below identifies their different evidentiary roles.

No authenticated hands-on evaluation of current Veoci, WebEOC Nexus, or an agency's Esri deployment was performed. There are no independently measured click counts, response-time comparisons, accessibility scores, or success rates in this report. Configuration, local policy, training, licensing, connectivity, and software behavior can each produce a bad experience; the sources do not always isolate the cause.

Esri is evaluated as a collection of applications and services, especially Emergency Management Operations, Emergency Information Manager, dashboards, and related field/analysis tools. An ArcGIS Online restriction must not be generalized to every ArcGIS Enterprise deployment. Likewise, a 2016 WebEOC exercise is not a test of today's Nexus, and an old mobile review is not proof of a defect in the current build.

#### 2. Veoci: flexibility is useful, but users should not have to assemble usability

##### V1. Configurable does not always mean easy to configure

Capterra's ten-review sample is broadly positive: 4.6 overall and 4.4 for ease of use at retrieval. In March 2019, Jennifer N. described workflow development as sufficiently difficult and time-consuming that she avoided it; Kelly B. linked value to customization effort and available support hours; Brian H. found the conversation cockpit difficult to explain during training. The same sample praises support, adaptable workflows, guest participation, and end-user simplicity. Several reviews disclose vendor referral or incentives. [V01]

**Interpretation:** distinguish the administrator who builds the experience from the responder who consumes it. Positive end-user usability and difficult workflow construction can both be true.

**Avoid:** a blank workflow canvas as the first meaningful product experience; different names and layouts for the same common task in every department; dependence on one staff member who understands the configuration.

**Prefer:** a complete default request, assignment, update, escalation, and closure process. Allow administrators to change local fields and routing while preserving recognizable status meanings. Explain workflow changes in operational language and let administrators preview the resulting operator experience.

##### V2. Mobile interruptions can undermine confidence in the entire workflow

The US iOS listing showed 2.6/5 from 30 ratings. Reviews from 2019 through 2025 describe interrupted checklist work, slow navigation, repeated login, app/browser handoffs, and difficulty finding expected editing functions. A 2025 reviewer explicitly preferred the website to the app. Positive reviews also report improvements. These are version- and device-dependent anecdotes, not current-build reproductions. [V02]

On Google Play, a January 2024 reviewer reported crashes when changing tabs and reauthentication after switching away. Older reviewers describe similar interruption problems. The listing was updated September 2, 2026, so those accounts cannot establish whether that release retains the problems. [V03]

**Operational consequence, inferred:** a responder starts treating navigation, answering a call, or switching to a camera as a risk to unfinished work.

**Avoid:** making the operator infer whether work survived from whether a spinner disappeared.

**Prefer:** explicit local-draft and server-saved states; restoration after an interruption; preserved attachments; clear recovery after session expiry. Authentication must remain secure, with unfinished work protected rather than silently discarded.

##### V3. A link is not useful if its recipient cannot reach the intended task

An iOS review from July 2025 describes an evacuation-map link ending at a login screen without an apparent registration path. The review does not establish whether Veoci, the publishing agency, or link configuration caused the problem. [V02]

**Avoid:** generic access-denied pages with no explanation of the intended audience or next step.

**Prefer:** invitations that identify the organization, incident, and access required; a direct route back to the intended item after authentication; an administrator preview of what the recipient can access.

For our application this translates to authorized members and mutual-aid guests. It does not authorize anonymous access or a public warning portal.

##### V4. What is worth matching

Veoci's documented room model includes role-based participants and guests, forms, tasks, processes, maps, saved views, and plan-template activation. Its resource-management offering describes barcode checkout, custody tracking, and offline logging for later upload. These establish capability claims, not independently tested usability. [V04] [V05]

**Keep the operational ideas:** repeatable activation, a shared incident context, field-to-EOC information flow, controlled partner access, and accountable resource custody.

**Improve the product contract:** joining a room should immediately make the operator's assignment, current incident, and next action clear. A flexible container should not become another place to search.

#### 3. WebEOC: preserve coordination depth while reducing board and process fragmentation

##### W1. An activity stream is not a shift briefing

The University of Washington's 2018 research on the 2016 Cascadia Rising exercise describes WebEOC navigation, retraining, information-finding, manual consolidation, and cross-board coordination difficulties. Deployments included versions 7.3, 7.6, and 8.1. Participants struggled to turn chronological activity into a current operational picture. This is strong historical workflow evidence, not a current Nexus evaluation. [W01]

**Avoid:** treating a long log as sufficient situational awareness.

**Prefer:** a shift view containing current conditions, material changes since the last briefing, unresolved requests, overdue work, current owners, and decisions awaiting action. Preserve the detailed log behind each item. A summary must link to its source and indicate its reporting period.

Do not force users to choose between losing detail and reading every historical entry.

##### W2. Requests that are hard to find can feel indistinguishable from requests that were lost

Buncombe County's Tropical Storm Helene after-action report records difficulty searching entered WebEOC requests and participant accounts of requests disappearing, alongside changing logistics processes and initially missing mission numbers. Crucially, Appendix C-3, printed pages 57-58, says these are interview participants' perceptions and experiences, not verified facts. The report also records the eventual local WebEOC rollout as a success. It does not establish a software data-loss defect or assign the disaster's logistics problems to WebEOC. [W02]

**Avoid:** submission with no durable receipt; filters that silently hide newly submitted work; status changes that remove an item from the submitter's view without explanation.

**Prefer:** a stable request number, time of receipt, current owner, explicit stage, and readable history. Search should find authorized records across open and closed states, with filters visibly explained. If a request moved to another organization, show where it went and whether anyone accepted responsibility.

This is a higher-value objective than visual resemblance to a request board.

##### W3. Routine updates should not feel like data entry projects

The single G2 WebEOC review found, dated April 2019, praises consolidated multi-agency information and detachable windows but reports lag and excessive typing, asking for easier selection-based updates. One review is not representative. [W03]

A September 2023 emergency-management Reddit discussion similarly describes cumbersome editing and locally customized boards. Versions are unclear, and vendor-affiliated contributors participate in the thread; their promotional comparisons are not independent evidence. [W04]

**Avoid:** opening a large edit form to acknowledge an assignment or update a simple status.

**Prefer:** concise, contextual actions for routine transitions. Request a reason or confirmation when a transition has material consequences. Preserve timestamps and attribution without requiring users to retype information the system already knows.

Keep detachable views and dense tables available for experienced EOC staff. Simplification should not eliminate efficient multi-monitor work.

##### W4. Local customization can create regional coordination work

A 2018 Bay Area UASI memorandum describes a regional WebEOC standardization effort around shared resource, situation, and shelter boards. It demonstrates that common software alone does not guarantee common operational records. [W05]

Current Juvare Exchange documentation requires administrative setup, eligible versions and agreements, incident/board mapping, and compatible hosting regions or enclaves. It also describes limits on incident sharing and warns that shared data cannot be retracted. Those are actual configuration and information-sharing constraints, not proof that interoperability is absent. [W06]

**Avoid:** assuming a record is shared because it appears in a local board; inconsistent definitions of requested, accepted, assigned, and fulfilled; implying that revoking access erases copies already delivered.

**Prefer:** a small common operational record with optional local extensions. Show destination, sharing scope, delivery state, and responsibility separately. Preserve origin identifiers so local and partner records can be reconciled.

##### W5. Access and service dependencies must be legible

Current Juvare troubleshooting documentation identifies connectivity, instance URLs, HTTPS certificates, and URL suffixes as possible mobile sign-in issues. Its login-services guidance covers differing identity configurations and an on-premises limitation. Its communications documentation explains that blocked cloud-service connections can affect notifications and the freshness or availability of connected features. [W07] [W08] [W09]

**Avoid:** a generic login failure, an apparently healthy empty inbox, or stale information displayed as current.

**Prefer:** actionable diagnostics: wrong organization, expired session, unreachable service, insufficient permission, or unavailable integration. Show when information last arrived. Do not turn an authentication error into a misleading claim that there are no requests.

##### W6. What is worth matching

Today's Nexus offering advertises role-based dashboards, low-code configuration, incident planning and reporting, GIS integrations, mobile/offline forms, notifications, and agency exchange. The board catalog distinguishes included, premium, separately licensed, and industry-specific capabilities. Old complaints do not establish that these current capabilities are missing or unusable. [W10] [W11]

**Keep the operational ideas:** structured coordination, resource request lifecycle, repeatable incident records, role views, agency exchange, and traceable reporting.

**Improve the experience:** one understandable operational model across those capabilities. Do not require users to learn the product's module boundaries to complete a single request.

#### 4. Esri: preserve the spatial intelligence while reducing configuration and access surprises

##### E1. A collection of useful applications can still feel like several systems

Esri's November 2023 redesign announcement explicitly says customers wanted a more mobile-friendly experience, easier startup, less map/app redundancy, and easier public information delivery. It describes work intended to address those requests. This is vendor-reported feedback and a historical mitigation, not independent proof that every deployment still has those problems. [E01]

The Emergency Management Operations documentation describes linked applications and dashboards, user-type requirements, and release-specific changes to incident filtering, timestamps, and refresh behavior. [E02]

**Avoid:** forcing an operator to know which map, survey, dashboard, application, or layer owns an action.

**Prefer:** task language such as report damage, update shelter status, inspect affected facilities, and assign follow-up. Maintain incident, geographic selection, and relevant filters across the task. Keep the map and table as coordinated views of the same authorized records.

##### E2. Existing lifecycle controls can be too hard to discover

A user asked how to reset Emergency Management Operations for another incident without losing previous data. Esri's accepted answer explains that multiple incidents are supported and that Active Incident and other status fields control what appears; a new deployment for each event is unnecessary. The migrated page did not expose a dependable posting date during retrieval. This is evidence of discoverability friction, not a missing archive capability. [E03]

**Avoid:** making incident closure feel like deleting data or rebuilding an application.

**Prefer:** an explicit end-of-incident workflow explaining which items remain active, what becomes historical, and how to reopen or find prior records. Show the active incident prominently and make cross-incident searches deliberate.

##### E3. Sharing the application does not necessarily share its dependencies

In an emergency-management Notices and Evacuations support thread, the author believed everything was public but could not view the map while signed out. Their resolution involved checking individual items' sharing and using a private browser or clearing cached state to confirm visibility. The retrieved migrated page did not expose a reliable posting date. This is a resolved configuration experience, not a demonstrated platform outage. [E04]

**Avoid:** letting a publisher see a working map that the intended recipient cannot use, with no explanation of the difference.

**Prefer:** a recipient-view preview and a dependency check that identifies the particular restricted dataset or attachment. For Open Source EOC, apply this to approved roles and guests; public publishing remains separate scope.

##### E4. Upgrade maintenance is part of usability

Official ArcGIS Solutions upgrade guidance describes deploying updated items alongside existing ones, reapplying configurations, and, where needed, migrating data and updating dependencies. It does not say existing customizations are automatically destroyed. [E05]

A concrete June 2026 example is Esri's Emergency Management Operations infographic guidance: a changed data source can trigger a deprecation message and requires reconfiguration of the relevant application/widget. This concerns a particular infographic dependency, not the failure of the entire solution. [E06]

**Avoid:** a product where every upgrade turns the local administrator into a migration project manager.

**Prefer:** configuration that survives supported upgrades, explicit compatibility boundaries, and a reviewable migration path when preservation is impossible. Provide a usable default so organizations are not forced into extensive customization merely to operate.

##### E5. Replacement functionality does not guarantee equivalent operator access

A long-running Esri Community discussion documents missing Emergency Response Guide and Threat Analysis functionality during the move from Web AppBuilder to Experience Builder, followed by replacement-tool announcements. Users then discuss permission difficulties and access implications for former Viewer users. The old missing-widget complaint must be interpreted against subsequent releases. [E07]

The ERG web tool was announced June 4, 2025 for ArcGIS Online and Enterprise. Threat Analysis was announced June 5, 2026, initially for ArcGIS Online, with Enterprise support described as forthcoming in that announcement. Therefore, neither should be described simply as an absent current capability. [E08] [E09]

Current ArcGIS Online custom-web-tool documentation requires a qualifying user type, role, and Run web tools privilege; notebook-based tools consume credits. These are specific Online requirements, not universal claims about every Esri analysis workflow. [E10]

**Avoid:** claiming parity because the administrator can run a replacement tool.

**Prefer:** define parity for a named operational role. Can the intended responder reach the function, supply understandable inputs, obtain the result, and preserve or share it within their authorized role? Separate viewing results from running analyses and administering them.

Specialist hazard analysis is conditional scope for our product. It needs authoritative methods and qualified operational ownership; this research does not authorize recreating safety-critical calculations.

##### E6. Completed analysis and visible, durable results are different states

The current Threat Analysis setup guidance describes delayed appearance until a layer refresh, differences between temporary and appended outputs, and a known issue with limiting inputs to map selections. These are documented constraints of this particular tool, not general defects across Esri maps. [E11]

**Avoid:** a completed action with no obvious result, causing a user to run it again or assume the wrong features were processed.

**Prefer:** make inputs reviewable, show progress, identify exactly what was created, and distinguish temporary results from saved operational records. A result should explain where it can be found even if the map has not yet refreshed.

##### E7. What is worth matching

Esri's emergency-information tutorial demonstrates connecting an impact area to population and infrastructure information. Its value is the operational question answered, not merely displaying many layers. [E12]

**Keep the operational ideas:** geographic context, linked lifeline status, affected-facility inspection, field observations, meaningful layer legends, and map/list/dashboard coordination.

**Improve the experience:** show provenance, observation time, coverage limitations, and the next operational action. Unknown coverage must not look like zero impact. A selected facility should lead to its current status and responsible person without losing the geographic context.

#### 5. What feels unnerving, translated into design requirements

The following questions are our synthesis, not quotations or a psychological study of users.

| Operator's uncertainty | Harmful pattern to avoid | Desired behavior |
| --- | --- | --- |
| Did my work actually save? | A spinner or disappearing form is the only feedback | Distinguish draft, saved locally, received by server, and failed; preserve the record through interruptions |
| Did anyone receive my request? | Submission looks like acceptance | Separate receipt, routing, acknowledgment, and ownership |
| Where did it go? | Hidden filters, silent archiving, incident-context changes | Stable identifiers, visible filters, history, and explainable state changes |
| Is this information current? | Old data retains a healthy-looking color | Observation time, last received time, stale/unknown states, source attribution |
| Am I updating the right incident? | Context buried in navigation | Persistent incident, operational period, and role context |
| Will this partner see what I see? | Parent item shared, dependent items restricted | Recipient preview, explicit scope, access diagnostics |
| Can I safely answer this phone call? | Switching away risks losing a form | Recoverable drafts and resumable tasks |
| What changed while I was off shift? | A long activity stream substitutes for a briefing | Material changes, unresolved actions, current owners, links to detailed evidence |
| Am I allowed to use this function? | A feature appears but fails only after inputs are entered | Clear role availability and prerequisites before work begins |

Color, spacing, and attractive cards matter, but they cannot compensate for unclear state or missing operational accountability.

#### 6. Recommended capability priorities

These priorities are research recommendations for a future scope decision, not a new execution roster or a claim about gaps in our implementation.

| Priority | Capability worth matching | Interaction requirements to preserve |
| --- | --- | --- |
| Essential | Request and mission lifecycle | Durable receipt, stable ID, owner, priority, stage, reason for delay, history, clear handoff |
| Essential | Role-based work queue | My assignments, unowned work, overdue work, quick routine updates, useful team view |
| Essential | Current operational picture | Linked map/list/lifelines, freshness and coverage, clear incident context |
| Essential | Shift handoff | What changed, unresolved work, decisions needed, source-linked detail |
| Essential | Field reporting | Recoverable drafts, explicit connectivity and delivery state, usable attachments and location correction |
| Essential | Controlled partner participation | Individual accountability, scoped access, understandable invitations, recipient preview |
| Valuable | Repeatable activation and templates | Useful defaults, previews, versioned changes, preserve local configuration where supported |
| Valuable | Resource inventory and custody | Availability, assignment, checkout/return, location, condition, accountable updates |
| Valuable | Forms, situation reports, incident planning | Reuse existing facts, preserve structured data, review before publication, traceable exports |
| Valuable | Interagency exchange | Common status meanings, provenance, destination and delivery visibility, reconcile partner identifiers |
| Valuable | Configurable local fields and views | Extend the common model without fragmenting basic task semantics |
| Conditional | Advanced spatial/hazard analysis | Named users, authoritative methods, understandable prerequisites, reviewable and durable outputs |
| Conditional | Public information publishing | Separate audience and approval design; not authorized by this research |
| Conditional | AI summaries and assistance | Source-linked drafts and human review; do not make basic navigation depend on AI |

Daily preparedness, exercises, and routine resource work should use the same core interactions as activations where appropriate. That is a design recommendation to reduce relearning, not proof that every department needs every feature.

##### Patterns we should explicitly decline to imitate

- A large board or application catalog as the default homepage for every role.
- A separate navigation journey and vocabulary for each form, map, chat, and task.
- Extensive local customization as a prerequisite for a coherent basic workflow.
- Whole-record forms for simple acknowledgments and status updates.
- Successful submission that says nothing about delivery or responsibility.
- Empty maps or tables that conceal permission errors, stale feeds, or active filters.
- Chronological logs presented as sufficient shift handoff.
- Mobile experiences that require users to protect drafts by avoiding normal phone behavior.
- Feature migrations that quietly change which operational roles can use the function.
- Sharing interfaces that imply stronger withdrawal or confidentiality guarantees than delivery permits.

These are anti-patterns inferred from the evidence. This list does not assert that each product exhibits every pattern.

#### 7. Finite future acceptance scenarios

If these recommendations are approved for implementation, agree on the intended role and workflow first, then use the relevant scenario as a bounded acceptance gate. No scenarios were executed during this research. Once the agreed gate passes, do not add reassurance testing without a material change or observed problem.

1. **Occasional operator returns:** Given a provisioned role and an active incident, the operator finds their assigned work, recognizes the incident, and performs a routine update without an administrator explaining product-specific navigation.
2. **Request survives interruption:** A partially completed request survives an ordinary phone interruption or session expiry. On reconnection, the system distinguishes local draft from received request and exposes any unresolved conflict.
3. **Request crosses a handoff:** The originator can find the same request after routing or reassignment and identify who owns the next action. Receipt and acceptance remain distinguishable.
4. **Shift change:** An incoming operator can identify unresolved priorities and material changes, then open the underlying records. Historical detail remains available without being the only briefing.
5. **Partner follows a link:** A correctly invited guest reaches the intended authorized record after login. Missing access identifies a remediable cause without exposing restricted information.
6. **Map and records agree:** Selecting an authorized item connects its map, list, and detail views. Missing coverage, stale input, no matching records, and access failure have distinct explanations.
7. **Incident closes:** Closing an incident preserves retrievable records and leaves the next incident's context unambiguous. Reopening or correcting historical information follows the agreed rules.
8. **Configuration moves forward:** A supported update preserves the agreed local configuration and records, or provides an explicit migration with a recovery path. The required operational roles retain the intended capabilities.

Set any time, click-count, or completion-rate targets with representative users. The sources here do not establish universal numerical benchmarks.

#### 8. Corrections to carry into future parity decisions

The September 17 platform research remains a historical research artifact. This report does not silently rewrite it. The following claims should be qualified before being reused:

- **Esri upgrades:** parallel deployment and manual migration are documented. Automatic destruction or orphaning of every customization is not the correct general description. [E05]
- **Esri missing widgets:** ERG and Threat Analysis now have web-tool replacements. Assess their access and deployment requirements instead of repeating the original missing-feature claim. [E08] [E09] [E10]
- **WebEOC hosting:** current family documentation discusses both client-installed and Juvare-hosted instances. A blanket SaaS-only characterization is unsafe; verify the particular edition and contract. [W09]
- **Unverified performance ratios and framework dates:** this research did not substantiate the previous report's 25-50x comparison or its specific future framework-change assertions. Do not use them as established design evidence.
- **Standards absence:** absence from a documentation search cannot confirm that a product lacks CAP, EDXL, NIEM, or another integration. Mark support unverified unless a current authoritative capability statement or scoped evaluation establishes it.

Our canonical navy/teal, map-led visual references remain the design authority. Competitor friction informs behavior and priorities; it does not authorize a new visual direction. The approved Finish PSPR remains the execution authority.

#### 9. Evidence register

All links were consulted during this research on September 24, 2026 local time. Dates below describe the cited material when available, not search-engine crawl dates. Review samples are small and self-selected. Treat multiple comments within one page as one source collection, not independent surveys.

##### Veoci sources

- **[V01] [Capterra Veoci reviews](https://www.capterra.com/p/150183/Veoci/reviews/).** Named customer reviews, primarily 2019; ten-review snapshot. Both positive and negative experiences, with incentive disclosures. Historical qualitative evidence.
- **[V02] [Veoci US iOS reviews](https://apps.apple.com/us/app/veoci/id594925365?platform=ipad&see-all=reviews).** Mobile users; cited complaints span 2019-2025. Device, deployment, and app version not consistently identifiable. Rating is a retrieval snapshot, not a measure of enterprise-wide satisfaction.
- **[V03] [Veoci Google Play listing and reviews](https://play.google.com/store/apps/details?hl=en&id=com.greywallsoftware.veoci).** Android user accounts plus vendor listing/release metadata. Cited interruption account January 11, 2024; listed update September 2, 2026.
- **[V04] [Veoci rooms API documentation](https://veoci.com/api/docs/v1/rooms/index.html).** Official capability documentation for rooms, participants, saved views, and plan activation. No usability validation.
- **[V05] [Veoci resource and asset management](https://veoci.com/emergency-management/resource-asset-management).** Vendor capability description. Offline and custody claims require scenario-specific validation before procurement or implementation parity claims.

##### WebEOC sources

- **[W01] [Scholl and colleagues, Cascadia Rising research, ISCRAM Asia Pacific 2018](https://faculty.washington.edu/jscholl/cr16/Scholl_et_al_2018b.pdf).** Academic analysis of the 2016 exercise; WebEOC discussion around PDF page 10. Historical deployed-version evidence, not a Nexus test.
- **[W02] [Buncombe County, Tropical Storm Helene after-action report](https://www.buncombenc.gov/DocumentCenter/View/4231/After-Action-Report---Tropical-Storm-Helene-2024).** Official report concerning the 2024 disaster with 2025 debriefing input. Appendix C-3, printed pages 57-58 and 60. Participant perceptions explicitly distinguished from verified facts.
- **[W03] [G2 WebEOC reviews](https://www.g2.com/products/webeoc/reviews).** One accessible named review, April 11, 2019. Insufficient sample for representative product scoring.
- **[W04] [Emergency-management practitioner discussion of WebEOC](https://www.reddit.com/r/EmergencyManagement/comments/16uixa4/im_a_tech_guy_seeing_webeoc_for_the_first_time/).** September 2023 discussion. Anonymous experiences and vendor participation; deployment versions unknown.
- **[W05] [Bay Area UASI WebEOC standardization update](https://www.bauasi.org/sites/default/files/resources/110818%20Approval%20Authority%20November%20Agenda%20Item%2010%20WebEOC%20Standardization%20Project%20Update.pdf).** Official regional program memorandum, November 8, 2018. Evidence of coordination work, not a present-day product defect.
- **[W06] [Getting started with Juvare Exchange](https://docs.juvare.com/webeoc-onnexa/help/juvare-exchange/get-started-with-jx.htm).** Official setup and sharing constraints. Scope depends on supported version, hosting environment, and agreement.
- **[W07] [Juvare mobile troubleshooting](https://docs.juvare.com/webeoc-onnexu/troubleshoot.htm).** Official troubleshooting, updated February 27, 2026. Documents possible causes, not incidence rates.
- **[W08] [Juvare Login Services account activation and login](https://docs.juvare.com/webeoc-onnexa/common/juvare-login-services/account-activation-login.htm).** Official guidance, updated March 9, 2026. Deployment-specific identity behavior.
- **[W09] [WebEOC and Juvare SaaS communication overview](https://docs.juvare.com/webeoc-onnexa/help/server-configuration/webeoc-and-juvare-saas-communication-overview.htm).** Official instance/service dependencies. Useful for understanding degraded operation and avoiding blanket hosting assumptions.
- **[W10] [WebEOC Nexus](https://www.juvare.com/products/webeoc-nexus/).** Current vendor offering. Feature claims are not proof of operational ease or inclusion in a particular subscription.
- **[W11] [WebEOC board catalog](https://docs.juvare.com/webeoc-onnexu/board-list/board-list.htm).** Official categories for included, premium, additional, and industry boards. Check entitlement for any specific deployment.

##### Esri sources

- **[E01] [A reimagined Emergency Management Operations solution](https://www.esri.com/en-us/industries/blog/articles/new-emergency-management-operations-solution).** Vendor account of customer feedback and redesign, November 9, 2023.
- **[E02] [Introduction to Emergency Management Operations](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-management-operations.htm).** Official composition, requirements, and release notes. A latest-path URL is not itself proof of the newest available release.
- **[E03] [Reset Emergency Management Operations while retaining data](https://community.esri.com/en/discussion/1667724/best-practice-to-reset-emergency-management-operations-solution-but-retain-data).** User question and accepted staff answer. Posting date not reliably exposed in the retrieved migrated page.
- **[E04] [Notices and Evacuations map visibility](https://community.esri.com/en/discussion/1721035/why-cant-i-see-my-notices-and-evacuations-map-in-esri-site-information-for-emergency-management).** User question and self-reported resolution. Posting date not reliably exposed in the retrieved page.
- **[E05] [Upgrading an ArcGIS Solution](https://doc.arcgis.com/en/arcgis-solutions/latest/get-started/upgrading-an-arcgis-solution.htm).** Official lifecycle guidance. Supports maintenance-burden findings without implying automatic destruction.
- **[E06] [Emergency Management Operations 2026 infographic variables](https://community.esri.com/t5/arcgis-solutions-documents/emergency-management-operations-solutions-2026/ta-p/1712162).** Esri technical guidance for the June 2026 data-source change. One specific dependency.
- **[E07] [ERG and Threat Analysis migration discussion](https://community.esri.com/en/discussion/1342858/emergency-response-guide-and-threat-analysis-widget-for-experience-builder).** Multi-year user/staff thread with historical gaps and later replacement announcements. Read later replies before repeating early complaints.
- **[E08] [Introducing the Emergency Response Guide web tool](https://www.esri.com/arcgis-blog/products/arcgis-solutions/announcements/emergency-response-guide-web-tool-blog).** Official announcement, June 4, 2025.
- **[E09] [Add Threat Analysis to maps and apps](https://www.esri.com/arcgis-blog/products/arcgis-solutions/announcements/add-threat-analysis-to-your-maps-and-apps).** Official announcement, June 5, 2026. Initial Online scope; Enterprise work described as forthcoming at publication.
- **[E10] [Use custom web tools in ArcGIS Online](https://doc.arcgis.com/en/arcgis-online/analyze/custom-web-tools-mv.htm).** Current official user-type, role, privilege, credit, and result-persistence guidance. Do not generalize to every Enterprise workflow.
- **[E11] [Threat Analysis web tool configuration](https://community.esri.com/en/discussion/1706503/threat-analysis-web-tool).** Esri product-engineering guidance, including result-refresh and selection limitations. Current retrieved documentation, not observed failures in our application.
- **[E12] [Manage and communicate emergency information](https://learn.arcgis.com/en/projects/manage-and-communicate-emergency-information/).** Official guided workflow for spatial impact information. Demonstrates intended capability rather than independent usability.

#### 10. What remains unknown

Public sources do not establish present-day comparative performance, accessibility, training time, mobile reliability rates, or total administrative effort under equivalent conditions. They also cannot identify which complaints would disappear with better agency configuration. Those are bounded questions for a future authorized evaluation, not reasons to expand this research indefinitely.

The actionable conclusion is to prioritize coherent operational tasks, durable work, visible responsibility, and explainable information state. Preserve the competitors' coordination and spatial capabilities while making those tasks understandable to the people who must perform them.
