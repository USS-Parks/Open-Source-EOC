# Master PSPR - Open-Source-EOC parity and design, one roster for Astra 6

Written 2026-09-21. One execution plan for two rosters: the remaining parity
roster (orders 8 to 25 of the amended table in
`docs/VEOC-PARITY-CONTINUATION-2026-09-20.md`) and the design roster (D00 to
D35 of `docs/VEOC-DESIGN-PSPR-2026-09-20.md`). Astra 6 follows this file and
delegates from it. Those two documents keep the binding wording of their
prompts; this file owns order, ownership, delegation and landing. It absorbs
the standalone Astra 6 PSPR of the same date. Plain status, no marketing, no
em-dashes.

**Approval state: A0 approved for full STS execution, 2026-09-21.** Basho's
in-session instruction approves this Master PSPR, including D00 to D35 as
scheduled here, the Phase 1 start and the INV-8 refinement. The requested
outcome is a functional desktop application. Separate commit, push, external
action and design-review gates remain as recorded in this plan; A0 does not
silently grant them. The prior draft approval state is superseded by this receipt.

**Execution-session addendum, 2026-09-21.** After reviewing the staged W0.0
approval request, Basho said "I approve. Go. DO not stop." This approves W0.0
and standing commits and fast-forward landings for subsequent units that pass
their prescribed gates. It supersedes per-commit A3 asks and permits A4 lane
commits for this roster. A5 push, A6 external actions and G-A design review
remain separate. The register below preserves the original approval model.

**Held-request approval receipt, 2026-09-21.** Basho subsequently gave full,
explicit authorization for all requests held in this working session. This
clears the three concrete pending requests: G-A's recommended design defaults;
the exact dashboard SELECT policy and tests in VEOC-80-POLICY-APPROVAL.md;
and read-only NAPSG catalog/selected-symbol/license acquisition from the named
official sources. G-A is approved. The implementation gates still apply.

**Overture acquisition approval, 2026-09-21.** Basho subsequently instructed
"Install Overture and necessary data." This authorizes the required local
Overture/DuckDB tooling and official California building data for Handoff 14,
with source, license, release, coverage and storage receipts. Other source
acquisitions remain separately scoped.

**Standing grant, 2026-09-21.** Basho, in the planning session: "I grant
branches and worktrees, as long as they are cogently 'zippered' into main in
timely and orderly fashion," and then: "I want Astra and the project to have
the granted ability to fan out and zipper worktrees and branches in a cogent
fashion throughout." The grant is standing, for Astra and for the project, for
the whole plan and after it. It is recorded in `CLAUDE.md` (Branch & Worktree
Authority, standing grant), so it binds every session without being restated.
Its one condition is the zipper of section 7.5. It does not cover commits,
pushes or outbound data.

## 0. Read this first

- **One roster, because the two plans edit the same files.** The web app styles
  components inline (about 300 `style={{` sites across surfaces, map, boards and
  dashboards, against a handful of class names), and 38 files import the design
  kit in `web/src/design/`. Redesigning a surface means editing the component
  files a parity prompt also edits. Two separately sequenced rosters over the
  same files is how concurrent agents make a mess of `main`. So: one roster,
  one integrator, one landing queue.
- **Build once.** The Design PSPR already says parity prompts own the engines,
  design prompts own the presentation, and a shared deliverable gets one
  implementation and one evidence record. This plan applies that literally
  (section 7.2): engine units first, the design foundation beside them, then
  each surface built once, to the design, by a presentation unit that closes
  both the parity gate and the design prompt.
- **Astra 6 is the orchestrator and the integrator.** Astra is the only actor
  that talks to Basho, touches the git index, controls the test cluster, edits
  shared documents and lands work on `main`. Sub-agents do one bounded unit from
  a written brief and hand back a report.
- **The zipper (section 7.5).** Lanes work in their own worktrees. `main` moves
  only by fast-forward to an exact approved commit, one landing at a time, by
  Astra alone. No two units in flight own the same file. Hooks and CI refuse
  merge commits, so the rule does not depend on anyone remembering it.
- **Four phases after enablement (section 8).** Phase 1: engines and the design
  foundation, in parallel. Phase 2: presentation, one lane per surface group.
  Phase 3: continuity and delivery. Phase 4: acceptance and disposition.
- **Two of Basho's decisions sit on the critical path:** A0, and the review of
  the Milestone A design package (gate G-A in section 8.7), which every
  presentation unit waits for. Commit approvals set the pace of everything
  else.
- **Basho directed that Astra 6 begin at VEOC-80.** It opens Phase 1 beside
  79G and D00. Starting at order 14 departs from numeric roster order, so the
  A0 ask states it and Basho confirms or corrects it.
- **First actions.** (1) Read `CLAUDE.md`, `~/.claude/CANON.md`, sections 1 to 3
  of the canonical PSPR (`docs/VIRTUAL-EOC-PSPR-2026-09-17.md`), the amended
  roster table, the Design PSPR and this file. (2) Verify the state in section
  3. (3) Present this plan and wait for A0. (4) Put the pre-flight decisions of
  section 13.1 to Basho in one message. (5) Run Phase 0, then open lanes by the
  ramp in section 7.4.

## 1. Goal, scope, non-goals, completion

**Goal.** Execute the remaining parity roster and the design roster as one body
of work, to their stated acceptance, in less wall-clock time than a serial
agent, touching each surface once, without weakening any gate, any
authorization rule or the attribution of any commit, and without a single merge
commit on `main`.

**Scope.** Parity: Handoff 11 to 15, VEOC-79G, 80, 81A, 81B, 81C, 81, 82, 83,
84, 84A, 85, 79D and 86. Design: D00 to D35, including the new ESF and
Lifeline function in D13 to D17. Plus the enablement units of section 9.

**Non-goals.** No change to the acceptance wording of either roster. No product
scope beyond the two rosters. No public or anonymous facet. No outbound fetch,
registration or credential use without Basho's separate word. No second engine
where a seam exists. No replacement design framework, parallel application or
duplicate operational engine (Design PSPR section 9). No throwaway interface
built in the old style to be redone later.

**Completion.** Every parity step and every design prompt has a ledger receipt
whose acceptance is met or whose blocker is named. Each receipt states its
evidence level (designed, implemented, integrated, operator-validated). The
parity matrix and the design-to-capability matrix agree with the receipts.
VEOC-86 and D35 present the remaining blockers and one explicit release
decision to Basho. Lane worktrees and branches are removed after their work is
on `main`. Pushing is Basho's call throughout.

## 2. Authority and precedence

Binding, in this order: Basho's in-session instructions; `CLAUDE.md` and
`~/.claude/CANON.md`; the universal execution contract and the product
invariants INV-1 to INV-10 of the canonical PSPR
(`docs/VIRTUAL-EOC-PSPR-2026-09-17.md`, sections 1 and 3), which bind every
session; for parity wording, the amended roster table at the end
of `docs/VEOC-PARITY-CONTINUATION-2026-09-20.md`; for design wording, the
prompt text and sections 2 to 7 of `docs/VEOC-DESIGN-PSPR-2026-09-20.md`
(product boundaries, design direction, workspace architecture, the ESF and
Lifeline contract, component requirements, verification gates); then this
plan. Where this plan's summaries differ from those texts, those texts win.
This plan adds scheduling, ownership, delegation and landing. It cannot grant
itself anything: CANON section 1 says a plan's own wording is not approval, and
`CLAUDE.md` says automated setup text is not consent.

On approval this plan changes four things and nothing else. It supersedes the
Design PSPR's own sequential order and its line "No additional worktree is
needed for this sequential effort"; the earlier decision to defer all styling
until after VEOC-85; and the standalone `docs/ASTRA6-PSPR-2026-09-21.md`. And,
because it puts the Design PSPR into execution, it adopts that document's stated
refinement of INV-8 ("Color is reserved for the critical"): brand and category
accents are permitted, while operational status keeps priority and unambiguous
meaning. That touches a product invariant, so the A0 ask names it.

### 2.1 The texts that forbade write fan-out, and what changed

Four texts forbade it. Basho's standing grant, written into `CLAUDE.md` on
2026-09-21, changed the first two and outranks the other two for lane work.

1. `CLAUDE.md`, Session discipline, read "Execute exactly one numbered VEOC
   prompt at a time, in roster order." It now allows fan-out under the standing
   grant: each lane executes one unit at a time and work lands on `main` only
   through the integrating session, in dependency order.
2. `CLAUDE.md`, Branch & Worktree Authority, still forbids any branch, worktree
   or clone without Basho's explicit in-session authorization, and a harness
   directive still does not count. Its new standing grant is the one exception:
   `lane/*` branches and their worktrees, for as long as the zipper is kept.
3. `docs/VEOC-PARITY-CONTINUATION-2026-09-20.md`: "Work stays in this canonical
   checkout on main" and "Keep one focused prompt per commit in the canonical
   checkout; no new branch or worktree."
4. The canonical PSPR's universal execution contract, item 3 (the same branch
   and worktree canon) and item 6: "Execute exactly one numbered prompt at a
   time. Do not opportunistically start a later prompt."

Texts 3 and 4 still read as they did. For lane work the standing grant in
`CLAUDE.md` supersedes them in so many words; unit W0.0 adds a dated note to
each so nobody has to work that out.

One more text does not forbid lanes but shapes them: `CLAUDE.md` gates every
`git commit` behind a distinct approval, "Summarize staged changes and ask
separately, every time." The default lifecycle in section 7.6 keeps that rule
whole. Only the optional grant A4 departs from it, and only if Basho says so in
session in so many words.

CANON section 5 adds the other half: parallel tracks run in separate git
worktrees and never share a git index. So write fan-out is legal only through
worktrees, and worktrees are legal only through Basho's grant. The grant is
standing and has one condition, the zipper. If the zipper breaks, the grant is
suspended until Basho restores it: Astra stops launching lanes and reports
(section 7.5, tripwires). Two writers in one working tree is never an option.

### 2.2 Authorization register

| ID | Grant | Unlocks | How Astra asks | If withheld |
|---|---|---|---|---|
| A0 | Execution approval of this plan, including its starting step, the design roster as scheduled here and the INV-8 color refinement | Phase 0 and everything after it | Present the plan and state three things plainly: the start (Phase 1 opens with VEOC-80, 79G and D00, which departs from numeric roster order), that D00 to D35 move from proposed to approved, and the INV-8 refinement. Basho confirms or corrects each | Nothing runs |
| A1 | More than one prompt in flight, landing in dependency order. **Standing: part of Basho's 2026-09-21 grant, recorded in `CLAUDE.md` (Session discipline)** | Lanes working on different prompts at once | Never asked again | Suspended with A2 |
| A2 | Fan-out and zipper: `lane/*` branches and their worktrees, created and removed by Astra. **Standing: granted by Basho on 2026-09-21 for Astra and the project, throughout, conditional on the zipper; recorded in `CLAUDE.md` (Branch & Worktree Authority)** | The lanes, for this plan and any later approved plan | Never asked again, per wave or per session. Astra runs the lane commands of section 9 (W0.4) under the grant and lists what it created or removed in its next batch ask. Any branch, worktree or clone outside `lane/*` still needs an explicit in-session ask | Suspended if the zipper breaks (section 7.5, tripwires); single writer until Basho restores it |
| A3 | Commit approval, per commit | Each commit that reaches `main`, including docs commits | One integration batch table (section 11.3) showing the staged summary of each row, answered row by row | The unit stays uncommitted and its lane holds |
| A4 | Optional standing grant for lane-local commits. A departure from "ask separately, every time" that only Basho's explicit words create | Astra commits reviewed units on `lane/*` branches without a per-commit ask; A3 then happens at landing, by exact SHA | Once, in the pre-flight message. It stacks unlanded commits and so weakens the zipper's timeliness; start without it | Default: A3 precedes commit creation |
| A5 | Push | `git push origin main` | Never asked for. Astra reports the unpushed range at milestone gates; Basho decides | Commits stay local |
| A6 | Outbound data or any external action, per named source | One named fetch, registration, download or credential use | Pre-flight list in section 13.1 | Deliver the pipeline, record the named gap |

Either way Basho approves every commit that reaches `main`, once. Lane
branches are local, never pushed and removed after landing.

### 2.3 Where the grant is written down, and what W0.0 still adds

**Already in `CLAUDE.md`** (written 2026-09-21 on Basho's instruction,
uncommitted until he approves the commit): the subsection "Standing grant:
fan-out lanes and the zipper" under Branch & Worktree Authority, and the
amended first bullet of Session discipline. They state the scope (`lane/*`
branches and their worktrees, outside the canonical checkout, never pushed,
removed after landing), the zipper as the condition, the suspension rule, and
that commit and push stay gated as before.

**Still to add, as unit W0.0, once this plan has A0.** `CLAUDE.md`, Authority
documents, one added bullet:

> `docs/MASTER-PSPR-2026-09-21.md` is the execution plan for the remaining
> parity roster and the design roster: order, ownership, delegation and
> landing. The continuation roster table and the Design PSPR keep the binding
> acceptance wording.

`docs/VEOC-PARITY-CONTINUATION-2026-09-20.md`, dated note at the end:

> Parallel execution note, 2026-09-21: Basho approved
> `docs/MASTER-PSPR-2026-09-21.md`. For the lanes it defines, it supersedes "no
> new branch or worktree". Acceptance gates and dependency order are unchanged.

