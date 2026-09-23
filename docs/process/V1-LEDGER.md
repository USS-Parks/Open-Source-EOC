# V1 Execution Ledger

Append-only unit receipts for the roster in
[`FINISH-PSPR-2026-09-22.md`](./FINISH-PSPR-2026-09-22.md), approved by Basho
on 2026-09-23. Never edit a prior receipt; corrections are new entries that
name the receipt they correct.

Receipts before this ledger opened are in the frozen
[`VEOC-EXECUTION-LEDGER.md`](./VEOC-EXECUTION-LEDGER.md), which holds
VEOC-00 through `W1.12`. Cite a receipt in either ledger by its heading, never
by line number.

## Receipt template

Every unit records, in this order:

- what the unit changed, in plain language, with the files it owned;
- the decision defaults it applied from the plan's section 7, and any
  deviation from the plan's own wording, stated as a deviation;
- schema, contract and dependency changes with licenses;
- exact verification commands, counts and results, with red reported as red;
- the evidence level: unit, integration, browser, real-database, or document;
- deferred work, blockers and the rollback path;
- the commit, and the statement that no push was performed unless Basho
  instructed one.

## V1 W1.13: freeze the historical ledger and open this one

- **Frozen:** `VEOC-EXECUTION-LEDGER.md` carries a notice at the top marking it
  closed and historical, pointing here for later receipts. No receipt in it was
  rewritten, reordered or moved.
- **Deviation from the plan, recorded.** The unit's acceptance in the roster
  reads "no receipt is rewritten or moved, and the new ledger opens with
  `W1.11`". Those two clauses contradict each other: `W1.11` ran first under
  the plan's own execution order, so its receipt, and those of `W1.9`, `W1.10`
  and `W1.12`, were already in the historical ledger. Honoring the binding
  clause, no receipt moved, so this ledger opens with `W1.13` instead. The
  roster row is corrected to say so.
- **Line citations retired.** The freeze notice pushed every line in the
  historical ledger down by ten, which would have silently falsified the five
  line-number citations pointing into it. The two in the live roster are now
  by receipt heading: the `W1.8` migration receipt and the partial VEOC-79D
  exercise receipt. The three in the archived V1 roster are left as they were,
  because that document is historical and is not executed. The freeze notice
  states the ten-line offset so an old citation can still be resolved.
- **Pointers updated:** `docs/README.md` and `CLAUDE.md` name this ledger as
  the destination for receipts and the historical one as frozen.
- **Verification:** the link checker passed all 69 tracked Markdown files.
- **Evidence level:** document.
- **Result:** W1.13 is complete. Committed with this receipt. No push
  performed. Next: W1.14, consolidate the server test suite.

## V1 W1.14: consolidate the server test suite

- **Baseline measured first, as the unit requires.** 98 server test files,
  23,505 lines, 2,468 `expect` calls, 390 `it` or `test` blocks.
- **After:** 98 files, 23,319 lines, 2,466 `expect` calls, 390 blocks. The
  shared helpers grew from 100 to 126 lines.
- **What was deduplicated.** Twenty-three files each carried a private
  `tokenFor` performing the same login round trip, several with a private
  one-line `auth` header helper beside it. Both now live in
  `server/src/__tests__/helpers.ts` and take the app as an argument, so a
  change to the login contract lands in one place instead of twenty-three.
- **Assertion delta explained, not hidden.** The two `expect` calls that
  disappeared were `expect(response.statusCode).toBe(200)` inside two of the
  private `tokenFor` bodies. The shared helper raises a named error on a
  non-200 login and on a missing token, so the guard is preserved and its
  failure message is better; it is no longer counted as an `expect`. Test
  blocks and every behavioral assertion are unchanged at 390.
- **Second regression found and closed.** The route-table contract test in
  `ipaws.test.ts` has been failing on `main` since the integration gating
  commits, for the same reason `app-e2e.test.ts` was: it checked the frozen
  contract against an app built with no optional integrations, while the
  contract publishes every route the product can serve. It now builds its own
  inventory app with all four integrations and the identity-provider routes
  enabled, and awaits `ready()` so plugin-registered websocket routes exist.
  That app never queries the database. This was a live red on `main`, not a
  break introduced by this unit.
