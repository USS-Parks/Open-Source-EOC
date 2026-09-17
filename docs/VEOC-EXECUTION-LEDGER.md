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
