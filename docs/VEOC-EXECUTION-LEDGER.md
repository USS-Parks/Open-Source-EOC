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

---

## VEOC-50: Feed layers on the common operating picture

- **Session:** VEOC-50, executed 2026-09-20
- **Starting HEAD:** `62d1440faa7cb933384a56611aaa2e33e714ee0c`
- **Files created/changed:** `web/src/app/api/client.ts` (`listFeeds`, `feedItems`, and the FeedHealth/FeedItemsResponse types); `web/src/cop/feeds.ts` (`feedLayerIds`); `web/src/cop/CopMap.tsx` (feeds rendered and toggled alongside boards, click-to-inspect and the hover cursor extended to feed features, a Feeds section in the layer panel); `web/src/app/surfaces/MapSurface.tsx` and `web/src/app/screens/Console.tsx` (load a jurisdiction's feeds and pass the enabled ones to the map); tests `web/src/cop/__tests__/feeds.test.ts` (feedLayerIds) and the browser E2E, which now ingests a push feed and asserts the Feeds layer group renders.
- **Acceptance proven by test:** feed features carry provenance and staleness and a stale feed drops to the unknown frame (unit tests); the browser E2E signs in, ingests a push GeoJSON feed, and confirms the "Feeds" panel with the "NWS Alerts" toggle renders beside the board layers, offline.
- **Verification:** `pnpm check` green; 360 tests / 71 files.
- **Facets:** completes the F18 feed surface in the UI, which VEOC-45 had deferred.
- **Rollback:** revert the VEOC-50 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-51: ICS Forms and IAP operator screen

- **Session:** VEOC-51, executed 2026-09-20
- **Starting HEAD:** `7561066` (roadmap rewrite)
- **Operator gap closed:** the forms engine and PDF export existed only behind
  the API (VEOC-34); the console had no way to reach them. This adds the screen.
- **Files created/changed:** `web/src/app/surfaces/FormsSurface.tsx` (pick an
  incident and operational period, preview any of the twelve ICS forms
  prefilled from live incident data, assemble the operational period's IAP,
  download it as a PDF, and, as an admin, approve it); `web/src/app/api/client.ts`
  (listIncidents, getIcsForm, createIap, getIap, approveIap, and an authed
  downloadIapPdf returning a Blob with one-shot 401 renewal); `web/src/app/router.tsx`
  and `web/src/app/screens/Console.tsx` (a Forms rail entry and route, isAdmin
  threaded through); server `incidents/service.ts` and `incidents/routes.ts`
  (listIncidents plus `GET /api/v1/jurisdictions/:id/incidents`, member-scoped
  under RLS). Tests: incidents.test.ts (list), client.test.ts (PDF blob +
  bearer), and the browser E2E now activates an incident, previews ICS-201, and
  assembles an IAP.
- **Acceptance proven by test:** a member lists a jurisdiction's incidents; the
  client downloads a PDF blob carrying the bearer token; the browser E2E signs
  in, opens Forms, previews ICS-201 with the eight-position org chart, and
  assembles the IAP with its ICS-202 objectives form, offline.
- **Verification:** `pnpm check` green; 362 tests / 71 files.
- **Facets:** F5 now reaches the operator (the engine was VEOC-34).
- **Deferred (honest):** the ICS-204 assignment list is still shallow
  (operations positions only, not division/group/strike-team detail); in-browser
  editing of objectives and the safety message is next.
- **Rollback:** revert the VEOC-51 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-52: Map field capture (drop a point, fill the form)

- **Session:** VEOC-52, executed 2026-09-20
- **Starting HEAD:** `2ceb525` (Forms screen)
- **Operator gap closed:** the map could display and inspect geometry but not
  create it; a location could only be entered as raw coordinates in a board
  form. This adds the Field Maps gesture: tap the map, the record form opens
  with the location prefilled.
- **Files created/changed:** `web/src/boards/RecordForm.tsx` (a geometry
  control: longitude/latitude point entry, prefilled from the tap and still
  editable, submitting GeoJSON the shared schema validates); `web/src/cop/CopMap.tsx`
  (an add-point mode: `picking` shows a crosshair and a click reports its
  position through `onPickPoint` instead of inspecting); `web/src/app/surfaces/MapSurface.tsx`
  (an Add-point toggle, a geo-board picker, and the record form in a map
  overlay, saving through `createRecord`). Tests: runtime.test.tsx (the
  geometry control prefills a point and submits it as GeoJSON) and the browser
  E2E now drops a point on the map and saves a road-closure record end to end.
- **Acceptance proven by test:** the geometry control renders longitude and
  latitude prefilled from a Point and submits `{type:"Point",coordinates}`; the
  browser E2E enters add-point mode, clicks the map, and the New map record
  panel opens with the tapped coordinates, which saves as a road closure,
  offline.
- **Verification:** `pnpm check` green; 363 tests / 71 files.
- **Facets:** part of the Phase D field-capture gap the roadmap names; the
  first draw-on-map interaction.
- **Deferred (honest):** photo capture and attaching a photo to a placed point
  (needs the file-upload UI) is next; line and polygon drawing is later.
- **Rollback:** revert the VEOC-52 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-53: Files and search operator screen

- **Session:** VEOC-53, executed 2026-09-20
- **Starting HEAD:** `6c4e72f` (map field capture)
- **Operator gap closed:** the file store and platform search existed only
  behind the API (VEOC-15); the console had no way to upload, find, or download
  anything. This adds the screen.
- **Files created/changed:** `web/src/app/surfaces/FilesSurface.tsx` (upload a
  document or photo to the content-addressed store, search records, libraries,
  files, and the chronology, and download a file); `web/src/app/api/client.ts`
  (searchJurisdiction, uploadFile, fileMeta, downloadFile, and a shared authed
  `requestBlob` the IAP PDF download now also uses); `web/src/app/router.tsx`
  and `web/src/app/screens/Console.tsx` (a Files rail entry and route). Tests:
  client.test.ts (upload, search, and blob download) and the browser E2E now
  uploads a file and finds it through search.
- **Acceptance proven by test:** the client uploads a file, searches, and
  downloads its content as a blob; the browser E2E uploads a text note and the
  platform search returns it, offline.
- **Verification:** `pnpm check` green; 364 tests / 71 files.
- **Facets:** R5 now reaches the operator; closes the Phase B files/search UI gap.
- **Deferred (honest):** attaching an uploaded photo to a placed map point (the
  attachment field type) and multipart streaming upload are later.
- **Rollback:** revert the VEOC-53 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-54: Incident lifecycle operator screen

- **Session:** VEOC-54, executed 2026-09-20
- **Starting HEAD:** `7a6f0fb` (Files and search)
- **Operator gap closed:** incidents could be activated and closed only through
  the API (VEOC-12); nothing else in the console works without an incident, so
  this is foundational. Adds the screen.
- **Files created/changed:** `web/src/app/surfaces/IncidentsSurface.tsx`
  (activate an incident from a scenario template in one action, see the open
  and closed incidents, and close one; activation and closure admin-gated);
  `web/src/app/api/client.ts` (listIncidentTemplates, activateIncident,
  closeIncident); server `incidents/routes.ts` (`GET /api/v1/incident-templates`
  returning the standard scenarios); `web/src/app/router.tsx` and
  `web/src/app/screens/Console.tsx` (an Incidents rail entry and route). Tests:
  client.test.ts (templates, activate, close) and the browser E2E now opens
  Incidents and sees the activated incident listed.
- **Acceptance proven by test:** the client lists templates and activates and
  closes an incident; the browser E2E opens Incidents and the activated "Bald
  Hills Fire" is listed, offline.
- **Verification:** `pnpm check` green; 365 tests / 71 files.
- **Facets:** F12 now reaches the operator (the engine was VEOC-12).
- **Deferred (honest):** custom template authoring in the browser and the
  incident detail view (org chart, checklists) are later.
- **Rollback:** revert the VEOC-54 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-55: Switchable satellite/imagery basemap

- **Session:** VEOC-55, executed 2026-09-20
- **Starting HEAD:** `d667379` (Incidents screen)
- **Gap closed:** the COP had only the muted vector basemap; there was no
  satellite/aerial option. Adds one, switchable, without breaking the offline
  default.
- **Files created/changed:** `web/src/app/config.ts` (OPENEOC_IMAGERY_TILE_URL
  and OPENEOC_IMAGERY_ATTRIBUTION runtime config); `web/src/cop/layers.ts`
  (buildCopStyle mounts a hidden raster imagery source and layer when a tile
  URL is set, above the vector basemap and below the operational layers);
  `web/src/cop/CopMap.tsx` (a Basemap switch, Vector or Imagery, in the layer
  panel, toggling the raster's visibility, with imagery attribution shown);
  `web/src/app/surfaces/MapSurface.tsx` (passes the config through). Test:
  cop.test.ts asserts the imagery raster mounts hidden with the configured
  tiles.
- **Acceptance proven by test:** buildCopStyle adds a `raster` imagery source
  with the exact tile template and an `imagery` layer hidden by default; the
  offline vector default is unchanged when no tile URL is configured.
- **Verification:** `pnpm check` green; 366 tests / 71 files.
- **Design note (honest):** imagery tiles are the deployment's to provide; a
  self-hosted raster keeps the COP offline, a public provider is the
  deployment's choice. No imagery ships in the bundle, so the air-gap default
  holds.
- **Rollback:** revert the VEOC-55 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-56: Photo attachment on a placed map point

- **Session:** VEOC-56, executed 2026-09-20
- **Starting HEAD:** `02deb05` (roadmap refresh)
- **Gap closed:** the last piece of the Field Maps answer. A dropped point could
  carry attributes but no photo. Adds an attachment field type and wires photo
  capture into the map's field-capture flow.
- **Files created/changed:** `shared/src/boards/fields.ts` (a new `attachment`
  field type storing a file id, validated as a uuid); `shared/src/boards/standard.ts`
  (a `field_reports` board: summary, category, photo attachment, point
  location); `web/src/boards/RecordForm.tsx` (an attachment control that uploads
  the picked file at once and stores its id, driven by an `onUpload` hook);
  `web/src/app/data/files.ts` (a shared readAsBase64 / uploadPickedFile helper,
  now used by the Files screen too); `web/src/app/surfaces/MapSurface.tsx` (passes
  the upload hook, given the jurisdiction id threaded from the console). Tests:
  boards.test.ts (the field-reports schema takes a uuid photo, rejects a
  non-uuid), runtime.test.tsx (the control uploads and submits the id), and the
  browser E2E now drops a field report with a photo attachment and saves it.
- **Acceptance proven by test:** the attachment field validates a file id; the
  record form uploads a picked file and submits its id; the browser E2E places a
  field-report point, attaches a JPEG, and saves it, offline.
- **Verification:** `pnpm check` green; 369 tests / 72 files.
- **Facets:** completes the Field Maps parity for capture (pin + attributes +
  photo + GPS); F1 attachments now real.
- **Deferred (honest):** inline photo display in the popup and board table needs
  an authenticated blob load and is the follow-up; line and polygon capture
  later.
- **Rollback:** revert the VEOC-56 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-57: Resource requests (213RR) operator screen

- **Session:** VEOC-57, executed 2026-09-20
- **Starting HEAD:** `456f650` (photo attachment)
- **Operator gap closed:** the 213RR lifecycle existed only behind the API
  (VEOC-35); the console could not submit or advance a request. Adds the screen.
- **Files created/changed:** `web/src/app/surfaces/ResourcesSurface.tsx` (submit
  a request, and advance each one through the NIMS ordering states; the allowed
  next states come from the dictionary transition table so the UI can only
  offer legal moves, which the server independently enforces); server
  `resource/service.ts` and `resource/routes.ts` (listRequests plus
  `GET /api/v1/jurisdictions/:id/resource-requests`); `web/src/app/api/client.ts`
  (listResourceRequests, submitResourceRequest, transitionResourceRequest);
  `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx` (a Resources
  rail entry and route). Tests: client.test.ts (submit, list, advance) and the
  browser E2E now submits a request and advances it to triaged.
- **Acceptance proven by test:** the client submits, lists, and advances a
  request; the browser E2E submits "Sandbags, 500 ct", sees it, and advances its
  state to triaged, offline.
- **Verification:** `pnpm check` green; 370 tests / 71 files.
- **Facets:** F5 213RR now reaches the operator (the engine was VEOC-35).
- **Deferred (honest):** assignment to a position, escalation to a peer tier, and
  cost capture/export are API-complete and are follow-up screens.
- **Rollback:** revert the VEOC-57 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-58: After-action review operator screen

- **Session:** VEOC-58, executed 2026-09-20
- **Starting HEAD:** `b1ae7fb` (resource requests)
- **Operator gap closed:** AAR observations and the composed report existed only
  behind the API (VEOC-36); the console could not capture observations or export
  the report. Adds the screen.
- **Files created/changed:** `web/src/app/surfaces/AarSurface.tsx` (pick an
  incident, record capability observations as strength or improvement, list
  them, and compile the AAR, which the platform assembles from the observations
  plus the chronology and exports as a PDF); `web/src/app/api/client.ts`
  (listAarObservations, recordAarObservation, composeAar, downloadAarPdf);
  `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx` (an AAR rail
  entry and route). Tests: client.test.ts (record, list, compose, PDF) and the
  browser E2E now records an observation for the incident.
- **Acceptance proven by test:** the client records and lists observations,
  composes an AAR, and downloads its PDF; the browser E2E records a Mass Care
  observation on the incident, offline.
- **Verification:** `pnpm check` green; 371 tests / 71 files.
- **Facets:** F after-action now reaches the operator (the engine was VEOC-36).
- **Deferred (honest):** the corrective-action tracker (jurisdiction-scoped
  improvement plan) is API-complete and is the next screen.
- **Rollback:** revert the VEOC-58 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-59: Live feeds administration screen

- **Session:** VEOC-59, executed 2026-09-20
- **Starting HEAD:** `9014840` (after-action review)
- **Operator gap closed:** feeds could be created and polled only through the API
  (VEOC-19); the console had no interop admin surface. Adds one.
- **Files created/changed:** `web/src/app/surfaces/FeedsSurface.tsx` (register a
  polled upstream by URL or a push feed over a one-time token, see each feed's
  freshness, and force a poll; the create panel is admin-gated to match the
  server); `web/src/app/api/client.ts` (createFeed, pollFeed; listFeeds already
  existed); `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx` (a
  Feeds rail entry and route). Tests: client.test.ts (create returns the ingest
  token, poll) and the browser E2E now opens Feeds and sees the seeded feed.
- **Acceptance proven by test:** the client creates a feed and receives its
  ingest token and polls it; the browser E2E opens the Feeds screen and the
  seeded "NWS Alerts" feed is listed, offline.
- **Verification:** `pnpm check` green; 372 tests / 71 files.
- **Facets:** F18 feeds now administered from the console; part of the Phase E
  interop operator surface.
- **Deferred (honest):** IPAWS live credentialing and the CAP geocode catalog
  remain external/gated; enable/disable and delete of a feed are follow-ups.
- **Rollback:** revert the VEOC-59 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-60: The 150-concurrent-user load gate

- **Session:** VEOC-60, executed 2026-09-20
- **Starting HEAD:** `5a23738` (feeds admin)
- **Release gate closed:** the roadmap's Phase G load target reads "150+
  concurrent users." The existing benchmark fired 150 operations as one admin,
  which is throughput, not concurrent users. Adds the real test.
- **Files created/changed:** `server/src/__tests__/load.test.ts` (a new case
  provisions 150 members, logs each in to its own session, then fires one
  concurrent request per distinct user, a mix of a read and a write, each under
  its own RLS context, asserting every response is 2xx and p95 stays within
  budget); `ROADMAP.md` (Phase G note and one-line status updated to reflect the
  passing gate).
- **Acceptance proven by test:** 150 distinct users log in and each serves a
  concurrent request successfully within the latency budget; run against the
  local cluster, p95 well under the 6s ceiling.
- **Verification:** `pnpm check` green; 373 tests / 71 files.
- **Facets:** discharges the Phase G "150+ concurrent users" release gate in CI.
- **Pending Basho (not code):** the live pilot with real users on a named
  jurisdiction (VEOC-42) remains the one open release gate, gated on Basho.
- **Rollback:** revert the VEOC-60 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-61: Corrective-action tracker (improvement plan)

- **Session:** VEOC-61, executed 2026-09-20
- **Starting HEAD:** `e1652cd` (load gate)
- **Operator gap closed:** corrective actions (the jurisdiction-scoped
  improvement plan that outlives an incident) existed only behind the API
  (VEOC-36); the console could not create or track them. Adds them to the AAR
  screen.
- **Files created/changed:** `web/src/app/surfaces/AarSurface.tsx` (a corrective
  actions panel: create an action against a capability, list open ones, and move
  each through open / in progress / complete); `web/src/app/api/client.ts`
  (listCorrectiveActions, createCorrectiveAction, setCorrectiveActionStatus).
  Tests: client.test.ts (create, list, status) and the browser E2E now adds a
  corrective action.
- **Acceptance proven by test:** the client creates, lists, and updates a
  corrective action; the browser E2E adds "Add a backup repeater at the EOC" to
  the improvement plan, offline.
- **Verification:** `pnpm check` green; 374 tests / 71 files.
- **Facets:** completes the Phase F after-action / improvement-planning operator
  surface.
- **Rollback:** revert the VEOC-61 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-62: Native messaging operator screen

- **Session:** VEOC-62, executed 2026-09-20
- **Starting HEAD:** `bf7e185` (corrective actions)
- **Operator gap closed:** native messaging (R6) is the one core subsystem that
  is not a board and had no operator path; the API existed (VEOC-15A). Adds the
  screen, closing the last Phase B UI gap.
- **Files created/changed:** `web/src/app/surfaces/MessagesSurface.tsx` (start a
  position-addressed group thread, list threads, and read and post messages,
  polling for new ones; a message to a seat reaches its current holder);
  `web/src/app/api/client.ts` (listPositions, listThreads, createThread,
  listMessages, postMessage, and the Thread/Message/PositionRef types);
  `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx` (a Messages rail
  entry and route); `ROADMAP.md` (Phase B operator UI now "yes"). Tests:
  client.test.ts (positions, thread, post, read) and the browser E2E now starts
  a thread and posts a message.
- **Acceptance proven by test:** the client lists positions, creates a thread,
  posts and reads a message; the browser E2E starts "Ops coordination" and posts
  to it, offline.
- **Verification:** `pnpm check` green; 375 tests / 71 files.
- **Facets:** R6 now reaches the operator; closes the Phase B UI gap.
- **Deferred (honest):** live push over the sync socket (the since-cursor poll is
  the offline-first path today) and direct person-to-person thread creation from
  a people picker are follow-ups.
- **Rollback:** revert the VEOC-62 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-63: Damage-assessment board and roadmap finalization

- **Session:** VEOC-63, executed 2026-09-20
- **Starting HEAD:** `6a5106a` (native messaging)
- **Operator gap closed:** damage assessment (PDA) had no board and so no
  operator path. Adds a standard damage-assessment board that is reachable in
  Boards and captured with the map's drop-a-point-plus-photo flow, closing the
  last Phase D field-capture gap. Finalizes the roadmap to the true state.
- **Files created/changed:** `shared/src/boards/standard.ts` (a
  `damage_assessment` board: structure type, ownership, damage degree from the
  PDA dictionary enums, notes, photo attachment, point location);
  `shared/src/boards/__tests__/boards.test.ts` (the board joins the standard-set
  assertion); `ROADMAP.md` (D "mostly", E "partial", F "yes", with honest
  per-phase notes and the one-line status rewritten to what an operator can do
  and what is backend-only or gated).
- **Acceptance proven by test:** the standard set includes damage_assessment and
  every template still builds a working record validator; the board carries the
  cited PDA enums, a photo attachment, and a point geometry, so it captures on
  the map like the field-reports board.
- **Verification:** `pnpm check` green; 375 tests / 71 files.
- **Facets:** closes the Phase D damage-assessment operator path (F6/F8/PDA).
- **Roadmap state after this prompt:** operator UI is A complete, B/C/F yes,
  D mostly (smart-form runner and tracking/reunification remain backend-only),
  E partial (feeds admin present; federation and EDXL/CoT are machine APIs; IPAWS
  live is gated), G's load gate met. The only true remainders are external and
  gated on Basho: IPAWS live credentialing and the live pilot (VEOC-42).
- **Rollback:** revert the VEOC-63 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-64: Smart-form (XLSForm) runner screen

- **Session:** VEOC-64, executed 2026-09-20
- **Starting HEAD:** `beeb451` (damage board)
- **Operator gap closed:** imported XLSForms (VEOC-22) could be stored and
  submitted only through the API; there was no runner. Adds one.
- **Files created/changed:** `web/src/app/surfaces/SmartFormsSurface.tsx` (lists
  stored forms, renders a form's flattened fields by XLSForm type, picks a target
  board of the form's template, and submits the answers, which the server
  validates and maps); `web/src/app/api/client.ts` (listForms, getForm,
  submitForm); `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx` (a
  Smart Forms rail entry and route). Tests: client.test.ts (list, get, submit)
  and the browser E2E now renders a seeded form and submits it to a board.
- **Acceptance proven by test:** the client lists forms, loads a definition, and
  submits; the browser E2E fills the "Rapid Needs Survey" and submits it to the
  field-reports board, offline.
- **Verification:** `pnpm check` green; 377 tests / 71 files.
- **Facets:** F7 smart forms now reach the operator (the engine was VEOC-22).
- **Deferred (honest):** in-runner XLSForm skip logic (relevant/constraint) is
  evaluated server-side on submit, not previewed live; image questions defer to
  the file-upload flow.
- **Rollback:** revert the VEOC-64 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-65: Tracking and reunification screen

- **Session:** VEOC-65, executed 2026-09-20
- **Starting HEAD:** `beeb451` (built alongside VEOC-64, same push)
- **Operator gap closed:** object tracking and reunification (VEOC-25) existed
  only behind the API. Adds the screen, the last Phase D operator surface.
- **Files created/changed:** `web/src/app/surfaces/TrackingSurface.tsx` (register
  a patient/evacuee/animal/asset with a tag, record custody scans through the
  NIMS custody states, and search the chain by name or tag to reunify);
  `web/src/app/api/client.ts` (registerTrackedObject, scanTrackedObject, reunify,
  and the ReunificationAnswer type); `web/src/app/router.tsx` and
  `web/src/app/screens/Console.tsx` (a Tracking rail entry and route). Tests:
  client.test.ts (register, scan, reunify) and the browser E2E now registers an
  object and finds it by name.
- **Acceptance proven by test:** the client registers, scans, and reunifies; the
  browser E2E registers "Jane Doe" and the reunification search returns her,
  offline.
- **Verification:** `pnpm check` green; 377 tests / 71 files.
- **Facets:** completes Phase D operator UI (tracking/reunification); F20.
- **Rollback:** revert the VEOC-65 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-66: Incident lockdown (guest/public read suspended)

- **Session:** VEOC-66, executed 2026-09-20
- **Starting HEAD:** `6c53188` (smart forms + tracking)
- **New requirement (Basho, 2026-09-20):** when a jurisdiction/org opens an
  incident, the dashboard goes into lockdown. Clarified with Basho: lockdown
  suspends guest and public read while an incident is open; members are
  unaffected; it engages automatically on incident open and an admin can lift
  or re-apply it.
- **Files created/changed:** `server/migrations/0028_lockdown.sql` (a `locked`
  flag on jurisdictions and a redefined `has_guest_scope` that yields no guest
  scope while locked, so guest read is suspended at the RLS wall across every
  guest-readable surface at once); `server/src/incidents/service.ts` (activation
  sets locked; closing the last open incident clears it; getLockdown/setLockdown
  with admin override, audited); `server/src/incidents/routes.ts` (GET/POST
  `/api/v1/jurisdictions/:id/lockdown`); `web/src/app/api/client.ts`
  (getLockdown, setLockdown); `web/src/app/screens/Console.tsx` (a lockdown
  banner across the console while locked); `web/src/app/surfaces/IncidentsSurface.tsx`
  (an admin lockdown state + lift/apply control). Tests: incidents.test.ts
  (activation locks; admin lifts; member cannot set; and the RLS proof that
  has_guest_scope returns false while locked), client.test.ts (get/set), and the
  browser E2E now asserts the lockdown banner is visible with the incident open.
- **Acceptance proven by test:** opening an incident sets the jurisdiction
  locked; a member is refused the toggle (403) while an admin lifts it; at the
  RLS wall a guest with a valid grant reads while unlocked and is suspended
  while locked; the console shows the lockdown banner.
- **Verification:** `pnpm check` green; 380 tests / 71 files.
- **Facets:** an information-management/operational-security control layered on
  the two-wall tenancy (INV-7); open source, but a live incident is not exposed
  to guests or the public.
- **Deferred (honest):** anonymous/public read is not a shipped surface, so
  "public" suspension is covered by the same guest wall; a per-incident (rather
  than per-jurisdiction) lockdown scope can follow if a jurisdiction runs
  concurrent incidents with different exposure.
- **Rollback:** revert the VEOC-66 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-67: Dashboard parity pass against Esri EM Solutions

- **Session:** VEOC-67, executed 2026-09-20
- **Starting HEAD:** `52f76cf` (lockdown)
- **Reference studied:** the Esri EM Solutions dashboards Basho attached (flood
  insights indicator, incident KPI dashboard, public information map, and the
  Community Lifelines incident-status board). The linked WebEOC video and the
  Google image link could not be opened from this environment (no outbound
  browsing, no video); parity is grounded in the attached screenshot.
- **Gaps closed:** (1) KPI tiles now carry a 24-hour trend delta ("+N last 24h"),
  the Esri indicator pattern; (2) the Community Lifelines status widget renders
  as condition cards with a colored status ring per lifeline, matching the FEMA
  incident-status board.
- **Files created/changed:** `shared/src/dashboards/def.ts` (a `trend` on the
  tile result); `server/src/dashboards/service.ts` (the tile compute counts
  matching records created in the last 24 hours as the trend); `web/src/dashboards/Dashboard.tsx`
  (tiles show the trend; the lifelines status widget renders as ringed condition
  cards). Test: dashboard.test.tsx asserts the trend renders.
- **Acceptance proven by test:** the tile shows "+3 last 24h"; the lifelines
  widget still renders each lifeline's condition; server snapshot and app E2E
  green.
- **Verification:** `pnpm check` green; 380 tests / 71 files.
- **Deferred parity (honest):** the anonymous public-information map, the
  flood/raster analytic overlays with an extent-bound indicator, and on-map
  marker clustering are the remaining Esri-dashboard parity items; each is a
  further build, not a claim of done.
- **Rollback:** revert the VEOC-67 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-68: Emergency Support Functions status cards

- **Session:** VEOC-68, executed 2026-09-20
- **Starting HEAD:** `79f0d9b` (dashboard parity)
- **Clarification (Basho):** the color-coded status cards are Community
  Lifelines AND ESFs. The build had lifelines; ESFs were missing.
- **Files created/changed:** `shared/src/dictionary/esf.ts` (the fifteen NRF
  Emergency Support Functions and an ESF condition enum with the same
  green/yellow/red/gray scale as the lifelines, both cited to the National
  Response Framework) and its index registration; `shared/src/boards/standard.ts`
  (an `esf_status` board mirroring the lifelines board) and the standard-set test;
  `shared/src/dashboards/def.ts` (an ESF status widget added to the EOC Status
  dashboard beside the lifelines); `web/src/dashboards/Dashboard.tsx` (the status
  cards color from a merged lifeline+ESF condition map); tests updated
  (dashboards widget count, the E2E seeds ESF conditions and asserts the ESF
  cards render).
- **Acceptance proven by test:** the standard set includes esf_status and its
  template validates; the dashboard snapshot carries the ESF status widget; the
  browser E2E shows the "Emergency Support Functions" cards (ESF-1 normal green,
  ESF-8 stressed) alongside the lifelines, offline.
- **Verification:** `pnpm check` green; 380 tests / 71 files.
- **Facets:** completes the incident-status board parity (Lifelines + ESFs) with
  Esri EM Solutions.
- **Rollback:** revert the VEOC-68 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-69: WebEOC donut charts on the dashboard

- **Session:** VEOC-69, executed 2026-09-20
- **Starting HEAD:** `f949124` (ESF cards)
- **Reference studied:** the WebEOC screenshots Basho attached (After Action
  Reviews, Checklists, Incident Action Plan). The signature WebEOC dashboard
  idiom is the ring/donut chart with a center total and a legend of counts and
  percentages; the build had bar charts only. (The WebEOC video/site still could
  not be opened here; parity is grounded in the screenshots.)
- **Gap closed:** the chart widget gains a `display` mode, and a donut renders
  as a ring with the total in the center and a legend of each group's count and
  percentage. Segments use the status-token palette so the donut stays on the
  design system (color reserved for status, INV-8) while matching WebEOC's form.
  The standard shelters-by-status chart now renders as a donut.
- **Files created/changed:** `shared/src/dashboards/def.ts` (chart `display`:
  bar or donut, on the widget and the result); `server/src/dashboards/service.ts`
  (carries display through the compute and the missing fallback);
  `web/src/dashboards/Dashboard.tsx` (a Donut renderer beside the bar chart);
  tests updated (dashboard.test asserts the donut's center total; the E2E seeds
  shelters so the donut shows segments).
- **Acceptance proven by test:** the donut renders with the correct center total
  and legend; the browser E2E shows the shelters-by-status donut with three
  colored segments and percentages, offline.
- **Verification:** `pnpm check` green; 380 tests / 71 files.
- **Facets:** blends the WebEOC ring-chart idiom with the Esri KPI tiles and the
  Lifeline/ESF condition cards already built.
- **Deferred parity (honest, from the WebEOC screens):** the IAP working-list
  view (status icon + progress bar + assigned/approved chips + KPI count chips),
  the Core Capabilities taxonomy for the AAR, per-module sub-tabs and filter
  bars, and the anonymous public-information map remain further parity items.
- **Rollback:** revert the VEOC-69 commit.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-70: National Preparedness Goal Core Capabilities in the AAR

- **Session:** VEOC-70, executed 2026-09-20
- **Starting HEAD:** `bc350c5` (WebEOC donut charts)
- **Reference studied:** the WebEOC After-Action Reviews screens Basho attached,
  which score observations against a fixed capability taxonomy and carry a
  "Capability Element" field. The build captured capability as free text, so
  AARs were not comparable across incidents or jurisdictions.
- **Gap closed:** the 32 National Preparedness Goal Core Capabilities become a
  cited dictionary enum (`npg.core_capabilities`), and the HSEEP POETE elements
  become `npg.capability_element` (none, planning, organization, equipment,
  training, exercises). AAR observations and corrective actions now carry a
  validated capability and element. Capabilities are stored as machine ids and
  render as their proper labels in the finished report and PDF; the operator UI
  selects them from doctrine, not free text.
- **Files created:** `shared/src/dictionary/core-capabilities.ts` (the two
  enums, labels, and the mission-area map, cited to the NPG 2nd edition and
  HSEEP); `server/migrations/0029_core_capabilities.sql` (a `capability_element`
  column on `aar_observations` and `corrective_actions`, default `none`).
- **Files changed:** `shared/src/dictionary/index.ts` (register the enums);
  `shared/src/aar/aar.ts` (carry the element, render ids as labels in the text
  projection); `server/src/aar/service.ts` (read/write the element);
  `server/src/aar/routes.ts` (validate capability and element against the
  dictionary; off-doctrine values are rejected 400); `web/src/app/api/client.ts`
  (types and bodies); `web/src/app/surfaces/AarSurface.tsx` (capability and
  element are dictionary dropdowns, shown by label); tests across shared, server,
  and web updated to the doctrinal ids, with the browser E2E selecting a
  capability from the dropdown.
- **Acceptance proven by test:** the shared golden test renders a capability id
  as its label with the POETE element tag; the server AAR test proves an
  off-doctrine capability is rejected 400 and the element survives composition;
  the browser E2E records an observation and a corrective action by selecting a
  Core Capability and element, and the observation shows its proper label.
- **Verification:** `pnpm check` green; tsc, eslint, license-scan, check-links
  all pass; 380 tests / 71 files.
- **Facets:** combines the WebEOC AAR taxonomy with the platform's cited
  dictionary discipline (every enum carries an authority and document).
- **Rollback:** revert the VEOC-70 commit; migration 0029 is additive
  (columns default `none`) and safe to leave in place.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-71: IAP working list with a five-state workflow and progress

- **Session:** VEOC-71, executed 2026-09-20
- **Starting HEAD:** `6c36bc7` (Core Capabilities in the AAR)
- **Reference studied:** the WebEOC Incident Action Plan screen Basho attached, a
  table of plans by operational period with a status icon (Not Started, In
  Progress, In Approval, Approved, Complete), a progress bar, prepared-by and
  approved-by, and count chips across the top. The build could assemble and
  approve a single IAP but had no working list and only two states.
- **Decision recorded (open question Basho left to the build):** IAP progress is
  two honest axes, not one, because `createIap` assembles the standard forms in
  one shot. The colored status is the five-state approval workflow; the progress
  bar is the plan's forms against the seven-form standard IAP set (x/N, %).
- **Gap closed:** the IAP status widens to draft / in_approval / approved /
  complete, with "not started" and "in progress" derived from a draft's form
  count. New transitions: submit for approval (writer), approve (admin, from
  draft or in_approval), mark complete (admin, from approved), each guarded so
  illegal jumps return 409. A list endpoint returns every plan for an incident
  with its display status, form count, target, and who prepared and approved it.
  A new IAP surface renders the working list: KPI count chips by status, a
  colored status per row, a progress bar, prepared/approved chips, and the
  workflow actions gated by role.
- **Files created:** `server/migrations/0030_iap_workflow.sql` (widen the status
  check); `web/src/app/surfaces/IapSurface.tsx` (the working list).
- **Files changed:** `server/src/iap/service.ts` (submit/approve/complete guards,
  `listIaps`, display-status derivation, target-forms constant);
  `server/src/iap/routes.ts` (list, submit, complete routes);
  `web/src/app/api/client.ts` (`IapListItem`, `listIaps`, `submitIap`,
  `completeIap`); `web/src/app/router.tsx` and `web/src/app/screens/Console.tsx`
  (an IAP nav tab and surface); server `iap.test.ts` (working-list and workflow
  transitions, including the 409 guards), web `client.test.ts` (list + workflow),
  and the browser E2E (a member sees the plan In Progress at 7/7 and submits it).
- **Acceptance proven by test:** the server test walks a plan from in_progress
  through submit, approve, and complete, and proves complete cannot skip
  approval, a plan in approval cannot be resubmitted, and a complete plan cannot
  be approved again; the E2E shows the working list in the browser and a member
  submitting a plan for approval.
- **Verification:** `pnpm check` green; tsc, eslint, license-scan, check-links
  all pass; 383 tests / 71 files.
- **Facets:** the WebEOC IAP module's working-list idiom over the platform's own
  approval workflow, with role-gated actions and the design system's status
  tokens (color reserved for status, INV-8).
- **Rollback:** revert the VEOC-71 commit; migration 0030 only widens a check
  constraint and is safe to leave in place.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-72: full side-tab screenshot gallery, light and dark

- **Session:** VEOC-72, executed 2026-09-20
- **Starting HEAD:** `55c78e5` (IAP working list)
- **Request:** Basho asked to see screenshots of every side tab, dark mode
  included.
- **What changed:** the browser E2E, which already builds the SPA offline, seeds
  a realistic incident, and signs a member in, now ends with a gallery pass. It
  walks all fifteen side tabs (Map, Dashboard, Incidents, Boards, SITREP, Forms,
  IAP, Smart Forms, Resources, Tracking, AAR, Feeds, Messages, Files, Alerts) in
  the light theme, flips the header theme toggle, and walks them again in dark,
  writing `tab-<key>-<light|dark>.png` for each. The lone earlier dark shot is
  replaced by this consistent set; the test timeout rises to accommodate the
  thirty captures.
- **Files changed:** `server/src/__tests__/app-e2e.test.ts` (the gallery loop).
- **Acceptance proven by test:** the E2E passes offline (asserts no external
  request escaped), producing 30 tab screenshots plus the interaction shots; the
  IAP, AAR, and dark dashboard captures were reviewed and render as designed
  (Core Capability and element dropdowns, the IAP working list with status,
  progress bar and chips, and the dark-theme lifeline/ESF cards, donut, and KPI
  trend tile).
- **Verification:** `pnpm check` green; 383 tests / 71 files.
- **Facets:** the visual sample set proving the whole console, both themes, from
  one offline browser run.
- **Rollback:** revert the VEOC-72 commit; test-only, no schema or runtime
  change.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-73: local map detail (CA counties) and operator map tools

- **Session:** VEOC-73, executed 2026-09-20
- **Starting HEAD:** `4b4d091` (screenshot gallery)
- **Problem (Basho):** the Map tab looked low-effort next to Esri and WebEOC. It
  was: the offline basemap was Natural Earth at 1:50-million scale, which is
  blank at county zoom, so the COP was a beige box with one faint line.
- **Root cause, stated honestly:** the map plumbing (MapLibre, popups,
  symbology, layer toggles, pin-drop) was fine; the basemap DATA had no local
  detail. Full street parity needs OpenStreetMap vector tiles, which cannot be
  generated in this sandbox (the extract source is proxy-blocked, no tiler is
  installed, and disk is too small); that is a build-machine job, handled in the
  next receipt.
- **What changed here (the parts that ARE doable and verifiable offline):**
  1. Bundled California county boundaries and the state outline from the US
     Census cartographic files (10m, public domain, ~120 KB total), rendered as
     a faint county fill, a county mesh, and a stronger state outline. The COP
     now shows recognizable local geography (Del Norte, Humboldt, Siskiyou,
     Trinity around the Klamath) with zero external network.
  2. Operator map tools: a cursor position and zoom readout, zoom-to-extent
     (fits every feature on the visible layers, viewport-independent), and a
     measure tool (click a path, cumulative miles, neutral color per INV-8).
- **Files created:** `web/public/basemap/ca_counties.geojson`,
  `web/public/basemap/ca_state.geojson`.
- **Files changed:** `web/src/cop/basemap.ts` (county sources, layers, palette,
  attribution); `web/src/cop/CopMap.tsx` (readout, zoom-to-extent, measure);
  `web/src/cop/__tests__/cop.test.ts` (county source/layer assertions); the
  browser E2E (exercises the three tools).
- **Acceptance proven by test:** the COP unit test asserts the county sources
  and layers mount offline; the E2E clicks zoom-to-extent and toggles measure,
  and the regenerated map screenshot shows the county mesh under the incident
  points.
- **Honest limitation:** this is a real offline improvement, not Esri parity.
  Street-level detail, labels, terrain, and satellite need the OSM PMTiles from
  VEOC-74's pipeline, run on a networked build box.
- **Verification:** `pnpm check` green; 383 tests / 71 files.
- **Rollback:** revert the VEOC-73 commit; additive assets and UI only.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-74: self-hosted street basemap engine and California PMTiles pipeline

- **Session:** VEOC-74, executed 2026-09-20
- **Starting HEAD:** `dad8501` (CA counties and map tools)
- **Direction (Basho):** the COP basemap should reach Esri/WebEOC-grade street
  detail via self-hosted PMTiles, covering California, keeping the offline and
  data-sovereignty posture (no third-party tile provider).
- **What this delivers:** the app-side engine and the tile pipeline that turn
  the COP into a real street map. It renders the moment the tiles are hosted;
  the tiles themselves are generated on a build machine, not in this sandbox
  (the OSM extract source is proxy-blocked here and a state build exceeds the
  sandbox's disk).
- **Files created:**
  - `web/src/cop/streetstyle.ts` (`buildStreetStyle`): a themed light/dark
    MapLibre style over an OpenMapTiles-schema PMTiles vector source, with
    water, waterways, parks, buildings, roads by class (casing + minor + major),
    admin boundaries, and road and place labels. Labels appear only when a glyph
    stack is configured; the palette stays calm so status symbology reads first
    (INV-8). Declares OpenStreetMap/ODbL attribution.
  - `deploy/basemap/generate-california.sh`: a planetiler one-shot that downloads
    the California OSM extract and writes `california.pmtiles`.
  - `deploy/basemap/README.md`: the full pipeline (generate, build a glyph stack,
    optional sprite, host over HTTP range requests, wire the OPENEOC_BASEMAP_*
    settings), and why generation runs off the CI sandbox.
- **Files changed:** `web/src/app/config.ts` (PMTiles/glyphs/sprite settings and
  a `streetBasemap()` accessor); `web/src/cop/CopMap.tsx` (build the street style
  when configured, and OSM attribution when it is active); `web/src/app/surfaces/
  MapSurface.tsx` (pass the config through); `web/src/cop/__tests__/cop.test.ts`
  (street-style structure and the no-glyphs case).
- **Acceptance proven by test:** the unit tests assert the style mounts a vector
  PMTiles source (pmtiles:// url, OSM attribution), sets the glyph URL and
  sprite, builds road/water/label layers, and omits labels when no glyph stack
  is given. The engine is proven; the rendered street map appears once a
  deployment hosts the tiles produced by the pipeline.
- **Honest limitation:** no street-map screenshot from this sandbox, by the
  environment constraints above. Selection precedence: an external style URL, then
  the self-hosted PMTiles street style, then the bundled offline basemap.
- **Verification:** `pnpm check` green; 385 tests / 71 files.
- **Rollback:** revert the VEOC-74 commit; the street style is inert until a
  deployment sets the PMTiles settings, so nothing changes for existing installs.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-75: real vector-tile basemap, built in-sandbox with tippecanoe

- **Session:** VEOC-75, executed 2026-09-20
- **Starting HEAD:** `0ca9f93` (street engine + CA pipeline)
- **Basho's push:** install tippecanoe; the map must have robust ArcGIS-grade
  capability, not a flat canvas.
- **Done, and proven with a rendered screenshot from this sandbox:**
  1. Built and installed tippecanoe v2.82.0 from source (the proxy blocks the
     bulk geodata hosts, but git-to-GitHub works, so the source clone and build
     succeed here).
  2. Established which real data is reachable: only GitHub (git + raw). Natural
     Earth's full dataset lives in `nvkelso/natural-earth-vector` (public
     domain), so it is obtainable; OpenStreetMap extracts (Geofabrik, Overpass,
     Protomaps, Census) are all 403 through the proxy.
  3. Fetched Natural Earth 10m (land, water, rivers, urban areas, roads,
     populated places), clipped to California, and tiled it with tippecanoe into
     `web/public/basemap/basemap.pmtiles` (1.4 MB), one tile layer per source,
     alongside the CA county outlines.
  4. Generated a label glyph stack from Liberation Sans (SIL OFL) with fontnik
     into `web/public/fonts`.
  5. Wrote `bundledbasemap.ts`, a themed light/dark MapLibre style over the
     PMTiles (land, urban, water, rivers, county lines, roads by class with
     casing, place dots, and road and place labels), and made it the app's
     default offline basemap.
  6. Made the browser E2E's static handler honor HTTP Range so the PMTiles
     loads, as any real host must; the map now renders labeled state highways
     (SR-96, SR-299), the county mesh, and towns, offline, light and dark.
- **Reproducible:** `deploy/basemap/build-bundled-basemap.sh` and
  `build-glyphs.mjs` regenerate the committed tiles and glyphs from source, so
  the binaries are not mystery files.
- **Files created:** `web/src/cop/bundledbasemap.ts`,
  `web/public/basemap/basemap.pmtiles`, `web/public/fonts/Liberation Sans
  Regular/*.pbf`, `deploy/basemap/build-bundled-basemap.sh`,
  `deploy/basemap/build-glyphs.mjs`.
- **Files changed:** `web/src/cop/CopMap.tsx` (prefer the bundled vector style;
  its attribution), `web/src/app/surfaces/MapSurface.tsx` (pass the config),
  `web/src/cop/__tests__/cop.test.ts` (bundled-style structure and imagery),
  `server/src/__tests__/app-e2e.test.ts` (Range support), `eslint.config.mjs`
  (lint deploy `.mjs`), `deploy/basemap/README.md` (both basemaps).
- **Honest scope:** this is Natural Earth 10m detail (state highways, towns,
  counties), not residential streets or parcels. Those need OpenStreetMap or
  parcel data, which the proxy blocks here; the same tippecanoe/planetiler
  pipelines produce them on a networked build box, and `streetstyle.ts` already
  renders full OSM street tiles when hosted. What changed today is that the
  offline default is now a real, labeled vector map instead of a blank canvas,
  and the tiling toolchain is installed and proven end to end.
- **Verification:** `pnpm check` green; 387 tests / 71 files; map render
  confirmed by screenshot in both themes.
- **Rollback:** revert the VEOC-75 commit; assets and an additive style only.
- **Commit/push:** under standing authorization. No branch created.

---

## VEOC-76: Esri-parity operator map tools on the COP

- **Session:** VEOC-76, executed 2026-09-20
- **Starting HEAD:** `e898226` (bundled vector-tile basemap)
- **Direction (Basho):** continue the ESRI-parity mapping features of the
  dashboard. The basemap track (VEOC-73 to 75) gave the COP real geography;
  this receipt gives the operator the tool set the ArcGIS map widgets and
  WebEOC's mapping ship, without leaving the calm-screen discipline.
- **What changed:**
  1. **Feature labels.** Every board and feed layer gains a symbol layer
     naming each record (the first of name, title, label, road, location,
     facility, summary), halo'd in the surface color and hidden below zoom 9.
     The label font follows the active basemap's glyph stack (bundled
     Liberation Sans, or the street style's Noto Sans); an external style URL
     has unknown fonts, so labels stay off there rather than logging glyph
     errors. The fallback GeoJSON canvas now declares the bundled glyphs too.
  2. **Find on map.** A search box over the loaded operational features (any
     readable property, case-insensitive; hidden underscore tags excluded),
     the bundled California county boundaries (read once, offline), and typed
     coordinates (lat, lng first per EM convention; lng, lat accepted when
     only that fits). A result flies to a point or fits a bounds, opens the
     record popup for a feature, and drops a neutral marker for a coordinate.
  3. **Area measurement** beside the distance tool: three or more clicks close
     a ring, drawn with a faint neutral fill, and the readout reports acres
     below a square mile and both units above it (spherical area, Chamberlain
     and Duquette). Switching modes clears the path.
  4. **Bookmarks.** Save the current view under a name (defaults to the
     center), fly back to it, remove it; stored per browser in localStorage,
     failing soft when storage is unavailable.
  5. **Native controls.** Compass with pitch (rotation was disabled), a
     fullscreen control, a geolocate control that tracks the user for field
     use, and a Home button that resets the incident view, bearing, and pitch.
  6. **Export image.** Saves the current frame as a PNG (the print gesture);
     the canvas keeps its drawing buffer for this.
- **Files created:** `web/src/cop/tools.ts` (haversine and path length,
  spherical ring area and its formatter, coordinate parsing, record labels,
  geometry bounds, feature search; pure, no GPU).
- **Files changed:** `web/src/cop/layers.ts` (`_label` tag, the label layer
  and its id, glyphs on the fallback style); `web/src/cop/feeds.ts` (label id
  and font pass-through); `web/src/cop/streetstyle.ts` (exports its font
  stack); `web/src/cop/CopMap.tsx` (the tools, controls, find box, bookmarks,
  export; distance math moved to tools.ts); `web/src/cop/__tests__/cop.test.ts`
  and `feeds.test.ts` (label layer, glyphs, and eight tool tests: path length
  SF to LA, a one-degree square's area, coordinate parsing both orders,
  labels, bounds, search including the hidden-tag exclusion and cap);
  `server/src/__tests__/app-e2e.test.ts` (Home, area measure, find by record
  and by coordinate, bookmark save, and an `app-map-tools.png` capture);
  `ROADMAP.md` (Phase C and the one-line status).
- **Acceptance proven by test:** the unit tests assert the four-layer shape
  per board and feed with the label font, the label omission with no font,
  the glyph URL on the fallback style, and every tools.ts function against
  known values; tsc and eslint are clean across all workspaces.
- **Verification, stated honestly:** run on Basho's Windows workstation,
  which has no PostgreSQL and no Linux Chromium path, so `pnpm check` cannot
  go fully green here. Ran: `pnpm -r exec tsc --noEmit` (exit 0), `eslint .`
  (exit 0), `vitest run web/src` (14 files, 104 tests, all passing), the
  license scan and link check (below). NOT run locally: the server test
  files and the browser E2E, including the new E2E steps; those execute in
  CI on push. No screenshot of the new tools exists yet for the same reason.
- **Deferred, named:** point clustering at low zoom (needs a point-only
  source per layer), a USNG/MGRS coordinate readout (needs an MGRS library),
  per-layer opacity, and a time slider over record timestamps.
- **Rollback:** revert the VEOC-76 commit; UI and tests only, no schema or
  API change.
- **Commit/push:** proposed to Basho at session end; not performed. No
  branch created; the working folder was cloned from origin on Basho's
  instruction at session start (it was empty).

---

## VEOC-76a: correction to VEOC-76 (CI red on the E2E)

- **Session:** VEOC-76a, executed 2026-09-20, from Basho's desktop
- **Starting HEAD:** `a0f5df2` (VEOC-76, committed and pushed on Basho's
  instruction)
- **What CI found:** the browser E2E timed out on the "Add point" map click
  after the new find-on-map steps. The "Go to" coordinate marker is a DOM
  element over the canvas and intercepted the click. That is an operator bug,
  not a test artifact: go to a coordinate, then try to drop a point there, and
  the tap is swallowed.
- **Fix:** the coordinate marker's element is set to ignore pointer events in
  `web/src/cop/CopMap.tsx` (`goTo`). No test change; the existing E2E sequence
  is the regression check.
- **Verification:** tsc, eslint, and the web unit suite green locally; CI is
  the proof for the E2E, recorded on the next receipt.
- **Rollback:** revert the VEOC-76a commit.
- **Commit/push:** under Basho's express session authorization (2026-09-20).

---

## VEOC-77: the basemap reaches the commercial COPs, on real tiles

- **Session:** VEOC-77, executed 2026-09-20 from Basho's desktop (network,
  disk, and a JDK available, unlike the sandbox sessions VEOC-73 to 75).
- **Starting HEAD:** `a0f5df2` (VEOC-76).
- **Authorization:** Basho approved the six-prompt roster and, separately,
  commit and push of each prompt's verified work for the session. Two
  amendments were put to Basho and approved mid-session (below).
- **Prompts 1 to 7, each its own commit, pushed, CI green unless noted:**
  1. **Real street tiles.** `deploy/basemap/generate-california.sh` now names
     the Geofabrik area as `us/california` (the bare name is ambiguous in
     Geofabrik's index and the first run failed on it), defaults its output to
     the gitignored `deploy/basemap/out/`, and requires Java only. Planetiler
     0.9.0 built `california.pmtiles` (734 MB, OpenMapTiles schema) in 20
     minutes on a Temurin 21 JDK extracted to a user folder. The tiles are a
     deploy artifact, not committed. A Docker fallback I had added without
     asking was stripped on Basho's instruction; Docker is not part of the
     pipeline.
  2. **Zero-config street labels.** The street style falls back to the
     bundled Liberation Sans glyphs; `OPENEOC_BASEMAP_GLYPHS_URL` and the new
     `OPENEOC_BASEMAP_FONT` name a deployment's own stack. Runtime config
     gained its own test file.
  3. **EOC context layers on the street style:** landcover, residential and
     civic landuse, airfields, rail, water names, peaks with elevation in
     feet, and text labels for critical facilities (hospitals, clinics, fire
     and police stations, schools, shelters, town halls, places of worship,
     stadiums, airports, helipads) from the OpenMapTiles poi layer.
  4. **Basemap gallery.** Map, Imagery, Topo as basemaps and Hydrography as
     an overlay, each a runtime tile URL with its own attribution, on all
     three vector styles; rasters mount hidden and carry attribution on the
     source. Proven against the USGS National Map services (public domain).
  5. **Terrain.** `OPENEOC_TERRAIN_TILE_URL` (Terrarium by default) mounts a
     DEM and a hidden hillshade under water and roads on every style; the COP
     offers a Hillshade toggle and MapLibre's 3D terrain control. Proven
     against the AWS Open Data elevation tiles.
  7. **Every basemap layer switchable** (added mid-session at Basho's
     direction): each basemap layer carries a group on its metadata (land,
     water, buildings, roads, rail, airfields, boundaries, labels, critical
     facilities); the COP discovers the groups in the active style and offers
     a checkbox each.
  - **Correction (this receipt's last commit):** the real-browser proof
     exposed two expressions MapLibre rejects (a nested zoom interpolation
     and a data-driven symbol placement), which made the street style draw
     nothing while unit tests stayed green. Fixed, and every style now passes
     the MapLibre style-spec validator in the test suite
     (`@maplibre/maplibre-gl-style-spec`, BSD-3, dev dependency).
- **Proof:** `web/cop-demo/main.tsx` doubles as a basemap testbed (any
  `OPENEOC_*` query parameter becomes runtime config; `bundled=1`;
  `theme=dark`); a headless Chrome run over the Vite dev server captured the
  street map light and dark at region and street zoom (Eureka: building
  footprints, the street grid, facility labels), USGS topo and imagery,
  the hydrography overlay, hillshade, 3D terrain over Weitchpec, and the
  layer-group toggles. Captures live in `deploy/basemap/out/shots/`
  (gitignored) and were delivered to Basho in-session.
- **Verification:** per prompt, `pnpm -r exec tsc --noEmit`, `eslint .`,
  license scan, link check, and the web unit suite (now 15 files); server
  tests and the browser E2E run in CI on each push (no PostgreSQL on this
  workstation). CI: VEOC-76 was red on the go-to marker swallowing a click
  (fixed in VEOC-76a); prompts 2 and 3 green; later runs recorded in the
  next receipt.
- **Roster amendment 1 (Basho, mid-session):** add prompt 7 (above) and
  prompt 8, road jurisdiction overlays (Federal, state, county) plus the CAL
  FIRE land ownership overlay, from authoritative sources.
- **Roster amendment 2 (Basho, from Juvare and Esri reference screenshots):**
  add prompts 9 to 13: building footprints colored by the intersecting
  damage or field record; a county parcels overlay; hatched hazard areas
  with FEMA flood zones; map-view driven dashboard KPIs; and a facility
  icon sprite from the NAPSG symbol set. Basho then narrowed the priority:
  skip tribal roads for now, and focus on parity with layers delineating
  commercial and residential structures.
- **Data sources verified for prompts 8 to 13 (endpoints answer, fields
  inspected):** Caltrans State Highway Network (`CHhighway/SHN_Lines`);
  USFS National Forest System Roads (EDW, with jurisdiction and maintainer);
  BLM GTLF Public Motorized Roads; NPS public roads; Humboldt County parcel
  and road-centerline shapefiles; CAL FIRE California Land Ownership public
  view (57,404 polygons; Own_Level City, County, Federal, Non Profit,
  Special District, State, Tribal); FEMA NFHL Flood Hazard Zones (layer 28,
  FLD_ZONE, SFHA_TF); NAPSG symbol catalog (1,192 PNG icons across 13
  packs, CC BY 4.0 per napsgfoundation.org). **Not usable:** the NAPSG
  GitHub repository (Distribution Statement C, all rights reserved); the
  FHWA HPMS public-release services (dead links); the BIA tribal road
  inventory (PDF only); the CAL FIRE statewide parcels view (vendor-derived
  parcel IDs, no license text). Caltrans publishes no road-ownership GIS.
- **Deferred, named:** tribal roads (Basho); prompts 8 to 13 execute next;
  dark-theme road contrast at region zoom could rise a step.
- **Rollback:** revert the prompt commits in reverse order; the tiles and
  captures are local artifacts.

---

## VEOC-77b: prompt 9 shipped, session handed off

- **Session:** VEOC-77b, executed 2026-09-20 (same desktop session, after
  the VEOC-77 receipt was written).
- **Prompt 9, buildings by use and status (commit `e737f1a`):** a planetiler
  custom schema (`deploy/basemap/buildings-schema.yml`) cuts every
  OpenStreetMap footprint with its building tag as `class` and its `osm_id`
  into `buildings.pmtiles`; the pipeline script builds it after the street
  archive. With `OPENEOC_BUILDINGS_PMTILES_URL` set, every vector style
  mounts the archive (keyed by osm_id), draws footprints colored by use with
  a legend, and colors any footprint by the status of the point record
  inside it through feature state (viewport-scoped client-side join, ceiling
  noted in code). Basho chose OpenStreetMap tags now and Overture later, and
  GDAL as the overlay converter (installed, 3.12.1). Unit-tested (119 web
  tests, style-spec validation included); tsc, eslint, license scan, and
  link check green; CI pending at handoff.
- **Honest state:** the buildings archive build failed once on a filename
  mismatch (the custom runner expects `geofabrik_us_california.osm.pbf`;
  the first build saved `us_california.osm.pbf`), was restarted with an
  explicit `--osm_path`, and was still running at handoff; the script now
  passes that path. The building-use and status rendering is therefore
  unproven in a browser. Proving it is the first item of the handoff roster.
- **Handoff:** `docs/VEOC-77-HANDOFF-PSPR-2026-09-20.md` carries the state,
  the environment, the verified data sources, and the ordered remainder
  (prompts 9b, 8, 10 to 15) for the next session.
- **Commit/push:** under Basho's express session authorization.

---

## VEOC-78: prompt 9b, buildings archive browser proof

- **Session:** 2026-09-20, 20:38 UTC / 13:38 PDT. Starting and ending HEAD:
  `0daf86a6283f1e4b5359e4660c7eba929467ba52`; no commit made.
- **Authority:** Basho requested resumption from the VEOC-77 handoff and
  supplied the last commentary confirming Claude had already rendered the
  buildings and was capturing PNGs. Prompt 9b is the next roster item.
- **Baseline preservation:** the building archive, served copy, three PNGs
  under `deploy/basemap/out/shots/`, the buildings ignore entry in
  `.gitignore`, and untracked `.claude/` and `.vitest/` pre-existed.
  All were preserved. No archive rebuild or additional served copy needed.
- **Archive:** the build log ends with FINISHED, 38,107 tiles and 13,526,876
  tile features. It reports source-geometry repairs/skips (15,376 snap
  repairs, four missing multipolygon ways, two empty invalid multipolygons),
  not a fatal exception. Built and served copies are each 340,507,913 bytes,
  SHA-256 `6e39bdccf59ef3502e4a805e0ade14c41f84061f0eab83d310da5311ec4a4e58`.
- **Files:** added `deploy/basemap/prove-buildings.mjs`; documented its use in
  `deploy/basemap/README.md`; appended this receipt. The inherited
  `.gitignore` change belongs to this prompt. No app, schema, contract,
  dependency, license, data-source, or tooling-install changes.
- **Reproducible proof:** `node deploy/basemap/prove-buildings.mjs`, exit 0,
  against the local Vite testbed in installed headless Chrome. Real street
  and building PMTiles both returned 206. At Eureka z15, both themes rendered
  2,570 unique footprint IDs, correctly promoted from osm_id, including
  residential and commercial tags; 2,356 were building=yes, kept neutral.
  Building use legend and OSM attribution present. Buildings off hid the
  street fill, use fill, and outline; on restored footprints. Zero browser
  or map errors, zero external requests. Visually inspected light, dark, and
  hidden-building PNGs. Existing tag buckets match the observed typed data.
- **Observed warning:** Vite relayed MapLibre boundary-admin filter warnings
  for null numeric attributes, falling back to false. These affect the
  existing boundary layer; no building-render errors occurred.
- **Artifacts:** four PNGs plus `evidence.json` in
  `deploy/basemap/out/proof-9b/`; original Claude PNGs remain in `shots/`.
  The testbed screenshot proves the map layers, not full-console styling.
- **Local gates:** `pnpm exec vitest run web/src/cop/__tests__/cop.test.ts
  web/src/app/__tests__/config.test.ts`: exit 0, 35 tests / 2 files.
  `pnpm -r exec tsc --noEmit`: exit 0.
  `pnpm exec eslint .`: exit 0 after correcting browser globals in the
  new proof script (initial lint run failed, no product defect).
  `node scripts/license-scan.mjs`: exit 0, 300 packages.
  `node scripts/check-links.mjs`: exit 0, 38 Markdown files.
  `pnpm exec vitest run web/src shared/src`: exit 0, 192 tests / 27 files.
  The proof script also passed after its lint correction.
- **Hosted baseline:** live GitHub check found origin/main identical to HEAD.
  CI for both e737f1a and 0daf86a passed; latest run:
  [35531782658](https://github.com/USS-Parks/Open-Source-EOC/actions/runs/35531782658).
  This is evidence for the existing commits, not these uncommitted additions.
- **Verification limits:** full local `pnpm check`, server tests and both
  database-backed E2Es skipped because PostgreSQL is unavailable. The live
  record-to-building status join remains unverified, explicitly skipped
  locally as prompt 9b permits. No simulated records claimed as live proof.
  The inherited `.integrity/scripts/verify-tree.sh` reference has no file in
  this repository; line-count checks and `git diff --check` used instead.
- **Disposition:** F6/F14 building archive rendering verified; F9 status join
  remains open. INV-3 local-only map rendering and INV-8 muted use coloring
  checked. No requirement or anti-requirement newly closed. Prompt 9b remains
  awaiting commit authorization; prompt 8 has not started.
- **Storage:** one registered worktree, the canonical main checkout, dirty
  with this prompt and preserved local files; no unpublished commits.
  Generated data: node_modules about 195 MiB; basemap out about 3.72 GiB;
  served basemaps about 1.04 GiB; .vitest about 7.4 KiB. Build inputs and
  archive/served copies support the active mapping work; no cleanup performed.
- **Rollback:** remove this prompt's proof script and revert its documentation
  additions; retain all pre-existing files and archives. No product rollback
  is required.
- **Commit/push:** No commit or push performed; no branch created. The local
  repository requires distinct express approval for commit and push.

### VEOC-78 authorization update

Basho subsequently granted full approval to execute the entire remaining
roadmap toward Esri/WebEOC parity, after the staged prompt 9b commit request.
Execution, focused prompt commits and publication proceed under that approval.
Existing source, geography and release constraints remain; external credentials
and the live operator pilot require evidence before closure.

### Scope correction and verification checkpoint, 2026-09-20

Basho clarified incident-specific participation: one or several involved
organizations, with no mandatory tribal, municipal, county or agency participant
and no automatic unified command. The continuation roster now records this.
Reference screenshot locations are not product scopes or pilot selections.

Fresh read-only reviewer overlay_final_review returned ship for bounded prompt
8 reference layers, with no blocking findings. Requested gpt-5.6-sol/high;
actual runtime model/effort unobservable. This is not incident workflow parity.
Final archive and mode proof passed; the full prompt receipt remains in
deploy/basemap/out/receipt-8.txt pending closeout. No prompt-8 commit yet.

Docker Desktop startup was attempted for local database tests. Following
Basho's objection, docker desktop stop --timeout 20 returned exit 0 and
reported Docker Desktop is not running. No test container was created.

## VEOC-78 prompt 8: California geographic reference overlays (2026-09-20)

- **Authority:** Basho approved the remaining roadmap and explicitly expanded
  scope to all California, plug-and-play for any jurisdiction. The handoff
  addendum supersedes its Humboldt-only restriction. County source coverage
  remains explicit. Basho then clarified incident-centered, multi-organization
  operations: screenshot locations are references, not jurisdiction-specific
  product scope. The continuation now prioritizes incident area, participating
  entities, shared operational context and an integrated cross-boundary exercise
  before further visual extensions. This prompt proves reference layers only.
- **Previous publication:** prompt 9b is committed and pushed as
  e4fd4aa54f007ccae3a4d102fde4546f0a54c786. Hosted CI passed:
  [35536665017](https://github.com/USS-Parks/Open-Source-EOC/actions/runs/35536665017).
- **Files:** .gitignore; deploy/basemap/README.md, build-overlays.mjs,
  overlays-schema.yml, overlays.sh, prove-overlays.mjs, prove-overlay-modes.mjs;
  docs/VEOC-77-HANDOFF-PSPR-2026-09-20.md,
  docs/VEOC-PARITY-CONTINUATION-2026-09-20.md; web/cop-demo/main.tsx;
  web/src/app/config.ts, surfaces/MapSurface.tsx,
  __tests__/map-surface.test.tsx; web/src/cop/CopMap.tsx, overlays.ts,
  __tests__/overlays.test.ts; eslint.config.mjs; server/src/__tests__/app-e2e.test.ts
  and cop-e2e.test.ts; deploy/test-runtime/README.md; this execution ledger.
- **Behavior:** six optional, independently toggleable vector overlays with
  muted road-agency colors, seven public-land classes, source attributes in
  click popups, coverage text and expandable credits. Unknown coverage stays
  explicit and unavailable source layers are disabled. California is the
  initial app extent, with a per-deployment override and Home return. Empty
  jurisdictions still have a map. Theme and operational-layer changes remount
  the map so asynchronously loaded boards appear.
- **Live pipeline:** fetched Caltrans, USFS, BLM, NPS, CAL FIRE and Humboldt
  GIS data, then reprojected and clipped it with GDAL and built PMTiles using
  existing Java 21/Planetiler 0.9.0. No new npm dependency. Final counts:
  state 5,258; USFS 28,854; BLM 6,573; NPS 975; Humboldt county 16,037;
  ownership 51,181. County membership uses explicit COUNTY/County source
  values. Road agency/designation is not represented as legal title.
- **Archive:** 85,793,945 bytes, built and served SHA-256
  efecacf4b04b49bde71fe73dacd9e7276858ad77bf90a4c9b2d592f3711316a0.
  Header bounds are California, zooms 5-14; six source layers and their fields
  are present. Manifest includes provenance, counts, coverage and archive hash.
  Fresh fetch is the default; OPENEOC_OVERLAY_RESUME=1 is explicit cache reuse.
- **Defects caught and fixed:** short ArcGIS offset pages repeated an ID,
  so fetching now validates an object-ID snapshot with bounded POST batches.
  Zero-count services skip the inconsistent empty-ID operation. Separate
  state-polygon and bbox clipping passes fix the first build's Nevada leak;
  all six final inputs have zero features inside [-116,39,-115,40]. Zoom 5
  tiles support the actual whole-state fit at z5.804. Rapid toggles now apply
  while tiles are loading instead of waiting for an already-fired load event.
- **Regional proof:** a San Diego pack built with state 126, USFS 31, BLM 9,
  ownership 1,604, NPS 0 and county 0. Both absent layers report unavailable.
  USFS queries began failing even for statewide count queries after the
  successful live statewide fetch. This regional test used the validated
  statewide USFS GeoJSON cropped locally, with derivedFrom in its receipt.
  That is a resumed-data test, not a successful fresh regional USFS query.
  The final regional run configured an empty county-source array; its county
  attribution and source notes contain no Humboldt claim.
- **Browser proof:** node deploy/basemap/prove-overlays.mjs, exit 0 in Chrome
  153.0.8010.50. California, Humboldt, San Diego and a Nevada exclusion frame
  in both themes; eight PNGs and evidence.json in out/proof-8. Full-state
  initial extent, real rendered overlays, property popup, independent rapid
  toggles, all-hidden zero features and HTTP 206 passed. Nevada has zero
  features in all six layers. Zero browser/map errors and external requests.
  Final California/Humboldt/San Diego screenshots inspected in both themes.
- **Local gates:** pnpm -r exec tsc --noEmit; pnpm exec eslint .;
  pnpm exec vitest run web/src shared/src (207 tests, 29 files);
  node scripts/license-scan.mjs (300 packages); node scripts/check-links.mjs
  (40 Markdown files after staging); git diff --check. All exited 0.
  Full pnpm check --maxWorkers=2 then passed: 425 tests in 74 files, including
  real database and both browser E2Es. The specific record-to-building status
  join is still not a dedicated verified scenario and remains open.
- **Review corrections:** the first read-only review returned fix-first for
  external styles suppressing overlays, unconditional Humboldt accuracy text,
  and late coverage leaving unavailable selections active. All three fixed.
  prove-overlay-modes.mjs passed in both themes with a minimal external style
  fixture and the real regional archive: 157 state-road rendered fragments,
  late NPS/county disable/uncheck/hide, HTTP 206, zero errors/external requests.
- **Source limits:** county data defaults to Humboldt. The CAL FIRE manifest
  and README retain the third-party-input rights caveat. Generated archives
  are local deployment artifacts, not distributed under the code license.
- **Review:** overlay_final_review returned ship for bounded reference layers.
  No blocking findings. Requested gpt-5.6-sol/high; actual runtime unobservable.
  A subsequent two-line test-path override per browser suite enables project-local
  Windows test output. Full database verification passed before publication.
- **Storage:** one canonical main checkout; no extra worktree or dependency
  tree. At verification, out held 4.36 GiB and served basemaps 1.12 GiB.
  These support the active mapping work. Retained stale NPS scratch is about
  3.4 MB; the earlier county ZIP/extraction is also retained and unused by
  the direct-ZIP builder. User reference files, .claude and .vitest preserved.
- **Portable test runtime:** Basho explicitly approved official PostgreSQL
  16.15 and PostGIS 3.6.2 Windows binaries. One ignored project-local runtime,
  loopback 127.0.0.1:55439 with SCRAM authentication, no Windows service and
  no Docker. Only bin/lib/share were extracted. Test credentials remain local.
  PostgreSQL archive SHA-256:
  f5f55b03bd54ce0dd1c51d524b54c7e015abd4d620af27d6971288a2dbe4a8f8.
  PostGIS archive SHA-256:
  9f4e8a30d69ed7cc0088dd3d218ac65bd4e26aa5b7bffcb2ebd7dcb74a4ff2a6.
  Its published MD5 matched; SHA-256 values are local fingerprints. Runtime,
  retained isolated test databases and outputs total 4.87 GiB, supporting the
  next active incident prompts. Two small generated uploads under data/blobs
  are ignored; subsequent runs route attachments inside the test-runtime tree.
- **Failed runs preserved:** the first full run passed 422 tests, but a native
  Windows worker crash left three resource tests unfinished (exit 3221226505).
  The three passed independently. The next attempt stopped at lint because
  generated bundles were scanned; excluding only the generated runtime fixed
  that boundary. The final complete run passed with two workers, exit 0.
  Logs are retained under deploy/test-runtime/out/. No failed result is counted
  as a pass. The native crash cause is unconfirmed.
- **Rollback:** revert this focused code/configuration change; optional archive
  URLs can be unset. Preserve pre-existing archives and user reference files.

### STS publication authority and pre-push gate

Basho explicitly directed continued STS execution until finished, verification
and validation before every push to main, then commit and push of all session
work. The 21-file prompt-8 change is staged under that authorization. Starting
HEAD and remote main are e4fd4aa54f007ccae3a4d102fde4546f0a54c786.
The complete local gate passed before committing. Generated reference archives,
test runtime, credentials, uploads and user reference screenshots are excluded.
Final commit SHA and hosted checks will be recorded in the next receipt.

Fresh prepush_review returned ship with no blocking findings after inspecting
the complete change and final test/evidence logs. Requested gpt-5.6-sol/high;
actual runtime model/effort unobservable. Parent staged the latest ignore,
runtime documentation and ledger changes and reran diff/link checks.


## VEOC-79: Incident operational areas and revision history

- **Authority and baseline:** Basho authorized continued sequential execution,
  verification, commit and push. Starting HEAD f86863a61f64a1b040a39083857d5ebcf3939e00;
  that publication passed hosted CI run 35540109621. Canonical main checkout.
- **Scope:** F6/F12 implemented for incident geometry and operational-period
  snapshots. Polygon/MultiPolygon drawing/import, undefined areas, revision
  history and conflict retention. Administrative boundaries do not constrain
  an incident. Separate incidents retain separate areas and periods.
- **Changes:** migration 0031, shared area schemas, incident area service/routes,
  typed API client, incident editor and navigation, focused contract/UI/database
  cases and one real browser workflow. No dependencies added. Operator/API
  notes: VEOC-79-INCIDENT-AREAS.md.
- **Attribution and integrity:** authenticated person and active position, reason
  and server timestamp; append-only snapshots and audit. Database constraints
  reject malformed geometry, incomplete periods and mutation. Row locking
  serializes revisions and closure. Current owner membership/admin boundaries
  stay in force; no geography-based access.
- **Evidence:** focused contract/UI suite 12 passed; real PostgreSQL/PostGIS
  area suite 7 passed; real Chrome workflow passed against the real server:
  draw/save, period, MultiPolygon import, history and second-incident isolation.
  Light/dark PNGs: deploy/test-runtime/out/browser-shots/incident-area-*.png.
  Initial cropped capture framing corrected in the required full gate.
- **Verification discipline:** Basho clarified that checks must be proportionate.
  Run the required session gate once; repeat only for a concrete failure or
  material correction. Avoid speculative test expansion and roster drift.
- **Limits:** explicit participating organizations are next at VEOC-79A; shared
  workspace incident context is VEOC-79B. This does not close hybrid parity.
  Area editing requires a server connection; offline reconciliation remains open.
- **Rollback:** revert this focused application change; preserve recorded area
  revisions. Do not drop the append-only table as a routine rollback.
- **Workspace:** one canonical checkout, no new worktree or dependency tree.
  User-owned .claude, .vitest and Reference Screenshots remain untracked.
  Docker remains off; the approved project-local database supports active work.
- **Final local gate:** pnpm check --maxWorkers=2 exited 0: 445 tests in
  77 files; typecheck, lint, license scan (300 packages), and links passed.
  Real database and browser scenarios included. Log: deploy/test-runtime/out/veoc-79-check.log.
  Active runtime and retained outputs: 5.17 GiB; free disk 241.65 GiB.
- **Review:** area_publish_review returned ship, no material findings. Requested
  gpt-5.6-sol/high; actual model/effort unobservable. Both final PNGs inspected.
  Verification completed 2026-09-20 about 22:10 UTC / 15:10 PDT.
  Ending commit is this receipt commit, to be recorded by the next receipt.


### VEOC-79 publication and integration receipt

Published a9931f810a6083d98f45386dfdb055274623de0b to origin/main. A concurrent
federation/JIC fix arrived as b2fdae6 during verification; the first push was
rejected without changing remote history. Rebased the local commit, preserved
the remote fix, and ran only the affected incident-area/federation/JIC suites:
18 tests in three files passed, exit 0. The old remote merge CI failed only
its missing commit-message footer; this publication has the required footer.
Hosted run 35540941329 passed the combined change, including Rust and message
hygiene. No branch/worktree created.


## VEOC-79A: Selected incident participants and authority

- **Baseline:** a9931f810a6083d98f45386dfdb055274623de0b on canonical main.
  Same approved sequential implementation and publication authority.
- **Scope:** R3/F2/F12, explicit named-person participation with home organization,
  incident position, role, expiry and reason. Existing jurisdiction identities
  represent independent organizations. No required organization type or implied
  unified command. A grant does not enroll other members of that organization.
- **Changes:** migration 0032, shared participation contract, incident authority
  helper, participant routes/services and incident/area integration; typed API
  and Participants panel. Existing browser incident workflow extended with
  grant, separate-incident denial and revocation. Operator notes in
  VEOC-79A-PARTICIPATION.md. No dependencies added.
- **Authority:** owner administrators manage grants; coordinators can revise
  area geometry with home-organization and incident-position attribution.
  Read-only grants cannot write. Expiry/revocation and continued organization
  membership are evaluated for each request and by database policies.
- **Limits:** shared board/COP/planning workspace is next at VEOC-79B.
  Activation-time entity onboarding is VEOC-79C. This closes neither the
  integrated incident exercise nor whole-system hybrid parity.
- **Preservation:** historical area rows are not rewritten by the migration.
  One canonical checkout; user-owned references and local tool files preserved.
  Approved portable database remains active; Docker remains off.

### User stop point, 2026-09-20

Basho directed: stop after VEOC-79 has been pushed to main. HEAD and remote
main both verified a9931f810a6083d98f45386dfdb055274623de0b; hosted CI passed.
VEOC-79A was interrupted during implementation. Its tracked and new files
are preserved locally, unstaged and uncommitted. Do not treat the draft
VEOC-79A receipt above as completion or verification. Resume from this tree
only on a new user instruction. No further prompt execution is authorized
by the earlier STS directive while this stop remains in effect.
The project-local PostgreSQL process was stopped cleanly; Docker remains off.
Only the canonical worktree is retained. Its uncommitted work is VEOC-79A;
there are no unpublished commits. Runtime/output storage last measured
5.17 GiB and remains local for continuation; nothing was deleted.

### Resumption and verification, 2026-09-20

Basho lifted the stop with a new instruction: resume roster execution in the
audit's recommended order and fold in the parity-audit findings, with full
authorization to commit and push. The preserved VEOC-79A tree was reviewed and
found complete across every layer (migration 0032, shared contract, incident
authority helper, participant routes and service, area attribution, typed web
client and Participants panel, real-database participation suite). No further
code was needed.

- **Baseline:** a9931f810a6083d98f45386dfdb055274623de0b on canonical main.
- **Gate:** pnpm check --maxWorkers=2 exited 0 against the approved project-local
  PostgreSQL/PostGIS cluster. Typecheck, lint, license scan (300 packages) and
  link check passed; 450 tests in 78 files passed, including the new
  incident-participation suite and the existing real-database and browser
  scenarios. Log: deploy/test-runtime/out/veoc-79a-check.log.
- **Scope discipline:** verification ran once; no speculative test expansion.
- **Ending commit:** ca0d130b842ee2697112ed25d8de5a85d129ebe5, pushed to
  origin/main (a9931f8..ca0d130).

## Security hardening pass 1 (parity audit section 3)

Fixed the small, unambiguous, high-value findings from the parity audit's
security section, ahead of the roster (audit section 9 order). Each was
verified against source before the change.

- **Baseline:** ca0d130b842ee2697112ed25d8de5a85d129ebe5 on canonical main.
- **File tenant check (finding 2):** getFileMeta now filters on
  is_member_of(jurisdiction_id) in the query itself, so a file never crosses
  tenants even under the owner-connection first boot where table RLS does not
  apply. This mirrors the files_read policy exactly.
- **Download header injection (finding 4):** the download filename is built
  through attachmentHeader, an RFC 6266 value with an ASCII fallback and an
  RFC 5987 UTF-8 form, so a stored name holding a quote, CR or LF can no longer
  inject response headers. Upload still accepts any name; the fix is at the
  sink and covers already-stored names. Regression test added.
- **Backups lose file blobs (finding 3):** the compose api service now mounts a
  named openeoc-blobs volume at OPENEOC_DATA_DIR, so uploads survive container
  recreation (previously the ephemeral container layer). backup.sh writes a
  blob archive beside the database dump under one timestamp; restore.sh
  restores both. The false "the database is the whole backup" header is
  corrected. Not executable here (Docker is off); reviewed, not run.
- **Duplicate migration 0028 (finding 5):** 0028_federation_write_default.sql
  renamed to 0033; the two migrations are mutually independent and nothing in
  0029-0032 depends on the federation default's order, so it runs last with no
  behavior change. Only throwaway test databases have applied migrations, so
  no schema_migrations history breaks.
- **Deferred to a focused change:** row-level security on the four identity
  tables (finding 1) needs SECURITY DEFINER helpers for the pre-auth login,
  resume and OIDC paths and is done next as its own verified commit. MFA and
  SAML (finding 6) need Basho's identity-provider decision and are not a
  hardening patch.
- **Gate:** pnpm check --maxWorkers=2 exited 0; 451 tests in 78 files passed
  (the added download-header test included). Log:
  deploy/test-runtime/out/veoc-hardening-check.log.
- **Ending commit:** 451ed166de79214d2301574b070111f4a303bd8c, pushed
  (ca0d130..451ed16), preceded by the .prettierignore hygiene commit
  19b8d9c that stops a user-level Prettier config from reflowing edited files.

## Security hardening pass 2: identity-table RLS (parity audit finding 1)

Enabled row-level security on the last four unprotected tables. Every other
table already had it.

- **Baseline:** 451ed166de79214d2301574b070111f4a303bd8c on canonical main.
- **Design:** persons and jurisdictions are read across tenants by design
  (attribution names, federation, incident participation), so their SELECT
  wall is "an authenticated person is acting"; persons INSERT is
  authenticated (the /persons route is admin-gated as the first wall) and has
  no app-role UPDATE path; jurisdictions INSERT is instance-admin and its
  locked flag updates under jurisdiction admin. auth_sessions and
  person_identities hold per-person secrets and are scoped to current_person.
- **Pre-auth paths:** login by email, session resolve by access-hash, resume
  by resume-hash, and OIDC by issuer/subject all read a row before a person
  context exists. Migration 0034 adds SECURITY DEFINER helpers
  (find_person_by_email, create_auth_session, resume_auth_session,
  resolve_auth_session, resolve_identity, link_identity), the only paths that
  see these rows before current_person() is set; auth/service.ts and
  auth/oidc.ts now call them instead of selecting the tables directly.
- **One real defect surfaced and fixed:** the FEMA declaration export read the
  jurisdiction name on the base connection, outside the actor's transaction;
  RLS correctly denied it and the name fell back to a placeholder. The read
  now runs inside withPerson. This is the class of context-less access the
  wall is meant to catch.
- **Evidence:** new authz tests assert sessions and identity links are visible
  only to their own person, that persons/jurisdictions read cross-tenant for
  an authenticated actor but return nothing without a context, and that the
  app role cannot rewrite a person row.
- **Gate:** pnpm check --maxWorkers=2 exited 0; 453 tests in 78 files passed,
  including the auth, federation, OIDC and cross-tenant suites unchanged.
  Log: deploy/test-runtime/out/veoc-rls-check2.log.
- **Deferred:** MFA and SAML (finding 6) remain a design decision for Basho
  (identity-provider choice), not a hardening patch.
- **Ending commit:** 9466ed2a1d19567c05ac656ed94f6051d0984332, pushed
  (451ed16..9466ed2).

## VEOC-79B: Shared incident context across the operator workspace

Replaced the four unsynchronized per-surface incident dropdowns with one
selected incident for the whole console, and made switching incidents tear the
previous incident's view down.

- **Baseline:** 9466ed2a1d19567c05ac656ed94f6051d0984332 on canonical main.
- **Shared context:** a new IncidentProvider (web/src/app/incident/context.tsx,
  modeled on SessionProvider) owns the one selected incident, defaulting to the
  first open incident, resetting when the jurisdiction changes, and never
  keeping a selection that has left the list. An IncidentSwitcher in the
  command bar replaces the fixed "Operational picture" string and the Forms,
  IAP and AAR surfaces' own dropdowns, which are removed; those surfaces now
  take the selected incident as a prop.
- **COP:** the map receives the selected incident, names it above the common
  operating picture, and folds it into the CopMap remount key.
- **Teardown:** the center surface is keyed by the selected incident id, so a
  switch unmounts the previous incident's subtree; with no ApiClient response
  cache, that discards its records, in-flight reads and polling timers. The
  offline Yjs client is not wired into the console, so there is no separate
  subscription to close.
- **Scope boundary:** boards, feeds, dashboards and resources stay
  jurisdiction-scoped; their records carry no incident association yet, so
  per-incident filtering of those surfaces is a later data-model change, not
  part of this context layer (reuse ledger: extend seams, no new stores).
- **Evidence:** new incident-context tests (default selection, switching);
  a map-surface test asserting the COP remounts on incident change and not
  when it stays; the real-browser end-to-end console test passes with the
  header switcher present (its board picker retargeted to an explicit label,
  and the incidents-list assertion scoped to main so it does not match the
  hidden switcher option).
- **Gate:** pnpm check --maxWorkers=2 exited 0; 456 tests in 79 files passed.
  Log: deploy/test-runtime/out/veoc-79b-check-final.log.
- **Ending commit:** this receipt commit, recorded by the next receipt.
