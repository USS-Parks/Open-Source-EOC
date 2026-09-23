# OpenEOC 1.0 Finish PSPR

**Created:** 2026-09-22
**Author:** Basho Parks
**Status:** DRAFT, AWAITING BASHO'S APPROVAL. No unit executes until Basho
says so. Drafting this document is not approval to run it.
**Baseline:** `main` at `7b69b67` with the `W1.8` landing uncommitted in the
working tree. Audit of record: `STATUS-AUDIT-2026-09-22.md`.

## 0. What this document does

This is the single finish-line roster for version 1.0. It replaces the stack
of five partially overlapping rosters that the 2026-09-22 audit found, because
that stack is itself one of the defects being fixed: 964 KB and 9,764 lines of
planning documents governing a product whose server is 20,576 lines of source.

On approval, `W1.12` moves these into `docs/process/archive/` with a
supersession header on each and rewrites the authority section of `CLAUDE.md`
to name this document alone.

| Document | Disposition |
|---|---|
| `VIRTUAL-EOC-PSPR-2026-09-17.md` | Archive. Historical. Its 46 prompts are all receipted. |
| `VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` | Keep in place. Research basis, not a roster. |
| `VEOC-PARITY-CONTINUATION-2026-09-20.md` | Archive, except rows 24 and 25, quoted in `W7` here. |
| `VEOC-DESIGN-PSPR-2026-09-20.md` | Archive, except its D33 to D35 prompts, quoted in `W7` here. |
| `MASTER-PSPR-2026-09-21.md` | Archive. Its authority register and execution model carry forward in sections 1 and 8. |
| `V1-PSPR-2026-09-22.md` | Archive. Its open units are restated in full in section 5 with their IDs unchanged. |
| `VEOC-77-HANDOFF-PSPR-2026-09-20.md` | Archive. Complete. |

Unit IDs are inherited verbatim from the V1 PSPR so that every receipt already
in the ledger still resolves. Units added by the audit take the next free
number in their wave. Nothing is renumbered.

## 1. Approval state and authority

- **This plan is not approved.** Sections 2 through 10 describe work to be
  authorized, not work in progress.
- On approval, the authority register carried by the Master PSPR and the V1
  PSPR carries forward unchanged: the standing fan-out and zipper grant, the
  FOUO access model, the canonical style bible in
  `docs/design/canonical-references/`, the 18 California ESFs, the commit
  message canon in `CLAUDE.md`, and the rule that Basho alone gives aesthetic
  and functional acceptance.
- **A0, the standing execution grant,** carries the shape the V1 PSPR gave it:
  full STS with commit, linear landing and fast-forward push authority for
  every unit that passes its gate, for the approving session.
- **Standing instruction, Basho, 2026-09-22, carried forward: do not stop to
  ask.** Execution does not pause for per-unit approval. The default written
  on each decision row is in force until Basho overrides it in a session. A
  unit records the default it used in its receipt and proceeds.
- External actions of every kind (registration, credential issuance, outbound
  send, data acquisition, FEMA or vendor contact) and release tagging remain
  separately gated. Units that depend on them work around the absence and
  record it rather than waiting.

## 2. Goal, scope, non-goals, completion

**Goal.** Take the tree from technical completion of the earlier rosters to a
version 1.0 that meets every gate in section 6, without weakening any existing
gate, authorization rule or attribution, without a merge commit on `main`, and
without deleting working code Basho has not agreed to cut.

**Scope.** The seven waves of section 5. Closing the four defects the
2026-09-22 audit added is wave `W1`.

**Non-goals.** No absolute-parity claim beyond the wording `86+D35` carries.
No public or anonymous facet; the FOUO decision stands. No outbound fetch,
registration or credential use without Basho's separate word. No replacement
framework and no second engine where a seam already exists. No horizontal
scaling beyond an explicit single-node declaration unless Basho takes the
shared-store option in section 7. No native mobile application; the PWA is the
mobile story for v1. No rewrite of the frozen ledger.

**Completion.** Every unit has a receipt whose acceptance is met or whose
blocker is named, with evidence level stated. Every section 6 gate is green or
waived by Basho in writing. The parity matrix, the facet register and the
design-to-capability matrix agree with the receipts. `86+D35` presents one
release decision. Lane worktrees and branches are removed. Pushing and tagging
stay Basho's call throughout.

## 3. What the audit of 2026-09-22 added

