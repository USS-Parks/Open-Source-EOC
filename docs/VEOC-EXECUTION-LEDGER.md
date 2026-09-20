# VEOC Execution Ledger

Append-only session receipts for the roster in `VIRTUAL-EOC-PSPR-2026-09-17.md`.
Never edit a prior receipt; corrections are new entries referencing the original.

Execution authorization: Basho approved full sequential execution of the roster
in-session on 2026-09-17, including commit and push of each prompt's work upon
verified completion, with GitHub state verified green before advancing.
Branch posture: all work on `main`. License decision: Apache-2.0 (Basho,
2026-09-17). Package namespace: `@openeoc` (Basho, 2026-09-17).

---

## VEOC-00: Freeze the baseline and create the execution ledger

- **Session:** VEOC-00, executed 2026-09-17T02:24:58Z (UTC) / 2026-09-16 19:24 PDT
- **Starting HEAD:** `2743fe6f8ac29bedbc4d00175a47d8491777bce4` (main, tracking origin/main)
- **Ending HEAD:** recorded in the VEOC-00 commit itself (this file is part of it)
- **Remotes:** origin = https://github.com/USS-Parks/open-source-eoc (canonical: USS-Parks/Open-Source-EOC)
- **Toolchain:** Node v22.22.2; pnpm 10.33.0; npm 10.9.7; rustc 1.94.1; cargo 1.94.1; Python 3.11.15
- **Authority document hashes (sha256):**
  - `docs/VIRTUAL-EOC-PSPR-2026-09-17.md` = `06c0ea8638c849071227e8f8c437493f47cb29cbb330a3cbda761ca1aba80f0f`
  - `docs/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` = `6ead86181e387ee7405e095c56f64874f7becd31687ceb0efe565184140f0e31`
  - `CLAUDE.md` = `ce3892a51e489d7dfee564078f5c5607267b9bc6319c3f377f79934d5c6b1928`
  - `.githooks/commit-msg` = `5fb06b30cf9a22f698d291e0ca5fed3af7789c1d1ff2846ebfca50ca9ba1d1a2`
- **Facets/requirements addressed:** none implemented; F1-F20, R1-R6, AR1-AR7, INV-1..10 all registered `open` in `docs/FACET-STATUS.md`
- **Files changed:** created `docs/VEOC-EXECUTION-LEDGER.md`, `docs/FACET-STATUS.md`. No product code touched.
- **Pre-existing user changes:** none; working tree was clean at session start.
- **Tests:** none applicable (documentation-only session). Verification commands: `git rev-parse HEAD`, `git status --short --branch`, `sha256sum` over the four governance files, toolchain version checks; all exit 0.
- **Invariants checked:** none exercisable yet.
- **Deferred work / blockers:** none. Rollback: revert the VEOC-00 commit.
- **git status at close:** two new untracked docs files, staged individually for the VEOC-00 commit.
- **Commit/push:** performed under Basho's 2026-09-17 full-execution authorization. No branch created.

---

## VEOC-01: Confirm project placement and scaffold the workspace

- **Session:** VEOC-01, executed 2026-09-17 ~02:30 UTC
- **Starting HEAD:** `4bd8ca146f386332083933fbee3b4361dbbdb9a4`
- **Basho decisions recorded:** package namespace `@openeoc`; all work on `main`; project home settled (github.com/USS-Parks/Open-Source-EOC).
- **Files created:** `README.md`, `.gitignore`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `pnpm-lock.yaml`; `shared/`, `server/`, `web/` packages (package.json, tsconfig.json, src/index.ts each); `field-node/` Rust placeholder crate; `deploy/README.md`. No functionality, wiring proof only.
- **Dependencies added:** typescript 5.9.3 (Apache-2.0) as root devDependency. Nothing else.
- **Verification:** `pnpm install` exit 0; `pnpm check` (`pnpm -r exec tsc --noEmit`) exit 0 on clean tree; seeded type defect in `shared/src` made `pnpm check` fail with TS2322, then removed and the gate returned green; `cargo check --manifest-path field-node/Cargo.toml` exit 0.
- **Facets/requirements:** none closed; scaffold only.
- **Deferred/blockers:** none. Rollback: revert the VEOC-01 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-02: License, governance, and the anti-Sahana contribution model

