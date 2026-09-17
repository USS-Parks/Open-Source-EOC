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
- **Verification:** `pnpm check` fully green; 128/128 tests across 20 files.
- **Defect found and fixed (the whole session's fight):** MapLibre v6 resolves its web worker from a sibling URL of the executing bundle, so under any bundler the worker request 404s, the dispatcher waits forever, and the map silently never loads a single tile: source object populated, layers present, canvas black. Every deployment would have shipped a dead map. The fix routes the worker through the bundler (`?worker&url` emit plus `setWorkerUrl`) in the one place maps are constructed. The E2E test is the standing regression guard: a broken worker setup fails it in seconds. An earlier diagnosis blamed headless GPU rasterization; that was wrong, and the browser test was almost weakened to accommodate the exact bug it existed to catch.
- **Facets:** F6 `implemented` end to end (field-to-COP loop proven in a real browser); F14 `implemented`; F19 `implemented` (status framing; the full symbol set grows with F8 at VEOC-20); register drift corrected (dispositions declared by earlier receipts now reflected in the table).
- **Deferred:** vector basemap packaging for deployments (PMTiles wiring is live behind a URL) to VEOC-21/deploy; sensor and drone feeds to VEOC-19; Lifelines overlays to VEOC-20.
- **Rollback:** revert the VEOC-17 commit.
- **Commit/push:** performed under the standing full-execution authorization. No branch created.
