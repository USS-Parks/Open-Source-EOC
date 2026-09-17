# Virtual EOC (VEOC): Canonical Plan / Sequential Prompt Roster

**Created:** 2026-09-17
**Amended:** 2026-09-17, requirements addendum R1-R6 from Basho; sessions VEOC-15A and VEOC-33A added
**Working name:** Virtual EOC ("VEOC"; product name to be chosen by Basho before public release)
**Project repository:** `github.com/USS-Parks/Open-Source-EOC` (created by Basho 2026-09-17; planning documents originated in Mighty-Eel-OS under `docs/product/virtual-eoc/`)
**Research authority:** `VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` (same directory)
**Baseline revision:** to be recorded by VEOC-00 at execution start
**Status:** READY FOR USER APPROVAL; execution has not started
**Release posture:** nothing ships until VEOC-43 closes

## 0. Canonical authority

This is the sole top-level execution roster for the Virtual EOC side project. It is a product-construction roster, not a remediation roster, but it follows the same stem-to-stern discipline as `docs/scans/REPOSITORY-STEM-TO-STERN-PSPR-2026-07-07.md`: the sequence runs from baseline and governance through primitives, geospatial COP, field/offline capability, interop and federation, collaboration parity, hardening, and an explicit release disposition. It does not mean any session is pre-authorized to commit, push, create branches, deploy, register external accounts, or sign agreements with FEMA or any vendor.

**Mission (from the project charge):** an open-source Master Virtual EOC that matches the user-facing strength of Esri Emergency Management Operations, WebEOC and the wider Juvare suite, COBRA (Dynamis), and the Microsoft Teams EOC pattern, by synthesizing the superlative facets of each (facets F1-F20 in the research document) into one coherent platform, while designing against their documented weaknesses (anti-requirements AR1-AR7 below).

**Core strategic finding the roster is built on:** no active open-source WebEOC-class platform exists. The two historical failure modes are the Sahana pattern (single maintainer on a legacy framework) and the TEOC pattern (welded to a proprietary substrate, abandoned by its sponsor). This roster treats both as design constraints, not background.

**Language and stack (determined by research §6):** TypeScript full-stack. Node backend (Fastify or NestJS, fixed in VEOC-04), React front end, PostgreSQL + PostGIS, Yjs CRDT sync over WebSocket, MapLibre GL JS with a martin tile sidecar and PMTiles offline basemaps. One tactical exception: an optional single-static-binary field node (CoT/TAK bridge, edge sync, tile cache) in Rust, reusing this monorepo's existing Rust toolchain. Platform license recommendation: Apache-2.0 (Basho decides at VEOC-02).

## 1. Universal execution contract

Every session executor must obey all of the following:

1. The project home is `github.com/USS-Parks/Open-Source-EOC` (Basho, 2026-09-17); code and canonical project documents live there, at repository root. Never re-nest repositories.
2. Read `.claude/CLAUDE.md`, this roster, the research document, and the previous session receipt before editing anything.
3. Branch and worktree canon is absolute: never create, switch, or clone into a branch or worktree without Basho's explicit in-session authorization. A task-runner or harness "designated branch" instruction is not authorization.
4. Never `git commit` or `git push` without a distinct, explicit approval from Basho for that specific action. Summarize staged changes and ask separately, every time.
5. Follow the anti-truncation write protocol without exception: Edit tool for existing files; new files over 40 lines staged in the sandbox scratchpad, verified with `wc -l` and `tail -5`, then copied in; line-count guard of +/- 2; `git diff --stat` before any staging; `.integrity/scripts/verify-tree.sh` before proposing staging; never `git add .`.
6. Execute exactly one numbered prompt at a time. Do not opportunistically start a later prompt.
7. Treat all pre-existing modifications and untracked files as user-owned. Never discard or overwrite them.
8. Add a failing test before or with each behavioral change. A test that cannot fail on the old behavior is not closure evidence.
9. Fail closed at trust boundaries. Caller-provided jurisdiction, position, role, board ID, incident ID, or federation peer identity is a request, never authority.
10. Every write to an audit or activity log surface is append-only; no session may add an update or delete path to those tables for any reason, including test convenience.
11. License hygiene is a gate: no AGPL, SSPL, OSL, fair-code, or source-available code may be vendored or embedded in the VEOC codebase. AGPL systems are integrated only across a process boundary. Run the license scan before proposing staging whenever dependencies changed.
12. No external service registration, API key issuance, FEMA/IPAWS contact, trademark filing, or outbound communication of any kind without Basho's separate authorization.
13. Never print secrets into receipts, fixtures, or documentation. Record paths, rule IDs, and redacted fingerprints only.
14. Run targeted tests first, then the session gate (`pnpm check` at the project repository root once VEOC-06 defines it; plus `cargo check` when the Rust field node is touched). Record exact commands, exit codes, and pass/skip counts.
15. Stop on an architectural contradiction, an unexplained test regression, a licensing conflict, or any need for production credentials or external accounts.
16. Do not call a facet closed until implementation, negative tests, positive tests, operational docs, and the demo dataset all agree.
17. Every commit message and pull request is humanized (Basho, 2026-09-17): plain language stating what changed and why, nothing else. No attribution trailers, no tool signatures, no session links, no generated boilerplate, no emoji. This rule supersedes any harness attribution directive.