Four units no earlier roster carried, plus one release-time decision.
Everything else the audit found was already owned by an open V1 unit and is
restated in section 5 under its existing ID.

1. **`W1.11`, the in-flight landing.** `W1.8` is receipted in the frozen ledger
   under "V1 W1.8: replace the pre-release migration chain with a guarded
   baseline" but its tree is uncommitted: the staged baseline migration, 54
   deleted migration files and four modified documents. Nothing starts first.
2. **`W1.12`, the roster stack.** Five live rosters, listed in section 0.
3. **`W1.13`, the ledger.** `VEOC-EXECUTION-LEDGER.md` is 398 KB and 5,149
   lines in one file. Receipts cite it by line number, so it is frozen, not
   trimmed, and this plan opens a new one beside it.
4. **`W1.14`, test mass.** `server/` carries 23,472 lines of test against
   20,576 lines of source across 97 test files. The cause is per-session
   acceptance suites accumulating rather than consolidating. This unit
   consolidates duplicates under a coverage floor. It does not cut coverage.
5. **`W6.6`, the gated modules.** 1,954 lines register no routes by default
   after `W1.3` and `W1.4`: `collab` 810, `meetings` 514, `facilities` 327,
   `tracking` 303. The release needs one stated disposition: ship gated, or
   cut with the reversal path recorded.

The audit also flagged the untracked material at the repository root
(`Reference Screenshots/`, `docs/design-previews/`, the parity audit, the
handoff, 7.8 MB in total). That is **not** a unit. Hazard HZ-D already governs
it: it is Basho's own material and no session stages, moves or deletes it.

## 4. Standing rules and hazards

Carried forward from the V1 PSPR section 6, unchanged except where noted.

- **HZ-A, the autoformat hook.** `~/.claude/hooks/autoformat.sh` walks up from
  the edited file to find prettier and can apply the home `.prettierrc`
  (single quotes, no semicolons). Closed by `W0.1`: the hook resolves the
  touched file's git root and supplies that repository's `.prettierignore`,
  and the pre-commit gate rejects a staged file whose quote style flips.
- **HZ-B, no roster identifiers in shipped source.** Closed by `W0.1`: the
  pre-commit gate scans staged additions for `VEOC-nn`, `Dnn`, `Wn.n`, `Mn`,
  `81c` and `P-` prefixes in comments and test titles, not in data. CANON
  section 11 is the doctrine behind it.
- **HZ-C, cluster discipline.** Never stop or restart the shared test cluster
  during a run. Milestone gates run `--maxWorkers=1` with the `gate` tag. A
  timeout in `freshDb()` is retried once in isolation before it is called red.
- **HZ-D, two actors on one checkout.** Basho's sessions produce untracked
  material at the root. Never stage it. See section 3.
- **HZ-E, protected scratch.** Lane worktree A holds `work/d05`, about 214 MB
  generated. Its disposition is a Basho decision, not a delete.
- **HZ-F, the deliverable weighs 1.2 GB.** `web/public` carries the
  California, buildings and overlay archives, generated and ignored. Any unit
  that touches the static host keeps byte-range serving intact or the map goes
  blank.
- **HZ-G, new.** This plan retires documents that other documents cite by
  path. `W1.12` repairs every inbound link in the same commit as the move, and
  the docs link checker is the gate on it.

## 5. The roster

Sizes: S under a day of agent work, M about a day, L two to three, XL more and
therefore split. "Owns" is the file territory for the zipper's no-overlap
check. Units within a wave are in priority order. Cross-wave dependencies are
named. `W0` is complete and is not restated; its six units are receipted.

### W1. Cut, consolidate, and land what is in flight

