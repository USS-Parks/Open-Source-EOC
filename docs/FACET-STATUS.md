# VEOC Facet, Requirement, and Invariant Status Register

Reconciled 2026-09-25 through the Operator Trust PSPR's landing (`4ccad8e`,
"Operator Trust landing: the full gate") using the source-backed method from
VEOC-79E, against the receipts in the [V1 ledger](./process/V1-LEDGER.md),
cited by their heading, for the release decision in
[RELEASE-DECISION.md](../RELEASE-DECISION.md). This register and the
[parity capability matrix](./VEOC-PARITY-MATRIX.md) now use the same current
status. Historical receipts remain valid for the increment they proved, but an
older `verified` label does not erase a later documented depth, live-system,
scale, operator, or transfer boundary.

Statuses are `verified`, `partial`, `open`, `deferred`, or `risk-accepted`.
`Verified` means the prescribed technical gate passed at the assessed depth.
It does not mean commercial certification, pilot acceptance, or live external
integration. Every `partial` and `open` row names its remaining boundary and
its owner: Basho for an external input or a decision, or open engineering for
work no executed unit owns. The design side is reconciled separately in the
[design capability matrix](./process/design/D00-DESIGN-BASELINE-AND-OWNERSHIP.md#10-current-design-to-capability-reconciliation-2026-09-22).

Created by VEOC-00 at baseline `2743fe6f8ac29bedbc4d00175a47d8491777bce4`.

## Facets (research section 3)

| ID | Description | Current evidence | Status | Remaining boundary / owner |
|---|---|---|---|---|
| F1 | Board primitive: versioned schema, input + display views | VEOC-09/10; `b7cb680`; P-BOARDS-1 `32249fc`; P-BOARDS-2 `75464fc`; "V1 W4.1 part one: board engine depth"; "V1 W4.1 part two: board screen controls"; "V1 W4.2: views beyond the list"; "V1 W4.12: REST record writes through the sync log"; "V1 W4.4: WebEOC migration"; "V1 W4.13: gaps the WebEOC side-by-side run found"; "V1 W4 milestone gate"; the [WebEOC side-by-side run](./WEBEOC-SIDE-BY-SIDE.md); "Readiness RD8: the screens on the open engineering list" (choice labels in history, detail, kanban and calendar; creating from a published template as a jurisdiction administrator; conditions, sorts and groups saved into a template's views); "Operator trust TP4: durable work and explicit state"; "Operator trust TP5: information state you can read" | verified | - |
| F2 | Position login + immutable activity/position logs | VEOC-07/11; `ca0d130`; "V1 W3.1: audit chronology"; "V1 W3.0: administration"; "V1 W2.9: retention and export"; "V1 W2.10: MFA"; "V1 W4.1 part one: board engine depth"; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "V1 W2.12: network calls out of every write path" (rule creation audited); "Partner sharing PS2: incident positions and partner authors"; "Partner sharing PS4: incident-wide threads"; "Operator trust TP1: request lifecycle and findability" (who accepted, as which position); "Readiness RD9 part one: workflow, staffing and facilities" (names on workflow history) | verified | - |
| F3 | Store-and-forward federation, local replication | VEOC-30; "V1 W2.1: outbound delivery queue"; "V1 W3.6: federation and peers"; "V1 W3.11: engine gaps the screens exposed"; "V1 W4.12: REST record writes through the sync log"; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "Readiness RD10: federation of record deletes and earlier records" (deletes of records with no incident, and a board's jurisdiction-wide records sent when an agreement is made) | partial | Records of an incident, their edits and their deletes stay on their home instance and are not backfilled; the peer attributes a batch to the sending instance; a restricted board's live edits federate outside the record rule ("Readiness RD10: federation of record deletes and earlier records"). A v1 limit: Basho to accept it or choose the opt-in design that receipt describes (then open engineering) |
| F4 | Board-triggered notifications, webhooks, multi-channel | VEOC-14; governed workflow notifications `6c8dddc`; "V1 W2.1: outbound delivery queue"; "V1 W2.2: scheduler"; "V1 W2.7: threat-model controls"; "V1 W4.0 part one: email and SMS channels"; "V1 W3.12: screens for the remaining operator routes"; "V1 W4.0 part two: contacts and mass notification"; "V1 W4.13: gaps the WebEOC side-by-side run found"; "V1 W2.12: network calls out of every write path"; the side-by-side run; "Readiness RD3: the Windows network host" (the scheduler as a host service); "Readiness RD11: the remaining checks" (the scheduler elected with its six jobs in an installed profile) | verified | Not claimed: voice; Teams or Slack as a rule channel; a live relay or SMS provider (Finish PSPR section 7 item 6); inbound SMS acknowledgement; a re-check of the webhook allowlist when a rule is resumed; each scheduled job's run in an installed profile, which the profile's log does not record |
| F5 | ICS forms, IAP builder, 213RR lifecycle | VEOC-34/35; incident-context IAP `8c96103`; P-IAP `a5b96f9`; "V1 W3.8: JIC and resources completion"; "V1 W4.8: resources"; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "Partner sharing PS1: shared incident requests" (partner requests, owner assigns, under Basho's request ownership decision); "Operator trust TP1: request lifecycle and findability"; "Operator trust TP2: my work"; "Readiness RD9 part two: resources" (a cap per request, per-resource history, pool and local kind edits, a repeated escalation received once) | verified | Not claimed ("V1 W6.5: training kit"): objectives and ICS-208 fields; more than one current operational period; ICS-201, ICS-211 and ICS-215 from Resources or Staffing; an ICS-205 with content; guest read of resources |
| F6 | Any board as a live geospatial layer; field-to-COP loop | VEOC-79B/79C2; P-COP `e20e772`; D29 `d1c5d63`; "V1 W4.5: operational vector tiles"; "V1 W4.7: field depth"; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "V1 79D+D33 part two: the integrated visual and accessibility review"; "Operator trust TP9: from the map to the action" | verified | - |
| F7 | Offline XLSForm-compatible smart forms | VEOC-22; durable field reconciliation `d1c5d63`; "V1 W4.7: field depth"; "V1 W3.10: settings and field reports"; "V1 W4.10: progressive web app"; "Readiness RD2 part three: the first review" (field report triage); "Readiness RD5: the air gap" (the console opens offline after a restart) | verified | Not claimed: `range`, `or_other` and `repeat_count` (refused by row); live-video barcode scanning; in-page audio recording; a continuous GPS trace; repeats as child records; offline queueing for boards with record rules; queued files past 10 MB each or 50 MB per person per incident; installing on a phone |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | VEOC-20/23; D13; P-LIFE-1 through P-LIFE-4; "V1 W3.2: damage assessment"; "V1 W4.11: Public Assistance and shelter census"; "Operator trust TP5: information state you can read" (observed apart from received) | verified | Not claimed: the census with the facilities integration off; the PA guide edition, left for Basho to confirm; deleting PA items; stale marking in the census; an incident picker on the screen; insurance amounts |
| F9 | Pre-disaster baseline data for damage assessment | VEOC-23; 79G impact analysis; "V1 W3.2: damage assessment"; "V1 W3.12: screens for the remaining operator routes" | partial | Live parcel rolls and replacement-cost coverage need data acquisition, and baselines do not feed the declaration summary: Basho, pilot data (external) |
| F10 | Always-on facility status networks + status queries | VEOC-28; "V1 W3.4: facilities and shelters"; "V1 W3.13: screens for the optional integrations"; "V1 W4.11: Public Assistance and shelter census"; "Readiness RD9 part one: workflow, staffing and facilities" (registry edit and removal; the status request list) | verified | Optional integration ("V1 W6.6: gated-module disposition"). Not claimed: a patient-level data review |
| F11 | Scan-first tracking objects + reunification | VEOC-25; "V1 W3.13: screens for the optional integrations" | verified | Optional integration ("V1 W6.6: gated-module disposition"). Not claimed: restricted details for cleared roles; a patient-level data review |
| F12 | Incident templates instantiating ICS org + checklists | VEOC-12; `ca0d130`; "V1 W4.9: incident lifecycle"; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "V1 79D+D33 part two: the integrated visual and accessibility review"; "V1 W5.3: remaining interface findings"; "Readiness RD8: the screens on the open engineering list" (boards activated before the title change retitled); "Operator trust TP7: incident close and reopen" | verified | Not claimed: EOC Director and Situation Unit Leader in the standard position set |
| F13 | Scenario libraries, reference libraries, checklists | VEOC-12; task rules/receipts `ecd5249`; P-TASKS `d867488`; "V1 W3.12: screens for the remaining operator routes" | verified | Not claimed: CBRNE or HAZMAT reference content, which does not ship; libraries are attach-and-read; checklist completion shows only on the signed-in position's items |
| F14 | Calm-screen map-first SPA discipline | VEOC-05/17; P-SHELL `ef13b0c`, `64e3cf5`; P-COP `e20e772`; "V1 79D+D33 part two: the integrated visual and accessibility review"; "V1 A11Y-T1: reduced motion, higher contrast and the screen-reader script"; "V1 W5.0: code splitting"; "V1 W5.1: style consolidation"; "V1 W5.3: remaining interface findings"; both CI stability receipts; "Readiness RD2 part three: the first review" | verified | Representative-operator acceptance, absent per "V1 D34: operator workflow comparison (absence recorded)"; the NVDA and VoiceOver pass; D33 findings 15, 18, 21, 24 and 25: Basho |
| F15 | Per-incident auto-provisioned collaboration space | VEOC-32/33; `8c96103`; "V1 W3.13: screens for the optional integrations"; "V1 W2.12: network calls out of every write path" | verified | Optional integration ("V1 W6.6: gated-module disposition"). Not claimed: the channel state on screen; a browser walk against Matrix |
| F16 | One-click role-based provisioning; ten-minute viewer path | VEOC-08/41; "V1 W3.0: administration"; "V1 W2.6: secure by default"; "V1 W6.0: one-command server install" | verified | Not claimed: a timed ten-minute viewer path, since only a dry run is recorded |
| F17 | Daily-ops usability against skill decay | Responsive persistent workspaces; "V1 W3 route coverage: every operator route owes a screen"; "V1 W3 milestone gate"; "V1 W4.1 part two: board screen controls"; "V1 W6.5: training kit"; "V1 D34: operator workflow comparison (absence recorded)"; the occasional-operator, request, shift change and interruption scenarios of "Operator trust TP1: request lifecycle and findability", "Operator trust TP2: my work", "Operator trust TP3: shift handoff" and "Operator trust TP4: durable work and explicit state"; inject cards in "Readiness RD11: the remaining checks" | partial | Representative operator comparison: Basho (external) |
| F18 | Sensor and drone live feeds into the COP | VEOC-79C1/C2; P-COP `e20e772`; "V1 W2.2: scheduler"; "V1 W2.12: network calls out of every write path" | partial | Live source evidence: Basho, a live source (external data) |
| F19 | NAPSG/DHS incident symbology shipped | Agreed nine-type licensed subset `389afe1`; P-COP composition; "V1 W4.5: operational vector tiles" | verified | Broader catalog remains intentionally unmapped, not claimed |
| F20 | Native standards interchange | VEOC-26 through VEOC-29 and VEOC-31; "V1 W3 route coverage: every operator route owes a screen"; "V1 W3.4: facilities and shelters"; "V1 W3.9: export and import"; "V1 W4.4: WebEOC migration" | verified | - |

## Requirements (Basho, 2026-09-17)

| ID | Requirement | Current evidence | Status | Remaining boundary / owner |
|---|---|---|---|---|
| R1 | At least 150 concurrent users per instance | VEOC-38 in-process benchmark; "V1 W2.4: WebSocket discipline"; "V1 W2 milestone gate" two-hour synthetic activation on this workstation; `load.test.ts` in "V1 W4 milestone gate" and "V1 M5 milestone gate"; "V1 R1-REAL: the real-hardware 150-user run (boundary recorded)"; "Readiness RD4: 150 people at once" (150 people for two hours through HTTPS on the network host profile, every threshold met) | partial | The run used this machine's host profile, not an installed host, with the load generator on the same machine; the 95th-percentile read time rose through the run and the growing reads were not isolated ("Readiness RD4: 150 people at once"). Basho: a run against the installed host (external); open engineering: the rising read time |
| R2 | IPAWS integration enable-at-will | VEOC-31 model and endpoint; "V1 W2.7: threat-model controls"; "V1 W3.5: IPAWS enablement and send"; "V1 W2.10: MFA"; "V1 W2.12: network calls out of every write path" | partial | No live send until IPAWS-OPEN test credentials and the MOA: Basho (external) |
| R3 | Agency, organization, and volunteer conglomerate COP access | VEOC-79B database/DOM isolation; P-SHELL incident URLs `64e3cf5`; "V1 79D+D33 part one: the integrated cross-boundary exercise"; "V1 79D+D33 part two: the integrated visual and accessibility review"; "V1 M5 milestone gate"; the partner sharing receipts PS1 to PS5 (shared requests, positions, linked actions and incident-wide threads); "Operator trust TP6: partner invitations and recipient preview" | partial | The peer attributes a federated batch to the sending instance, a bound "Readiness RD10: federation of record deletes and earlier records" leaves in place: Basho, with F3, to accept as a v1 limit or schedule (open engineering) |
| R4 | Fluid Command and General Staff work; JIC component | VEOC-12/33A/34; D26 `79019cc`; "V1 W3.8: JIC and resources completion"; "V1 W3.11: engine gaps the screens exposed"; "V1 W3.3: staffing"; "Readiness RD9 part one: workflow, staffing and facilities" (badge revocation; an ICS-211 of every check-in with check-outs); "Operator trust TP3: shift handoff" | verified | Not claimed: inquiry close; publishing a release to CAP; a list of unsubmitted JIC drafts; another session's decision in the drafter's panel |
| R5 | File sharing | VEOC-15; tenant-safe download `451ed16`; "V1 W2.6: secure by default"; "V1 W4.1 part one: board engine depth"; "V1 W4.7: field depth" | verified | - |
| R6 | Private and group messaging | VEOC-15A/32; source-context workspace `b253180`; "V1 W3.12: screens for the remaining operator routes" | verified | Not claimed: reading message settings back; thread list pages past the first ("V1 W2.11: remaining list pagination") |

## Anti-requirements (research section 4)

| ID | Anti-requirement | Guarded by | Status | Remaining boundary / owner |
|---|---|---|---|---|
| AR1 | No per-seat surge pricing structure | INV-1 | verified | - |
| AR2 | No unconstrained board divergence | INV-5; "V1 W4 milestone gate" | verified | - |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6; `b7cb680`, `32249fc`, `75464fc`; "V1 W4.1 part two: board screen controls" | verified | - |
| AR4 | No in-place-upgrade dead ends | INV-5; "V1 W6.1: versioning and upgrade"; "Operator trust TP8: upgrades keep configuration" (configuration and role capabilities kept across real migrations; an upgrade report); "Readiness RD11: the remaining checks" (the setup stops running profiles first) | verified | A database built before the 2026-09-22 migration baseline is refused and no tool moves its data; records move with the board import ([upgrade guide](./guides/UPGRADE.md)). Not claimed: a real upgrade of an installed copy |
| AR5 | No proprietary-only interchange, substrate lock-in, or unbundling | INV-4, INV-9; "V1 W3.9: export and import"; "V1 W4.4: WebEOC migration" | verified | - |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8; "V1 W4.10: progressive web app"; "Operator trust TP4: durable work and explicit state" (an ended session returns to sign-in with the reason and drafts restore) | verified | - |
| AR7 | Full function disconnected, including provisioning | INV-3; `3741100`, `7a52438`; "V1 W6.4: installer rebuild" (setup `0.9.0`, SHA-256 `dafddeb50fcdfdf9a85519d24a88e21ae1c87420357ad22d86927802b112a153`, with the map archives and gazetteer); "Readiness RD5: the air gap" (a recorded run with no connection outside this computer and its local network) | partial | Basho's unplugged run with a second device (`Test-OpenEOCAirGap.ps1`, "Readiness RD5: the air gap"), and the install from media on a disconnected second computer, by the installer README's second-machine transfer check: Basho |

## Invariants (PSPR section 3)

| ID | Invariant | Status | Evidence boundary / owner |
|---|---|---|---|
| INV-1 | Viewers are structurally free | verified | Structural model; no seat metering |
| INV-2 | Attribution is total | verified | Append-only audit and incident/position attribution; notification rule creation, the one administrative write found unaudited, is audited since "V1 W2.12: network calls out of every write path"; a partner's attribution survives revocation ("V1 79D+D33 part one: the integrated cross-boundary exercise") |
| INV-3 | Disconnection is the normal case | partial | Prepared-host workflow proven; "V1 W6.4: installer rebuild" builds the offline setup with the map archives; "V1 W4.10: progressive web app" keeps the shell offline; "Readiness RD5: the air gap" opens the console offline after a restart and records a run with no connection outside this computer and its local network; Basho's unplugged run and the disconnected second-machine install remain: Basho (external) |
| INV-4 | Standards are native | verified | CAP, EDXL, CoT, HAVE and GeoJSON contracts |
| INV-5 | Boards are versioned schemas | verified | Immutable versions and safe upgrade preflight/application; the designer shows the applied version after publish and apply ("V1 W4 milestone gate") |
| INV-6 | No-code is real | verified | Structured designer and runtime presentation `75464fc`; "V1 W4.1 part two: board screen controls" adds record access and local fields; "Readiness RD8: the screens on the open engineering list" saves conditions, sorts and groups into a template's own views |
| INV-7 | Fail closed | verified | "V1 W0.0: audit cleanup publication and M4" closed the remaining approval, dataset and sync fail-open paths; "V1 W2.6: secure by default" refuses to serve without the runtime role; "V1 W4.9: incident lifecycle" locks guests out at the row-level security wall; "V1 W4.13: gaps the WebEOC side-by-side run found" closes live guest sockets after a lock or revocation. Residual risks stated in their receipts: a DNS rebinding window for a suffix-admitted webhook host ("V1 W2.7: threat-model controls"); a guest socket joining between a commit and the re-check |
| INV-8 | Calm under stress | partial | Technical responsive gates passed; "V1 79D+D33 part two: the integrated visual and accessibility review", "V1 A11Y-T1: reduced motion, higher contrast and the screen-reader script" and "V1 W5.1: style consolidation" add review, motion and contrast evidence. "Readiness RD4: 150 people at once" meets every threshold for two hours on this machine's host profile. The operator comparison (absent, "V1 D34: operator workflow comparison (absence recorded)") and the load run against an installed host (R1) remain: Basho (external) |
| INV-9 | Core is never unbundled | verified | Apache-2.0 core and native interchange |
| INV-10 | The codebase outlives any one maintainer | open | A second maintainer or Basho's written release waiver in the ledger, as [GOVERNANCE.md](../GOVERNANCE.md#second-maintainer) and "V1 W6.3: project hygiene for adoption" state: Basho (external) |

## Reconciliation boundary

- The register describes the current tree, not the status at VEOC-43.
- `partial` retains the proven increment while naming the unproven remainder.
- On 2026-09-23, F4, F7 and F8 moved to `verified` on their receipts and F3
  moved to `partial` on the federation bound its receipts state.
- On 2026-09-24 every row was checked against the receipts through `ec11af5`.
  No status changed; evidence, not-claimed items and owners were brought up to
  date, and the P-BOARDS-1 citation now names its commit, `32249fc`, instead of
  the baseline it started from. The assessed gaps, including the rows added
  for the WebEOC importer, address search, incident lifecycle, the installable
  app, reports, disaster recovery, accessibility and observability, are
  tracked in the parity matrix only.
- On 2026-09-25 every row was checked against the receipts through the
  Operator Trust PSPR's landing ("Operator Trust landing: the full gate",
  `4ccad8e`). No status changed. The Readiness and Operator Trust receipts
  close not-claimed items in F1, F4, F7, F10, F12, R4 and INV-6, narrow the
  remaining boundary of F3, R1, R3, AR7, INV-3 and INV-8, and add evidence to
  F2, F5, F6, F8, F14, F17, AR4 and AR6. Their tests ran as one full
  `test:ci` with the failed files run again after their fixes; the phase
  gates (`pnpm check:gate`) and a second full run were not run, as that
  receipt states. Hosted CI now runs on Windows ("Readiness RD12 part one: CI
  on Windows"); no receipt records its first run's result.
- The release is Windows only: macOS is not started ("Readiness RD6: macOS,
  not started"). The Windows network host and connecting to it, and macOS,
  are tracked in the parity matrix as G-HOST and G-MACOS.
- Live readiness, operator acceptance and release disposition are Basho's
  external inputs and decisions, listed in
  [RELEASE-DECISION.md](../RELEASE-DECISION.md). This register does not
  synthesize those results.