`docs/VIRTUAL-EOC-PSPR-2026-09-17.md`, dated note under section 1:

> Note, 2026-09-21: under the approved Master PSPR
> (`docs/MASTER-PSPR-2026-09-21.md`), item 6 applies per lane: each lane
> executes one unit at a time and work lands on `main` in dependency order
> through one integrator. Items 3 and 4 are unchanged; Basho's standing grant
> for `lane/*` worktrees is recorded in `CLAUDE.md`. INV-8 is read with the
> refinement in Design PSPR section 3.

`docs/VEOC-DESIGN-PSPR-2026-09-20.md`, status line at the top:

> Execution order, ownership and landing are governed by
> `docs/MASTER-PSPR-2026-09-21.md`. This document remains the design
> specification and the binding wording of D00 to D35.

`docs/ASTRA6-PSPR-2026-09-21.md` returns to its committed text and gains one
line at the top: superseded by the Master PSPR.

## 3. Repository state (verified 2026-09-21)

- **Branch `main`; HEAD == origin/main == `b142c81`** when this plan was
  written. Re-check with `git rev-parse HEAD` and `git rev-parse origin/main`.
- **One worktree** (the canonical checkout). `core.hooksPath` is `.githooks`
  and the only hook is `.githooks/commit-msg`.
- **Modified, uncommitted:** `CLAUDE.md` (the standing grant and the amended
  session-discipline bullet, section 2.3); `docs/ASTRA6-PSPR-2026-09-21.md`,
  which holds the standalone rewrite that this plan absorbs (see W0.0); and
  this file, which is new.
- **Untracked, never stage:** `.claude/`, `.vitest/`,
  `PARITY-AUDIT-2026-09-20.md`, `Reference Screenshots/` (Basho's canonical
  style comps), `SESSION-HANDOFF-2026-09-20.md` and `docs/design-previews/`
  (concept images and their generation prompts from a parallel Basho planning
  session, see section 13.2).
- **Migrations** run `0001` to `0039` with no gap. The next free number is
  `0040`.
- **Matrix drift.** `docs/VEOC-PARITY-MATRIX.md` still describes G-INCSCOPE,
  G-INGEST, G-PARCELS, F6, F18 and R3 as they stood before 79B1, while the
  ledger records 79B closed, 79C1 and 79C2 delivered and Handoff 10 delivered.
  W0.2 reconciles them.
- **Done before this plan:** VEOC-79C2 (`0401fcb`, `5039b27`, `aeaa375`), the
  test-database teardown (`c32ea9f`), VEOC-79F (`f96f235`, `f34cd69`,
  `977c6a0`) and Handoff 10 (`cadc94b`). VEOC-80 starts from `16ce911`, whose
  migration `0036_authorized_guest_access.sql` already removed the `0028`
  lockdown, so `has_guest_scope` is back to its `0002` form.
- **Design starting point.** `web/src/design/` holds `tokens.ts` (themes,
  spacing, radii, type scale, shadows, CSS variables, contrast helpers),
  `components.tsx` (`Theme`, `StatusBadge`, `Button`, `TextField`,
  `EnumSelect`, `Panel`), `layout.tsx` (`AppFrame`, `BoardList`, `BoardTable`,
  `MapPanel`, `NotificationTray`), `gallery.tsx`, `base.css` and three
  accessibility tests. The shell is `web/src/app/layout/AppShell.tsx` (138
  lines), `web/src/app/screens/Console.tsx` (328) and `web/src/app/router.tsx`
  (155). The two browser tests are `server/src/__tests__/app-e2e.test.ts` (641
  lines) and `cop-e2e.test.ts` (191).

## 4. Environment and gates

The test cluster is the approved project-local PostgreSQL 16 and PostGIS in
`deploy/test-runtime/out/` (see `deploy/test-runtime/README.md`). It listens on
127.0.0.1:55439 with bootstrap database `openeoc_test`. It was running and
de-bloated at the 2026-09-21 handoff. `pg_ctl status` reads a pid file and is
safe at any time; connection attempts during recovery are not (section 5).

**Only Astra starts, stops or inspects the cluster.** Base environment, in
PowerShell from the canonical checkout:

```powershell
$testRoot = (Resolve-Path deploy/test-runtime/out).Path
& "$testRoot/pgsql/bin/pg_ctl.exe" -D "$testRoot/data" status
& "$testRoot/pgsql/bin/pg_ctl.exe" -D "$testRoot/data" -l "$testRoot/postgres.log" -o '-h 127.0.0.1 -p 55439' -w start 2>&1 | Out-Null
$pass = [IO.File]::ReadAllText("$testRoot/test-password.txt").Trim()
$env:OPENEOC_DATABASE_URL = 'postgres://postgres:' + [Uri]::EscapeDataString($pass) + '@127.0.0.1:55439/openeoc_test'
$env:OPENEOC_CHROMIUM = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:OPENEOC_TEST_BUILD_ROOT = "$testRoot/browser"
$env:OPENEOC_SHOT_DIR = "$testRoot/browser-shots"
$env:OPENEOC_DATA_DIR = "$testRoot/blobs"
```

Run the `start` line only when `status` reports no server. **Lane
environment** (after W0.1). Every value that a concurrent run could clobber is
per lane, and all of it stays inside the ignored test runtime:

```powershell
$lane = 'a'   # a | b | c | d ; Astra uses 'main' ; the milestone gate uses 'gate'
$testRoot = 'C:/Users/17076/Documents/Open Source EOC/deploy/test-runtime/out'
$pass = [IO.File]::ReadAllText("$testRoot/test-password.txt").Trim()
$env:OPENEOC_DATABASE_URL = 'postgres://postgres:' + [Uri]::EscapeDataString($pass) + '@127.0.0.1:55439/openeoc_test'
$env:OPENEOC_TEST_DB_TAG = $lane
$env:OPENEOC_CHROMIUM = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:OPENEOC_TEST_BUILD_ROOT = "$testRoot/lanes/$lane/browser"
$env:OPENEOC_SHOT_DIR = "$testRoot/lanes/$lane/browser-shots"
$env:OPENEOC_DATA_DIR = "$testRoot/lanes/$lane/blobs"
```

**Gate tiers.** Basho endorsed proportionate gates after objecting to
full-suite runs on every small commit.

| Tier | Who, where, when | What |
|---|---|---|
| Focused gate | The unit's writer, in its own tree, once per unit | `pnpm -r exec tsc --noEmit`, `pnpm exec eslint .`, `pnpm exec vitest run <the affected test files>` |
| Presentation gate | Added to the focused gate for every presentation and kit unit | The changed operator path exercised once with representative data; both themes compared with the approved compositions (hierarchy, density, color meaning, icons, usable space; not pixel matching); keyboard operation, visible focus, accessible names and contrast toward WCAG 2.2 AA; unknown, stale, unavailable, not applicable and zero shown as different things; light and dark screenshots attached to the report. Authority, persistence and isolation claims use the real application and database, never a mockup |
| Integration check | Astra, in the lane worktree, after a rebase that replayed the unit over code changes, before landing | The focused gate again on the rebased tree, plus the focused tests of any module the replayed-over commits also changed. A rebase over commits that touch only `docs/**` or top-level `*.md` needs none |
| Milestone gate | Astra, on `main`, at the points in section 8.7, with tag `gate` | `pnpm check --maxWorkers=2` (tsc, eslint, license-scan, check-links, vitest) |
| Docs-only unit | Its writer | `node scripts/check-links.mjs` and a diff review; no application tests |

Use `pnpm exec`, not `npx`: in a tree whose install is missing or incomplete,
`npx` can fetch the tool from the registry, which is an ungated outbound call;
`pnpm exec` fails instead. A fast-forward makes `main` the exact tree that was
just gated, so nothing is re-run on `main` after landing. The milestone gate is
also the one required pre-push gate. Repeat a gate only after a concrete
failure, a correction or a changed dependency.

**One vitest run per tag at a time.** Lanes use their lane letter, Astra uses
`main` in whatever tree it runs, and the milestone gate uses `gate` so it can
overlap Astra's other runs.

**Evidence rule (Design PSPR section 7).** Every receipt says which level it
reached: designed, implemented, integrated or operator-validated. Missing
vendor access or pilot evidence stays explicit.

Caveats:
- The RTK proxy mangles vitest stdout ("All parsing tiers failed") and some
  grep invocations. Tee vitest output to a log under the test runtime and read
  the `Test Files` and `Tests` summary lines, or use `| Select-Object -Last N`.
- The Windows worker crash `3221226505` (0xC0000409) at worker startup on a
  random file is environmental. Re-run once; it is not a code failure.

## 5. Hazards

### 5.1 Inherited from the previous session

- **Never kill or restart the shared test cluster mid-run.** That triggers
  crash recovery, whose full-directory fsync is slow and, on this host under
  load, dies with `0xC0000142` and loops. If the cluster comes up slowly, let
  recovery finish and watch `postgres.log` only. A backend that connects during
  recovery and fails DLL init makes the postmaster panic and abort recovery. A
  quiet single start recovers cleanly.
- **Keep the test-database teardown.** Do not remove
  `server/src/__tests__/globalSetup.ts` or its wiring in `vitest.config.mjs`.
  If the cluster bloats again, drop leaked databases with psql `\gexec` over
  `select 'drop database if exists '||datname||' with (force)' from
  pg_database where datname ~ '^t_([a-z0-9]{1,12}_)?[0-9a-z]{10}$'`.
  This manual recovery is permitted only after every test run has stopped;
  automatic teardown remains strictly scoped to the current run tag.
- **Write protocol (`CLAUDE.md`).** Edit existing files with small atomic
  patches. Never `sed -i`, `perl -i` or shell redirects onto repository files.
  New files over 40 lines go to the scratchpad first, are verified with
  `wc -l` and `tail -5`, then copied in and re-verified. PowerShell
  `Remove-Item` and `Set-Content` can trip a path guard; prefer
  `Tee-Object -FilePath`, which overwrites.
- **Staging.** Stage files one by one by path, never `git add .` or `-A`, and
  inspect `git diff --cached --stat` before proposing a commit.

### 5.2 New with fan-out and the combined roster (each verified against the tree)

- **HZ1. The teardown drops every run's databases.** `globalSetup.ts` drops
  every database matching `^t_[0-9a-z]{10}$` in the whole cluster `with
  (force)`. The first vitest run to finish destroys the live databases of any
  other run on the same cluster. Until W0.1 lands, at most one database-backed
  vitest run exists at a time across all agents.
- **HZ2. Browser builds share one directory.** `app-e2e.test.ts` and
  `cop-e2e.test.ts` run `vite build --emptyOutDir` into
  `OPENEOC_TEST_BUILD_ROOT`. Two runs with the same value erase each other's
  build. The lane environment gives each lane its own.
- **HZ3. A nested worktree gets swept.** `eslint.config.mjs` ignores only
  `dist`, `node_modules`, `field-node` and the test runtime, and
  `vitest.config.mjs` sets no exclude. A worktree inside the canonical tree
  would be linted, and its tests discovered and run, from the canonical
  checkout. Worktrees live outside the canonical tree. If the harness offers an
  isolated-worktree option, find out where it puts the worktree before using
  it; creating one that way is still a `git worktree add`.
- **HZ4. Cluster control.** Lane agents never run `pg_ctl`, never create or drop
  databases by hand and never probe the cluster outside the test harness. A
  lane that cannot connect stops and reports.
- **HZ5. Hot files.** `web/src/cop/CopMap.tsx` (1094 lines) is touched by four
  handoffs and D11; `server/src/app.ts`, `web/src/app/api/client.ts` and
  `shared/src/index.ts` gain a line for almost every new module. Section 8.5
  assigns owners.
- **HZ6. Migrations.** Two lanes that both take `0040` collide, and two lanes
  that both `create or replace` the same function or re-create the same policy
  silently override each other in number order. Section 8.6 reserves blocks and
  sets the rule.
- **HZ7. Shared documents.** Every unit appends to the tail of the ledger and
  edits matrix rows. Those files belong to Astra alone (section 7.6, step 8).
- **HZ8. Ignored local assets are absent from a new worktree:**
  `web/public/basemap/*.pmtiles`, `overlays-manifest.json`,
  `deploy/basemap/out/` and `data/blobs/`. A proof that needs the real tile
  archives runs in the canonical checkout, by Astra.
- **HZ9. Duplicate primitives.** Parallel lanes each invent the helper they
  need. Single owners: spatial predicates (79G; Handoff 12, 81 and D13 reuse);
  assignment, due and escalation rules (81B; 82, 83, D15, D16 and D22 reuse);
  the CopMap viewport callback (a Handoff 12 unit); saved per-user state, one
  seam for workspace preferences, saved layouts, saved table views and saved
  dashboards (unit `SEAM`; 81C, D07, D10, D12 and D18 reuse); tables (D07; 81A
  list layouts and every board or list surface reuse); forms, drawers and
  dialogs (D08); the asset and license inventory (started by Handoff 13,
  extended by D05 and D30).
- **HZ10. Sub-agents inherit nothing.** A brief is self-contained (section
  11.1) or the agent will guess.