Runs one unit at a time in the canonical checkout, because these units move
files other units own. `W1.0` through `W1.8` are complete.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W1.11` | Land the in-flight `W1.8` tree: verify the baseline migration round-trips against a fresh database, stage the deletions individually, inspect `git diff --cached --stat`, commit, and confirm `main` is linear. Acceptance: a clean `git status` and a green migrate-from-empty run | none | `server/migrations/**`, `server/src/db/migrate.ts`, the four modified documents | S |
| `W1.9` | Client and console leftovers: remove the two navigation entries that render an unavailable panel (`Console.tsx` 646 Field Reports, 666 Settings) or build them in `W3.10`; remove the client methods no surface calls unless `W3` claims them. Acceptance: no navigation destination renders an unavailable panel | `W1.11` | `web/src/app/screens/Console.tsx`, `web/src/app/api/client.ts` | S |
| `W1.10` | Replace `xlsx@0.18.5` on the XLSForm import path with a maintained reader, or vendor SheetJS's current build under its license with a pinned hash and an advisory allowlist entry. Acceptance: the `W0.1` advisory gate passes with no allowlist entry for a parser reachable from an operator upload | `W1.11` | `server/src/forms/xlsx-import.ts`, `server/package.json`, `pnpm-lock.yaml`, `scripts/license-scan.mjs` | S |
| `W1.12` | Retire the roster stack per section 0: create `docs/process/archive/`, move the six documents with a supersession header naming this plan, repair every inbound link across `docs/`, `README.md` and `ROADMAP.md`, and rewrite the authority-documents section of `CLAUDE.md` to name this document alone. Acceptance: the docs link checker is green and `docs/process/` holds one roster | `W1.11` | `docs/process/**` moves, `CLAUDE.md`, link fixes | M |
| `W1.13` | **DONE 2026-09-23.** Freeze `docs/process/VEOC-EXECUTION-LEDGER.md` with a notice marking it historical and pointing at its successor. Open `docs/process/V1-LEDGER.md` for every unit of this plan, carrying a receipt template. Acceptance: no receipt is rewritten or moved, and the new ledger opens with the first unit that runs after the freeze. The original wording said the new ledger opens with `W1.11`, which contradicted the same sentence, because `W1.11` ran first under this plan's execution order and its receipt was already in the historical ledger | `W1.12` | the two ledger files | S |
| `W1.14` | Consolidate the server test suite: record per-directory line and assertion counts first, merge duplicated fixture and provisioning setup into the shared helpers in `server/src/__tests__/`, and collapse per-session acceptance files that assert the same behavior into one file per module. Acceptance: total assertions and covered lines do not fall, the gate stays green, and the receipt shows the before and after counts | `W1.11` | `server/src/**/*.test.ts`, `server/src/__tests__/**` | L |

Gate after `W1`: full suite green at `--maxWorkers=1` with the gate tag; the
route-table contract test green; the link checker green; `docs/process/`
carries one roster and two ledgers.

### W2. Harden for one real activation

Engine units. Each carries a real-database test that reproduces the failure
before the fix and a benchmark or bound after it. Fans out: `W2.0`, `W2.1`,
`W2.3` and `W2.8` in parallel; `W2.2`, `W2.4` and `W2.9` after their
dependencies.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W2.0` | Sync hub lifecycle: evict a board document after the last subscriber leaves plus a grace period; compact the update log at a threshold; cache the encoded state so `open()` stops rescanning records; re-read the board schema on template upgrade. Acceptance: heap after 200 open-close cycles across 50 boards is within 10 percent of baseline; open latency is flat in record count | none | `server/src/sync/**` | L |
| `W2.1` | Outbound delivery queue: notifications and webhooks written to an outbox table inside the write transaction and delivered by a worker with retry, backoff, per-target circuit breaker and dead-letter; the write path never awaits a network call. The same worker drains the federation outbox and calls `markDelivered`, which nothing calls today. Acceptance: a webhook target that sleeps 30 seconds does not change board write latency | none | `server/src/notify/**`, `server/src/federation/service.ts`, `server/src/boards/routes.ts`, `server/src/sync/hub.ts` call sites, one migration | L |
| `W2.3` | Pagination and push-down: cursor pagination on board views with view filters pushed into SQL, on the audit chronology, on notifications with the cast join replaced by a typed column and index, and on the remaining unpaginated lists. Client methods and the operational table consume cursors. Acceptance: a board with 50,000 records lists its first page in under 300 ms on the test cluster | none | `server/src/boards/service.ts`, `server/src/audit/**`, `server/src/notify/routes.ts`, `web/src/app/api/client.ts`, `web/src/design/table.tsx`, one migration | L |
| `W2.8` | Observability: structured logging through Fastify's pino with request ids and redaction, log levels by environment, a `/metrics` endpoint in Prometheus text format with request, socket, queue and database pool gauges, and log rotation in both deploy paths. Acceptance: a slow request and a failed delivery are both findable from the log and the metrics without reading code | none | `server/src/app.ts`, `server/src/main.ts`, new `server/src/telemetry/**`, `deploy/**` logging config | M |
| `W2.2` | Scheduler: one in-process scheduler in `main.ts` with leader election through a Postgres advisory lock, running scheduled notification rules, due briefings, feed polls and the outbox worker; the trigger endpoints stay for tests. Acceptance: a rule scheduled for now fires within its interval on a deployment with no manual call | `W2.1` | `server/src/main.ts`, new `server/src/scheduler/**` | M |
| `W2.4` | WebSocket discipline: auth deadline of ten seconds, `maxPayload` of 1 MiB, bounded update size in the schema, `bufferedAmount` backpressure with disconnect past a ceiling, ping and pong heartbeat, and the notifications poll replaced by a push over the existing socket. Acceptance: 150 sockets with one slow reader keep the others under 100 ms | `W2.0` | `server/src/sync/routes.ts`, `server/src/app.ts` websocket options, `web/src/app/data/hooks.ts`, `web/src/app/screens/Console.tsx` polling | M |
| `W2.5` | Rate limiting and identity caching: `trustProxy` from configuration, login backoff with expiry and a size cap (the current map is keyed by attacker-supplied email and never pruned), a per-request principal cache keyed by token hash with a short TTL invalidated on sign-out and role change, and one explicit single-node declaration in `deploy/README.md` and the security document, or the Postgres-backed limiter if Basho takes the shared-store option | none | `server/src/auth/**`, `server/src/security/**`, `server/src/app.ts` | M |
| `W2.6` | Secure by default: refuse to serve when `OPENEOC_RUNTIME_URL` is unset unless `OPENEOC_ALLOW_OWNER_RUNTIME=1`; a `bootstrap` subcommand that creates the first jurisdiction and admin non-interactively; timeouts on every outbound fetch; streaming multipart upload with a per-jurisdiction quota replacing the base64 path; envelope key rotation command | none | `server/src/main.ts`, `server/src/files/**`, `server/src/secrets/**`, the two connectors | M |
| `W2.7` | Threat-model controls that do not exist: webhook URL allowlist per jurisdiction and per-rule rate caps (B7); two-person rule on a live IPAWS send with a second admin's confirmation recorded in the audit (B9); mark B5 not applicable with the ADR from `W0.3` | none | `server/src/notify/**`, `server/src/ipaws/**`, `docs/THREAT-MODEL.md`, one migration | M |
| `W2.9` | Retention and export: a retention policy table per jurisdiction with a purge job for non-audit tables, an audit export in CSV and signed JSON with pagination, and syslog forwarding as an optional sink. Acceptance: the retention decision in section 7 is implemented as configured | `W2.2`, `W2.8` | `server/src/audit/**`, new `server/src/retention/**`, one migration | M |
| `W2.10` | MFA: TOTP enrollment and verification for local accounts with recovery codes, required for jurisdiction admins and for any account that can enable IPAWS; SAML only if Basho's identity-provider decision requires it | Basho decision | `server/src/auth/**`, `web/src/app/auth/**`, one migration, a browser test | L |
| `W2.11` | Remaining list pagination, added during execution because `W2.3` deferred the lists outside its files and gate line 5 requires every list endpoint paginated: messages and threads, CAP alerts, damage reports, sitreps, IAPs and revisions, resource requests, AAR observations and corrective actions, staffing check-ins, tracking events, operational relationships, incident tasks, feed and OGC items; the file and dashboard cursors that lost microseconds; the relationship picker capped at one page. Acceptance: every list that grows during an activation pages by cursor, or is named with the reason it does not | `W2.3` | the named services and routes, `server/src/db/cursor.ts`, `web/src/app/api/client.ts`, one migration | M |

Gate after `W2`: full suite green; a 150-connection socketed run on real
hardware recorded with numbers, which is the R1 gate finally run for real;
heap profile flat over a two-hour synthetic activation.

### W3. Wire what is built

Presentation units. The audit measured 226 contract routes across 196 distinct
paths against about 90 the web client references, so roughly half the server
has no screen. Each unit takes an engine that already exists and gives it an
operator surface inside the shell, with the design kit, human labels from the
dictionary, a browser walk, and a guide section. No new engine code except
client methods. Fans out once `W2.3` and `W2.5` have landed.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W3.0` | Administration: people, roles, memberships, guest grants, position assignments, jurisdiction provisioning, integrations switch. Replaces curl for every admin task in the admin guide | `W2.5` | new `web/src/admin/**`, `web/src/app/surfaces/AdminSurface.tsx`, client methods | L |
| `W3.1` | Audit chronology: filterable, paged, exportable, with corrections; the significant-events view a WebEOC operator expects | `W2.3`, `W2.9` | new `web/src/audit/**`, one surface | M |
| `W3.2` | Damage assessment: intake moderation, degrees, loss summary, declaration threshold, FEMA-shaped export, on the map. Closes the F8 and F9 depth boundaries | none | new `web/src/damage/**`, one surface | L |
| `W3.3` | Staffing: check-in and check-out, badges, QR scan, shifts, the ICS-211 view | none | new `web/src/staffing/**`, one surface | M |
| `W3.4` | Facilities and shelters: registry, status board, HAVE view, on the map with the NAPSG symbols already shipped | `W1.4` | new `web/src/facilities/**`, one surface | M |
| `W3.5` | IPAWS enablement and send: COG configuration, MOA acknowledgement, enable toggle, the two-person send from `W2.7`, fixture-mode indicator; no live send until Basho's credentials. Closes R2 to the edge of the external gate | `W2.7` | new `web/src/ipaws/**`, the alerts surface | M |
| `W3.6` | Federation and peers: peer registry, sharing agreements, outbox and inbox status, escalation targets | `W2.1` | new `web/src/federation/**`, one surface | M |
| `W3.7` | Workflow runtime in the board record detail: transitions, approvals, escalations, due rules, immutable history, from the four unwired routes | none | `web/src/boards/**`, `web/src/app/surfaces/BoardSurface.tsx` | M |
| `W3.8` | JIC and resources completion: the seven unwired JIC routes (releases, approvals, inquiries) and the five unwired resource routes (costs, escalation, mutual aid) in their existing surfaces | none | `web/src/sitreps/JicPreparation.tsx`, `web/src/app/surfaces/ResourcesSurface.tsx` | M |
| `W3.9` | Export and import: jurisdiction export from the admin screen, extended to cover incidents, IAPs, AARs, resources, tasks, assessments and files; template, form and dashboard-template import from the designer | `W3.0` | `server/src/export/**`, `web/src/admin/**`, `web/src/boards/Designer.tsx` | M |
| `W3.10` | Settings and field reports: build the two navigation destinations that dead-end today, or confirm the `W1.9` removal and record the decision | `W3.0` | `web/src/app/screens/Console.tsx` and the two new surfaces | S |
| `W3.11` | Engine gaps the presentation units exposed, added during execution: shared-board edits forwarded to peers automatically with no echo, a duplicate sharing agreement answering 409, list routes for JIC releases and inquiries so a second approver can act from their own session, and a cost with no date defaulting to today. Acceptance: each gap has a real-database test that fails before the fix | `W3.6`, `W3.8` | `server/src/sync/hub.ts`, `server/src/federation/**`, `server/src/jic/**`, `server/src/resource/service.ts`, `web/src/sitreps/JicPreparation.tsx`, one migration | M |

Gate after `W3`: every route in the contract is reachable from a screen or
marked machine-only in the contract; zero routes unwired without a recorded
reason; no navigation dead ends.

### W4. Parity depth and superiority

Fans out by module. `W4.0` and `W4.1` are each split into two units.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W4.0` | Notification reach: SMTP email channel, SMS through a provider adapter with a local fixture provider, a contacts directory with groups, mass notification to a group with delivery receipts, escalation to the next contact on no acknowledgement. A WebEOC shop will not evaluate a platform that cannot page a duty officer | `W2.1`, `W2.2` | `server/src/notify/**`, new `server/src/contacts/**`, new surfaces, migrations | XL, two units: channels, then contacts and mass notification |
| `W4.1` | Board engine depth: cross-board lookups with multiple label fields, record-level permissions, delete and archive with history, per-record history view, CSV and Excel import and export of board data, more filter operators, multi-key sort, grouped views | `W2.3` | `shared/src/boards/**`, `server/src/boards/**`, `web/src/boards/**` | XL, two units: engine, then presentation |
| `W4.2` | Views beyond the list: kanban by enum field, calendar by datetime field, chart by count, in the board surface and as dashboard widgets | `W4.1` | `web/src/boards/**`, `web/src/dashboards/**` | L |
| `W4.3` | Reporting: a report builder over boards with filters, grouping, totals and a saved definition, rendered to PDF and Excel, schedulable through `W2.2` | `W4.1`, `W2.2` | new `server/src/reports/**`, new `web/src/reports/**` | L |
| `W4.4` | WebEOC migration: an importer that maps a WebEOC board CSV export onto a template through the data-pack field mapping, with a dry run, a rejection report and a guide chapter; a records-only path, no attempt at process migration | `W4.1` | `server/src/data-packs/**`, `web/src/admin/**`, `docs/guides/MIGRATION.md` | M |
| `W4.5` | Operational vector tiles: `ST_AsMVT` from PostGIS for board layers and dataset layers past the feature cap, clustering at low zoom, per-layer opacity, USNG and MGRS readout; closes `G-TILES` without a martin sidecar | none | `server/src/geo/**`, `web/src/cop/**` | L |
| `W4.6` | Geocoding and address search offline: a gazetteer built from the California OSM extract and county address points at basemap build time, served by the API, with the search box in the command bar | `W1.6` | `tools/basemap/**`, new `server/src/geocode/**`, `web/src/app/layout/**` | L |
| `W4.7` | Field depth: line and polygon capture, barcode, photo and audio questions, cascading selects, repeats, in the smart form runner and the XLSForm importer. Closes the F7 boundary | `W1.10` | `shared/src/forms/**`, `web/src/field/**`, `server/src/forms/**` | L |
| `W4.8` | Resources: NIMS resource typing catalog, availability and demobilization, cost tracking surfaced from the existing routes | `W3.8` | `server/src/resource/**`, `web/src/app/surfaces/ResourcesSurface.tsx`, `shared/src/dictionary/**` | M |
| `W4.9` | Incident lifecycle: archival, a cross-incident master view for the jurisdiction, incident-scoped lockdown | none | `server/src/incidents/**`, `web/src/app/surfaces/IncidentsSurface.tsx` | M |
| `W4.10` | Progressive web app: installable manifest and service worker covering the shell, the offline paths and the map assets the field user needs, with a storage budget and an update prompt | `W5.0` | `web/public/**`, `web/src/offline/**` | M |

Gate after `W4`: parity matrix rows F1, F4, F7, F8, F13 and `G-TILES` move to
verified with receipts; a side-by-side evaluation script against WebEOC's
board, notification and reporting modules is written and run internally.

### W5. Lighten the client

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W5.0` | Code splitting: lazy-load the map surface (MapLibre, PMTiles and their CSS), the field and offline tree (Yjs), and each surface behind the router; first paint carries the shell and the boards list. Acceptance: first-load JavaScript under 300 KB gzipped | none | `web/src/app/router.tsx`, `web/src/app/screens/Console.tsx`, `web/src/main.tsx`, `web/vite.config.ts` | M |
| `W5.1` | Style consolidation: the 240 inline style objects across 21 files, 60 of them in `CopMap.tsx`, become kit classes or tokens; the polling hook stops flashing loading state on every tick; remaining polls gain visibility gating and backoff | `W2.4` | `web/src/**` styles, `web/src/app/data/hooks.ts` | M |
| `W5.2` | Asset delivery: cache headers and content hashes on the static host for the archives and glyphs, the county outline served from the bundle instead of a runtime fetch | none | `deploy/windows/lib/static-host.mjs`, `deploy/docker-compose.yml` web service, `web/src/cop/basemap.ts` | S |

### W6. Release engineering

Mostly solo units in the canonical checkout, because they touch the build, the
deploy tree and the root manifests.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `W6.0` | One-command server install: the web service and a TLS-terminating reverse proxy (Caddy, automatic certificates or a supplied pair) in the compose stack, the bootstrap from `W2.6`, the basemap archives fetched from a release asset with checksum, an `install.sh` that ends at a working login page over HTTPS | `W2.6`, `W1.6` | `deploy/**` outside windows | L |
| `W6.1` | Versioning and upgrade: semantic versions in every package, a `CHANGELOG.md`, an upgrade compatibility statement, backup-before-upgrade enforced by the upgrade script, a restore drill recorded with timings. The `W1.8` baseline migration boundary is stated here in operator language | `W1.11` | `deploy/**`, root manifests, `docs/guides/ADMIN.md` | M |
| `W6.2` | Disaster recovery runbook with RTO and RPO targets, scheduled backup in both deploy paths, offsite copy guidance, and the tested restore from `W6.1` | `W6.1` | `docs/guides/**`, `deploy/**` | S |
| `W6.3` | Project hygiene for adoption: `SECURITY.md` with a disclosure policy and contact, a release cadence and support statement, the second maintainer INV-10 requires, and an evaluator's page stating scope and boundaries in plain terms | Basho input | root documents | S |
| `W6.4` | Installer rebuild from the completed roster with the California, Overture and overlay archives, then the second-machine transfer proof that closes AR7 and INV-3 or records its boundary | W1 to W5 | `deploy/windows/**` | M |
| `W6.5` | Training kit: ICS-position job aids, a tabletop exercise package built on the synthetic scenario, an instructor outline; no video | `W3` | `docs/guides/**` | M |
| `W6.6` | Gated-module disposition: decide and record whether `collab`, `meetings`, `tracking` and `facilities` ship gated or are cut for v1. Default: ship gated, documented as optional integrations, with their threat-model rows marked conditional. If cut, the reversal path is recorded in an ADR and the code is removed rather than left dark | `W3.4`, Basho input on retention and HIPAA | `server/src/collab/**`, `server/src/meetings/**`, `server/src/tracking/**`, `server/src/facilities/**`, `docs/THREAT-MODEL.md` | S |

### W7. Acceptance and release

Astra as single writer, with Basho's inputs.

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `79D+D33` | The integrated incident exercise as worded in the continuation roster row 24, closing the four legs left open by the receipt "VEOC-79D: Integrated cross-boundary incident exercise (partial)" in the frozen ledger, with D33's bounded visual and accessibility review. Closes the R3 boundary | W2, W3 | new exercise test files | L |
| `M5` | Milestone gate | `79D+D33` | none | S |
| `A11Y-T1` | The manual screen-reader pass (NVDA and VoiceOver) that has been scheduled and never run, plus reduced-motion and contrast handling | `79D+D33` | web accessibility fixes | M |
| `D34` | Operator workflow comparison against the D01 baseline with representative operators, or its recorded absence. Closes the F14, F17 and INV-8 operator boundaries | Basho input | documents | M |
| `R1-REAL` | The real-hardware 150-user socketed run, recorded with numbers, on the release candidate. Closes R1 | W6 | documents | S |
| `86+D35` | Reconcile every matrix row to evidence with read-only auditors per section; present remaining blockers and one release decision | everything above | documents | M |
| `V1` | Basho's release act: tag, release assets, installer, announcement text; the pilot jurisdiction named or the release marked evaluation-only | Basho | none | Basho |

## 6. What v1 requires: the gate list

Every line green, or waived by Basho in writing in the ledger. Lines 1 to 18
carry forward from the V1 PSPR. Lines 19 to 21 come from the 2026-09-22 audit.

1. `pnpm check` green on `main` with `--maxWorkers=1` and the gate tag,
   including the route-table contract test, the secret scan and the advisory
   scan.
2. Single-node declaration published, or the shared-store option built.
3. Heap profile flat over a two-hour synthetic activation with 150 sockets;
   the real-hardware run recorded.
4. No network call awaited inside any write path; the outbox worker and the
   scheduler run in both deploy paths.
5. Every list endpoint paginated; the notifications push replaces the poll.
6. Structured logs and a metrics endpoint in both deploy paths; log rotation;
   retention policy configurable and enforced.
7. MFA for administrators and IPAWS enablers; the two-person rule on a live
   send; webhook allowlists.
8. Server refuses to serve with row-level security off unless explicitly
   overridden.
9. One-command server install ending at an HTTPS login page; installer rebuilt
   with archives; backup scheduled; restore drill on record.
10. Every operator-facing route reachable from a screen; no navigation dead
    ends; administration without curl.
11. Email and SMS notification with a contacts directory.
12. Board data import and export in CSV and Excel; a WebEOC records importer
    with a guide.
13. Operational layers render past the feature cap.
14. First-load JavaScript under 300 KB gzipped.
15. `README.md`, `ROADMAP.md`, the facet register, the parity matrix and the
    API document agree with the tree and with each other.
16. `79D+D33` and `M5` green; `A11Y-T1` done; `D34` done or its absence
    recorded; `86+D35` presented.
17. `SECURITY.md`, `CHANGELOG.md`, versioned packages, a second maintainer or
    Basho's recorded waiver of INV-10 for the release.
18. Basho's aesthetic and functional acceptance of the release candidate,
    recorded once for the whole product.
19. `docs/process/` carries one roster. The docs link checker is green after
    the archive move.
20. Server test lines and assertions recorded before and after `W1.14`, with
    coverage not lower than the `W1.11` baseline.
21. Every optional integration either registers routes by default or is named
    in `README.md` as an optional integration with its enabling variable.

## 7. Decisions with standing defaults

Execution does not stop for any item below. The default named on each line is
in force until Basho overrides it in a session. A unit that depends on one
records the default it used and continues. Items 7 and 9 are external inputs;
their units work around the absence and record it.

1. **A0 for this plan.** Requested at approval, with standing commit, landing
   and push authority for every unit that passes its gate.
2. **The cut list, carried forward.** `W1.0` field node deleted, `W1.3` collab
   and meetings gated, `W1.4` tracking and facilities kept and gated, `W1.8`
   migration squash done. `W6.6` gives these one release disposition.
3. **Identity provider and MFA.** TOTP for local accounts is the default. Is
   SAML required for the first county, and which IdP?
4. **Single node or shared store for v1.** Default: single node declared,
   shared store as a 1.x item.
5. **Retention and HIPAA scope.** What retention applies to audit, tracking
   and damage data, and whether tracking and facilities carry patient-level
   data in v1 at all. Gates `W2.9` and `W6.6`.
6. **Notification providers.** Which SMTP relay and which SMS provider the
   first county will use; the fixture provider covers development.
7. **External inputs that gate `W7`:** the pilot jurisdiction, representative
   operators for `D34`, the real hardware for `R1-REAL`, IPAWS test
   credentials and the MOA, the second maintainer.
8. **The product name**, which the README, the installer and the release
   assets need.
9. **Branch protection** on GitHub, "Require linear history."
10. **Disposition of `work/d05`** in lane worktree A.
11. **Archive or delete the retired rosters.** Default: archive under
    `docs/process/archive/`. Deleting them costs the receipts their context.

## 8. Execution model

- Roles, modes, lanes, the zipper, unit lifecycle, failure handling and the
  receipt templates are those of the Master PSPR sections 7 and 11, carried
  forward unchanged into this document's authority.
- `W1` runs one unit at a time in the canonical checkout. `W1.11` runs first
  and alone; nothing else starts against an uncommitted tree.
- `W2` and `W3` fan out as noted in their wave headers. `W4` fans out by
  module. `W5` and `W6` are mostly solo. `W7` is a single writer.
- `main` moves only by fast-forward to exact commits, one landing at a time,
  by the integrating session alone. No merge commits. Lanes rebase. No two
  units in flight own the same file.
- Milestone gates after `W1`, `W2`, `W3` and `W4`: the full suite on `main`
  with the gate tag at `--maxWorkers=1`. After a green gate the session
  reports the unpushed range and stops; pushing is Basho's instruction.
- Every unit's brief names its owned files, its acceptance wording from this
  document, its evidence level, and the guide section it updates. A unit that
  adds a route adds it to the contract in the same commit, or the route-table
  test fails.
- Every unit appends a receipt to `docs/process/V1-LEDGER.md` once `W1.13`
  opens it, and to the frozen ledger never.

## 9. Estimate

Counting S as half a day, M one day, L two and a half, XL five, and allowing
for integration: `W1` 6, `W2` 22, `W3` 20, `W4` 30, `W5` 4, `W6` 9, `W7` 8.
About 99 agent-days, of which the four audit units and `W6.6` are 5.5. With
three lanes in `W2` through `W4` and one otherwise, wall-clock is on the order
of seven to nine weeks of execution, paced by Basho's decisions in section 7
and the external inputs in `W7`.

The finished work behind this plan is not counted here: the original 46-prompt
roster is fully receipted, and the facet register stands at 30 of 43 rows
verified. This document covers the remainder.

## 10. Key files

- This plan: `docs/process/FINISH-PSPR-2026-09-22.md`.
- Audit that produced waves `W1.11` to `W1.14` and `W6.6`:
  `STATUS-AUDIT-2026-09-22.md`.
- Frozen historical ledger: `docs/process/VEOC-EXECUTION-LEDGER.md`.
  Active ledger from `W1.13`: `docs/process/V1-LEDGER.md`.
- Capability matrix: `docs/VEOC-PARITY-MATRIX.md`. Facet register:
  `docs/FACET-STATUS.md`.
- Research basis, still live: `docs/process/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md`.
- Retired rosters after `W1.12`: `docs/process/archive/`.
- Project rules: `CLAUDE.md`. Global doctrine: `~/.claude/CANON.md`.
- Test cluster: `deploy/test-runtime/README.md`. Shared browser harness:
  `server/src/__tests__/browser.ts`.
