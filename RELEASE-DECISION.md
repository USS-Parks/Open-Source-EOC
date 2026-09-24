# Release decision

For Basho. Prepared on 2026-09-24 from `main` at `ec11af5`, the point at which
every engineering unit of the Finish PSPR had landed. Evidence is cited by
receipt heading in the [V1 ledger](docs/process/V1-LEDGER.md). Capability
status is in the [parity matrix](docs/VEOC-PARITY-MATRIX.md) and the
[facet register](docs/FACET-STATUS.md), both reconciled to the receipts for
this document.

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
- This reconciliation: every matrix and register row checked against the
  receipts, eight rows added; README, ROADMAP, the design-to-capability
  matrix, the [asset and license inventory](docs/ASSET-LICENSES.md), the
  guides and the changelog updated; eleven
  [final reference captures](docs/design/final-captures/README.md).

## 2. The gate list

Section 6 of the Finish PSPR. Green: met on the cited receipt. Open: work the
project can still do. External: needs an input or act only Basho can supply.
No line carries a written waiver.

| # | Gate | State | Receipt, or what is missing |
|---|---|---|---|
| 1 | `pnpm check` green, serial, gate tag, with route-table, secret and advisory scans | Green | "V1 final milestone gate" on `ec11af5`: every static gate, 273 of 273 files and 1,553 of 1,553 tests in one run, the load benchmark 4 of 4. `pnpm check` runs no secret scan itself: gitleaks runs in the pre-commit hook, which passed on every commit, and in hosted CI, which has started no job since `12d430e` for a billing reason on Basho's account |
| 2 | Single-node declaration | Green | "V1 W2.5: rate limiting and identity caching" |
| 3 | Heap flat over two hours with 150 sockets; real-hardware run recorded | External | Heap flat in "V1 W2 milestone gate". No deployment hardware: "V1 R1-REAL: the real-hardware 150-user run (boundary recorded)" |
| 4 | No network call inside a write path; outbox worker and scheduler in both deploy paths | Green | "V1 W2.12: network calls out of every write path"; "V1 W2.1: outbound delivery queue"; "V1 W2.2: scheduler", whose desktop path was checked by loading the module, not by running a profile |
| 5 | Every list paginated; push replaces the notifications poll | Green | "V1 W2.3: pagination and push-down"; "V1 W2.11: remaining list pagination"; "V1 W2.4: WebSocket discipline". The templates catalogue stays unpaged, with the reason in the W2.12 receipt |
| 6 | Logs, metrics and rotation in both paths; retention enforced | Green | "V1 W2.8: observability"; "V1 W2.9: retention and export" |
| 7 | MFA for administrators; two-person IPAWS send; webhook allowlists | Green | "V1 W2.10: MFA"; "V1 W2.7: threat-model controls"; "V1 W3.5: IPAWS enablement and send" |
| 8 | Refuse to serve with row-level security off | Green | "V1 W2.6: secure by default" |
| 9 | Windows and macOS setups, each with a workstation and a network host with HTTPS; installer rebuilt with archives; backup scheduled; restore drill (restated by ADR-0010: the platforms are Windows and macOS, and the Docker install is removed) | Open | Windows setup built, not installed ("V1 W6.4: installer rebuild"); schedule written, not run ("V1 W6.2: disaster recovery runbook"); drill recorded ("V1 W6.1: versioning and upgrade"). Missing: the Windows host and the macOS setups, scheduled in the readiness plan, and a first real run of each install and schedule |
| 10 | Every operator route on a screen; no dead ends; administration without curl | Green | "V1 W3 milestone gate"; "V1 W3 route coverage: every operator route owes a screen"; "V1 W3.0: administration" |
| 11 | Email and SMS with a contacts directory | Green | "V1 W4.0 part one: email and SMS channels"; "V1 W4.0 part two: contacts and mass notification", against a local relay and a fixture SMS provider |
| 12 | Board CSV and Excel import and export; WebEOC importer with a guide | Green | "V1 W4.1 part one: board engine depth"; "V1 W4.1 part two: board screen controls"; "V1 W4.4: WebEOC migration" |
| 13 | Layers render past the feature cap | Green | "V1 W4.5: operational vector tiles" |
| 14 | First-load JavaScript under 300 KB gzipped | Green | 159.8 kB in "V1 W5.0: code splitting", 161.0 kB in "V1 W5.3: remaining interface findings". The budget script is not part of `pnpm check` |
| 15 | README, ROADMAP, register, matrix and API document agree | Green on this reconciliation | `docs/API.md` matches the contract route for route (the api-docs test), and its generated header says the OIDC sign-in routes register only when `OPENEOC_OIDC_ISSUER` is set |
| 16 | 79D+D33 and M5 green; A11Y-T1 done; D34 done or absence recorded; 86+D35 presented | External | The exercise, review, M5 and the D34 absence are receipted, and this document presents 86+D35. Missing: the NVDA and VoiceOver pass |
| 17 | SECURITY.md, CHANGELOG.md, versioned packages; second maintainer or waiver | External | "V1 W6.3: project hygiene for adoption"; "V1 W6.1: versioning and upgrade". Missing: a second maintainer or Basho's written INV-10 waiver |
| 18 | Basho's aesthetic and functional acceptance of the release candidate | External | Not recorded |
| 19 | One roster; link checker green after the archive move | Green | "V1 W1.12: retire the roster stack"; link checker at 94 files in "V1 M5 milestone gate" |
| 20 | Test lines and assertions recorded before and after W1.14; coverage not lower than the W1.11 baseline | Open | Counts in "V1 W1.14: consolidate the server test suite". Coverage was never measured, and the W1.11 receipt records no baseline. Close by measuring coverage at `00deba5` and at the release commit, or by Basho accepting the assertion counts in its place |
| 21 | Each optional integration registers by default or is named in README with its variable | Green | "V1 W6.6: gated-module disposition"; README now names OIDC sign-in and its variables |