- **HZ11. Dependencies.** A lane that wants a new package stops and reports. New
  packages touch the lockfile and the license scan, and fetching them is
  outbound traffic (A6). Design assets must work with no external font, icon
  or styling service (Design PSPR section 2).
- **HZ12. A sub-agent's shell starts in the canonical checkout.** The harness
  resets the working directory on every call and keeps no variables between
  calls. One command without `Set-Location <WORKTREE>` runs the gate against
  `main`'s tree (a false green) or writes into the canonical tree, which is the
  two-writers case CANON section 5 forbids. Every lane command sets location,
  environment and the command in one invocation, file tools take absolute paths
  under the worktree, and gate evidence includes the output of
  `git rev-parse --show-toplevel`. The lane parent directory may also sit
  outside the session's allowed directories; adding it is a permission change
  that only Basho makes.
- **HZ13. `.vitest/` appears wherever vitest runs.** It is untracked and not
  ignored, so it shows in every lane's `git status`. Never stage it; it is
  handled at worktree removal (section 9, W0.4).
- **HZ14. The kit is imported by 38 files.** Renaming or removing a kit export
  or a token touches all of them at once and collides with every lane. The kit
  grows by expand, then contract: D04 to D08 add tokens and components and
  keep every existing export working; a presentation unit moves its own
  surface to the new ones; the old exports are removed in one solo unit at the
  end of Phase 2 (`KIT-CONTRACT`), when nothing imports them.
- **HZ15. One browser test covers many surfaces.** `app-e2e.test.ts` proves the
  shell, the boards dock and the dashboard in one 641-line file. It belongs to
  `P-SHELL`, and `cop-e2e.test.ts` to `P-COP`. Every other presentation unit
  adds its own browser test file instead of editing those two.
- **HZ16. The design review is on the critical path.** No presentation unit
  starts before gate G-A. While it is open, lanes pull engine work forward.
  Nobody builds an interface in the old style to fill the time; that is the
  double work this plan exists to avoid.
- **HZ17. Reference images are Basho's local inputs.** `Reference Screenshots/`
  and `docs/design-previews/` are never staged. A composition that must live
  in the repository is a coded gallery page with mock data labeled as mock.

## 6. Standing rules

- **Commit hygiene.** Plain subject and body saying what changed and why. Every
  message ends with `Copyright Basho Parks - 2026`. No `Co-Authored-By`, AI
  attribution, tool signature, session link or emoji. `.githooks/commit-msg`
  enforces this in every worktree because `core.hooksPath` is shared and
  `.githooks/` is tracked. Never `--no-verify`.
- **One unit of work is one focused commit.** A prompt may be several units.
  Each unit gets a ledger receipt. Red is reported as red and scope boundaries
  are named. A fused unit gets one receipt that cites every prompt it serves.
- **No source slop (CANON section 11).** No build-phase markers, no dangling
  references, no placeholder logic presented as done. `(VEOC-NN)` and
  `(Handoff N)` comments are approved by Basho and match the repo convention.
  Unit names from this plan (`P-DASH`, `SEAM`) never appear in source.
- **The canonical contract still applies to every unit** (canonical PSPR
  section 1). A failing test comes before or with each behavioral change; a
  test that cannot fail on the old behavior is not closure evidence. Fail
  closed at trust boundaries: a caller-supplied jurisdiction, position, role,
  board, incident or peer identity is a request, never authority. Audit and
  activity log tables stay append-only, with no update or delete path even for
  test convenience. Run the license scan before proposing staging whenever
  dependencies changed. Stop on an architectural contradiction, an unexplained
  test regression, a licensing conflict or any need for production
  credentials. A facet is closed only when implementation, negative tests,
  positive tests, operational documents and the demo dataset agree. One item
  of that contract names `.integrity/scripts/verify-tree.sh`, which is not in
  this repository; the rest of the write protocol applies as written.
- **FOUO (memory `eoc-fouo-access-model`).** No public or anonymous facet.
  Members and valid mutual-aid guests read the incident and dashboard without
  restriction; everyone else is denied. Write and approval authority stay
  explicit. Never build a public read path.
- **Gated external data.** Several prompts name outside sources (FEMA NFHL,
  the NAPSG symbol set, Overture, Census ACS, IPAWS). Deliver the reusable
  pipeline and record the missing data as a named gap in the matrix, the way
  79F and Handoff 10 did. Do not fake a live fetch; loading stays on the
  existing push and poll seam.
- **Visual direction (memory `canonical-style-bible`).** Basho's comps in
  `Reference Screenshots/` and Design PSPR section 3 are the settled direction:
  navy navigation rail grouped by operational purpose, teal interaction accent,
  status colors that keep their meaning, card-based working surfaces, FOUO
  marking. D03 and D04 fix exact values. Brand and category accents are
  allowed; operational status keeps priority and unambiguous meaning.
- **Product boundaries that are not design options (Design PSPR section 2).**
  Incident-centered operation; California-wide; explicit participation;
  separate authority; honest data states; persistent attribution; protected
  work in progress; local operation with no external asset services.
- **Stop at done (CANON section 13).** One confirmation per unit. No unrequested
  sweeps, re-audits or follow-up offers.
- **Writing style for documents.** No em-dashes. Plain technical prose.

## 7. Execution model

### 7.1 Roles

| Role | Writes? | Job | Harness mapping (Claude Code) |
|---|---|---|---|
| Astra (orchestrator, integrator) | Yes, on `main` | Briefs, reviews, all git index work, cluster control, shared documents, landing, every exchange with Basho. Implements Phase 0, Handoff 15, integration fixes, 79D and the 86 and D35 consolidation | The top-level session |
| Scout | No | Maps a unit's touch set: seams, call sites, policies, tests to extend. Returns `file:line` findings | Explore agent |
| Planner | No | Turns a card and scout findings into a unit plan with contracts | Plan agent |
| Lane implementer | Yes, only inside its lane worktree | Executes exactly one unit from a brief and returns a unit report. One implementer per lane at a time | General-purpose agent given the lane's absolute path |
| Reviewer | No | Adversarial review of a unit diff before it is proposed to Basho | General-purpose agent with a review brief |
| Auditor | No | Reconciles matrix rows to code and receipts (Handoff 15, D00, D33, VEOC-86, D35) | General-purpose or Explore agent |

Reviewers work in lenses, run in parallel. **Correctness and authorization:**
row-level security, tenant isolation, incident scope, negative tests present,
the unit's slice of the gate actually met. **Doctrine:** CANON section 11
artifacts, dangling references, em-dashes in documents, edits outside owned
files, anything but additive lines in additive hot files. **Design,** for
presentation and kit units only: the approved compositions and tokens, both
themes, the presentation gate of section 4, the component requirements of
Design PSPR section 6.

Read-only agents write nothing into any tree, run no gates and no database
tests, use git only for `log`, `show`, `diff` and `status`, and make no network
calls. Unit plans, scout notes and review findings are working notes returned
to Astra, not committed files.

### 7.2 Build once: engine units and presentation units

Most parity prompts have two halves. The **engine** half is schema, services,
routes, shared types and their real-database tests. It does not depend on how
anything looks. The **presentation** half is what the operator sees, and a
design prompt specifies the same thing. Building the interface for the parity
prompt now and redesigning it later would write every surface twice and put
two rosters on the same files. Instead:

- **Engine units** land first, in roster order of their dependencies, each
  with API-level and real-database evidence for the server-side claims of its
  gate. Its receipt is an increment: the gate stays open and says so.
- **The design foundation** (D00 to D08) runs beside the engines: documents
  first, Basho's review at gate G-A, then tokens, icons, controls, tables and
  forms, all inside `web/src/design/**` and `docs/design/**`.
- **Presentation units** come after the kit and after their engines. Each owns
  one surface group, builds it once to the design, carries the browser proof,
  and closes the parity gate and the design prompt together with one receipt.
- **Whole units.** Where the split would be artificial the prompt stays whole:
  VEOC-80, the map-layer handoffs (11, 13, 14), VEOC-85, 79D and 86.
- **Contract first.** When an engine exposes a contract a later unit builds on
  (79G's spatial queries, 81B's assignment primitive, the saved-state seam),
  the contract lands as its own small unit so dependents can start against it.

An interface fault found while building a presentation unit goes back to the
engine's module as a corrective unit with a linked receipt. It is not patched
around in the surface.

### 7.3 Modes

Lanes are the standing mode, from Phase 1 to the end of the plan: corrective
units in Phase 4 and any later work go through the same lanes and the same
zipper, and the grant outlives this plan for later approved plans. Astra falls
back to a **single writer** only while the grant is suspended (a broken
zipper, section 7.5) or the host cannot carry lanes. Single writer means the
same units in the same dependency order, one at a time in the canonical
checkout, D00 to D03 taken early so gate G-A overlaps engine work, and every
read-only role still fanned out. Nothing else in this plan changes.

### 7.4 Lanes

Four lanes, `a`, `b`, `c` and `d`. A lane is a worker slot, not a theme: units
carry their own file territory (section 8.3), and a freed lane pulls the next
ready unit (section 8.4). Each lane has a worktree outside the canonical tree
(proposed parent `C:/Users/17076/Documents/eoc-lanes/`, short on purpose for
Windows path limits; Basho may name another), a branch `lane/<letter>` cut from
`main`, its own `node_modules` from an offline install, and the lane
environment of section 4. Bring-up is unit W0.4.

**Caps.** At most three lanes running database or browser tests, plus one lane
on documents or the design kit, which runs neither. At most six read-only
agents. One landing at a time. A fourth heavy lane is allowed in Phase 2 only
if Phase 1 ran without the worker crash or queueing on advisory lock 421. Drop
a lane at the first sign of either.

**Ramp.** Phase 1 opens with lanes whose territory nothing else touches: `a`
on `79G-E1`, `b` on `80`, and `d` on `D00`, which only adds new documents. Lane
`c` starts on `H11` once `a` and `b` have each landed one unit cleanly. The
critical path never waits for the ramp.

### 7.5 The zipper: how lanes join `main`

Basho's standing grant has one condition: lanes are "zippered" into `main` in a
timely, orderly and cogent way, throughout. Concurrent agents make a mess of
`main` for a small number of known reasons. Each rule below removes one of
them, and unit W0.3 gives the first rule a mechanical owner so it does not
depend on anyone remembering.

| # | Rule | The mess it prevents |
|---|---|---|
| Z1 | `main` moves only by fast-forward to an exact approved SHA, or by Astra's own small commits (receipts, Phase 0, Handoff 15). No merge commits anywhere, no `git pull` that merges, and `main` is never merged into a lane: lanes rebase | Criss-cross merge graphs and hand-resolved merge commits on `main` |
| Z2 | One integrator, one landing at a time. Sub-agents have read-only git and never touch `main` | Agents racing each other into `main` |
| Z3 | Every unit is cut from current `main`: before a brief goes out, the lane branch is brought to `main`'s tip. Units are small, about a day of agent work; a unit that outgrows its brief is split at its next green point | Long-lived branches that drift until they cannot be reconciled |
| Z4 | No two units in flight own the same file. Astra checks each new brief's owned files against every in-flight brief before launch, and checks the unit's actual `git diff --name-only` and untracked files against its brief before review. Additive hot files are the only shared files, and a unit's diff in them must show zero deleted lines | Overlapping edits, which is where conflicts come from |
| Z5 | A conflict has exactly two outcomes. In an additive hot file: keep both sides, mechanically. Anywhere else: the later unit is reworked by its own lane on the new base. Nobody hand-merges two lanes' logic | Subtly wrong hybrid code from conflict resolution |
| Z6 | Timely. A green, reviewed unit goes into a batch ask at once; approved rows land at once; landing and review come before launching new work. At most one unlanded unit per lane | The pile-up and the big-bang merge at the end |
| Z7 | `main` is never red. Nothing lands unless its tree passed its gate, and a fast-forward makes `main` that exact tree | A broken `main` that every lane then inherits |
| Z8 | Solo units. A rename or move of an existing file, a formatting-only change, a dependency or lockfile change, a change to shared configuration, and the kit contraction of HZ14 each land alone, when no unit in flight touches the affected files. No drive-by refactors or reformatting inside other units | Diffs that touch everything and collide with everyone |
| Z9 | Shared documents (ledger, matrix, roadmap) are written by Astra only, on `main`, between landings | The guaranteed conflict at the ledger tail |

**Tripwires.** If a landing ever needs a non-additive conflict resolved, or a
territory violation reaches review twice, or a lane falls two units behind on
landing, Astra stops launching, drops a lane, and tells Basho what happened and
why. `CLAUDE.md` says a broken zipper suspends the grant until Basho restores
it, so a broken zipper is reported, not worked around.

**What the zipper does not catch.** Two units can each be green and still
interact badly at run time with no textual conflict. The integration check
catches what typecheck, lint and the focused tests see; the milestone gate
catches the rest with the full suite. A defect found there becomes a corrective
unit in the lane that takes the owning files.

### 7.6 Unit lifecycle

1. **Brief.** Astra brings the lane branch to `main`'s tip, runs the Z4 check
   against every brief in flight, and writes the brief from section 11.1 using
   scout and planner output.
2. **Implement.** The lane implementer works only under its worktree path and
   only in its territory, runs the focused gate once (and the presentation gate
   where it applies) with the lane environment, and tees vitest output to
   `$testRoot/lanes/<lane>/logs/`.