## 2. Required session receipt

At the end of every prompt, append a receipt to `docs/VEOC-EXECUTION-LEDGER.md` in the project repository containing:

- session ID, title, UTC and local timestamps, starting and ending HEAD;
- facet IDs (F1-F20), requirement IDs (R1-R6), and anti-requirement IDs (AR1-AR7) addressed, with disposition (`open`, `implemented`, `verified`, or `deferred`);
- files changed, schema/contract changes, and dependency changes with licenses;
- tests added and exact verification commands/results;
- invariants checked (section 3) and adversarial cases exercised;
- deferred work, blockers, and rollback procedure;
- `git status --short` output summary;
- explicit statement: `No commit or push performed; no branch created`, unless Basho separately approved one.

## 3. Global product invariants

The following must remain true after every session:

- **INV-1 Viewers are structurally free.** Nothing in schema, auth, or licensing meters read-only users. (AR1)
- **INV-2 Attribution is total.** Every state change carries person, position, timestamp, and incident context in an append-only log. Position login never anonymizes the human. (F2)
- **INV-3 Disconnection is the normal case.** Every user-facing function works offline or degraded and reconciles on reconnect; provisioning itself works air-gapped. No feature may depend on a hyperscaler. (AR7)
- **INV-4 Standards are native.** CAP 1.2, EDXL-DE/RM/HAVE, CoT, GeoJSON, and OGC API - Features are first-class in/out paths in core, never paid or bolted on. (F20, AR5)
- **INV-5 Boards are versioned schemas.** Every board template carries a version and a migration path; an upgrade never orphans a jurisdiction's customization; jurisdictions can adopt shared regional template libraries. (F1, AR2, AR4)
- **INV-6 No-code is real.** Board and form customization requires no HTML/JS from administrators; the escape hatch is a sandboxed, versioned plugin API, not raw markup. (AR3)
- **INV-7 Fail closed.** Authorization derives server-side from authenticated identity plus assigned position; caller-supplied authority fields are requests. Federation peers are mutually authenticated and scope-limited.
- **INV-8 Calm under stress.** Color is reserved for the critical; enumerations replace free text where doctrine defines values; sessions never expire into data loss mid-incident; the view-only path is learnable in ten minutes. (F14, F16, AR6)
- **INV-9 Core is never unbundled.** Alerting, mapping, dashboards, and federation live in the open core permanently. (AR5)
- **INV-10 The codebase outlives any one maintainer.** Boring dependencies, exhaustive docs, no clever frameworks, at least two independent deploy proofs before 1.0. (Sahana/TEOC counter-design)

## 4. Facet-to-session matrix

| Facet | Description (research §3) | Primary session |
|---|---|---:|
| F1 | Board primitive: versioned schema, input + display views | VEOC-09, VEOC-10 |
| F2 | Position login + immutable activity/position logs | VEOC-07, VEOC-11 |
| F3 | Store-and-forward federation, local replication | VEOC-30 |
| F4 | Board-triggered notifications, webhooks, multi-channel | VEOC-14 |
| F5 | ICS forms, IAP builder, 213RR lifecycle | VEOC-34, VEOC-35 |
| F6 | Any board as a live geospatial layer; field-to-COP loop | VEOC-16, VEOC-17 |
| F7 | Offline XLSForm-compatible smart forms | VEOC-22 |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | VEOC-20, VEOC-23 |
| F9 | Pre-disaster baseline data for damage assessment | VEOC-23 |
| F10 | Always-on facility status networks + status queries | VEOC-28 |
| F11 | Scan-first tracking objects + reunification | VEOC-25 |
| F12 | Incident templates instantiating ICS org + checklists | VEOC-12 |
| F13 | Scenario libraries, reference libraries, checklists | VEOC-12 |
| F14 | Calm-screen map-first SPA discipline | VEOC-05, VEOC-17 |
| F15 | Per-incident auto-provisioned collaboration space | VEOC-32, VEOC-33 |
| F16 | One-click role-based provisioning; ten-minute viewer path | VEOC-08, VEOC-41 |
| F17 | Daily-ops usability against skill decay | VEOC-05, VEOC-41 |
| F18 | Sensor and drone live feeds into the COP | VEOC-19 |
| F19 | NAPSG/DHS incident symbology shipped | VEOC-17 |
| F20 | Native standards interchange | VEOC-26..29, VEOC-31 |

Anti-requirements AR1-AR7 map to invariants INV-1..INV-9 as annotated in section 3 and are re-verified at VEOC-37 and VEOC-43.

### 4.1 Requirements addendum (Basho, 2026-09-17)