## 3. What remains

### Basho's external inputs

| Input | What it unblocks |
|---|---|
| Deployment hardware for a two-hour `scripts/soak.mjs` run at 150 sockets on the release candidate | Gate 3; R1; INV-8 |
| A second computer with no network, for the check in the [installer README](deploy/windows/installer/README.md) | AR7; INV-3 |
| A Windows machine and a Mac to run the host setups and their scripted checks on, then a first real upgrade and scheduled backup on each | Gate 9; G-DR |
| IPAWS-OPEN test credentials and the signed MOA | R2's live send |
| Representative operators, with licensed WebEOC access if possible | F14; F17; INV-8; D34 |
| The NVDA and VoiceOver pass by the [accessibility guide's script](docs/guides/ACCESSIBILITY.md), recorded as "V1 A11Y-T1: screen-reader pass" | Gate 16; G-A11Y |
| A second maintainer, or the written INV-10 waiver in the ledger | Gate 17; INV-10 |
| Acceptance of the release candidate | Gate 18 |
| A pilot jurisdiction | A 1.0 not marked evaluation-only |
| GitHub Actions billing restored; private vulnerability reporting switched on | Hosted CI and its secret scan; the security policy's first channel |
| A phone or tablet to install the web app on; a code-signing certificate | G-PWA; a signed setup |
| Live data: FEMA NFHL, a statewide shelter feed, ACS population, parcels beyond Humboldt, county address points, the full RTLT set, a live feed; a live SMTP relay and SMS provider | F9; F18; G-INGEST; G-CATALOG; G-IMPACT; G-PARCELS; G-FLOOD; address search; resource typing; live email and SMS |

### Basho's decisions, with the default in force

| Decision | Default until Basho says otherwise |
|---|---|
| May guests read the resource module (F5) | Resource reads are the owner's members and the incident's participants; guests do not read it |
| Incident lockdown (G-INCLIFE) | Off by default; an administrator applies it per incident; it refuses guest reads only |
| The version on `GET /api/v1/health` | Shown without sign-in, so an administrator's upgrade check can read it; the alternative is the metrics route only |
| Visual review | The current design stands: dark primary buttons with a light fill and dark label; the review's input border rule and dark border token; D33 findings 15 (two primary button styles), 18 ("Unavailable" for an empty optional field), 21 (the board list's Open column at 390), 24 ("required" in the error color before input) and 25 (no product identity on sign-in) |
| SAML (G-MFA; section 7 item 3) | TOTP for local accounts, OIDC available, no SAML until an identity provider needs it |
| The product name (section 7 item 8) | "Open Source EOC", short name "OpenEOC", as the README, installer and web app manifest carry |
| Federation of incident records (F3) | Not federated, stated as a known limit in the changelog |

Decided since: cross-organization sharing (R3, F5). Basho approved
`docs/process/PARTNER-SHARING-PSPR-2026-09-24.md` on 2026-09-24: every
organization on an incident reads its resource requests, positions and
incident-wide threads; a partner requests from the incident's owner, who
triages and assigns it; costs stay with the owning organization. The ledger
receipts "Partner sharing PS1" to "Partner sharing PS5" carry it out.