3. **Report.** Section 11.2. Red is reported as red. The implementer does not
   stage, commit or rebase.
4. **Review.** Astra runs the Z4 check on the actual diff, reads the whole diff
   itself, then runs the reviewer lenses in parallel. Findings go back to the
   same implementer if the harness can continue it, otherwise into a fix brief.
5. **Stage, ask, commit.** Astra stages the unit by path in the lane worktree,
   inspects `git diff --cached --stat` and puts that summary in the unit's row
   of the next integration batch (section 11.3), so the ask shows what is
   staged, as `CLAUDE.md` requires. On approval Astra commits with the hook
   active. The next unit in that lane does not start until this one is
   committed, so a lane never carries two units' changes in one tree. With A4,
   Astra commits after review without the ask, and the batch ask moves to
   step 7.
6. **Rebase and integration check.** Only at the lane's unit boundary (no
   implementer active, clean tree): `git rebase main` in the lane worktree.
   Conflicts follow Z5. Then the integration check of section 4, if the rebase
   calls for one.
7. **Land by exact SHA.** In the canonical checkout, re-read `git status`
   (section 13.2), then `git merge --ff-only <approved sha>`, never the branch
   name: a lane branch may hold later commits that Basho has not approved. Rows
   of one lane land in lane order, and a hold or a reject on one row holds
   every later row of that lane.
8. **Receipt.** Astra appends the receipts for the batch to
   `docs/VEOC-EXECUTION-LEDGER.md`, updates the matrix rows and commits them on
   `main` as one docs commit per batch. That commit is row D of the same batch
   ask and carries the proposed receipt text; only the unit SHAs are filled in
   after landing.
9. **Refresh.** Every other lane rebases onto the new `main` at its next unit
   boundary, never mid-unit.

Two units ready together land one after the other; the backlog order of section
8.3 breaks the tie.

### 7.7 Failure handling and backpressure

- A red unit is not landed. Astra re-briefs the lane or takes the unit over.
- A unit that touched files outside its territory is rejected; the stray hunks
  come out before review continues.
- A unit that cannot finish without a file it does not own stops and says which
  file and why. Astra transfers the file when it is free or reorders the work.
- A report without evidence is not evidence. The logged gate output is what
  counts, it must show the lane's own `git rev-parse --show-toplevel` (HZ12),
  and Astra re-runs the gate whenever step 6 says so.
- If approvals lag, lanes hold at unit boundaries and read-only look-ahead
  continues. Astra states once what is waiting.
- If gate G-A is open when a lane runs out of engine work, the lane takes a
  later engine unit or a kit-independent document unit. It does not start a
  presentation unit (HZ16).
- A defect found later returns to its owning prompt as a corrective unit with
  a linked receipt.
- **Resume after a session break.** State lives in git and the ledger, not in a
  status file. Run `git worktree list`; for each lane run `git -C <path> status
  --short` and `git log main..lane/<letter> --oneline`; compare with the ledger
  tail. Uncommitted work in a lane is an unreviewed unit: review it as if it
  had just been reported.

## 8. The combined roster

H11 to H15 abbreviate Handoff 11 to Handoff 15; bare numbers are VEOC prompts;
D00 to D35 are design prompts. A suffix `-E` marks an engine unit and a prefix
`P-` a presentation unit. Unit names are scheduling labels for this plan and
the ledger; they never appear in source.

### 8.1 How the two rosters pair

| Capability | Engine units (Phase 1) | Presentation unit (Phase 2) | Closes |
|---|---|---|---|
| Authorized viewing | `80` (whole) | none | VEOC-80 |
| Hazards and flood | `H11` (whole: layers, categories, coverage) | legend and toggles finished in `P-COP` | Handoff 11 |
| Impact analysis | `79G-E1`, `79G-E2` | impact widget inside `P-DASH` | VEOC-79G |
| Map-extent KPIs | `H12-E`, `H12-CB` | KPI strip inside `P-COP` | Handoff 12 |
| Facility symbology | `H13` (whole); `D05` shares its asset and license inventory | legend and inspection in `P-COP` | Handoff 13, D05 |
| Building subtypes | `H14` (whole) | legend and inspection in `P-COP` | Handoff 14 |
| COP workspace | the four above | `P-COP` | D11, then Handoff 15 |
| Board authoring and routing | `81A-E`, `81B-E1`, `81B-E2` | `P-BOARDS-1`, `P-BOARDS-2` | VEOC-81A, 81B, D18, D19 |
| Shell and context | `SEAM` | `P-SHELL`, later `81C-PROOF` | VEOC-81C, D09, D10 |
| Dashboards | `81-E` | `P-DASH` | VEOC-81, D12 |
| Tasks, lists, templates | `82-E` | `P-TASKS` | VEOC-82, D23 |
| AAR and improvement plans | `83-E` | `P-AAR` | VEOC-83, D25 |
| IAP and ICS-204 | `84-E`, `84A-E` | `P-IAP` | VEOC-84, 84A, D24 |
| ESFs and Lifelines (new function) | `D13` | `P-LIFE-1` to `P-LIFE-4` | D13 to D17 |
| Existing surfaces with no open parity prompt | none | `D20`, `D21`, `D22`, `D26`, `D27`, `D28`, `D29` | those prompts |
| Offline continuity | `85-A`, `85-B` | `D31`, then `85-PROOF` | VEOC-85, D31 |
| Exports, guidance | none | `D30`, `D32` | those prompts |
| Acceptance | `79D+D33`, `D34`, `86+D35` | | VEOC-79D, 86, D33 to D35 |

The design foundation (D00 to D08) serves every presentation unit and pairs
with none.

### 8.2 Graph

```
Phase 0   W0.0 -> W0.1 -> W0.2 -> W0.3 -> W0.4                 (Astra, on main)

Phase 1   engines                              design foundation
          80                                   D00 -> D01 -> D02 -> D03 -> [G-A: Basho's review]
          79G-E1 -> 79G-E2 --+                                               |
             +----> H12-E ---+-> 81-E                         D04 -> D06 -> D08
          SEAM --------------+                                 |      +---> D07
          81A-E -> 81B-E1 -> 81B-E2                             +-> D05
                      +----> 82-E, 83-E
          79G-E2 + 81B-E1 -> D13
          H11 -> H12-CB -> H13 -> H14          one owner of web/src/cop at a time
          84-E -> 84A-E

Phase 2   P-SHELL                               needs D02, D04, D05, D06, D08, SEAM
            +-> P-COP -> H15                    needs H11, H12-CB, H12-E, H13, H14
            +-> P-DASH                          needs 81-E, 79G-E2, D07
            +-> P-BOARDS-1 -> P-BOARDS-2        need 81A-E, D07, D08; then 81B-E2
            +-> P-TASKS, P-AAR, P-IAP           need 82-E; 83-E; 84-E and 84A-E
            +-> P-LIFE-1 -> P-LIFE-2, P-LIFE-3 -> P-LIFE-4     need D13; the last needs P-COP, 82-E
            +-> D20, D21, D22, D26, D27, D28, D29              D26 needs P-LIFE-1
          P-COP + P-BOARDS-1 + P-DASH -> 81C-PROOF
          every presentation unit landed -> KIT-CONTRACT       solo unit

Phase 3   85-A (any time after Phase 1)    82-E -> 85-B -> D31
          85-A + 85-B + D31 + Phase 2 -> 85-PROOF
          D30 (needs 83-E, 84A-E, D04, D05)     D32 (needs Phase 2, D31)

Phase 4   79D+D33 -> D34 (needs real operators) -> 86+D35 (Basho decides)
```

The long pole is the design foundation: `D00 -> D01 -> D02 -> D03 -> G-A ->
D04 -> D06 -> D08 -> P-SHELL`, then the longest presentation chain. That is why
`D00` is in the opening set, why one lane stays on the foundation, and why
gate G-A is named in section 0. The engine chain `81A-E -> 81B-E1 -> 81B-E2` is
the other one to watch.

### 8.3 Unit backlog

The tables are in priority order: within a phase, a unit listed earlier wins a
tie. "Owns" is the unit's file territory for the Z4 check; the brief may narrow
it. Sizes are planning estimates for balancing only (S under a day of agent
work, M about a day, L two to three, XL more and therefore split).

**Phase 1: engines and design foundation**

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `79G-E1` | 79G contract: shared types and the spatial-query module, real-database test | none | new `server/src/impact/**`, `shared/src/impact/**` | M |
| `80` | VEOC-80, whole | none | `server/src/auth/**`, `server/src/security/**`, `server/src/incidents/**`, `server/src/data-packs/**`, `web/src/app/auth/**`, `web/src/app/incident/**`, a new browser test file | S |
| `D00` | Design baseline and ownership map | none | its own new files under `docs/design/` | M |
| `H11` | Handoff 11, whole | none | `web/src/cop/**`, `web/src/app/surfaces/MapSurface.tsx`, `shared/src/dictionary/symbology.ts`, `shared/src/data-packs/catalog.ts` | M |
| `79G-E2` | 79G impact service, routes, drill-down, deltas between area revisions | `79G-E1` | `server/src/impact/**`, `shared/src/impact/**` | L |
| `81A-E` | 81A schema additions, shared and server validation, version upgrade preserving records and customizations | none | `shared/src/boards/**`, `server/src/boards/**` | L |
| `D01` | Operator journeys and workflow benchmarks, measured on the current interface | `D00` | its own files under `docs/design/` | M |
| `D02` | Navigation and information architecture | `D01` | its own files under `docs/design/` | M |
| `D03` | Representative compositions, light and dark, wide and narrow | `D02` | its own files under `docs/design/`, `web/src/design/gallery.tsx` | M |
| `G-A` | Basho reviews the Milestone A package | `D03` | none | Basho |
| `H12-CB` | Handoff 12: `CopMap` reports its bounds on `moveend` | `H11` | `web/src/cop/**` | S |
| `H12-E` | Handoff 12: viewport bounding-box parameter on the impact and dashboard queries | `79G-E1` | `server/src/impact/**`, `server/src/dashboards/**` | S |
| `81B-E1` | 81B contract: declarative transition, assignment, approval and due-rule schema; the assignment primitive | `81A-E` | `shared/src/boards/**`, `server/src/boards/**` | L |
| `H13` | Handoff 13, whole; starts `docs/ASSET-LICENSES.md` | `H12-CB` | `web/src/cop/**`, `shared/src/dictionary/symbology.ts`, `deploy/basemap/**`, `docs/ASSET-LICENSES.md` | M |
| `SEAM` | One saved-state mechanism for workspace preferences, saved layouts, saved table views and saved dashboards, scoped to user and incident | none | a new saved-state module in `server/src/` and `shared/src/` | M |
| `81B-E2` | 81B engine: routing, approvals, escalation, idempotent retries, immutable history, notifications | `81B-E1` | `server/src/boards/**`, `server/src/notify/**`, `server/src/resource/**` | L |
| `81-E` | VEOC-81 engine: saved composable dashboards, category, date and period filters, drill-down queries | `79G-E2`, `H12-E`, `SEAM` | `server/src/dashboards/**`, `shared/src/dashboards/**` | M |
| `H14` | Handoff 14, whole | `H13` | `web/src/cop/**`, `web/src/app/config.ts`, `deploy/basemap/**` | M |
| `D04` | Semantic tokens and branding | `G-A` | `web/src/design/tokens.ts`, `base.css`, the design tests | M |
| `D06` | Cards, badges and shared controls | `D04` | new files under `web/src/design/` | L |
| `D05` | Icon system | `D04` | new `web/src/design/icons/**`, `docs/ASSET-LICENSES.md` | M |
| `D08` | Forms, drawers and dialogs | `D06` | new files under `web/src/design/` | L |
| `D07` | Operational table system | `D06` | new files under `web/src/design/` | L |
| `D13` | ESF and Lifeline assessment contract: the engine for D14 to D17 | `79G-E2`, `81B-E1` | new lifeline and ESF modules in `server/src/` and `shared/src/`, `shared/src/dictionary/lifelines.ts`, `shared/src/dictionary/esf.ts` | L |
| `82-E` | VEOC-82 engine: assignment, due, status, category, analytics, offline reconciliation | `81B-E1` | the checklist code in `server/src/incidents/**`, `web/src/offline/**`, `server/src/sync/**` | M |
| `83-E` | VEOC-83 engine: analytics, action owners, due dates, PDF fields | `81B-E1` | `server/src/aar/**`, `shared/src/aar/**` | M |
| `84-E` | VEOC-84 engine: working and published views, organization, period and role filters, progress | none | `server/src/iap/**` | M |
| `84A-E` | VEOC-84A engine: ICS-204 authoring and revision, freeze, faithful export | `84-E` | `server/src/iap/**`, `shared/src/ics/**` | L |