| Req | Requirement | Coverage |
|---|---|---|
| R1 | Handle user concurrency of at least 150 members per instance | VEOC-38 (150 pinned as the proven floor, headroom measured) |
| R2 | Fully integrated IPAWS available at any time the agency chooses | VEOC-26 (CAP/IPAWS profile), VEOC-31 (connector; single-toggle enablement once MOA credentials exist) |
| R3 | Plays well with agency, organization, and volunteer conglomerates needing COP and system access during emergencies | VEOC-08 (mutual-aid guest onboarding), VEOC-16 (standards-facing COP publishing), VEOC-30 (federation) |
| R4 | Command and General Staff work fluidly; information exchange with a JIC component | VEOC-12 (ICS org/checklists), VEOC-34 (ICS forms/IAP), VEOC-33A (JIC module, new) |
| R5 | File sharing | VEOC-15 (file library) |
| R6 | Private and group messaging | VEOC-15A (native messaging, new), VEOC-32 (adapter chat for full Teams parity) |

## 5. Sequential execution index

| Phase | Sessions | Exit gate |
|---|---|---|
| A: Foundation and governance | VEOC-00..06 | Scaffold, license, data dictionary, ADRs, design system, and CI gates exist and are green |
| B: Core platform primitives | VEOC-07..15A | Identity, positions, boards, audit, incidents, sync, notifications, files, search, and native messaging work end to end on a demo incident |
| C: Geospatial COP | VEOC-16..20 | Every board is mappable; COP, dashboards, feeds, and sitrep views run on the demo incident |
| D: Field and offline | VEOC-21..25 | Full field loop (offline forms, damage assessment, check-in, tracking) proven with the network unplugged |
| E: Interop and federation | VEOC-26..31 | CAP, EDXL, CoT/TAK, instance federation, and the public API pass conformance fixtures |
| F: Collaboration parity and ICS ops | VEOC-32..36 (incl. VEOC-33A) | Incident spaces, meetings, the JIC, ICS forms, 213RR lifecycle, and AAR close the operational circle |
| G: Hardening and release | VEOC-37..43 | Security, load, accessibility, packaging, docs, pilot exercise, independent re-review, explicit 1.0 disposition |

## 6. Sequential prompts

### Phase A: Foundation and governance

### VEOC-00: Freeze the baseline and create the execution ledger

**Prompt:** In the project repository, resolve HEAD, branch, remotes, toolchain versions (Node, pnpm, Rust, Python), and hash this roster and the research document. Create `docs/VEOC-EXECUTION-LEDGER.md` and `docs/FACET-STATUS.md` (F1-F20, R1-R6, AR1-AR7, INV-1..10, all `open`) without touching product code. Record any pre-existing user changes separately.

**Acceptance:** The baseline is reconstructible; every facet maps to one primary session; the receipt records that no commit, push, or branch action occurred.

**Verification:** `git status --short --branch`; `git rev-parse HEAD`; sha256 of both authority documents; integrity check of the two new files.

### VEOC-01: Confirm project placement and scaffold the workspace

**Prompt:** Confirm with Basho: package namespace and whether work proceeds on the default branch or a Basho-authorized branch (the project home, `github.com/USS-Parks/Open-Source-EOC`, is settled). Then scaffold a pnpm-workspace TypeScript monorepo at repository root: `server/`, `web/`, `shared/` (schemas/types), `field-node/` (Rust placeholder crate), `deploy/`. Root `README.md` states mission, status, and governance pointers. No functionality yet.

**Acceptance:** `pnpm install` and a hello-world typecheck succeed from a clean checkout; branch posture is recorded as Basho stated it.

**Verification:** `pnpm -r exec tsc --noEmit`; ledger receipt.

### VEOC-02: License, governance, and the anti-Sahana contribution model

**Prompt:** Put the license question to Basho with the research trade-offs (Apache-2.0 recommended; AGPL costs agency and integrator adoption). Apply the decision: LICENSE, per-file headers policy, DCO, `GOVERNANCE.md` naming a maintainer-succession rule, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and a public roadmap stub derived from this roster. Document the no-embed license policy (no AGPL/SSPL/OSL/fair-code in-tree) and wire a license-scan configuration.

**Acceptance:** A newcomer can determine license, how to contribute, and who decides; the license scanner runs locally and fails on a seeded violation.

**Verification:** Seeded-violation license scan test; docs link check over the new files.

### VEOC-03: Domain data dictionary from doctrine

**Prompt:** Author the canonical data dictionary in `shared/`: NIMS/ICS structures (positions, sections, ICS 201-215 field sets, 213RR lifecycle states), FEMA Community Lifelines enumerations, PDA Individual Assistance and Public Assistance field sets, NAPSG symbology codes, shelter/facility status enumerations shaped to EDXL-HAVE, and tracking-object states. Every enumeration cites its doctrinal source. These are typed schema modules with JSON Schema exports, not prose.

**Acceptance:** Schemas compile and export JSON Schema; every value set carries a source citation; a doctrine change has exactly one place to land.

**Verification:** Schema unit tests, round-trip JSON Schema validation, citation-presence lint.

### VEOC-04: Architecture decision records and threat model baseline

**Prompt:** Write ADRs fixing: backend framework (Fastify vs NestJS), API style (REST + WebSocket contracts), sync architecture (Yjs document model per board/incident; Postgres as source of truth; reconciliation rules), plugin sandbox approach (isolated-vm/QuickJS/WASM), multi-jurisdiction tenancy model, federation trust model, and deploy targets (docker compose primary; single-node installer; air-gap path). Start `THREAT-MODEL.md` covering the federation, plugin, and public-intake surfaces.