Also in force and unchanged here: single node (item 4); no patient-level data
in tracking or facilities (item 5); the PA guide edition behind F8's
categories; archiving the retired rosters (item 11); branch protection
(item 9) and `work/d05` (item 10) left to Basho.

### Known product limits

- One API process per database.
- Federation: edits of incident records and all deletes stay local, records
  are not backfilled, and the peer attributes a batch to the sending instance.
- No voice channel; Teams and Slack only as a generic webhook; no inbound SMS
  acknowledgement.
- The WebEOC importer moves records only: no value translation, coordinates,
  person, reference or attachment fields, incident tagging, updates or
  `prevdataid` links.
- A guest socket that joins between a lockdown or revocation and its re-check
  stays open until it rejoins.
- A desktop profile started while the Backup action holds its PostgreSQL is
  stopped with it; the Windows setup does not stop running profiles.
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
- **Checks:** a coverage measurement for gate 20; a desktop profile run of
  the scheduler.
- **Screens:** choice labels in change history, record detail, kanban cards
  and the calendar; `.xlsx` on the WebEOC migration screen; creating from a
  published template for a jurisdiction admin who is not an instance admin;
  a console-wide lockdown banner; saving conditions, sorts and groups into
  template views; drilldown from kanban and calendar widgets; the pool status
  badges' case; renaming boards activated before the title change.
- **Engine:** federation of incident record edits and deletes, unless F3 is
  accepted as a limit; workflow reject and cancel, and names on history;
  badge revocation and ICS-211 history; facility registry edit and removal; a
  status request list; per-resource history, a cap per request, editing local
  kinds and changing a pool resource's kind or type; an index on
  `resource_requests(incident_id)`; refusing a duplicate `originRequestId` on
  the peer; gazetteer reverse lookup, containment, containing city and "St"
  as "Saint"; parcel vector tiles.
- **Offline and deploy:** opening the console offline after a restart; a
  reload offline before the app has cached its files; stopping profiles
  before the setup replaces files; hard links for file store copies; an
  inject-card file and a launcher note on the administrator two-step switch.
  The Docker path's items went with the path (ADR-0010).
- **Test stability:** the intermittent test worker crash (Windows exit code
  `0xC0000409`). The `esf-workspace-browser` wait was found and fixed
  ("Partner sharing PS5: scenario, review and gate").

Every item above is scheduled in
[the readiness plan](docs/process/READINESS-PSPR-2026-09-24.md), approved
2026-09-24.

## 4. The release decision

The roster sets the release act as Basho's: "tag, release assets, installer,
announcement text; the pilot jurisdiction named or the release marked
evaluation-only". No pilot jurisdiction, second maintainer or waiver,
real-hardware run, operator comparison or screen-reader pass exists. Gate
lines 3, 9, 16, 17, 18 and 20 are not green; line 1 is green on the final
gate.

**Recommendation: tag the current build as an evaluation-only release,
version `0.9.0`, the version every package already carries.** It claims no
gate it has not met, so it needs no waiver. It requires, in order:

1. The milestone gate green on the release commit, as "V1 final milestone
   gate" was on `ec11af5`.
2. The license work above done, since the setup is a release asset.
3. The changelog's Unreleased section folded into the `0.9.0` entry with the
   release date, since no `0.9.0` was ever published.
4. The Windows setup rebuilt from the release commit with
   `-IncludeOptionalBasemaps`. The existing setup was staged from `5875c2f`
   and predates the exercise, review, write path and interface changes.
5. The tag `v0.9.0` on the release commit.
6. Release assets: the setup with its SHA-256.
7. Announcement text that says evaluation-only and synthetic data only, and
   points to the [evaluator's page](docs/EVALUATOR.md).

Alternatives:

- **`1.0.0` marked evaluation-only.** Needs Basho's written waiver in the
  ledger of every line not green (3, 9, 16, 17, 18 and 20), the version
  changed in every package manifest with a
  changelog entry, and then the same rebuild, tag, assets and announcement.
  Under [the support statement](GOVERNANCE.md#releases-and-support), 1.0
  starts security fixes for the latest minor version, so a 1.0 that is also
  evaluation-only makes two promises at once.
- **No release now.** Leave the build untagged until the external inputs
  arrive, then tag `1.0.0` with the gates green. Until then the evaluation
  build is reachable only from source.

Tagging, pushing the tag, publishing the release assets and the announcement
are Basho's act. No session performs them.