**Phase 2: presentation, each surface once**

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `P-SHELL` | 81C structure with D09 and D10: command bar, navigation rail, page header, context drawer, notification access, Map, Boards and Planning arrangements, persistent context and preferences | `G-A`, `D02`, `D04`, `D05`, `D06`, `D08`, `SEAM` | `web/src/app/layout/**`, `web/src/app/screens/**`, `web/src/app/router.tsx`, `web/src/app/App.tsx`, `web/src/app/surfaces/lists.tsx`, `web/src/design/layout.tsx`, `server/src/__tests__/app-e2e.test.ts` | XL, two units: frame, then context |
| `P-COP` | D11 with the Handoff 12 KPI strip and the legends and inspection of Handoffs 11, 13 and 14 | `P-SHELL`, `H11`, `H12-CB`, `H12-E`, `H13`, `H14` | `web/src/cop/**`, `web/src/app/surfaces/MapSurface.tsx`, `server/src/__tests__/cop-e2e.test.ts` | XL, two units: workspace, then KPI strip |
| `P-DASH` | VEOC-81 presentation with D12 and the 79G impact widget | `P-SHELL`, `81-E`, `79G-E2`, `D07` | `web/src/dashboards/**`, `web/src/app/surfaces/DashboardSurface.tsx` | L |
| `P-BOARDS-1` | D18 with the 81A runtime layouts: board browsing, list and detail layouts, record operations | `P-SHELL`, `81A-E`, `D07`, `D08` | `web/src/boards/BoardView.tsx`, `web/src/boards/RecordForm.tsx`, `web/src/app/surfaces/BoardSurface.tsx` | L |
| `P-LIFE-1` | D14 lifelines overview | `P-SHELL`, `D13` | a new lifelines surface | M |
| `P-BOARDS-2` | D19 with the 81A designer and the 81B workflow configuration | `P-BOARDS-1`, `81B-E2` | `web/src/boards/Designer.tsx` and new files beside it | L |
| `P-LIFE-2` | D15 lifeline detail and assessment workflow | `P-LIFE-1`, `81B-E2` | the lifelines surface | L |
| `P-LIFE-3` | D16 ESF coordination workspace | `P-LIFE-1`, `81B-E2` | a new ESF surface | L |
| `P-TASKS` | VEOC-82 presentation with D23 | `P-SHELL`, `82-E`, `D07` | a new tasks surface | L |
| `P-IAP` | VEOC-84 and 84A presentation with D24 | `P-SHELL`, `84-E`, `84A-E` | `web/src/app/surfaces/IapSurface.tsx`, `FormsSurface.tsx` | L |
| `P-AAR` | VEOC-83 presentation with D25 | `P-SHELL`, `83-E`, `D07` | `web/src/app/surfaces/AarSurface.tsx` | M |
| `P-LIFE-4` | D17 links among ESFs, lifelines, map features and actions | `P-LIFE-2`, `P-LIFE-3`, `P-COP`, `82-E` | the lifelines and ESF surfaces | M |
| `H15` | Handoff 15: close the geographic milestone | `P-COP`, `P-DASH` | Astra, documents | S |
| `D22` | Resource coordination | `P-SHELL`, `81B-E2`, `D07` | `web/src/app/surfaces/ResourcesSurface.tsx` | M |
| `D20` | Incident activation and participation | `P-SHELL` | `IncidentsSurface.tsx`, `IncidentParticipants.tsx`, `IncidentAreaEditor.tsx` | M |
| `D21` | Datasets and feed administration | `P-SHELL`, `D07` | `IncidentDatasets.tsx`, `FeedsSurface.tsx` | M |
| `D29` | Field reporting and tracking | `P-SHELL` | `SmartFormsSurface.tsx`, `TrackingSurface.tsx`, the field capture screens | L |
| `D26` | SITREP, briefings and JIC preparation | `P-SHELL`, `P-LIFE-1` | `web/src/sitreps/**`, `SitrepSurface.tsx` | M |
| `D28` | Alerts and notification handling | `P-SHELL`, `81B-E2` | the notification inbox and alert detail, `NotificationTray` once `P-SHELL` has landed | M |
| `D27` | Messages and files in context | `P-SHELL` | `MessagesSurface.tsx`, `FilesSurface.tsx` | M |
| `81C-PROOF` | 81C's width, keyboard and touch proof over the real COP, boards and dashboards | `P-COP`, `P-BOARDS-1`, `P-DASH` | a new browser test file | S |
| `KIT-CONTRACT` | Remove kit exports and tokens that nothing imports any more (solo unit, HZ14) | every unit above | `web/src/design/**` | S |

**Phase 3: continuity and delivery**

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `85-A` | VEOC-85 provisioning half: cold setup from local dependencies and assets | Phase 1 | `deploy/**` outside `deploy/basemap/` and the test runtime, its documents | L |
| `85-B` | VEOC-85 continuity half: the agreed offline workflow, reconnect, conflicts, attribution | `82-E` | `web/src/offline/**`, `server/src/sync/**` | L |
| `D31` | Offline, conflict and session-recovery presentation | `85-B`, `P-SHELL` | the offline and synchronization states in the interface | M |
| `D30` | Branding on exported products | `83-E`, `84A-E`, `D04`, `D05` | `shared/src/ics/pdf.ts`, `server/src/export/**`, `docs/ASSET-LICENSES.md` | M |
| `85-PROOF` | VEOC-85 combined proof, by Astra in the canonical checkout | `85-A`, `85-B`, `D31`, Phase 2 | none | M |
| `D32` | Operator guidance and the demonstration scenario | Phase 2, `D31` | guidance documents, `server/src/demo/**`, `docs/DEMO-SCENARIO.md` | M |

**Phase 4: acceptance**

| Unit | What | Depends on | Owns | Size |
|---|---|---|---|---|
| `79D+D33` | The integrated incident exercise, with the one bounded visual and accessibility review riding on it | `85-PROOF`, `D30`, `D32`, milestone gate M4 | Astra as single writer; new exercise test files | L |
| `D34` | Operator workflow comparison against the D01 baseline | `79D+D33`; representative operators, an external input | its own documents | M, Basho-gated |
| `86+D35` | Reconcile parity and design evidence; one release disposition | `D34` or its recorded absence | Astra, documents | M, Basho decides |

### 8.4 Pull rule and opening assignment

Phases group units by kind. They are not barriers: a Phase 2 unit starts as
soon as it is ready, even while Phase 1 engines are still landing.

1. A unit is **ready** when everything it depends on has landed on `main` and no
   unit in flight owns any file it owns (Z4).
2. When a lane frees up, Astra gives it the ready unit listed first in section
   8.3. Where it can, it keeps a chain in the lane that just landed the
   predecessor.
3. No presentation unit starts before `G-A`, its kit units and `P-SHELL`.
4. `85-A` has its own territory and may be pulled whenever a lane would
   otherwise idle.
5. Opening, by the ramp of section 7.4: lane `a` takes `79G-E1`, lane `b` takes
   `80`, lane `d` takes `D00`; lane `c` takes `H11` after the first clean
   landings. Lane `d` stays on the design foundation until `D08` lands.
6. The backlog is the plan, not a prediction. When reality differs (a unit
   splits, a dependency appears), Astra updates its working order from the
   graph and says so in the next batch ask. A change to what a prompt must
   deliver is not Astra's to make.

### 8.5 File ownership