- **What was not done, and why.** The unit also proposed collapsing
  per-session acceptance files into one file per module. The evidence does not
  support it. The files that look redundant by name are not: each
  `*-browser.test.ts` drives a real browser against a surface while its
  non-browser sibling exercises the API and the database, and the incident
  scope files each pin a different isolation boundary. Merging them would
  trade clear failure attribution for a smaller file count and risk the
  coverage this unit is forbidden to reduce. No file was merged.
- **Correction to the audit that produced this unit.** The status audit framed
  "server test lines exceed server source lines" as bloat. That framing was
  wrong. The server suite is integration-heavy by construction: a real
  database per file, row-level security exercised as the runtime role, and
  browser walks. For that shape more test code than source code is ordinary.
  The genuine duplication was the login boilerplate, 186 lines, not the
  23,000-line ratio. The audit document keeps its original wording as the
  record of what was believed at the time; this receipt is the correction.
- **Evidence level:** unit, integration, real-database and browser.
- **Verification:** recursive TypeScript clean; full ESLint clean; `ipaws`
  passed 14 of 14 after the fix, having failed 2 of 14 before it. The W1
  milestone gate is recorded in the next receipt.
- **Result:** W1.14 is complete. No push performed. Next: the W1 milestone
  gate.

## V1 W1 milestone gate

- **Command:** `pnpm check:gate` at the repository root with
  `OPENEOC_TEST_DB_TAG=gate`: recursive TypeScript, full ESLint, the license
  scan, the link checker, the advisory gate, the desktop and installer tests,
  then the serial Vitest path at `--maxWorkers=1`.
- **Static gates, all green.** TypeScript clean. ESLint clean. License scan
  300 packages. Link checker 69 files. Advisory gate 0 high or critical with
  an empty allowlist. Desktop and installer tests 18 passed, 0 failed.
- **Serial suite:** 177 of 178 files and 933 of 935 tests passed on the final
  run. The one file that did not pass is recorded below under HZ-C.
- **HZ-C applied, and stated plainly.** The gate has not passed clean in a
  single run on this host. Across three runs a different single file failed
  each time and passed on an isolated retry:
  - run 2, `app-e2e.test.ts`, one locator timeout at 30 seconds; isolated
    retry passed 4 of 4, twice;
  - run 3, `incident-dashboard-scope.test.ts`, a Windows worker fast-fail
    (`0xC0000409`) at worker startup, not a test failure; isolated retry
    passed 2 of 2. `app-e2e.test.ts` passed in that same run.
  HZ-C permits calling such a file green after one isolated retry, and that is
  what is claimed here. It is not a claim that the suite passed end to end in
  one process.
- **Risk carried into W2, not closed here.** A 178-file serial suite with
  browser walks is at the edge of what this host sustains, so the gate costs
  about ten minutes and flakes one file per run. That is a real obstacle to
  the milestone gates W2 through W4 each require. It is not in any unit's
  scope today and no unit has been invented for it; it is recorded so the
  decision is Basho's.
- **Four suites were red on `main` before this wave and are now green**, none
  of them broken by this wave's units:
  - `app-e2e.test.ts` and `field-workspaces-browser.test.ts` walk the tracking
    surface against an app built with no optional integrations, broken when
    tracking and facilities became opt-in;
  - `ipaws.test.ts` checked the frozen contract against that same
    integration-free app, while the contract publishes every route the product
    can serve;
  - `operational-assessments.test.ts` read migration `0085` off disk to build
    its legacy fixture, broken by the pre-release migration squash.
- **Honesty note on the earlier receipts.** The `W1.0` through `W1.8` receipts
  each recorded a passing gate. At least the last of them cannot have run the
  full serial path: once `0085` is deleted, `operational-assessments.test.ts`
  fails at import. Receipts from here on record the exact command and the file
  and test counts it returned.
- **Result:** wave W1 is complete. Nine commits sit on `main` ahead of
  `origin/main`, linear, no merges, nothing pushed. Next: Basho's word on
  pushing, then wave W2.
