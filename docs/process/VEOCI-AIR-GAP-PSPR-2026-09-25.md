# Veoci Integration and Air Gap PSPR

Plan date: September 25, 2026
Approval state: **APPROVED 2026-09-25, with amendments (section 1a).** Basho: "execute this new PSPR in its entirety now, with my express authorization and full permissions granted with this statement. Run it all." This plan is the live roster for the approving session, with full STS, commit, landing and push authority for every unit that passes its gate ("V1 grant: Veoci integration and air gap" in `docs/process/V1-LEDGER.md`). The [Operator Trust PSPR](./OPERATOR-TRUST-PSPR-2026-09-24.md) keeps its one open unit, RD6.
Author of record: Basho Parks (drafted by a Claude Code session at Basho's instruction to integrate the Veoci research into roster work).

## 1. Purpose

Turn two research products into units, after subtracting what the Operator
Trust landing of 2026-09-25 already delivered:

- [VEOCI-PLATFORM-RESEARCH-2026-09-24.md](./VEOCI-PLATFORM-RESEARCH-2026-09-24.md),
  the Veoci platform research, whose candidates are VC-01 to VC-39;
- [AIR-GAP-READINESS-AUDIT-2026-09-25.md](./AIR-GAP-READINESS-AUDIT-2026-09-25.md),
  the air-gap audit against Basho's four scenarios, whose candidates are
  AG-01 to AG-13.

Basho's direction for both: weight the work toward a small tribal or rural EOC
(a Yurok-sized jurisdiction: thin staff, degraded communications, grant
funding, mutual aid with counties and the state), and make the platform work
through an air gap in all four scenarios: internet cut with the LAN up, a
permanent isolated enclave, a device with no network, and data carried across
the gap on media.

The plan's thesis, from the Veoci research: Veoci's advantage is labor and
packaging, not its engine. The gains left are continuity through an outage,
ready-made content with one-action activation, exchange across the gap, and
cost-recovery capture.

## 1a. Approval and Basho's amendments, 2026-09-25

Basho approved the plan with these changes, each carried into the sections
below:

1. **Job aids.** Position job aids open inside the console for the acting
   position, work offline, and cover the features this plan adds. New unit
   VA39.
2. **ICS forms as separate components of the IAP.** ICS 201, 202, 203, 204,
   205, 205A, 206, 207, 208, 209, 211, 213, 214, 215 and 215A are each
   created, edited, attributed and versioned as a form of their own for an
   incident's operational period, and the IAP is assembled from the
   components the planning section chooses. New unit VA37, in two parts.
3. **Resource request forms.** The ICS 213RR is a form component of its own,
   rendered from a resource request through its lifecycle, printable and
   exportable, and attachable to the period's plan. New unit VA38.
4. **Placeholders, not gates.** Basho's unplugged run and the 72-hour
   disconnected drill are written as procedures with result templates
   (VA24), and the phone walk as a procedure (VA23); none of them gates the
   next unit.
5. **Three more exercise scenarios** are coming from a sibling session. This
   plan does not edit the scenario seeds or exercise documents that session
   owns (section 5), keeps its tests on the North Coast Storm scenario, and
   writes new content (the starter pack, job aids, plans) so that it works
   with any scenario rather than naming one.
6. **Public-facing work is tabled** until a future date Basho sets: public
   forms, public dashboards, resident opt-in alerting, published snapshots
   and any link meant for someone without an account (decision 4).

## 2. Relationship to the other plans

- **Operator Trust PSPR (live).** Landed on 2026-09-25: RD4, RD5, TP0 to TP9,
  RD7, RD8, RD9 parts one to three, RD10, RD11 and RD12 part one, with
  "Operator Trust landing: the full gate". Open: RD6 (macOS, waiting for a Mac
  or a macOS runner), RD12 part two (the reconciliation and the phase gates)
  and Basho's external runs (the host check, the unplugged check). Basho's
  approval starts this plan now. RD12 part two's reconciliation folds into
  VA36, which reconciles the parity matrix, facet register, README and
  release decision to both plans' receipts; RD6 stays open under the
  Operator Trust PSPR, and this plan's units own no file RD6 would.
- **The exercise scenario session.** A sibling session is adding three
  exercise scenarios. Its files (the demo seeds under `server/src/demo/`, the
  exercise documents under `docs/guides/training/EXERCISE-*`, and the
  scenario browser tests it adds) are outside every "Owns" cell here.
- **Finish PSPR.** Remains the execution contract (commit, ledger and landing
  discipline) where this plan does not supersede it.
- **EOC user-experience research** (`EOC-USER-EXPERIENCE-RESEARCH-2026-09-24.md`,
  Appendix A of the Operator Trust PSPR). Its Essential rows landed as TP1 to
  TP9. Its Valuable rows (templates, resource custody, forms and plans,
  interagency exchange, local fields) were left to "a later plan's scope".
  This plan is that later plan where the Veoci research recommends the same
  work. The two research documents overlap and do not conflict; units here
  cite both where both apply.
- **Research basis.** `VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` is
  unchanged. The Veoci research and the air-gap audit are research: they
  authorize nothing, and this plan's approval would.

## 3. What the Operator Trust landing already covered

Each row is a Veoci research recommendation or weakness and the receipt that
answered it. Nothing here is repeated as a unit.

| Veoci research item | Landed by (receipt heading) | What remains, and where |
|---|---|---|
| 213RR lifecycle with routed approvals, owner and next action; find a request | "Operator trust TP1: request lifecycle and findability" | FEMA-format exports: VA14 |
| "Blank slate" and navigation complaints, occasional operator | "Operator trust TP2: my work" | Ready-made content: VA11, VA12 |
| Drafts lost on interruption (Veoci mobile crash reviews) | "Operator trust TP4: durable work and explicit state" | Sending while offline: VA22 |
| Stale or empty shown as healthy | "Operator trust TP5: information state you can read" | None |
| Evacuation link that ends at a login page; external participants | "Operator trust TP6: partner invitations and recipient preview" | Public links stay out (decision 4) |
| Rooms archived at close | "Operator trust TP7: incident close and reopen" | The room bundle at activation: VA16 |
| Solution updates that keep customer changes | "Operator trust TP8: upgrades keep configuration" | Signed package v2: VA11 |
| Map to record | "Operator trust TP9: from the map to the action" | Create-record tiles: VA31 |
| Workflow reject and cancel, names on history (part of VC-11) | "Readiness RD9 part one: workflow, staffing and facilities" | Guard conditions and per-state field permissions: VA15 |
| Views with conditions, sorts and groups saved into templates (part of VC-18) | "Readiness RD8: the screens on the open engineering list" | All-or-any conditions and functions: VA26 |
| `.xlsx` on the WebEOC screen (part of VC-13) | same | Validation report, people import: VA17 |
| Badge revocation, ICS-211 history | "Readiness RD9 part one: workflow, staffing and facilities" | QR image generation: VA9 |
| Resource cap, per-resource history, pool edits (AIM Gov pattern) | "Readiness RD9 part two: resources" | QR labels and usage hours: VA9, VA14 |
| Reverse lookup ("What is here?") | "Readiness RD9 part three: address search and parcel tiles" | None |
| Federation of deletes and records made before an agreement | "Readiness RD10: federation of record deletes and earlier records" | Batch sizing, signatures, file exchange: VA2, VA19, VA20; incident records: decision 3 |
| Isolation proof; console opens offline after a restart | "Readiness RD5: the air gap" | Outage behavior and the other scenarios: phases VA-A and VA-C |
| Inject cards for the exercise kit (part of VC-14) | "Readiness RD11: the remaining checks" | Playbook and timed onboarding: VA18 |
| Incident-wide requests, positions and threads for every organization | Partner Sharing PS1 to PS4 receipts | Per-record threads stay deferred (section 8) |

Decisions the Operator Trust PSPR already took and this plan keeps: public
publishing out of scope (its decision 8), AI out of scope (decision 9), no
native phone apps (its section 8).

## 4. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | Order of work | Continuity through the gap first (VA-A), then ready-made content, one-action activation and the ICS form components (VA-B), then exchange across the gap, field breadth and job aids (VA-C), then county-weighted work (VA-D). Basho approved the whole plan, VA-D included. |
| 2 | How long an outbound message waits for a route | 72 hours per channel, which a jurisdiction administrator can change; after it the delivery reads "Expired, not sent" and can be resent. Nothing is discarded on an attempt count. |
| 3 | Incident records across instances | Not built. RD10 recorded the safe design (an opt-in on the agreement and the partner's copy under its own incident) as Basho's decision; AG-13 waits on it. |
| 4 | Public forms, public dashboards, resident opt-in alerts, published map snapshots, links for people without an account | **Tabled by Basho until a future date Basho sets** (amendment 6). Nothing in this plan builds a public surface. |
| 5 | Scripting in automations | Rejected (ADR-0004). The action catalog (VA25) is declarative. |
| 6 | Local carriers | SMS through hardware on site (an Android phone's SIM through SMS Gateway for Android, Apache-2.0, or a GSM modem) behind the existing HTTP SMS channel. A SIP trunk or SMS provider account is an external action for Basho; fixtures cover development. |
| 7 | Voice call-down and phone dial-in | Not in this plan. A process-boundary service (jambonz, MIT; jigasi, Apache-2.0) when Basho names a carrier. |
| 8 | SAML and SCIM | Not built until an identity provider needs them (Finish PSPR section 7 item 3 stands). |
| 9 | The air-gap clause (audit section 10) | Adopted as this plan's gate rule for every unit that adds or changes a network path. |
| 10 | Public Assistance guide edition | The edition in force at plan date, named in VA14's receipt for Basho to confirm (the F8 row already leaves it open). |
| 11 | FEMA equipment rate data | An outside download, so an external action for Basho. VA14 ships the rate table empty with an import path. |
| 12 | Where installs and system settings are proven | As Operator Trust decision 12: Basho runs setups, trust changes and unplugged checks; a session does not. |
| 13 | Test viewports | As Operator Trust decision 2: 1586 by 992 and 1534 by 790. |
| 14 | External proofs | Placeholders, not gates (amendment 4): the unplugged run, the 72-hour drill and the phone walk are written as procedures with result templates; each receipt says the run is Basho's and has not happened. |
| 15 | ICS form set and editions | The fifteen forms of amendment 2 plus the 213RR, laid out after the FEMA NIMS ICS Forms Booklet's field numbering; each form records the edition it follows. Forms are built in the product, not copied from FEMA's fillable PDFs. |
| 16 | Which components make an IAP | The planning section chooses per period; the default set is 202, 203, 204 (one per assignment), 205, 205A, 206, 207 and 208, with 215 and 215A as planning worksheets kept out of the printed plan unless chosen. An IAP is approved as a whole; a component changed after approval makes a new IAP revision. |
| 17 | Where this session lands work | This session is the integrating session for this plan. Each unit is committed on `claude/veoci-research-integration-n1kd0p`, rebased on current `main`, and `main` is fast-forwarded to it once the unit's gate is green; a rejected fast-forward means rebase and gate again, never a merge or a force. |
| 18 | The Windows setup at phase ends | This session runs in a Linux container and cannot build the Windows setup. Each phase receipt says so; the setup is rebuilt on a Windows machine. |
| 19 | The Linux test bed | PostgreSQL 16 with PostGIS 3.4 from Ubuntu packages on 127.0.0.1:55439 (the Windows runtime uses PostgreSQL 16.15 and PostGIS 3.6.2) and Playwright's Chromium, with durability settings off for speed. Receipts name it; CI on Windows remains the platform check. |

## 5. Execution model

As the Operator Trust PSPR section 5: one unit at a time on current `main`;
fan-out lanes under the standing grant only for units whose "Owns" cells are
disjoint; a receipt per unit in `docs/process/V1-LEDGER.md`; one focused
commit per unit and a push. A unit that adds a route adds it to the contract
in the same commit. Landing follows decision 17: the unit's commit is rebased
on current `main` and `main` fast-forwards to it. The Windows setup is
rebuilt on a Windows machine at phase ends (decision 18). No unit edits the
exercise scenario session's files (section 2); a unit that finds it must
names the file in its receipt and waits for that session's work to land.

## 6. Units, in order

Sizes as the Finish PSPR: S under a day of agent work, M about a day, L two to
three, XL more and therefore split.

### Phase VA-A: continuity through the gap

| Unit | Work | Owns | Size | Proof |
|---|---|---|---|---|
| VA1 | **Hold, do not drop** (AG-01). The delivery queue holds a message for its channel's window (decision 2) with a "waiting for a route" state instead of dead-lettering at attempt 8; a failed or expired delivery can be resent; scheduled report email goes through the queue with retry. | `server/src/notify/**`, `server/src/reports/job.ts`, `web/src/notifications/**`, one migration | M | Real-database test: a target unreachable for two simulated hours receives the message on return; an expired one is resent; a report email retried; browser test of the resend at both viewports. |
| VA2 | **Federation batch sizing** (AG-02). Batches claimed by size so each POST stays under the receive limit; an explicit body limit on the receive route. | `server/src/federation/**`, the federation claim in one migration | S | Two instances on real PostgreSQL: a backfill over 3 MiB arrives in parts; a backlog after a simulated 24-hour partition drains. |
| VA3 | **Private authorities and time** (AG-06). The server trusts the Windows store or a configured authority file for outbound TLS; a clock-offset check in `Test-OpenEOCHost.ps1` and `Test-OpenEOCAirGap.ps1`; a console notice when a device's clock and the server's differ by more than 30 seconds; enclave time guidance. | `deploy/windows/lib/host.mjs`, the two check scripts, `web/src/app/layout/**` notice, `docs/guides/NETWORK-HOST.md` | S | Host proof with an SMTP stand-in on a second private authority; the check scripts' output; browser test of the notice. |
| VA4 | **Collaboration and feeds in an outage** (AG-08). In-app fallback when a configured backend is unreachable; one open alarm per failing feed; retention keeps a failing feed's last-good items. | `server/src/collab/**`, `server/src/feeds/**`, `server/src/retention/**` | S | Real-database tests for each. |
| VA5 | **Corrections** (AG-11). The audit's section 9 items: the field guide's offline restart, the continuity claim, ADR-0006 and ADR-0003 status notes, the `field-node/` lines in `CLAUDE.md`, and the pre-commit hook tracked as executable. | the named documents, `.githooks/pre-commit` mode | S | Link check; a Linux or macOS clone runs the hook. |

### Phase VA-B: ready-made content and one-action activation

| Unit | Work | Owns | Size | Proof |
|---|---|---|---|---|
| VA6 | **Incident templates as data** (VC-01). Templates authored and versioned on screen like board templates; ad hoc tasks on the Tasks screen. | `server/src/incidents/**`, `shared/src/incidents/**`, `web/src/app/surfaces/IncidentsSurface.tsx`, the Tasks screen, one migration | M | Real-database and browser tests: an administrator authors a template, activates from it, and adds a task on the Tasks screen. |
| VA37 | **ICS forms as components of the IAP** (amendment 2), in two parts. Part one, the forms: ICS 201, 202, 203, 204, 205, 205A, 206, 207, 208, 209, 211, 213, 214, 215 and 215A each stored as a component of an incident's operational period, created from a prefilled draft, edited field by field after the Forms Booklet layout (decision 15), attributed, versioned and marked draft or ready; ICS 213 messages and 214 logs may have many per period. Part two, the plan: the IAP is assembled from the components the planning section chooses (decision 16), with a cover, the operational period and the approval of the whole; a component changed after approval makes a new revision; each form and the whole plan print to PDF. | `shared/src/ics/**`, `shared/src/iap/**`, `server/src/iap/**`, `web/src/iap/**`, `web/src/app/surfaces/IapSurface.tsx`, one migration per part | L + L | Real-database tests for each form's store, versions and prefill; browser tests at both viewports: a planning chief writes the 202 objectives, the 205 channels and the 208 safety message as components, assembles and approves the period's IAP, changes the 205 and sees a new revision; each form prints. |
| VA38 | **The ICS 213RR as a form component** (amendment 3): rendered from a resource request through its lifecycle (requestor, order, logistics, finance and approval blocks), printable and exportable, listed with the period's forms and attachable to its IAP. | `shared/src/ics/**` 213RR builder, `server/src/resource/**` read route, `web/src/resources/**` print action | M | A request taken through acceptance, sourcing and approval prints its 213RR with each block filled; the period's form list shows it. After VA37 part one. |
| VA7 | **Activation notifies; people addressed by group, position and shift** (VC-02, VC-15). Activation sends to chosen contact groups and positions; rules address groups and positions, not only literal addresses; each contact's devices in order with fallback to the next channel; "whoever is on call" resolved from shifts. | `server/src/notify/engine.ts`, `server/src/contacts/**`, the rule screen | M | Activation sends to the chosen group; a rule addressed to a position reaches its current holder; an unanswered SMS falls back to the contact's email; an on-call page reaches the person on shift. |
| VA8 | **Response options on mass sends** (VC-03), answered on the existing acknowledgement page, with counts per option. | `server/src/notify/mass.ts`, the acknowledgement page | S | A poll with three options returns per-option receipts. |
| VA9 | **Signature field and QR generation** (VC-04, VC-05): `signature_pad` (MIT) as a board field and form question; QR images for badges and pool resources (`qrcode`, MIT). | `shared/src/boards/fields.ts`, `shared/src/forms/**`, `web/src/boards/**`, `web/src/staffing/**`, `web/src/resources/**` | S | Browser tests: a signed 213RR approval; a printed badge scanned back. |
| VA10 | **License gate** (VC-06): deny the Functional Source, Fair Use, Camunda, Carbone community and Open WebUI licenses; flag GPL, LGPL and MPL for review. | `scripts/license-scan.mjs` | S | The scan refuses a fixture with each name. |
| VA11 | **Signed package v2** (VC-07): one signed package carries incident templates, forms, dashboards, report definitions and rule templates, with a command to sign it. | `server/src/data-packs/**`, `server/src/main.ts` command, the designer import | M | Import of a signed package on a fresh profile creates each part; a tampered package is refused. |
| VA12 | **Starter pack for a small tribal or rural EOC** (VC-08): positions, boards, checklists, contact groups, call-down, reports and a tabletop, delivered as a VA11 package, written to work with any exercise scenario (amendment 5). | a new `deploy/packs/` content path | M | Imported on a fresh profile, the pack activates an incident with its positions, boards, checklists, contact groups and reports, with no configuration. |
| VA13 | **Executable plans** (VC-09): a plan object with versioned sections linked to checklists, boards, contact groups and notifications; activation into an incident; delayed task release; recurring-event plans; review reminders through the scheduler. | new `server/src/plans/**`, `shared/src/plans/**`, `web/src/plans/**`, one migration | L | Real-database and browser tests: a plan activates an incident with its tasks released on schedule and its notifications sent. |
| VA14 | **FEMA Public Assistance force account** (VC-10): labor hours from check-ins and shifts, equipment hours from the pool, a rate table with an import path (decision 11), roll-up to PA items, FEMA-format summaries. | `server/src/damage/**`, `server/src/staffing/**` reads, `web/src/damage/**`, `shared/src/dictionary/pda.ts`, one migration | L | A shift's hours and a pool truck's hours roll into a force account summary that reconciles with the rows. |
| VA15 | **Workflow guards and per-state field permissions** (VC-11 remainder). | `shared/src/boards/workflow.ts`, `server/src/boards/**`, `web/src/boards/**` | M | A transition refused by its guard; a field read-only in one state. |
| VA16 | **Incident room bundle** (VC-12): activation creates the incident's dashboards, threads, contact groups and file folder from the template. | `server/src/incidents/service.ts` activation, `server/src/files/**` | M | Activation shows each part in its screen. Depends on VA6. |
| VA17 | **Validated migration** (VC-13 remainder): a validation report for every import (counts, rejects, mappings) signed off on screen; a fixed-taxonomy import template; a people import. | `server/src/data-packs/**` import paths, `web/src/admin/**` | M | Each import writes its report; a people CSV creates accounts and positions. Sequenced after VA11. |
| VA18 | **Rollout playbook and timed onboarding** (VC-14): the six-step playbook from the Veoci research, self-paced modules, and a timed install and first activation by a person new to the product. | `docs/guides/**` | M | The playbook; the timing needs a new person (Basho). |

### Phase VA-C: exchange across the gap, field breadth and job aids

| Unit | Work | Owns | Size | Proof |
|---|---|---|---|---|
| VA19 | **Signed peer identity** (AG-03): an Ed25519 key per instance, signed batches verified before ingestion, and a revoke route, as ADR-0006 states. | `server/src/federation/**`, `server/src/secrets/**`, one migration | M | Two instances: a forged batch refused; a revoked agreement stops flow both ways. After VA2. |
| VA20 | **Exchange by file** (AG-04): a peer's waiting batch exported as a signed file, imported through the receive lane, marked delivered by a receipt file. | `server/src/federation/**`, `web/src/federation/**` | L | Two instances with no network path between them exchange a board's edits and deletes by file, in both directions, with a repeated import changing nothing. After VA19. |
| VA21 | **Local carriers** (AG-05): SMS through a phone's SIM or a GSM modem; printable call-down sheets with acknowledgements entered afterward; a radio and runner log template. | `server/src/notify/channels.ts`, `server/src/contacts/**`, a board template | M | A fixture gateway on the LAN delivers and reads replies; a printed sheet's acknowledgements entered back. After VA1 and VA8. |
| VA22 | **Field breadth** (AG-07): map captures, messages and task creation queue offline; boards with record rules sync per record; work queued against a closed incident goes to its owner as a late submission. | `web/src/offline/**`, `web/src/field/**`, `server/src/sync/**` | L | Browser tests offline and back for each path. |
| VA39 | **Job aids in the console** (amendment 1): the acting position's job aid opens from the console's help, bundled so it works offline; every position's aid is listed; the aids gain the features this plan adds (ICS form components, the 213RR, plans, the delivery hold, exchange by file, local carriers, the starter pack). | `docs/guides/training/JOB-AID-*.md`, a new `web/src/help/**`, the build step that bundles the aids | M | Browser test at both viewports: acting as Planning Section Chief opens that aid, offline as well; the aid's steps match the screens. |
| VA23 | **Phones on a host's authority** (AG-09), a placeholder (amendment 4): the procedure for installing the root and the app on iOS and Android, with a result template. | `docs/guides/NETWORK-HOST.md`, `docs/guides/FIELD-USER.md` | S | The procedure; the walk is Basho's and gates nothing. |
| VA24 | **The disconnected drill** (AG-10), a placeholder (amendment 4): the unplugged-run steps and a 72-hour disconnected tabletop with integrations configured against local stand-ins, each with a result template. | the drill procedure and report template | S | The procedure and templates; the runs are Basho's and gate nothing. AR7 and INV-3 close on their record when run. |

### Phase VA-D: county-weighted and deeper configuration (approved with the plan)

| Unit | Work | Size |
|---|---|---|
| VA25 | Declarative action catalog (VC-17): set a field, create a linked record with mapping, start a transition, notify; loop protection; audited writes. | L |
| VA26 | All-or-any conditions, date and text functions, every view option in the designer (VC-18 remainder). | M |
| VA27 | Continuity of government templates and plan (VC-19), on VA13. | M |
| VA28 | Volunteer and CERT roster entered by staff or partner organizations, with credentials, expiry, deployments and hours (VC-20). | M |
| VA29 | Hotline log and shelter registration templates (VC-21), as VA11 packages. | S |
| VA30 | After-action corrective actions linked to plans, with reminders (VC-22), on VA13. | S |
| VA31 | Charts in reports and create-record dashboard tiles (VC-24). | M |
| VA32 | OpenAPI document and scoped service identities (VC-25). | M |
| VA33 | Esri interchange (VC-26): a FeatureServer view over the existing items route and Esri JSON import. | M |
| VA34 | Offline device PIN for shared devices (VC-27). | M |
| VA35 | Region map pack procedure (AG-12). | S |
| VA36 | Reconcile the parity matrix, facet register, README and release decision to this plan's receipts and the Operator Trust PSPR's (its RD12 part two, including the acceptance scenarios table); the phase gate. | S |

### Traceability

Every candidate in the two research documents lands in exactly one place.

| Candidates | Where |
|---|---|
| VC-01 to VC-14 | VA6 to VA18 in order (VC-04 and VC-05 together in VA9; VC-02 with VC-15 in VA7) |
| VC-15 | VA7 |
| VC-16 | SMS replies in VA21; voice under decision 7 |
| VC-17 to VC-22 | VA25 to VA30 |
| VC-23 | Decision 7 |
| VC-24 to VC-27 | VA31 to VA34 |
| VC-28, VC-29 | Decision 8 |
| VC-30 to VC-33, VC-37 to VC-39 | Section 8 |
| VC-34, VC-35 | Decision 4 |
| VC-36 | Operator Trust decision 9 |
| AG-01 to AG-11 | VA1 (AG-01), VA2 (AG-02), VA19 (AG-03), VA20 (AG-04), VA21 (AG-05), VA3 (AG-06), VA22 (AG-07), VA4 (AG-08), VA23 (AG-09), VA24 (AG-10), VA5 (AG-11) |
| AG-12 | VA35 |
| AG-13 | Decision 3 |
| Basho's amendments 1 to 3 | VA39 (job aids), VA37 (ICS form components), VA38 (213RR) |
| Basho's amendments 4 to 6 | VA23 and VA24 as placeholders; section 2 and decision 17 (scenario session); decision 4 (public work tabled) |

## 7. Verification gates

As the Operator Trust PSPR section 7, with the air-gap clause (decision 9)
added: every unit that adds or changes a network path records its behavior in
the four scenarios in its receipt, and each phase end reruns RD5's proof with
every optional integration configured against local stand-ins, recording what
queued, what expired and what reconciled.

## 8. Not in this plan

- Public forms, public dashboards, resident opt-in alerting, published
  snapshots and every other public-facing action, tabled by Basho until a
  future date (decision 4).
- Scripting (decision 5), AI (Operator Trust decision 9), native phone apps.
- Voice call-down and phone dial-in (decision 7), SAML and SCIM (decision 8).
- Business impact analysis and risk scoring (VC-30), per-record threads
  (VC-31), a visual form builder (VC-32), an authority-to-operate control
  mapping (VC-33), alerting-vendor connectors (VC-38) and multi-node hosting
  (VC-39): a later plan's scope, or Basho's decision.
- Incident records across instances (decision 3).
- Tagging and publishing a release, which stay Basho's act.

## 9. What only Basho can supply

- The decisions in section 4 where the default does not suit.
- The unplugged run and the 72-hour drill (VA24), and phones for VA23, when
  Basho chooses; they gate nothing.
- The Windows setup rebuilt on a Windows machine at phase ends.
- A person new to the product for VA18's timed onboarding.
- Any SIP trunk, SMS provider or FEMA rate data (external actions).

## 10. Completion

Done when: no outbound message is discarded during an outage shorter than its
window; two instances exchange a board's edits and deletes by signed file
with no network path; each ICS form of amendment 2 and the 213RR is a
component of its own and an IAP is assembled and approved from them; a
signed starter pack activates a small EOC on a fresh profile with no
configuration; a plan activates an incident with its tasks and notifications;
force account hours roll into Public Assistance summaries; the field paths in
VA22 work offline; the acting position's job aid opens in the console; the
drill and phone procedures exist for Basho to run; the parity matrix and
facet register agree with the receipts; and the full gate is green, with the
setup rebuilt on a Windows machine.