- **Session:** VEOC-02, executed 2026-09-17 ~02:40 UTC
- **Starting HEAD:** `42c2b23759853f3afebb450b0802365210ee0032`
- **Basho decision applied:** Apache-2.0 (chosen in-session over MIT and AGPL-3.0 with trade-offs presented).
- **Files created:** `LICENSE` (canonical apache.org text, 202 lines / 11,358 bytes verified), `NOTICE`, `GOVERNANCE.md` (succession rule: two maintainers before 1.0; 12-month inactivity handover; archive-and-invite-fork as last resort), `CONTRIBUTING.md` (DCO 1.1 sign-off for external contributors; commit hygiene; license hygiene; no per-file headers policy), `CODE_OF_CONDUCT.md`, `ROADMAP.md`, `scripts/license-scan.mjs`.
- **Files changed:** root and package `package.json` files gained `license: Apache-2.0` and the scan wired into `pnpm check`; `field-node/Cargo.toml` gained the license field; `field-node/Cargo.lock` tracked (housekeeping from VEOC-01's cargo check).
- **Verification:** `pnpm check` green (typecheck + license scan); seeded AGPL-3.0 package via `LICENSE_SCAN_EXTRA` made the scan exit 1 naming the package, then clean run green again; `cargo check` green; all governance cross-references resolve to existing files; style scan clean.
- **Facets/requirements:** INV-10 groundwork (succession rule in force as policy).
- **Deferred/blockers:** none. Rollback: revert the VEOC-02 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-03: Domain data dictionary from doctrine

- **Session:** VEOC-03, executed 2026-09-17 ~02:55 UTC
- **Starting HEAD:** `86975c1b9fc50ca6b5b25784e8abf3ef853be2a2`
- **Files created:** `shared/src/dictionary/` with `citations.ts` (cited-enum framework and registry), `ics.ts` (sections, Command and General Staff, 17-entry ICS form registry incl. 213RR), `resource-request.ts` (nine 213RR lifecycle states with a transition machine; terminals have no exits), `lifelines.ts` (all eight FEMA Community Lifelines plus condition enum and doctrine colors), `pda.ts` (damage degrees, IA structure/ownership enums, PA categories A-G, IaAssessment zod schema), `have.ts` (EDXL-HAVE-shaped facility, EMS traffic, bed type, facility kind enums), `tracking.ts` (tracking kinds, SALT triage categories, custody chain), `symbology.ts` (NAPSG categories and status frames), `index.ts` (JSON Schema export via zod v4 `z.toJSONSchema`), and `__tests__/dictionary.test.ts` (8 tests).
- **Dependencies added:** zod 4.6.5 (MIT) in shared; vitest 5.0.1 (MIT) at root. License scan green across 39 packages.
- **Verification:** `pnpm check` exit 0; `vitest run` 8/8 passing, including negative cases (invalid enum values and an invalid IA degree rejected); citation lint asserts non-empty authority/document on all 14+ registered enums; JSON Schema export verified to list every value of every enum.
- **Deferred (recorded honestly):** full per-form field sets for all 17 ICS forms are registry entries now and implement with the forms engine at VEOC-34; full NAPSG symbol SVG library imports at VEOC-17. Both noted in source comments.
- **Facets/requirements:** groundwork for F5, F8, F10, F11, F19, F20 (schemas exist; nothing closed).
- **Rollback:** revert the VEOC-03 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-04: Architecture decision records and threat model baseline

- **Session:** VEOC-04, executed 2026-09-17 ~03:05 UTC
- **Starting HEAD:** `79ef36943321a735c40e4f6bdbe85138aca71cfe`
- **Files created:** `docs/adr/ADR-0001` (Fastify over NestJS/Express/Hono), `ADR-0002` (versioned REST + WebSocket + signed webhooks; GraphQL/gRPC rejected), `ADR-0003` (Yjs CRDT over WebSocket, Postgres as truth, visible conflict surfacing; LWW rejected as silent-loss), `ADR-0004` (QuickJS-in-WASM plugin sandbox with capability-only API; isolated-vm rejected on native-module and browser grounds), `ADR-0005` (single database, jurisdiction_id on every row, RLS as second wall; db-per-tenant rejected), `ADR-0006` (Ed25519 instance identity, human-approved peering, store-and-forward, signature-derived trust; central broker rejected), `ADR-0007` (compose-first, single-node installer, air-gap bundle; Kubernetes-first and SaaS-first rejected); `docs/THREAT-MODEL.md` (assets A1-A6, attacker classes T1-T6, trust boundary table B1-B12 covering every external surface planned in phases B-F, standing adversarial test policy).
- **Verification:** each ADR states decision, alternatives, and reversal cost; threat model rows cross-checked against roster sessions 07-33 (every session opening a surface maps to a row); style scan clean; no code changes, `pnpm check` unaffected.
- **Deferred/blockers:** none. Rollback: revert the VEOC-04 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-05: Design system for calm screens

- **Session:** VEOC-05, executed 2026-09-17 ~03:20 UTC
- **Starting HEAD:** `c76d7122d18d6f41369fab1963b5d6f37fa4a39b`
- **Files created:** `web/src/design/tokens.ts` (light/dark themes, neutral base with five status colors as the only saturation, WCAG luminance/contrast functions, CSS variable emitter), `components.tsx` (Theme, StatusBadge as colored text+border never fills, Button, TextField, EnumSelect as the default control, Panel), `layout.tsx` (AppFrame with skip link, BoardList, BoardTable, MapPanel placeholder, NotificationTray with polite live region), `gallery.tsx` (full-set fixture in both themes, doubles as the style reference), `__tests__/contrast.test.ts` (24 token-pair AA assertions plus checker self-proof and malformed-color rejection), `__tests__/a11y.test.tsx` (axe zero-violation runs in both themes with color-contrast delegated to the mathematical suite, keyboard-order and label-association tests).
- **Files changed:** `web/tsconfig.json` (jsx react-jsx, DOM libs), `web/src/index.ts` (design exports).
- **Dependencies:** react/react-dom 19.3 (MIT), @testing-library/react, axe-core (MPL-2.0, tool-only dev dependency, not embedded), jsdom, vite, @vitejs/plugin-react. user-event was added then removed (NodeNext typing friction; tab order proven structurally instead). License scan green across 99 packages.
- **Verification:** `pnpm check` fully green (typecheck all packages, license scan, 38/38 tests); seeded low-contrast token (`#aab0b6` textMuted) made the contrast suite fail naming the exact pair, restored from backup byte-identical, suite green again.
- **Facets:** F14 and F17 groundwork `implemented` (calm-screen discipline encoded and enforced by CI); ten-minute viewer primitives exist.
- **Deferred:** interactive vite dev-server entry for the gallery ships with the first real app shell (VEOC-10); glove/touch and night-shift stress passes are VEOC-39's audit.
- **Rollback:** revert the VEOC-05 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-06: CI gates for the workspace

- **Session:** VEOC-06, executed 2026-09-17 ~03:40 UTC
- **Starting HEAD:** `63768b0458e70e76fe077d4c713fc4c7d4a9cf40`
- **Files created:** `eslint.config.mjs` (flat config, typescript-eslint recommended, no-console outside scripts), `scripts/check-links.mjs` (relative-link checker over tracked Markdown; external links out of scope so the gate passes air-gapped), `.github/workflows/ci.yml` (three jobs: full `pnpm check`; Rust check+clippy on the field node; commit-message hygiene verifying the head commit through the hook in verify mode).
- **Files changed:** `package.json` (`check` = typecheck + eslint + license scan + link check + tests; `lint` and `check-links` scripts), `.githooks/commit-msg` (COMMIT_MSG_VERIFY mode: CI rejects a missing footer instead of appending).
- **Dependencies:** eslint 10, typescript-eslint 8, @eslint/js (all MIT). License scan green across 189 packages.
- **Verification (seeded-failure matrix):** lint gate failed on a seeded no-undef/unused file, link gate failed on a seeded broken relative link in README, both restored and green; type gate proven at VEOC-01, license gate at VEOC-02, contrast/test gate at VEOC-05; hook verify mode passes a footered message and rejects a footerless one. Full `pnpm check` green (38/38 tests).
- **Note:** the CI `commit-hygiene` job is the server-side layer promised when the hook shipped; a `--no-verify` commit now fails CI on push.
- **Deferred/blockers:** none. Rollback: revert the VEOC-06 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.
- **Post-receipt CI note:** the first Actions run failed (pnpm version declared in both workflow and package.json); fixed by removing the workflow declaration (`710bd39`), second run green. Phase A exit gate met with CI verified on GitHub.

---

## VEOC-07: Identity, positions, and position login

- **Session:** VEOC-07, executed 2026-09-17 ~04:00 UTC
- **Starting HEAD:** `710bd394bbbed2c335d101ec992b73b16dbd1237`
- **Infrastructure:** local PostgreSQL 16.13 cluster stood up in the sandbox for tests (unix socket); CI gains a postgres:16 service container with OPENEOC_DATABASE_URL.
- **Files created:** `server/migrations/0001_identity.sql` (jurisdictions, persons, memberships, positions, assignments with active-uniqueness, auth_sessions, append-only position_signins), `server/src/db/client.ts` and `migrate.ts` (forward-only runner), `server/src/auth/passwords.ts` (scrypt per OWASP, timing-safe verify), `tokens.ts` (256-bit tokens, only SHA-256 stored), `service.ts` (login with account-existence timing mask, resume-on-same-session continuity, principal derivation, admin-gated position create/assign, sign-in requiring active assignment), `rate-limit.ts` (five-failure lockout), `server/src/app.ts` (Fastify routes, server-side principal, no open registration), tests (`auth.test.ts`, `helpers.ts`).
- **Dependencies:** fastify 5 (MIT), postgres 3 / postgres.js (Unlicense), zod, @types/node. License scan green, 237 packages.
- **Verification:** `pnpm check` fully green, 46/46 tests. Acceptance proven by test: person and position present on authenticated requests (`/me` after position sign-in); expired access token renews via resume token onto the SAME session with active position retained; wrong-password and unknown-user responses identical; five failures lock the account (429); sign-in without assignment 403; position creation and assignment by non-admin 403; logout ends session, closes open sign-ins, and invalidates the resume token.
- **Deferred (recorded honestly):** OIDC (Keycloak-class) login: the local-account path and principal model are complete; the OIDC flow needs a test issuer harness and lands as the opening item of VEOC-08 alongside provisioning, before any authz work depends on it.
- **Threat rows exercised:** B11 partially (rate-limited login, no self-assigned authority, session fixation prevented by server-side tokens).
- **Rollback:** revert the VEOC-07 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-08: Authorization, tenancy, and one-click role provisioning

- **Session:** VEOC-08, executed 2026-09-17 ~04:40 UTC
- **Starting HEAD:** `ee830181d77a8aac93924c2c4b27f20625caab43`
- **Files created:** `server/migrations/0002_authz.sql` (person_identities for OIDC, time-boxed scope-limited guest_grants, app_runtime role, security-definer helper functions, RLS policies on positions, assignments, sign-ins, memberships, and grants), `server/src/db/context.ts` (`withPerson`: every principal-scoped service call runs in a transaction with the actor bound for RLS), `server/src/auth/authz.ts` (one-action jurisdiction provisioning with the eight ICS Command/General Staff positions from the dictionary; guest grant issue/revoke; guest-aware position listing), `server/src/auth/oidc.ts` (openid-client code flow with PKCE, server-held state/nonce/verifier, provisioned-persons-only entry, identity linking), tests `authz.test.ts` and `oidc.test.ts` (with a jose-signed fake OIDC issuer serving discovery, JWKS, and tokens).
- **Files changed:** `service.ts` (Principal gains isInstanceAdmin and guests; principal derivation runs under the person's own RLS context; extracted `createSession` for OIDC reuse), `app.ts` (all principal-scoped routes wrapped in withPerson; new routes: list positions, provision jurisdiction, guest grant/revoke, OIDC start/callback), `helpers.ts` (per-test-file throwaway databases; RLS-bound runtime connection distinct from the superuser assertion connection), `auth.test.ts` (two-connection model).
- **Dependencies:** openid-client (MIT), jose dev-only (MIT). License scan green, 240 packages.
- **Two-wall proof (INV-7):** cross-jurisdiction API read 403 at the service wall; the same read as a direct SQL query under the actor's RLS context returns zero rows while the superuser sees eight; a query with no person context sees no tenant rows at all.
- **Acceptance proven by test:** instance admin provisions a functional jurisdiction (8 ICS positions) in one action and its admin lists them; non-instance-admin provisioning 403; guest with positions:read reads, cannot write, cannot self-grant, and an expired grant fails at both walls; OIDC login works for a provisioned person, links the identity, refuses unknown identities (403) and forged/replayed state (401). 57/57 tests, three consecutive full-suite runs green after fixing a shared-catalog race in test setup (serialized under an advisory lock).
- **Deferred:** grant expiry is time-boxed now; automatic expiry-at-incident-closure attaches when incidents exist (VEOC-12). Auth-role privilege split (login queries vs general runtime) revisited at VEOC-37.
- **Facets/requirements:** F16 `implemented`; R3 `implemented` (guest machinery; COP scope extends at VEOC-16/17); threat rows B1/B11 exercised.
- **Rollback:** revert the VEOC-08 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.
- **Post-receipt CI note:** first CI run red: the test helper set the runtime role password before the migration that creates the role, masked by the warm local cluster. Reproduced on a rebuilt-from-scratch local cluster, reordered (`4642c16`), CI green.

---

## VEOC-09: Board engine, versioned schemas and views

- **Session:** VEOC-09, executed 2026-09-17 ~05:30 UTC
- **Starting HEAD:** `4642c1622f8789a2280d71613df2503449596c65`
- **Files created:** `shared/src/boards/fields.ts` (declarative field/view/template model with zod validation; enum fields resolve dictionary enumerations; local fields confined to the x_ namespace, additive-only; record validators reject unknown keys; effectiveFields implements upgrade merge and re-convergence), `shared/src/boards/standard.ts` (the ten-board standard library as pure data: activity log, significant events, 213RR resource requests, shelters, road closures, sign in/out, sitrep, press releases, checklists, AAR), `server/src/boards/package.ts` (Ed25519-signed regional template packages over canonical JSON; moved out of shared because node:crypto must not reach the browser package), `server/migrations/0003_boards.sql` (templates, boards, records; RLS: templates readable to any principal and writable by instance admins, boards/records member-or-designated-guest readable, writer-role insert/update), `server/src/boards/service.ts` (create/effective/local-field/upgrade/record CRUD with field-level read filtering and admin-only field writes; view filtering and sorting), `server/src/boards/routes.ts`, tests in shared and server plus `package.test.ts`.
- **Acceptance proven by test:** the standard set is data, validated at load, and every template builds a working record validator; dictionary drift rejected ("catastrophic" severity fails; unknown keys fail; required enforced); a v1-to-v2 upgrade keeps records untouched, keeps x_tribal_notes, adopts the new field, and drops the now-covered x_source (re-convergence); admin-only fields refuse member writes at 403; viewers read but cannot write; a guest with a board-scoped grant reads exactly that board; an outsider gets 404 because RLS hides existence itself; signed package import works under a trusted key and a tampered package is refused (400); untrusted publisher keys are refused.
- **Verification:** `pnpm check` fully green; 72/72 tests across 9 files.
- **Deferred:** SQL push-down of view filters (in-process today; revisit at VEOC-38 with volume targets); board archival flow UI; template export API endpoint (export exists as a signed-package function; the endpoint follows when instance identity keys land properly at VEOC-30).
- **Facets:** F1 `implemented`; INV-5 and INV-6 groundwork enforced by schema (no-code designer UI is VEOC-10).
- **Rollback:** revert the VEOC-09 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-10: Board runtime and no-code designer

- **Session:** VEOC-10, executed 2026-09-17 ~06:10 UTC
- **Starting HEAD:** `d939ce278aac9f546b53e6beb5183de0178da03b`
- **Files created:** `shared/src/boards/view.ts` (one applyView implementation shared by server and browser so a view can never mean two things; server refactored onto it), `shared/src/boards/diff.ts` (structural template diff; rollback as forward-motion to old content under a new version, history never rewritten), `web/src/boards/RecordForm.tsx` (input view rendered from field definitions; enum controls fed by the dictionary; client validation is the same shared schema the server enforces), `web/src/boards/BoardView.tsx` (display view as a pure function of records, ready for the sync layer to drive), `web/src/boards/Designer.tsx` (structured controls only: fields, enum sources, required, read/write levels, views with column pickers; live diff panel; version bump on save), tests `designer.test.tsx` and `runtime.test.tsx`, `docs/DESIGNER-USABILITY-SCRIPT.md` (the timed ten-minute shelter-board walkthrough for VEOC-39's audit).
- **Acceptance proven by test:** an administrator builds a working shelter board from nothing through UI interactions alone and the saved output is a valid v1 template with the EDXL-HAVE status enumeration attached; the escape hatch is absent by construction (no textarea, no contenteditable, only text/checkbox/select controls); an invalid draft is refused with a visible reason; editing an existing template shows the structural diff ("added: generator") and bumps the version; the record form submits exactly the valid record and blocks invalid ones with visible errors; the display view filters (closed shelter hidden from the open view), renders labels not keys, and re-renders on record changes; diff reports added/removed/changed; rollback restores content under a new version.
- **Verification:** `pnpm check` fully green; 82/82 tests across 11 files.
- **Deferred:** view filter/sort editing in the designer covers columns today, filter-condition editing UI follows with the app shell; browser-level (non-jsdom) E2E arrives with the offline client work (VEOC-21); "live-update" means reactive rendering now, push arrives at VEOC-13 as planned.
- **Facets:** F1 `implemented` end to end; INV-6 `implemented` (no-code is real and tested).
- **Rollback:** revert the VEOC-10 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-11: Immutable audit and the activity log family

- **Session:** VEOC-11, executed 2026-09-17 ~06:40 UTC
- **Starting HEAD:** `6c085c2533edf62afdbdc1c75a1aca09aba46182`
- **Files created:** `server/migrations/0004_audit.sql` (audit_events with monotonic seq, server-side timestamps, and three walls against rewrite: no UPDATE/DELETE privilege for the runtime role, a trigger that rejects UPDATE/DELETE from any role including the owner, and RLS binding appends to the acting person inside their jurisdiction), `server/src/audit/service.ts` (recordAudit with never-caller-supplied attribution; correctAudit as a new event referencing the original; exportChronology producing the ordered, attributed, line-rendered record), `server/src/audit/routes.ts` (chronology GET, corrections POST), `server/src/__tests__/audit.test.ts`.
- **Files changed:** board record create/update now emit audit events atomically in the same transaction; `app.ts` and server index wiring.
- **Design note:** the Activity Log and Significant Events boards from the standard library are the UX; their state changes flow into audit_events automatically through the board engine, so there is one chronology store, not two.
- **Acceptance proven by test:** creation and update events carry person, position (Operations Section Chief captured on the signed-in admin, null on the positionless member), and server timestamps; UPDATE and DELETE on audit_events fail for the runtime role (privilege) and for the owner (trigger message "append-only"), the contract-item-10 proof at both layers; a correction leaves the original byte-identical and references it; the exported chronology reproduces the scripted incident in seq order with the line format `<ISO> Admin (Operations Section Chief): board.record.created`; an outsider sees zero events through the RLS wall.
- **Verification:** `pnpm check` fully green; 88/88 tests across 12 files.
- **Facets:** F2 `implemented` (position login was VEOC-07; the immutable chronology completes it); INV-2 `implemented`.
- **Deferred:** incident_id column exists and populates once incidents arrive (VEOC-12); CSV/PDF packaging of the chronology joins the FEMA paperwork exports at VEOC-23/34.
- **Rollback:** revert the VEOC-11 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-12: Incident lifecycle, templates, and libraries

- **Session:** VEOC-12, executed 2026-09-17 ~07:10 UTC
- **Starting HEAD:** `37461870d99693e4a00b3c5ddfefc04903d25114`
- **Files created:** `server/migrations/0005_incidents.sql` (incident templates, incidents with kind flag and collab_requested marker for VEOC-32, incident positions/boards links, position-owned checklist items, jurisdiction libraries with template auto-attach, full RLS), `server/src/incidents/service.ts` (standard scenario templates as data incl. wildfire and daily_ops; one-action activation creating org chart, boards, checklists, and attaching scenario libraries, audited with incident context; position-attributed checklist completion; audited closure; library creation), `server/src/incidents/routes.ts`, `server/src/__tests__/incidents.test.ts`.
- **Files changed:** `authz.ts` exports STANDARD_TITLES; `app.ts` wiring.
- **Acceptance proven by test:** activating "Bald Hills Fire" from the wildfire template yields 8 ICS positions, 6 boards, 7 checklist items, and the attached pre-plan library in one action with an `incident.activated` audit event carrying the incident id; members cannot activate (403); a daily-ops incident runs the same machinery differing only by kind; checklist completion is refused until the actor signs into the owning position, then records "Incident Commander" as the completing position, and double-completion is 409; closure is admin-gated, audited, and idempotent-guarded.
- **Verification:** `pnpm check` fully green; 93/93 tests across 13 files. One test-authoring arithmetic error (checklist count) corrected against the template's actual content.
- **Facets:** F12 `implemented`; F13 `implemented` (scenario/plan/reference libraries with template auto-attach); F17 groundwork (daily-ops flag live).
- **Deferred:** collaboration-space provisioning fires from collab_requested at VEOC-32; guest-grant auto-expiry at incident closure lands when grants gain incident scope (noted since VEOC-08); IAP and 213RR flows build on these positions at VEOC-34/35.
- **Rollback:** revert the VEOC-12 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-13: Real-time sync and the offline queue

- **Session:** VEOC-13, executed 2026-09-17 (spanning a sandbox pause; local Postgres restarted from preserved data, no state lost)
- **Starting HEAD:** `71e3b1eb48b24f49a00151e6a3a74d35c3757eeb`
- **Files created:** `server/migrations/0006_sync.sql` (append-only sync_updates CRDT log under the same three anti-rewrite walls as the audit stream, reusing its trigger; sync_conflicts with admin-resolvable rows), `server/src/sync/hub.ts` (one Y.Doc per board hydrated from the update log and merged with REST-created records; every applied update durably appended, then checkpointed into board_records under the originating principal with audit events), `server/src/sync/routes.ts` (WebSocket endpoint, auth-first frame protocol, state push on join, peer broadcast), `server/src/__tests__/sync.test.ts` (headless offline-capable client, seeded randomized convergence property over 25 interleavings, the scripted 24-hour partition test, conflict surfacing, live peer delivery).
- **Two design findings fixed during the session, both caught by the partition test:** (1) records are stored as FLAT `recordId/field` keys because nested Y.Maps created concurrently by partitioned clients replace wholesale instead of merging, losing fields; flat keys give field-level merge whatever the creation order; (2) a record missing required fields mid-reconciliation is a normal intermediate that stays in the CRDT log and projects when complete, while VALUE violations (bad enum) are true conflicts, so the checkpoint classifies with a relaxed schema instead of flagging every partial state.
- **Acceptance proven by test:** two clients edit through a partition (each creating a record and cross-editing the other's), reconnect in either order, converge to identical state including both cross-edits; Postgres truth holds both records attributed to their actual creators; every change carries an attributed audit event; a schema-violating merge surfaces one conflict row plus a sync.conflict audit event and never lands in board_records; live peers receive pushed updates; 25 randomized interleavings converge identically.
- **Verification:** `pnpm check` fully green; 97/97 tests across 14 files.
- **Dependencies:** yjs, @fastify/websocket, ws (+types), all MIT; 257 packages license-clean.
- **Deferred:** client IndexedDB persistence and the PWA wrapper are VEOC-21 (the headless client proves queue semantics); Yjs update-log compaction (checkpoint + vacuum) revisited at VEOC-38 with volume targets; awareness/presence indicators arrive with the app shell.
- **Facets:** INV-3 core `implemented` for boards; ADR-0003 proven in practice.
- **Rollback:** revert the VEOC-13 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-14: Notification engine

- **Session:** VEOC-14, executed 2026-09-17
- **Starting HEAD:** `4c67a0cab88409a058f4eac2e763b5be21e1988c`
- **Files created:** `server/migrations/0007_notifications.sql` (rules as per-jurisdiction data; notifications as the delivery log and in-app tray; tray RLS lets a person read their own entries plus those aimed at positions they hold active assignments for), `server/src/notify/engine.ts` (pure condition matcher with any/eq/changed_to; channel fan-out to in-app, HMAC-SHA256-signed webhooks, and ntfy-pattern self-hosted push; every attempt logged delivered or failed; post-commit delivery, never inside the mutating transaction; scheduled rules with an interval guard), `server/src/notify/routes.ts` (rule creation returning the webhook secret exactly once, tray, mark-read, scheduled-run trigger), `server/src/__tests__/notify.test.ts` (local receiver capturing raw bytes).
- **Files changed:** board record create/update return full write results and routes fan out after commit; the sync hub notifies for sync-originated changes the same way, so both write paths feed one engine.
- **Acceptance proven by test (the 213RR lane):** a rule on state changed_to "assigned" stays silent through creation and a non-matching transition, then fires on the real transition across all three channels: the requesting position (record creator, Operations Section Chief) gets a tray entry, the webhook arrives with a signature the consumer verifies against the raw body (and tampering breaks it), the push lands on the topic, and all three log delivered; a dead webhook port fails visibly with the error recorded while the surviving channel still delivers and the API call is unaffected; scheduled rules fire once per interval with the guard proven by a second immediate run firing zero.
- **Verification:** `pnpm check` fully green; 101/101 tests across 15 files. One test-harness fix: the receiver's default JSON parser consumed the raw bytes signature verification needs; raw-string parsing restored them.
- **Deferred:** email/SMS channels ride the webhook adapter pointed at an Apprise sidecar (ADR-pattern, documented at VEOC-40 deployment); a production timer loop for scheduled rules lands with the app runtime at VEOC-21; notification bombing caps (threat B7) tighten at VEOC-37.
- **Facets:** F4 `implemented`.
- **Rollback:** revert the VEOC-14 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-15: File library and search

- **Session:** VEOC-15, executed 2026-09-17
- **Starting HEAD:** `d778ced2018f67cd51b1872d7f64df27fd1164bf`
- **Files created:** `server/migrations/0008_files.sql` (immutable file rows under the append-only trigger; version chains via supersedes; GIN full-text indexes over records, libraries, file names, and the chronology), `server/src/files/service.ts` (content-addressed BlobStore on plain disk keyed by SHA-256, atomic tmp-rename writes, dedupe by construction; upload with type allowlist, size cap, empty-file rejection, audit event; permission-aware search running entirely under the actor's RLS context), `server/src/files/routes.ts` (base64-JSON upload, metadata, content download, search), `server/src/__tests__/files.test.ts`.
- **Acceptance proven by test (R5, threat B10, AR7):** upload/download byte-identical round trip; identical content stored twice is one blob under two rows; a superseding version leaves version 1 downloadable byte-identical; UPDATE and DELETE on file rows rejected even for the table owner; executables refused; search returns records, libraries, files, and chronology entries for a member, a board-scoped guest gets exactly that board's records and nothing else, and an outsider gets 403; storage is a plain directory (temp dir in tests), no external service anywhere.
- **Verification:** `pnpm check` fully green; 107/107 tests across 16 files. One search defect found by test and fixed: Postgres tokenizes filenames as single file-type tokens, so separators normalize to spaces in both the index expression and the query.
- **Facets:** R5 `implemented`; F1 attachments groundwork.
- **Deferred:** multipart streaming upload replaces base64 JSON with the app shell (VEOC-21); storage quota accounting per jurisdiction at VEOC-38; attachment rendering never happens server-side by policy (B10), enforced by absence.
- **Rollback:** revert the VEOC-15 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-15A: Native private and group messaging

- **Session:** VEOC-15A, executed 2026-09-17
- **Starting HEAD:** `4a7694d707633a870571af323efea16545b1ef7c`
- **Files created:** `server/migrations/0009_messaging.sql` (threads with person AND position members; append-only messages with a unique client-message index for offline idempotence; jurisdiction_settings holding retention days and the incident-record flag; participation resolves at read time through active position assignments), `server/src/messaging/service.ts` (direct/group threads, idempotent posting, retention-windowed reads, thread export as record lines, admin settings), `server/src/messaging/routes.ts`, `server/src/__tests__/messaging.test.ts`.
- **Acceptance proven by test (R6):** two people message with no collaboration backend configured anywhere, and a non-participant (even an admin) cannot post into their direct thread; a message to the Operations Section Chief seat reaches the current holder, and after a shift change the new holder reads the full seat history while the old holder loses the thread entirely (RLS hides it); a retried client message id lands exactly one row (the offline queue's idempotence); messages cannot be edited by anyone including the table owner; incident-thread traffic lands in the chronology as message.sent events by default, stays out when the jurisdiction turns the records flag off, and exports as ordered attributed lines; the retention window hides expired messages from reads while destruction remains a separate out-of-band records act (rows persist).
- **Verification:** `pnpm check` fully green; 115/115 tests across 17 files.
- **Defect found and fixed:** Postgres applies SELECT policies to INSERT..RETURNING, so thread creation failed before the creator's member row existed; creators now have standing read on threads they created, which the operational-record posture wants anyway. (A first debug attempt asserted nothing and looked green; noted as a reminder that such a test proves nothing.)
- **Design notes:** live push for messages rides the app shell at VEOC-21 (the since-cursor endpoint plus idempotent posting already gives offline-first semantics); VEOC-32 adapters remain the path to full Teams-parity chat per the roster.
- **Facets:** R6 `implemented` (native lane).
- **Rollback:** revert the VEOC-15A commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-16: Geo-enabled boards and standards-facing publishing

- **Session:** VEOC-16, executed 2026-09-17. Phase C opens.
- **Starting HEAD:** `5572913ac02dd6ddbd42a7e50e80f6ef99e48406`
- **Infrastructure:** PostGIS 3 installed into the sandbox cluster (apt); CI service image switched to postgis/postgis:16-3.4.
- **Files created/changed:** shared field model gains the `geometry` type with strict GeoJSON validation (Point/LineString/Polygon, finite coordinates, optional kind constraint) and a `geometryFieldKey` helper; the standard road_closures template carries an optional location geometry; `server/migrations/0010_geo.sql` (postgis extension, `geom geometry(Geometry,4326)` column on board_records, partial GIST index); both write paths (REST service and sync hub checkpoint) populate `geom` from the record's geometry field via one shared PostGIS expression helper; `server/src/geo/routes.ts` (OGC API - Features read surface: landing, conformance for the Core and GeoJSON classes, collections listing every visible board that has a geometry field, items as GeoJSON FeatureCollection with bbox and limit); `server/src/__tests__/geo.test.ts`.
- **Acceptance proven by test (F6, INV-4):** a road closure posted through the ordinary board API appears in the OGC items feed on the immediately following request as a valid RFC 7946 Feature with masked properties and its geometry, and the PostGIS column holds `POINT(-123.61 41.29)`; bbox filtering returns only the feature inside the envelope; landing/conformance/collections describe the service; an outsider gets 404 on items and an empty collections list, the same wall as everywhere else; malformed geometry (Infinity coordinates, unknown types) is rejected at the schema.
- **Verification:** `pnpm check` fully green; 120/120 tests across 18 files.
- **Deferred:** the interactive COP map over this surface is VEOC-17; real QGIS client consumption is exercised at deployment/pilot (structural GeoJSON conformance asserted now); WFS-T-style writes are out of scope by design (writes go through the board API where validation and audit live).
- **Facets:** F6 `implemented` (publishing half); INV-4 first native standards surface live.
- **Rollback:** revert the VEOC-16 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-17: The common operating picture

- **Session:** VEOC-17, executed 2026-09-17
- **Starting HEAD:** `f86ce7623bfa3df0050c46b13f3a7cdc885f2f05`
- **Files created/changed:** `web/src/cop/symbology.ts` (NAPSG-aligned status framing: domain enum values map to normal/warning/critical/unknown frames, colorblind-safe status colors per theme, a MapLibre color expression driven by the tagged status), `web/src/cop/layers.ts` (feature tagging, fill/line/circle layer specs per board, the offline-first base style with an optional PMTiles vector basemap underneath), `web/src/cop/CopMap.tsx` (the COP React component: every geo board is a togglable live layer over the OGC items feed, polling now, push riding the app shell at VEOC-21), `web/cop-demo/` (the E2E harness page), `web/src/vite-env.d.ts`, `server/src/__tests__/cop-e2e.test.ts`; maplibre-gl 6 and pmtiles enter web dependencies, playwright-core enters server dev dependencies.
- **Acceptance proven by test (F6, F14, F19, INV-3):** unit tests pin the symbology mapping, tagging, layer construction, and the base style's zero external references; the real-browser test builds the demo with vite, boots headless Chromium against the live API with every non-local request blocked, and proves the closure renders on the map (`queryRenderedFeatures` on the point layer returns the feature with its critical status tag) and that a closure posted through the field API appears on the rendered map inside the 5-second budget, with zero external network requests observed.
- **Verification:** `pnpm check` fully green; 128/128 tests across 20 files. First CI run failed on exactly one thing: the browser test hardcoded the sandbox Chromium path, which does not exist on a GitHub runner; a follow-up commit resolves the browser from a candidate list (env override, sandbox Chromium, the runner's system Chrome).
- **Defect found and fixed (the whole session's fight):** MapLibre v6 resolves its web worker from a sibling URL of the executing bundle, so under any bundler the worker request 404s, the dispatcher waits forever, and the map silently never loads a single tile: source object populated, layers present, canvas black. Every deployment would have shipped a dead map. The fix routes the worker through the bundler (`?worker&url` emit plus `setWorkerUrl`) in the one place maps are constructed. The E2E test is the standing regression guard: a broken worker setup fails it in seconds. An earlier diagnosis blamed headless GPU rasterization; that was wrong, and the browser test was almost weakened to accommodate the exact bug it existed to catch.
- **Facets:** F6 `implemented` end to end (field-to-COP loop proven in a real browser); F14 `implemented`; F19 `implemented` (status framing; the full symbol set grows with F8 at VEOC-20); register drift corrected (dispositions declared by earlier receipts now reflected in the table).
- **Deferred:** vector basemap packaging for deployments (PMTiles wiring is live behind a URL) to VEOC-21/deploy; sensor and drone feeds to VEOC-19; Lifelines overlays to VEOC-20.
- **Rollback:** revert the VEOC-17 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-18: Dashboards without the join trap

- **Session:** VEOC-18, executed 2026-09-17
- **Starting HEAD:** `3a8244c0786e1c664a7954b46339c3b4b0e37386`
- **Files created/changed:** `shared/src/dashboards/def.ts` (dashboard definitions as versioned templates: tile, chart, status, and list widgets bound to board TEMPLATE keys with jsonb filters; snapshot result types; the standard `eoc_status` dashboard), a `lifelines` standard board template (lifeline + condition enums straight from the FEMA dictionary, newest entry per lifeline is current), `server/migrations/0011_dashboards.sql` (dashboard_templates and dashboards tables under the same RLS shape as boards), `server/src/events/bus.ts` (in-process post-commit board event bus; REST and sync writes both publish), `server/src/dashboards/service.ts` (every widget is one server-side SQL aggregate under the caller's RLS context; latest-per-group via a window function; list columns masked by field readability; a widget whose board is absent reports itself missing instead of failing the picture), `server/src/dashboards/routes.ts` (REST plus a WebSocket stream that pushes a debounced recomputed snapshot on every bound-board change), `web/src/dashboards/Dashboard.tsx` (renders the snapshot: tiles with threshold levels, bar chart, lifeline status grid with doctrine colors, record lists; no fetching of raw rows, ever), tests both sides. The @fastify/websocket plugin registration moved from the sync routes to the app root so multiple WS surfaces share it.
- **Acceptance proven by test (AR6, R-none, INV-8):** a lifelines status dashboard over three related boards (lifelines, shelters, road closures) computes entirely server-side in one snapshot: closed-road tile with thresholds, shelters-by-status chart, latest-condition-per-lifeline status widget (a later energy entry supersedes the earlier one while all history rows remain), filtered closure list; a field edit pushes a recomputed snapshot over the stream inside a 2-second budget (measured); definitions export byte-equal, re-import under a new key, and stand up in a second jurisdiction where a missing board yields a marked-missing widget, not a failure; template registration is instance-admin gated; an outsider gets 404.
- **Verification:** `pnpm check` fully green; 136/136 tests across 22 files.
- **Defect found and fixed:** parameterized `DISTINCT ON` expressions cannot match the ORDER BY syntactically under a driver that numbers each interpolation, so latest-per-group uses `row_number()`; jsonb-typed filter equality misbehaved under parameter type inference, so filters compare the field's text projection, proven by test.
- **Facets:** AR6 partially discharged (the join-poor-dashboard half; session-timeout and free-text-drift halves remain with their sessions); groundwork for F8 (VEOC-20 builds lifelines entry UX on the new board and widgets).
- **Deferred:** dashboard definition UI (no-code designer parity) rides VEOC-41 polish; per-widget refresh over Yjs awareness is unnecessary while snapshots are cheap; briefing view composition is VEOC-20.
- **Rollback:** revert the VEOC-18 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-19: Live feeds and sensor ingestion

- **Session:** VEOC-19, executed 2026-09-17
- **Starting HEAD:** `39122f202ab78ac7bbfe7cd98b2012b346179e28`
- **Files created/changed:** `server/migrations/0012_feeds.sql` (feeds + feed_items with RLS; a documented server-internal scheduler lane lets the process list due feeds while every actual poll runs under the feed creator's authority), `server/src/feeds/parse.ts` (CAP 1.2 subset with lat,lon polygon/circle handling, GeoRSS points, Cursor-on-Target events, GeoJSON collections; anything unparseable throws so it alarms instead of yielding a quiet empty), `server/src/feeds/service.ts` (poll and push ingestion, bounded per-target track history for position streams, health with staleness, the failure alarm as notification + audit + counters while the feed stays enabled), `server/src/feeds/routes.ts` (CRUD, poll-now, GeoJSON items with provenance and staleness on every feature, token-authenticated push endpoint taking XML or JSON), `principalForPerson` in the auth service (session-less principal for server-internal acts), `web/src/cop/feeds.ts` (feed layer tagging: stale features drop to the unknown frame whatever their severity claimed, with source and human age on every feature; layer specs mirror board layers), tests both sides. fast-xml-parser (MIT) enters server dependencies.
- **Acceptance proven by test (F18):** a simulated NWS CAP flood warning polls in and renders as a polygon layer carrying source, severity, and freshness; a simulated drone pushes two CoT positions through the token wall and renders as ONE aircraft at its latest position with a chronological track; a feed past its freshness window flags stale at the feed and feature level, and the web tagging forces stale features to the unknown frame; a 500 from the source marks the feed, raises a notification and an audit event, leaves the feed enabled, and the next good poll clears the flags; an HTML maintenance page is a parse failure, not an empty success; the scheduler polls due feeds under their creators' authority and the interval gates the next round; members read feed layers, outsiders cannot; wrong or missing push tokens are 401.
- **Verification:** `pnpm check` fully green; 149/149 tests across 24 files.
- **Facets:** F18 `implemented`; F19 symbology extended to feed provenance.
- **Deferred:** NWS/IPAWS-specific endpoint catalogs and CAP geocode (SAME/FIPS) resolution to VEOC-31 (IPAWS session); feed layers in the CopMap screen wiring at VEOC-21 app shell (the layer construction and tagging are the tested surface now); WMS/WFS upstream sources considered out of scope for the framework (GeoJSON export exists on the other side).
- **Rollback:** revert the VEOC-19 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-20: Situation reporting and briefing views

- **Session:** VEOC-20, executed 2026-09-17
- **Starting HEAD:** `76d49b461d03028bfab6c6040c117b95b1fe9889`
- **Files created/changed:** `shared/src/sitreps/def.ts` (sitrep content schema: frozen lifelines-current, per-board summaries, significant-event lines), `server/migrations/0013_sitreps.sql` (sitreps table under the audit substrate's three walls: no UPDATE/DELETE grant to the runtime role, the shared immutability trigger, RLS), `server/src/sitreps/service.ts` (lifelines-current as latest-entry-per-lifeline over the jurisdiction's lifelines board with all eight always present; single-lifeline set that leaves the rest untouched; one-action sitrep composition freezing current board state; list and get for the briefing), `server/src/sitreps/routes.ts` (lifelines GET/PUT, sitrep compose/list/get), `web/src/sitreps/BriefingView.tsx` (the Incident Status Dashboard read: lifeline conditions in doctrine colors, board status, significant events, rendered from the archive), tests both sides.
- **Acceptance proven by test (F8 lifelines/sitrep half):** all eight lifelines return, unknown until entered; setting `water_systems` leaves a prior `energy` entry and its note intact, and re-setting `energy` updates only it (newest entry wins, the rest remembered); unknown lifeline or status is 400; a sitrep composes from live board state in one POST (lifelines frozen at current condition, shelters summarized 2 records = {normal:1, closed:1}, the significant event carried in); after composing, adding a shelter does NOT change the archived sitrep (still 2 records) and the database refuses both UPDATE and DELETE on the sitrep row; list is newest-first and an outsider gets 403; the briefing view renders lifelines, board status, and events for an executive read.
- **Verification:** `pnpm check` fully green; 156/156 tests across 26 files.
- **Facets:** F8 lifelines-and-sitrep half delivered; F8 stays `open` in the register until VEOC-23 adds the PDA-outputs half (the register has no partial disposition, and PDA is a distinct large piece). The `lifelines` board from VEOC-18 is now the doctrine-as-schema substrate for lifeline entry.
- **Deferred:** PDA (preliminary damage assessment) outputs and pre-disaster baseline to VEOC-23; sitrep PDF/print export and PIO statement templating to VEOC-33A (JIC); sitrep composition currently summarizes every non-archived board, incident-scoped composition (via the optional incidentId) narrows once the app shell passes it.
- **Rollback:** revert the VEOC-20 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-21: Offline-first field client

- **Session:** VEOC-21, executed 2026-09-17. Phase D opens.
- **Starting HEAD:** `485d73d8c257bf0b501dc1fa7853d775aa04da25`
- **Files created/changed:** `web/src/offline/store.ts` (IndexedDB durable store: one Yjs state blob per board plus a meta store for the cached session and assigned-board catalog), `web/src/offline/field-client.ts` (the offline-first client: hydrate a local Yjs doc per board, edit with no network, persist synchronously with each edit, track a durable dirty set, `flush` a queued board through an injected transport, `sync` wrapping that transport around the sync WebSocket, and `renew` that trades the cached resume token for a fresh access token on reconnect without touching queued edits), `web/public/manifest.webmanifest` (installable standalone PWA), `web/public/sw.js` (app-shell cache-first for offline boot, API traffic never cached so stale data never stands in for live), `web/src/offline/register.ts` (safe service-worker registration), web unit tests (fake-indexeddb) for offline edit + restart recovery + field-level merge across restart + flush + session caching, a PWA packaging test, and `server/src/__tests__/field-offline.test.ts` driving a persistent client (same durable-doc + sync protocol as the browser class) through the full loop against a real server. `yjs` enters web deps; `@types/node` and `fake-indexeddb` enter web dev deps; the eslint config gains a service-worker globals block.
- **Acceptance proven by test (AR6 session half, AR7 field half, INV-3):** a field user edits two closures in airplane mode (no socket touched), reads them back, and the server has nothing yet; on reconnect the queued state reconciles into board_records with zero conflicts and the audit trail attributes both creates as sync-origin; an edit made offline and then subjected to an app restart (a fresh client from the same durable store, no memory) survives and reaches the server on the next reconnect; a disconnected session renews via the cached resume token and syncs under the fresh access token with the queued edit intact; the web-side durability unit tests prove the same offline/restart/flush semantics in the shipped client class with fake-indexeddb, and field-level edits from before and after a restart merge into one record (VEOC-13 semantics); the PWA ships an installable standalone manifest and a shell-caching service worker that never caches the API.
- **Verification:** `pnpm check` fully green; 166/166 tests across 29 files. (A stale local Postgres socket from an earlier idle period was restarted before the run; not a code fault.)
- **Facets:** INV-3 `implemented` (disconnection is the normal case, now proven end to end: offline edit, restart persistence, reconnect, reconcile); AR6 `implemented` (all three named traps closed: session-timeout via offline resume-token renewal here, free-text drift via boards-as-schema, join-poor dashboards via VEOC-18); AR7 stays `open` until offline PROVISIONING (VEOC-08/41) joins offline operation.
- **Deferred:** offline provisioning (creating a jurisdiction/incident while disconnected) to VEOC-41; real-browser airplane-mode + install-prompt + service-worker E2E to pilot (the durable data loop is proven here in Node and jsdom, the strongest evidence for "nothing lost"); wiring the FieldClient into the app-shell UI and pushing feed/board layers through it at the shell build (VEOC-33/41); PWA icons are referenced but the binary assets are added at branding.
- **Rollback:** revert the VEOC-21 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-22: Smart forms, XLSForm-compatible

- **Session:** VEOC-22, executed 2026-09-17
- **Starting HEAD:** `d92a7f88824c5a42c4849707d53e378dfe61c9c3`
- **Files created/changed:** `shared/src/forms/expr.ts` (a conformant subset of the XLSForm/ODK-XForms expression language: `${refs}`, the XForms operators including `div`/`mod`/`and`/`or`, and the functions the FEMA PDA templates use — `if`, `selected`, `count-selected`, `coalesce`, `round`, `string-length`, `concat`, `not`, `number`/`int`; a tokenizer, precedence-climbing parser, and evaluator, pure and cached), `shared/src/forms/xlsform.ts` (the form model plus `importXlsForm` from normalized survey/choices/settings rows into a nested tree of fields, groups, and repeats with every logic column preserved, choice-list resolution, and a zod schema), `shared/src/forms/runner.ts` (the pure offline runner: relevance gating, calculations run to a fixed point, required and constraint checks, repeat instances evaluated with instance-local bindings, and a relevant-only submission), `server/migrations/0014_forms.sql` (versioned per-jurisdiction form_definitions under RLS; submissions are not stored here, they become board records), `server/src/forms/xlsx-import.ts` (real .xlsx reader via SheetJS into normalized rows), `server/src/forms/service.ts` (store/list/get, and submit: run the form, map values to the target board by field name, convert the geopoint to the board's geometry, and write through the existing schema engine with an audit event), `server/src/forms/routes.ts` (xlsx import, JSON import, list, get, submit with 422 on form-validation errors), tests: a shared conformance suite (expression semantics, import golden structure, runner relevance/calc/constraint) and a server suite that builds a real .xlsx, imports it through the API, and lands a capture on a board with geometry. SheetJS `xlsx` (Apache-2.0) enters server deps.
- **Acceptance proven by test (F7):** the expression engine matches XForms semantics (precedence, `div`/`mod`, numeric-string comparison, `selected()` over space-joined multi-values, `if`/`coalesce`/`round`); a representative PDA-style XLSForm imports from a real .xlsx with its choice lists, repeat, and logic columns intact; the runner hides an irrelevant field and drops it from the submission, shows and calculates it when relevant, enforces relevance-aware required, and reports constraint violations with their messages; a capture submitted through the API runs the form logic and lands on the road-closures board as `POINT(-123.61 41.29)` with masked fields; a capture missing a required field is refused 422 with the field error; import is admin-only.
- **Verification:** `pnpm check` fully green; 180/180 tests across 31 files; license-scan clean at 300 packages.
- **Defect found and fixed:** first reached for exceljs, which pulls `unzipper → binary → buffers@0.1.1`, a transitively no-license package that broke the previously-clean license scan (AR5/INV-9); replaced it with SheetJS `xlsx` (Apache-2.0, all-Apache-2.0 tree) and pruned the orphaned store, restoring a zero-warning scan. Also: the `form.imported` audit event passed a composite `key:version` into `audit_events.subject_id`, which is a uuid column; now uses the inserted row's id.
- **Facets:** F7 `implemented` (offline XLSForm-compatible smart forms writing to boards through the schema engine).
- **Deferred:** the form-runner UI (rendering the tree through the design system with photo/GPS capture widgets) rides the app shell at VEOC-33/41; importing FEMA's exact published Survey123 PDA workbooks is exercised at pilot with the real files (the import path and a representative PDA form are proven now); XLSForm features beyond the implemented subset (cascading selects via `choice_filter`, `indexed-repeat`, external instances) are additive and tracked for when a real template needs them.
- **Rollback:** revert the VEOC-22 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-23: Damage assessment with pre-disaster baseline

- **Session:** VEOC-23, executed 2026-09-17
- **Starting HEAD:** `186284bdea6e823ac8905c56c4d0d6c3f0fb9395`
- **Files created/changed:** `shared/src/damage/summary.ts` (pure aggregation over approved assessments into a `DamageSummary` — counts by FEMA degree, total and uninsured loss, destroyed-or-major count, and the IA/PA declaration indicators — plus `renderDeclarationSupport`, which composes the declaration-support document from exactly those numbers so the paperwork can never disagree with the data), `server/migrations/0015_damage.sql` (damage_baselines, damage_assessments quarantined by a status column, and a damage_intake config, all under RLS), `server/src/damage/intake-limit.ts` (fixed-window public-intake throttle), `server/src/damage/service.ts` (baseline import with a documented CSV→rows pipeline, official field assessment approved on create, token-gated rate-limited public self-report intake landing as submitted under the enabling owner's authority, moderation, and aggregation/export reading only approved rows), `server/src/damage/routes.ts` (baseline, assessments, the public report endpoint with no session, moderation, summary, and declaration export), tests: a shared golden aggregation suite and a server suite covering the baseline-to-declaration path and the moderation quarantine. Uses the existing PDA dictionary (degrees, structure types, PA categories) without narrowing it.
- **Acceptance proven by test (F8 PDA half, F9):** a baseline imports and official assessments against it aggregate to a summary with correct by-degree counts, total and uninsured loss, and met IA/PA thresholds; the declaration export renders the FEMA-shaped document from those exact figures; a public self-report is accepted only with the intake token, is refused with a wrong token, and — the load-bearing property — does NOT move the summary while it sits unmoderated; it counts only after a moderator approves it, a settled report cannot be re-moderated, and the intake throttle caps a flood at the window limit; assessments stay behind the jurisdiction wall; unknown degrees and non-admin baseline import are refused.
- **Verification:** `pnpm check` fully green; 195/195 tests across 33 files; license-scan clean.
- **Facets:** F8 `implemented` end to end (lifelines/sitrep half at VEOC-20, PDA-outputs half here); F9 `implemented` (pre-disaster baseline and assessment against it).
- **Deferred:** real GIS parcel-roll ingestion (shapefile/GeoJSON parcel import) to pilot — the row shape, upsert, and CSV pipeline are fixed and tested now; PA category work-type cost tracking (categories A–G) is a thin extension of the same aggregation when a jurisdiction needs PA project worksheets; the field-assessment and public-report UIs ride the app shell (VEOC-33/41); population and the PA per-capita indicator are request inputs (FEMA sets the indicator annually) rather than hardcoded.
- **Rollback:** revert the VEOC-23 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-24: Check-in, staffing, and scheduling

- **Session:** VEOC-24, executed 2026-09-17
- **Starting HEAD:** `aeae317c835853858cbc78adbb6fa74a4452f618`
- **Files created/changed:** `server/migrations/0016_staffing.sql` (badges, staff_checkins with a `client_checkin_id` for offline idempotence, and shifts, all under RLS), `server/src/staffing/service.ts` (badge issue; check-in bound to a position, idempotent on the client id and refusing a second open check-in for the same person+position, feeding the activity log; scan check-in resolving the person from a badge; check-out; shift scheduling with same-position and same-person overlap conflict detection; and a live staffing summary of on-duty, vacancies, and upcoming shifts), `server/src/staffing/routes.ts`, app wiring.
- **Acceptance proven by test (supports F2, R4):** a member checks in to a position, shows on the staffing summary as on duty while other positions read vacant, and the check-in lands in the activity log; check-out returns the position to vacant; a badge scan checks the person in, and a replayed offline scan with the same client id reconciles to exactly one row (the offline path), while an unknown badge is 401; overlapping shifts for the same position or the same person are refused 409, back-to-back shifts are allowed, and a shift that ends before it starts is 400.
- **Verification:** `pnpm check` fully green; 200/200 tests across 34 files; license-scan clean.
- **Facets:** no dedicated register row; reinforces F2 (position-bound activity logging) and R4 (fluid Command and General Staff work) — dispositions unchanged, recorded here.
- **Deferred:** the check-in kiosk and staffing-dashboard UIs ride the app shell (VEOC-33/41); QR encoding/printing of badges is a client concern (the badge token and scan resolution are the tested surface); shift-coverage gap detection against required incident positions is a thin extension once incident-scoped staffing is wired at VEOC-33.
- **Rollback:** revert the VEOC-24 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-25: Tracking objects and reunification

- **Session:** VEOC-25, executed 2026-09-17. Phase D closes.
- **Starting HEAD:** `fecd2ebba8f2d2206f9b68753988da9013df9785`
- **Files created/changed:** `server/migrations/0017_tracking.sql` (tracked_objects anchored by a scan tag with a separate `restricted` jsonb column, and tracking_events forming the custody chain, under RLS), `server/src/tracking/service.ts` (register an object and open its chain; a scan by tag that any agency appends to; get-object with the restricted column masked for anyone below operational staff — the need-to-know wall, matching the board field-masking pattern; and a reunification query that reads whereabouts by tag or label search and never touches the restricted column), `server/src/tracking/routes.ts`, app wiring. Built on the existing tracking dictionary (kinds, custody states) without narrowing it.
- **Acceptance proven by test (F11):** a patient registered with restricted health/identity gets a tag; scans at field, transport, receiving facility, shelter, and discharge — each a different agency — form one continuous ordered custody chain under that one tag; operational staff see the restricted details, a viewer (reunification desk) sees the chain and whereabouts but the restricted column is redacted; a reunification query by tag returns the latest custody state and location with no restricted data in the payload (asserted by absence of the name and condition strings), and a label search finds the object; unknown kinds/states are 400, an unknown tag scan is 404, an outsider is 403, and a viewer cannot register or scan.
- **Verification:** `pnpm check` fully green; 206/206 tests across 35 files; license-scan clean.
- **Facets:** F11 `implemented` (scan-first tracking objects with a cross-agency custody chain, field-level need-to-know, and reunification).
- **Deferred:** cross-jurisdiction/mutual-aid reunification (a guest `tracking:reunify` scope so a partner agency queries whereabouts across a conglomerate) rides the federation work (Phase E) and VEOC-08 guest scoping — within-jurisdiction roles carry the permission model now; scenario-specific minimal capture forms reuse the VEOC-22 form runner at the shell; QR/barcode encoding is a client concern (the tag is the tested handle).
- **Rollback:** revert the VEOC-25 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-26: CAP 1.2 in and out

- **Session:** VEOC-26, executed 2026-09-17. Phase E opens.
- **Starting HEAD:** `60475f8968c570158037842832f18ca5aed38e38`
- **Files created/changed:** `shared/src/cap/model.ts` (CAP 1.2 alert/info/area model and zod schema with the standard's enumerations), `shared/src/cap/validate.ts` (base CAP 1.2 structural validation and, layered on it, the FEMA IPAWS Profile v1.0 checks — the IPAWS code, and per-info expires/effective/senderName/description, a SAME eventCode, and a targeted area), `shared/src/cap/xml.ts` (full-fidelity CAP-namespaced XML serialize and parse via fast-xml-parser, repeatable elements forced to arrays so single and multiple parse identically), `server/migrations/0018_cap.sql` (cap_alerts storing structured form and XML, origin authored/ingested, computed IPAWS eligibility, under RLS), `server/src/cap/service.ts` (author-and-publish from incident context with validation and a notification; full-fidelity ingest of external CAP XML, idempotent on identifier), `server/src/cap/routes.ts` (author, ingest, list, get with an `?format=xml` view), app wiring. fast-xml-parser (MIT) added to shared so authoring and validation run offline in the field client too (INV-3).
- **Acceptance proven by test (F20 partial, INV-4):** a golden alert validates against base CAP 1.2 and the IPAWS profile, and round-trips model→XML→model with full fidelity (including multiple info blocks, multiple areas, polygons, circles, and SAME geocodes); profile violations (missing IPAWS code, expires, SAME eventCode, targeted area) are each caught; on the server, authoring stamps identifier and sent, validates, stores with XML, and marks IPAWS eligibility (true for a profile-complete alert, false for a valid-but-non-profile one), an invalid alert is 422 with issues, external CAP XML ingests with full fidelity and idempotently and lands as a notification, and unparseable XML is refused.
- **Verification:** `pnpm check` fully green; 217/217 tests across 37 files; license-scan clean at 300 packages.
- **Facets:** F20 (native standards interchange) advanced — CAP in and out is live; F20 stays `open` until EDXL (VEOC-27), facility status (VEOC-28), sensor/GIS standards (VEOC-29), and IPAWS transmission (VEOC-31) complete the set.
- **Deferred:** actual IPAWS-OPEN transmission (COG credentials, the enable-at-will switch, R2) to VEOC-31 — eligibility is computed and stored now; scheduled polling of external CAP endpoints reuses the VEOC-19 feed framework (which already renders CAP as map layers), so this session focused on authoring/publishing and fidelity; the authoring UI rides the app shell.
- **Rollback:** revert the VEOC-26 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-27: EDXL envelope and resource messaging

- **Session:** VEOC-27, executed 2026-09-17
- **Starting HEAD:** `ee063d05b0d36a8fcc61710a9af80d6f83ca1ea6`
- **Files created/changed:** `shared/src/edxl/edxl.ts` (EDXL-DE 1.0 distribution envelope and EDXL-RM 1.0 resource-message models with zod; the documented, bijective 213RR↔EDXL-RM field mapping; nested-XML serialize/parse that embeds the RM as real XML inside the DE contentObject with full fidelity; and `addressedTo` for explicit-address routing scope), `server/src/edxl/service.ts` (emit a resource-request board record as an EDXL-DE(+RM) envelope stamped with the jurisdiction's slug as sender and optional recipient addresses; import an envelope, refusing one not addressed to the importing jurisdiction, and land the RM back on that jurisdiction's resource-request board through the schema engine), `server/src/edxl/routes.ts` (emit from a record, import to a jurisdiction), app wiring. Reuses fast-xml-parser already in shared; no new dependencies.
- **Acceptance proven by test (F20 partial, INV-4):** a 213RR maps to EDXL-RM and back with no loss; the DE envelope serializes to DE/RM-namespaced XML and parses back identically (embedded RM intact); explicit addressing gates consumption (addressed-to true/false, empty = broadcast); on the server, a request emitted from one jurisdiction re-imports on a second jurisdiction and the reconstructed board record equals the original field-for-field; an envelope addressed elsewhere is refused 403 by the intended recipient's own instance, a broadcast imports anywhere, and unparseable EDXL is 400.
- **Verification:** `pnpm check` fully green; 224/224 tests across 39 files; license-scan clean.
- **Facets:** F20 advanced (EDXL-DE enveloping and EDXL-RM resource messaging on the 213RR lane); stays `open` until facility status (VEOC-28), the remaining standards surfaces (VEOC-29), and IPAWS (VEOC-31).
- **Defect found and fixed:** the first server test omitted `ensureStandardTemplates`, so the resource-request board never created and emit 500'd on an undefined board id; added the seed. (The bug was in the test setup, not the EDXL code.)
- **Deferred:** the full EDXL-RM message set beyond RequestResource (ResponseToRequestResource, RequisitionResource, commit/release) extends the same model as the 213RR lifecycle drives them; targetArea and recipientRole routing beyond explicitAddress are additive to `addressedTo`; a transport/broker for actually moving envelopes between instances (vs. copy-paste/file exchange) is a deployment concern.
- **Rollback:** revert the VEOC-27 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-28: Facility status networks

- **Session:** VEOC-28, executed 2026-09-18
- **Starting HEAD:** `d711e5bed7529963afd52e0b728086a9e8153d08`
- **Files created/changed:** `shared/src/have/have.ts` (EDXL-HAVE 2.0 export from a facility-status snapshot: organization, EMS traffic, bed capacity per type, facility status, service coverage, staleness), `server/migrations/0019_facilities.sql` (standing facilities registry, append-only status reports, status_queries and status_query_targets for fan-out and response tracking, all under RLS on the EDXL-HAVE dictionary), `server/src/facilities/service.ts` (register a facility; report status, which also closes any open query target for that facility; the always-on board computing current status and per-facility staleness against each facility's freshness window; launch a query that fans out to a facility kind; query completeness with the outstanding list; EDXL-HAVE export), `server/src/facilities/routes.ts`, app wiring. Uses the existing EDXL-HAVE dictionary (facility kinds, operating status, EMS traffic, bed types).
- **Acceptance proven by test (F10):** the always-on board shows each facility's current status and flags staleness (a facility reported two hours ago is stale against a one-hour window, a never-reported facility is stale); a "report now" query fans out to a kind (both hospitals, not the shelter), tracks completeness as responded/total with the outstanding list, advances as each facility reports, and reads complete when all have; the current picture exports as EDXL-HAVE-namespaced XML with organization names, facility status, EMS traffic, and bed capacity.
- **Verification:** `pnpm check` fully green; 227/227 tests across 40 files; license-scan clean.
- **Facets:** F10 `implemented` (always-on facility status networks with event-driven queries and HAVE export); F20 advanced further (HAVE export is another native standards surface).
- **Deferred:** HAVE import/round-trip (this session exports; ingesting a partner's HAVE feed reuses the VEOC-19 feed framework and the same dictionary); auto-launching a status query on a schedule reuses the notification scheduler; the status-board and query UIs ride the app shell.
- **Rollback:** revert the VEOC-28 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-29: CoT/TAK gateway and the field-node decision

- **Session:** VEOC-29, executed 2026-09-18
- **Starting HEAD:** `8a906997b7f797b6dfadc4d8d9ae72cdf28f9f80`
- **Files created/changed:** `docs/adr/ADR-0008-cot-gateway-and-field-node.md` (the field-node language decision), `shared/src/cot/cot.ts` (CoT event model, XML serialize/parse with attributes, and the bidirectional mapping: inbound CoT → COP GeoJSON feature, VEOC geo record → CoT event), `server/src/cot/service.ts` (ingest a CoT event onto a per-jurisdiction CoT feed layer; emit a geo board record as CoT), `server/src/cot/routes.ts`, app wiring.
- **The decision (ADR-0008):** the CoT/TAK gateway is implemented in TypeScript, not as a Rust single binary. The gateway is I/O-bound XML translation at the scale in scope, the CoT model is already TypeScript and reused offline by the field client, and a single-language stack is the project's posture (INV-10). The `field-node/` Rust crate stays a documented, CI-compiled placeholder so the native single-binary path remains open and reversible; a future native relay consumes the same CoT model and API. **This decision was flagged in the roster for Basho; he was away under the standing authorization, so ADR-0008 records the reversible default and rationale for his review — he can direct the Rust path without changing the gateway's semantics.**
- **Acceptance proven by test (F20 partial; ADR present):** a CoT event round-trips XML→model→XML with attributes and detail intact; an inbound ATAK track maps to a COP feature and, through the ingest endpoint, lands on the CoT feed layer that the COP renders (GeoJSON with the right coordinates and a CoT/TAK provenance tag); a VEOC geo board record emits as CoT XML that a TAK fixture (parsing it back) sees with the record's uid, position, and callsign; non-point geometry and a record with no geometry are refused.
- **Verification:** `pnpm check` fully green; 235/235 tests across 42 files; license-scan clean; the field-node Rust crate remains under `cargo check`/`clippy` in CI (ADR-0008 keeps it alive).
- **Facets:** F20 advanced (CoT/TAK bidirectional bridge); F18 reinforced (CoT sensor/track ingestion onto the COP alongside VEOC-19).
- **Deferred:** a live TCP/UDP/multicast CoT transport and TLS to a real TAK server is a deployment/gateway-runner concern (the translation and relay semantics are proven here); if a native field node is later adopted, ADR-0008 is revisited and the Rust crate implements the same contract.
- **Rollback:** revert the VEOC-29 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-30: Instance federation, store-and-forward

- **Session:** VEOC-30, executed 2026-09-18
- **Starting HEAD:** `aae4f48a9328afeb1916c0a8417591ffe6efacd9`
- **Files created/changed:** `server/migrations/0020_federation.sql` (mutually authenticated peers, per-board sharing agreements, and a store-and-forward outbox, under RLS with the token-authenticated receive lane allowed to resolve a peer with no person context), `server/src/federation/service.ts` (register a peer and mint its token; per-board agreements; queue a board's Yjs update for every peer allowed to read it; list pending; and receive a peer's forwarded batch, authenticated by token, scoped by agreement, applied through the VEOC-13 sync hub so it reconciles and checkpoints, with the convergence attributed to the peer in the audit trail), `server/src/federation/routes.ts` (peer/agreement management, queue, pending, and a peer-token receive endpoint), app wiring that now shares one sync hub between the sync routes and federation.
- **Acceptance proven by test (F3, R3):** two genuinely separate instances (separate databases and app processes) share a board; a scripted partition strands one edit in each instance's outbox while each board holds only its own record; on reconnect the batches deliver over HTTP and both instances converge to the union with zero conflicts and neither loses its own data; each side audits a `federation.received` attributed to the sending peer; an unknown peer token is 401 and a peer aimed at a board it has no agreement for is 403 — delivery is asynchronous store-and-forward with no synchronous dual-commit anywhere.
- **Verification:** `pnpm check` fully green; 238/238 tests across 43 files; license-scan clean.
- **Defect found and fixed (in the test, not the design):** a first single-database test collapsed the two instances into one `board_records` table, whose id is a global primary key, so replicating a record onto the second board updated the original row instead of inserting — a PK collision that cannot occur between real separate-instance databases. Rewrote the test to stand up two independent databases and apps, the honest federation model, and it converges.
- **Facets:** F3 `implemented` (store-and-forward federation with local replication and CRDT convergence); R3 `implemented` (agency/organization/volunteer conglomerate COP access — VEOC-08 guest scoping within an instance plus VEOC-30 federation across instances).
- **Deferred:** the outbox flusher/transport that actually POSTs batches to peer URLs on a schedule (the queue, pending, and receive semantics are proven; wiring a delivery loop is a runner/deploy concern); mutual TLS and key rotation for peer auth is a deployment hardening item on top of the token model; conflict surfacing to operators reuses the VEOC-13 sync_conflicts surface.
- **Rollback:** revert the VEOC-30 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-31: Frozen API contract and IPAWS-OPEN enable-at-will

- **Session:** VEOC-31, executed 2026-09-18
- **Starting HEAD:** `405612ac2abaf2a5f987700c8bee0a0b4720daea`
- **Files created/changed:** `shared/src/api/contract.ts` (the versioned public surface as data: REST endpoints with method, path, tag, summary, and auth mode; sync WebSocket channels; webhook event types; and `generateApiDocs` rendering Markdown grouped by tag), exported from `shared/src/index.ts`; `shared/src/api/__tests__/contract.test.ts` (contract shape, no duplicate endpoints, versioned-prefix and auth-mode invariants, deterministic docs generation); `server/migrations/0021_ipaws.sql` (one `ipaws_config` row per jurisdiction, disabled by default, with the credential held only as an AES-256-GCM envelope plus a display fingerprint, MOA acknowledgment fields, and an `ipaws_submissions` log, all under RLS); `server/src/secrets/envelope.ts` (envelope encryption keyed on `OPENEOC_SECRET_KEY`, fail-closed when unset); `server/src/ipaws/connector.ts` (build the IPAWS-OPEN postCAP SOAP request from a CAP alert, parse the response, injectable transport, no network in the module); `server/src/ipaws/service.ts` (status, configure, acknowledge MOA, the gated enable/disable toggle, and transmit-a-stored-alert with the eligibility gate and audited submission); `server/src/ipaws/routes.ts`, app wiring; `server/src/ipaws/__fixtures__/postcap-{accepted,rejected}.xml` (recorded IPAWS-OPEN responses); `server/src/__tests__/ipaws.test.ts`; `server/src/__tests__/api-docs.test.ts` (regenerates and holds `docs/API.md` to the contract); `docs/API.md` (generated); `docs/IPAWS-ENABLEMENT.md` (operator guide).
- **Acceptance proven by test (F20, R2, INV-4/INV-9):** the API docs generate deterministically from the frozen contract, and a server-side contract test holds the running app to every REST endpoint and WebSocket channel it publishes, so the documented surface and the deployed surface cannot drift; the connector builds a postCAP request that carries the alert and COG (with the CAP document embedded and no nested XML declaration) and reads a recorded acceptance and a recorded SOAP-fault rejection correctly; IPAWS is disabled by default and enabling fails closed (409) until a COG is configured and the documented MOA is acknowledged, after which a single admin toggle takes it live with no redeploy; a member cannot configure (403); transmission is refused while not enabled (403), refuses a CAP alert that is not IPAWS-profile-eligible (422), and on success records an audited, attributed submission; the stored credential is never echoed, only its fingerprint.
- **Verification:** `pnpm check` fully green; 260/260 tests across 46 files; license-scan clean (300 packages); check-links clean (21 markdown files); tsc and eslint clean.
- **Facets:** F20 `implemented` (native standards interchange: CAP/EDXL/HAVE/CoT/OGC plus the frozen versioned contract and IPAWS transmission); R2 `implemented` (IPAWS enable-at-will); INV-4 `implemented` (standards are native); INV-9 `implemented` and AR5 `implemented` (one frozen core contract the app is held to, no unbundling).
- **Deferred:** the live IPAWS-OPEN transport is the connector's default HTTP POST; no FEMA contact or real COG was exercised this session (the connector is proven against recorded fixtures, and the test handshake path validates a real COG against the IPAWS test environment before go-live); mutual-TLS client-certificate material for production IPAWS is a deployment concern layered on the encrypted-credential model; webhook delivery mechanics beyond the published event types reuse the VEOC-14 notification framework.
- **Rollback:** revert the VEOC-31 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-32: Collaboration adapters and incident spaces

- **Session:** VEOC-32, executed 2026-09-18
- **Starting HEAD:** `35a8107394a9211d0e38ab50986b62a8daa92c0c`
- **Files created/changed:** `shared/src/collab/plan.ts` (pure, isomorphic derivation of the channel structure and membership from ICS positions and their holders: `sectionForPosition`, `slugify`, `planIncidentSpace`), exported from `shared/src/index.ts`; `shared/src/collab/__tests__/plan.test.ts`; `server/migrations/0022_collab.sql` (one backend per jurisdiction disabled by default, incident spaces, per-section channels, and a desired-membership mirror, all under RLS); `server/src/collab/adapters.ts` (Mattermost v4 and Matrix client-server v3 adapters as thin HTTP clients over an injectable transport, plus the `CollabAdapter` interface and `adapterFor`); `server/src/collab/service.ts` (configure backend with the token held only as an encrypted envelope; provision a space; reconcile membership as a diff; post announcements; archive on close; and the no-backend degradation to in-app notifications); `server/src/collab/routes.ts`; `server/src/auth/service.ts` gained `reassignPosition` (revoke the current holder, assign the incoming one, so the current holder is unambiguous); `server/src/app.ts` (register collab routes, add the reassignment route, and best-effort membership sync after assignment/reassignment); `server/src/incidents/routes.ts` (best-effort provision on activation when a backend is enabled, archive on close); `server/src/__tests__/collab.test.ts` (fake Mattermost and Matrix backends as in-memory transports).
- **Contract item 11 honored:** collaboration backends are reached only across a process boundary over their own HTTP APIs; no backend code (including AGPL Mattermost) is vendored, and no new dependency was added, so the license scan is unchanged at 300 packages.
- **Acceptance proven by test (F15, R6):** provisioning an incident against a fake Mattermost and a fake Matrix backend yields the incident-wide channel plus one per present ICS section, with membership drawn from current position holders (a section with an unheld position exists with no members); reassigning the operations chief and re-syncing moves membership so the new holder is in the operations and incident-wide channels and the old holder is removed (a true add/remove diff, mirrored locally); a platform announcement posts into the named section channel; deactivation archives the space; and with no backend configured, provisioning degrades to in-app notifications for the holders with nothing sent externally and no space created.
- **Verification:** `pnpm check` fully green; 273/273 tests across 48 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Facets:** F15 `implemented` (per-incident collaboration space auto-provisioned with section channels and membership that follows assignment; meeting bridges follow in VEOC-33); R6 reinforced (adapter chat for Teams-parity on top of the VEOC-15A native messaging).
- **Deferred:** the outbound delivery of assignment-driven sync in production uses the default HTTP transport best-effort (the sync semantics are proven against fake backends); a real-time membership webhook back from the backend, and mutual-TLS/bot-token rotation, are deployment hardening on top of the encrypted-token model; VEOC-33 adds the one-click meeting bridge under the same boundary rules.
- **Rollback:** revert the VEOC-32 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-33: Meetings and briefing bridges

- **Session:** VEOC-33, executed 2026-09-18
- **Starting HEAD:** `8253b382a8512ad0142e60ac6e7734da958d8473`
- **Files created/changed:** `server/migrations/0023_meetings.sql` (per-jurisdiction Jitsi config disabled by default with the JWT secret held only as an envelope; per-incident/section meeting rooms with a stable name; and briefings as scheduled items, all under RLS); `server/src/meetings/jitsi.ts` (HS256 JWT mint and verify and the join-URL builder, no external dependency, so nothing from Jitsi is vendored); `server/src/meetings/service.ts` (configure the bridge; one-click open-or-reuse a room and mint a per-caller token scoped to the room with a moderator flag; list bridges for the dashboard; schedule and list briefings; and fire due briefings, notifying holders through the VEOC-14 notifications substrate); `server/src/meetings/routes.ts`; app wiring; `server/src/__tests__/meetings.test.ts`.
- **Acceptance proven by test (F15, R4):** opening a bridge before the deployment is configured is refused; once configured, one action yields a joinable URL and the same room comes back on the next click (a stable link the dashboard can surface); with a JWT secret configured the URL carries a per-caller token that verifies, names the exact room, marks an admin as moderator and a plain member as not, and a forged token (wrong secret) does not verify; a non-member of the incident's jurisdiction is denied (audience scoping); a due briefing fires once, notifying both incident holders through the VEOC-14 notifications table, is stamped so a second run fires nothing, and a future briefing stays pending on the calendar.
- **Verification:** `pnpm check` fully green; 278/278 tests across 49 files; license-scan clean (300 packages, unchanged, no new dependency); check-links clean; tsc and eslint clean.
- **Facets:** F15 reinforced (one-click meeting bridges on top of the VEOC-32 incident spaces); R4 advanced (coordinated briefings; the JIC component follows in VEOC-33A and ICS forms/IAP in VEOC-34).
- **Deferred:** a real Jitsi deployment handshake is the configured base URL plus the JWT the platform mints (the token semantics are proven by verify); a recurring-briefing schedule and calendar (ICS/iCal) export layer on the one-shot briefing model; auto-firing due briefings on a timer reuses the same runner the notification scheduler uses.
- **Rollback:** revert the VEOC-33 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-33A: Joint Information Center

- **Session:** VEOC-33A, executed 2026-09-18
- **Starting HEAD:** `a2abcb2c26a4ee8443dd2ad83901e96cfef418f2`
- **Files created/changed:** `shared/src/boards/standard.ts` (two JIC board templates, `rumor_control` and `talking_points`); `shared/src/sitreps/def.ts` (a `rumorControl` line on the sitrep content); `server/migrations/0024_jic.sql` (press releases with a configurable required-agency list, an append-only approval chain, per-channel publication records, the public-message feed, and media inquiries, all under RLS); `server/src/jic/service.ts` (draft, submit, local decision, cross-boundary peer decision authenticated by a federation peer token and run under the receiving registrar, status recomputation, publication to the public feed plus CAP and best-effort collaboration, and the media-inquiry lifecycle that ties an answer to approved language); `server/src/jic/routes.ts`; `server/src/sitreps/service.ts` (surface rumor-control on the composed briefing); `web/src/sitreps/BriefingView.tsx` (render the rumor-control section); app wiring; `server/src/__tests__/jic.test.ts`; and the board-list and briefing-view tests updated for the additions.
- **Acceptance proven by test (R4):** a press release routes through two agencies, a local one and a federation peer that approves across the boundary with its token, and only once both have approved does it publish, to the public feed and to CAP (a stamped `authored` alert); an unapproved draft is refused publication at every stage (409); the approval chain records both agencies immutably and marks the peer decision; a media inquiry is logged and answered with a published release, while an unapproved draft is refused as an answer (409); and a rumor-control board entry surfaces in a composed sitrep and on the briefing view.
- **Verification:** `pnpm check` fully green; 282/282 tests across 50 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Facets:** R4 advanced (the JIC component: multi-agency approval, coordinated public messaging, media-inquiry tracking, rumor control; the ICS forms and IAP that complete R4 are VEOC-34); INV-2 reinforced (every JIC act is attributed and the approval chain is immutable record).
- **Deferred:** cross-instance coordinated fan-out of one approved message to many peer outlets (the peer-approval boundary and single-instance publication are proven; the outbound fan-out reuses the VEOC-30 outbox); a first-class talking-points approval workflow beyond the board template; requiring the acting position to be a PIO (attribution is recorded via the audit position today); and per-outlet distribution beyond the public feed, CAP, and collaboration channels.
- **Rollback:** revert the VEOC-33A commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-34: ICS forms and the IAP builder

- **Session:** VEOC-34, executed 2026-09-18
- **Starting HEAD:** `a7dd882c29f8ba633e45c8953d4c674143608d12`
- **Files created/changed:** `shared/src/ics/forms.ts` (a normalized incident context and pure builders for all twelve electronic ICS forms 201/202/203/204/205/206/207/208/211/213/214/215, plus `assembleIap` and a deterministic `iapToTextLines`); `shared/src/ics/pdf.ts` (a dependency-free, deterministic PDF writer: standard Helvetica, pagination, valid xref/trailer, no vendored library); exported from `shared/src/index.ts`; `shared/src/ics/__tests__/forms.test.ts`; `server/migrations/0025_iap.sql` (IAPs stored as assembled content with a draft/approved workflow, under RLS); `server/src/iap/service.ts` (gather the live context, the org chart from positions and current holders, the 214 from the activity-log board, check-ins, resources, comms, and hand it to the shared builders; create, fetch, approve, and render an IAP to PDF); `server/src/iap/routes.ts`; app wiring; `server/src/__tests__/iap.test.ts`.
- **Acceptance proven by test (F5 part one):** an IAP for the demo incident assembles the default form set in order from the current org chart and assignments with only objectives and the operational period supplied by hand; the 203 carries the assigned Incident Commander and Operations chief; the 214 derives from the activity-log board automatically; command approval is required and recorded; and the plan exports as a valid PDF (`%PDF-1.4`, containing the incident name), byte-identical on re-render and paginating long documents.
- **Verification:** `pnpm check` fully green; 295/295 tests across 52 files; license-scan clean (300 packages, unchanged, no new dependency); check-links clean; tsc and eslint clean.
- **Facets:** F5 advanced (ICS forms and the IAP builder, part one; the 213RR resource lifecycle is part two in VEOC-35); R4 `implemented` (Command and General Staff work fluidly with ICS org/checklists from VEOC-12, the JIC from VEOC-33A, and ICS forms/IAP here).
- **Deferred:** pixel-faithful reproductions of the official FEMA form layouts (the prefilled content and a clean PDF are proven; exact box-for-box facsimiles are a rendering-template concern); comms-plan (205) and medical-plan (206) prefill draw from boards when present and are otherwise header-only until those boards are standardized; the 213RR general-message flow is the VEOC-35 lifecycle.
- **Rollback:** revert the VEOC-34 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-35: The 213RR resource lifecycle

- **Session:** VEOC-35, executed 2026-09-18
- **Starting HEAD:** `ec7a73b60b716eff3125560d225ae7d0c70ce8ed`
- **Files created/changed:** `shared/src/resource/lifecycle.ts` (`canTransition`/`nextStates` over the dictionary transition table, and `formatCostExport`, a deterministic reimbursement CSV), exported from `shared/src/index.ts`; `shared/src/resource/__tests__/lifecycle.test.ts`; `server/migrations/0026_resource_requests.sql` (a first-class resource request, an append-only chronology, and cost capture, all under RLS); `server/src/resource/service.ts` (submit, guarded transitions, assignment, escalation to a peer tier with an injected delivery, receive-escalation and report-back over peer tokens run under the receiving registrar, cost capture, and the CSV export); `server/src/resource/routes.ts`; app wiring; `server/src/__tests__/resource.test.ts`.
- **Acceptance proven by test (F5 part two):** a request walks the full NIMS ordering cycle (submitted → triaged → sourcing → assigned → deployed → demobilizing → closed) with skips refused by the state machine (409), every change appended to the chronology, and a notification per change; a request escalates field-to-state over a peer token, the state tier works it and reports fulfillment back down to the originating request so the county request advances to deployed and its chronology carries the escalation and the peer's reports, while the state-side request records where it came from; and costs export as a reimbursement CSV with a correct total.
- **Verification:** `pnpm check` fully green; 302/302 tests across 54 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Facets:** F5 `implemented` (ICS forms and the IAP builder from VEOC-34 plus the full 213RR lifecycle here); INV-2 reinforced (the request chronology is immutable and attributed, peer decisions included).
- **Deferred:** production outbound escalation stores the upstream tier's base URL and token in a peer registry rather than passing them per call (the receive/report token lanes and the delivery seam are proven; the outbound credential store rides the VEOC-30 deferral); multi-hop escalation beyond two tiers chains the same receive/report pair; EDXL-RM emission of an escalated request reuses the VEOC-27 bridge.
- **Rollback:** revert the VEOC-35 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-36: After-action and improvement planning

- **Session:** VEOC-36, executed 2026-09-18
- **Starting HEAD:** `a014c26e8d9b1f235033ee3daa46e0e41aec7213`
- **Files created/changed:** `shared/src/aar/aar.ts` (pure `composeAar` splitting observations into strengths and areas for improvement and carrying the chronology as evidence, plus an HSEEP-ordered `aarToTextLines`), exported from `shared/src/index.ts`; `shared/src/aar/__tests__/aar.test.ts`; `server/migrations/0027_aar.sql` (observations captured during the incident, jurisdiction-scoped corrective actions that outlive it, and stored AARs, all under RLS); `server/src/aar/service.ts` (record and list observations, create and status-track corrective actions, compose an AAR from observations plus the VEOC-11 exported chronology, and render it to PDF); `server/src/aar/routes.ts`; app wiring; `server/src/__tests__/aar.test.ts`.
- **Acceptance proven by test (F16-adjacent, AAR):** an AAR composes from observations captured during the incident (one strength, one area for improvement) plus the exported chronology as evidence and the incident's corrective actions, and exports to a valid PDF; corrective actions are jurisdiction-scoped, so after the incident closes they remain listed, report status through open → in_progress → complete, and completed ones drop from the default view but return when asked, which is the daily-ops corrective-action tracking the roster requires.
- **Verification:** `pnpm check` fully green; 306/306 tests across 56 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Facets:** the AAR closes Phase F's operational circle; INV-2 reinforced (observations and corrective-action changes are attributed and the AAR embeds the immutable chronology as evidence).
- **Deferred:** an HSEEP core-capability taxonomy picker (capabilities are free text today); linking each corrective action back to the specific observation that spawned it; and scheduled reminders on a corrective action's due date reuse the VEOC-14 scheduler.
- **Rollback:** revert the VEOC-36 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-37: Security audit and adversarial pass

- **Session:** VEOC-37, executed 2026-09-18
- **Starting HEAD:** `fa41ca3dc97912aacffc75fa8b284b33c407aa1d`
- **Files created/changed:** `docs/SECURITY-AUDIT-VEOC-37.md` (findings, verified controls, dependency/license posture, and written risk acceptances); `server/src/__tests__/security.test.ts` (the seeded adversarial suite that runs in CI thereafter); and the write-path guards in `server/src/collab/service.ts`, `server/src/meetings/service.ts`, `server/src/jic/service.ts`, `server/src/resource/service.ts`, `server/src/iap/service.ts`, `server/src/aar/service.ts` changed from `requireMember` to `requireWriter` (finding F-1).
- **Finding fixed (F-1):** the Phase-F modules guarded write actions with a membership-only check, which admitted the read-only viewer role, contradicting the `requireWriter` contract used elsewhere (INV-7, INV-1). Write paths now require admin or member; pure reads still allow viewers; peer-token lanes are unaffected. Proven by the suite's viewer-read-only cases.
- **Acceptance proven by test (INV-7):** no unauthenticated request reaches any authority endpoint (401 across representative routes); an admin of one jurisdiction is refused on another's boards, IPAWS, resource requests, corrective actions, and JIC releases (403); a viewer reads but cannot write (403); federation, JIC-approval, and resource-escalation receive lanes and the public damage intake reject forged or missing tokens (401); the audit log refuses update and delete from the runtime role; IPAWS, collaboration, and meeting secrets never appear in status responses; and login backoff locks an email after repeated failures (429).
- **Verification:** `pnpm check` fully green; 313/313 tests across 57 files (the seeded suite included); license-scan clean (300 packages, unchanged, no new dependency); check-links clean; tsc and eslint clean.
- **Facets:** INV-7 `implemented` (fail closed: the authorization matrix is re-verified and enforced, token lanes fail closed, the audit log is tamper-evident); AR6 reinforced.
- **Risk-accepted (in `docs/SECURITY-AUDIT-VEOC-37.md`):** RA-1 in-process rate limiters until the VEOC-38 shared limiter; RA-2 no network vulnerability scan in the air-gapped CI gate (the lockfile plus license scan hold the supply-chain line; `pnpm audit` runs at release time).
- **Rollback:** revert the VEOC-37 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-38: Load, scale, and the long incident

- **Session:** VEOC-38, executed 2026-09-18
- **Starting HEAD:** `43ecb1c8365239ab8d476a77214905eeaa754d76`
- **Files created/changed:** `server/src/__tests__/load.test.ts` (the reproducible load harness and CI regression guard: a 5,000-record board view and a 150-operation concurrent mixed burst against the real app and PostgreSQL); `docs/CAPACITY-VEOC-38.md` (the committed floor, the budgets, the measured numbers, federation/sync notes, and the headroom item).
- **Acceptance proven by test (R1):** a board loaded with 5,000 records serves a view within budget (measured ~65 ms against a 5,000 ms ceiling, the SharePoint 5,000-item lesson addressed by the board-records index); a 150-operation concurrent activation profile (mixed session reads, view reads, and record writes) returns 2xx for every operation and finishes within budget (measured ~1,310 ms wall, ~1,237 ms p95, against 30,000 ms / 6,000 ms ceilings); the harness is reproducible and the budgets run in CI so no target regresses.
- **Verification:** `pnpm check` fully green; 315/315 tests across 58 files (the load benchmarks included); license-scan clean (300 packages, unchanged, no new dependency); check-links clean; tsc and eslint clean.
- **Facets:** R1 `implemented` (at least 150 concurrent users per instance, with measured headroom published and a CI benchmark guarding it).
- **Found and fixed / accepted:** no target missed at the R1 floor in this environment; the volume path was already indexed and the concurrent path already pooled. Headroom item recorded: `listViewRecords` returns a board's full record set and applies the view in memory (fast well past 5,000 records; a months-long incident with tens of thousands of records on one board should move to server-side pagination and filter push-down, landing with the shared rate limiter from RA-1).
- **Risk-accepted (in `docs/CAPACITY-VEOC-38.md`):** the published numbers are single-instance; the R1 floor is per instance, which is what the requirement commits to.
- **Rollback:** revert the VEOC-38 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-39: Accessibility and stress-UX audit

- **Session:** VEOC-39, executed 2026-09-18
- **Starting HEAD:** `9f43b48d783983f22dbb5d314b2fc2ea0b8b7218`
- **Files created/changed:** `web/src/design/components.tsx` (buttons, text fields, and selects given a 44px minimum touch target, finding A11Y-1); `web/src/design/__tests__/operational-a11y.test.tsx` (axe over the operational briefing view in both themes, heading structure, and the touch-target assertions); `docs/ACCESSIBILITY-VEOC-39.md` (the WCAG 2.1 AA audit record and the stress-UX pass).
- **Acceptance proven by test (508/WCAG 2.1 AA, stress-UX):** axe reports zero violations over both the component gallery and a real operational screen (the briefing view) in the light and dark themes; keyboard order follows document order behind a skip link with no positive tabindex; labels are wired to controls; token contrast meets AA for both themes with a seeded-defect proof; and interactive controls meet a 44px glove/touchscreen target. Stress-UX findings are fixed (A11Y-1) or ticketed with rationale (A11Y-T1 manual screen-reader pass, A11Y-T2 reduced-motion), and the ten-minute viewer path, low-bandwidth (local PMTiles, no external calls), and night-shift dark mode are recorded in the audit.
- **Verification:** `pnpm check` fully green; 319/319 tests across 59 files; license-scan clean (300 packages, unchanged, axe-core already present); check-links clean; tsc and eslint clean.
- **Facets:** accessibility is cross-cutting; the stress-UX fixes reinforce F14 (calm, map-first discipline) and AR6 (calm under stress); the timed naive-user viewer walkthrough is executed with the VEOC-41 demo.
- **Finding fixed (A11Y-1):** interactive controls below a comfortable gloved touch target, raised to a 44px minimum.
- **Ticketed (in `docs/ACCESSIBILITY-VEOC-39.md`):** A11Y-T1 full manual screen-reader pass with the VEOC-41 walkthrough; A11Y-T2 reduced-motion/prefers-contrast handling with the VEOC-41 polish pass.
- **Rollback:** revert the VEOC-39 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-40: Packaging and the air-gap install

- **Session:** VEOC-40, executed 2026-09-18
- **Starting HEAD:** `d5baf5990fc236e6c29eb9775c8cd20a0db914c6`
- **Files created/changed:** `server/src/main.ts` (production entrypoint: owner connection migrates and seeds, app runs on the app_runtime connection so RLS applies, boots only when run directly); `deploy/Dockerfile` (API image, TypeScript run with tsx installed into the image so the repo lockfile is untouched); `deploy/docker-compose.yml` (PostGIS + API, air-gap friendly, web sidecar shown); `deploy/install.sh` (single-node installer: prereq checks, first-run secret generation, up, health wait); `deploy/backup.sh` and `deploy/restore.sh` (gzip pg_dump and a guarded destructive restore); `deploy/README.md` (connected and air-gapped install, the two DB identities, web bundle, backup/restore, and the upgrade procedure); `server/src/__tests__/upgrade.test.ts` (the INV-5 upgrade drill).
- **Acceptance proven by test (INV-5 / upgrade) and by artifact (install/air-gap):** re-running the forward-only migration runner on a customized instance applies nothing new and leaves the board's local `x_` field and records intact; a board template version upgrade re-converges to the new template while preserving the local field and all records; the install path (compose + installer), the air-gap path (load images, vendored pnpm store, local PMTiles, no runtime external calls), and the backup/restore drill are shipped as runnable artifacts with a county-IT-level guide. The clean-machine and air-gapped install runs are validated out of band (CI cannot provision a fresh host); the upgrade-preserves-customization acceptance is proven in CI.
- **Verification:** `pnpm check` fully green; 321/321 tests across 60 files; license-scan clean (300 packages, unchanged, no new repo dependency; tsx is installed only into the deployment image); check-links clean; tsc and eslint clean.
- **Facets:** INV-5 `implemented` (boards are versioned schemas and the upgrade preserves customization end to end); AR2 `implemented` (no unconstrained board divergence: locals re-converge on upgrade); AR4 `implemented` (no in-place-upgrade dead ends).
- **Deferred / out-of-band:** actual clean-machine and networking-disabled install timings are validated on real hosts, not in CI; the web static-serving sidecar is shown but commented in compose until an operator wires their basemap.
- **Rollback:** revert the VEOC-40 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-41: Documentation, training paths, and the demo

- **Session:** VEOC-41, executed 2026-09-18
- **Starting HEAD:** `37cdeebf6ce53c5dafb2abf4aa688b3e52ec4dc2`
- **Files created/changed:** `docs/guides/ADMIN.md`, `DESIGNER.md`, `VIEWER-QUICKSTART.md`, `FIELD-USER.md`, `FEDERATION-SETUP.md`, `STANDARDS-INTEROP.md` (the operational guides); `docs/DEMO-SCENARIO.md` (the scripted functional exercise with a facet-coverage checklist mapping every step to F1-F20); `server/src/demo/seed.ts` (the demo dataset built with the real services: jurisdiction, admin/operator/viewer, an activated wildfire incident with boards and a log, a public CAP evacuation alert, a 213RR in flight, a JIC release, and an AAR observation); `server/src/__tests__/demo.test.ts` (the dataset loads and the scenario covers every facet); FACET-STATUS updates.
- **Acceptance proven by test and artifact:** the demo dataset loads through the real services and creates the incident, boards, records, CAP alert, triaged resource request, press release, and AAR observation; the scripted scenario references every facet F1 through F20, guarded in CI so a facet can never be silently dropped; the link checker is green across all 26 markdown files, so the guides cross-link cleanly. The cold-start "a stranger deploys and runs it from docs alone" walkthrough is executed by a fresh reader against these guides (out-of-band by nature); the guides and the demo make that path concrete.
- **Verification:** `pnpm check` fully green; 323/323 tests across 61 files; license-scan clean (300 packages, unchanged, no new dependency); check-links clean (26 files); tsc and eslint clean.
- **Facets:** F16 `implemented` (one-click role-based provisioning plus the documented ten-minute viewer quickstart); F17 `implemented` (daily-ops mode exercised in the scenario and documented against skill decay).
- **Deferred / out-of-band:** the timed cold-start run with a genuinely fresh human executor is scheduled with the VEOC-42 exercise; a PMTiles demo basemap file is provided by the operator per the deploy guide.
- **Rollback:** revert the VEOC-41 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.

---

## VEOC-42: Pilot activation exercise (design + dry-run; live pilot gated on Basho)

- **Session:** VEOC-42, executed 2026-09-18
- **Starting HEAD:** `17252c5f5349956f51b0904b36cd959ac9528dad`
- **Files created/changed:** `docs/EXERCISE-VEOC-42.md` (HSEEP objectives, Exercise Evaluation Guides mapped to facets, the data-collection plan through the platform's own modules, and the dry-run results with findings triaged fix/accept/roadmap/blocked); `server/src/__tests__/exercise.test.ts` (the platform produces its own exercise AAR).
- **Boundary respected (contract item 12):** the exercise on a real deployment with real users is an external engagement; it does not run until Basho authorizes it and selects the pilot jurisdiction (standing question 6, open). This session delivered only the preparation and an internal dry-run against the demo activation; nothing contacted anyone or stood up anything outside the repository.
- **Acceptance proven by test (the parts not gated on Basho):** the functional exercise runs on the demo activation and the platform composes its own after-action report from the exercise's observations (captured during play) plus the immutable chronology as evidence, and exports it as a PDF, which is VEOC-36 eating its own cooking; findings are triaged in the exercise document (the accessibility touch-target fix already done; rate limiter and single-node capacity accepted; pagination and manual screen-reader pass on the roadmap; the live pilot blocked on Basho).
- **Verification:** `pnpm check` fully green; 324/324 tests across 62 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Blocked on Basho (not a defect):** the live pilot with real users on a named jurisdiction (contract item 12 authorization; standing question 6 jurisdiction selection). The mechanism it will use is proven here.
- **Rollback:** revert the VEOC-42 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created. No external engagement performed.

---

## VEOC-43: Independent re-review and 1.0 disposition (release decision Basho's)

- **Session:** VEOC-43, executed 2026-09-18
- **Starting HEAD:** `e489f7ee70ea6a7c26d1a850f797de05b7f38a29`
- **Files created/changed:** `docs/INDEPENDENT-REVIEW-VEOC-43.md` (per-item verification against the code and its tests, and the proposed 1.0 disposition presented to Basho); `server/src/__tests__/reproducible-deploy.test.ts` (the INV-10 second independent deploy proof); `docs/FACET-STATUS.md` (dispositions set to `verified` for every facet, requirement, anti-requirement, and invariant except AR7, which is `deferred`, with a header note pointing to the review).
- **Boundary respected:** no release act (tag, publish, announcement) has been or will be performed. The 1.0 decision, what it contains, what is deferred, and the governance cadence are Basho's, to be recorded verbatim in the review document; this session presents the disposition, it does not decide it.
- **Acceptance proven by test and review:** every facet F1-F20, requirement R1-R6, anti-requirement (AR1-AR6), and invariant (INV-1 through INV-10) is verified against CI-green tests, with evidence cited per item; INV-10 is verified by a second independent deploy from source (two instances built from the migrations and code alone produce byte-identical template libraries and each serves a working API); AR7 (disconnected provisioning) is explicitly deferred to post-1.0 with rationale.
- **Verification:** `pnpm check` fully green; 326/326 tests across 63 files; license-scan clean (300 packages, unchanged); check-links clean; tsc and eslint clean.
- **Disposition:** FACET-STATUS now shows verified across the board except AR7 (deferred). Post-1.0 items recorded: disconnected provisioning (AR7), server-side pagination for very long incidents, a shared rate limiter, a manual screen-reader pass, live IPAWS/FEMA credentialing, and mutual-TLS peer hardening.
- **Pending Basho:** the 1.0 release decision (recorded verbatim in the review), the live pilot (VEOC-42, contract item 12 and the pilot jurisdiction), and the open standing questions (product name; whether to commission a fully independent human review before release).
- **Rollback:** revert the VEOC-43 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created. No release act performed.

---

## Phase H: The integrated application and further hardening

Post-roster continuation, authorized by Basho in-session (2026-09-19/20). The
numbered roster VEOC-00..43 reached its 1.0 disposition; that review recorded
the platform as a tested backend plus a component library with no assembled
application. These sessions build the application and discharge hardening the
review had deferred. Standing full-execution authorization and commit hygiene
unchanged; all work on `main`.

## VEOC-44: Operations console app shell

- **Session:** VEOC-44, executed 2026-09-19
- **Starting HEAD:** `1de5d5e26ed3ffcc5ca32a5932d9d4bfb6f0d8bc`
- **Commit:** `c3fbd2e`
- **Files created/changed:** `web/src/app/` (fetch API client with bearer auth and one-shot token renewal, session/login context, hash router, map-first AppShell, Login and Console screens, per-surface components), `web/src/main.tsx`, `web/index.html`, `web/vite.config.ts`, `web/package.json` (the build scripts the deploy docs assumed but were missing); two read-only discovery endpoints (`GET /api/v1/jurisdictions/:id/boards` and `.../dashboards`) added to the boards and dashboards services/routes; `web/src/design/components.tsx` gained a password field type; tests `server/src/__tests__/discovery.test.ts` and `app-e2e.test.ts` plus `web/src/app/__tests__/{client,router,session}`.
- **Acceptance proven by test:** discovery endpoints list a jurisdiction's boards (flagging geometry) and dashboards for a member and refuse a non-member (403); the client's bearer/renewal/error handling, the hash router, and the session lifecycle are unit-tested; a browser E2E builds the SPA, blocks all external network, signs in as a member, and renders the COP, the board dock, and the dashboard.
- **Verification:** `pnpm check` green; 342 tests / 68 files; CI run 51 green.
- **Facets:** closes the gap the VEOC-43 review named (no assembled application); the running app exercises F1/F6/F8/F14/F16 through a real login.
- **Rollback:** revert `c3fbd2e`.
- **Commit/push:** under standing authorization. No branch created.

## VEOC-45: COP basemap, map controls, and inspection

- **Session:** VEOC-45, executed 2026-09-19
- **Starting HEAD:** `c3fbd2e0239baf3aad244aa9f2e5e5a69e1a5793`
- **Commit:** `d8b7b70`
- **Basho decisions applied:** map stack is open MapLibre + PostGIS/GeoJSON (not embedded Esri); basemap bundled-minimal with override.
- **Files created/changed:** `web/src/cop/basemap.ts` and `web/public/basemap/*.geojson` (a bundled, minified, public-domain Natural Earth basemap served as static GeoJSON, offline); `web/src/cop/{layers,CopMap}.tsx` (basemap config, zoom/scale controls, attribution, click-to-inspect popups, a status legend); `web/src/app/config.ts` and MapSurface wiring; a deployment can replace the basemap wholesale with its own MapLibre style (`OPENEOC_BASEMAP_STYLE_URL`).
- **Acceptance proven by test:** the COP unit test pins the bundled-basemap style (offline, no external references); the browser E2E confirms the basemap, controls, legend, and board layers render.
- **Verification:** `pnpm check` green; CI run 52 green.
- **Facets:** the F6/F14 map-first surface now carries geographic context.
- **Deferred (honest):** an MVT vector-tile overlay endpoint (live overlays stay GeoJSON to preserve field-to-COP latency; MVT is the large-static-layer scaling step); feed layers in the COP UI.
- **Rollback:** revert `d8b7b70`.
- **Commit/push:** under standing authorization. No branch created.

## VEOC-46: Design system elevation, typography, and tables

- **Session:** VEOC-46, executed 2026-09-19
- **Starting HEAD:** `d8b7b706f2561a33c251353cebbb83c415b88437`
- **Commits:** `13a1751`, `b55dfea`
- **Files created/changed:** `web/src/design/tokens.ts` (radii, a shadow scale, and a type scale as tokens plus CSS variables), `web/src/design/base.css` (one focus ring, hover/active states, calm scrollbars, themed map popups, and data-table/map-panel treatments), applied across the components, dashboard widgets, command bar, board views, and board index. Color stays reserved for status (INV-8); depth and typography carry the hierarchy.
- **Acceptance proven by test:** contrast (26 pairs), axe a11y, operational-a11y (44px targets), and dashboard tests remain green in both themes; the browser E2E captures the styled dashboard and board table.
- **Verification:** `pnpm check` green; CI runs 53 and 54 green.
- **Facets:** F14/F17 calm-screen discipline preserved while raising the finish.
- **Rollback:** revert `b55dfea` then `13a1751`.
- **Commit/push:** under standing authorization. No branch created.

## VEOC-47: API hardening (headers, probes, flood limiter, timeout, CORS)

- **Session:** VEOC-47, executed 2026-09-19/20
- **Starting HEAD:** `b55dfea4b05485490f8d1d160f7347d6ad8f8af3`
- **Commits:** `3e99735`, `b63e144`, `2e09fe9`
- **Files created/changed:** `server/src/security/{headers,rate-limit,cors}.ts`, the `onRequest` hook and health/readiness routes in `server/src/app.ts`, and tests `server/src/__tests__/{security-headers,cors}.test.ts`. Security headers with a strict CSP on the data API; liveness and readiness probes; a shared per-client flood limiter (discharges the VEOC-37 RA-1 item) with a high default ceiling and env tuning; a 30-second request timeout; a hot-path latency guard in CI; allowlisted CORS, off by default, never a wildcard.
- **Acceptance proven by test:** headers ride success and error responses; probes return ok/ready; the limiter allows heavy legitimate volume and blocks past the ceiling; CORS echoes only exact configured origins and answers preflight; the 150-op load test still clears budget.
- **Verification:** `pnpm check` green; CI runs 56 and 59 green (run 55 was an environmental test-timeout flake, root-caused in VEOC-49).
- **Facets:** discharges the VEOC-37 RA-1 shared limiter; INV-7/INV-8 posture unchanged.
- **Deferred:** mutual-TLS peer hardening and a shared rate-limit store (horizontal scaling) remain infrastructure.
- **Rollback:** revert `2e09fe9`, `b63e144`, `3e99735`.
- **Commit/push:** under standing authorization. No branch created.

## VEOC-48: Portable jurisdiction data export

- **Session:** VEOC-48, executed 2026-09-20
- **Starting HEAD:** `b63e1447632ab3fd87bbaf048fa190450ffe2577`
- **Commit:** `6e56be8`
- **Files created/changed:** `server/src/export/{service,routes}.ts` (`GET /api/v1/jurisdictions/:id/export`, admin-only, RLS behind it) returning boards with records (geometry as GeoJSON), the sitrep archive, and current lifelines as plain JSON; `server/src/__tests__/export.test.ts`.
- **Acceptance proven by test:** an admin receives the full operational record as a downloadable archive with geometry; a member is refused (403).
- **Verification:** `pnpm check` green; CI run 57 green.
- **Facets:** makes INV-9/INV-10 no-lock-in concrete; a continuity and migration companion to the database backup.
- **Rollback:** revert `6e56be8`.
- **Commit/push:** under standing authorization. No branch created.

## VEOC-49: Test stabilization and the security/continuity posture

- **Session:** VEOC-49, executed 2026-09-20
- **Starting HEAD:** `6e56be8b8e5bacfff98fff28448f8c6e310eb62e`
- **Commits:** `6bdec85`, `605962c`
- **Files created/changed:** `vitest.config.mjs` (generous test and hook timeouts so database-heavy setup never flakes under a loaded CI runner); `docs/SECURITY-CONTINUITY.md` (an operator- and auditor-facing reference for the implemented controls and their configuration knobs).
- **Incident recorded honestly:** CI run 55 went red on an IPAWS test that stands up a second throwaway database mid-test and exceeded vitest's 5-second default on a slow runner; not a defect (the same code passed on the next commit and locally), fixed for the whole class by the config above. Separately, the session's writable disk filled to 100% from 1,389 accumulated throwaway test databases (30G); freed cache, dropped every `t_*` database, and recovered to 29G free with no committed work affected.
- **Verification:** `pnpm check` green; 359 tests / 71 files.
- **Facets:** testing reliability; documented controls (itself an information-management control).
- **Rollback:** revert `605962c`, `6bdec85`.
- **Commit/push:** under standing authorization. No branch created.
