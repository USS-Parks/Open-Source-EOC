# Release decision

For Basho. Prepared on 2026-09-24 from `main` at `ec11af5`, the point at which
every engineering unit of the Finish PSPR had landed; brought up to date on
2026-09-25 for version `0.9.2`, after the Operator Trust PSPR landed
("Operator Trust landing: the full gate"); and reconciled again on 2026-09-25
for the next release, planned as `v0.9.9` ("Veoci and air gap VA36: the
documents reconciled"), through `98f050a` ("Veoci and air gap follow-up:
Vitest collected a node test file"), the commit after every unit of the Veoci
roster had landed ("Veoci and air gap VA36 completion: VA33, VA34 and the
follow-ups"). Evidence is cited by receipt heading
in the [V1 ledger](docs/process/V1-LEDGER.md). Capability status is in the
[parity matrix](docs/VEOC-PARITY-MATRIX.md) and the
[facet register](docs/FACET-STATUS.md), both reconciled to the receipts for
this document.

Every unit of the Veoci Integration and Air Gap PSPR has landed. The
plan-end gate and the `v0.9.9` builds run on the release commit, and their
results go in section 6.

## 1. What was executed

- The [Finish PSPR](docs/process/FINISH-PSPR-2026-09-22.md), approved on
  2026-09-23 ("Grant: full STS for the Finish PSPR").
- Waves W1 to W6, every unit receipted, with "V1 W1 milestone gate",
  "V1 W2 milestone gate", "V1 W3 milestone gate" and "V1 W4 milestone gate".
- Wave W7: "V1 79D+D33 part one: the integrated cross-boundary exercise";
  "V1 79D+D33 part two: the integrated visual and accessibility review";
  "V1 A11Y-T1: reduced motion, higher contrast and the screen-reader script",
  whose manual pass is scripted, not run; "V1 M5 milestone gate", green after
  a walk fix; "V1 D34: operator workflow comparison (absence recorded)";
  "V1 R1-REAL: the real-hardware 150-user run (boundary recorded)"; and this
  reconciliation. The gate on the finished tree is "V1 final milestone gate":
  273 of 273 test files and 1,553 of 1,553 tests in one serial run.
- Units added during execution, each receipted: W2.11 remaining list
  pagination; W2.12 network calls out of every write path; W3.11 engine gaps;
  W3 route coverage; W3.12 and W3.13 screens for the remaining and optional
  routes; W4.11 Public Assistance and shelter census; W4.12 REST record writes
  through the sync log; W4.13 the side-by-side gaps; W5.3 remaining interface
  findings; the W4 gate's WebEOC side-by-side run; two CI stability units.
- The [Readiness PSPR](docs/process/READINESS-PSPR-2026-09-24.md) and the
  [Operator Trust PSPR](docs/process/OPERATOR-TRUST-PSPR-2026-09-24.md),
  approved 2026-09-24: the Linux path removed (RD1), the frames' look and the
  Windows demo (RD2), the Windows network host (RD3), 150 people for two
  hours (RD4), the air gap (RD5), operator trust TP0 to TP9 with acceptance
  scenarios 1 to 8, connecting to a host (RD7), the open engineering list
  (RD8 to RD11), CI on Windows and macOS (RD12), and the reads that slowed
  under load ("Readiness RD4 follow-up: reads that slowed as the incident
  filled"). RD6, macOS, is not started ("Readiness RD6: macOS, not
  started"). RD12 part two's reconciliation folds into the Veoci roster's
  VA36, this document's latest reconciliation.
- The `0.9.2` builds: the Windows setup and a ZIP of its staged folder
  ("Version 0.9.2: the Windows setup"), the map data packet ("Version 0.9.2:
  the macOS build and its map data packet") and the macOS disk image built
  on Windows ("Version 0.9.2: the macOS disk image, built on Windows").
- The [Veoci Integration and Air Gap PSPR](docs/process/VEOCI-AIR-GAP-PSPR-2026-09-25.md),
  approved 2026-09-25 ("V1 grant: Veoci integration and air gap"; "V1 grant:
  the rest of the Veoci and air gap plan, local"): every unit, VA1 to VA39
  (VA37 in two parts), has landed, each with its receipt, with "Veoci and
  air gap VA11 follow-up: the imported packages on screen", "Veoci and air
  gap VA13 and VA14 corrections: review findings", "Veoci and air gap VA17
  completion: board record import reports", "Veoci and air gap follow-up:
  trusted package keys on a Windows install", "Veoci and air gap follow-up:
  the record pane keeps its tab through a save", "Veoci and air gap
  follow-up: sync edits set board actions off", "Veoci and air gap
  follow-up: a workflow transition's lock order" and "Veoci and air gap
  follow-up: Vitest collected a node test file", and two gate receipts:
  "Veoci and air gap phase VA-A gate" and "Veoci and air gap plan gate: the
  air-gap proof with integrations on local stand-ins", which adds a
  stand-ins mode to RD5's proof and records its run.
- The [IPAWS Connector PSPR](docs/process/IPAWS-CONNECTOR-PSPR-2026-09-25.md),
  IC1 to IC3, with "IPAWS connector IC1 correction: the postCAP secret
  assertion".
- The [Exercise Scenarios PSPR](docs/process/EXERCISE-SCENARIOS-PSPR-2026-09-25.md)
  through "Exercise scenarios XS4 to XS7: the three exercises in the demo",
  which are in the `0.9.2` builds; XS8, the review package, is not done.
- The CI repairs recorded after the Actions runs resumed, from "CI repairs
  after the Actions runs resumed" to "CI correction: a time zone named by its
  alias, and a partner's message check".
- The reconciliations: every matrix and register row checked against the
  receipts; on 2026-09-24 eight rows added, with README, ROADMAP, the
  design-to-capability matrix, the
  [asset and license inventory](docs/ASSET-LICENSES.md), the guides, the
  changelog and eleven
  [final reference captures](docs/design/final-captures/README.md); on
  2026-09-25 for `v0.9.9`, four rows added (G-PLANS, G-PACKAGES,
  G-VOLUNTEERS, G-SERVICE), G-MACOS moved to `partial`, and README, ROADMAP,
  the evaluator's page, the deployment README, the threat model's B3 row,
  ADR-0010's status, the rollout playbook and the training kit's limits
  corrected where a receipt had made them untrue; then, once VA33 and VA34
  had landed, the rows they and the follow-ups change, with no status
  changed.

## 2. The gate list

Section 6 of the Finish PSPR. Green: met on the cited receipt. Open: work the
project can still do. External: needs an input or act only Basho can supply.
No line carries a written waiver.

| # | Gate | State | Receipt, or what is missing |
|---|---|---|---|
| 1 | `pnpm check` green, serial, gate tag, with route-table, secret and advisory scans | Green on `5079670` for `v0.9.9` (section 6) | Green on `ec11af5` in "V1 final milestone gate": every static gate, 273 of 273 files and 1,553 of 1,553 tests in one run, the load benchmark 4 of 4. `pnpm check` runs no secret scan itself: gitleaks runs in the pre-commit hook, which passed on every commit, and in hosted CI. For `0.9.2`: the Operator Trust units ran one full `test:ci` with its failures fixed ("Operator Trust landing: the full gate"); the serial `pnpm check:gate` was not run on the `0.9.2` commit. Since then: "Veoci and air gap phase VA-A gate" ran `pnpm check:gate` for VA1 to VA5 on the Linux bed, 1,686 of 1,691 tests with five browser tests that fail on that bed and the load test unexplained there; "IPAWS connector IC3: documents" ran it on Windows, exit 1 for a `node:test` file Vitest collected (since excluded) and two worker crashes whose files passed alone, then `pnpm check` on the rebased tree, 1,808 of 1,809 with the one red passing alone. Every later unit ran its own and neighbouring suites only. A trial `pnpm check:gate` on `f94d6ee`, before VA33 and VA34 landed, failed 2 of 380 files: the conditions browser test's time zone alias and a `node:test` file Vitest collected, both since fixed; its other results were `check:static` exit 0, `audit:advisories` 0 high or critical, `test:desktop` 44 of 44, and the serial Vitest run 2,025 passed and 2 failed of 2,030 tests in 47 minutes ("Veoci and air gap follow-up: Vitest collected a node test file"). Hosted CI runs `pnpm check` on Windows on each push to `main`; the last recorded result is run 36216221581 on `055792e`, 3 of 2,030 tests failed, the two time zone cases fixed and the partner sharing check made to name its cause ("CI correction: a time zone named by its alias, and a partner's message check"), and no receipt records a green run. For `v0.9.9`: the plan-end gate, section 6 |
| 2 | Single-node declaration | Green | "V1 W2.5: rate limiting and identity caching" |
| 3 | Heap flat over two hours with 150 sockets; real-hardware run recorded | Green | "Readiness RD4: 150 people at once": 150 people with 300 sockets for two hours on Basho's Windows machine against the network host profile, 0 errors, reads 245 ms and writes 33 ms at the 95th percentile, heap growth 8.4%. The three reads that grew during that run are fixed and measured by probe at the run's full volume ("Readiness RD4 follow-up: reads that slowed as the incident filled"); the two-hour rerun with the fix was skipped at Basho's instruction ("Version 0.9.2: the Windows setup"). Not run: that rerun, and the same against the installed host services |
| 4 | No network call inside a write path; outbox worker and scheduler in both deploy paths | Green | "V1 W2.12: network calls out of every write path"; "V1 W2.1: outbound delivery queue"; "V1 W2.2: scheduler", whose desktop path was checked by loading the module, not by running a profile |
| 5 | Every list paginated; push replaces the notifications poll | Green | "V1 W2.3: pagination and push-down"; "V1 W2.11: remaining list pagination"; "V1 W2.4: WebSocket discipline". The templates catalogue stays unpaged, with the reason in the W2.12 receipt |
| 6 | Logs, metrics and rotation in both paths; retention enforced | Green | "V1 W2.8: observability"; "V1 W2.9: retention and export" |
| 7 | MFA for administrators; two-person IPAWS send; webhook allowlists | Green | "V1 W2.10: MFA"; "V1 W2.7: threat-model controls"; "V1 W3.5: IPAWS enablement and send" |
| 8 | Refuse to serve with row-level security off | Green | "V1 W2.6: secure by default" |
| 9 | Windows and macOS setups, each with a workstation and a network host with HTTPS; installer rebuilt with archives; backup scheduled; restore drill (restated by ADR-0010: the platforms are Windows and macOS, and the Docker install is removed) | Open | Windows: workstation, demo and network host in `Open-Source-EOC-Setup-0.9.2.exe` ("Readiness RD3: the Windows network host"; "Version 0.9.2: the Windows setup"), connecting to a host ("Readiness RD7: connecting to a host, on Windows"), the host's trust of agency authorities and its clock checks ("Veoci and air gap VA3: private authorities and time"); drill recorded ("V1 W6.1: versioning and upgrade"). macOS: the workstation and demo as an app, built on a Mac runner with its own PostgreSQL, whose smoke test started it ("CI repairs after the Actions runs resumed"), and as a disk image built on Windows that uses Postgres.app ("Version 0.9.2: the macOS disk image, built on Windows"). Missing: a Mac network host and RD6; any run by a person on a Mac; Basho's first real run of the Windows host install, its scripted check and its backup schedule. The `v0.9.9` builds go in section 6 |
| 10 | Every operator route on a screen; no dead ends; administration without curl | Green | "V1 W3 milestone gate"; "V1 W3 route coverage: every operator route owes a screen"; "V1 W3.0: administration" |
| 11 | Email and SMS with a contacts directory | Green | "V1 W4.0 part one: email and SMS channels"; "V1 W4.0 part two: contacts and mass notification", against a local relay and a fixture SMS provider. Since then: the delivery hold ("Veoci and air gap VA1: hold, do not drop"), groups, positions and shifts ("Veoci and air gap VA7: activation notifies; people reached by group, position and shift"), response options ("Veoci and air gap VA8: response options on mass sends") and SMS through a phone on the site network with replies read back ("Veoci and air gap VA21: local carriers"), against a fixture phone |
| 12 | Board CSV and Excel import and export; WebEOC importer with a guide | Green | "V1 W4.1 part one: board engine depth"; "V1 W4.1 part two: board screen controls"; "V1 W4.4: WebEOC migration" |
| 13 | Layers render past the feature cap | Green | "V1 W4.5: operational vector tiles" |
| 14 | First-load JavaScript under 300 KB gzipped | Green | 159.8 kB in "V1 W5.0: code splitting", 161.0 kB in "V1 W5.3: remaining interface findings", 184.6 kB in "Veoci and air gap VA9 part two: QR codes on badges and pool resources", 189.7 kB in "Veoci and air gap VA31: charts in reports and create-record tiles", 202.3 kB in "Veoci and air gap VA39: job aids in the console", whose aids are about 10.5 kB of it. The budget script is not part of `pnpm check` |
| 15 | README, ROADMAP, register, matrix and API document agree | Green on this reconciliation, through `98f050a` | `docs/API.md` and, since "Veoci and air gap VA32: OpenAPI document and scoped service identities", `docs/openapi.json` match the contract route for route (the api-docs test, which each unit that added a route ran with the documents regenerated, VA33's five FeatureServer routes the last), and the generated header says the OIDC sign-in routes register only when `OPENEOC_OIDC_ISSUER` is set. README, ROADMAP, the register and the matrix agree with the receipts through `98f050a` ("Veoci and air gap VA36: the documents reconciled"; "Veoci and air gap VA36 completion: VA33, VA34 and the follow-ups") |
| 16 | 79D+D33 and M5 green; A11Y-T1 done; D34 done or absence recorded; 86+D35 presented | External | The exercise, review, M5 and the D34 absence are receipted, and this document presents 86+D35. Missing: the NVDA and VoiceOver pass |
| 17 | SECURITY.md, CHANGELOG.md, versioned packages; second maintainer or waiver | External | "V1 W6.3: project hygiene for adoption"; "V1 W6.1: versioning and upgrade". Missing: a second maintainer or Basho's written INV-10 waiver |
| 18 | Basho's aesthetic and functional acceptance of the release candidate | External | Not recorded |
| 19 | One roster; link checker green after the archive move | Green | "V1 W1.12: retire the roster stack"; link checker at 94 files in "V1 M5 milestone gate", and at 127 files on this reconciliation. The Veoci roster and the exercise scenarios roster run side by side, each owning its own files, as `CLAUDE.md` records |
| 20 | Test lines and assertions recorded before and after W1.14; coverage not lower than the W1.11 baseline | Open | Counts in "V1 W1.14: consolidate the server test suite". The measurement exists since `0.9.2` (`pnpm test:coverage`, the v8 provider over `server/src`) but has not been run to a result at `00deba5` and the release commit. Close by running it at both, or by Basho accepting the assertion counts in its place |
| 21 | Each optional integration registers by default or is named in README with its variable | Green | "V1 W6.6: gated-module disposition"; README now names OIDC sign-in and its variables |

## 3. Acceptance scenarios 1 to 8

The Operator Trust PSPR's scenarios (its Appendix A, section 7), which its
RD12 reconciles "now including scenarios 1 to 8" and places nowhere else, so
the table stays here. Scenarios 1 to 7 are browser tests on the North Coast
Storm demonstration at 1586 by 992 and 1534 by 790, with no page errors and
no request outside the machine; scenario 8 is a real-database test of an
upgrade across real migrations with a browser leg at both sizes. The last
full run recorded with all of them is the serial Vitest run of the trial
`pnpm check:gate` on `f94d6ee`, which failed 2 of 2,030 tests, the
conditions browser test's two time zone cases, none of these ("Veoci and air
gap follow-up: Vitest collected a node test file"); hosted CI runs
36211128703 on `78f9f37`, 36213840730 on `bba9817` and 36216221581 on
`055792e` failed 3, 1 and 3 tests, none of these. Before them, scenario 3
failed once under the parallel run of "IPAWS connector IC1: the connector
to the Interface Design Guide" and passed alone. Automated tests are
evidence, not Basho's acceptance (gate 18).

| # | Scenario | Test | Receipt | Plan-end gate |
|---|---|---|---|---|
| 1 | An occasional operator returns and finds their own work | `scenario-occasional-operator-browser.test.ts` | "Operator trust TP2: my work" | Passed on `5079670` (section 6) |
| 2 | A request survives an interruption: navigation, a closed tab, an expired session | `scenario-request-interruption-browser.test.ts` | "Operator trust TP4: durable work and explicit state" | Passed on `5079670` (section 6) |
| 3 | A request is handed from receipt to acceptance to an owner, by number | `scenario-request-handoff-browser.test.ts` | "Operator trust TP1: request lifecycle and findability" | Passed on `5079670` (section 6) |
| 4 | A shift changes: the incoming operator reads what changed since their last shift | `scenario-shift-change-browser.test.ts` | "Operator trust TP3: shift handoff" | Passed on `5079670` (section 6) |
| 5 | A partner follows a link to what they were invited to, and is refused the rest with a reason | `scenario-partner-link-browser.test.ts` | "Operator trust TP6: partner invitations and recipient preview" | Passed on `5079670` (section 6) |
| 6 | The map and the records agree, and information says how old it is | `scenario-information-state-browser.test.ts`, `scenario-map-records-browser.test.ts` | "Operator trust TP5: information state you can read"; "Operator trust TP9: from the map to the action" | Passed on `5079670` (section 6) |
| 7 | An incident closes, says what stays active, and can be reopened | `scenario-incident-close-browser.test.ts` | "Operator trust TP7: incident close and reopen" | Passed on `5079670` (section 6) |
| 8 | Configuration moves forward through an upgrade | `upgrade-configuration.test.ts` | "Operator trust TP8: upgrades keep configuration" | Passed on `5079670` (section 6) |

## 4. What v0.9.9 would hold, relative to 0.9.2

The `0.9.2` builds came from `eb1277d`: the Operator Trust units, the read
fix, the Veoci roster's VA1 to VA5 (the delivery hold, federation batch
sizing, private authorities and time, collaboration and feeds in an outage,
corrections) and the exercise scenarios. `v0.9.9` adds what landed after
it, through `98f050a`.

| Area | What it adds | Receipts | Evidence level |
|---|---|---|---|
| Ready-made content and activation | Incident templates authored and versioned on screen; activation notifies chosen groups, positions and whoever is on shift, and opens the template's contact groups, reports, rules, dashboards, threads and file folders; signed solution packages, the small EOC starter pack and the hotline and shelter registration pack; publisher keys trusted from the profile folder on a Windows install | "Veoci and air gap VA6: incident templates as data"; "Veoci and air gap VA7: activation notifies; people reached by group, position and shift"; "Veoci and air gap VA11: signed solution packages" and its follow-up; "Veoci and air gap VA12: the small EOC starter pack"; "Veoci and air gap VA16: the incident room"; "Veoci and air gap VA29: hotline and shelter registration pack"; "Veoci and air gap follow-up: trusted package keys on a Windows install" | Real-database, component and browser tests; VA29 a real-database test; the trusted keys a unit test |
| ICS forms and the IAP | Fifteen ICS forms as versioned components of an operational period; the IAP assembled and approved from them, a change after approval making a new revision; the ICS 213RR from a resource request | "Veoci and air gap VA37 part one: ICS forms as stored components"; "Veoci and air gap VA37 part two: the IAP assembled from its forms"; "Veoci and air gap VA38: the ICS 213RR as a form component" | Real-database, component and browser tests |
| Notifications | Response options on mass sends; SMS through an Android phone on the site network with replies read back; printed call-down sheets; a radio and runner log | "Veoci and air gap VA8: response options on mass sends"; "Veoci and air gap VA21: local carriers" | Real-database, component and browser tests against a fixture phone |
| Plans | Executable plans, recurring event plans, continuity of operations plans, and corrective actions linked to plans | "Veoci and air gap VA13: executable plans" and "Veoci and air gap VA13 and VA14 corrections: review findings"; "Veoci and air gap VA27: continuity of operations plans"; "Veoci and air gap VA30: corrective actions linked to plans" | Real-database, component and browser tests |
| Cost recovery | Public Assistance force account with FEMA-format summaries | "Veoci and air gap VA14: Public Assistance force account" and its corrections | Real-database, unit, component and browser tests |
| Boards, reports and dashboards | Signature fields; QR codes on badges and pool resource labels; workflow guards and per-state read-only fields; the declarative action catalog; all-or-any conditions with groups, day and text operators, and every view option in the designer; board actions set off by edits through sync, an offline edit on reconnect included; a workflow transition that takes the incident's lock first, so it no longer deadlocks with a write on the same incident; charts in reports; create-record tiles on saved dashboards; the record pane keeps its tab through a save | "Veoci and air gap VA9 part one: the signature field"; "Veoci and air gap VA9 part two: QR codes on badges and pool resources"; "Veoci and air gap VA15: workflow guards and per-state field permissions"; "Veoci and air gap VA25: declarative action catalog"; "Veoci and air gap VA26: all-or-any conditions, date and text functions, every view option in the designer"; "Veoci and air gap follow-up: sync edits set board actions off"; "Veoci and air gap follow-up: a workflow transition's lock order"; "Veoci and air gap VA31: charts in reports and create-record tiles"; "Veoci and air gap follow-up: the record pane keeps its tab through a save" | Real-database, component and browser tests; the two follow-ups real-database tests |
| Integrations | Service identities scoped to one jurisdiction and a viewer or member role, revocable, expiring and tied to their creator; an OpenAPI 3.1 description of the API | "Veoci and air gap VA32: OpenAPI document and scoped service identities" | Real-database, component and browser tests; an independent adversarial review, its findings fixed |
| GIS interchange | A read-only ArcGIS FeatureServer for every board with a map field the caller may read, with object ids numbered per board; Esri JSON in the board import, each shape checked by PostGIS; multipart shapes on board geometry fields; one read wall for the FeatureServer, the OGC items and the board tiles, which now honours the map field's own read level; the Windows host's Caddy log keeps no token | "Veoci and air gap VA33: Esri interchange" | Real-database, component (with axe) and browser tests at both viewports, the host generator's test and a loopback run of the shipped Caddy; request shapes from the published ArcGIS REST forms, no Esri client; an independent review before landing, its findings fixed |
| Migration and people | A report for every import, signed off on screen; import templates; a people import | "Veoci and air gap VA17: validated migration"; "Veoci and air gap VA17 completion: board record import reports" | Real-database, component and browser tests |
| Volunteers | A volunteer and CERT roster with credentials, deployments and hours | "Veoci and air gap VA28: volunteer and CERT roster" | Real-database, unit, component and browser tests |
| Exchange across the gap | Signed peer identity and agreement revocation; exchange by file | "Veoci and air gap VA19: signed peer identity"; "Veoci and air gap VA20: exchange by file" | Two-instance real-database tests, VA20's with no network path between them; browser tests |
| Field work offline | Map points, messages and new tasks queued offline; boards with record rules synced per record; late submissions to a closed incident; a device PIN, offered and never required, that encrypts what a shared device keeps for a person and locks it at start and after 15 minutes idle | "Veoci and air gap VA22: field breadth"; "Veoci and air gap VA34: offline device PIN for shared devices" | Real-database, component and browser tests offline and back; VA34 unit, component (with axe) and browser tests on the real build with its service worker |
| Maps | Region map packets for an area outside California | "Veoci and air gap VA35: region map packs" | Unit tests and a hand run with stand-in files |
| Supply chain | The license gate | "Veoci and air gap VA10: the license gate" | Command tests |
| IPAWS | The connector rebuilt to the IPAWS-OPEN Interface Design Guide | "IPAWS connector IC1: the connector to the Interface Design Guide"; "IPAWS connector IC2: the certificate on screen and each channel's answer"; "IPAWS connector IC3: documents" | Unit and real-database tests; a browser walk against a loopback stand-in |
| Guides | A rollout playbook, self-paced modules and the timed onboarding procedure; phones on a host's authority; the disconnected drill and its report | "Veoci and air gap VA18: rollout playbook and timed onboarding"; "Veoci and air gap VA23: phones on a host's authority"; "Veoci and air gap VA24: the disconnected drill" | Documents checked against the source; none run |
| Job aids | The acting position's job aid opened from the console's **Help**, with no connection needed; the eight aids rewritten to the screens as they are | "Veoci and air gap VA39: job aids in the console" | Unit, component and browser tests, with an offline reload |
| Fixes found by CI | The console mounted once after sign-in; the dashboard's filter fields kept while typing; the map's feature link inside the feature panel; the QR reader's second try when a browser's detector finds nothing | "CI repairs after the Actions runs resumed"; "CI repairs: the macOS job's browser tests"; "CI repairs: the macOS job on e245e08" | Component and browser tests |

Upgrading from `0.9.2` runs migrations `0147` to `0168` behind the forced
backup, each in one transaction with the server stopped. `0147` to `0153`
come from the Veoci roster's units that landed before VA13 (VA6, VA7, VA8,
VA11, VA37 and VA38), `0154` from the IPAWS connector and `0155` to `0168`
from VA13 on. The receipts state an upgrade cost only for `0168`; the
others add or change tables, columns, functions, triggers and policies, and
`0147` records each existing incident template as its version 1.

`0168` ("Veoci and air gap VA33: Esri interchange") numbers every board
record. Adding `board_records.object_id` with no default is a catalog change
under an ACCESS EXCLUSIVE lock on `board_records`, held until the migration
commits, so nothing else reads or writes records meanwhile. The backfill
then updates every record once: a new row version and new index entries per
record, the old versions dead until autovacuum reclaims them, so the table
briefly takes up to about twice its space, though no data file is
rewritten. `set not null` scans the table once and the unique index is
built once. Its time grows with the record count: a single pass over the
table, of the same order as an index build.

Case-blind conditions use PostgreSQL's ICU collation `und-x-icu`, which the
Windows runtime and Postgres.app carry ("Veoci and air gap VA26: all-or-any
conditions, date and text functions, every view option in the designer").
Three things change for an installed copy: a federation peering receives
nothing until both administrators record each other's public keys ("Veoci
and air gap VA19: signed peer identity"); an IPAWS PIN stored by an earlier
build no longer configures IPAWS, and the certificate must be entered
([CHANGELOG.md](CHANGELOG.md), Unreleased); and a federation peer still on
an earlier release refuses a record with a multipart shape until it is
upgraded too (VA33). Going back to an earlier build after `v0.9.9`, send the
work queued under a device PIN first, since the earlier web app does not
read where it is kept, and expect records with multipart shapes to be
refused on their next edit (the rollback notes of VA34 and VA33).

## 5. What has not been run

Each of these is written as a procedure or named in a receipt, and none has
happened. The Veoci roster's amendment 4 makes the drill and the phone walk
placeholders that gate nothing; they gate no unit, and they are not proof.

| Run | Whose | Procedure | Rows waiting on it |
|---|---|---|---|
| Part 1 of the disconnected drill: the unplugged run with a second device, and the setup installed from media on a disconnected second computer | Basho | [The disconnected drill](docs/guides/DISCONNECTED-DRILL.md), Part 1, recorded on [its report](docs/guides/DISCONNECTED-DRILL-REPORT.md) | AR7; INV-3 |
| Part 2, the 72-hour drill against local stand-ins, with the day-2 exchange by file when a second host is set up | Basho, with an EOC's staff | The same, Part 2 | F3; F4; AR7 |
| The phone walk on an iPhone or iPad and on Android | Basho, on his phones and a host | [Phones and tablets](docs/guides/NETWORK-HOST.md#phones-and-tablets), recorded under "Record the phone walk" | G-PWA; G-HOST; F7 |
| A region map packet built and carried in to an EOC host | Basho | [Region map packs](docs/guides/REGION-MAP-PACKS.md) | AR7 |
| The signed starter pack imported on an installed Windows computer, with the publisher's key in `trusted-template-keys.pem` | Basho | The [starter pack's README](deploy/packs/small-eoc-starter/README.md) and step 4 of the [rollout playbook](docs/guides/ROLLOUT-PLAYBOOK.md) | G-PACKAGES |
| The Mac runs: the disk image opened, Gatekeeper's first-open prompt, the demo with Postgres.app, a map packet installed from Downloads | Basho, on a Mac | `deploy/macos/READ-ME-FIRST.txt` | G-MACOS; gate 9 |
| The timed onboarding | Basho, with a person new to the product | [Timed onboarding](docs/guides/TIMED-ONBOARDING.md) | F16 |
| SMS through a real Android phone running SMS Gateway for Android with a SIM | Basho | The [administration guide](docs/guides/ADMIN.md) | F4 |
| The Windows host installed on a real machine with `Test-OpenEOCHost.ps1` and its clock lines; a first real upgrade and scheduled backup | Basho | The [network host guide](docs/guides/NETWORK-HOST.md) | G-HOST; G-DR; gate 9 |
| The two-hour load with the read fix, and a load run against the installed host | Basho (the rerun was skipped at his instruction) | `deploy/windows/prove-load.mjs` | R1 |
| A send to the IPAWS-OPEN test environment | Basho, after the developer MOA and a COG certificate | [IPAWS enablement](docs/IPAWS-ENABLEMENT.md) | R2 |
| The starter pack's tabletop | Basho, with an EOC's staff | [The tabletop](deploy/packs/small-eoc-starter/TABLETOP.md) | G-PACKAGES |
| The rollout playbook and the self-paced modules, walked by EOC staff | Basho, with an EOC's staff | The [rollout playbook](docs/guides/ROLLOUT-PLAYBOOK.md) and [self-paced training](docs/guides/SELF-PACED-TRAINING.md) | F17 |
| A board added as a layer through the FeatureServer in QGIS, ArcGIS Pro and ArcGIS Online | Basho, with those clients | The [administration guide](docs/guides/ADMIN.md#esri-and-gis-clients), "Esri and GIS clients" | F20 |

## 6. The plan-end gate and the builds

The Veoci roster's section 7 and decision 18: after its last unit landed,
these ran on `5079670` ("Version 0.9.9: the version and changelog"), the
commit `v0.9.9` is built from, on the Windows machine that runs the plan
("Veoci and air gap plan-end gate", "Version 0.9.9: the builds"). Earlier
runs are not these results: RD5's proof, by default and with the stand-ins,
passed on `2991317` ("Veoci and air gap plan gate: the air-gap proof with
integrations on local stand-ins"), and a trial `pnpm check:gate` ran on
`f94d6ee` ("Veoci and air gap follow-up: Vitest collected a node test
file").

One defect was found after the builds, by hosted CI: a sync document
evicted while it was being reopened was handed back destroyed ("Veoci and
air gap follow-up: a sync document evicted while it was reopened"). It was
present in `0.9.2` too and is rare; the fix, `933b946`, is not in these
builds unless they are rebuilt, which is Basho's call before publishing.

| Check | Command or procedure | Result |
|---|---|---|
| The serial gate | `pnpm check:gate` | `5079670`, 05:18:47Z to 06:01:48Z, exit 0: `check:static` exit 0 (licenses 339 packages, links 127 files); `audit:advisories` 0 high or critical, 0 exceptions; `test:desktop` 44 of 44; the serial Vitest run 385 of 385 files and 2,077 of 2,077 tests, no red; the load benchmark 4 of 4 |
| Acceptance scenarios 1 to 8 | Within `pnpm check:gate` | Passed on `5079670`, in the last column of section 3 |
| RD5's proof with every optional integration configured against local stand-ins | `node deploy/windows/prove-airgap.mjs` and `node deploy/windows/prove-airgap.mjs --stand-ins` on Windows | Both **PASS** on `5079670`, no connection outside this computer and its local network and no page error (default 05:19:20Z to 05:20:49Z; stand-ins 05:20:49Z to 06:23:56Z). With the stand-ins: email, SMS by the HTTP provider and by the gateway phone, and push each held what they could not send (3, 3, 2 and 1) as "Waiting for a route" and delivered it 2 to 6 seconds after their route returned; the partner host received the record made during the cut 6 seconds after it was back; the feed raised one "Feed failing" notice that became "Feed recovered"; the webhook expired at the end of its 1-hour window, was resent, and was delivered 58 seconds later; both gateway replies acknowledged the send. `AIR-GAP-REPORT.md` is this run's report |
| Hosted CI on the release commit | The push to `main` | `5079670` was pushed with `933b946`; run 36220202097 on `98f050a`, the same code without the version, failed 3 of 2,077 tests: the sync document eviction above, fixed in `933b946`, and two browser walks (the board records import and the visual review) that passed on this machine twice, in the gate and alone. The run on `933b946` is recorded in "Veoci and air gap plan-end gate" when it ends |
| Coverage (gate 20) | `pnpm test:coverage` at `00deba5` and at the release commit | Not run; open for Basho: a measurement, or his acceptance of the assertion counts in its place |

| Build | File | Bytes | SHA-256 |
|---|---|---|---|
| Windows setup, with `-IncludeOptionalBasemaps` | `deploy/Open-Source-EOC-Setup-0.9.9.exe` | 1,876,839,637 | `ca9512dde89d041fd8000bd97879df16126c119c19f9aa56c06b57e4a7bdb173` |
| Portable ZIP of the same staged `app` folder | `deploy/Open-Source-EOC-0.9.9.zip` | 1,979,868,473 | `09a76713de126f512917e6a8f449c457718f5ce57ff0c320394abde7a1c0d0a6` |
| macOS disk image, built on Windows from the setup's stage, using Postgres.app | `deploy/Open-Source-EOC-0.9.9-macOS.dmg` | 311,230,464 | `5dfa5070cac49bcd2448e2e4f8bcb312d22d777b36346cdb79ba4f6eb2aedbd4` |
| Map data packet | `deploy/Open-Source-EOC-0.9.9-map-data.zip` | 1,733,606,646 | `37e4cbf2268fa32a3348f6ceea75aaf459a75cf21d19091098e36daa83c25253` |

## 7. What remains

### Basho's external inputs

| Input | What it unblocks |
|---|---|
| The two-hour load with the read fix and against the installed host services, if wanted beyond RD4's run on the host profile | R1; INV-8 |
| Part 1 of the disconnected drill: the unplugged check, `deploy/windows/Test-OpenEOCAirGap.ps1`, with a second device on the same switch, and the install from media on a disconnected second computer | AR7; INV-3 |
| Part 2 of the drill, with a second host for the day-2 exchange by file | F3; F4; AR7 |
| A Windows machine to run the host setup and its scripted check on, then a first real upgrade and scheduled backup | Gate 9; G-HOST; G-DR |
| A Mac for the first Mac run, and an Apple Developer ID for a signed app | G-MACOS; gate 9 |
| The IPAWS-OPEN developer MOA and a COG certificate | R2's send to the test environment, then live |
| Representative operators, with licensed WebEOC access if possible | F14; F17; INV-8; D34 |
| A person new to the product for the timed onboarding | F16 |
| The NVDA and VoiceOver pass by the [accessibility guide's script](docs/guides/ACCESSIBILITY.md), recorded as "V1 A11Y-T1: screen-reader pass" | Gate 16; G-A11Y |
| A second maintainer, or the written INV-10 waiver in the ledger | Gate 17; INV-10 |
| Acceptance of the release candidate | Gate 18 |
| A pilot jurisdiction | A 1.0 not marked evaluation-only |
| Private vulnerability reporting switched on (the Actions budget was raised on 2026-09-25) | The security policy's first channel |
| A phone or tablet for the phone walk; a Windows code-signing certificate | G-PWA; a signed setup |
| An Android phone with a SIM for SMS Gateway for Android | F4 |
| The signed starter pack imported on an installed computer; the packs' content reviewed | G-PACKAGES |
| A region's map build and carry-in, for an EOC outside California | AR7 |
| FEMA's equipment rate schedule, a download (the Veoci roster's decision 11) | F8 |
| QGIS, ArcGIS Pro and ArcGIS Online, to add a board through the FeatureServer | F20 |
| Live data: FEMA NFHL, a statewide shelter feed, ACS population, parcels beyond Humboldt, county address points, the full RTLT set, a live feed; a live SMTP relay and SMS provider; a real Mattermost or Matrix server if collaboration is used | F9; F18; G-INGEST; G-CATALOG; G-IMPACT; G-PARCELS; G-FLOOD; address search; resource typing; live email and SMS; F15 |

### Basho's decisions, with the default in force

| Decision | Default until Basho says otherwise |
|---|---|
| May guests read the resource module (F5) | Resource reads are the owner's members and the incident's participants; guests do not read it |
| Incident lockdown (G-INCLIFE) | Off by default; an administrator applies it per incident; it refuses guest reads only |
| The version on `GET /api/v1/health` | Shown without sign-in, so an administrator's upgrade check can read it; the alternative is the metrics route only |
| Visual review | The current design stands: dark primary buttons with a light fill and dark label; the review's input border rule and dark border token; D33 findings 15 (two primary button styles), 18 ("Unavailable" for an empty optional field), 21 (the board list's Open column at 390), 24 ("required" in the error color before input) and 25 (no product identity on sign-in) |
| SAML (G-MFA; the Finish PSPR's section 7 item 3) | TOTP for local accounts, OIDC available, no SAML until an identity provider needs it |
| The product name (the Finish PSPR's section 7 item 8) | "Open Source EOC", short name "OpenEOC", as the README, installer and web app manifest carry |
| Federation of incident records (F3; the Veoci roster's decision 3) | Not federated, by network or by file, stated as a known limit in the changelog; AG-13 waits on it |
| Member-marked fields on an incident's board screen (G-PACKAGES) | Everyone who reads an incident reads the member-marked fields of its boards on the incident's board screen and in its sync documents, under the binary access model; the marks keep those fields out of notifications and out of views outside the incident. If the marks should hold on the incident screen too, the fix is the reader's own role in `listViewRecords` and the sync hub ("Veoci and air gap VA29: hotline and shelter registration pack") |
| The first password of a people import (F16) | The accounts one import makes share the first password the administrator types, never read from the file and hashed once per run; the alternative is a password per account ("Veoci and air gap VA17: validated migration") |
| Volunteer hours as Public Assistance donated resources (G-VOLUNTEERS) | Not built, and volunteer hours never enter the force account. The receipt leaves three questions: whether to credit volunteer labor on eligible work against the non-Federal share; at what rate (the applicant's own rate for similar work, or the local prevailing rate), confirmed against the PA guide edition below; and how hours count where one volunteer's roles overlapped, since merged hours no longer say which role ("Veoci and air gap VA28: volunteer and CERT roster") |
| A volunteer's entry and credentials (G-VOLUNTEERS) | An entry is deactivated and its contact blanked, not deleted, and a credential is its current record without history, so renewing a card clears the warning on a past deployment it covers; the alternatives are deletion on a volunteer's request and a credential history ("Veoci and air gap VA28: volunteer and CERT roster") |
| The "Legacy dashboard" line (G-DASH) | An activated incident's dashboard shows, when no saved view is chosen, under the Dashboards screen's existing line "Legacy dashboard · not a saved incident overview" ("Veoci and air gap VA16: the incident room") |
| A GSM modem (F4; the Veoci roster's decision 6) | The local carrier is an Android phone running SMS Gateway for Android. A GSM modem needs a bridge that speaks the gateway's API or the HTTP provider's, and no maintained one does on Windows or macOS; pick a bridge, or accept the phone ("Veoci and air gap VA21: local carriers") |
| The PA guide edition (F8; the Veoci roster's decision 10) | FP 104-009-2, Version 5.0 as amended, named in the dictionary for Basho to confirm ("Veoci and air gap VA14: Public Assistance force account") |
| The packs' content (G-PACKAGES) | The starter pack and the hotline and shelter pack as shipped: their fields, checklists and CMIST labels are Basho's to judge |
| A service identity reading a dashboard's live stream, for a wall display (G-SERVICE) | The WebSocket channels take a person's session only, so a wall display needs a person signed in ("Veoci and air gap VA32: OpenAPI document and scoped service identities", open for Basho) |
| Whether a jurisdiction may require a device PIN (G-PWA; threat row B18) | Each person sets their own: the console offers a PIN after every password sign-in and in Settings, and never requires one, so without it the device keeps that person's work and last session unprotected, as before; the alternative is a policy that makes setting one mandatory at sign-in ("Veoci and air gap VA34: offline device PIN for shared devices") |
| Areas on a Road Closures board (F20) | A Road Closures board draws only lines and closed points, by its template's cartography, so areas imported into one are stored and listed but not drawn; generic boards draw them. Pre-existing, found by "Veoci and air gap VA33: Esri interchange"; the alternative is to draw areas on that template's map too |
| Job aids for the Safety Officer and the Finance/Admin Section Chief (F17) | None written; **Help** opens the nearest aid (the Planning Section Chief's, the Logistics Section Chief's) and says so ("Veoci and air gap VA39: job aids in the console") |
| The macOS disk image for `v0.9.9` | Built on Windows, as `0.9.2`'s was, needing Postgres.app on the Mac; the alternative is the "macOS demo" workflow's image with its own PostgreSQL, started by hand on a Mac runner |
| Public-facing work (the Veoci roster's decision 4) | Tabled until a date Basho sets: no public form, public dashboard, resident alerting, published snapshot or link for someone without an account |
| Voice call-down and phone dial-in (the Veoci roster's decision 7) | Not built; a service across a process boundary once Basho names a carrier |

Decided since: cross-organization sharing (R3, F5). Basho approved
`docs/process/PARTNER-SHARING-PSPR-2026-09-24.md` on 2026-09-24: every
organization on an incident reads its resource requests, positions and
incident-wide threads; a partner requests from the incident's owner, who
triages and assigns it; costs stay with the owning organization. The ledger
receipts "Partner sharing PS1" to "Partner sharing PS5" carry it out.

Also in force and unchanged here, from the Finish PSPR's section 7: single
node (item 4); no patient-level data in tracking or facilities (item 5);
archiving the retired rosters (item 11); branch protection (item 9) and
`work/d05` (item 10) left to Basho.

### Known product limits

- One API process per database.
- Federation: incident records are not federated, by network or by file. A
  batch received over the network is attributed to the sending instance, and
  one imported by file to the administrator who imported it. The partner is
  not told of a revocation; resource escalation and JIC approval deliveries
  are not signed; batch files are signed, not encrypted. Deletes of other
  records and records made before an agreement travel ("Readiness RD10:
  federation of record deletes and earlier records"). A peer on an earlier
  release refuses a record with a multipart shape until it is upgraded, and
  object ids, which are per instance, do not travel by network, file or
  export ("Veoci and air gap VA33: Esri interchange").
- No voice channel; Teams and Slack only as a generic webhook. Text replies
  are read only through an SMS gateway on the site network, where "sent"
  means the phone took the text.
- The WebEOC importer moves records only: no value translation, coordinates,
  person, reference or attachment fields, incident tagging, updates or
  `prevdataid` links.
- Form submissions, imports and records from a federation peer set off no
  board action; edits through sync do, an offline edit when its device
  reconnects included ("Veoci and air gap follow-up: sync edits set board
  actions off"). A map point saved online whose answer is lost arrives a
  second time on reconcile.
- Without a device PIN, the default, a device keeps each person's offline
  work and the last session unprotected, readable by anyone who uses it, and
  a restart opens the console as the last person; the console says so and
  offers the PIN. Under a PIN, a copy of the device's storage lets a
  six-digit PIN be guessed away from the app in minutes, so disk encryption
  remains the defence for a lost device; store keys, vault names and
  viewer preferences are not encrypted; and the tenth wrong PIN in a row
  erases what the device kept for that person, unsent work included. The
  PIN was walked in Chromium only ("Veoci and air gap VA34: offline device
  PIN for shared devices"; threat row B18).
- The FeatureServer is read-only and answers `GET` only: its `where` takes
  only `1=1`, with no attribute filters, statistics, sorting or `f=pbf`; an
  ArcGIS web client's `POST` query for a long address is not served; there
  is no ArcGIS sign-in, so a client that asks for a user name and password
  is given the address with `?token=`, which then lives in the client's
  saved project. No Esri client has tried it ("Veoci and air gap VA33: Esri
  interchange"; threat row B19).
- The report builder stays all-of and counts days in UTC; views, guards and
  actions take any-of, groups and a stored time zone.
- Service identities use REST only, the FeatureServer among it; the
  WebSocket channels take a person's session (threat row B17). The OpenAPI
  description publishes 26 request schemas and no response bodies or query
  strings.
- Plans are not in the jurisdiction export, and a recurring event plan is
  activated once per occurrence, not by a calendar. File folders are one
  level, and a stored file does not move between them.
- A guest socket that joins between a lockdown or revocation and its re-check
  stays open until it rejoins.
- A desktop profile started while the Backup action holds its PostgreSQL is
  stopped with it.
- No Mac network host; the Mac disk image built on Windows needs Postgres.app.
- No training video. Tracking and facilities are not reviewed for
  patient-level data.

### Open engineering work

- **Before any setup is published:** the stage now carries the runtimes'
  license texts, an ODbL notice with attribution for the archives and
  gazetteer, and a written source offer for the GPL components. Still open:
  runtime inputs that carry those license files (the official Node zip; the
  EDB and PostGIS bundle license files in `pgsql`), without which the stage
  stops; Basho's rights review of the overlays archive; the license texts
  of the bundle's other libraries, the web bundle's npm packages and the
  Liberation Sans glyphs; and the offered source kept for three years. See
  [the asset inventory](docs/ASSET-LICENSES.md#license-work-open-before-a-setup-is-published).
- **Checks:** coverage at `00deba5` and the release commit (gate 20);
  hosted CI's first recorded green run. The plan-end gate is green
  (section 6). Of the
  three browser suites that failed on the Windows runner at `0.9.2`, "CI
  repairs: the macOS job's browser tests" fixes authorized viewing and load
  retry; no receipt names the templates suite for a jurisdiction
  administrator since. Two CI stalls have no known cause: the board records
  sign-in ("CI repairs: two Windows stalls at a second sign-in") and the
  partner sharing test ("CI repairs: the partner sharing stall, named when it
  recurs"). The load test's 300 ms budget for a filtered view was missed on
  the Linux bed and is unexplained there ("Veoci and air gap phase VA-A
  gate").
- **macOS:** RD6 and a Mac network host, open under the Operator Trust PSPR.
- **Board-wide documents and incident sync edits:** a warm board-wide sync
  document does not take an incident-scoped sync edit until its next apply
  or a rebuild after it idles out, while the write of an action that edit
  sets off does fold into it, so a board-wide subscriber can see that record
  with only the action's field until the document is rebuilt. Folding
  incident updates into the board-wide document needs that document's
  missing history first ("Veoci and air gap follow-up: sync edits set board
  actions off", found and not fixed).
- **Trust on a phone:** the sign-in page's **Trust this server** panel gives
  steps for Windows and macOS only; the network host guide covers phones
  ("Veoci and air gap VA23: phones on a host's authority").
- **Federation:** a signed revocation notice and key rotation on screen
  ("Veoci and air gap VA19: signed peer identity").
- **SMS gateway:** the phone's later delivery state is not read back ("Veoci
  and air gap VA21: local carriers").
- **Address data:** house numbers by parcel containment and the containing
  city need county data (G-GEOCODE), an input only Basho can authorize.
- **Test stability:** the intermittent Windows worker crash (`0xC0000409`),
  not found at its root ("Readiness RD11: the remaining checks").

## 8. The release decision

The roster sets the release act as Basho's: "tag, release assets, installer,
announcement text; the pilot jurisdiction named or the release marked
evaluation-only". No pilot jurisdiction, second maintainer or waiver,
operator comparison or screen-reader pass exists. Gate lines 9, 16, 17,
18 and 20 are not green; line 1 is green on `5079670` (section 6).
`0.9.2` was never tagged.

**Recommendation: tag `v0.9.9` as an evaluation-only release, built in every
install format, once the plan-end gate is green.** It claims no gate it has
not met, so it needs no waiver. It requires, in order:

1. The Veoci roster's last units landed, with the matrix and register rows
   each one changes brought up to date. Done: every unit has landed, and
   VA33, VA34 and the follow-ups are reconciled through `98f050a` ("Veoci and
   air gap VA36 completion: VA33, VA34 and the follow-ups").
2. The version set to `0.9.9` in every package manifest (they carry
   `0.9.2`), with a dated `0.9.9` changelog entry that takes in the
   Unreleased entries and states the upgrade notes in section 4.
3. The plan-end gate green on the release commit (section 6). Done on
   `5079670`.
4. The license work above done, since the builds are release assets.
5. The four builds from the release commit, made after the last document
   change, since `docs/guides` is a build input ("Veoci and air gap VA39: job
   aids in the console", its landing), with their sizes and SHA-256 in
   section 6: the Windows setup with `-IncludeOptionalBasemaps`; the
   portable ZIP of the same staged `app` folder (the repository has no
   script for it; `0.9.2`'s was made from the stage); the macOS disk image;
   and the map data packet (`tools/basemap/pack-map-data.mjs`). Done from
   `5079670`; rebuilding the setup, the ZIP and the disk image from
   `933b946` would carry the one fix found after them (section 6).
6. The tag `v0.9.9` on the release commit.
7. Release assets: the four files, each with its SHA-256.
8. Announcement text that says evaluation-only and synthetic data only,
   names what has not been run (section 5), and points to the
   [evaluator's page](docs/EVALUATOR.md).

Alternatives:

- **`1.0.0` marked evaluation-only.** Needs Basho's written waiver in the
  ledger of every line not green (1, 9, 16, 17, 18 and 20), the version
  changed in every package manifest with a changelog entry, and then the
  same builds, tag, assets and announcement. Under
  [the support statement](GOVERNANCE.md#releases-and-support), 1.0 starts
  security fixes for the latest minor version, so a 1.0 that is also
  evaluation-only makes two promises at once.
- **No release now.** Leave the build untagged until the external inputs
  arrive, then tag `1.0.0` with the gates green. Until then the evaluation
  build is reachable only from source.

Tagging, pushing the tag, publishing the release assets and the announcement
are Basho's act alone.