| Files | Rule |
|---|---|
| `web/src/cop/**` | One owner at a time: `H11`, `H12-CB`, `H13`, `H14`, then `P-COP`. Anyone else requests a change through Astra |
| `web/src/app/surfaces/MapSurface.tsx` | `H11`, then `P-COP` |
| `web/src/app/layout/**`, `web/src/app/screens/**`, `web/src/app/router.tsx`, `web/src/app/App.tsx` | Owned by `P-SHELL` while it runs. Before and after: additive only (one route, one navigation entry) |
| `web/src/design/**` | Design units only, by expand then contract (HZ14). `web/src/design/gallery.tsx` is additive for every kit unit. `layout.tsx` moves to `P-SHELL` |
| `server/src/app.ts` | Additive only: one import and one route registration line per new module |
| `web/src/app/api/client.ts` | Additive only: new methods and their types |
| `shared/src/index.ts` | Additive only: new export lines |
| `shared/src/ics/pdf.ts` | One owner at a time: `83-E`, `84A-E`, then `D30` |
| `server/src/__tests__/app-e2e.test.ts`, `cop-e2e.test.ts` | `P-SHELL` and `P-COP`. Every other unit adds its own browser test file (HZ15) |
| `docs/ASSET-LICENSES.md` | One owner at a time: `H13`, `D05`, `D30` |
| `server/migrations/**` | Reserved blocks, section 8.6 |
| Ledger, parity matrix, `ROADMAP.md`, `docs/FACET-STATUS.md`, this file, `CLAUDE.md` | Astra only |
| `vitest.config.mjs`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`, `server/src/__tests__/helpers.ts`, `server/src/__tests__/globalSetup.ts`, `.githooks/**`, `.github/**` | Astra only |

Additive means new lines only: no reformatting, no reordering, no edits to
neighbors, zero deleted lines in the unit's diff for that file. Astra expects
adjacent-insert conflicts in these files at rebase and resolves them by keeping
both sides.

Execution allocation, 2026-09-21: unit `80` additionally owns the existing
dashboard service/routes, `Console.tsx`, `DashboardSurface.tsx` and
`web/src/app/data/hooks.ts` for the scoped authorization and revoked-data
corrections exposed by its scouts. No other active unit owns these files.
This is a focused access correction, not the later shell or dashboard redesign.
The additive-only rules for `server/src/app.ts` and the API client still apply.
Named incident participation supplies incident-specific mutual-aid authority;
an unrelated board or position guest scope does not become incident authority.

Execution allocation, 2026-09-21: `79G-E2` additionally owns one additive
incident-board read-shape helper in `server/src/boards/service.ts`, reusing
the existing incident authority, attachment check and field-read rules. Unit
`80` may consume that helper after it lands; it does not edit the board service.
This closes the observed Lifeline field-visibility bypass without a second
access model. Board authoring takes ownership after E2 lands.

Execution split, 2026-09-21: `80a` is the independently gated client-cache
correction in data/hooks.ts, DashboardSurface.tsx and its new hook test.
The remaining `80b` access work is preserved separately while the policy
decision is pending. Its next clean unit boundary incorporates E2's helper.
VEOC-80 remains open. After 80a's clean landing and integration gate, both
opening lanes have landed a clean unit, satisfying section 7.4. Lane c starts
H11; the temporary hold for full 80 acceptance was stricter than that rule.
H11 also owns the existing data-pack items read service/routes and its new
focused tests for area-filtered pagination, because the current read silently
caps at 2,000 records. Unit 80b's nine restored files do not touch that seam.
Existing unpaged callers stay compatible; authority and ingestion are unchanged.

Execution allocation, 2026-09-21: `81A-E` also owns the existing sync hub's
board checkpoint and its focused test. Review found that this direct writer
retains an old board shape after an upgrade. It must use the same board
mutation lock and reload the current shape inside the checkpoint transaction.
The production write inventory contains only the board service and this hub.
This completes the upgrade-preservation gate; it adds no offline workflow.

Execution allocation, 2026-09-21: root's `80b` correction also touches only
getIncidentBoardReadShape in boards/service.ts. Review found its constant
member role hid local administrators' fields on incident dashboards. Preserve
the local membership role after existing incident/attachment checks, and retain
the established member field level for named participants. The active 81B-E2
unit does not edit that file. H13 may add its licensed local facility PNG subset
and provenance under web/public/napsg/ for the existing map image pipeline.

### 8.6 Migration blocks

| Block | Holder |
|---|---|
| `0040`-`0044` | `79G-E1`, `79G-E2`, `H12-E` |
| `0045`-`0049` | `80` |
| `0050`-`0059` | `81A-E`, `81B-E1`, `81B-E2` |
| `0060`-`0064` | `SEAM` |
| `0065`-`0069` | `81-E` (above the seam and 79G) |
| `0070`-`0074` | `82-E` (above 81B) |
| `0075`-`0079` | `83-E` (above 81B) |
| `0080`-`0084` | `84-E`, `84A-E` |
| `0085`-`0094` | `D13`, `P-LIFE-1` to `P-LIFE-4` (above 79G, 81B and 82) |
| `0095`-`0099` | `85-B` |
| `0100` and up | Unassigned; Astra allocates |

`server/src/db/migrate.ts` applies unapplied files in lexical filename order and
records them by name, so gaps are harmless and unused numbers stay unused.
Every test database is built fresh in that order, so a migration can reference
only lower-numbered files; the blocks are numbered in dependency order for that
reason. The rule: a migration references only lower-numbered files that are
already on `main`, or lower numbers in its own block. If a new cross-unit
dependency appears, Astra allocates a fresh block above both. A migration that
redefines an existing function, policy or trigger must say so in the unit
report; Astra confirms no other unit in flight touches the same object and
lands such migrations in number order. Applied migrations are never edited.

### 8.7 Gates and push points

**Milestone gates** (the full suite, by Astra on `main`, tag `gate`):

| Gate | When |
|---|---|
| M1 | Every Phase 1 engine unit has landed |
| M2 | `P-SHELL` has landed, because every surface now sits inside it |
| M3 | Phase 2 has landed, after `KIT-CONTRACT` |
| M4 | `85-PROOF`, `D30` and `D32` have landed |
| M5 | `79D+D33` is done |

Lanes may keep working during a milestone gate once W0.1 has landed. If the
full run shows the worker crash under that load, hold new launches and re-run
it once with the lanes idle. After a green milestone gate Astra reports the
unpushed range and stops; pushing is Basho's instruction to give.

**Basho's review gates.** `G-A` blocks: the Milestone A package (inventory,
journeys and baseline, navigation map, compositions) goes to Basho with its open
aesthetic decisions presented together, and nothing in the kit or any
presentation unit starts before his answer. The other design milestone exits
are report points, not blocks, unless Basho says otherwise: B when the kit and
the shell are in, C when the COP and the ESF and Lifeline workspaces are in, D
when Phase 2 has landed, E at disposition.

## 9. Phase 0: enablement units (Astra, canonical checkout)

**W0.0 Authority alignment** (docs; once this plan has A0). The standing grant
is already in `CLAUDE.md`. This unit adds the rest of section 2.3 as one
docs-only commit: the `CLAUDE.md` authority-documents bullet, the dated notes in
the continuation document and the canonical PSPR, the Design PSPR status line,
and the return of `docs/ASTRA6-PSPR-2026-09-21.md` to its committed text with a
superseded line.
The contract treats modifications that predate a session as Basho's, so that
file is touched only on his word. Gate: link check and diff review.

**W0.1 Harness isolation** (code). Objective: database-backed test runs from
different checkouts can overlap on the shared cluster without dropping each
other's databases (HZ1). Smallest design that works: an optional
`OPENEOC_TEST_DB_TAG`, validated against `^[a-z0-9]{1,12}$` because it is
interpolated into SQL. With a tag, `freshDb()` names databases
`t_<tag>_<10 base36>` and the teardown drops only `^t_<tag>_[0-9a-z]{10}$`.
Without one, both behave exactly as today, and the untagged pattern cannot match
a tagged name because of the second underscore. Fix one latent fault in the
same unit: `Math.random().toString(36).slice(2, 12)` returns fewer than ten
characters a fraction of a percent of the time, and such a name matches neither
pattern and leaks, so pad it (`.padEnd(10, "0")`). Every agent run sets a tag
and no two runs share one at the same time (section 4). Update
`deploy/test-runtime/README.md` with the lane environment and widen the manual
cleanup pattern to cover tagged names. Files: `server/src/__tests__/helpers.ts`,
`server/src/__tests__/globalSetup.ts`, the README. Gate: tsc, eslint, and one
real-database proof in which run A (tag `a`) finishes while run B (tag `b`) is
still in flight, B passes, and no database of either tag remains afterwards.

**W0.2 Matrix reconcile** (docs). Bring G-INCSCOPE, G-INGEST, G-PARCELS, F6,
F18 and R3 in line with the ledger receipts for 79B1, 79B2, 79C1, 79C2 and
Handoff 10, keeping each receipt's stated boundary as the remaining gap. Confirm
every change against the receipt text before editing; do not upgrade a status
the receipts do not support. Gate: link check and diff review.

**W0.3 Zipper guards** (hooks, CI, local config). Objective: make Z1
mechanical. (a) A tracked hook refuses merge commits:
`.githooks/pre-merge-commit` rejects an automatic merge commit, and
`.githooks/commit-msg` rejects any commit made while `MERGE_HEAD` exists, which
is a conflicted merge concluded by hand (resolve the path with
`git rev-parse --git-path MERGE_HEAD` so it works in worktrees). A
fast-forward creates no commit and passes untouched; rebases and cherry-picks
do not set `MERGE_HEAD`. (b) CI fails a push to `main` whose range contains a
merge commit (`git rev-list --merges` over the pushed range; the job needs
`fetch-depth: 0`). That is the backstop `--no-verify` cannot dodge. (c) Local
configuration shared by every worktree: `git config merge.ff only` and
`git config pull.ff only`. (d) Optional, and Basho's to do because it is a
GitHub account setting: branch protection on `main` with "Require linear
history". Gate: in a throwaway repository made with `git init` in the
scratchpad, with the hooks copied in, a non-fast-forward `git merge` is
refused, a conflicted merge concluded with `git commit` is refused,
`git merge --ff-only` succeeds and an ordinary commit succeeds.

**W0.4 Lane bring-up** (under the standing grant; no ask). One thing is still
Basho's: adding the lane parent directory to the session's allowed working
directories if it is outside them, because agents cannot change permission
settings (HZ12). Then Astra runs these and lists them in its next batch ask:

```
git worktree add -b lane/a "C:/Users/17076/Documents/eoc-lanes/a" main
git worktree add -b lane/b "C:/Users/17076/Documents/eoc-lanes/b" main
git worktree add -b lane/c "C:/Users/17076/Documents/eoc-lanes/c" main
git worktree add -b lane/d "C:/Users/17076/Documents/eoc-lanes/d" main
```

Then, in each worktree: `pnpm install --frozen-lockfile --offline` (local store
only; if it fails, stop and ask rather than go to the registry); confirm
`git config core.hooksPath` prints `.githooks` and the hooks exist there; run
`pnpm -r exec tsc --noEmit` once.

Lanes stay up for the whole plan. A lane that is dropped for capacity, or a
later plan that needs lanes again, uses the same commands under the same
grant. Removal, per lane: `git log main..lane/<letter> --oneline` must
print nothing, and `git -C <path> status --short` must print nothing except
`?? .vitest/` (HZ13). Delete that one directory, then `git worktree remove
<path>` (it refuses a tree with untracked files), then `git branch -d
lane/<letter>` (it refuses an unmerged branch).

## 10. Prompt cards

The binding wording is the prompt's row in the amended roster table (parity) or
its text in the Design PSPR (design). The lines below are working summaries
with reuse pointers, unit mapping and cautions. Every prompt starts with a unit
plan (scouts plus planner) and ends with receipts.

### 10.1 Parity prompts

#### VEOC-80 - complete FOUO authorized-viewing behavior (order 14; unit `80`; Astra 6 starts here)
- Objective: members and valid mutual-aid guests view the authorized incident
  and dashboard; anonymous users, unrelated incidents and expired or revoked
  grants are denied. Fix any remaining UI or API inconsistency. Do not rebuild
  an anonymous projection or weaken write authority.
- Reuse: `16ce911`; `has_guest_scope`, `can_read_incident`,
  `getIncidentAuthority` (`server/src/incidents/participation.ts`); memory
  `eoc-fouo-access-model`.
- Work: one real-database scenario for the allow and deny matrix across
  incident, dashboard and the dataset, catalog and items endpoints added after
  `16ce911`; fixes for anything it exposes; the browser proof of the same
  matrix in its own test file.
- Fan-out: three scouts in parallel build the inventory the scenario is written
  from: every read route a guest token can reach, every policy and helper in
  `server/migrations/` that decides guest reads, and every place the web client
  gates on membership rather than authorization.
- Gate: real-database and browser proof of member, valid guest, anonymous,
  unrelated incident, expired and revoked. No public read path.

#### Handoff 11 - hazard hatching and FEMA flood overlays (order 8; unit `H11`)
- Objective: operational hazard polygons rendered by status, and FEMA flood
  zones by documented category, with legend, attribution and toggles.
- Reuse: the dataset-COP layer path (`web/src/cop/feeds.ts`,
  `web/src/app/surfaces/MapSurface.tsx`), status color in
  `web/src/cop/symbology.ts`, the CopMap layer control, and the catalog's
  `fema-nfhl-flood` entry (available: false).
- Gate: hazard polygons draw by status with a legend in both themes; flood
  zones render by documented category with legend, attribution and toggles
  where a source is configured; area-based retrieval handles pagination and
  unknown coverage; static flood hazard stays distinct from current incident
  status. The legend is kept functional and plain here; `P-COP` gives it its
  final form.
- Gap: the live NFHL fetch is gated (A6). Deliver rendering, legend and
  coverage handling; NFHL stays a named gap until Basho authorizes the source.

#### VEOC-79G - incident-area impact analysis (order 9; units `79G-E1`, `79G-E2`, widget in `P-DASH`)
- Objective: for the current area revision, compute affected structures and
  parcels, infrastructure and facilities, shelters and closures, and population
  estimates from cataloged inputs, with explainable changes when the area grows
  or shrinks.
- Reuse: the current area revision in `incident_area_revisions`
  (`server/src/incidents/area.ts`), `data_pack_items`, PostGIS `ST_Intersects`,
  `ST_Area`, `ST_Within`. `incidentAreaBbox` in
  `server/src/data-packs/service.ts` shows the pattern but is private to that
  module and sits in unit `80`'s territory, so `79G-E1` reads the area in its
  own spatial-query module instead of editing that file.
- Work: prefer computing both revisions on the fly over a snapshot table; add a
  table (block `0040`) only if drill-down or audit needs persisted results.
- Gate: state the spatial predicate, denominator, population method, source
  vintage and coverage, and overlap deduplication. Join incident reports to
  lifeline status without inferring failure from exposure alone. Totals drill
  to contributing records or source aggregates; absent coverage is unknown, not
  zero; expanding or shrinking an area produces explainable changes.
  Real-database test over a known area and known inputs.
- Gap: population needs a loaded baseline (the Census ACS pull is gated, A6).
  Compute from loaded items; where none is loaded, report unknown.

#### Handoff 12 - map-extent KPIs (order 10; units `H12-E`, `H12-CB`, strip in `P-COP`)
- Objective: affected buildings, records by status and open shelters within the
  current viewport, labeled incident-area versus viewport; moving the map
  updates counts without changing the incident boundary.
- Reuse: 79G's spatial-query module, the 79B2 incident scope and
  `computeDashboard` (`server/src/dashboards/service.ts`). `CopMap` already
  listens for `moveend` internally and exposes only the `onMap` test hook;
  `H12-CB` adds one optional prop that reports bounds, covered in the existing
  cop tests.
- Gate: counts update on pan and zoom, are clearly labeled, and reconcile to
  underlying records, not to the 1,000-feature client cap (G-TILES).

#### Handoff 13 - facility and incident symbology, NAPSG (order 11; unit `H13`)
- Objective: the agreed NAPSG facility subset through the existing sprite
  pipeline, with attribution and verified licenses; symbols, legends and
  inspection identify the real feature type and status in both themes.
- Reuse: `web/src/cop/symbology.ts`, `web/src/cop/streetstyle.ts`,
  `shared/src/dictionary/symbology.ts`, `deploy/basemap/README.md`, the catalog
  critical-facilities entry.
- Gate: the right symbol per type and status in light and dark; legend and
  inspection agree; licenses verified, or the assumption recorded as a gap.
  Starts `docs/ASSET-LICENSES.md`, which D05 and D30 extend.
- Gap: obtaining the symbol set is an outbound action (A6) unless Basho
  supplies it locally.

#### Handoff 14 - enriched building subtypes, Overture (order 12; unit `H14`)
- Objective: extend the building pipeline with Overture subtypes where source,
  tool and license prerequisites are met; keep provenance, stable identity and
  status joins; avoid duplicate footprints and false certainty for unmapped
  classifications.
- Reuse: `buildingsSource` in `web/src/app/config.ts`; `BUILDING_USE_*` in
  `web/src/cop/layers.ts` and `CopMap.tsx`.
- Gate: subtypes join to operational status without duplicate footprints; an
  unmapped classification is shown as unmapped, not guessed; coverage and any
  remaining external prerequisite are recorded.
- Gap: Overture acquisition and tooling are gated (A6). Deliver the join and
  provenance path; record acquisition under G-BUILDINGS.

#### Handoff 15 - close the geographic reference milestone (order 13; unit `H15`, Astra)
- Objective: record delivered coverage, the reference-screenshot evidence in
  both themes and the remaining data gaps in the ledger, matrix and
  `ROADMAP.md`. It closes the geographic milestone only. It waits for `P-COP`
  so the evidence is captured once, on the final COP.
- Fan-out: read-only auditors, one per row group (G-FLOOD, G-IMPACT, G-KPIMAP,
  G-BUILDINGS, G-TILES, F8, F9, F19), each returning row text with its evidence.
  Screenshot evidence that needs the real tile archives is captured in the
  canonical checkout (HZ8). No new engine.

#### VEOC-81A - no-code board authoring and views (order 15; units `81A-E`, `P-BOARDS-1`, `P-BOARDS-2`)
- Objective: input, list and detail layouts, conditional fields, validated
  calculations and incident-scoped related-record lookups, on the existing
  versioned board schemas and designer. An administrator creates, publishes,
  reopens and revises a usable board without HTML or JS.
- Reuse: `shared/src/boards/`, `server/src/boards/service.ts`
  (`getEffectiveBoard`, `loadBoardShape`, `roleFor`, `listViewRecords`,
  `createRecord`), `web/src/boards/Designer.tsx`, `RecordForm.tsx`,
  `BoardView.tsx`. List layouts render through D07's table and conditional
  fields through D08's controls.
- Gate: server validation agrees with the UI; version upgrades preserve
  existing records and customizations.

#### VEOC-81B - configurable board workflow routing (order 16; units `81B-E1`, `81B-E2`, configuration in `P-BOARDS-2`)
- Objective: declarative transitions, assignments, approval rules and
  escalation and due rules on the existing position identity, resource
  lifecycle and notifications.
- Gate: a request routed between authorized positions with a notification and
  immutable history; unauthorized transitions fail; retries do not duplicate
  (idempotency); cross-organization routing uses explicit incident authority
  and never assumes unified command.
- Note: `81B-E1` owns the assignment, due and escalation primitive that 82, 83,
  D13, D15, D16 and D22 reuse (HZ9). Name its contract in the unit plan.

#### VEOC-81C - adaptable, coherent operator shell (order 17; units `SEAM`, `P-SHELL`, `81C-PROOF`)
- Objective: collapsible and resizable panels, legible navigation, saved
  workspace preferences scoped to user and incident. COP, boards and dashboards
  remain usable at wide desktop, narrow desktop or tablet and field widths;
  keyboard focus, essential touch controls, light and dark reference fidelity.
  No fixed dock may make the map or the primary action unusable.
- Same deliverable as D09 and D10: one implementation, built to D02's
  navigation and the approved compositions. 81C closes with `81C-PROOF`, which
  runs over the real COP, the 81A boards and the 81 dashboards.

#### VEOC-81 - composable saved dashboards (order 18; units `81-E`, `P-DASH`)
- Objective: operator-selectable, composable saved dashboards with category,
  date and operational-period filters and map, chart and list drilldowns.
- Reuse: B1 and 79G queries, Handoff 12, `computeDashboard`,
  `web/src/dashboards/Dashboard.tsx`, `SEAM`.
- Gate: selections update related views and URL state; totals reconcile to
  contributing records; stale and missing inputs stay visible; switching
  incident clears incompatible filters and data. No second counting engine.

#### VEOC-82 - checklist Tasks, Lists and Templates (order 19; units `82-E`, `P-TASKS`)
- Objective: assignment, due, status and category filters and analytics through
  the shared incident and workflow seams.
- Reuse: the checklist code in `server/src/incidents/service.ts`, 81B's
  assignment and due primitive, the offline queue in `web/src/offline/`.
- Gate: template activation, assigned task completion and offline
  reconciliation without duplicate completion or lost attribution.

#### VEOC-83 - AAR and accountable improvement plans (order 20; units `83-E`, `P-AAR`)
- Objective: priority, status and capability analytics, action owners and due
  dates; PDF fidelity.
- Reuse: `server/src/aar/`, `shared/src/aar/`,
  `web/src/app/surfaces/AarSurface.tsx`, `shared/src/ics/pdf.ts`, 81B's
  primitive for owners and due dates.
- Gate: incident and period filters and totals reconcile to records; the PDF
  keeps operational fields and action follow-through.

#### VEOC-84 - IAP navigation and filters (order 21; units `84-E`, `P-IAP`)
- Objective: working and published views, organization, period and role
  filters, and visible progress on the selected incident.
- Reuse: `server/src/iap/`, migration `0030_iap_workflow.sql`,
  `web/src/app/surfaces/IapSurface.tsx`.
- Gate: the existing five-state workflow with authorized handoffs and no mixing
  of concurrent incidents.

#### VEOC-84A - editable ICS-204 assignments (order 22; units `84A-E`, `P-IAP`)
- Objective: author and revise resources, supervisor and tactics; freeze
  approved revisions and export them faithfully.
- Gate: prior approved revisions remain unchanged; cross-organization
  assignments retain named authority; the PDF export is faithful.

#### VEOC-85 - disconnected provisioning and continuity (order 23; units `85-A`, `85-B`, `D31`, `85-PROOF`)
- Objective: cold setup from locally available dependencies and assets,
  activation, the agreed offline field and operational workflow, then reconnect
  with conflicts and attribution intact. Reuse the approved project-local
  runtime; Docker is not required.
- Work: the two halves have disjoint territory (`deploy/**` and
  `web/src/offline/**` with `server/src/sync/**`). The combined proof is
  Astra's, in the canonical checkout, against the finished interface. Scouts
  can inventory AR7 blockers at any earlier time.
- Gate: document degraded behavior and the exact AR7 blocker rather than
  treating skipped provisioning as complete.

#### VEOC-79D - integrated incident exercise (order 24; unit `79D+D33`, Astra as single writer)
- Objective: end to end over the application and a real database: activate,
  expand the area, onboard selected partners, load data, post field impacts,
  request and assign resources, reconcile COP and KPIs, publish an
  operational-period IAP, revoke access and close. One single-organization case
  and one separate concurrent incident; no assumed tribal participation or
  unified command. Reconnect and federation retain attribution.
- Fan-out: planners draft the scenario phase by phase in parallel from the
  component receipts. D33's bounded visual and accessibility review rides on
  the same run. Defects return to their owning prompt as corrective units
  (section 7.7); the exercise does not absorb unfinished implementation.

#### VEOC-86 - reconcile parity evidence and release decision (order 25; unit `86+D35`, Basho-gated)
- Objective: reconcile every matrix row to implementation and operator
  evidence, with no unowned gap and no unexplained verified label. Present the
  blockers and one explicit release decision to Basho, together with D35's
  design disposition.
- Fan-out: read-only auditors, one per matrix section (F1-F20, R1-R6, AR1-AR7,
  G rows, and the design-to-capability matrix), each returning per row: claim,
  code location, receipt, evidence, verdict. Astra consolidates.
- External inputs only Basho can supply: the named California pilot, the
  evaluator AAR, independent deployment proofs, maintainers, and IPAWS
  credentials for any live IPAWS claim. Missing live evidence or an incomplete
  included capability prevents an absolute-parity claim.

### 10.2 Design prompts

One row per prompt. "Unit" is where it executes in section 8.3.

**Milestone A: reviewable design specification**

| Prompt | Deliverable in brief | Unit | Notes |
|---|---|---|---|
| D00 | Screen and component inventory: existing behavior, deficiencies, engine dependencies, reference sources, owning prompt; dated practitioner feedback kept apart from verified behavior | `D00` | Fan-out: one scout per surface group. Every destination and requested capability gets an owner and a disposition. Starts the design-to-capability matrix that D35 completes |
| D01 | Baseline scripts for field reporting, lifeline assessment, resource coordination, board customization, IAP preparation and shift briefing, with time, interactions, duplicate entry, assistance and errors | `D01` | Measure the current interface before `P-SHELL` changes it. With no operator available, script the journeys in the browser and record interaction counts, labeled as scripted; human timing waits for D34. Unsupported vendor baselines are labeled unavailable |
| D02 | Navigation map, section names, page hierarchy, role defaults, cross-links, the Map, Boards and Planning arrangements | `D02` | Start from Design PSPR section 4 and the comps' grouping (Situation, Operations, Planning, Coordination, Data and administration). Every D01 journey gets an explicit route |
| D03 | Light and dark compositions for Overview, Map, ESFs and Lifelines, a dense board, a resource form drawer and IAP Planning, with narrow-screen examples | `D03` | Inventory what Basho already supplied (the comps in `Reference Screenshots/`, the concepts in `docs/design-previews/`), then build only the missing ones as coded gallery pages with mock data labeled as mock (HZ17). Present the open aesthetic decisions together for `G-A` |

**Milestone B: shared visual system and workspace foundation**

| Prompt | Deliverable in brief | Unit | Notes |
|---|---|---|---|
| D04 | Tokens for surfaces, type, spacing, borders, elevation, focus, brand accents, chart categories and operational conditions; identity placement | `D04` | Extend `tokens.ts` and keep existing names working (HZ14). The contrast and accessibility tests in `web/src/design/__tests__/` stay green. Branding cannot alter operational color meaning or imply command authority |
| D05 | SVG icon family, size and stroke rules, accessible names, states, registry; operational symbols with source and license | `D05` | Local files only. Shares `docs/ASSET-LICENSES.md` with Handoff 13. The eight lifeline icons and the navigation icons of the comps are in scope |
| D06 | KPI, condition, record, action and summary cards; buttons, tabs, badges, menus, tooltips, progress, loading, empty and error states | `D06` | Unknown and zero differ visibly. Primary actions do not rely on color alone |
| D07 | Adjustable and pinned columns, sorting, filters, selection, saved views, pagination or justified virtualization, density | `D07` | Saved views use `SEAM`. 81A list layouts and every list surface reuse this table; there is no second one |
| D08 | Field types, grouped sections, conditional controls, inline validation, error summary, drafts, unsaved-work handling, keyboard and focus conventions | `D08` | 81A's conditional fields render through these controls. A failed submission never looks successful |
| D09 | Collapsible navigation, resizable context drawer, page headers, notification access, responsive arrangements | `P-SHELL` | Same deliverable as VEOC-81C: one implementation, one receipt |
| D10 | Incident, period and position controls, return-to-record, saved layouts, deep links, filter restoration, synchronization indicators | `P-SHELL` | Uses `SEAM`. Switching incident clears incompatible content without discarding protected drafts. Browser Back behaves predictably |

**Milestone C: situational awareness and ESF and Lifeline operations**

| Prompt | Deliverable in brief | Unit | Notes |
|---|---|---|---|
| D11 | Searchable layer groups, legends, source, freshness and coverage, feature selection, record drawers, map tools, field-capture entry | `P-COP` | Geographic reference layers stay distinct from incident records. Carries the Handoff 12 strip and the legends of Handoffs 11, 13 and 14 |
| D12 | Dashboard selection, layouts, filters, drilldowns, optional map linkage, saved views | `P-DASH` | Reuses VEOC-81 and the existing filter and drilldown work. Incident-area and viewport totals are clearly distinguished |
| D13 | The ESF and Lifeline assessment contract: versioned definitions, separate ESF activation and lifeline condition, components, impacts, sources, responsible organizations, stabilization actions, history | `D13` | New functional work and an engine unit, not styling. Existing entries migrate without losing attribution; conflicting assessments stay visible; California and federal mappings are explicit (Design PSPR section 5). Affected facilities and populations come from 79G; actions reuse 81B's primitive. No rule equates exposure with failure, or ESF activation with a red lifeline |
| D14 | Eight lifeline cards with icons, condition, component summaries, impacts, freshness and outlook | `P-LIFE-1` | Every lifeline appears, including unknown ones. A stale report cannot look like a current green |
| D15 | Component assessments, affected geography, evidence, objectives, actions, owners, estimates, history | `P-LIFE-2` | An authorized operator updates an assessment, links an action and sees the attributed result in the overview and the briefing |
| D16 | Applicable functions, coordinators, activation, staffing and capacity, missions, requests, period handoffs | `P-LIFE-3` | Assignment follows actual incident authority. Nothing is activated by geography |
| D17 | Links among disrupted components, responsible ESFs and organizations, facilities, requests, tasks and objectives | `P-LIFE-4` | Multiple contributors without implying a single command structure |

**Milestone D: consistent operational workspaces**

| Prompt | Deliverable in brief | Unit | Notes |
|---|---|---|---|
| D18 | Board discovery, saved views, record detail, attachments, related records, attributed history | `P-BOARDS-1` | With the 81A runtime layouts |
| D19 | Field and layout editing, conditional behavior, preview, version publishing, position-based routing, approval configuration, migration feedback | `P-BOARDS-2` | Reuses 81A and 81B; no second board engine |
| D20 | Incident setup, operational area, periods, participating organizations, positions, grants, revision history, closeout | `D20` | Engines are done (79, 79A). Host, owner, participant and command relationships are distinguishable |
| D21 | Source catalog, mapping previews, coverage, update controls, freshness, accepted and rejected counts, error recovery, last-good data | `D21` | Engines are done (79C, 79F). Registry presence never looks like successful ingestion |
| D22 | Request intake, priorities, assignments, lifecycle, receiving and supplying organizations, history | `D22` | Uses 81B routing |
| D23 | My Tasks and team views, categories, due dates, dependencies, templates, completion evidence, analytics | `P-TASKS` | Reuses VEOC-82 |
| D24 | Period organization, form navigation, working and published states, progress, ICS-204 editing, review, approval, preview | `P-IAP` | Reuses VEOC-84 and 84A. Approved revisions are immutable; exports match the chosen revision |
| D25 | Observation entry, analytics, filters, corrective actions, owners, due dates, evidence, progress | `P-AAR` | Reuses VEOC-83. Every aggregate drills to its records |
| D26 | Briefing composition, lifeline and ESF summaries, significant events, source freshness, talking points, rumor tracking | `D26` | FOUO: no anonymous publication is introduced. Frozen reports stay stable |
| D27 | Message and thread panels, recipient context, file previews, attachments, search, links back to records | `D27` | Read, delivery and acknowledgement stay distinct where supported |
| D28 | Notification inbox, filters, alert detail, acknowledgement, drafting and review states, explicit sending destinations | `D28` | Reading is not acknowledging. External alert actions stay distinguishable from drafts and exercises; nothing is sent (A6) |
| D29 | Capture forms, map placement, attachments, scan and custody actions, queued submissions, synchronization state | `D29` | Touch-first. Offline is shown only for implemented paths |

**Milestone E: continuity, delivery and measured acceptance**

| Prompt | Deliverable in brief | Unit | Notes |
|---|---|---|---|
| D30 | Export typography, identity placement, incident, period and time, legends, provenance, pagination, handling markings | `D30` | Prescribed ICS fields and layouts stay intact. Legible in print and grayscale |
| D31 | Offline, stale, queued, failed and conflict states, reconnect progress, recoverable drafts, authentication recovery | `D31` | Reuses VEOC-85 |
| D32 | Quickstart, role guidance, contextual help, a realistic synthetic incident | `D32` | Sample data is labeled and shows unknown, stale and partial conditions too |
| D33 | One bounded review of representative screens, themes, viewports, keyboard paths, long content and error states | `79D+D33` | Reuse passing component evidence; findings go back to their owning unit |
| D34 | Repeat D01's tasks with representative operators under equivalent conditions | `D34` | Operators are an external input. "2x faster" is claimed only where measured time is at most half the baseline with no worse error outcome. Without operators the claim is not made; nothing is fabricated |
| D35 | Completed design-to-capability matrix, remaining issues, final captures, asset and license inventory, documentation, proposed disposition | `86+D35` | Designed, implemented, integrated and operator-validated agree with evidence. Release remains Basho's decision |

## 11. Templates

### 11.1 Lane unit brief (self-contained)

```
UNIT: <unit name> <title>               SERVES: <prompts, for example VEOC-81 and D12>
TYPE: engine | kit | presentation | document
LANE: lane/<letter>                     WORKTREE: <absolute path>
BASE: <sha of the lane branch, equal to main's tip>
OBJECTIVE: <two to four sentences>
BINDING WORDING (verbatim): <the roster row, the Design PSPR prompt text, or both>
THIS UNIT'S SLICE: <what this unit must prove>
READ FIRST (reuse, do not re-implement): <path:line list>
DESIGN REFERENCES (presentation and kit units): <approved compositions, tokens,
  Design PSPR sections that apply>
OWNED FILES: <paths or globs>
ADDITIVE-ONLY FILES: <path: what may be added>
FORBIDDEN: everything else, including shared documents, test harness,
  configuration, hooks and the lockfile
IN FLIGHT BESIDE YOU: <other units and the files they own, for awareness>
MIGRATION BLOCK: <range, or none>
CONTRACTS OTHERS RELY ON: <types or endpoints; report before changing>
GATE: lane environment (section 4) with tag <letter>; the focused-gate
  commands; the presentation gate if TYPE says so; tee vitest output to <log path>
STANDING RULES: <the block below, verbatim>
REPORT: section 11.2
```

Standing rules block:

```
- Your shell starts in the canonical checkout on every call and keeps no
  variables between calls. Put Set-Location <WORKTREE>, the lane environment
  and the command in ONE invocation, every time. Give file tools absolute paths
  under WORKTREE. A command run from the wrong directory is a false result or a
  write into someone else's tree.
- Work only under WORKTREE and only in OWNED FILES, plus new lines in
  ADDITIVE-ONLY FILES. If the unit cannot be finished without another file,
  stop and report which file and why. Do not edit it.
- Edit existing files with small atomic patches. New files over 40 lines: write
  to the scratchpad, verify with wc -l and tail -5, copy in, verify again. Note
  the expected line count before a write and check it after (tolerance 2
  lines). No sed -i, perl -i or shell redirects onto repo files.
- No reformatting, renames, moves or drive-by cleanups. Do not rename or remove
  anything other code imports.
- Run tools with pnpm exec, never npx.
- Git is read-only for you: status, diff, log, show. Nothing that changes the
  index, a branch, a worktree or a remote.
- Never run pg_ctl. Never create or drop databases by hand. If the database is
  unreachable, stop and report.
- No network: no fetch, install, registration or download. Missing external
  data is a named gap, never a fake. No new dependencies; if one seems needed,
  stop and report. Fonts, icons and styles are local files.
- FOUO: no anonymous or public read path. A guest with a valid grant reads like
  a member. Write and approval authority stay explicit.
- Fail closed: a caller-supplied jurisdiction, position, role, board, incident
  or peer identity is a request, never authority. Audit and activity log tables
  stay append-only; never add an update or delete path to them, even for tests.
- A failing test comes before or with each behavioral change. A test that
  cannot fail on the old behavior proves nothing.
- Source hygiene: no build-phase markers, no unit names from the plan, no
  dangling references, no placeholder logic presented as done. (VEOC-NN) and
  (Handoff N) comments are the approved convention. No em-dashes in any
  document.
- Positive and negative tests for changed behavior, on real PostgreSQL and
  PostGIS wherever a mock cannot prove the claim. Mock data in a composition is
  labeled as mock.
- Stop at done: meet the slice, run the gate once, report. No extra sweeps.
  Report red as red.
```

### 11.2 Unit report

```
UNIT / SERVES / LANE / BASE
RESULT: green | red | blocked
FILES CHANGED: <path (+adds/-dels)>, new files marked
HOT-FILE EDITS: <file: the exact lines added>
MIGRATIONS: <numbers; objects created; any existing object redefined>
CONTRACT CHANGES: none | <list>
GATE EVIDENCE: <output of git rev-parse --show-toplevel; then per command: the
  command, exit code, test files, passed and failed counts, log path>
PRESENTATION EVIDENCE (if TYPE says so): <operator path exercised; light and
  dark screenshot paths; keyboard, focus, names and contrast results>
SLICE MET: <yes or no, one sentence each>
EVIDENCE LEVEL: designed | implemented | integrated | operator-validated
BOUNDARY: <what is deliberately not done; named gaps>
PROPOSED COMMIT: <subject and body; the hook adds the footer>
PROPOSED RECEIPT: <Change, Evidence and Boundary text for the ledger>
INTEGRATION RISKS: <anything another unit could collide with>
```

### 11.3 Integration batch ask (Astra to Basho)

```
Integration batch <n>, base main <sha>
| # | Lane | Unit | Serves | Staged summary (git diff --cached --stat) | Gate | Review | Commit subject |
| D | main | Receipts and matrix rows for the units above (docs only); proposed text attached; unit SHAs filled in after landing |
Ask: per row, approve (commit and land on main), hold or reject.
Rows of one lane land in lane order: a hold or reject holds the later rows of that lane.
With A4 the rows list existing lane commits by SHA and the ask is to land them.
Waiting on you besides this batch: <for example gate G-A, an A6 source>.
Push is not part of this ask.
```

### 11.4 Ledger receipt

The existing fields, plus what the combined roster needs:

- **Serves:** every prompt the unit serves, parity and design.
- **Baseline:** the `main` SHA the unit was cut from or last rebased onto.
- **Lane:** the lane letter, or `main` for Astra's own units.
- **Change**, **Evidence**, **Gate**, **Boundary:** as the ledger does now. An
  engine unit says plainly that the prompt's gate stays open until its
  presentation unit lands.
- **Evidence level:** designed, implemented, integrated or operator-validated.
- **Unit commit:** the SHA on `main` after landing.

## 12. Reuse map (build on these, do not re-implement)

- **Data packs and catalog:** `shared/src/data-packs/pack.ts` (mapping engine,
  `DatasetStatus`, availability), `shared/src/data-packs/catalog.ts`
  (California registry, `catalogCovers`, `catalogToDataset`,
  `CatalogEntryStatus`), `server/src/data-packs/service.ts` and `routes.ts`
  (persist, tolerant refresh, items GeoJSON, `listCatalogForIncident`,
  `onboardCatalogSource`).
- **COP map:** `web/src/cop/CopMap.tsx` renders `boards` (via `fetchItems`) and
  `feeds` (via `fetchFeedItems`) as layers with a shared click-inspect popup;
  `web/src/cop/feeds.ts` is the external read-only geo layer pattern, and
  datasets ride it through `web/src/app/surfaces/MapSurface.tsx`;
  `web/src/cop/layers.ts` holds the layer specs; `web/src/cop/overlays.ts` is
  the jurisdiction vector-overlay pipeline.
- **Incident scope:** `server/src/incidents/participation.ts`
  (`getIncidentAuthority`); `incident_area_revisions` (current area is the
  highest revision; bbox via `ST_Envelope`, see `incidentAreaBbox` in
  `server/src/data-packs/service.ts` and `server/src/incidents/area.ts`).
- **Dashboards and counts:** `computeDashboard` in
  `server/src/dashboards/service.ts` already takes a runtime filter and an
  incident scope. Handoff 12 and 81 reuse it.
- **Boards:** `server/src/boards/service.ts` and the versioned templates in
  `shared/src/boards/` (the lifelines template is in `standard.ts`).
- **Lifelines and ESFs:** `shared/src/dictionary/lifelines.ts`,
  `shared/src/dictionary/esf.ts`, the lifeline uses in `shared/src/sitreps/`,
  `server/src/sitreps/` and `shared/src/dashboards/def.ts`. D13 extends these;
  it does not start a second vocabulary.
- **Symbology and sprites:** `web/src/cop/symbology.ts`,
  `web/src/cop/streetstyle.ts`, `shared/src/dictionary/symbology.ts`.
- **Buildings:** `buildingsSource` in `web/src/app/config.ts`;
  `BUILDING_USE_*` in `web/src/cop/layers.ts`.
- **Design kit:** `web/src/design/tokens.ts`, `components.tsx`, `layout.tsx`,
  `gallery.tsx`, `base.css` and the three tests beside them. Extended, not
  replaced.
- **Shell:** `web/src/app/layout/AppShell.tsx`, `web/src/app/screens/Console.tsx`,
  `web/src/app/router.tsx`, the incident context in `web/src/app/incident/`.
- **PDF and export:** `shared/src/ics/pdf.ts` (used by AAR and IAP),
  `server/src/export/service.ts`.
- **Offline:** `web/src/offline/` (store, field client, registration),
  `server/src/sync/`.
- **Web client and routes:** `web/src/app/api/client.ts` (one file, every
  endpoint); `server/src/app.ts` (every route module registered in one block).
- **Test harness:** `server/src/__tests__/helpers.ts` (`freshDb`,
  `seedIdentity`), `server/src/__tests__/globalSetup.ts`, `vitest.config.mjs`.

## 13. Pre-flight decisions and standing risks

### 13.1 Pre-flight decisions (one message, answered once, so no lane stalls later)

1. A0: approve this plan, the design roster as scheduled in it, and the start
   (VEOC-80, 79G and D00 together).
2. Lanes: the grant is standing and already in `CLAUDE.md`, so nothing to
   re-grant. Name the parent directory for lanes and add it to the session's
   allowed working directories if needed. Approve the commit that records the
   `CLAUDE.md` change.
3. A4: standing lane-local commits, yes or no. The plan recommends no at the
   start.
4. A6, per source: FEMA NFHL (Handoff 11), the NAPSG symbol set (Handoff 13,
   D05), Overture (Handoff 14), Census ACS (79G). For each: authorize a named
   fetch, supply a local file, or leave it a named gap.
5. Gate `G-A`: how Basho wants to receive the Milestone A package, and whether
   the comps in `Reference Screenshots/` settle the palette and navigation
   grouping already, which would shorten D03 and D04.
6. D34 operators and the VEOC-86 external inputs: who and when, or a recorded
   absence.
7. The parallel planning session (section 13.2).
8. Optional: GitHub branch protection "Require linear history" on `main`
   (W0.3, part d).
9. G-MFA: the identity-provider decision. It blocks no unit.

### 13.2 Risks

- **A parallel Basho planning session may share the canonical checkout** (it
  produced `docs/design-previews/`). Two actors on one git index is the CANON
  section 5 hazard. Lanes narrow Astra's exposure to landing and receipts, but
  do not remove it: re-read `git status` and the shared documents right before
  every landing and every docs commit, and never stage that session's files.
  Its own worktree would remove the risk.
- **The design review paces half the plan.** Every presentation unit waits for
  `G-A`. Engines absorb the wait for a while; after they drain, lanes idle.
- **Approval latency paces the rest.** Without A4 a lane holds at each unit
  boundary until its commit is approved. That is the price of the rule, and it
  is the reason batches are presented at once and rows are kept small.
- **Engine and presentation drift.** An engine built before its interface can
  miss what the interface needs. Contract units, real-database tests at the API
  and corrective units (section 7.2) are the control.
- **MFA and SAML (G-MFA)** need Basho's identity-provider decision; this is not
  a code patch.
- **Live release (VEOC-86, D34)** depends on external inputs only Basho can
  supply.
- **No outbound communication or external registration** without Basho's
  separate authorization.
- **Host capacity.** Lanes mean concurrent typechecks, lints, test runs and
  browser builds beside one PostgreSQL cluster. The caps in section 7.4 are the
  control; lower them at the first sign of trouble instead of retrying into it.

## 14. Key files

- This plan: `docs/MASTER-PSPR-2026-09-21.md`.
- Canonical PSPR (execution contract, receipt fields, invariants):
  `docs/VIRTUAL-EOC-PSPR-2026-09-17.md`.
- Parity wording: `docs/VEOC-PARITY-CONTINUATION-2026-09-20.md` (the amended
  table at the end). Design wording: `docs/VEOC-DESIGN-PSPR-2026-09-20.md`.
- Capability matrix: `docs/VEOC-PARITY-MATRIX.md` (named gaps live here).
- Execution ledger: `docs/VEOC-EXECUTION-LEDGER.md`.
- Project rules: `CLAUDE.md`. Global doctrine: `~/.claude/CANON.md`.
- Test cluster: `deploy/test-runtime/README.md`. Harness:
  `server/src/__tests__/helpers.ts`, `server/src/__tests__/globalSetup.ts`,
  `vitest.config.mjs`.
- Gate scripts: `scripts/check-links.mjs`, `scripts/license-scan.mjs`;
  hooks: `.githooks/commit-msg`; CI: `.github/workflows/ci.yml`.
- Basho's visual references, local and never staged: `Reference Screenshots/`,
  `docs/design-previews/`.
- Session memory: `eoc-fouo-access-model`, `canonical-style-bible`.
