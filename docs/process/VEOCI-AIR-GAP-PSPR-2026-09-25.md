# Veoci Integration and Air Gap PSPR

Plan date: September 25, 2026
Approval state: **PROPOSED, NOT APPROVED.** Nothing in this plan is executable until Basho approves it in a session. On approval, the authority section of `CLAUDE.md` names it as the live roster; until then the [Operator Trust PSPR](./OPERATOR-TRUST-PSPR-2026-09-24.md) stays the only live roster.
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

## 2. Relationship to the other plans

- **Operator Trust PSPR (live).** Landed on 2026-09-25: RD4, RD5, TP0 to TP9,
  RD7, RD8, RD9 parts one to three, RD10, RD11 and RD12 part one, with
  "Operator Trust landing: the full gate". Open: RD6 (macOS, waiting for a Mac
  or a macOS runner), RD12 part two (the reconciliation and the phase gates)
  and Basho's external runs (the host check, the unplugged check). This plan
  starts after RD12 part two unless Basho reorders; its units own files
  disjoint from RD6 and RD12 part two, and its own last unit reconciles the
  parity matrix and facet register again.
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
| 1 | Order of work | Continuity through the gap first (VA-A), then ready-made content and one-action activation (VA-B), then exchange across the gap and field breadth (VA-C), then county-weighted work (VA-D). Basho may reorder or cut VA-D. |
| 2 | How long an outbound message waits for a route | 72 hours per channel, which a jurisdiction administrator can change; after it the delivery reads "Expired, not sent" and can be resent. Nothing is discarded on an attempt count. |
| 3 | Incident records across instances | Not built. RD10 recorded the safe design (an opt-in on the agreement and the partner's copy under its own incident) as Basho's decision; AG-13 waits on it. |
| 4 | Public forms, public dashboards, resident opt-in alerts, published map snapshots | Out of scope, as Operator Trust decision 8. The snapshot export (VC-35) is the least exposed option if Basho wants one. |
| 5 | Scripting in automations | Rejected (ADR-0004). The action catalog (VA25) is declarative. |
| 6 | Local carriers | SMS through hardware on site (an Android phone's SIM through SMS Gateway for Android, Apache-2.0, or a GSM modem) behind the existing HTTP SMS channel. A SIP trunk or SMS provider account is an external action for Basho; fixtures cover development. |
| 7 | Voice call-down and phone dial-in | Not in this plan. A process-boundary service (jambonz, MIT; jigasi, Apache-2.0) when Basho names a carrier. |
| 8 | SAML and SCIM | Not built until an identity provider needs them (Finish PSPR section 7 item 3 stands). |
| 9 | The air-gap clause (audit section 10) | Adopted as this plan's gate rule for every unit that adds or changes a network path. |
| 10 | Public Assistance guide edition | The edition in force at plan date, named in VA14's receipt for Basho to confirm (the F8 row already leaves it open). |
| 11 | FEMA equipment rate data | An outside download, so an external action for Basho. VA14 ships the rate table empty with an import path. |
| 12 | Where installs and system settings are proven | As Operator Trust decision 12: Basho runs setups, trust changes and unplugged checks; a session does not. |
| 13 | Test viewports | As Operator Trust decision 2: 1586 by 992 and 1534 by 790. |

## 5. Execution model

As the Operator Trust PSPR section 5: one unit at a time on current `main`;
fan-out lanes under the standing grant only for units whose "Owns" cells are
disjoint; a receipt per unit in `docs/process/V1-LEDGER.md`; one focused
commit per unit and a push; a rebuilt Windows setup in `deploy/` at each phase
end. A unit that adds a route adds it to the contract in the same commit.

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
| VA7 | **Activation notifies; people addressed by group, position and shift** (VC-02, VC-15). Activation sends to chosen contact groups and positions; rules address groups and positions, not only literal addresses; each contact's devices in order with fallback to the next channel; "whoever is on call" resolved from shifts. | `server/src/notify/engine.ts`, `server/src/contacts/**`, the rule screen | M | Activation sends to the chosen group; a rule addressed to a position reaches its current holder; an unanswered SMS falls back to the contact's email; an on-call page reaches the person on shift. |
| VA8 | **Response options on mass sends** (VC-03), answered on the existing acknowledgement page, with counts per option. | `server/src/notify/mass.ts`, the acknowledgement page | S | A poll with three options returns per-option receipts. |
| VA9 | **Signature field and QR generation** (VC-04, VC-05): `signature_pad` (MIT) as a board field and form question; QR images for badges and pool resources (`qrcode`, MIT). | `shared/src/boards/fields.ts`, `shared/src/forms/**`, `web/src/boards/**`, `web/src/staffing/**`, `web/src/resources/**` | S | Browser tests: a signed 213RR approval; a printed badge scanned back. |
| VA10 | **License gate** (VC-06): deny the Functional Source, Fair Use, Camunda, Carbone community and Open WebUI licenses; flag GPL, LGPL and MPL for review. | `scripts/license-scan.mjs` | S | The scan refuses a fixture with each name. |
| VA11 | **Signed package v2** (VC-07): one signed package carries incident templates, forms, dashboards, report definitions and rule templates, with a command to sign it. | `server/src/data-packs/**`, `server/src/main.ts` command, the designer import | M | Import of a signed package on a fresh profile creates each part; a tampered package is refused. |
| VA12 | **Starter pack for a small tribal or rural EOC** (VC-08): positions, boards, checklists, contact groups, call-down, reports and a tabletop, delivered as a VA11 package. | a new `deploy/packs/` content path | M | The pack activates the North Coast Storm walk on a fresh profile with no configuration. |
| VA13 | **Executable plans** (VC-09): a plan object with versioned sections linked to checklists, boards, contact groups and notifications; activation into an incident; delayed task release; recurring-event plans; review reminders through the scheduler. | new `server/src/plans/**`, `shared/src/plans/**`, `web/src/plans/**`, one migration | L | Real-database and browser tests: a plan activates an incident with its tasks released on schedule and its notifications sent. |
| VA14 | **FEMA Public Assistance force account** (VC-10): labor hours from check-ins and shifts, equipment hours from the pool, a rate table with an import path (decision 11), roll-up to PA items, FEMA-format summaries. | `server/src/damage/**`, `server/src/staffing/**` reads, `web/src/damage/**`, `shared/src/dictionary/pda.ts`, one migration | L | A shift's hours and a pool truck's hours roll into a force account summary that reconciles with the rows. |
| VA15 | **Workflow guards and per-state field permissions** (VC-11 remainder). | `shared/src/boards/workflow.ts`, `server/src/boards/**`, `web/src/boards/**` | M | A transition refused by its guard; a field read-only in one state. |
| VA16 | **Incident room bundle** (VC-12): activation creates the incident's dashboards, threads, contact groups and file folder from the template. | `server/src/incidents/service.ts` activation, `server/src/files/**` | M | Activation shows each part in its screen. Depends on VA6. |
| VA17 | **Validated migration** (VC-13 remainder): a validation report for every import (counts, rejects, mappings) signed off on screen; a fixed-taxonomy import template; a people import. | `server/src/data-packs/**` import paths, `web/src/admin/**` | M | Each import writes its report; a people CSV creates accounts and positions. Sequenced after VA11. |
| VA18 | **Rollout playbook and timed onboarding** (VC-14): the six-step playbook from the Veoci research, self-paced modules, and a timed install and first activation by a person new to the product. | `docs/guides/**` | M | The playbook; the timing needs a new person (Basho). |

### Phase VA-C: exchange across the gap and field breadth

| Unit | Work | Owns | Size | Proof |
|---|---|---|---|---|
| VA19 | **Signed peer identity** (AG-03): an Ed25519 key per instance, signed batches verified before ingestion, and a revoke route, as ADR-0006 states. | `server/src/federation/**`, `server/src/secrets/**`, one migration | M | Two instances: a forged batch refused; a revoked agreement stops flow both ways. After VA2. |
| VA20 | **Exchange by file** (AG-04): a peer's waiting batch exported as a signed file, imported through the receive lane, marked delivered by a receipt file. | `server/src/federation/**`, `web/src/federation/**` | L | Two instances with no network path between them exchange a board's edits and deletes by file, in both directions, with a repeated import changing nothing. After VA19. |
| VA21 | **Local carriers** (AG-05): SMS through a phone's SIM or a GSM modem; printable call-down sheets with acknowledgements entered afterward; a radio and runner log template. | `server/src/notify/channels.ts`, `server/src/contacts/**`, a board template | M | A fixture gateway on the LAN delivers and reads replies; a printed sheet's acknowledgements entered back. After VA1 and VA8. |
| VA22 | **Field breadth** (AG-07): map captures, messages and task creation queue offline; boards with record rules sync per record; work queued against a closed incident goes to its owner as a late submission. | `web/src/offline/**`, `web/src/field/**`, `server/src/sync/**` | L | Browser tests offline and back for each path. |
| VA23 | **Phones on a host's authority** (AG-09): root and app installed on iOS and Android, walked and documented. | `docs/guides/NETWORK-HOST.md`, `docs/guides/FIELD-USER.md` | S | Basho's phones. |
| VA24 | **The disconnected drill** (AG-10): Basho's unplugged run, then a 72-hour disconnected tabletop with integrations configured against local stand-ins. | the drill script and report | S | The drill report; closes AR7 and INV-3 on its record if it passes. |

### Phase VA-D: county-weighted and deeper configuration (Basho may cut)

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
| VA36 | Reconcile the parity matrix, facet register, README and release decision to this plan's receipts; the phase gate. | S |

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

## 7. Verification gates

As the Operator Trust PSPR section 7, with the air-gap clause (decision 9)
added: every unit that adds or changes a network path records its behavior in
the four scenarios in its receipt, and each phase end reruns RD5's proof with
every optional integration configured against local stand-ins, recording what
queued, what expired and what reconciled.

## 8. Not in this plan

- Public forms, public dashboards, resident opt-in alerting and public
  publishing (decision 4).
- Scripting (decision 5), AI (Operator Trust decision 9), native phone apps.
- Voice call-down and phone dial-in (decision 7), SAML and SCIM (decision 8).
- Business impact analysis and risk scoring (VC-30), per-record threads
  (VC-31), a visual form builder (VC-32), an authority-to-operate control
  mapping (VC-33), alerting-vendor connectors (VC-38) and multi-node hosting
  (VC-39): a later plan's scope, or Basho's decision.
- Incident records across instances (decision 3).
- Tagging and publishing a release, which stay Basho's act.

## 9. What only Basho can supply

- Approval of this plan, its order and its cut line.
- The decisions in section 4 where the default does not suit.
- The unplugged run and the 72-hour drill (VA24), and phones for VA23.
- A person new to the product for VA18's timed onboarding.
- Any SIP trunk, SMS provider or FEMA rate data (external actions).

## 10. Completion

Done when: no outbound message is discarded during an outage shorter than its
window, and the drill report shows what queued and reconciled; two instances
exchange a board's edits and deletes by signed file with no network path; a
signed starter pack activates a small EOC on a fresh profile with no
configuration; a plan activates an incident with its tasks and notifications;
force account hours roll into Public Assistance summaries; the field paths in
VA22 work offline; the parity matrix and facet register agree with the
receipts; and the full gate is green with a rebuilt setup in `deploy/`.