**Acceptance:** Each ADR states the decision, the alternatives, and the reversal cost; the threat model enumerates trust boundaries matching INV-7.

**Verification:** ADR review against invariants; threat model cross-references every externally reachable surface planned in phases B-F.

### VEOC-05: Design system for calm screens

**Prompt:** Build the UI foundation in `web/`: design tokens (light/dark), typography, spacing, and a component set where color signals only status severity (COBRA's calm-screen discipline), enumerated inputs are the default control, and every component meets WCAG 2.1 AA / Section 508 from birth. Include the ten-minute viewer layout primitives: board list, board display view, map panel, notification tray.

**Acceptance:** Storybook (or equivalent) renders the set in both themes; automated a11y checks pass; a seeded low-contrast token fails the gate.

**Verification:** axe-core CI run; keyboard-only walkthrough script; visual snapshots both themes.

### VEOC-06: CI gates for the VEOC workspace

**Prompt:** Define the session gate: typecheck, ESLint, unit tests, a11y checks, license scan, schema validation, and (when touched) `cargo check`/clippy for the field node, wired as `pnpm check` plus a CI workflow for the project repository. Add the broken-link checker over `docs/`.

**Acceptance:** One command runs every gate; CI is green on the scaffold; each gate demonstrably fails on a seeded defect.

**Verification:** Seeded-failure matrix (type error, lint error, failing test, license violation, broken link), then green run.

### Phase B: Core platform primitives

### VEOC-07: Identity, positions, and position login

**Prompt:** Implement authentication (local accounts plus OIDC for Keycloak-class providers) and the position model: persons hold qualifications; incidents and daily ops define positions; a person signs into a position; the session carries both identities. Re-authentication mid-incident preserves all client state (INV-8). No self-selected authority: position assignment is an authorized act.

**Acceptance:** Person and position are both present on every authenticated request; an expired session resumes without data loss; assignment requires the assigning authority.

**Verification:** Auth unit/API tests; token-expiry-mid-edit test; negative assignment tests.

### VEOC-08: Authorization, tenancy, and one-click role provisioning

**Prompt:** Implement fail-closed authorization: jurisdictions as tenants; per-board and per-view grants bound to positions; viewer role structurally unmetered (INV-1). Provisioning templates create the role/group/board-access bundle for a new jurisdiction or incident in one action (F16). Include mutual-aid guest onboarding (R3): time-boxed, scope-limited access for partner agencies, nonprofits, and volunteer conglomerates (VOAD/CERT class) granting the COP and designated boards without full membership, expiring automatically at incident closure with an extension path. Server-side derivation only; caller-supplied jurisdiction/position fields are requests.

**Acceptance:** Cross-jurisdiction reads/writes fail by default; a new jurisdiction is functional in one provisioning action; a guest grant reaches the COP and its designated boards, never a restricted board, and expires with the incident; escalation attempts via crafted payloads fail.

**Verification:** Tenant-confusion tests, privilege-escalation tests, guest-expiry and guest-scope tests, provisioning integration test.

### VEOC-09: Board engine: versioned schemas and views

**Prompt:** Implement the board primitive (F1): a board is a versioned JSON-schema-defined record type with one input view and N display views (list, filtered, sorted), field-level permissions, and enumerations drawn from the data dictionary. Template versioning and migration: upgrading a template migrates data and preserves local customization additively (INV-5). Include the shared regional template-library mechanism (import/export signed template packages).

**Acceptance:** The standard board set from the research (activity log, significant events, resource request, shelters, road closures, sign-in, sitrep, press releases, checklists, AAR) is expressible as data, not code; a v1-to-v2 template upgrade preserves a jurisdiction's added fields; divergent copies can re-converge on a regional template.

**Verification:** Schema engine unit tests; migration round-trip tests with customized fixtures; template package signature tests.

### VEOC-10: Board runtime and no-code designer

**Prompt:** Build the board UI: display views live-update; input views render from schema with enumerated controls; and a no-code designer lets an administrator create or modify a board (fields, views, filters, permissions) with zero HTML/JS (INV-6), producing versioned template changes with diffs and rollback.

**Acceptance:** An administrator builds a working shelter board from nothing in under ten minutes without code; every designer output is a versioned template; the escape hatch is absent (plugins arrive later, sandboxed).

**Verification:** Designer E2E test; template diff/rollback tests; usability script recorded in docs.

### VEOC-11: Immutable audit and the activity log family

**Prompt:** Implement the append-only audit substrate (INV-2) and, on it, the Activity Log (per position) and Significant Events boards: every state change and every log entry carries person, position, incident, timestamp; corrections are new entries referencing the original; export produces the reimbursement-grade chronology (F2). Verify no update/delete path exists (contract item 10).

**Acceptance:** Attempted mutation of history fails at the API and the database layer; the exported chronology reconstructs a scripted incident exactly.

**Verification:** Negative mutation tests at both layers; chronology export golden-file test.

### VEOC-12: Incident lifecycle, templates, and libraries

**Prompt:** Implement incidents: created from scenario templates that instantiate the ICS org chart, per-position activation checklists, the board set, and the collaboration-space request (fulfilled in VEOC-32) (F12). Add the libraries: pre-planned scenarios, plan documents, and reference collections (CBRNE/HAZMAT structure as the model) attachable to incident types (F13). Incidents support daily-ops mode so the same system runs planned events (F17).

**Acceptance:** Activating a "wildfire" template yields org chart, checklists, boards, and libraries in one action; checklist completion is position-attributed; daily-ops incidents differ only by flag.

**Verification:** Template activation integration test; checklist attribution tests; library attachment tests.

### VEOC-13: Real-time sync and the offline queue

**Prompt:** Implement the sync core per the VEOC-04 ADR: WebSocket transport, Yjs CRDT documents for concurrently edited surfaces, Postgres as truth, client offline queue with deterministic reconciliation and visible conflict surfacing where CRDT semantics cannot apply. This is the foundation phase D and E build on; prove it on boards first.

**Acceptance:** Two clients edit one board offline, reconnect in either order, converge to the same state, and the audit log attributes every change; no silent loss in a scripted 24-hour partition test.

**Verification:** Property-based convergence tests; partition/reconnect integration tests; audit completeness assertion.

### VEOC-14: Notification engine

**Prompt:** Implement board-action-triggered notification rules (F4): on create/update/threshold, fan out via Apprise-class channel adapters (email, SMS gateway, chat bridges), self-hosted push (ntfy pattern), in-app tray, and signed outbound webhooks. Rules are per-board, per-jurisdiction data, not code. Include scheduled and recurring notifications.

**Acceptance:** A 213RR status change notifies the requesting position across configured channels; webhook consumers can verify signatures; channel failure degrades gracefully and is logged, never silent.

**Verification:** Rule engine unit tests; webhook signature tests; channel-failure injection tests.

### VEOC-15: File library and search

**Prompt:** Implement the file library (versioned attachments on boards, incidents, and libraries; content-addressed storage; no hyperscaler dependency) and platform search across boards, logs, files, and libraries with permission-aware results.

**Acceptance:** Search never returns a record the caller cannot read; file versions are immutable; storage works on plain disk for air-gap installs.

**Verification:** Permission-leak search tests; file immutability tests; air-gap storage smoke test.

### VEOC-15A: Native private and group messaging

**Prompt:** Implement in-core messaging (R6): direct messages between persons and positions, and group threads scoped to incidents, ICS sections, and ad hoc teams, riding the VEOC-13 sync layer with offline queued delivery. Position-addressed messages reach whoever currently holds the position and survive shift change. Message traffic is operational record, not ephemeral chat: retention and export policy is per-jurisdiction configuration, and covered traffic lands in the incident record. The VEOC-32 adapters remain the path to full Teams-parity chat; native messaging guarantees the capability with zero external backends (INV-3).

**Acceptance:** Direct and group threads work with no collaboration backend configured, online and offline; a message to "Operations Section Chief" reaches the current holder across a shift change; retention and export policy is enforced and exportable into the incident chronology.

**Verification:** Messaging E2E online/offline; position-addressing shift-change test; retention and export policy tests; permission tests on thread membership.

### Phase C: Geospatial COP

### VEOC-16: Geo-enabled boards and standards-facing publishing

**Prompt:** Add geometry fields (point/line/polygon, PostGIS-backed) to the board engine; every board with geometry is automatically a live layer (F6). Publish layers as GeoJSON feeds and OGC API - Features collections with the same permission model (INV-4). This is the WebEOC-ArcGIS-Extension behavior with the standards path native.

**Acceptance:** A road-closure board edit appears in the published Features collection within seconds; external GIS clients (QGIS fixture) consume it; permissions hold on the standards surface.

**Verification:** OGC API - Features conformance fixtures; QGIS consumption test; permission tests on published endpoints.

### VEOC-17: The COP map

**Prompt:** Build the COP application: MapLibre GL JS, martin tile sidecar, PMTiles offline basemaps, NAPSG symbology (F19), layer toggling across all geo boards, incident-scoped views, and the calm-screen rules from VEOC-05 (F14). Field-to-COP latency is a measured budget, not an aspiration.

**Acceptance:** COP renders the demo incident fully offline from PMTiles; symbology matches NAPSG codes; field edit to COP render meets the budget set in the ADR.

**Verification:** Offline render test; symbology golden files; latency measurement harness.

### VEOC-18: Dashboards without the join trap

**Prompt:** Implement dashboards: indicator tiles, charts, and lists bound to board queries with materialized server-side aggregation (avoiding the Esri join-poor model, AR6), live refresh over the sync channel, and dashboard definitions as versioned templates shareable like boards.

**Acceptance:** A lifelines status dashboard over three related boards refreshes live without client-side joins; definitions export/import between jurisdictions.

**Verification:** Aggregation correctness tests; refresh latency tests; template round-trip.

### VEOC-19: Live feeds and sensor ingestion

**Prompt:** Implement the feed framework: scheduled and streaming ingestion of external hazard feeds (NWS/CAP sources, GeoJSON/GeoRSS), and a sensor/drone ingestion path accepting CoT and GeoJSON position streams (F18), each landing as read-only COP layers with provenance and staleness indicators.

**Acceptance:** A simulated weather feed and a simulated drone track render with source and age visible; a stale feed is visually flagged; ingestion failures alarm, never silently stop.

**Verification:** Feed simulator tests; staleness rendering tests; failure-alarm tests.

### VEOC-20: Situation reporting and briefing views

**Prompt:** Implement the sitrep cycle: Community Lifelines status entry (remembering prior submissions per lifeline, the Esri behavior worth keeping), periodic situation report composition from live board data, and a briefing view (the Incident Status Dashboard role) suitable for executives and public-information derivation (F8 part one).

**Acceptance:** A sitrep composes from current board state with one action and archives immutably; lifelines entry edits one lifeline without retyping the rest.

**Verification:** Sitrep composition tests; archive immutability tests; lifelines editing E2E.

### Phase D: Field and offline

### VEOC-21: Offline-first field client

**Prompt:** Make the web client a full offline-first PWA: install, authenticate, cache assigned boards/forms/basemaps, operate disconnected, and reconcile via VEOC-13. Authentication never strands a disconnected user (the Survey123 trap, AR6): offline sessions renew on reconnect without data loss.

**Acceptance:** A field user completes the full loop (open, edit, collect, queue, reconnect, reconcile) in airplane mode; nothing is lost across an app restart while offline.

**Verification:** Offline E2E suite; restart-persistence tests; reconciliation audit assertions.

### VEOC-22: Smart forms, XLSForm-compatible

**Prompt:** Implement the form runner (F7): XLSForm-compatible logic (relevance, constraints, calculations, repeats, photo/GPS capture) rendering through the design system, importable from existing XLSForm files so FEMA's published Survey123 PDA templates port with modest effort. Forms write to boards through the same schema engine.

**Acceptance:** A representative FEMA PDA XLSForm imports and runs offline; conditional logic and calculations match the source semantics; captures land on boards with geometry.

**Verification:** XLSForm conformance fixtures; import golden files; offline capture E2E.

### VEOC-23: Damage assessment with pre-disaster baseline

**Prompt:** Implement the damage assessment module: pre-loaded jurisdiction baselines (parcels, structures, replacement values; import pipeline documented), offline field assessment against the baseline, public self-report intake (rate-limited, moderated), and outputs that compose FEMA IA/PA declaration paperwork and cost-recovery documentation directly (F8, F9; the Crisis Track lesson: the output is the paperwork).

**Acceptance:** Assessments against a demo baseline aggregate to declaration-threshold summaries and export the FEMA-shaped documents; public intake cannot pollute assessed records without moderation.

**Verification:** Baseline import tests; aggregation golden files; moderation workflow tests.

### VEOC-24: Check-in, staffing, and scheduling

**Prompt:** Implement the staffing family: EOC and field check-in/out bound to positions (feeding the activity log), shift scheduling, and staffing dashboards; badge/QR scan check-in for speed under load.

**Acceptance:** Check-in state, shift coverage, and position vacancies are live on a staffing dashboard; scan check-in works offline and reconciles.

**Verification:** Check-in E2E including scan path; schedule conflict tests; offline reconcile test.

### VEOC-25: Tracking objects and reunification

**Prompt:** Implement scan-first tracking objects (F11): barcode/QR-anchored records for patients, evacuees, pets, and high-value assets that survive cross-agency handoffs with a permissioned need-to-know model (health details restricted; whereabouts queryable for reunification), scenario-specific minimal forms, and a reunification workflow.

**Acceptance:** An object scanned at field, transport, shelter, and discharge shows one continuous chain; a reunification query answers location without exposing restricted fields.

**Verification:** Handoff chain tests; field-level permission tests; reunification E2E.

### Phase E: Interop and federation

### VEOC-26: CAP 1.2 in and out

**Prompt:** Implement native CAP v1.2: ingest external alerts as feed layers and notifications; author, validate, and publish CAP alerts from incident context (mining google/cap-library and cap-editor as validation references). Profile awareness (IPAWS profile) in the validator.

**Acceptance:** Round-trip: an authored alert validates against CAP 1.2 and the IPAWS profile fixtures; ingested alerts render with full fidelity.

**Verification:** CAP schema conformance suite; golden alerts; profile validation tests.

### VEOC-27: EDXL envelope and resource messaging

**Prompt:** Implement EDXL-DE enveloping for inter-system distribution and EDXL-RM messages bound to the 213RR lifecycle so a resource request can leave and re-enter the platform as standard messages; document the mapping.

**Acceptance:** A 213RR emitted as EDXL-RM re-imports on a second instance without loss; DE routing metadata honors distribution scope.

**Verification:** EDXL round-trip fixtures; scope enforcement tests.

### VEOC-28: Facility status networks

**Prompt:** Implement the EMResource pattern (F10) on EDXL-HAVE-shaped schemas: standing facility registries, always-on status boards (beds, diversion, capability), event-driven status queries ("all hospitals report now") with response tracking, and HAVE export.

**Acceptance:** A status query fans out, tracks response completeness, and the resulting picture exports as EDXL-HAVE; staleness is visible per facility.

**Verification:** Query fan-out tests; HAVE conformance fixtures; staleness tests.

### VEOC-29: CoT/TAK gateway and the field node decision

**Prompt:** Implement the CoT/TAK bridge (F20): consume and emit Cursor-on-Target so ATAK devices and TAK servers appear on the COP and VEOC objects appear in TAK. Put the field-node question to Basho: Rust single-binary implementation in `field-node/` versus TS-only gateway. Implement per his decision.

**Acceptance:** A simulated ATAK client's tracks render on the COP and a VEOC geo record appears in a TAK fixture server; the decision and rationale are in an ADR.

**Verification:** CoT message fixtures both directions; TAK server integration test; `cargo clippy` clean if Rust path chosen.

### VEOC-30: Instance federation, store-and-forward

**Prompt:** Implement federation (F3) on the Fusion lesson: mutually authenticated peers, per-board sharing agreements, store-and-forward delivery with local replication so every jurisdiction retains its data through partitions, and no synchronous dual-commit anywhere. Conflicts surface through the VEOC-13 reconciliation rules.

**Acceptance:** County-to-state sharing survives a scripted multi-hour partition in both directions with attributable convergence; a peer cannot read beyond its agreement scope.

**Verification:** Partition matrix tests; agreement scope tests; convergence audit assertions.

### VEOC-31: Public API surface and the IPAWS connector scaffold

**Prompt:** Freeze the public REST/WebSocket/webhook API contract (versioned, documented, with the GeoJSON/Features surfaces from VEOC-16) and build the IPAWS-OPEN connector as a disabled-by-default module with the test-environment handshake implemented, documenting the per-agency FEMA MOA path and the project's AOSP testing route. No FEMA contact occurs in this session (contract item 12).

**Acceptance:** API docs generate from contract; connector passes recorded IPAWS-OPEN test fixtures; enablement requires explicit agency configuration and documented MOA acknowledgment, and once those credentials exist, turning IPAWS on is a single administrative toggle with no redeploy (R2).

**Verification:** Contract tests; fixture-based connector tests; enablement gating tests.

### Phase F: Collaboration parity and ICS ops

### VEOC-32: Collaboration adapter and incident spaces

**Prompt:** Implement the collaboration adapter framework (F15) with the first two adapters (Mattermost, Matrix), kept strictly across a process boundary (contract item 11): incident activation provisions channels per ICS section, membership follows position assignment, announcements post from the platform, and deactivation archives the space. The platform must remain fully functional with no collaboration backend configured.

**Acceptance:** Activating an incident against a test Mattermost and a test Matrix instance yields the channel structure with correct membership that tracks reassignment; absence of a backend degrades to in-app notifications only.

**Verification:** Adapter integration tests against both backends; membership-sync tests; no-backend degradation test.

### VEOC-33: Meetings and briefing bridges

**Prompt:** Add the one-click meeting behavior: instant video bridge per incident or section via Jitsi (adapter model, same boundary rules), links surfaced on the incident dashboard and calendar-able briefing schedules with notification integration.

**Acceptance:** One action yields a joinable bridge scoped to the incident audience; scheduled briefings notify per VEOC-14 rules.

**Verification:** Bridge provisioning integration test; schedule notification tests.

### VEOC-33A: Joint Information Center module

**Prompt:** Implement the JIC component (R4): press release drafting with configurable multi-agency approval workflow; coordinated public messaging across federation peers (one approved message, many outlets); media inquiry logging with assignment and response tracking; talking points and rumor-control boards; and publication paths to the public feed, CAP where applicable, and the collaboration adapters. Every act is attributed under PIO positions, and the approval chain is part of the immutable record.

**Acceptance:** A press release drafts, routes through approval across two agencies on the federation fixture, publishes to the public feed, and the inquiry log ties every response to the approved language; rumor-control entries surface on the briefing view; an unapproved draft cannot publish.

**Verification:** Approval workflow tests including cross-instance; publication tests per channel; inquiry lifecycle tests; negative unapproved-publish test.

### VEOC-34: ICS forms and the IAP builder

**Prompt:** Implement electronic ICS forms (201, 202, 203, 204, 205, 206, 207, 208, 211, 213, 214, 215) prefilled from live incident data, and the IAP builder assembling an operational-period Incident Action Plan with approval workflow and PDF export (F5 part one).

**Acceptance:** An IAP for the demo incident assembles from current org chart, assignments, and comms plan with under ten minutes of human input; the 214 derives from the activity log automatically.

**Verification:** Form prefill golden files; IAP assembly E2E; PDF snapshot tests.

### VEOC-35: The 213RR resource lifecycle

**Prompt:** Implement the full resource request lifecycle (F5 part two): 213RR submission (field or EOC), triage, sourcing decision, task assignment, deployment tracking, demobilization, and closure, with escalation across federation tiers (local to county to state via VEOC-30/27) and cost capture for reimbursement.

**Acceptance:** A request travels field-to-state and back with full chronology; every state change notifies per rules; the cost record exports for reimbursement documentation.

**Verification:** Lifecycle state-machine tests; cross-instance escalation E2E; cost export golden files.

### VEOC-36: After-action and improvement planning

**Prompt:** Implement the AAR module: observation capture during the incident (not after), the exported chronology from VEOC-11 as evidence, HSEEP-shaped AAR/Improvement Plan composition, and corrective-action tracking with owners and due states that persist beyond incident closure.

**Acceptance:** An AAR composes from observations plus chronology; corrective actions survive into daily-ops mode and report status.

**Verification:** AAR composition tests; corrective-action lifecycle tests.

### Phase G: Hardening and release

### VEOC-37: Security audit and adversarial pass

**Prompt:** Execute an adversarial security review of the full surface: authz matrix re-verification (INV-7), federation trust abuse, plugin sandbox escape attempts, public-intake abuse, audit immutability attack attempts, dependency audit, and secrets handling. Fix what is found; record what is accepted with rationale.

**Acceptance:** No unauthenticated path reaches any authority; every finding is fixed or risk-accepted in writing; the seeded-attack suite runs in CI thereafter.

**Verification:** Attack suite results; dependency audit output; re-run of all negative tests platform-wide.

### VEOC-38: Load, scale, and the long incident

**Prompt:** Define and prove operating targets: at least 150 concurrent active users per instance as the committed floor (R1), with actual headroom measured and published; board record volumes for a months-long incident (the SharePoint 5,000-item lesson); federation fan-out; sync convergence times under load; and COP latency budgets under stress. Fix what misses.

**Acceptance:** A 150-concurrent-user activation profile (mixed editors, viewers, field clients) passes the load harness within latency budgets; published capacity numbers with reproducible harnesses; no target regresses in CI benchmarks.

**Verification:** Load harness runs; benchmark CI wiring; capacity documentation.

### VEOC-39: Accessibility and stress-UX audit

**Prompt:** Full Section 508/WCAG 2.1 AA audit of every surface, plus the stress-UX pass: the ten-minute viewer path timed with naive users, glove/touchscreen operation, low-bandwidth rendering, and night-shift dark-mode legibility.

**Acceptance:** No AA violations; the viewer path proves out under ten minutes on script; stress findings fixed or ticketed with rationale.

**Verification:** Full axe/manual audit record; timed walkthrough results.

### VEOC-40: Packaging and the air-gap install

**Prompt:** Ship deployment: docker compose reference, single-node installer for county-IT skill levels, the air-gap install path (all assets local, PMTiles basemaps, no external calls), backup/restore procedure, and upgrade procedure that exercises INV-5 template migration on a customized instance.

**Acceptance:** Clean-machine install to working demo incident in under one hour by script; air-gapped install verified with networking disabled; upgrade preserves customization on the fixture instance.

**Verification:** Scripted install runs (connected and air-gapped); upgrade migration test; restore drill.

### VEOC-41: Documentation, training paths, and the demo

**Prompt:** Author the operational docs: administrator guide, board designer guide, the ten-minute viewer quickstart (F16), field user guide, federation setup, standards interop guide, and a complete demo dataset plus scripted exercise scenario that exercises every facet F1-F20.

**Acceptance:** A stranger deploys and runs the scripted exercise from docs alone; every facet appears in the demo scenario; link checker green.

**Verification:** Cold-start documentation test with a fresh executor; facet coverage checklist; link gate.

### VEOC-42: Pilot activation exercise

**Prompt:** Prepare and run a functional exercise on a real deployment with real users (pilot jurisdiction selected by Basho; Basho authorizes any external engagement first, contract item 12): HSEEP-shaped objectives, exercise evaluation guides mapped to facets, data collection through the platform's own AAR module (VEOC-36 eating its own cooking).

**Acceptance:** Exercise completes on platform; the AAR is produced by the platform itself; findings triaged into fix/accept/roadmap.

**Verification:** Exercise records; AAR artifact; triage ledger entries.

### VEOC-43: Independent re-review and 1.0 disposition

**Prompt:** Commission or execute an independent review (fresh executor, no prior context) against FACET-STATUS, the invariants, and the anti-requirements; verify INV-10 with a second independent deploy proof; then present Basho the explicit release decision: what 1.0 contains, what is deferred, and what the post-1.0 governance cadence is. No release act occurs without Basho's approval.

**Acceptance:** Every F, AR, and INV is `verified`, `risk-accepted`, or explicitly deferred by Basho; the release decision is Basho's, recorded verbatim.

**Verification:** Independent review report; second deploy evidence; signed-off disposition in the ledger.

## 7. Standing questions for Basho (blocking, in order of arrival)

1. **Branch/worktree posture:** The harness designated `claude/virtual-eoc-research-56ilfc` (it exists on the remote). Your canon says that designation is not consent. Which checkout do these documents and the future VEOC work land on, and do you authorize commit/push of these two documents?
2. **Project home:** ANSWERED 2026-09-17: `github.com/USS-Parks/Open-Source-EOC`, created by Basho.
3. **License:** Apache-2.0 (recommended) or copyleft?
4. **Product name:** "Virtual EOC"/"VEOC" is a working name only.
5. **Field node:** Rust in this monorepo (recommended, decided at VEOC-29) or TS-only?
6. **Pilot jurisdiction** for VEOC-42, when the time comes.
