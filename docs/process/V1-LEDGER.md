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

## Grant: full STS for the Finish PSPR

Basho, 2026-09-23: STS execution of all phases and prompts of the current
roster is authorized, together with committing and pushing to `origin main`,
for this session. Wave W1 was pushed on that instruction: `7b69b67..ba7d960`,
fast-forward, verified against a fresh fetch. External actions and release
tagging remain separately gated as section 1 of the roster states.

## V1 W2.0: sync hub lifecycle

- **What was wrong.** One `Y.Doc` per board scope was created on first access
  and held for the life of the process: nothing ever removed an entry from the
  hub's map. Every hydration replayed the entire append-only `sync_updates` log
  from the beginning. Every `open()` of an incident scope cloned the doc and
  re-read every board row for that scope from the database. A board template
  upgrade left the cached doc built from the previous field set.
- **Eviction.** Entries carry a subscriber set, an in-flight apply count and an
  idle timer. When the last subscriber leaves, or an `open()` that never
  subscribes returns, the doc is dropped after a grace period, default 60
  seconds. Re-subscribing or re-opening inside the grace period cancels it, and
  an apply in flight defers it. The timer is unref'd so it never holds the
  process open.
- **Defect found while testing the above.** `entry()` cancels a pending
  eviction so the doc survives the call, but `open()` did not restart it. A
  read that never subscribes, such as a federation pull, pinned the doc
  forever. `open()` now reschedules in a `finally`. The bounded-cycle test
  fails without this.
- **Compaction, within the append-only rule.** `sync_updates` carries a
  `BEFORE DELETE OR UPDATE` trigger and is an audit surface: it is not
  rewritten, trimmed or nulled. Migration `0102_sync_snapshots.sql` adds a
  derived cache holding one merged state per scope. Hydration starts from the
  snapshot and replays only rows after it; a scope with no snapshot behaves
  exactly as before. A snapshot is written after 200 updates past the previous
  one, and a failure to write one never fails the update that triggered it.
  The table is the one sync table that may be updated in place, because every
  row in it can be discarded and rebuilt from the log alone.
- **Row projections.** `open()` no longer re-reads board rows per connection.
  Rows are cached per scope, keyed by the reader's visible-field signature, so
  two actors with the same readable fields share one projection and a narrower
  reader still gets its own. The cache is dropped on every apply and, through
  the board event bus, on every record written over REST, which is the path
  that would otherwise serve stale rows.
- **Template upgrades.** The entry records the template version it was
  hydrated against. `entry()` rebuilds the doc and clears the projections when
  that version moves, rather than serving a doc built from the old field set.
- **Instrumentation.** `stats()` reports retained entries, hydrations, row
  loads and snapshots written. The tests assert on those counters rather than
  on wall-clock timings, so the acceptance is deterministic rather than
  load-dependent. The counters are also what `W2.8` will expose as metrics.
- **Acceptance, and how it was read.** The roster asks for heap within 10
  percent of baseline after 200 open-close cycles across 50 boards, and for
  open latency flat in record count. Both are asserted structurally, which is
  stronger than a timing assertion on this host: after 200 open-close cycles
  across 50 boards the hub retains zero documents, where before it retained
  all 50 for the life of the process; and opening a 41-record scope 26 times
  costs exactly one row read, the same one read a 1-record scope costs.
- **Tests:** new `sync-hub-lifecycle.test.ts`, 7 tests against a real
  database, each failing against the previous behavior.
- **Verification:** recursive TypeScript clean; full ESLint clean; the sync,
  continuity-sync, federation, boards, upgrade, reproducible-deploy and new
  lifecycle suites passed 33 of 33.
- **Evidence level:** unit and real-database. No benchmark on real hardware;
  that belongs to the wave gate.
- **Result:** W2.0 is complete. Next: W2.1, the outbound delivery queue.

## V1 W2.1: outbound delivery queue

- **What was wrong.** Webhook and push notifications were sent with `fetch`
  after the board write committed but before the HTTP response returned, with a
  five second timeout per channel, so a slow target held the operator's write
  open for up to five seconds per channel. Scheduled rules did the same. The
  federation outbox was only ever read by a person through the pending route;
  nothing delivered it and nothing called `markDelivered`.
- **Queue.** Migration `0103_delivery_outbox.sql` adds `delivery_outbox`.
  `notifyBoardEvent` now takes the write transaction and runs inside it on
  both write paths, REST and sync: an in-app notice is written as delivered,
  and a webhook or push is written as a `pending` notification plus a delivery
  row carrying the signed body. No network call is awaited in any write path.
  Scheduled rules claim their interval and queue their deliveries in one
  transaction, so a crash between the two can neither skip nor double-send.
- **Worker.** New `server/src/notify/outbox.ts`. Each pass claims due rows
  under a lease with `FOR UPDATE SKIP LOCKED`, sends them concurrently with a
  ten second timeout, and settles each one: delivered; retried with
  exponential backoff and jitter capped at fifteen minutes; or dead-lettered
  after eight attempts, which marks the notification `failed` with the error.
  A target origin with five consecutive failures opens a circuit for a minute;
  its deliveries are deferred without spending attempts.
- **Federation.** Peers gain a push link, `PUT /api/v1/peers/:peerId/link`,
  holding the peer's base URL and the token the peer issued, stored
  envelope-encrypted. Agreements gain an optional `remoteBoardId`. The same
  worker pass pushes each linked peer's stranded entries to its receive lane
  and calls `markDelivered` on success. Federation entries never dead-letter;
  they back off and wait through a partition of any length.
- **Row-level security kept on.** The worker acts for no person, so it
  reaches the queue only through five narrow SECURITY DEFINER functions
  granted to `app_runtime`. The new table is insert-only to members and
  readable by jurisdiction admins.
- **Defect found and fixed while testing.** Writing the notification with
  `RETURNING id` failed under RLS when a member's write triggered a rule,
  because members may insert notifications they may not read. The id is now
  generated in the application.
- **Placement.** The worker starts from `main.ts`, which `W2.2` owns. It is a
  plain interval loop here; `W2.2` moves it under the scheduler with leader
  election. Recorded as a deviation in file ownership, not in behavior.
- **Contract:** one route added, `PUT /api/v1/peers/:peerId/link`, with
  `docs/API.md` regenerated. No dependency change.
- **Tests:** new `delivery-outbox.test.ts`, 5 tests against real databases: a
  target that sleeps for 30 seconds leaves write latency unchanged and the
  worker times it out into a retry; retry then dead letter; circuit open and
  deferral without spent attempts; federation entries held through a
  partition and delivered to a second instance when the link returns; a
  non-admin link refused. `notify.test.ts` now drains the worker explicitly
  and asserts nothing is sent inline.
- **Verification:** recursive TypeScript clean; full ESLint clean; link
  checker 69 files; delivery-outbox, notify, federation, sync-hub-lifecycle,
  boards, continuity-sync, api-docs, ipaws and migrate-baseline suites passed
  52 of 52 after the API document was regenerated.
- **Guides:** `docs/guides/ADMIN.md` states the pending, retry and failed
  behavior; `docs/guides/FEDERATION-SETUP.md` covers the push link.
- **Evidence level:** unit, integration and real-database.
- **Result:** W2.1 is complete. Next: W2.3, pagination and push-down.

## V1 W2.8: observability

- **What changed.** Fastify's pino logger is on, one structured line per
  request with method, route pattern, path without query string, status and
  duration, at warn above `OPENEOC_SLOW_REQUEST_MS` (default 1000). Level comes
  from `OPENEOC_LOG_LEVEL`, default `silent` under test and `info` otherwise.
  Authorization and cookie headers, peer and desktop tokens, passwords,
  tokens, secrets and query parameters are redacted. Every response carries
  an `x-request-id`; an incoming one is kept only if it matches a safe pattern.
  New `server/src/telemetry/logging.ts` and `server/src/telemetry/metrics.ts`.
- **Metrics.** `GET /api/v1/metrics` serves Prometheus text format, written by
  hand, only when `OPENEOC_METRICS_TOKEN` is set and only to that bearer token,
  compared in constant time; unset it answers 404. It reports requests by
  method, route and status class, a duration histogram, slow requests, open
  WebSocket connections, the sync hub counters, delivery queue depth (pending
  and dead), undelivered federation entries, delivery worker outcomes, the
  configured database pool size, the runtime role's connections by state, and
  `openeoc_db_up`.
- **Delivery worker.** Takes an optional logger. Retries and dead letters are
  logged with the delivery id and the target origin only, never the full URL,
  because a webhook URL can carry a secret in its path. Running totals feed the
  metrics. Ownership deviation: `server/src/notify/outbox.ts`.
- **Deviations, recorded.** Request ids are not metric labels, because a label
  per request grows without bound; a slow request is counted by route in the
  metrics and found by id in the log. postgres.js exposes no live pool counts,
  so the pool gauges are the configured maximum and `pg_stat_activity` for the
  runtime role, which includes the scrape itself.
- **Log rotation.** Docker services use the `json-file` driver at 10 MB by 5
  files. On Windows the server's structured log is `server.log`, rotated while
  running at 10 MB by 5; `app.log`, `app-error.log` and `postgres.log` rotate
  at launch. New `deploy/windows/lib/rotating-log.mjs`. Byte-range static
  serving untouched.
- **Schema:** migration `0106_outbox_counts.sql`, one SECURITY DEFINER function
  returning three counts and no row data, granted to `app_runtime`.
- **Contract:** `GET /api/v1/metrics` with a new `metrics-token` auth kind and
  `system` audience; `docs/API.md` regenerated. No dependency change; pino
  ships with Fastify under MIT.
- **Verification:** new `observability.test.ts` finds a slow request by id in
  the captured log and by route in the metrics, and finds a dead-lettered
  delivery to a closed port in both; it also covers redaction, unsafe request
  ids, the gauges, and metrics auth (404 unset, 401 missing, wrong or operator
  token). observability, security, cors, security-headers, api-docs, ipaws,
  delivery-outbox, notify, sync-hub-lifecycle, federation and upgrade passed
  67 of 67. `pnpm test:desktop` 19 passed. TypeScript and ESLint clean. Link
  checker 69 files.
- **Carried to W2.2.** The Windows desktop `serve` path runs no delivery
  worker, which predates this unit. Gate line 4 needs the worker and scheduler
  in both deploy paths; W2.2 owns that.
- **Guides:** `deploy/README.md` gains "Logs and metrics" and three
  configuration rows.
- **Evidence level:** unit, integration and real-database.
- **Rollback:** revert the commit; migration 0106 adds only one function.

## V1 W2.10: MFA

- **What changed.** Local accounts gain TOTP sign-in with single-use recovery
  codes, required for jurisdiction admins and instance admins. Enabling IPAWS
  is admin-only, so every account that can enable it is covered.
  - New `server/src/auth/totp.ts`: RFC 6238, HMAC-SHA-1, six digits, thirty
    second step, one step of drift either way, standard library only.
  - New `server/src/auth/mfa.ts`. A password login for an enrolled person
    returns only `{ mfaRequired, mfaToken }`; an admin who has not enrolled
    gets `{ mfaEnrollmentRequired, mfaToken }` and must enroll before any
    session is issued. The challenge token lasts five minutes, works once, and
    only its hash is stored. The TOTP secret is envelope-encrypted; without
    `OPENEOC_SECRET_KEY` enrollment answers 409. Ten recovery codes are shown
    once and stored hashed. A TOTP step at or below the last accepted one is
    refused. Five wrong codes pause the person for thirty seconds through the
    existing login backoff. Enrollment, recovery-code use and wrong codes are
    audited to each jurisdiction the person belongs to.
  - `login` in `server/src/auth/service.ts` became `checkPassword`, so no path
    mints a session from a password alone.
  - Web: the sign-in screen handles both challenges in new
    `web/src/app/auth/MfaStep.tsx`, shows the setup key and the `otpauth`
    link for manual entry, and shows recovery codes once. There is no QR code
    because `web/` carries no QR library.
- **Decision default applied:** section 7 item 3, TOTP for local accounts and
  no SAML. OIDC sign-in leaves the second factor to the identity provider.
  Enforcement is on by default, switched by `BuildAppOptions.requireAdminMfa`
  or `OPENEOC_REQUIRE_ADMIN_MFA=0`; an enrolled person is always asked for a
  code. Instance admins are included, a slight widening of the roster's
  "jurisdiction admins".
- **Ownership deviations:** the MFA routes, login response and option in
  `server/src/app.ts`; three client methods in `web/src/app/api/client.ts`;
  `web/src/app/screens/Login.tsx`; `vitest.config.mjs` sets
  `OPENEOC_REQUIRE_ADMIN_MFA=0` for the suite, whose seeded admins sign in by
  password; `deploy/README.md`.
- **Integration fix: the Windows desktop path.** The desktop profile set no
  secret key, so with enforcement on its admins would be sent to an enrollment
  that answers 409 and could never sign in. Each profile now carries a
  generated `secrets/envelope.key`, created at setup and, for profiles created
  earlier, on first serve, and the serve path exports it as
  `OPENEOC_SECRET_KEY`. MFA stays on for desktop admins. `DEMO-SCENARIO.md`
  and `WINDOWS-DESKTOP.md` state the first-sign-in enrollment, and the load
  harness notes that it must sign in as a member.
- **Schema:** migration `0105_mfa.sql`: `person_mfa`, `mfa_recovery_codes` and
  `mfa_challenges` with row-level security to the owning person, and one
  SECURITY DEFINER function resolving a challenge hash to its person.
- **Contract:** `POST /api/v1/auth/mfa/verify`, `/enroll` and `/activate`,
  unauthenticated by bearer and authenticated by the challenge token;
  `docs/API.md` regenerated. No dependency change.
- **Verification:** new `mfa.test.ts`, 13 tests: RFC 6238 vectors, drift,
  enrollment, verification, wrong code, replay, single-use challenge,
  recovery-code single use, expiry, backoff, admin versus member versus
  instance admin, the switch off, and the 409 without a key. New
  `mfa-browser.test.ts` walks an admin through enrollment and recovery codes,
  refuses a replayed code, and signs in with the next one. After rebasing onto
  the observability change: mfa, auth, authz, oidc, security, ipaws, api-docs,
  observability and mfa-browser passed 65 of 65. `pnpm test:desktop` 19
  passed. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, real-database and browser.
- **Deferred:** voluntary enrollment for members, recovery-code
  regeneration, and an admin screen to reset another person's factor (the
  admin guide documents the database-owner reset). None is in the roster row.
- **Rollback:** revert the commit; migration 0105 adds tables and one function
  only. `OPENEOC_REQUIRE_ADMIN_MFA=0` disables admin enforcement without a
  code change.

## V1 W2.3: pagination and push-down

- **What changed.**
  - Board views page by cursor in `server/src/boards/service.ts`. The cursor
    carries the sort key, `created_at` to the microsecond, and the record id;
    a page defaults to 100 rows with a maximum of 500, and the response adds
    `nextCursor`. View filters and sorts run in SQL. The shared view function
    still runs on each page, so SQL may admit an extra row but never drops one
    the view keeps; a filter on a field the caller cannot read behaves as if
    the field were absent, as before.
  - The audit chronology pages by sequence through a new `listChronology`;
    `exportChronology` reads page by page with its old signature, so AAR
    composition is unchanged.
  - The notification inbox pages by `(created_at, id)`, and the text-cast
    incident join is replaced by a typed `notifications.incident_id` column.
  - The web client's `boardView` takes a cursor and limit and returns
    `nextCursor`; a new `notificationPage` returns a page and its cursor. The
    operational table in `web/src/design/table.tsx` gains an optional load-more
    control with loading and error states, wired in the board surface.
  - New shared `server/src/db/cursor.ts`. Timestamps are bound as text so the
    driver cannot truncate microseconds through a JavaScript `Date`.
- **Defaults and deviations.** A BEFORE INSERT trigger fills
  `notifications.incident_id` from `detail.incidentId`, so every writer is
  covered without editing each insert; the column has no foreign key, so a
  stray id cannot fail a write. A view sorted by a calculated field is ordered
  within a page only, and a filter on a calculated field is decided in memory,
  so such a page can come back short while a cursor walk still returns every
  match. Ownership deviations: the cursor and limit parameters on the view
  route in `server/src/boards/routes.ts`, about fifteen lines in
  `BoardSurface.tsx` and `BoardView.tsx`, and the new cursor helper. No
  chronology client method was added; the audit screen in W3.1 adds it with its
  caller.
- **Schema:** migration `0104_list_pagination.sql` replaces
  `board_records_board` with `board_records_board_page (board_id, created_at
  desc, id desc)`, adds `notifications_page`, and adds
  `notifications.incident_id` with a backfill, a partial index and the trigger.
- **Contract:** no new routes. The chronology response changes from
  `{ entries }` to `{ entries, nextCursor }`; the view and notification
  responses gain `nextCursor`. No dependency change.
- **Acceptance:** in `load.test.ts`, the first page of an unfiltered view over
  50,000 records returned in 7 ms and a filtered view in 20 ms, against the
  300 ms bound.
- **Verification:** new `list-pagination.test.ts`, 7 tests: full cursor walks
  over rows whose timestamps differ only in microseconds, filtered views
  returning full pages, sorted views both directions, `in`, calculated and
  unreadable-field filters, malformed cursor and oversized page refused with
  400, chronology and inbox walks, and the typed incident join. In the lane,
  18 neighbouring server suites passed 82 of 82, seven web files 52 of 52,
  and `boards-workspace-browser.test.ts` 1 of 1. After rebasing onto the
  observability and MFA changes: list-pagination, boards, notify, audit,
  delivery-outbox, mfa, api-docs, ipaws and the web client, table and auth
  tests passed 91 of 91. TypeScript and ESLint clean.
- **Evidence level:** unit, real-database and browser.
- **Not finished here, carried to W2.11.** Gate line 5 requires every list
  endpoint paginated. These lists can grow without bound in an activation and
  live outside this unit's files: messages and threads, CAP alerts, damage
  reports, sitreps, IAPs and revisions, resource requests, AAR observations
  and corrective actions, staffing check-ins, tracking events, operational
  relationships and incident tasks. Feed items and OGC items are capped at
  1,000 but have no cursor. Also carried: the existing cursors in
  `files/service.ts` and `dashboards/service.ts` pass `created_at` through a
  JavaScript `Date` and can skip rows written in the same millisecond; and the
  relationship picker in `AssessmentRelationships.tsx` now sees only the
  newest 100 records per board. Deliberately unpaginated because they stay
  small: template versions, boards per jurisdiction, positions, forms,
  incident boards, positions and libraries, facilities, feeds, dashboards, and
  a single record's history.
- **Rollback:** revert the commit; undoing the schema means dropping the
  trigger, function, column and two indexes and recreating
  `board_records_board`.

## V1 W2.2: scheduler

- **What changed.** New `server/src/scheduler/scheduler.ts`: one in-process
  scheduler per API process. The process holding a PostgreSQL session advisory
  lock leads and runs four jobs: scheduled notification rules, due briefings,
  feed polls and the outbox worker. Others retry the lock on an interval and
  take over when the leader stops or its session ends. Each job runs on
  election, then waits its interval after each run, so a job never overlaps
  itself; a failing job is logged as `scheduled job failed` with its name and
  never stops the others or the process. Timers are unref'd and `stop()` waits
  for runs in flight. The trigger endpoints are unchanged.
- **Both deploy paths.** `server/src/main.ts` (the container path) and the
  Windows desktop `serveProfile` both start and stop the scheduler, which
  closes the gap carried from the W2.8 receipt: the desktop path ran no
  delivery worker. Ownership deviation: `deploy/windows/desktop.mjs`.
- **Defaults and deviations.**
  - All four jobs run on the leader only, including the outbox, for simplicity.
  - The lock is held on its own one-connection client rather than a reserved
    pool connection: a reserved postgres.js connection that drops returns to
    the pool, and the stale handle could then run on another session. The
    leader checks every `OPENEOC_SCHEDULER_LEADER_MS` (default 10000) that
    `pg_backend_pid()` still matches the session that took the lock and steps
    down if not. Cost: one database connection per process.
  - Acting identity: new SECURITY DEFINER `scheduler_due(work, due_at)`
    returns, per jurisdiction with due rules or briefings, one enabled admin,
    preferring the due item's author, and the work runs under that admin's
    principal with row-level security on. Deviation from an author-only rule:
    briefing runs require an admin, and members schedule briefings, so an
    author-only rule would never fire them. A jurisdiction with no enabled
    admin runs none of this work. Feeds still run under each feed's creator.
  - Briefings are scheduled only when `OPENEOC_INTEGRATIONS` includes
    `meetings`.
  - Intervals from `OPENEOC_SCHEDULER_{RULES,BRIEFINGS,FEEDS,OUTBOX}_MS`,
    defaults 30000, 60000, 60000 and 2000; an invalid value fails at startup.
  - Metrics gain `openeoc_scheduler_leader` and
    `openeoc_scheduler_last_run_seconds{job}`. Ownership deviation:
    `server/src/telemetry/metrics.ts`.
  - Integration cleanup: the delivery worker's own polling loop,
    `DeliveryWorker.start()` and `stop()`, had no callers once the scheduler
    ran the outbox, and was removed.
- **Schema:** migration `0107_scheduler.sql`, one function granted only to
  `app_runtime`. No routes, no contract change, no dependency change.
- **Acceptance:** `scheduler.test.ts` fires a scheduled rule to a local
  receiver, a member's briefing and a feed poll with no manual call, and checks
  the rule fired exactly once and the leader metric.
- **Verification:** `scheduler.test.ts` 3 tests: the acceptance; two
  schedulers where exactly one leads and the other takes over when it stops;
  a job made to fail (its function revoked) that is logged while the outbox
  still delivers. After rebasing onto W2.3 and W2.10: scheduler, notify,
  delivery-outbox, observability, feeds and meetings passed 33 of 33.
  `pnpm test:desktop` 19 passed. TypeScript and ESLint clean. The desktop
  path was checked by loading the module, not by running a profile.
- **Guides:** `deploy/README.md` and `docs/guides/ADMIN.md` describe the
  intervals and the single leader.
- **Evidence level:** real-database integration and document.
- **Known limit:** `runDueBriefings` reads and stamps due briefings in
  separate steps, so a leader handover overlapping a run could notify a
  briefing twice. Rare; not addressed here.
- **Rollback:** revert the commit; migration 0107 adds one function only.

## V1 W2.5: rate limiting and identity caching

- **What changed.**
  - Login backoff in `server/src/auth/rate-limit.ts`: failures for a key are
    forgotten fifteen minutes after the last one, and the table is capped at
    10,000 keys, dropping forgotten keys first and then the stalest. The lock
    rule is unchanged, five failures lock for thirty seconds. MFA still uses it
    keyed by person.
  - The flood limiter in `server/src/security/rate-limit.ts` only swept expired
    windows and could grow without bound; it is capped at 20,000 client keys,
    oldest first. One shared `prune` helper serves both limiters and the cache.
  - `trustProxy` comes from `OPENEOC_TRUST_PROXY` or a build option: unset or
    `false` trusts no proxy, `true` trusts every peer, otherwise a comma list
    of addresses or CIDRs. Off by default.
  - New `server/src/auth/principal-cache.ts`: a per-process cache keyed by the
    access-token hash, never the raw token, TTL `OPENEOC_PRINCIPAL_CACHE_MS`
    (default 5000, `0` disables), at most 10,000 entries, never past the
    session's access expiry or the earliest guest grant it carries, with a
    generation counter so a load that overlapped an invalidation is not stored.
    Logout, resume and position sign-in and sign-out drop the session's entry;
    provisioning, guest grant create and revoke, and `addMembership` drop the
    person's entries. WebSocket paths keep the uncached lookup.
- **Decision default applied:** section 7 item 4, single node declared and the
  shared store a 1.x item. The Postgres-backed limiter was not built. The
  declaration is in `deploy/README.md` ("One application node", "Behind a
  reverse proxy") and in `docs/SECURITY-CONTINUITY.md`.
- **Deviations, recorded.** No hop-count trust setting: Fastify 5 treats a
  number as trusting nothing. No v1 route demotes a role or disables a person;
  those are SQL operations and take effect within the cache TTL, which is what
  the test shows. Row-level security still reads the database on every query,
  so database-side checks are never stale. Position assign and reassign do not
  invalidate, because the cached principal holds no assignments.
  `revokeGuestGrant` now returns the grantee id for invalidation.
- **Defect fixed on the way.** A refused `/api/v1/me` request crashed the `/me`
  response hook on an undefined principal, so the 401 body carried a
  TypeError message instead of the real error.
- **Integration fixes.** The declaration's text predated the scheduler and
  said no leader election existed; it now names the advisory-lock election.
  `deploy/docker-compose.yml` passes `OPENEOC_TRUST_PROXY` through. The OIDC
  pending-login map in `server/src/auth/oidc.ts` was pruned by age but had no
  size cap, the same unbounded-growth defect this unit closes, and is now
  capped at 10,000 through the shared helper.
- **Schema, contract, dependencies:** none.
- **Verification:** new `identity-cache.test.ts`, 11 tests: backoff
  forgetting, both limiter caps, cache hit, TTL expiry, session-expiry cap,
  sign-out, position sign-in and sign-out, role granted immediately, demotion
  after the TTL, guest grant and revoke, trusted and untrusted proxy, and the
  invalidation race guard. In the lane, 15 suites passed 106 of 106. After
  rebasing onto W2.2, W2.3 and W2.10 and the integration fixes:
  identity-cache, auth, authz, security, oidc, mfa, observability, scheduler,
  api-docs, ipaws, federation, boards, list-pagination and
  incident-participation passed 100 of 100. TypeScript and ESLint clean. Link
  checker 69 files. The full milestone suite runs at the wave gate.
- **Evidence level:** unit, real-database integration and document.
- **Carried forward:** an admin route added later that changes roles, the
  disabled flag or grants must call `forgetPerson` or `forgetSession` after
  its transaction commits; the module comment says so. W3.0 is the unit that
  adds those routes.
- **Rollback:** revert the commit; `OPENEOC_PRINCIPAL_CACHE_MS=0` turns the
  cache off at runtime.

## V1 W2.9: retention and export

- **Decision default set and applied.** Section 7 item 5 names the retention
  and HIPAA question without a default; the integrating session set this one.
  Nothing is purged until a jurisdiction admin sets a period for a data
  class. The audit trail, `audit_events` and every table with an append-only
  trigger, is never purged, only exported. Incident records are not purged,
  closed incidents included, because records retention law varies. Tracking
  and facilities are not treated as holding patient-level data in v1.
- **Retention policies.** New `retention_policies`: one row per jurisdiction
  per data class, 1 to 36,500 days or null to keep. `GET` and
  `PUT /api/v1/jurisdictions/:jurisdictionId/retention`, admin only; each
  change records `retention.policy.updated`.
- **Purge.** A new hourly scheduler job calls `retention_purge(batch)`, a
  SECURITY DEFINER function with an explicit table allowlist per class:
  settled notifications with their delivery rows; delivered or dead delivery
  rows and peer-received federation entries; feed items not fetched within the
  period; tracked objects and their events once the latest event is older than
  the period; closed staff check-ins. At most 5,000 rows per class per
  jurisdiction per run. A test asserts no allowlisted table carries a delete
  trigger, with `audit_events` as the positive control.
- **Audit export.** `GET /api/v1/jurisdictions/:jurisdictionId/audit/export`,
  admin only, paged by the chronology cursor. CSV per RFC 4180 with a header on
  every page, the next cursor in `x-next-cursor`, and a leading quote on cells
  starting with `=`, `+`, `-`, `@`, tab or carriage return. Signed JSON
  returns the page with `firstSeq`, `lastSeq`, its cursor and `nextCursor`,
  and an HMAC-SHA256 over the RFC 8785 canonical form, keyed by HKDF from
  `OPENEOC_SECRET_KEY` under a distinct label so it is never the envelope key;
  409 without a key. Chronology entries gain id, person, position, incident
  and subject fields; the AAR reads only `line` and is unchanged.
- **Syslog forwarding.** Optional through `OPENEOC_SYSLOG_URL`, UDP or TCP,
  RFC 5424 messages, TCP framed by octet count, standard library only. A
  scheduler job every ten seconds forwards after a high-water mark that moves
  only after a successful send. The write path never awaits the network.
- **Deviations, recorded.**
  1. One `retention.purged` audit event per jurisdiction per run, and only
     when something was deleted, so empty hourly runs do not clutter the
     chronology the AAR is built from.
  2. `audit_events` gains an `xact xid8` column and index, added nullable with
     the default set afterwards so existing rows are not rewritten.
     Forwarding walks events in (transaction, sequence) order and never past
     the oldest transaction still running; a mark on sequence alone would skip
     an event whose transaction commits after a later-numbered one.
  3. The retention routes are registered in `server/src/audit/routes.ts`;
     `server/src/retention/` holds the service.
  4. Forwarding starts at the job's first run; earlier history is available
     through the export. UDP messages are cut at 8 KiB.
  5. Ownership deviations: `server/src/scheduler/scheduler.ts` (two jobs),
     `docs/guides/ADMIN.md`, `deploy/README.md`.
- **Schema:** migration `0110_retention.sql`: `retention_policies`,
  `audit_forwarding` (reached only through functions),
  `delivery_outbox_notification` index, `audit_events.xact`, and three
  functions granted only to `app_runtime`. Three routes added to the contract;
  `docs/API.md` regenerated. No dependency change.
- **Verification:** new `retention.test.ts`, 10 tests covering policy access
  and validation, the delete-trigger check, purge scope by class,
  jurisdiction and age, the purge audit counts, open check-ins kept, CSV walk
  and formula guard, signature verify and tamper, the 409, UDP once-only
  forwarding, TCP framing, and scheduler wiring. After rebasing onto W2.5:
  retention, audit, aar, scheduler, observability, api-docs, ipaws,
  identity-cache, list-pagination, migrate-baseline and security passed 74 of
  74. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, integration, real-database and document.
- **Deferred:** the admin screen for retention and export belongs to W3.0 and
  W3.1. Purged rows are counted in the audit event, not archived.
- **Rollback:** revert the commit and drop the three functions, two tables,
  the new index, and the `audit_events.xact` index and column.

## V1 W2.7: threat-model controls

- **B7, webhook allowlist.** Each jurisdiction has an allowlist of outbound
  destinations, new `server/src/notify/allowlist.ts`, managed by admin-only
  `GET` and `PUT /api/v1/jurisdictions/:jurisdictionId/notification-allowlist`
  and audited as `notification.allowlist_updated`. It is enforced when a rule
  is created (an unlisted URL answers 422) and again by the delivery worker
  before every send: a queued delivery whose destination was removed is
  dead-lettered with a clear error and never contacted. A host admitted only
  by a `*.suffix` entry must resolve to public addresses; loopback, private
  and link-local targets need an exact-origin entry. The worker no longer
  follows redirects.
- **B7, per-rule rate caps.** Each rule caps its queued deliveries, default 60
  per ten minutes, configurable up to 600 per 1,440 minutes. Excess is counted
  on one `suppressed` notification per rule and window, visible to admins in
  the notification list, never dropped silently. In-app notices are not
  capped.
- **B9, two-person IPAWS send.** Every send to IPAWS-OPEN is a pending request
  that a different admin must confirm within fifteen minutes; it can be
  cancelled and expires. The audit records `ipaws.send.requested`,
  `ipaws.send.confirmed`, `ipaws.send.cancelled` and `ipaws.submitted` with
  both identities, and a check constraint in the database refuses a
  same-person confirmation.
- **B5** is marked not applicable in `docs/THREAT-MODEL.md`, citing ADR-0004 as
  restated by the documentation truth pass.
- **Defaults applied.** An empty allowlist denies every external webhook and
  push. Entries are an https origin, a `*.host` suffix with at least two
  labels, or an http origin only for a loopback host. An exact-origin entry
  counts as naming a private host explicitly. DNS is checked at send time;
  rule creation checks list membership.
- **Deviations, recorded.** The two-person rule covers every send through the
  HTTP transport, including the test-environment handshake, not only enabled
  live sends: otherwise one admin could label a real endpoint `test` and send
  alone. Only an injected fixture transport still sends single-handed, and it
  refuses the HTTP transport. `POST /cap/alerts/:alertId/ipaws` and
  `POST /ipaws/test` now answer 202 with a pending request; no web client
  calls either route yet.
- **Residual risk, stated.** `fetch` resolves the host again after the address
  check, so a DNS rebinding window remains for a suffix-admitted host whose
  DNS an attacker controls. Closing it means pinning the checked address in
  the HTTP dispatcher; it is marked in the code and left for a later unit.
  Concurrent transactions can exceed a rate cap slightly. Federation peer
  endpoints are governed by B3, not this allowlist.
- **Schema:** migration `0112_outbound_controls.sql`:
  `notification_allowlists` with row-level security; rule rate-cap columns
  with range checks; `delivery_outbox.rule_id` backfilled and indexed;
  `suppressed` added to the notification statuses; SECURITY DEFINER
  `admit_rule_delivery`; `claim_deliveries` recreated to return the
  jurisdiction's allowlist; `ipaws_send_requests` with row-level security and
  the second-person constraint.
- **Contract:** five routes added, the allowlist pair and the IPAWS send
  list, confirm and cancel; `docs/API.md` regenerated. No dependency change;
  the address check uses Node's `net.BlockList` and `dns/promises`.
- **Tests updated:** notify, ipaws, delivery-outbox, observability and
  scheduler now configure the allowlist before creating webhook rules.
- **Verification:** in the lane, 11 suites passed 74 of 74. After rebasing onto
  W2.9: notify, ipaws, delivery-outbox, observability, scheduler, retention,
  alerts, cap, api-docs, security, list-pagination, identity-cache,
  workflow-runtime and alerts-workspace-browser passed 97 of 98. The one red
  was `ipaws.test.ts` "refuses to transmit while configured but not enabled",
  a 30 second timeout: the test creates a second fresh database inside its
  body, which waits on the cluster-wide setup lock while other lanes were
  creating databases. Per HZ-C it was retried in isolation and passed 20 of
  20, twice. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, real-database integration and document.
- **Deferred:** the allowlist screen and the IPAWS confirmation screen belong
  to W3.0 and W3.5.
- **Rollback:** revert the code; the 0112 schema is additive and the prior
  code runs against it.

## V1 W2.11: remaining list pagination

- **Why this unit exists.** W2.3 deferred every unbounded list outside its
  files, and gate line 5 requires every list endpoint paginated. The unit is
  added to the roster's W2 table in this commit with the next free number.
- **What changed.** These lists page by cursor through the shared helper,
  keeping their array key and adding `nextCursor`, default 100 and maximum
  500: threads; messages by sequence, where `after` still works and gains a
  limit; CAP alerts; damage reports; sitreps; the IAP workspace, whose summary
  and facets still count the whole filtered set; IAP revisions; resource
  requests; AAR observations; corrective actions; staffing check-ins, with
  vacancies now decided in SQL over every open check-in; the tracking custody
  chain; operational relationships, where the rule hiding an IAP-objective
  link the caller cannot read moved into SQL so pages stay full; and incident
  tasks, whose analytics still count every match. Feed items gain a cursor at
  their existing 1,000 page; OGC items gain an OGC API Features `next` link at
  their existing limits. The file and dashboard-contribution cursors use the
  shared helper with microsecond timestamps bound as text.
- **Callers.** Exports, the AAR analytics and composition, the thread export
  and the server-side IAP list read every page. The web client's pickers and
  lookups that need the whole set read every page, so none silently loses rows;
  the relationship picker reads the board view to the end instead of gaining a
  search, because it is a plain select with no text input. The Tasks table
  gains "Load more".
- **Deviations, recorded.** Screens left on the first page: the Messages
  thread list, the Alerts CAP list whose filters run in the browser over that
  page, the Sitrep archive, the IAP workspace and revision lists, and the map
  layers at their prior caps. Their load-more controls go to those surfaces'
  owners in W3. Client methods whose screens stay on the first page did not
  gain cursor parameters no caller would pass. `nextCursor` is optional on the
  shared task and IAP workspace response types. A non-integer `after` now
  answers 400 instead of failing with 500, and file and dashboard cursors
  issued before the upgrade answer 400 and the client restarts from the first
  page. Ownership deviations: `server/src/export/service.ts`, two shared
  contract types, and the relationships browser test, whose waits now match
  the path because the client adds `limit`.
- **Left unpaginated with reasons:** the AAR analytics route, which is its
  summary's input; reunification search, capped at 25 rows; vacant positions
  and upcoming shifts, capped at 50; the thread export, a complete record by
  design; and the small lists W2.3 named.
- **Schema:** migration `0109_list_pagination.sql` adds (sort key, id)
  indexes for thirteen lists and drops seven indexes they supersede.
- **Contract:** no new routes; responses gain `nextCursor` and OGC items
  gain `links`. No dependency change.
- **Verification:** new `list-pagination-operational.test.ts`, 37 tests: 18
  cursor walks over rows whose sort timestamps differ by microseconds, 18
  refusals of a malformed cursor and an oversized limit, and the legacy
  `after`. In the lane: 30 neighbouring server suites in two batches, 81 of 81
  and 133 of 133; 14 web files 90 of 90; `tasks-browser` 1 of 1;
  `operational-relationships-browser` 1 of 1 after its wait fix. Run as one
  30-file batch, ipaws and resource timed out under load and passed alone,
  per HZ-C. After rebasing onto W2.2 through W2.9 and W2.7, two batches
  passed 103 of 103 and 207 of 207, the second including every web app test.
  TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, real-database and browser.
- **Known limit:** a cursor walk over feed items that overlaps a poll can miss
  or repeat an item the poll re-fetched, because the list sorts by fetch time.
- **Rollback:** revert the commit, drop the new indexes and recreate the
  seven dropped ones.

## V1 W2.4: WebSocket discipline

- **What changed.** New `server/src/sync/sockets.ts` applies to every
  WebSocket the server accepts, board sync, dashboard stream and notification
  stream alike: a socket that sends no frame within ten seconds closes with
  1008; a ping every thirty seconds, and a peer that has not answered by the
  next ping is terminated; a send while the peer's queued bytes exceed the
  ceiling closes the socket with 1013 instead of buffering. `@fastify/websocket`
  is registered with a 1 MiB `maxPayload`, closing larger frames with 1009, and
  the sync schema caps the base64 update at 1 MiB less 1 KiB so an update and
  its envelope fit one frame. A peer update is now encoded once per broadcast
  rather than once per socket; with 150 subscribers a 128 KiB broadcast fell
  from about 131 ms to 71 ms.
- **Notification push.** New channel `/api/v1/notifications/stream`. Migration
  `0111_notification_push.sql` adds a trigger that announces each inserted or
  updated notification id on commit through `pg_notify`, and a SECURITY
  DEFINER `notification_audience(uuid[])` mirroring the read policy. The
  server holds one LISTEN connection, opened by the first subscriber, and
  sends a content-free `changed` signal only to sockets whose person may read
  the row, throttled to one a second with a quiet-period change sent at once.
  If the audience lookup fails or the LISTEN connection reconnects, every
  socket is signalled and the client's RLS-filtered refetch decides. In the
  web client `useNotifications` replaces the eight second poll in the console
  and the alerts surface; it refetches on `ready` and `changed`, and while the
  socket is down refetches when visible and reconnects with backoff capped at
  sixty seconds. The shell reads "Live" while subscribed and keeps data during
  a refetch.
- **Defect found and fixed.** When several clients opened a board with no
  loaded document, each open built its own copy and the last replaced the
  others, so clients subscribed to a replaced copy never saw another update.
  The first copy installed now wins and later opens adopt it. The new
  `sync-hub-lifecycle` regression test failed three of three runs before the
  fix and passes after. Ownership deviation: `server/src/sync/hub.ts`.
- **Deviations, recorded.** The roster says "over the existing socket"; a new
  channel was added because the web client holds no long-lived socket, field
  sync opening one per flush. The auth deadline is "first frame within ten
  seconds", which covers every protocol because each one's first frame is its
  auth frame. The backpressure ceiling is 16 MiB rather than a lower figure,
  because the board state frame on connect can be several MiB. The limits are
  set through `BuildAppOptions.socketLimits`, not the environment. Ownership
  deviations: three lines in `AlertsSurface.tsx` and its test mock, and the
  load, browser and lifecycle tests.
- **Contract:** `GET /api/v1/notifications/stream` added to the routes and the
  WebSocket list; `docs/API.md` regenerated. No dependency change.
- **Acceptance:** in `load.test.ts`, serial, 150 subscribers plus one writer:
  every update reached all 149 live readers under 100 ms, asserted on the
  maximum; edits p95 20.9 ms and maximum 22.1 ms, 32 KiB bulk updates p95
  23.0 ms and maximum 25.8 ms. The stalled reader was closed with 1013.
- **Verification.** New `sockets.test.ts`, 5 tests: auth deadline, 1 MiB
  frame, schema bound, heartbeat, notification push to only the right sockets
  including silence on rollback, and a bad token. In the lane the first full
  `load.test.ts` run was red, the fan-out timing out at 120 seconds, which is
  how the hub race was found; a 13-file batch at default workers was red with
  three load timeouts on the shared database, and those files passed 24 of 24
  alone. After rebasing onto W2.7 and W2.11: 15 server suites and all web app
  tests at four workers passed 254 of 254; `load.test.ts` and
  `alerts-workspace-browser.test.ts` serial passed 5 of 5. TypeScript and
  ESLint clean. Link checker 69 files.
- **Guide:** `docs/SECURITY-CONTINUITY.md` states the socket limits.
- **Evidence level:** unit, real-database integration and browser.
- **Limits:** a notification socket keeps its principal for its life, as
  board sync does, so after logout it can receive content-free signals until
  it closes. The LISTEN connection would not work behind a transaction-mode
  pooler, which neither deploy path uses. With the alerts surface open a user
  holds two notification sockets. Other polls remain for W5.1.
- **Rollback:** revert the commit, then drop the trigger and the two
  functions from migration 0111.

## V1 W3.5: IPAWS enablement and send

- **What changed.** The alerts surface gives IPAWS an operator screen, in new
  `web/src/ipaws/**`.
  - Every member sees, under the heading, where a confirmed send would go and
    whether IPAWS is on: not configured, fixture endpoint (not FEMA), test
    environment, production disabled, or live production.
  - Admins get an IPAWS tab for the COG id, endpoint, environment and
    credential. The credential is a password field cleared once saved; only
    the stored fingerprint shows afterwards. The tab records the MOA
    acknowledgement and holds the enable toggle, unavailable until a
    credential and the MOA are recorded.
  - An approved, IPAWS-eligible local alert offers "Request IPAWS send", or
    "Request test handshake" while a test configuration is not yet enabled;
    either creates a pending two-person request.
  - The send requests list shows headline, requester and a countdown, with
    Confirm and Cancel; Confirm is disabled on the requester's own request
    with a note saying why. Outcomes show as accepted or rejected with the
    reason, submitted, expired or cancelled.
  - Nine client methods were added in one block.
- **Defaults applied.** The API carries no fixture flag, so any endpoint that
  is not https on a `*.fema.gov` or `*.integratedpublicalertsystem.gov` host is
  labelled "Fixture endpoint, not FEMA" whatever environment it claims.
  Requester names and IPAWS answers come from one chronology page of up to 500
  events covering the ten requests shown; past that, names fall back to
  "Another admin" and outcomes to "Submitted", marked in the code. Only alerts
  with an approved local review get the request action; an alert created with
  status Actual through the API has no review state and gets none, which keeps
  every IPAWS send behind a review. The dictionary has no IPAWS entries, so the
  labels sit beside the components.
- **Ownership deviations:** one line in `Console.tsx` passing the existing
  admin and person props to the surface; one CSS property in
  `web/src/notifications/notifications.css` so the tab row no longer clips on
  narrow screens; IPAWS stubs in the alerts surface test's mock client.
- **Integration.** Rebased onto W2.4, which had replaced the alerts surface's
  notification poll with the push hook; the conflict was resolved keeping the
  push hook and the new admin and person props. A fixture fingerprint in a
  unit test tripped the secret scan's entropy rule and was replaced with a
  plain placeholder.
- **Schema, contract, dependencies:** none. No server code changed; the
  browser test points the configured endpoint at a loopback server answering
  with the recorded `postcap-accepted.xml`, the pattern the server tests use.
- **Browser walk.** Admin A configures a test COG against the loopback
  fixture, acknowledges the MOA, enables, approves the seeded eligible alert
  and requests the send; A sees Confirm disabled. Admin B signs in, sees the
  requester and countdown, and confirms. Both see "Accepted by IPAWS-OPEN".
  The fixture endpoint takes 0 hits before confirmation and 1 after, no
  browser request leaves the machine, the credential never appears in the
  page, and the audit rows carry both identities. Six screenshots: wide
  light, narrow light, wide dark and narrow dark.
- **Verification:** in the lane, 9 files passed 78 of 78. After the rebase:
  `ipaws-send-browser`, `alerts-workspace-browser`, alerts, cap, ipaws, the
  IPAWS web tests, the alerts surface, client and notification stream tests
  passed 77 of 77. TypeScript and ESLint clean.
- **Evidence level:** unit, integration, browser and real-database.
- **Boundary kept:** no live send until Basho supplies IPAWS-OPEN credentials
  and the MOA; the guide says so. R2 closes to the edge of that external
  gate. `docs/FACET-STATUS.md` row R2 is reconciled in `86+D35`.
- **Guide:** `docs/IPAWS-ENABLEMENT.md` walks configuration, MOA, enable and
  the two-person send on the screen.
- **Rollback:** revert the commit; no schema is involved.

## V1 W3.0: administration

- **What changed.** A new Administration screen in the shell, under Data and
  administration, in `web/src/admin/**` and `AdminSurface.tsx`, with five
  tabs:
  - People: create an account, add an existing account, change role, disable
    or enable sign-in, see and reset two-step sign-in with a recorded reason,
    remove a member; the kit table loads more by cursor.
  - Positions: add a position; assign, reassign and revoke holders.
  - Guest access: grant with scopes and an end time, revoke; ended grants stay
    listed.
  - Records: retention periods per data class; audit download as CSV or
    signed JSON, verified by the guide's own script in the browser test.
  - Deployment: which optional integrations are enabled and the variable that
    controls them, read-only, answering gate line 21's visibility; provisioning
    for instance administrators.
  The navigation entry is hidden unless the account administers something, and
  the server refuses every route to anyone else.
- **Defaults applied.** A role change or removal never leaves a jurisdiction
  without an admin (409 under a per-jurisdiction lock). Removing a member ends
  their position assignments there. Disabling an account or resetting its
  second factor affects the person everywhere, so a jurisdiction admin may do
  it only when they administer every jurisdiction the person belongs to; an
  instance admin may do it for anyone; nobody may do it to their own account.
- **Deviation: engine code.** The W3 rule is "no new engine code except client
  methods", but most admin tasks in the guide had no route and could only be
  done in SQL. Ten routes and migration `0113_administration.sql` were added,
  allowed for that case: person lookup by email; the paged member list;
  member role, removal, disabled flag and second-factor reset; the paged guest
  list; the position holder list; assignment revoke; and the integration
  state. Every one that changes a role, membership or the disabled flag calls
  `forgetPerson` after its transaction commits. `POST /api/v1/persons` now
  records `membership.added`. The integration route lives in `app.ts` because
  the integration set is built there.
- **Integration fixes: attribution and effect.** Two existing gaps surfaced in
  review and were closed in this commit, because INV-2 requires every mutation
  to carry an attributed audit event and a revoked holder should stop acting
  at once.
  - Guest grant create and revoke, position assign, reassign and revoke were
    not audited. They now record `guest.granted`, `guest.revoked`,
    `position.assigned`, `position.reassigned` with the former holders, and
    `position.revoked`. Two audit tests that counted every event in their
    jurisdiction now scope to board records, and the chronology test now
    expects the setup's position assignment as the first attributed event,
    which is the correct record.
  - Revoking or reassigning a position left the former holder signed into it
    until their own sign-out. New SECURITY DEFINER
    `end_position_signins(position, person)` in 0113, which checks that the
    caller administers the position's jurisdiction, closes the holder's open
    position sign-ins and clears the position from their live sessions; the
    routes then drop that person's cached principal.
- **Schema:** 0113 adds membership update and delete policies, the delete grant
  on `jurisdiction_memberships`, and five SECURITY DEFINER functions granted
  only to `app_runtime`. Contract: ten routes and three tag aliases;
  `docs/API.md` regenerated. No dependency change.
- **Verification.** `admin.test.ts` 11 tests, including the new one: a member
  signed into a position loses it when the position is reassigned, the
  incoming holder loses it when revoked, no position sign-in stays open, and
  the five categories are recorded in order. `admin-browser.test.ts` 2 tests:
  the full admin walk with six screenshots (1440 light and dark, 390), and a
  member who does not see the entry. After rebasing onto W2.4, W2.7, W2.11
  and W3.5: all 25 server suites that read audit events or the chronology
  passed 215 of 215; the admin browser walk, api-docs, ipaws and every web test
  passed 449 of 449. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred:** the position picker reads one page of up to 500 members; guest
  board scopes offer the boards the console lists; the kit table's row
  checkbox names a UUID in its accessible label, for A11Y-T1. An instance
  admin with no membership cannot reach the console; bootstrap makes the first
  instance admin an admin of the first jurisdiction.
- **Guide:** `docs/guides/ADMIN.md` points every admin task at the screen,
  keeping `curl` only for bootstrap.
- **Rollback:** revert the commit, drop the five functions and two policies
  from 0113 and revoke the delete grant.

## V1 W3.1: audit chronology

- **What changed.** A Chronology screen under Situation, in new
  `web/src/audit/**`, follows the selected incident or covers the whole
  jurisdiction when none is selected. Tabs switch between "Significant events",
  the default, and "All events"; an event type selector and From and To times
  filter on the server. Each entry shows its time, a plain event name, who
  recorded it under which position, a short detail and its event number.
  "Load more records" pages through the operational table. "Add correction"
  records a note through the existing corrections route and the correction
  appears as a new attributed entry reading "Corrects event N". Jurisdiction
  admins see "Export CSV" and "Export signed JSON". Three client methods, one
  Surface kind and one navigation entry.
- **Defaults applied.** The significant set: incident activated, closed and
  area revised; resource request submitted, status changed, escalated and
  escalation received; the four IPAWS send events; IAP submitted, approved and
  completed; JIC release published; SITREP composed; facility status reported;
  and corrections. CAP authoring is local and excluded; the audit trail has no
  category for lifeline status or EOC activation level, so none is listed.
  Category labels live beside the screen, not in the doctrinal dictionary, with
  unknown keys humanized. Export covers the whole jurisdiction trail, because
  the export route takes no filters; the client reads every page and writes
  one CSV with a single header row, or a JSON array of the signed pages.
- **Deviations, recorded.** The chronology route gains `incidentId` and
  `category` query parameters, no new route. `requestBlob` in the client now
  calls a private `requestResponse` with the same session renewal, because CSV
  export needs the `x-next-cursor` header.
- **Integration fix: corrections by viewers.** The lane found that
  `correctAudit` had no role check and the insert policy counts viewers as
  members, so a viewer could record a correction. A correction amends the
  record, so it now requires a writer, admin or member; a new audit test shows
  a viewer refused with 403. The screen shows the correction action to every
  reader and displays the server's refusal.
- **Schema, contract, dependencies:** none; `docs/API.md` unchanged.
- **Verification.** In the lane, 10 files passed 80 of 80, including
  `chronology-browser.test.ts`: significant events for a seeded incident, the
  type filter, All events 100 rows then Load more to the full count, a
  correction shown as "Admin (Operations Section Chief)" with "Corrects event
  N", and a CSV with one header row containing the correction. After rebasing
  onto W3.0 and W3.5, with the viewer fix: audit, retention, aar, api-docs,
  the chronology, admin and IPAWS browser walks, and every web test passed 461
  of 461. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Known limits.** Entries on the Significant Events board are board records
  sharing one category and appear under All events only; the guide says so.
  The existing `positionId` filter is not on the screen. The chronology has no
  index on incident or category, so a sparse filter over a very large trail
  scans the jurisdiction's sequence index. Export holds the trail in browser
  memory.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md` describes the screen,
  significant events, corrections and export.
- **Rollback:** revert the commit.

## V1 W3.7: workflow runtime in the record detail

- **What changed.** The four workflow routes had no web client. They now have
  `recordWorkflow`, `requestWorkflowTransition`, `approveWorkflowTransition`
  and `escalateWorkflow`, and the board record detail in `BoardSurface.tsx`
  gains a Workflow section, new `web/src/boards/workflow.ts` and
  `RecordWorkflow.tsx`: the current state with "final" for a terminal state;
  the assignee; the due time with Overdue, On time or Due time missing; buttons
  for the transitions leaving the current state, with an assignee picker when
  a transition assigns work; pending approvals with counts, approvers and an
  Approve button per rule; the escalation schedule with Escalate once an
  occurrence is due; and the append-only history with no edit controls.
  Command buttons appear only for board writers; the server decides every
  command and its refusal message is shown.
- **Defaults applied.** The definition is read from the template version the
  record's workflow is pinned to; a board with no workflow shows no section
  and makes no request. The server does not say which transitions an actor may
  take, so every transition leaving the current state is shown and the server
  refuses what the actor may not do. Escalation timing uses the shared
  `workflowEscalationAt`. Each click sends a fresh idempotency key.
- **Deviations from the roster wording.** No reject action and no free-text
  history note: the engine has neither, and the unit allows no engine code.
  History "who" falls back to `Person` and a short id for anyone the shell
  does not already know, because the history route returns ids only. Labels
  come from the template's workflow definition; the dictionary has none.
- **Schema, contract, dependencies:** none.
- **Browser walk.** A member requests "Release to operations"; the member's
  self-approval is refused with the server's message; the admin approves and
  the record moves to "Released to operations"; a seeded past-due record shows
  Overdue; the due escalation is processed; the history lists 4 entries with
  no controls and the database holds 4 history rows. Three screenshots, wide
  light, wide dark and narrow dark, with no horizontal overflow narrow.
- **Verification.** In the lane, 13 files passed 115 of 115. After rebasing
  onto W3.0, W3.1 and W3.5, resolving additive conflicts in the client imports
  and the operator guide: the workflow and boards workspace browser walks,
  board-workflow, boards, list-pagination and every web test passed 460 with
  0 failed; `workflow-runtime.test.ts` reported its six tests pending in that
  combined run, the file not completing under load, and passed 6 of 6 alone
  per HZ-C. TypeScript and ESLint clean. Link checker 69 files.
- **Evidence level:** unit, component, real-database integration, browser and
  document.
- **Deferred, needing engine work:** a reject or cancel command, and actor
  display names on the history route.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md` explains transitions,
  approvals, due times, escalations and history.
- **Rollback:** revert the commit.

## V1 W2.6: secure by default

- **Refusal to serve.** The server refuses to start when
  `OPENEOC_RUNTIME_URL` is unset, and when the runtime role would bypass
  row-level security: a superuser, a `BYPASSRLS` role, or the owner or a
  member of the owner of a table whose security is not forced.
  `checkRuntimeRole` in `server/src/main.ts`; `OPENEOC_ALLOW_OWNER_RUNTIME=1`
  overrides and logs a warning. This is gate line 8. The Windows desktop
  `serve` path runs the same check with no override.
- **Commands.** `main.ts` dispatches `serve` (default), `bootstrap` and
  `rotate-secret-key`. `bootstrap` takes the admin email and name and the
  jurisdiction slug and name as flags, the password from
  `OPENEOC_BOOTSTRAP_PASSWORD` or standard input, never printed; it runs
  migrations, then creates the instance admin, jurisdiction, membership and
  standard positions in one transaction under an advisory lock, and exits 0
  changing nothing when an instance admin exists. The desktop setup now calls
  the same implementation. `rotate-secret-key`, new
  `server/src/secrets/rotate.ts`, re-encrypts every envelope column in one
  owner transaction, verifying each value decrypts first, and rolls back
  entirely on one failure: `person_mfa.secret_envelope`,
  `ipaws_config.credential_envelope`, `collab_backends.token_envelope`,
  `meeting_config.secret_envelope`, `peers.outbound_token`.
- **Uploads.** The base64 JSON upload is replaced by streaming
  `multipart/form-data` on the same route through `@fastify/multipart`. Bytes
  stream to a staging file while SHA-256 is computed, so no transaction is
  open during the transfer. Over `OPENEOC_MAX_UPLOAD_MB` (default 25) answers
  413; the quota check, file row, audit entry and move into the blob store run
  in one transaction under a per-jurisdiction advisory lock, so concurrent
  uploads cannot jointly exceed `OPENEOC_JURISDICTION_QUOTA_MB` (default 10240),
  answering 409 with the bytes in use; a non-multipart request answers 415.
  The web client sends `FormData`. The concurrency test returned two 201s
  without the lock.
- **Timeouts.** Collab 15 seconds, IPAWS 30, resource escalation 15, where a
  timeout answers 502 and rolls back. Meetings makes no outbound call, OIDC
  relies on openid-client's 30 second default, and feeds and the outbox
  already had timeouts. "The two connectors" was read as collab and IPAWS.
- **Deploy.** `install.sh` generates the `app_runtime` password, creates the
  role before the first migration and writes `OPENEOC_RUNTIME_URL`, filling it
  in on an older `.env`. `docker-compose.yml` passes the upload limits.
- **Integration fix: request timeout.** The global 30 second `requestTimeout`
  would cut off a 25 MB upload on any link slower than about 7 Mbit/s, which
  is ordinary in the field. It is now five minutes; headers alone are still
  cut off by Node's 60 second `headersTimeout`, which is the slowloris
  defense. `docs/SECURITY-CONTINUITY.md` states both.
- **Deviations.** The quota is one environment default per jurisdiction with
  no override route. It counts every stored version even when content is
  deduplicated on disk. Multipart text fields must precede the file part.
  Desktop key rotation is documented steps, not a launcher action. No
  migration was needed.
- **Known risk.** An IPAWS send that times out rolls the confirmation back as
  a network error did before; if IPAWS had accepted it, a retry could send
  twice. CAP identifiers are unique per message, which IPAWS checks.
- **Contract:** same method and path, no change. **Dependency:**
  `@fastify/multipart` 10.1.2, MIT, with `@fastify/busboy` 3.2.2 and
  `@fastify/deepmerge` 3.2.1, both MIT. License scan 294 packages; advisory
  gate 0 high or critical with no exceptions.
- **Verification.** In the lane, a 16-file batch passed 147 of 148, the red
  being the known ipaws setup-lock timeout, which passed 20 of 20 alone. After
  rebasing onto W3.0, W3.1, W3.5 and W3.7 with the timeout fix: 17 server
  suites and every web test at four workers passed 556 of 556; ipaws,
  `communications-workspace-browser` (upload through the UI) and `load.test.ts`
  serial passed 25 of 25. `pnpm test:desktop` 19 passed. TypeScript and ESLint
  clean. Link checker 69 files. A CLI smoke run: bootstrap from standard input
  exits 0, a second bootstrap changes nothing, serve with no runtime URL is
  refused, rotate prints counts.
- **Evidence level:** unit, real-database integration, browser and document.
- **Rollback:** revert the commit and drop the dependency; no schema change.

## V1 W3.2: damage assessment

- **What changed.** Operations > Damage Assessment, new `web/src/damage/**`:
  the public intake queue where members and admins accept or reject reports,
  paged with Load more; Accepted and Rejected tabs; a form to record an
  official field assessment with degree, structure and occupancy from the PDA
  dictionary with human labels; a loss summary by degree with total and
  uninsured loss; the PA per-capita and IA residences indicators each shown
  against its threshold with the basis of the number; the declaration summary
  download; accepted reports on the map, colored by degree through the
  existing map component; and, for admins behind a confirm step, issuing a
  public intake token.
- **Deviations from the roster wording.** Moderation is accept or reject; the
  engine has no "needs info" state. The degree is set by recording an official
  field assessment, because the engine cannot change a submitted report's
  degree. The export is the engine's Markdown declaration summary, not CSV or
  JSON. The map is the existing map component embedded in the screen, not a
  layer on the main Map screen, and shows the newest 500 accepted reports. The
  engine needs a county population it has no source for, so the operator
  enters it; the three threshold inputs are remembered per jurisdiction in
  that browser, with the server's 4.6 and 25 defaults prefilled. Destroyed and
  major share the critical color; a legend and the guide say so.
- **Ownership deviation.** `server/src/damage/service.ts`: the existing report
  list now also returns structure type, insured, notes, longitude and
  latitude, which the map needs; smaller than a new route, with a failing-first
  test in `damage.test.ts`.
- **F8 and F9 are not closed, stated plainly.** F8 stays partial: there is no
  engine for Public Assistance categories A to G or shelter census, and the
  screen says the per-capita figure is structure loss, not PA cost. F9 stays
  partial: parcel-roll ingestion and statewide replacement-cost coverage need
  data acquisition, an external action; baseline import exists through the
  API only and baselines do not feed the summary. The W4 gate expects F8
  verified, so the PA category engine is carried into W4 as a unit of its own.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane: `damage-browser.test.ts` 2 of 2, a Chrome
  walk at 1440 and 390 in light and dark with database checks, and 6 files 83
  of 83. After rebasing onto W2.6, W3.1, W3.7 and the gate commits: the damage
  and chronology browser walks, damage, list-pagination-operational,
  api-docs, every web test and the shared suite passed 610 of 610. TypeScript
  and ESLint clean. Link checker 70 files.
- **Evidence level:** unit, real-database, browser and document.
- **Guide:** new `docs/guides/DAMAGE-ASSESSMENT.md`, linked from the guides
  index.
- **Rollback:** revert the commit.

## V1 W3.3: staffing

- **What changed.** Operations > Staffing, new `web/src/staffing/**`, with four
  tabs. Check-in and on duty: check in by position yourself or, for admins, any
  member, or type or scan a badge code to check in its holder; the on-duty
  table has Check out per row and loads more by cursor; vacant positions are
  listed. ICS-211: a printable check-in list of number, name, incident
  assignment, date, 24-hour time and method, warning "Partial list" while more
  pages remain. Badges, admin only: issue a badge showing name, position and
  the code in groups of four. Shifts: the upcoming list and a schedule form.
  Printing uses a page-level sheet with a print stylesheet that hides the shell.
- **Deviations and defaults.** No QR image: `web/` carries no QR generator and
  none was added; the code prints as text and typed entry ignores spaces. The
  scan control reads a camera photo through `BarcodeDetector` where the
  browser has it, as Tracking does, with no live video. The ICS-211 lists open
  check-ins only, with no agency or check-out time, because the engine stores
  neither, and covers the jurisdiction rather than the selected incident. Only
  admins check in someone else, because only admins can list members. The
  engine has no badge revocation, which the screen and guide state. Upcoming
  shifts stay capped at 50 by the engine.
- **Integration fix.** An unknown badge answered 401, which the web client
  reads as an expired session, so a mistyped badge code renewed the
  operator's token before failing. It now answers 404; the staffing test
  asserts it. Ownership deviation: `server/src/staffing/service.ts`.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, 28 files passed 175 of 175, including
  `staffing-browser.test.ts`: issue a badge, check its holder in by code, see
  the row on duty and on the ICS-211, vacancies, print emulation showing only
  the ICS-211, check out, the seeded shift, scheduling a shift, and dark at 390
  with no horizontal overflow. After rebasing onto W3.2 and the badge fix: the
  staffing and damage browser walks, staffing, list-pagination-operational,
  api-docs, every web test and the shared suite passed 611 of 611. TypeScript
  and ESLint clean. Link checker 70 files.
- **Evidence level:** unit, real-database integration and browser.
- **Deferred, needing engine work:** a QR generator, badge revocation,
  ICS-211 history with check-outs and agency, incident filtering, a cursor on
  shifts.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md`, "Staffing: check in, badges
  and shifts".
- **Rollback:** revert the commit.

## V1 W3.6: federation and peers

- **What changed.** A Federation screen under Data and administration, new
  `web/src/federation/**`, for jurisdiction administrators. Registering a
  partner shows the issued token once with a copy button and a warning, then
  clears it. The push link takes the partner address and a masked token; the
  stored token is never displayed. Sharing a board takes a board picker, read
  or read-and-write, and the receiving board id on the partner. Outbox status
  per partner and board shows updates waiting, oldest waiting age, next
  attempt, last error and last delivery, and says why an update is held: no
  link or no receiving board. "Received from partners" lists the ten latest
  `federation.received` events. Resource escalation keeps no stored targets,
  because each escalation supplies the peer, and the screen says so.
- **Deviation: one read route.** No route listed peers, agreements or outbox
  status, so `GET /api/v1/jurisdictions/:jurisdictionId/federation` was
  added, admin only, under row-level security, returning peers without their
  token hash or outbound token and the newest received batches first. Contract
  and `docs/API.md` updated. The Console wiring also touches the member-nav
  filter, the nav switch, the center switch and the page title.
- **Defaults.** Members cannot view status; the entry is hidden from them and
  a direct URL shows the refusal. The board picker offers only boards not yet
  shared with that partner.
- **Engine gaps found, carried to W3.11.** Nothing in the sync write path
  queues a shared board's edits for its peers; only the manual queue route
  writes the outbox, which contradicts the federation guide. A second
  agreement for the same peer and board answers 500 from the unique
  constraint instead of 409.
- **Schema:** none. **Dependencies:** none.
- **Verification.** In the lane: `federation-browser.test.ts` 2 of 2, twice,
  walking two real instances: register (token shown once), link, share with a
  receiving board, queue, "1 waiting", drain into the second instance, "Up to
  date", then the reverse direction received; and a member refused. Federation,
  delivery-outbox, resource, api-docs and ipaws 42 of 42; shared 115 of 115.
  After rebasing onto W3.2 and W3.3, resolving additive conflicts in the
  client, its test and the console: the federation and staffing browser walks,
  federation, delivery-outbox, api-docs, ipaws, every web test and the shared
  suite passed 606 of 606. TypeScript and ESLint clean. Link checker 70 files.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Guide:** `docs/guides/FEDERATION-SETUP.md`, "The Federation screen".
- **Rollback:** revert the commit.

## V1 W3.8: JIC and resources completion

- **Route count confirmed at 7 and 5.** JIC, six now wired: release
  decisions, publish, the public feed, inquiry create, assign and answer;
  `POST /api/v1/jic/approvals/receive` stays unwired as peer-token machine
  audience. Resources, three now wired: cost entry, the cost export and
  escalation; `receive` and `report` stay unwired as peer-token machine
  audience.
- **What changed.** In `web/src/sitreps/JicPreparation.tsx`, after submit the
  panel shows the review chain and the operator approves or rejects per named
  agency with a note, the server's refusal shown; an approved release
  publishes to the public feed, the incident collaboration channels or both,
  and the panel says which accepted it; the ten latest public releases are
  listed; media inquiries are logged, assigned to a position and answered with
  the panel's release. In `ResourcesSurface.tsx` the selected request gains a
  costs and mutual aid panel: record a cost, export the costs CSV, and
  escalate with a peer name, address and token, showing the server's error;
  the upper tier's status reports appear in the history and move the request.
- **Deviations.** No list route exists for releases or inquiries, so the panel
  shows only the release drafted and the inquiries logged in it; a second
  approver signed in elsewhere cannot find a release waiting on them. The
  engine has no inquiry close step. Publishing to CAP is not offered, because
  the engine needs a full CAP draft. Cost category is free text. The JIC side
  panel is no longer sticky, being taller than the screen. Ownership deviation:
  `web/src/sitreps/sitreps.css`.
- **Engine gaps found, carried to W3.11:** list routes for pending releases
  and open inquiries, so a second approver can act from their own session;
  and `addCost` binds a missing incurred date as null into a `NOT NULL DEFAULT
  CURRENT_DATE` column, which should fail rather than default. The screen
  always sends a date.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, 11 files passed 72 of 72, including
  `jic-resources-browser.test.ts` with a second running instance as the upper
  tier: escalation over real HTTP refused with a wrong token (502 shown) and
  accepted with the right one, "assigned" and "deployed" reported back, and
  database checks for the approval, the public message, the answered inquiry
  and the received request. After rebasing onto W3.2, W3.3 and W3.6: the JIC
  and resources, resources and SITREP briefing browser walks, jic, resource,
  sitreps, api-docs, every web test and the shared suite passed 604 of 604.
  TypeScript and ESLint clean. Link checker 70 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md` JIC and resources sections.
- **Rollback:** revert the commit.

## V1 W3.4: facilities and shelters

- **What changed.** Operations > Facilities, new `web/src/facilities/**`,
  shown only where the server runs the facilities integration. Registry: name,
  type from the HAVE facility kinds with readable labels, contact, position
  and reporting window, with a registration form. Status board: operating
  status, EMS traffic, last report and freshness (Current, Stale, No report
  yet). Report status: operating status and EMS traffic from the HAVE
  dictionaries, beds per HAVE bed type, a note; a shelter reports open spaces
  and capacity. Hospital bed availability per hospital with an EDXL-HAVE
  download. Shelters: capacity, occupied and open spaces. The existing map
  component embedded in the screen draws hospitals and shelters with their
  NAPSG symbols framed by operating status, with a legend.
- **Deviations from the roster wording.** No edit: the engine has no update
  route, so registry fields are set at registration, which the screen and
  guide state. Capacity is the bed baseline on each report, not a registry
  field; shelters report under the HAVE "other" bed type. The map is embedded
  in the screen. "Report now" requests stay API only. The nav entry reuses the
  `lifelines` icon; the set has no facilities icon.
- **Ownership deviation.** `server/src/facilities/service.ts`: each board row
  also returns contact, location and reporting window, which the map and
  registry need, smaller than a new route; a failing-first test checks it and
  that the contact never enters the HAVE XML.
- **Integration fix: how the console learns the integration is on.** The
  lane gated the entry by reading the facilities board and treating a 404 as
  off, because `GET /api/v1/integrations` was admin-only; that cost a board
  read, or a 404, on every console load. The integration list is not
  sensitive to a signed-in person, who sees the entries anyway, so the route
  now answers any signed-in person, and the console reads it. The admin test
  asserts a member may read it.
- **Schema, contract, dependencies:** none; the route's auth mode is unchanged
  in the contract (bearer).
- **Verification.** In the lane, 8 files passed 53 of 53, including
  `facilities-browser.test.ts`: with the integration on, a member registers a
  hospital and a shelter, reports each, backdates both 90 minutes so the
  hourly hospital reads Stale and the two-hour shelter Current, reads HAVE
  beds and downloads the XML, reads shelter occupancy 120, 80, 40, and finds
  both on the map with their symbols; with it off, no entry and
  `#/facilities` shows Page not found. Screenshots at 1440 and 390 light and
  dark. After rebasing onto W3.6 and W3.8 and the integration change: the
  facilities, facility symbols and admin browser walks, facilities, admin,
  api-docs, every web test and the shared suite passed 602 of 602.
  TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, real-database, browser and document.
- **Guide:** new `docs/guides/FACILITIES.md`, stating the integration is
  optional and enabled by `OPENEOC_INTEGRATIONS=facilities`.
- **Deferred:** editing and removing registry entries, which need an engine
  route; a status-request screen.
- **Rollback:** revert the commit.

## V1 W3.10: settings and field reports

- **Field Reports built.** The engine has no route listing form submissions:
  a submission is a record on a board plus a `form.submitted` audit event, and
  the design documents define Field Reports as the operator route backed by the
  configured Field Reports board. The new surface at `#/field-reports`, after
  Tasks, shows the Field Reports board attached to the selected incident,
  scoped to it, or the organization's Field Reports boards with a selector.
  The existing board screen draws the records, so status, attachments, paging
  and the record link behave as under Boards. "Capture a field report" opens
  Smart Forms; a clear message appears when no Field Reports board exists.
- **Settings removal confirmed.** The account menu already holds the only
  self-service controls the engine offers, theme and sign-out, and the command
  bar holds operational period and acting position. The engine has no route to
  change one's display name, no session list, no self view of two-step
  sign-in, and no personal notification preferences, so a Settings page would
  duplicate the menu. Deviation: one of the "two new surfaces" was built.
- **Rail defect found and fixed.** Walking every rail entry found Templates
  opening "Board customization is unavailable for this account" for every
  member and every jurisdiction admin who is not an instance admin. The rail
  now hides Templates unless the account is an instance admin administering
  the viewed jurisdiction, the check the Templates screen makes.
- **Integration: optional integrations off the rail.** After rebasing onto
  W3.4, the console's two nav helpers merged into one `railFor`, which hides
  Administration and Federation from non-admins, Templates as above, and
  Facilities and Tracking when their integration is off, reading
  `GET /api/v1/integrations`, which any signed-in person may now read.
  Tracking previously showed when off and opened onto actions that fail.
- **Ownership deviations:** `router.tsx` additive; one line each in
  `app-e2e`, `admin-browser` and `federation-browser` tests, whose "rail has
  loaded" signal moved from Templates to Feeds.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane: web 490 of 490; `field-reports-browser`,
  `admin-browser` and `federation-browser` 6 of 6, the rail walk red on
  Templates before the fix; `app-e2e` 4 of 4. The new browser test opens the
  incident's field reports and a record, follows "Capture a field report",
  checks dark at 390 with no overflow or outside requests, and walks every rail
  entry as an admin and a member, requiring each to show its own heading and no
  refusal, placeholder or "Page not found". After rebasing onto W3.4 and the
  rail merge: every rail-walking browser test (admin, facilities, federation,
  field reports, field workspaces, app-e2e) and every web test passed 481 of
  481. TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred:** a partner viewer who is not a member gets incident boards
  without template keys, so Field Reports shows none for them; the board is
  still under Boards. The Settings engine gaps above remain.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md`.
- **Rollback:** revert the commit.

## V1 W3.11: engine gaps the screens exposed

- **Why this unit exists.** W3.6 and W3.8 found four engine gaps outside what
  a presentation unit may change. The unit is added to the roster's W3 table
  in this commit.
- **Automatic forwarding.** When the sync hub records an update to a board it
  now queues the same bytes in `federation_outbox`, in the same transaction,
  for every peer whose agreement can read that board, through new SECURITY
  DEFINER `queue_federation(board, payload, exclude_peer)` granted only to
  `app_runtime`, so queueing does not depend on the editor's role. An update
  that arrived from peer P is never queued back to P; it is still forwarded to
  the board's other readers.
- **Limits of forwarding, stated plainly.** Incident-scoped sync updates are
  not federated, because agreements are per board and the peer applies without
  incident scope. REST record writes are not forwarded: the console's board
  and map forms save through REST and the continuity client syncs per incident,
  so the console's own edits do not reach peers automatically; only
  jurisdiction-wide edits over the live sync socket are forwarded, plus updates
  passed on from other peers. No converter was built, because a standalone Yjs
  update per REST write would carry a fresh client id and concurrent map sets
  would then resolve by client-id order rather than time. The federation guide
  states exactly what is and is not forwarded. This bounds F3 and is carried to
  the final reconciliation.
- **Duplicate agreement:** a second agreement for the same peer and board
  answers 409 "this board is already shared with that peer" instead of 500.
- **JIC lists.** New `GET /api/v1/jurisdictions/:jurisdictionId/jic/releases`
  and `.../jic/inquiries`, readable by any member, cursor-paged, with optional
  `incidentId` and a comma-separated `status` set; a release carries its
  approval chain and `decidedByMe`. The JIC panel gains "Waiting for review",
  the incident's pending releases the signed-in person has not decided, with
  the agencies still awaited and a Review button, and loads unanswered
  inquiries from the server.
- **Cost date:** `addCost` uses `coalesce(date, current_date)`, so a cost with
  no date takes today instead of failing.
- **Schema:** migration `0115_forwarding_and_release_list.sql`, the function
  and a `press_releases_jurisdiction` index. Contract: two routes;
  `docs/API.md` regenerated. No dependency change.
- **Verification.** Before the fixes, resource, federation, delivery-outbox
  and jic ran 25 passed and 6 failed: automatic queue, the 409, a status
  count, the list routes (404) and the omitted cost date (500). After, in the
  lane: 11 files 107 of 107; `jic-resources-browser` 3 of 3, including a second
  administrator in a separate browser session finding and approving the
  pending release; `federation-browser` 2 of 2; shared 115 of 115. The first
  federation test now relies on automatic queueing and asserts no echo. After
  rebasing onto W3.4 and W3.10: federation, delivery-outbox,
  sync-hub-lifecycle, sync, continuity-sync, jic, resource, api-docs, ipaws,
  both browser walks, every web test and the shared suite passed 659 of 659.
  TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, integration, real-database with two instances,
  browser and document.
- **Found, not changed:** `POST /api/v1/peers/:peerId/queue` ignores the
  path's peer and queues for every reader of the board; the guide describes
  that behaviour. The incident exclusion has no dedicated test.
- **Rollback:** revert the commit; 0115 adds a function and an index.

## V1 W3.9: export and import

- **Jurisdiction export.** `GET /api/v1/jurisdictions/:jurisdictionId/export`
  returns a gzip-compressed tar archive. `export.json` keeps the four schema 1
  keys in the same shape and adds, at `schemaVersion` 2: incidents with areas
  as GeoJSON, participants and attached boards; every IAP revision with its
  ICS-204 assignments; AARs, observations and corrective actions; resource
  requests with costs and state history; tasks with prerequisites; lifeline and
  ESF assessments with decisions; and file metadata with each file's archive
  path. `files/<sha256>` holds each distinct file once. The export runs as the
  requesting admin through `withPerson`, so it holds only what that admin can
  read; `export.json` is written to a temporary file 500 rows per page inside
  one transaction, then the archive streams it and each blob, so memory holds
  one page or one blob and no connection waits on the download. The admin
  Records tab gains "Export jurisdiction".
- **Designer import.** An Import tab sends a board template JSON or signed
  package, an XLSForm workbook or form JSON, and a dashboard template JSON to
  the existing routes, checking JSON against the shared schema first and
  showing server refusals in the server's words.
- **Defaults and deviations.** tar.gz was chosen over ZIP, which needs a
  dependency or ZIP64 past 4 GiB under a 10 GiB default quota, and over JSON
  with base64, which grows by a third and cannot be parsed at size. The route
  now answers `application/gzip` rather than bare JSON; compatibility is the
  version field and the unchanged v1 keys, and no jurisdiction import exists.
  "Assessments" means lifeline and ESF assessments; damage assessments are not
  included. A workbook the reader cannot open now answers 400 with the reason
  instead of 500. Ownership deviations: one shared `BlobStore` in `app.ts`,
  `server/src/forms/routes.ts`, one line in `TemplatesSurface.tsx`, and the
  export line in `docs/SECURITY-CONTINUITY.md`. No dashboard-template import
  route was needed.
- **Integration fix: signed packages on a deployed server.** `main.ts` built
  the app without trusted publisher keys and no setting supplied them, so a
  deployed server refused every signed template package. `buildApp` now reads
  `OPENEOC_TRUSTED_TEMPLATE_KEYS`, a path to a PEM bundle of publisher public
  keys; unset trusts none, and a set path holding no key stops startup rather
  than silently trusting none. The board suite now supplies its signer key
  through that file, so its signed-import tests run the deployed path.
  `deploy/README.md` and `docs/guides/DESIGNER.md` document it.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane: 11 server files 82 of 82; designer,
  templates-surface and client 46 of 46; admin, designer and the new
  export-import browser walks 4 of 4. The export tests prove every section
  present, file bytes matching their hash, a second jurisdiction absent both
  ways with 403 across jurisdictions, and the archive unpacking with the
  system `tar`. After rebasing onto W3.4, W3.10 and W3.11, with the key
  setting: boards, export, forms, board-authoring, dashboards, files, admin,
  api-docs, ipaws, the three browser walks, every web test and the shared
  suite passed 666 of 666. TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred:** the admin screen holds the archive in browser memory before
  saving, and the guide sends very large jurisdictions to `curl -o`. The export
  is one READ COMMITTED transaction, not one snapshot, which the guide states.
- **Rollback:** revert the commit.

## V1 W3 route coverage: every operator route owes a screen

- **What changed.** The W3 gate requires every contract route to be reachable
  from a screen or marked machine-only in the contract, with no route unwired
  without a recorded reason. New `web/src/app/__tests__/route-coverage.test.ts`
  holds that permanently: it extracts every `/api/v1/` call site from the web
  sources, with the HTTP verb, and requires each operator-audience route to
  have one, or to be named in an explicit awaiting list with its reason; a
  second assertion fails when a listed route gains a caller, so the list cannot
  go stale.
- **Machine audience in the contract.** `shared/src/api/contract.ts` gains a
  `machineRoutes` set, with reasons in comments and a load-time check that
  each entry exists: CAP, CoT and EDXL interchange in and out; direct CAP
  authoring for API clients, since the screen authors through reviewed drafts;
  the OGC landing and conformance pages; the live dashboard stream for wall
  displays; the OIDC redirect pair; the scheduler's manual triggers; and the
  manual federation queue and its read. The damage self-report route
  authenticates with an intake token but the contract called it bearer; it now
  reads `intake-token`, machine audience. `docs/API.md` regenerated.
- **A scanner miss fixed at the source.** `requestIpawsSend` built its paths
  from a `${base}` variable; the paths are now written in full so the call
  sites are visible.
- **What the test found.** 32 operator routes had no caller. They are carried
  as roster units added in this commit: `W3.12`, fifteen routes of core
  engines with no screen, including notification rule authoring and the
  webhook allowlist; `W3.13`, fifteen routes of the optional integrations; and
  local board fields, owed by the board presentation half of `W4.1`.
- **Verification:** route coverage 3 of 3 with the awaiting list in place;
  api-docs, ipaws (the route-table contract), the shared suite, the IPAWS web
  tests and the client test passed 183 of 183. TypeScript and ESLint clean.
- **Evidence level:** unit and document.

## V1 W4.5: operational vector tiles

- **What changed.** Closes G-TILES without a martin sidecar. New
  `GET /api/v1/tiles/boards/:boardId/:z/:x/:y.mvt` and
  `.../tiles/datasets/:datasetId/:z/:x/:y.mvt`, new `server/src/geo/tiles.ts`,
  build each tile with `ST_AsMVT`, `ST_AsMVTGeom` and `ST_TileEnvelope`,
  bearer-authenticated through `withPerson` with row-level security on. Board
  tiles carry only the fields the caller's role may read, the OGC items
  route's authorization; dataset tiles use the dataset items route's incident
  authority check. Below zoom 12 points group per 16 by 16 cell into a
  `clusters` layer with `point_count`; a single point stays a feature.
  `Cache-Control: private, max-age=5`.
- **Client.** The map switches a board to tiles once its items page has a
  `next` link, and a standard dataset once its load is incomplete. Status,
  NAPSG facility icons and labels are rebuilt as MapLibre expressions over the
  same lookup tables; the inspector works on tile features and a cluster click
  zooms in. The bearer is attached through `transformRequest` only to tile URLs
  this map created, never to basemap or raster servers. Each board and feed has
  an opacity slider. The readout adds USNG and MGRS, new `web/src/cop/mgrs.ts`,
  converted in-house from the NGA and Snyder UTM formulas with the Norway and
  Svalbard exceptions.
- **Defaults and deviations.** Boards switch at 101 records, one client page,
  not at the 1,000 cap. Datasets keep their GeoJSON paging and switch past
  50,000 features. Flood datasets stay on GeoJSON, because their zone
  classification uses a regex MapLibre expressions cannot express. Tile layers
  reload on each poll. The parity matrix is left to the final reconciliation;
  the evidence is here. Ownership deviations: four lines in `MapSurface.tsx`
  and two in `web/cop-demo/main.tsx` passing the tile URL and headers.
- **Schema:** none; the spatial indexes already existed. Contract: two routes;
  `docs/API.md` regenerated after rebasing onto the route-coverage change. No
  dependency; the tests decode tiles with a reader in the test file.
- **Evidence.** Real database: a 5,000-point board and dataset, low-zoom
  `point_count` summing to exactly 5,000, an admin-only field absent from every
  byte of a member's tile and present in an admin's, 404 and no features
  without access, 401 unauthenticated, 400 out of zoom. Unit: USNG and MGRS
  against the USNG standard's Washington Monument example, the NGA example
  `4QFJ1234567890` and PostGIS-projected points; the expressions agree with the
  existing tagging functions. Browser: all 5,000 records reach the map through
  tiles, every tile request carries the bearer and returns 200, a tile feature
  opens the inspector showing "Critical", the slider sets opacity 0.4, the
  readout shows `MGRS 10TDL4892371130`.
- **Verification.** In the lane: 35 files 237 of 237; the cop, KPI, hazards,
  facility symbols and vector tile browser walks 5 of 5 serial; map surface 8
  of 8. After rebasing: geo, vector-tiles, ipaws, the vector tile, cop,
  facilities and damage browser walks, every web test including route
  coverage, and the shared suite passed 637 of 637. TypeScript and ESLint
  clean.
- **Evidence level:** unit, real-database, browser and document.
- **Deferred:** flood and parcel datasets on GeoJSON; Find on map, Zoom to
  extent and building status coloring see only a tile layer's first page;
  tiles drop nested JSON values, so the inspector shows scalars.
- **Guide:** `docs/guides/OPERATOR-QUICKSTART.md`, "Read the map".
- **Rollback:** revert the commit.

## V1 W4.0 part one: email and SMS channels

- **What changed.** Notification rules can send email and SMS. `ChannelSchema`
  gains `email` (up to 50 addresses) and `sms` (up to 50 E.164 numbers). Each
  recipient gets its own pending notification and delivery row inside the
  write transaction, and the worker sends by kind: email through the
  jurisdiction's SMTP relay, SMS through the fixture provider or an HTTP
  provider. What the relay or provider answered, the SMTP reply, queue id and
  Message-ID, or the provider's message id, is kept in the new
  `delivery_outbox.receipt` for part two's delivery receipts. Admins configure
  both channels and send a test from a new Channels tab under Administration,
  new `web/src/admin/Channels.tsx`.
- **Decisions.** Configuration is per jurisdiction in `notification_channels`,
  the relay password or provider token envelope-encrypted, never returned,
  shown as a fingerprint. The SMTP client is written in-house in
  `server/src/notify/smtp.ts`, no dependency: STARTTLS and implicit TLS, never
  falling back to plain text when STARTTLS was asked for; AUTH PLAIN or LOGIN;
  multi-line replies; base64 body with dot-stuffing; RFC 2047 subjects; an idle
  timeout on every connection; security mode `none` only without a user name.
  The W2.7 allowlist governs the HTTP SMS provider URL, at save and before each
  send; the SMTP relay is an admin-set host; recipients are people, not
  endpoints, and are not allowlisted, but each counts against the rule's rate
  cap. Fixture SMS keeps the last 200 messages in memory, listed as "fixture:
  not sent". Circuits key on the relay or provider, never the recipient.
- **Deviations.** Routes take a `:kind` parameter (`email|sms`) rather than a
  path per kind. Test sends go out immediately outside the queue and are
  audited as `notification.channel_tested`. A rule naming an unconfigured
  channel answers 422, and a queued message for one is dead-lettered unsent. No
  rule-authoring screen existed; `W3.12` builds it.
- **Integration fix: permanent refusals.** An SMTP 5xx was retried like any
  failure, eight times. A 5xx reply to MAIL, RCPT or the message itself now
  raises `SmtpRefused` and the delivery is dead-lettered at once, without
  counting against the relay's circuit, because the relay is working and
  refused this recipient or message. A refusal at sign-in stays an ordinary
  failure, so a wrong relay password does not dead-letter the queue while an
  administrator corrects it. A new test shows a 550 dead-lettered after one
  attempt and one relay session.
- **Schema:** migration `0118_notification_channels.sql`:
  `notification_channels` with admin-only row-level security; the delivery
  kind check widened; `delivery_outbox.receipt`; `claim_deliveries` returning
  the jurisdiction and channel settings with the secret still encrypted;
  `settle_delivery` with a defaulted receipt argument, so prior code still runs.
  Contract: three routes; `docs/API.md` regenerated. No dependency change.
- **Verification.** In the lane: notify, delivery-outbox, observability,
  scheduler, retention, api-docs, ipaws and notify-channels 66 of 66; the
  channels browser walk and notify-channels 10 of 10; admin-browser 2 of 2;
  migrate-baseline and upgrade 6 of 6; shared 115 of 115. The new tests cover
  STARTTLS with AUTH PLAIN to a fake relay with command order, recipients,
  subject, body and receipt; a 451 retried then dead-lettered; implicit TLS
  with AUTH LOGIN, an encoded subject and dot-stuffing; an untrusted
  certificate refused; a relay without STARTTLS refused before AUTH; fixture
  SMS recorded and unsent; the HTTP provider form, basic auth and receipt, and
  refusal once removed from the allowlist; admin-only configuration; the secret
  absent from responses, rows and audit; per-recipient rate caps. After
  rebasing onto W3.9, W4.5 and route coverage, with the refusal fix:
  notify-channels, notify, delivery-outbox, observability, scheduler,
  retention, api-docs, ipaws, migrate-baseline, the channels and admin browser
  walks, every web test and the shared suite passed 674 of 674. TypeScript and
  ESLint clean. Link checker 71 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred:** part two, contacts, groups, mass notification, receipts and
  escalation. A relay behind a private CA needs `NODE_EXTRA_CA_CERTS`.
- **Rollback:** revert the code; the prior code runs against the 0118 schema.

## V1 W2 milestone gate

- **Command:** `pnpm check:gate` with `OPENEOC_TEST_DB_TAG=gate` on `91b6058`:
  recursive TypeScript, full ESLint, the license scan (303 packages), the link
  checker (69 files), the advisory gate (0 high or critical, no exceptions),
  the desktop and installer tests (19 passed), then the serial Vitest path at
  `--maxWorkers=1`.
- **Serial suite: red, then fixed, stated plainly.** 199 of 200 files and 1,115
  of 1,116 tests passed in 927 seconds, in one run, with no load retries
  needed. The one failure was real: the shared contract test enumerated the
  accepted auth modes and did not know the `metrics-token` mode W2.8 added,
  because that lane never ran the shared suite. The test was corrected in
  `0642725` and the shared suite then passed 141 of 141. The lane brief now
  requires the shared suite of any unit touching `shared/**`. The serial path
  was not re-run end to end for a one-line test fix.
- **Two-hour synthetic activation.** New `scripts/soak.mjs` against a server
  started by `main.ts` on this workstation under the `app_runtime` role, with
  the process memory gauges added in `91b6058`: 150 member sockets across ten
  boards, each editing its own record every 7.5 to 22.5 seconds, a read every
  10 to 30 seconds, a tenth of the sockets dropped and reconnected every five
  minutes, and the access token renewed through the resume token. A first run
  was stopped at 16 minutes because the driver did not renew its token, so
  churned sockets could not sign in again; the fix is in `0642725` and the run
  restarted clean.
  - 119 one-minute samples, 71,106 edits acknowledged, 0 errors.
  - Heap used: median of the first fifth after a ten-minute warm-up 89.2 MB,
    of the last fifth 87.6 MB, a change of minus 1.7 percent: flat. Heap
    oscillated between about 60 and 110 MB throughout.
  - Resident memory rose from 249 MB to a plateau of 340 to 390 MB within the
    first half hour, tracking V8's heap reserve (heap total about 200 MB), and
    did not climb after it.
  - Edit round trip: median per-minute p95 50 ms, worst per-minute p95 103 ms,
    the last minute p95 23 ms and maximum 36 ms. Sockets held at 150, reading
    135 in the minute after each churn.
- **150-socket fan-out.** Recorded by W2.4's serial acceptance: every update
  reached all 149 live readers under 100 ms beside a stalled reader.
- **Boundary kept.** These runs are on this Windows workstation, not on
  deployment hardware. The roster's real-hardware leg stays with `R1-REAL` on
  the release candidate, an external input in section 7 item 7.
- **Result:** wave W2 is complete: W2.0 through W2.11 are receipted and on
  `origin/main`. The gate's suite leg is green after the recorded fix, its heap
  leg is met, and its hardware leg is carried to `R1-REAL`.

## V1 W4.1 part one: board engine depth

- **What changed.** The engine half of board depth in `shared/src/boards/**`
  and `server/src/boards/**`:
  - Reference labels compose from up to four target fields (`labelFields`),
    omitting any the caller cannot read.
  - Record-level access: templates declare `recordAccess` with read and edit
    grants by role, creator, creator position or workflow-assigned position.
    The database enforces it through restrictive row-level policies on
    `board_records` and `audit_events`, which covers every read path: views and
    cursor pages, detail, history, references, exports, the chronology,
    dashboards, map layers and sync rows. REST and sync writes check the edit
    rule and the policy refuses the update at the database too.
  - Archive and restore keep records out of default views and bring them back
    with `archived=include|only`. Delete is admin-only and a tombstone: the
    prior data stays in the audit entry, and a Yjs removal is appended to the
    sync log in the same transaction and pushed to open documents.
  - A cursor-paged history route per record with who, position, when, and
    values before and after, built on `audit_events`; sync writes now record
    before and after values too.
  - Export of a view as CSV with the formula guard and as XLSX; import of CSV or
    XLSX with header mapping, a dry run returning per-row errors, and an
    all-or-nothing commit; new `server/src/boards/transfer.ts`.
  - Ten more filter operators including relative dates, pushed to SQL, in a new
    view property `where`; multi-key sort with every key in the cursor; grouped
    views returning counts.
- **Deviations.** The operators live in `where` rather than widening `filter`,
  whose three-operator type the designer depends on. The assigned-position
  grant uses the workflow assignment, because no position field type exists.
  A board with record rules is served over sync only to callers who read every
  record; others use views, because filtering one shared document per reader
  would leak through the Yjs log. Grouped views return counts on the first
  page. Numbers now sort by value, not as text, which changed one expectation
  in `list-pagination.test.ts`. Import creates records only and sends no
  notifications, capped at 10 MB and 10,000 rows; export caps at 50,000 rows.
  Ownership deviations: `server/src/sync/hub.ts` (restricted-board refusal,
  edit-rule and deleted-record conflicts, audit values, the removal listener),
  `server/src/forms/xlsx-import.ts` (a shared worksheet reader),
  `server/src/audit/export.ts` (the CSV cell helper exported).
- **Integration fix: files on restricted records.** The lane found that a file
  attached to a restricted record was listed by the file table's own rules, so
  its name, text and bytes reached callers the record excludes. Migration 0119
  now carries a restrictive `files_record_scope` policy applying the record's
  read rule to files attached to it; a new test shows the outsider neither
  listing nor fetching the file while the author does.
- **Recorded, not changed.** A notification rule delivers a restricted record
  to its configured destinations, and a sharing agreement federates a
  restricted board's live edits; both are administrator-configured, and
  `docs/guides/DESIGNER.md` now says neither is governed by the rule. A record
  a client holds from an incident projection is not retracted from its saved
  copy after delete, though the server never serves it again.
- **Schema:** migration `0119_board_engine_depth.sql`: archive and tombstone
  columns, a generated `record_access` column, five SECURITY DEFINER
  functions, four restrictive policies. Six routes and new view parameters;
  `docs/API.md` regenerated. No dependency: `fflate` writes XLSX and the
  existing reader reads it back.
- **Verification.** In the lane: `board-engine.test.ts` 17 of 17 three times;
  seven board suites 84 of 84; sync, federation, dashboards, forms, ipaws,
  api-docs, xlsform-reader and audit 69 of 69; web boards, client and shared
  177 of 177; the workspace browser walk and load 12 of 12, the first page over
  50,000 records in 5 ms unfiltered and 30 ms filtered. After rebasing onto
  W3.9, W4.5, route coverage and W4.0 part one, with the file policy: 19 server
  suites, every web test and the shared suite 743 of 743, and the boards
  workspace browser walk and `load.test.ts` serial 5 of 5. TypeScript and
  ESLint clean. Link checker 71 files.
- **Evidence level:** unit, real-database, integration, browser and document.
- **Deferred:** the board screen controls, W4.1 part two. Parity row F1's
  evidence is added at the W4 gate.
- **Rollback:** revert the commit and drop the migration's policies, functions
  and columns.

## V1 W3.13: screens for the optional integrations

- **What changed.** All fifteen integration routes the coverage test listed
  now have screens, each shown only where its integration runs, read from
  `GET /api/v1/integrations`, and only to roles the server accepts.
  - Collaboration settings under Administration > Deployment: Mattermost or
    Matrix, the server address, the access token and a Matrix homeserver; the
    token clears after saving and the screen says only whether one is stored.
  - Meeting settings under Deployment: the Jitsi address, app id and token
    secret, handled the same way.
  - Incident collaboration in the incident setup panel: admins set up channels,
    update membership and archive; admins and members announce. With no
    backend, the screen says holders were notified in the app instead.
  - Incident meetings: members open a bridge for the incident or a section,
    get a join link, and schedule briefings; viewers read only.
  - Facilities gains a Status requests panel: "n of m reported" then "All
    reported", naming facilities still outstanding.
  - Tracking gains "Custody chain": an object's handoffs oldest first, paged.
  New `web/src/integrations/collab.tsx` and `meetings.tsx`.
- **Deviations.** No credential fingerprint, because the status routes return
  only whether a secret is stored. Channel existence is not shown, because no
  route reports it; each action reports its own result. The status request
  panel follows requests sent from the current view, because the server keeps
  no list. Restricted tracking details stay off the screen for every role.
  The collab browser walk runs a loopback receiver implementing the Mattermost
  v4 subset the collab suite's fake uses; Matrix is covered by component tests.
- **Ownership deviation, accepted.** The custody chain needs an object's id,
  and the only screen path to one was right after registration, because the
  reunification answer omitted it. `server/src/tracking/service.ts` now returns
  `id` in each reunification answer, asserted in `tracking.test.ts`; the route
  already requires membership and still never reads the restricted column.
  Other deviations: additive props in `Console.tsx` and `AdminSurface.tsx`,
  four lines of CSS, and a new tracking section in `docs/guides/FIELD-USER.md`,
  since tracking was documented nowhere.
- **Schema, contract, dependencies:** none.
- **Browser walk.** An admin saves the collab backend against the loopback
  receiver, with the token absent from the stored envelope's plaintext and the
  page; saves the meeting bridge; sets up the incident's team and six
  channels with the bearer on every call; announces; opens a signed bridge
  link; schedules a briefing; sends a hospital status request from "0 of 1
  reported" to "All reported"; and reads a custody chain of two handoffs. At
  390 nothing overflows and no request leaves the app. With the integrations
  off: no Facilities or Tracking entry, no collaboration or meeting panel, no
  incident controls.
- **Verification.** In the lane: collab, meetings, facilities, tracking,
  api-docs, ipaws and every web test including route coverage, 82 files 566 of
  566; four browser walks 7 of 7; app-e2e 4 of 4. After rebasing onto W4.0
  part one and W4.1 part one, resolving the admin tab, guide and client
  conflicts: the same suites with the shared suite 659 of 659; the
  integrations, facilities, admin, channels, field workspaces and app-e2e
  browser walks serial 12 of 12. TypeScript and ESLint clean. Link checker 71.
- **Evidence level:** unit, real-database, browser and document.
- **Deferred:** an incident's channel state, a list of status requests,
  restricted tracking details for cleared roles, a browser walk against Matrix.
- **Rollback:** revert the commit.

## V1 W3.12: screens for the remaining operator routes

- **What changed.** The fifteen core-engine routes the coverage test listed
  each have a caller and have left the awaiting list.
  - Administration gains a Notifications tab, new `web/src/admin/
    Notifications.tsx`, admin only: an allowlist editor showing destinations
    as the server normalized them, and a rule form over board, event,
    condition, schedule interval, channels and rate cap; a webhook rule's
    signing secret is shown once with Copy secret. Each channel kind is one
    table entry, so in-app, webhook, push, email and SMS are offered.
  - ESFs and Lifelines gains a standing lifeline status panel, new
    `JurisdictionLifelines.tsx`.
  - Messages gains Export thread and, for admins, a Message settings panel.
  - Incident Setup gains Add a library for admins, the incident's checklists
    and libraries, and Mark complete on the signed-in position's items.
  - Datasets gains Load records from a JSON or GeoJSON file.
  - Overview gains a jurisdiction dashboards panel with admin creation and a
    per-dashboard Export template, new `DashboardDefinitions.tsx`.
  - AAR gains Load latest revision on each corrective action; the map gains
    Compare with area revision under Impact in view; Damage Assessment gains a
    parcel baseline import from CSV or JSON, admin only.
- **Deviations, recorded.** The lifeline routes set the jurisdiction's standing
  lifeline status, not which lifelines are tracked, and admins and members may
  both write; the screen does what the routes do. Messaging settings have no
  read route, so the screen cannot show the values in effect and saves both;
  it says so. No route lists notification rules or dashboard templates, so the
  rule screen has no list of existing rules and a dashboard is created from a
  typed template key, with keys in use shown; the admin guide states both.
  Checklist completion shows only on items of the signed-in position.
  Template export appears with an incident selected, which is when the
  dashboard's definition, and so its version, is loaded.
- **Defect fixed on the way.** `ActionRow` in the AAR workspace re-applied its
  saved values when it first mounted, racing an edit made before it ran, which
  made the existing "updates action progress" test flake under load.
- **Ownership deviation:** ten lines of prop threading in `Console.tsx`.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane: twelve server suites and every web test 623
  of 624 on the first run, the red being the AAR race above; after the fix, web
  530 of 530; the two new browser walks and eleven neighbouring browser walks
  passed, incident activation after a text collision was fixed. The
  notification walk sets the allowlist, is refused an unlisted URL with no
  rule row written, creates a rule, reads the secret from the clipboard,
  drains a delivery after a board write and checks the delivered HMAC against
  the secret shown. After rebasing onto W4.0 part one, W4.1 part one and W3.13,
  resolving the client, incident surface and console conflicts: ten server
  suites, every web test and the shared suite 719 of 719; the notification,
  operator screens, admin, channels, integrations, incident activation and AAR
  browser walks serial, all passed. TypeScript and ESLint clean. Link checker
  71 files. The awaiting list now holds only local board fields, owed by W4.1
  part two.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred, needing engine routes:** a list of notification rules and a
  messaging settings read.
- **Rollback:** revert the commit.

## V1 W3 milestone gate

- **Command:** `pnpm check:gate` with `OPENEOC_TEST_DB_TAG=gate` on `dfa4262`,
  with four lanes running on the same host.
- **Static gates:** TypeScript, ESLint, license scan, link checker, advisory
  gate (0 high or critical) and the desktop and installer tests all green.
- **Serial suite, red then resolved, stated plainly.** 223 of 228 files and
  1,246 of 1,258 tests passed in 1,274 seconds. Five files did not:
  - Two files, `boards-designer-browser` and `saved-dashboard-engine`, lost
    their test worker to a Windows fast-fail (exit code 3221226505,
    0xC0000409) at startup, the same host failure seen at the W1 gate.
  - Two browser walks, `app-e2e` "restores scoped workspace context" and
    `incident-workspace-browser` "responsive workspace proof", failed on
    timing under load.
  - `authorized-viewing-browser` "shows only the partner's host incident data"
    failed on an assertion.
  Per HZ-C the five were re-run alone and serial: four passed, 14 tests. The
  authorized viewing walk failed again the same way, so it was a real
  regression, not load.
- **The regression and its fix.** W3.12 added a jurisdiction dashboards panel
  to the Overview screen and rendered it for everyone given a jurisdiction,
  including an authorized partner viewer who is not a member of it. On a
  dashboard the partner may not open, the panel still listed the host's
  dashboard titles, so the walk's assertion that no dashboard content shows
  there found two. It was not a disclosure of the refused dashboard: the
  titles belonged to the dashboard the partner is authorized for. The console
  now gives the panel the jurisdiction only when the signed-in person is a
  member of it, so a partner sees only the dashboards shared with their
  incident. The authorized viewing, operator screens and dashboard browser
  walks and every web app test then passed 151 of 151.
- **Route coverage:** every operator route has a caller or a recorded reason;
  the only awaiting entry is local board fields, owed by W4.1 part two.
- **Result:** wave W3 is complete: W3.0 through W3.13 are receipted and on
  `origin/main`, and the gate is green after the recorded fix.

## V1 W4.0 part two: contacts and mass notification

- **What changed.** A per-jurisdiction contacts directory, new
  `server/src/contacts/**`: name, organization, title, up to five emails and
  five E.164 phones, optional links to a member account and a position, notes,
  an active flag; groups hold members in call-down order; members read, admins
  write, cursor-paged. CSV import, RFC 4180 parsed in-house, with header
  mapping, a dry run and an all-or-nothing commit. Mass notification, new
  `server/src/notify/mass.ts`, to a group or chosen contacts by email, SMS and
  in-app: one notification per contact and channel, email and SMS through the
  existing delivery queue so retries, dead letters and receipts apply
  unchanged, and a record per send. Receipts per contact and channel: queued,
  retrying, sent with the relay's or provider's answer, failed with the error,
  delivered in-app, and the acknowledgement state. Call-down: a new scheduler
  job notifies contacts in group order, moving on when a contact has not
  acknowledged within the interval, stopping at N acknowledgements (default 1)
  and ending "unacknowledged" after the last. New Contacts and Mass
  Notification screens under Coordination.
- **Acknowledgement link.** `GET` and `POST /api/v1/ack/:token`, no sign-in.
  Opening the link only shows an Acknowledge button and pressing it records the
  acknowledgement, so mail scanners that fetch links cannot end a call-down.
  Tokens are 128 random bits stored as a SHA-256 hash, expire 24 hours after
  their message is sent, are limited to 30 requests a minute per address, and
  the pages show nothing about the send. In-app recipients acknowledge through
  the existing notification route, carried to the recipient by a trigger.
  New optional `OPENEOC_PUBLIC_URL` sets the link base.
- **Decisions.** A mass send is not a rule, so no rule cap applies; it is
  bounded at 500 contacts per send from the admin-kept directory. Each channel
  uses the contact's first email or phone; in-app goes to the linked person,
  else the linked position. Members and admins send; viewers read. A send over
  an unconfigured channel shows as a failed receipt through the worker's dead
  letter, because members cannot read channel settings under row-level
  security. Inbound SMS reply acknowledgement was skipped: the HTTP provider
  has no inbound path. Migration 0120 recreates `scheduler_due` with a
  `calldowns` branch; the rules and briefings branches are unchanged.
- **Schema:** migration `0120_contacts.sql`: contacts, groups, group members,
  mass notifications and recipients, all with row-level security and composite
  keys keeping group members in the group's jurisdiction;
  `notifications.mass_recipient_id` and its trigger; SECURITY DEFINER
  `acknowledge_mass_token` and `mass_notification_deliveries`; the default
  table UPDATE grant on the two mass tables revoked and replaced by
  column-level grants, so the runtime role cannot write acknowledgements
  directly. Contract: 14 routes, the two acknowledgement routes auth `none`
  and machine audience; `docs/API.md` regenerated. No dependency change.
- **Verification.** In the lane: contacts, mass-notification and nine
  neighbouring suites 86 of 86; every web test and the shared suite 627 of
  627; the admin and new mass notification browser walks 3 of 3. The browser
  walk creates three contacts and a group in the screens, sends a call-down by
  email to the fake relay and SMS to the fixture, sees "250 2.0.0 Ok: queued
  as" and "fixture: not sent", runs the job with the clock eleven minutes
  ahead so the second contact is called, opens that contact's link from the
  relay's email in a separate 390 px page and acknowledges, and sees
  "Acknowledged · 1 of 3 acknowledged" with the third never called. After
  rebasing onto W3.12, resolving the contract, client and guide conflicts:
  contacts, mass-notification, notify, notify-channels, delivery-outbox,
  scheduler, retention, api-docs, ipaws, migrate-baseline, every web test and
  the shared suite passed 718 of 718; the mass notification, admin and
  notification rules browser walks serial passed. TypeScript and ESLint clean.
  Link checker 71 files.
- **Evidence level:** unit, real-database integration, browser and document.
- **Deferred:** inbound SMS acknowledgement; contacts and mass notification
  records in the jurisdiction export and in the retention classes, where their
  notifications and deliveries are already purged under existing classes;
  duplicate detection and a group column in CSV import.
- **Rollback:** revert the code; 0120 only adds, and its `scheduler_due`
  behaves as before for rules and briefings.

## V1 W4.1 part two: board screen controls

- **What changed.** The board engine's controls, in `web/src/boards/**` and
  `BoardSurface.tsx`:
  - The designer takes up to four label fields on a reference field, gains a
    Record access tab setting read and edit grants with a plain explanation of
    each, and a Local fields tab that lists a board's `x_` fields and adds new
    ones, which removed the last entry from the route-coverage awaiting list.
  - "Filter, sort and group" on the board view builds conditions over every
    view operator, up to four sort keys, one group field with counts, and the
    archived option, all applied by the server and carried by "Load more
    records"; the table's order matches the server's.
  - Record detail offers archive and restore to writers the edit rule admits,
    delete to jurisdiction admins behind a confirmation that says it is
    recorded and cannot be undone from the screen, and a "Change history" tab
    of who, position, when and each field before and after, a page at a time.
  - Export downloads the current view as CSV or Excel; import maps a file's
    headings to fields, checks the file without writing and lists every row
    error, and enables Import only after a clean check of the current file and
    mapping. New `ViewRefine.tsx`, `RecordHistory.tsx`, `BoardImport.tsx`,
    `record-access.tsx`.
  - Restricted boards: the board screen says offline sync is unavailable;
    Smart Forms marks such boards and does not queue for them; the sync client
    recognizes the refusal and keeps that work on the device without asking for
    a new session, so the continuity panel and field queue still deliver other
    boards' work. This replaces a loop of "Restore session" and the same
    refusal.
- **Deviations.** The designer cannot yet author `where`, sorts or groups into
  a template's own views; operators apply them per read, as the guide says.
  Filter settings live on the screen, not in the URL. Label fields are typed as
  keys. Import headings are read by the server's first check, because the web
  app has no spreadsheet reader. Ownership deviations: one prop in
  `TemplatesSurface.tsx`, the restricted check in `SmartFormsSurface.tsx`, the
  offline and field files, one exact tab name in `boards-designer-browser`, and
  the record context test's mock.
- **Carried forward.** The client recognizes the restricted-sync refusal by
  its message text, because the sync route answers it with the generic
  `auth_required` code and `server/src/sync/hub.ts` was owned by W4.12 during
  this unit. A distinct server code follows once W4.12 lands.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane: `board-records-browser` 3 of 3, board-engine
  18, boards 9, board-authoring 4, api-docs 3; the workspace, field, continuity,
  field reports and workflow browser walks passed; `boards-designer-browser`
  red on its first run because the new "Local fields" tab matched its search
  for "Fields", then passed with an exact match; every web test and the shared
  suite 657 of 657. After rebasing onto W4.0 part two and the W3 gate fix:
  board-engine, boards, board-authoring, api-docs, every web test and the
  shared suite 683 of 683; the board records, workspace, designer, field
  workspaces, continuity, workflow and field reports browser walks serial all
  passed. The route-coverage awaiting list is now empty: every operator route
  has a screen. TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Rollback:** revert the commit.

## V1 W4.11: Public Assistance and shelter census

- **Why this unit exists.** W3.2 left F8 partial: no engine for Public
  Assistance categories A to G or a shelter census, and the per-capita figure
  was structure loss rather than PA cost. The W4 gate expects F8 verified. The
  unit and W4.12 are added to the roster's W4 table in this commit.
- **What changed.** New `damage_pa_items`: applicant, FEMA category A to G from
  the dictionary, site, description, estimated cost in cents, insured, percent
  complete, status draft, submitted or reviewed, an optional point and an
  optional incident in the same jurisdiction. Routes list and create per
  jurisdiction and replace per item; members and admins write, members read,
  creates and edits are audited. `PA_CATEGORIES` now cites the FEMA Public
  Assistance Program and Policy Guide, FP 104-009-2, categories of work; the
  edition was not pinned and is for Basho to confirm. The damage summary adds
  PA totals by category; the per-capita figure divides PA cost once any
  submitted or reviewed item exists and structure loss until then, with the
  basis stated on screen and in the document; an optional statewide indicator
  is computed only when the operator enters both its figures, so no threshold
  is invented. The shelter census reads each shelter's latest facilities report
  where that integration runs, and the document says "Shelter census not
  available" where it does not. The declaration document gains the PA section,
  the basis line, operator-entered labels on every threshold and population
  figure, and the census. A Public Assistance tab in the Damage Assessment
  surface lists, records and edits items with totals and both indicators.
- **Defaults and deviations.** Drafts are listed but not counted; a new item
  defaults to submitted. Insurance is yes, no or not known, not an amount. An
  edit replaces every field; there is no delete route. The incident link works
  through the API only. The export keeps schema version 2 and adds a
  `publicAssistanceItems` section. The census does not mark stale reports. PA
  items are records and are not in the retention purge. Ownership deviations:
  `server/src/app.ts` passes the facilities flag to the damage routes; one row
  in `docs/guides/ADMIN.md`.
- **F8 evidence.** Real-database tests: create, edit and list; viewer 403 on
  writes, outsider 403 on reads and row-level security refusing an outsider's
  select, insert and update; totals by category with drafts excluded; the basis
  switching from structure loss to PA cost; the statewide indicator; the census
  with the integration on and "not available" off; the document sections; the
  export section, absent from another jurisdiction's export. Browser: items in
  categories A, C and F, F as a draft then submitted, totals and the PA-basis
  indicators updating, the downloaded summary carrying the PA and census
  sections, no overflow at 390.
- **Schema:** migration `0122_public_assistance.sql`, one table with row-level
  security. Contract: three routes; `docs/API.md` regenerated. No dependency.
- **Verification.** In the lane: `public-assistance.test.ts` 8 of 8; seven
  server suites 84 of 84; `damage-browser` 3 of 3; shared and web 669 of 669.
  After rebasing onto W4.0 part two and W4.1 part two: public-assistance,
  damage, facilities, export, api-docs, ipaws, list-pagination-operational,
  every web test and the shared suite 742 of 742; the damage and operator
  screens browser walks passed. TypeScript and ESLint clean. Link checker 71.
- **Evidence level:** unit, real-database, browser and document.
- **Deferred:** an incident picker on the screen, deleting PA items, stale
  marking in the census, insurance amounts.
- **Rollback:** revert the commit and drop `damage_pa_items`.

## V1 W4.12: REST record writes through the sync log

- **What was wrong.** Records written over REST changed `board_records` only.
  A live sync socket missed console edits until it reconnected, a rebuilt
  document kept old values for records already in the log, and federation
  never saw console edits.
- **What changed.** `insertRecord` and `updateRecord` in
  `server/src/boards/service.ts`, the only REST writers of record data, call
  `appendRecordWrite`, new `server/src/boards/record-sync.ts`, inside the
  writing transaction. That covers the create and patch routes, import commit,
  form submissions, EDXL, sitreps and the demo seed. Archive and restore change
  no document-visible data, workflow transitions write no record data, delete
  already logged a removal, and the hub's own checkpoint writes the table
  directly, so no update is produced twice. New SECURITY DEFINER
  `append_board_record_write`, granted only to `app_runtime`, refuses unless
  the caller made the record's latest write, stores the row under the record's
  scope, and calls `queue_federation` only for records with no incident. A new
  `afterCommit` in `withPerson` runs only after commit, and the hub applies the
  same bytes to the board-wide and incident documents and pushes them to
  subscribers. Rebuild now seeds rows per field, so a record that predates this
  change rebuilds whole; a rebuild replaying at least the snapshot threshold
  writes a snapshot; and the delete path's replay starts after the snapshot.
- **Ordering rule, stated.** Each update sets every field as a new entry with
  its own client id, above the 32-bit range Yjs gives ordinary clients, whole
  seconds in the high bits and a random draw below, strictly rising within a
  process, needing no log history. A REST write beats every sync edit made
  without seeing it; a sync edit made after the REST write reached that client
  beats it; REST writes on one instance apply in commit order; REST writes to
  one field on two federated instances settle by server clock to the second,
  then by the draw. Every copy converges on one value: deterministic, not
  wall-clock last-writer-wins. The losing sync edit stays in the log with no
  conflict entry. `docs/adr/ADR-0003-sync-architecture.md` gains the addendum.
- **Defaults.** An incident record's update carries only the fields incident
  documents show; the rest go to the board-wide log alone and are not
  federated, because a stale hidden field in the board-wide document would
  otherwise be written back over the row on the next board-wide edit. Incident
  records and deletes are not federated, consistent with W3.11; the federation
  guide now says exactly what is forwarded. Ownership deviation:
  `server/src/db/context.ts`.
- **Integration: a distinct restricted-board code.** W4.1 part two recognized
  the restricted-sync refusal by its message text. `sync/hub.ts` now throws
  `RestrictedBoardError`, the sync route sends it as code `restricted`, and the
  web client keys on the code; the board engine test asserts the error type.
- **Schema:** migration `0121_record_write_sync.sql`, one function. No route,
  contract or dependency change.
- **Verification.** In the lane: new `record-sync.test.ts`, 7 tests across two
  instances, all failing with the append disabled, the rebuild tests failing
  with the old seeding, the incident test failing without the field filter;
  sync, lifecycle, continuity, federation, delivery-outbox, board-engine,
  boards, workflow and pagination 73 of 73; a 23-file batch 140 of 140 with one
  two-database setup timeout that passed rerun; `federation-browser` 2 of 2;
  `load.test.ts` serial 4 of 4, fan-out p95 61.1 ms and maximum 63.0 ms, 32 KiB
  bulk p95 50.1 ms, 150 mixed operations p95 1,482 ms, within budget on a host
  shared with other lanes. After rebasing onto W4.0 part two, W4.1 part two and
  W4.11, with the restricted code: record-sync, board-engine, sync, lifecycle,
  continuity, federation, boards, workflow, runtime, pagination, forms, edxl,
  sitreps, api-docs, every web test and the shared suite 751 of 751; the
  delivery-outbox, federation, board records and continuity walks serial 12 of
  12. TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, integration, real-database with two instances,
  browser and document.
- **Limits:** deletes are not federated; records existing before a board was
  shared are not backfilled; a losing concurrent sync edit is not surfaced as a
  conflict; each REST write adds a log row and a client entry to the board's
  Yjs state; two instances can draw the same client id about once in 2^20
  writes to one board in one second; a REST write committing while a document
  is first being built can miss that one live update until the next apply or
  the idle document is dropped.
- **Rollback:** revert the commit and drop `append_board_record_write`.

## V1 W4.2: views beyond the list

- **What changed.** The board screen gains "Show records as": List, Kanban,
  Calendar and Chart, new `web/src/boards/BoardModes.tsx`, each reading the
  same server view under the current refinement.
  - Kanban columns come from an enum field in the enum's order with human
    labels, then other stored values, then "No value", counted by the view's
    group counts. A card moves by drag and drop or a keyboard "Move to" list as
    an ordinary record update; a refusal shows in the server's words and the
    card stays. Readers cannot move cards, and a field whose values include
    every workflow state cannot be dragged, with a note pointing to the
    record's Workflow section.
  - Calendar shows month and week, Sunday first, records on their day in the
    viewer's timezone, paged by a `between` condition over the days shown.
  - Chart draws horizontal bars of the server's group counts over any
    groupable field in design tokens, with a "Show as a table" alternative.
  - Dashboards gain a `kanban` widget, counts per column in enum order with
    empty columns, and a `calendar` widget, the next records at or after now,
    both computed on the server and offered by the configurator; the count
    chart is the existing `chart` widget as bars.
- **Defaults and deviations.** Mode, field and range are screen state, because
  the route context holds only `view` and `filter`. A workflow state field is an
  enum whose values contain every workflow state. The kanban and calendar
  widgets have no drilldown. Kanban and chart replace a refinement's group
  field, calendar its sorts. Ownership deviations: `BoardSurface.tsx`,
  `server/src/dashboards/service.ts` and `config.ts`, and the shared widget
  schemas.
- **Integration fix: archived records in widgets.** The lane found the older
  tile, chart, status and list widgets still counting archived records while
  the board's default view and the new widgets leave them out. All six widget
  queries now exclude archived records, and the widget test asserts the tile
  and the chart each drop by one when a record is archived.
- **Schema, contract:** none; shared widget schemas added. No dependency.
- **Verification.** In the lane: board-engine, boards, api-docs, dashboards,
  saved-dashboard-engine and incident-dashboard-scope 49 of 49; four browser
  walks 7 of 7 serial, including kanban drag persisted and read back, calendar
  placement in `America/Los_Angeles` where the record's UTC date is the next
  day, chart counts against a database count, and a saved dashboard with the
  three widgets; web and shared 698 of 698. With the archived fix: dashboards,
  saved-dashboard-engine, incident-dashboard-scope, board-engine, boards,
  api-docs, every web test and the shared suite 720 of 720; the board views,
  dashboard, board records, workspace and KPI browser walks serial 8 of 8.
  TypeScript and ESLint clean. Link checker 71 files.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** widget drilldown for kanban and calendar; mode state in the URL.
- **Rollback:** revert the commit.

## V1 W4.3: reporting

- **What changed.** A report builder over boards, new `server/src/reports/**`
  and `web/src/reports/**`, with migration `0124_reports.sql`.
  - A report is a saved definition over one board: columns, view conditions
    through the board engine's own `conditionSql`, up to two grouping fields,
    count and sum totals per group and overall, sort keys, and optionally one
    incident. It holds no board data. Every run reads the board as the person
    running it, so record rules and field visibility apply, and the output
    names what was left out.
  - Output as JSON for the screen, and as PDF (paged with headings on every
    page, WinAnsi Helvetica through the shared ICS PDF writer), Excel and CSV
    with the formula guard. A run reads at most 50,000 records and answers 413
    past that.
  - Schedules run through the in-process scheduler as a new `reports` job,
    interval or daily at a time in a named time zone. A due report is claimed by
    moving its next run forward under `for update skip locked`, runs as its
    owner, emails the file as an attachment through the jurisdiction's SMTP
    channel to named addresses and to contacts' first email, optionally stores
    it in Files, and records the run in `report_runs` and the audit.
  - Members read and run reports, writers build them, the owner while still a
    writer or an admin changes or deletes one, all under row-level security.
    The Reports entry in the Planning rail is shown to members only.
  - `docs/guides/REPORTS.md`, indexed from the guides README; the scheduler
    table in `deploy/README.md` gains `OPENEOC_SCHEDULER_REPORTS_MS`.
- **Defaults and deviations.** Scheduled email is sent directly, after the
  claiming transaction commits, not through the delivery queue, because the
  queue carries text bodies only. A failed send is recorded on the run and not
  retried; the next run sends a fresh report. Ownership deviations, each
  additive: `server/src/notify/smtp.ts` gains multipart attachments,
  `server/src/boards/service.ts` exports `conditionSql`, `shared/src/ics/pdf.ts`
  exports `escapeText`, and the scheduler gains the job.
- **Schema, contract, dependencies.** Migration `0124`: `reports`,
  `report_runs`, and two security definer functions, `reports_due` for the
  scheduler's work discovery and `report_email_channel` for the owner's run.
  Seven routes added to the contract and `docs/API.md`. No dependency.
- **Verification.** The integrating session re-ran the unit after its rebase
  onto `1bca393`, in lane d with tag `d`: `pnpm -r exec tsc --noEmit` exit 0;
  `pnpm exec eslint .` exit 0; `pnpm exec vitest run` over reports,
  reports-browser, notify-channels, scheduler, api-docs, boards, the shared ICS
  tests, the router test and the route-coverage test, 9 files and 55 tests
  passed, 0 failed; `node scripts/check-links.mjs` 72 files ok. The browser
  walk builds a grouped report with a sum, previews, saves, downloads PDF and
  Excel and schedules it, with light 1440 and dark 390 screenshots. The
  real-database tests cover authority by role, a definition over fields the
  author cannot use, two-level totals, rule-hidden records and columns, Excel
  read back, CSV formula guard, PDF validity and paging, a daily run across a
  daylight saving change, and a due run that emails the PDF, stores the file and
  records the run.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** chart output in a report; retry of a failed scheduled send.
- **Rollback:** revert both commits; migration `0124` adds only new objects.

## V1 W6.6: gated-module disposition

- **What changed.** `collab`, `meetings`, `tracking` and `facilities` ship
  gated, as optional integrations, recorded in the new
  `docs/adr/ADR-0009-optional-integrations.md`. `README.md` gains an
  "Optional integrations" section naming each with its `OPENEOC_INTEGRATIONS`
  value, which meets gate line 21. `docs/THREAT-MODEL.md` asset A2 notes that
  tracking and facilities are off by default and not reviewed for patient-level
  data in v1; rows B4, B13, B14 and B15 were already conditional on the setting.
- **Defaults and deviations.** The roster's default, ship gated, applied. The
  HIPAA scope follows the default the W2.9 receipt set: tracking and facilities
  do not hold patient-level data in v1. No module code changed, so the unit
  took none of its owned module directories.
- **Schema, contract, dependencies:** none.
- **Verification.** `node scripts/check-links.mjs`: ok, 72 files.
- **Evidence level:** document.
- **Deferred:** a HIPAA review before any deployment puts patient-level data in
  tracking or facilities.
- **Rollback:** revert the commit.

## V1 W5.2 part one: cache headers on the static host

- **What changed.** The Windows static host, `deploy/windows/lib/static-host.mjs`,
  sent no cache headers, so the browser had no validator for the map archives,
  glyphs and bundle files and refetched them. A new `staticCaching` rule now
  sets them for every static file:
  - files under `dist/assets`, which the build names by content hash, are
    `public, max-age=31536000, immutable`;
  - everything else, the PMTiles archives, glyphs and the overlays manifest,
    is `no-cache` with a strong `ETag` and `Last-Modified`, and an unchanged
    file answers 304 with no body;
  - a Range request whose `If-Range` names an older validator gets the whole
    file, so a map client never joins ranges from two versions of an archive.
    Byte-range serving is otherwise unchanged (HZ-F).
  The document and `/runtime-config.js` stay `no-store`.
- **Defaults and deviations.** The roster asks for content hashes on the
  archives and glyphs. Their validator is size plus modification time, not a
  digest, because hashing 1.2 GB of archives would delay every start; a
  replaced archive changes both. The bundle files carry true content hashes in
  their names. The Docker path gains its web service in W6.0, whose static
  server sets its own validators; the compose part of this unit moves there.
- **Schema, contract, dependencies:** none.
- **Verification.** `node --test deploy/windows/desktop.test.mjs`: 14 tests
  passed, 0 failed, including a new test of the year-long cache on hashed
  bundle files, `no-cache` elsewhere, 304 on a matching `If-None-Match`
  including a weak form, a new validator for a replaced archive, and `If-Range`
  honored only for the current validator or date.
- **Evidence level:** unit.
- **Deferred:** part two, the county bounds for the map's find box served from
  the bundle instead of a runtime fetch of the county GeoJSON, which waits for
  the geocoding unit to land because both touch the map's search.
- **Rollback:** revert the commit.

## V1 W4.7: field depth

- **What changed.** Smart forms gain line (`geotrace`), polygon (`geoshape`),
  barcode, photo and audio questions, cascading selects through
  `choice_filter`, and repeats, in the runner, the XLSForm importer and the
  field screen.
  - The shared runner validates each: a line needs two points, a polygon three
    distinct points and a closed ring, a select accepts only choices its
    filter allows, and each repeat entry gets its own required and constraint
    checks, reported per entry. One shared mapping, `formBoardData`, turns a
    capture into board data for both the server submit path and the offline
    queue.
  - The importer reads the new types and `choice_filter` from a real `.xlsx`
    workbook, skips metadata rows, and refuses by survey row any construct the
    runner cannot run (unknown types, `or_other`, `repeat_count`, expressions
    it cannot evaluate). `storeForm` applies the same expression check.
  - The field screen, new `web/src/field/GeometryCapture.tsx`, draws a line or
    polygon by tapping the COP map or typing points, takes a typed barcode or
    reads one from a photo where the browser has `BarcodeDetector`, and uses
    the device capture inputs for photo and audio. Cascading selects filter
    live; repeat entries are added and removed.
  - Photo and audio answers queue on the device with the report and upload
    after the record synchronizes, through the new
    `POST /api/v1/forms/records/:recordId/attachments`, which stores the file
    with the files service in the record's jurisdiction and sets the board's
    attachment field of the same name. A refused upload stays queued with the
    server's reason. `docs/guides/FIELD-USER.md` gains "Question types".
- **Defaults and deviations.** A repeat lands as a JSON array in a board text
  field named like the repeat, not as child records. A line or polygon goes to
  the geometry field of its name, or the first unfilled geometry field whose
  kind accepts it. Behavior changes, stated as deviations: a photo no longer
  needs a connection when picked; the importer now refuses constructs it used
  to skip silently. Limits: one queued file at most 10 MB, 50 MB per person per
  incident on the device. Eight audio types join the file store's allowlist.
  Ownership deviation: one line of `field-workspaces-browser.test.ts`, whose
  expected message changed with the queued photo. The unit was started by an
  earlier session's lane and finished in this one; the finishing implementer
  moved the attachment route to its own registration so `server/src/app.ts`
  took only additive lines.
- **Schema, contract, dependencies.** No migration; block `0125` unused. One
  route added to the contract and `docs/API.md`, called by the offline queue.
  No dependency.
- **Verification.** In the lane, before the rebase: `pnpm -r exec tsc
  --noEmit` exit 0, `pnpm exec eslint .` exit 0, 16 files and 88 tests passed.
  The integrating session re-ran after rebasing onto `1bfbac2`, tag `c`: tsc
  and eslint exit 0; `pnpm exec vitest run` over the shared forms tests,
  form-field-depth, forms, xlsform-reader, files, field-offline, api-docs, the
  field-depth, field-workspaces, field-reports and continuity-console browser
  walks, the web field tests, field-workspaces, field-client, route-coverage
  and reports, 17 files and 96 tests passed, 0 failed; link checker 73 files.
  The browser walk imports a workbook, fills a cascading select, draws a line
  and a closed polygon, types a barcode, attaches a photo and a voice note,
  adds two repeat entries, submits, reads both attachments back from the
  board, then queues a report with a photo offline and syncs it on reconnect,
  with light and dark screenshots at 1440 and 390.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** live-video barcode scanning (Windows Chrome has no
  `BarcodeDetector`, so only the jsdom test drives the photo read); in-page
  audio recording; a continuous GPS trace for lines; repeats as child records;
  `or_other`, `repeat_count`, `range` and other refused constructs. The
  embedded capture map shows the map panel's search icons out of place in a
  narrow container, a style defect in the map's inline styles carried to W5.1.
- **Rollback:** revert the commit; no schema to unwind.

## V1 W4.4: WebEOC migration

- **What changed.** Administrators move the records of a WebEOC board into a
  board here from the CSV file WebEOC exports. Records only: processes, views,
  links and menus are not migrated.
  - `server/src/data-packs/webeoc.ts` maps each board field to a CSV column in
    the data-pack mapping shape: the mapping sent with the request, else the
    board's saved mapping, else a match of column heading to field key or
    label.
  - A dry run reports create, skip or reject for every row and writes nothing.
    An import writes each valid row through `insertRecord`, so each record
    gets its audit entry, change history and sync log entry and appears in live
    views. Rejected rows go into a rejection CSV with row number, reasons and
    the original cells, with the formula guard.
  - WebEOC's bookkeeping columns (`dataid`, `prevdataid`, `entrydate`,
    `username`, `positionname`, `subscribername`) are kept as `source` in the
    creation audit payload. A ledger of imported dataids per board makes a
    repeat import skip rows already imported.
  - Local WebEOC dates are read in the WebEOC server's time zone, chosen by the
    operator. Choice values match ignoring case, spaces, underscores and
    hyphens.
  - The screen is a "WebEOC migration" panel on Administration, Records
    (`web/src/admin/WebeocImport.tsx`). `docs/guides/MIGRATION.md` is the
    guide chapter, indexed from the guides README.
- **Defaults and deviations.** An import writes the valid rows and reports the
  rest, where the board import is all or nothing. Imported records carry no
  incident. A bulk import sends no notifications. Limits are the board
  import's: 10,000 rows and 10 MB. Deviation from the roster wording: "onto a
  template" is done as onto a board made from a template, because records live
  in boards. Ownership deviations: `server/src/boards/transfer.ts` exports
  `coerceCell`; `server/src/boards/service.ts` `insertRecord` takes an
  optional `source` for the creation audit payload. The unit was started by an
  earlier session's lane and finished in this one, after its uncommitted work
  was rebased onto `888750a`.
- **Schema, contract, dependencies.** Migration `0123_webeoc_import.sql`:
  `webeoc_mappings` and `webeoc_imported_rows`, row-level security limiting
  both to writers of the board's jurisdiction with the board checked to belong
  to it, and select and insert grants only on the imported rows. Three routes
  added to the contract and `docs/API.md`, each called by the web client: GET
  and PUT `/api/v1/boards/:boardId/webeoc-mapping`, POST
  `/api/v1/boards/:boardId/webeoc-import`. No dependency.
- **Verification.** In the lane, tag `b`, on `888750a`: `pnpm -r exec tsc
  --noEmit` exit 0; `pnpm exec eslint .` exit 0; `pnpm exec vitest run` over
  webeoc-import, webeoc-import-browser, board-engine, boards, data-packs,
  data-pack-persistence, api-docs, admin-browser, the web admin notifications
  and webeoc-import tests and route-coverage, 11 files and 61 tests passed, 0
  failed. The first run had one red: the web test read the saved time zone one
  render early; the test now waits for it, and the whole set was re-run. The
  integrating session rebased onto `fa94a75`, which changes only the CI
  workflow, and ran `node scripts/check-links.mjs` after staging: ok, 74 files.
  The browser walk checks the fixture export (8 rows: 3 valid, 5 rejected)
  and writes nothing, saves the mapping, imports 3 records, downloads a 5-row
  rejection report and reads the records back on the board; in dark theme a
  re-check with the saved mapping skips the 3 imported dataids. Light and dark
  screenshots at 1440, dark at 390 with no horizontal scroll.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** value translation; latitude and longitude to a location;
  person, record-reference and attachment fields; incident tagging; updating a
  row already imported; linking rows by `prevdataid`; .xlsx on the screen,
  which the server already reads.
- **Rollback:** revert both commits, then drop `webeoc_imported_rows` and
  `webeoc_mappings`.

## V1 W6.5: training kit

- **What changed.** New `docs/guides/training/`: a kit index with ground rules
  (synthetic data only, gaps recorded as observations, the server enforces
  roles); eight ICS-position job aids (EOC Director, Planning Section Chief,
  Situation Unit, Operations, Logistics, Public Information Officer, Liaison
  and administrator, field user), each with account role and acting position,
  first 15 minutes, every operational period, screens used, what the product
  does not do and the guide sections to read; a keyboard tabletop on the
  synthetic demo incident with a situation manual (four modules, six
  core-capability objectives, HSEEP-shaped and not certified) and a facilitator
  guide (staff roles, pre-StartEx checklist, expected actions and evidence per
  inject, P, S, M, U ratings, hotwash, AAR steps); an instructor outline for
  half-day and full-day classes with a setup checklist and a reset by restoring
  a golden copy of the demo profile. `docs/guides/README.md` gains one row. No
  video, as the roster says.
- **Defaults and deviations.** The standard position set has no EOC Director
  or Situation Unit Leader: the director acts as Incident Commander with the
  admin role, because only an admin approves an IAP or records a new period,
  and the instructor adds a Situation Unit Leader position. Facilities is not
  used, since the optional integration is off in the demo profile; shelter play
  uses the Wildfire Shelters board. Mass notification is in-app only. The
  half-day class leaves out module four. Gaps are stated as found in the code:
  no screen field for objectives or the ICS-208 safety message; one current
  operational period per incident; Tasks cannot add a task; one seeded
  organization, so no partner play; unsubmitted JIC drafts are not listed; the
  IAP's ICS-201, ICS-211 and ICS-215 read boards, not Resources requests or
  Staffing check-ins; no radio communications template, so the ICS-205
  assembles empty; the JIC drafter's panel does not show a decision recorded in
  another session.
- **Schema, contract, dependencies:** none.
- **Verification.** The writer checked the 13 touched files with a scratch
  script: 62 relative links resolve, no anchors, no em-dashes, no roster
  identifiers; claims were checked against the named source files. The
  integrating session ran `node scripts/check-links.mjs` after staging, ok, 85
  files, and again after rebasing onto `cef613d`, ok, 86 files.
- **Evidence level:** document.
- **Deferred:** video; a separate inject-card file (cards are cut from the
  situation manual's tables); a launcher note on the admin MFA switch.
- **Rollback:** revert the commit.

## V1 W4.6: offline address search

- **What changed.**
  - `tools/basemap/build-gazetteer.mjs` builds a gazetteer from the
    OpenMapTiles street archive with the Node standard library only (a PMTiles
    v3 reader and a vector tile decoder): places, named streets with their OSM
    house numbers, and points of interest. It merges county address points from
    CSV or GeoJSON, a county number replacing the OSM number for the same house.
  - The server loads the file named by `OPENEOC_GAZETTEER_PATH` once at start
    into a word index (`server/src/geocode/**`) and answers
    `GET /api/v1/geocode/search` (query 1 to 200 characters, limit 1 to 20,
    optional `near`) for any signed-in person. A missing, null or corrupt file
    answers `available: false`; the server keeps serving.
  - The command bar gains a "Search addresses and places" combobox
    (`web/src/app/layout/PlaceSearch.tsx`, `map-focus.ts`). Choosing a result
    opens the map from any screen, centres it and marks the place.
  - `tools/basemap/README.md` gains "Offline address search gazetteer",
    `docs/guides/OPERATOR-QUICKSTART.md` an address search section, and
    `deploy/README.md` a row for `OPENEOC_GAZETTEER_PATH`.
- **Defaults and deviations.** Built from the OSM-derived `california.pmtiles`,
  because the raw California extract is not on disk. Ranking: an exact house
  number on a matching street first; then closeness of the name, with places
  before streets before points of interest among equal matches; then larger
  places, then nearness to the map centre; last, the street itself when a typed
  house number is not in the data. The builder test runs under vitest, not
  `node --test`, so it runs with the workspace suite without a configuration
  change. Ownership deviations: `Console.tsx` (+6) mounts the box;
  `MapSurface.tsx` (+3) passes the focus hook to CopMap's existing `onMap`.
  The unit was started by an earlier session's lane and finished in this one,
  after its uncommitted work was rebased onto `888750a`.
- **Schema, contract, dependencies.** No migration; block `0126` unused. One
  route added to the contract and `docs/API.md` (+4, a geocode section). New
  configuration `OPENEOC_GAZETTEER_PATH`. No dependency.
- **Verification.** In the lane, tag `a`: `pnpm -r exec tsc --noEmit` exit 0;
  `pnpm exec eslint .` exit 0; `pnpm exec vitest run` over the builder test,
  geocode-routes (real PostgreSQL: 401 anonymous and bad token, address first,
  limit 50 is 400, missing and null paths unavailable), place-search-browser,
  the layout tests, map-surface, route-coverage, the contract test and
  api-docs, 10 files and 64 tests passed, 0 failed. The integrating session
  rebased onto `492f1f1`, which carries the WebEOC importer's routes, and ran
  tsc and eslint exit 0, `pnpm exec vitest run` over api-docs, route-coverage,
  the contract test and geocode-routes, 4 files and 19 tests passed, and
  `node scripts/check-links.mjs` ok, 86 files. The browser walk searches
  "816 3rd street eureka" from Boards and lands on the map at the address,
  ranks the city Eureka above Eureka Way, keeps the place through a theme
  change, and at 390 wide keeps the result list inside the viewport, with no
  page errors or external requests; light and dark screenshots. The walk found
  the result list running off a 390-wide screen; fixed. Real data: a
  California build read 212,094 z14 tiles in 36.4 s and wrote 144,343,915
  bytes (7,636 places, 511,673 streets, 308,390 points of interest, 3,230,662
  house numbers, 41,646 dropped with no named street near). Loading it takes
  2.6 s and adds about 233 MB (heap 64, external 169); median search 0.44 ms,
  maximum 12.7 ms over ten queries.
- **Evidence level:** unit, integration, real-database, browser, document and
  a measured build on real data.
- **Deferred:** reverse lookup; the county address point merge against real
  county data, which is not on disk; house numbers attached by containment
  rather than to the nearest named street in the tile; the containing city
  rather than the nearest settlement; "St" as "Saint".
- **Rollback:** revert both commits; unsetting `OPENEOC_GAZETTEER_PATH` alone
  turns search off.

## V1 W4.8: resources

- **What changed.** A NIMS resource typing catalog, a resource pool with
  demobilization, and a cost rollup in Resources.
  - The catalog holds five starter kinds from the shared dictionary
    (`shared/src/dictionary/resource-typing.ts`): Incident Management Team,
    Engine, Water Tender, Hand Crew and Dozer, citing NIMS Third Edition (2017)
    and NWCG PMS 200 and stating that they are not RTLT titles or IDs. An
    administrator adds local kinds and imports definitions from an RTLT CSV
    export (`server/src/resource/typing.ts`): header synonyms; type levels as
    digits, "Type n", Roman numerals or "Single Type"; rows grouped by RTLT
    ID; all or nothing with up to 20 row errors shown; a new import replaces
    the previous one; a source note required; 5,000 rows and 5 MB.
  - A request may name a kind and the least capable type that fills it. Kind
    and type are checked on every request and pool write.
  - Pool statuses are available, assigned, out of service and demobilized,
    moved by a table in the dictionary. Assignment needs a request in sourcing,
    assigned or deployed, of the same kind, asking for a type the resource
    meets or betters; a request on a closed incident answers 409, and leaving
    assigned stays allowed. Demobilization is final and records the return
    condition and the checks made, which are this project's own short list,
    not ICS-221 text. Every move is audited.
  - Each request's recorded cost total rides on the request list; the screen
    totals it per request, per kind and overall, and export stays on the
    existing CSV route.
  - `docs/guides/OPERATOR-QUICKSTART.md` gains "Type resources, keep the pool
    and demobilize".
- **Defaults and deviations.** No section 7 item applies. Against the
  implementer's own design: no separate cost route, since `costCents` on the
  existing request list meets "surfaced from the existing routes"; no status
  event table, since the append-only audit log holds every move and the
  resource row holds the demobilization record; the starter kinds carry empty
  capability text rather than invented text. Pool and catalog reads are
  members only, as the existing resource request routes are; guest read of the
  resource module is a named gap against the FOUO access model, deferred as a
  module-wide change.
- **Schema, contract, dependencies.** Migration `0127_resource_typing.sql`:
  `resource_kinds` (members read, admins insert and delete), `resources`
  (members read, writers insert and update, checks tying assigned to a request
  and demobilized to a return condition and date), and nullable
  `resource_kind` and `resource_type` on `resource_requests`, all under
  row-level security. Six routes added to the contract and `docs/API.md`. No
  dependency.
- **Verification.** In the lane, tag `c`, on `888750a`: `pnpm -r exec tsc
  --noEmit` exit 0; `pnpm exec eslint .` exit 0; `pnpm exec vitest run` over
  resource-typing, resource-typing-browser, resource, resources-browser,
  jic-resources-browser, incident-resource-scope, export, api-docs,
  resources-surface, route-coverage, the web client test, the shared dictionary
  test and the shared resource lifecycle test, 13 files and 87 tests passed, 0
  failed; link checker ok, 73 files. The real-database tests cover authority by
  role and for outsiders (403, and 404 on a resource they cannot see), catalog
  rights and the duplicate local kind 409, all-or-nothing import and
  replacement, kind and type checks, valid and invalid moves with
  demobilization final, the assignment rule, the closed-incident 409 and cost
  totals on the incident-scoped list. The browser walk imports two RTLT
  definitions, pools, assigns and demobilizes a typed engine and reads the
  rollup, with light and dark 1440 and dark 390 screenshots. The integrating
  session rebased onto `4630771`, which carries the WebEOC importer and
  address search routes, and ran tsc and eslint exit 0, `pnpm exec vitest run`
  over api-docs, route-coverage, the contract test, resource-typing and
  resource, 5 files and 29 tests passed, and the link checker ok, 86 files.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** the full RTLT dataset (no download is available, a named gap);
  a per-resource history view; a cap on resources per request against its
  quantity; editing or deleting local kinds; changing a pool resource's kind or
  type; guest read of the resource module.
- **Rollback:** revert both commits; migration `0127` adds only new tables and
  two nullable columns.

## V1 CI stability: the deep-link race and the recurring red runs

- **Why.** Basho, 2026-09-23: the pushes to `main` showed red CI runs nearly
  every time. Forty failed runs were tallied by failing line. Every failure
  was one of six places: `app-e2e.test.ts:783` (13 runs),
  `facilities-browser.test.ts:187` (12), `load.test.ts:286` (8),
  `boards-workspace-browser.test.ts:191` and `192` (8),
  `esf-workspace-browser.test.ts:121` (3) and
  `authorized-viewing-browser.test.ts:167` (2). A plan to leave the Chromium
  walks and the load benchmark out of hosted CI was refused by the session's
  safety check as a CI bypass and reverted; this unit fixes the causes
  instead, and no test was removed or skipped.
- **What changed.**
  - A product defect, `web/src/app/layout/context.tsx`: the workspace settings
    loader read the route when it started loading and, when the load finished,
    wrote that stale route back into the address. A deep link that arrived
    meanwhile lost its record, filter and operational period. On a slow
    machine the loader lost the race often, which is the `app-e2e` failure
    (the record parameter vanished, so "Record unavailable in this view" never
    rendered) and a likely cause of the `boards-workspace` filter wait. The
    loader now reads the route when the load finishes.
  - `facilities-browser.test.ts` polled only until the facility appeared on
    the map, then read the inspector while the map's polled layer could still
    carry the status before the report; it now polls until the reported
    status shows.
  - `boards-workspace-browser.test.ts` counted a filtered-out row before the
    filter applied ("Support staging" is on the unfiltered list too); it now
    waits for the row to leave.
  - `authorized-viewing-browser.test.ts` counted the previous dashboard's text
    in the same tick as the refusal rendered; it now waits for it to unmount.
  - `load.test.ts` stopped after 40 rounds of 32 KiB updates, about 1.7 MB,
    which Linux loopback's socket buffers can absorb before the server queues
    anything, so the stalled reader was sometimes never shed there. The rounds
    now run until the reader is shed, up to 200. The latency bound is
    unchanged.
  - Earlier in the session, `fa94a75`: the CI secret scan could not list a
    pull request's commits (403 "Resource not accessible by integration") and
    failed on every pull request; the job now has read access to pull
    requests, and a newer push to a branch cancels its run in progress.
- **Defaults and deviations.** The `esf-workspace-browser` beforeAll wait was
  not reproduced and is left as it is; if it recurs, its failure names the
  missing "ESF coordination" button. Ownership: `web/src/app/layout/context.tsx`
  sits in the address search unit's territory, which had landed.
- **Also found.** Since `12d430e` GitHub starts no CI job on this repository:
  "The job was not started because recent account payments have failed or
  your spending limit needs to be increased." The repository is private, so
  Actions minutes are billed; each run of the check job takes about 22 minutes
  and forty runs were recorded in a day. Restoring billing is Basho's account
  action. From here the integrating session pushes landings in batches rather
  than one push per commit.
- **Schema, contract, dependencies:** none.
- **Verification.** Tag `main`, with three lanes running tests on the same
  machine: before the fix, `pnpm exec vitest run
  server/src/__tests__/app-e2e.test.ts` failed at line 783 as CI did, and a
  state dump showed the address without its `record` parameter; a new jsdom
  test, "keeps a deep link that arrives while the workspace settings are still
  loading", ended with `period=1` and no record or filter before the fix.
  After it: `pnpm exec vitest run` over app-e2e, facilities-browser,
  boards-workspace-browser, authorized-viewing-browser and shell-context with
  `--maxWorkers=1`, 5 files and 15 tests passed, 0 failed;
  `pnpm exec vitest run server/src/__tests__/load.test.ts --maxWorkers=1`, 1
  file and 4 tests passed; `pnpm -r exec tsc --noEmit` exit 0; `pnpm exec
  eslint .` exit 0. Hosted CI could not confirm, for the billing reason above.
- **Evidence level:** unit, browser and real-database.
- **Deferred:** the `esf-workspace-browser` wait; confirmation on hosted CI
  once billing is restored.
- **Rollback:** revert the commit.

## V1 W5.2 part two: county bounds from the bundle

- **What changed.** The map's find box looks up county names in
  `web/src/cop/county-bounds.ts`, a generated table of the 58 California
  county boxes (west, south, east, north; four decimals, rounded outward so
  each box contains its county), instead of fetching
  `basemap/ca_counties.geojson` at run time. `tools/basemap/build-county-bounds.mjs`
  (Node standard library only) regenerates it from the tracked GeoJSON, and
  `tools/basemap/README.md` names the command.
- **Defaults and deviations.** The row's "county outline served from the
  bundle" is read as the find box's county data; the county outline layer in
  the map style is unchanged. Behavior change: county search no longer needs a
  bundled basemap to be mounted, so it also works under an external style.
  Ownership deviation: an additive county assertion in
  `server/src/__tests__/cop-e2e.test.ts`, since no walk searched for a county.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, tag `c`: `pnpm -r exec tsc --noEmit` exit 0;
  `pnpm exec eslint .` exit 0; `pnpm exec vitest run web/src/cop/__tests__
  server/src/__tests__/cop-e2e.test.ts --maxWorkers=2`, 14 files and 91 tests
  passed, 0 failed; link checker ok, 86 files. `county-bounds.test.ts` pins
  the table to the GeoJSON: the same county set, and every edge outside the
  true bounds by less than 0.0001 degree. The COP walk searches "Sacramento"
  with no basemap mounted, opens the county result, waits for the map centre
  inside the Sacramento box and asserts no request for the county file; the
  old code returned no county there, because the table was empty without a
  mounted basemap. The integrating session rebased onto `d0fc85b` and re-ran
  the county-bounds test (1 passed) and the link checker (ok, 86 files).
- **Evidence level:** unit and browser.
- **Deferred:** the find-box and layer-filter icons are anchored to the bottom
  of their form in `web/src/cop/cop-workspace.css`, so they drop over an open
  results list; carried to W5.1 with the defect the field depth receipt
  recorded.
- **Rollback:** revert the commit; the county file is still served, so the
  runtime fetch returns unchanged.

## V1 CI stability part two: a linked record outside the loaded rows

- **What was wrong.** The incident lifecycle lane's integration run failed the
  same `app-e2e.test.ts:783` wait after the workspace loader fix had landed.
  A state dump showed the address again without its `record` parameter, but
  with `incident` and `period` intact. The second writer: when a board's
  table finished loading, the design kit's `OperationalTable` reconciled its
  selection to the loaded rows and reported the change, and `BoardView` turned
  that report into a navigation without the record. A record opened by link
  that is not among the loaded rows (another incident's record, a record on a
  later page, one a filter hides) lost the link whenever the table loaded
  before the record detail answered.
- **What changed.** `web/src/boards/BoardView.tsx` ignores the table's
  "rows-reconciled" report when the selection is the route's opened record;
  only the operator's own row choice changes it. The kit table is unchanged,
  since its reconciling is right for bulk selection.
- **Schema, contract, dependencies:** none.
- **Verification.** Tag `main`: a new jsdom test in
  `web/src/boards/__tests__/workspace.test.tsx`, "keeps a linked record that
  is not among the loaded rows", failed on the old code (the select callback
  was called once) and passes with the change; `pnpm exec vitest run
  web/src/boards/__tests__ web/src/app/__tests__/board-record-context.test.tsx`,
  7 files and 56 tests passed; the web package's tsc exit 0; `pnpm exec
  vitest run` over app-e2e, boards-workspace-browser, board-records-browser
  and board-views-browser with `--maxWorkers=2`, 4 files and 10 tests passed.
- **Evidence level:** unit and browser.
- **Rollback:** revert the commit.

## V1 W4.9: incident lifecycle

- **What changed.** Incident archival, a jurisdiction master view and an
  opt-in per-incident lockdown, in `server/src/incidents/**` and
  `IncidentsSurface.tsx`, with migration `0128_incident_lifecycle.sql`.
  - An administrator of the owning jurisdiction archives a closed incident
    and unarchives it. An archived incident leaves the default incident list
    and so the command bar's incident choices; the list and the master view
    take `archived=exclude|include|only`. Nothing is deleted: an archived
    incident stays readable to those who could read it, and closure keeps it
    read-only. Archive and unarchive are audited.
  - The master view, `GET /api/v1/jurisdictions/:id/incidents/overview`, is
    for members (admin, member, viewer). It lists every incident the
    jurisdiction owns, newest first and keyset-paged, each with status, kind,
    opened and closed times, the current operational period, open resource
    requests, open tasks, board records, participating organizations and the
    lockdown state, from one SQL statement under the reader's row-level
    security. Incident Setup shows it as a kit table with archive, unarchive,
    lock and lift actions for administrators.
  - Lockdown carries forward the per-incident scope the historical receipt
    "VEOC-66: Incident lockdown (guest/public read suspended)" deferred, under
    the FOUO access model: off by default, never automatic, applied and lifted
    only by an administrator, and audited. `has_guest_scope` keeps its body and
    also refuses a board scope while any incident that board is attached to is
    locked, so every guest read of the incident's boards, records, record
    workflows and rules is refused at the row-level security wall. Members and
    participating organizations do not pass through that helper, so their
    access does not change. The list, the master view and the incident's setup
    panel show the lockdown.
  - `docs/guides/ADMIN.md` gains "Archive and lock down an incident";
    `OPERATOR-QUICKSTART.md` gains one bullet.
- **Defaults and deviations.** Only a closed incident is archived; a repeated
  change answers 409, as close does. Lockdown works per board and fails closed
  for a board shared with an unlocked incident; any incident state may be
  locked. Rollups: finished requests are the dictionary's terminal states, so
  drafts count as open; records are non-deleted records on the incident's
  boards; organizations are distinct active participant organizations, the
  owner not counted; the period is the latest area revision's. The Incidents
  surface is now always 1320 wide so the table fits. Ownership deviation,
  additive: `web/src/app/__tests__/incidents-surface.test.tsx` gains the
  overview mock and a master view case. The integrator's lockdown default
  (guest read only, opt-in) was set in the brief because the FOUO decision
  gives authorized guests full access by default; Basho may override it.
- **Schema, contract, dependencies.** Migration `0128`: `archived_at`,
  `archived_by`, `locked_at`, `locked_by` on `incidents`, three check
  constraints, a paging index and a partial index on locked incidents, and
  the replaced `has_guest_scope` with a pinned search path and qualified
  names. Five routes added to the contract and `docs/API.md`; the list route
  gains the `archived` filter. No dependency.
- **Verification.** In the lane, tag `b`, on `cef613d`: tsc and eslint exit 0;
  `pnpm exec vitest run` over 21 files (the new lifecycle and lifecycle-browser
  tests; incidents, incident-area, participation, board, dashboard and resource
  scope; activation, workspace and operator-screens walks; app-e2e;
  authorized-viewing; authz; tasks; api-docs; the shared contract test;
  incidents-surface; client; incident-context; route-coverage): 19 files
  passed; incident-area lost its worker to exit 3221226505 and passed 7 of 7
  alone; app-e2e failed at line 783, which led to the two CI stability fixes
  above. The integrating session rebased onto `aaa7a65` and ran tsc and
  eslint exit 0, and `pnpm exec vitest run` over app-e2e, incident-lifecycle,
  incident-lifecycle-browser, api-docs and route-coverage, 5 files and 16
  tests passed; link checker ok, 86 files. The real-database tests cover
  authority by admin, member, viewer, guest, outsider and partner; the archive
  rules; master view counts on a seeded incident and paging with a forged
  cursor refused; and the row-level security proof that a guest reads an
  incident's board and records unlocked and none locked, while a member reads
  both and a participant is unaffected. The browser walk closes, archives,
  filters and locks, with light and dark 1440 and dark 390 screenshots.
- **Evidence level:** unit, integration, real-database, browser and document.
- **Deferred:** a guest's live board socket opened before a lock keeps
  receiving pushes until reload, as with a revoked grant today (the sync hub
  checks access at join); no console-wide lockdown banner; no index on
  `resource_requests(incident_id)`.
- **Rollback:** revert both commits; a database that ran `0128` needs a
  forward migration restoring the earlier `has_guest_scope` body.

## V1 W6.0: one-command server install

- **What changed.** `deploy/install.sh` takes a Linux host with Docker to a
  working sign-in page over HTTPS in one command. It checks Docker, the
  compose plugin, the daemon, `curl` and `sha256sum`; generates secrets into
  `deploy/.env` on the first run and never prints them; records
  `OPENEOC_DOMAIN` and the certificate choice (an ACME email, or a supplied
  pair copied to `deploy/tls/`); fetches the archives listed in `SHA256SUMS`
  from `OPENEOC_BASEMAP_URL` and checks every listed file on every run,
  refusing a mismatch or a name with a path; writes `runtime-config.js`
  naming only the archives that passed; starts the database and sets the
  runtime role's password; runs `bootstrap` only when no instance admin
  exists, with a generated password kept in `deploy/admin-password.txt`
  (mode 600) once the admin is created; starts the stack and waits for the
  page and a 401 from the API over HTTPS. A re-run keeps the secrets and does
  not bootstrap again.
  - The compose stack gains `web`: Caddy (`caddy:2.10.0-alpine`), built from a
    new `web` target of `deploy/Dockerfile`, terminates TLS, redirects HTTP,
    proxies `/api/` with its WebSocket streams, and serves the bundle and the
    archives. Its cache rules match the Windows static host: hashed `/assets/`
    immutable for a year, other static files `no-cache` with ETag and
    Last-Modified, the page and runtime config `no-store`; byte ranges and
    If-Range come from `file_server`, and nothing is compressed. All three
    services keep the observability unit's log rotation. This carries the
    compose half of W5.2.
  - New `deploy/Caddyfile`, `deploy/Dockerfile.dockerignore` (keeps `.env`,
    host `node_modules` and archives out of the build context, which the old
    `COPY . /app` would have included) and `deploy/.gitignore`.
    `deploy/README.md` rewrites the install section and adds Certificates, Map
    archives, Caching, the offline boundary and configuration rows. The root
    `README.md` status bullet that said the Docker path had no web service,
    TLS or bootstrap now states the offline-only validation.
- **Defaults and deviations.** One Caddy service serves the static files and
  the proxy, where the roster names a web service and a proxy. The API port is
  published on loopback only. `OPENEOC_TRUST_PROXY` defaults to `uniquelocal`.
  Compose refuses to run without `OPENEOC_DOMAIN` and `OPENEOC_TLS`, so an
  older install re-runs `install.sh` once. The admin password is generated,
  not supplied. No default archive URL exists because no release is
  published; a `SHA256SUMS` fetched from the release guards against
  corruption, not substitution, and a trusted local copy is used when present.
  `OPENEOC_GAZETTEER_PATH` defaults to `/basemap/gazetteer.tsv` in compose.
- **Schema, contract, dependencies.** No schema or contract change. Adds the
  `caddy:2.10.0-alpine` image, Apache-2.0.
- **Verification.** In the lane, tag `a`: `pnpm -r exec tsc --noEmit` exit 0;
  `pnpm exec eslint .` exit 0; `pnpm exec vitest run deploy/install.test.mjs`,
  1 file and 5 tests passed, covering the first run and a re-run with stand-in
  `docker` and `curl`, no secret in the output, a checksum mismatch that
  leaves no file, refusals without a host name, with a bad host name, without
  a certificate choice and with a path in `SHA256SUMS`, a supplied pair with
  the bundled basemap fallback, and the Caddyfile cache rules; `bash -n`
  clean; `docker compose config` exit 0 with the variables set and exit 1
  with the named message without them. The integrating session rebased onto
  `79ecd8c` and re-ran the install test (5 passed) and the link checker (ok,
  86 files).
- **Evidence level:** unit and document. No image was built or pulled, Caddy
  has not parsed the Caddyfile (no binary on this machine), and no
  certificate was issued: those are outbound actions. The first real run on a
  Linux host is Basho's external action; the supplied-pair expansion of
  `tls {$OPENEOC_TLS}` is the first thing to watch on it.
- **Deferred:** the Overture release sidecar on the Docker path; resuming an
  interrupted download; the HTTP/3 port; the first real run.
- **Rollback:** revert both commits; the database and blob volumes are
  unchanged, and the `caddy-data` and `caddy-config` volumes can be removed.

## V1 W4 gate: parity reconciliation and the WebEOC side-by-side

- **What changed.**
  - `docs/VEOC-PARITY-MATRIX.md` and `docs/FACET-STATUS.md` are reconciled to
    the V1 ledger receipts through `57b0287`, citing receipts by heading. The
    six gate rows F1, F4, F7, F8, F13 and G-TILES are verified, each stating
    what is not claimed. F3 moves from verified to partial, because the
    receipts "V1 W3.11: engine gaps the screens exposed" and "V1 W4.12: REST
    record writes through the sync log" state that incident-tagged record
    edits and deletes do not federate. G-MFA moves from open to partial: TOTP
    is done and SAML waits on Basho's identity-provider decision. R2 names
    only the live-credential gate. F9, F18, G-INGEST, G-CATALOG and G-PARCELS
    carry updated evidence and owners.
  - New `docs/WEBEOC-SIDE-BY-SIDE.md`, indexed from `docs/README.md`: a
    17-task evaluation script across WebEOC's board, notification and
    reporting modules, with the OpenEOC steps by real screen label, the
    expected result, the internal run's result and evidence per task, and the
    gaps found.
  - New `server/src/__tests__/webeoc-side-by-side-browser.test.ts`: one Chrome
    walk on real PostgreSQL following the script in order.
- **Defaults and deviations.** The WebEOC column rests only on the research
  document and the parity matrix, since no network was used. Tasks 9
  (permissions) and 14 (escalation), and parts of tasks 1, 4 to 7 and 17,
  cite existing walks rather than repeating them; at least one step of each
  module runs in the new walk. F3 changed although it is not a gate row,
  because its receipts state the bound. The matrix has no rows yet for
  incident archival, the master view, lockdown or the installable web app;
  F12, G-INCSCOPE, AR7 and INV-3 were left as they stood, and the
  reconciliation unit `86+D35` adds or updates them. `README.md` and
  `ROADMAP.md` are left to that unit.
- **Gaps the run found,** recorded in the script: a board created on the
  Templates screen is missing from Boards and the rule and report pickers
  until reload; outside activation no screen creates a board from an already
  published template; a notification rule cannot be listed, changed or
  removed; rule emails and texts read as system text; no voice channel, and
  Teams or Slack only as a generic webhook; low-contrast plain buttons in the
  dark theme; the report table cuts its last heading at 390 wide; status
  values show as stored codes in the list and report.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, tag `d`, on `57b0287`: `pnpm -r exec tsc
  --noEmit` exit 0; `pnpm exec eslint .` exit 0; `pnpm exec vitest run
  server/src/__tests__/webeoc-side-by-side-browser.test.ts`, 1 file and 1
  test passed. Among its assertions: group counts, kanban columns, CSV
  headers over four rows, a WebEOC import of one record with one rejected and
  its dataid kept, record history, a status-change rule delivering one email
  and one SMS, a broadcast delivering four with receipts, report totals, a
  PDF carrying the sums and a stored daily schedule; light and dark 1440 and
  one 390 screenshot, no page errors, no external requests. The integrating
  session rebased onto `2728957`, which carries the incident lifecycle and
  server install units, re-ran the walk (1 file, 1 test passed) and ran the
  link checker (ok, 87 files).
- **Evidence level:** real-database, browser and document.
- **Deferred:** the eight gaps above; the W4 milestone suite, which runs once
  the installable web app unit lands, since it closes wave W4.
- **Rollback:** revert both commits.

## V1 W5.0: code splitting

- **What changed.**
  - `Console.tsx` loads all 35 center surfaces, the board record pane and the
    continuity panel with `React.lazy` behind `Suspense`, using the kit's
    `Loading`. The place search reaches the map focus store by a dynamic
    import. MapLibre's stylesheet moves from `main.tsx` into `CopMap.tsx`, so
    it loads with the map, and the two MapLibre overrides in
    `web/src/design/base.css` now start with `.maplibregl-map` so they still
    win over the later stylesheet in the dark theme.
  - After the console appears it loads the remaining surface modules in the
    background, one at a time, so a screen this page load never showed still
    opens after the network drops. Loading all forty at once starved the
    console's own API calls on HTTP/1.1; one at a time does not.
  - `scripts/bundle-budget.mjs` builds with Vite's API into a temporary folder
    without `web/public`, sums the entry and every chunk it imports statically,
    gzipped, and fails over 300 kB. Run it with
    `pnpm --filter @openeoc/web bundle-budget`.
- **Defaults and deviations.** Plain dynamic imports, no `manualChunks`, no
  service worker. `router.tsx` and `vite.config.ts` needed no change. The
  budget is not part of `pnpm check`, because it needs a Vite build that
  hosted CI does not otherwise run. Ownership deviations: `CopMap.tsx` (the
  stylesheet import), `base.css` (two selectors) and one added test in
  `continuity-console-browser.test.ts`.
- **Schema, contract, dependencies:** none.
- **Verification.** First-load JavaScript, measured as the manifest entry plus
  its static imports, each gzipped at zlib's default level, 1 kB = 1000
  bytes: 657.6 kB in one chunk before, 159.8 kB in ten chunks after (index
  92.3, shared 45.9, hooks 8.6, Icon 4.4, react 3.0, router 2.1, tokens 1.2,
  session 1.1, components 0.9, jsx-runtime 0.3). MapLibre (280.3 kB) and the
  Yjs field tree (26.4 kB) now load on demand. In the lane, tag `c`, on
  `e3660f7`: tsc and eslint exit 0; 11 walk files (app-e2e, cop-e2e,
  boards-workspace, field-offline, field-workspaces, continuity-console,
  place-search, cop-kpi, dashboard, admin, route-coverage) with
  `--maxWorkers=2`, 19 of 20 tests passed, the one failure being the
  `app-e2e.test.ts:783` race that "V1 CI stability part two" fixed on `main`;
  web unit tests 593 of 593 on the first run and 592 of 593 on the last, with
  `standing-lifelines.test.tsx` passing 2 of 2 alone; the new offline test
  fails with the background loading turned off. The integrating session
  rebased onto `bc64e68` and ran tsc and eslint exit 0, the budget script
  (159.9 kB, under 300 kB), and `pnpm exec vitest run` over app-e2e,
  incident-lifecycle-browser, webeoc-side-by-side-browser and
  continuity-console-browser, 4 files and 8 tests passed.
- **Evidence level:** unit, browser, real-database and build.
- **Deferred:** an error screen for a surface that fails to load before the
  background loading reaches it, left to the installable web app unit's
  precache.
- **Rollback:** revert both commits.

## V1 W6.1: versioning and upgrade

- **What changed.**
  - Every package carries version `0.9.0`, and `GET /api/v1/health` reports
    the server package's version.
  - `CHANGELOG.md` at the root records the `0.9.0` evaluation build from the
    receipts, in Keep a Changelog shape (Added, Changed, Security, Known
    limits), with no unit IDs.
  - New `deploy/upgrade.sh` checks the install, prints the running version and
    runs `backup.sh`; it changes nothing unless the dump ends with pg_dump's
    completion line and the file archive passes `gzip -t`. It then builds,
    brings the stack up, waits up to five minutes for `/api/v1/ready`, and
    prints the old and new versions and the backup. No switch skips the
    backup.
  - `backup.sh` writes private files (`umask 077`) under `.part` names until
    each succeeds. `restore.sh` refuses an incomplete dump before dropping
    anything, then replays it in one `psql --single-transaction` with
    `ON_ERROR_STOP=1`; before, a failed restore still printed "restore
    complete".
  - The Windows launcher dumps an existing profile database to
    `backups/pre-upgrade-<UTC>.sql` before a newer build migrates it, and does
    not migrate if the dump fails or is empty
    (`deploy/windows/lib/pre-upgrade-backup.mjs`).
  - New `docs/guides/UPGRADE.md`, indexed from the guides README and pointed
    to from `ADMIN.md` and the deploy README: what upgrades in place, the
    pre-release baseline boundary in operator language (a database created
    before the baseline is refused by the migration guard and must be
    exported and re-imported into a fresh install), what is not supported
    (downgrade, skipping the backup, two API processes on one database), and
    upgrade and rollback steps for both paths with the drill's numbers.
- **Defaults and deviations.** One version everywhere, `0.9.0`; `1.0.0` and
  the tag are Basho's release act. The backup has no override. The `backup.sh`
  and `restore.sh` fixes and the plain-SQL desktop dump go beyond the roster
  wording, so a failed backup or restore cannot pass for a good one and one
  restore command serves both paths. The upgrade statement is its own guide.
  The version is visible on the unauthenticated health route, because the
  upgrade script reads it to confirm the upgrade; Basho may prefer it only on
  the metrics route. Ownership deviations: `server/src/app.ts` (the health
  version) and `server/src/__tests__/security-headers.test.ts`, which asserted
  the old health body and failed before the server change.
- **Schema, contract, dependencies.** No migration. The contract is
  unchanged; the health response gains `version`. No dependency.
- **Verification.** In the lane, tag `a`, on `bc64e68`: tsc and eslint exit 0;
  `pnpm exec vitest run` over restore-drill, security-headers, observability,
  cors, upgrade, migrate-baseline, `deploy/upgrade.test.mjs` and
  `deploy/install.test.mjs`, 8 files and 37 tests passed, 0 failed;
  `pnpm test:desktop` 21 passed. The upgrade tests cover the backup running
  before any build or restart, refusal on a failed or empty backup, the backup
  path printed when the API does not come up, refusal of an `.env` from
  before the HTTPS install, and a restore. Restore drill on the PostgreSQL
  16.15 test cluster through `freshDb` twice: 112 tables and 13,831 rows
  (5,003 board records) restored row for row with sequences, from standard
  input (the Docker form) and from a file (the desktop form); `pg_dump` 425
  ms, 1.9 MB plain and 0.2 MB gzipped; restore 2,982 ms and 2,889 ms; migrate
  on the restored database applied nothing; a member read the restored board
  through the app. The integrating session rebased onto `f53effd` and ran tsc
  and eslint exit 0, the link checker after staging (ok, 89 files), `node
  --test` on the desktop and installer tests (21 passed), and `pnpm exec
  vitest run` over security-headers, both deploy tests and restore-drill, 4
  files and 20 tests passed. The drill needs the PostgreSQL client tools: it
  uses `OPENEOC_PG_DIST` or `deploy/test-runtime/out/pgsql`, else `PATH`; a
  lane worktree has neither, so `OPENEOC_PG_DIST` was pointed at the
  canonical checkout's runtime.
- **Evidence level:** unit, real-database and document. No Docker upgrade on a
  Linux host and no real desktop profile upgrade were run.
- **Deferred:** the installer's version defaults (`0.0.0` in
  `Stage-Installer.ps1`, `Build-Installer.ps1`, the `.iss` file and the
  installer README), set with `-Version` at release by the installer rebuild
  unit; the setup program does not stop running profiles before replacing
  files, documented as a manual step; a first real upgrade on each path.
- **Rollback:** revert both commits; no schema to unwind.

## V1 W4.13: gaps the WebEOC side-by-side run found

- **Unit wording (added during execution).** Gaps the WebEOC side-by-side run
  found: a board created from the Templates screen reaches the Boards list and
  the rule and report pickers without a reload; a screen creates a board from
  an already published template; notification rules are listed, changed,
  paused and removed; rule messages read in human labels; stored enum values
  show as their labels in the list and the report; and a live guest board
  socket stops receiving once the guest's grant is revoked or the incident is
  locked. Acceptance: each has a test that fails before the fix. Gaps 6 (dark
  theme plain buttons) and 7 (the report table's last heading at 390 wide) go
  to W5.1; gap 5 (voice, Teams and Slack channels) is out of scope.
- **What changed.**
  - The console reads its board list again when Templates creates a board.
    Templates gains "Create a board from a published template", over a new
    `GET /api/v1/templates` catalogue.
  - The Notifications tab lists rules with Pause, Change and Remove, over
    `GET /api/v1/jurisdictions/:id/notification-rules` (cursor paged) and
    `PATCH` and `DELETE /api/v1/notification-rules/:ruleId`, for jurisdiction
    admins as create is. Changes and removals are audited as
    `notification.rule_changed` and `notification.rule_removed`; removal is a
    soft delete (`removed_at`) because notifications and outbox rows point at
    the rule.
  - Email, SMS, push and in-app text uses the board title, the record's first
    text field, field labels and value labels, for example "Shelter status
    record updated: McKinleyville Library" and "Status: Closed (was
    Normal)", and spells out only fields every reader of the board may see.
    Webhook bodies are unchanged.
  - Enum values show as labels in the board list, group counts, and the
    report screen, PDF and Excel, through a shared `choiceLabel` in the
    dictionary.
  - After a guest grant revocation or an incident lock commits, every live
    guest board socket is checked again under row-level security and closed
    with `auth_required` if access is gone; a member's socket stays open.
  - `docs/WEBEOC-SIDE-BY-SIDE.md` marks the closed gaps with their tests;
    `docs/guides/ADMIN.md` documents rule management and drops two stale
    sentences (no rule list; the lockdown socket caveat); `DESIGNER.md` notes
    creating a board from a published template.
- **Defaults and deviations.** Pausing a rule does not re-check the webhook
  allowlist; new channels are checked. The templates catalogue is not paged.
  Board CSV and Excel exports, report CSV and JSON and webhooks keep stored
  codes, so exports import back unchanged. Labels are made from the stored
  value (underscores to spaces, first letter capitalised), the kanban's rule,
  since templates carry no per-value labels. The create-from-published control
  sits on Templates, which only an instance administrator who also administers
  the jurisdiction opens. Ownership deviations: one post-commit call each in
  `server/src/app.ts` (guest revoke) and `server/src/incidents/routes.ts`
  (lock), placed after the commit because the re-check must see it;
  `server/src/boards/routes.ts` (the catalogue); `shared/src/dictionary/index.ts`;
  three added lines in `Console.tsx`, re-applied by hand when the rebase met
  the code splitting unit's rewrite of the same block; `ReportsSurface.tsx`;
  three stale lines in `ADMIN.md`.
- **Schema, contract, dependencies.** Migration `0129`:
  `notification_rules.removed_at` and the check
  `notification_rules_removed_disabled`. Four routes added to the contract and
  `docs/API.md`, each called by the web client. No dependency.
- **Verification.** In the lane, tag `b`, on `bc64e68`: tsc and eslint exit 0;
  `pnpm exec vitest run` over 23 server and web files, 147 tests passed;
  seven browser walks (webeoc-side-by-side, notification-rules, reports,
  board-records, board-views, boards-designer, incident-lifecycle), 10 tests
  passed; link checker ok, 87 files. The integrating session rebased onto
  `4ff06ea` and ran tsc and eslint exit 0, and `pnpm exec vitest run` over
  api-docs, route-coverage, notification-rule-management,
  sync-guest-withdrawal, security-headers, incident-lifecycle,
  webeoc-side-by-side-browser, app-e2e and templates-surface, 9 files and 36
  tests passed. Failing before the fix: with `sync/routes.ts`, `app.ts` and
  `incidents/routes.ts` put back to `main`, both socket tests failed ("still
  open"); the rule routes, the catalogue and the label text do not exist on
  the old code, so their tests cannot pass there.
- **Evidence level:** unit, real-database, socket, browser and document.
- **Deferred:** labels in change history, record detail, kanban cards and the
  calendar; an audit entry for rule creation; a create-from-published control
  for a jurisdiction admin who is not an instance admin; a guest socket that
  joins between the commit and the re-check is not closed, though its next
  join is refused.
- **Rollback:** revert both commits; a database that ran `0129` keeps an unused
  nullable column and its check.

## V1 W6.3: project hygiene for adoption

- **What changed.**
  - New `SECURITY.md`: private reporting through GitHub's "Report a
    vulnerability", with a detail-free issue asking for a private contact as
    the fallback until it is enabled; what to include, synthetic data only;
    scope (the server, shared contracts, web client and deploy scripts in;
    third-party services and the published synthetic demo and acceptance
    credentials out); acknowledgement within 7 days and assessment within 30
    as goals; 90-day coordinated disclosure; the latest 0.9.x supported until
    1.0; no bug bounty.
  - `GOVERNANCE.md` gains "Releases and support" (evaluation builds as needed;
    after 1.0, security fixes for the latest minor only, no long-term support;
    community support through GitHub issues, no paid support; not certified or
    accredited, and a jurisdiction owns its authority to operate) and "Second
    maintainer" (the requirement is not met; Basho Parks is the only
    maintainer; what a second maintainer needs; 1.0 proceeds only with one
    named or Basho's written waiver recorded in this ledger).
  - New `docs/EVALUATOR.md` for an EOC director or IT lead deciding whether to
    pilot: what the product is and is not, twelve proven areas each with its
    evidence level and receipt heading or matrix row, the external inputs
    still open, the product's limits, how to try it and how to report
    problems. Indexed from `docs/README.md` and the root README's document
    list; `CONTRIBUTING.md` points to the security policy.
- **Defaults and deviations.** The integrator set the defaults: GitHub private
  vulnerability reporting as the channel; no contact address invented, since
  the tree publishes none; the support statement as a `GOVERNANCE.md` section
  rather than `SUPPORT.md`; no second maintainer invented. The integrating
  session updated the evaluator page's summary of the side-by-side gaps after
  the gap-closure unit landed: five closed, three open.
- **Schema, contract, dependencies:** none.
- **Verification.** The writer's check over the six touched files: 62
  relative links and all anchors resolve, no em-dash, no unit ID outside
  quoted receipt headings. The integrating session ran
  `node scripts/check-links.mjs` after staging and rebasing onto `82bb97f`:
  ok, 91 files.
- **Evidence level:** document.
- **Deferred:** enabling private vulnerability reporting in the repository
  settings (Basho's external action); a second maintainer or the recorded
  INV-10 waiver (Basho), so gate line 17 stays open until one exists; the
  evaluator page's sentence on installing to a phone's home screen, updated
  when the installable web app unit lands.
- **Rollback:** revert both commits.

## V1 W6.2: disaster recovery runbook

- **What changed.**
  - New `docs/guides/DISASTER-RECOVERY.md`, indexed from the guides README and
    pointed to from `ADMIN.md`, `UPGRADE.md`, the deploy README and
    `docs/WINDOWS-DESKTOP.md`: default recovery point and time objectives per
    failure with how each is built up; what is backed up and what is kept
    apart or fetched again; scheduled backup and retention on both paths;
    off-host copies (3-2-1, encryption before the copy leaves the host,
    checking a copy by checksum, secrets kept apart); a restore for each
    failure (database damaged, host lost, bad upgrade, records deleted: no
    undelete and no partial restore, the values being in the deletion's audit
    payload); checks after a restore; a quarterly restore test against the
    drill numbers; who does what.
  - New `deploy/schedule-backup.sh` installs `openeoc-backup.service` (running
    `backup.sh` as the owner of `deploy/.env`) and a persistent daily
    `openeoc-backup.timer`, then takes one backup through the service; the
    schedule, kept days and user are settings, and a bad value is refused
    before any unit file is written.
  - `backup.sh` removes its own backups older than the kept days (default 14,
    judged by the timestamp in the name) only after both files of a run are
    complete, and leaves `.upload-*` staging files out of the file archive.
  - The Windows launcher gains `-Action Backup` (`-KeepDays`): the
    pre-upgrade `pg_dump` call writes `backups/openeoc-<UTC>.sql`, the file
    store is copied to `openeoc-<UTC>.blobs`, both under `.part` names until
    complete, then the same retention prunes, never touching `pre-upgrade-*`
    dumps; a stopped profile's PostgreSQL is started for the dump and stopped
    after.
- **Defaults and deviations.** RPO 24 hours; RTO 1 hour for a damaged database
  and 4 hours for a lost host; 14 days kept; backups at 02:30. A systemd timer
  rather than cron or a compose loop, because a missed run happens at the next
  boot and output goes to the journal; cron and a Windows scheduled task are
  documented. Deviations: `.upload-*` files are left out of the archive so an
  upload finishing mid-archive cannot fail an unattended run; the schedule and
  retention tests extend `deploy/upgrade.test.mjs`. The integrating session
  added the `docs/WINDOWS-DESKTOP.md` pointer the lane could not reach.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, tag `a`, on `4ff06ea`: tsc and eslint exit 0;
  `pnpm exec vitest run deploy/upgrade.test.mjs deploy/install.test.mjs`, 2
  files and 13 tests passed, including retention (a failed run removes
  nothing; old files removed, recent and unrelated kept; refusal of 0) and the
  schedule script (unit contents, the order of reload, enable and start, five
  refusals with no unit written); `pnpm test:desktop` 23 passed, including
  the scheduled backup (failed and empty dumps remove nothing and leave no
  `.part`, staging uploads left out, only scheduled backups past the kept days
  removed) and the refusal for a profile not set up. The integrating session
  rebased onto `1099fe7` and ran the link checker (ok, 92 files), the desktop
  and installer tests (23 passed) and the two deploy tests (13 passed).
- **Evidence level:** unit and document. No systemd timer, Windows scheduled
  task or real profile backup was run; restore behavior is unchanged, so the
  versioning unit's drill stands.
- **Deferred:** removing a `.part` file after a failed Docker backup; hard
  links to save space on file store copies; a first real scheduled run on
  each path; a profile started during the few seconds the Backup action holds
  its PostgreSQL is stopped with it, which the code notes.
- **Rollback:** revert both commits, then disable and delete the systemd units
  and unregister the Windows task; backups already written stay.

## V1 W4.10: progressive web app

- **What changed.**
  - The web app installs. `web/public/manifest.webmanifest` uses relative
    start and scope URLs and names three icons that now exist
    (`web/public/icons/`), drawn once from the shell's compass mark with the
    installed Chrome.
  - A build plugin, `web/src/offline/precache-plugin.ts`, links the manifest
    from the page and writes `sw.js` into the bundle with a precache list and
    a version digested from every listed file and the worker source: the
    shell, every code-split chunk, the manifest, icons, glyphs, NAPSG symbols
    and the bundled basemap, 123 files and 5.89 MB.
  - The worker serves the precache first; navigations go to the network with
    the cached shell as the offline answer; the API and WebSocket streams are
    never cached; byte-range requests pass through, except that the bundled
    basemap's ranges are answered from the cache when the network fails.
    Other same-origin files are cached at runtime within 50 MB, oldest out
    first, and nothing new is cached past 90 percent of the storage quota or
    when the host marks it no-store.
  - `register.ts` registers the worker after load in built bundles, requests
    persistent storage and checks for a new build hourly. `UpdateNotice`
    shows "A new version is ready." with Later and Reload; Reload switches to
    the new build.
  - The integrating session fixed what the implementer found: an offline
    start deleted the saved session, because the session restore treated any
    failure of its first `/me` read as a refusal. Now only a 401, a 403 or an
    expired session clears the tokens; any other failure keeps them, shows "No
    connection to the server. Your session is kept and resumes when the
    connection returns.", and tries again on the `online` event and every 15
    seconds (`web/src/app/auth/session.tsx`, `App.tsx`).
  - `docs/guides/FIELD-USER.md` gains installing and offline use;
    `deploy/README.md` a paragraph; `docs/EVALUATOR.md` now states the install
    as proven in desktop Chrome, not yet on a phone.
- **Defaults and deviations.** The bundled basemap is the one range-request
  exception. The precache list is written into `sw.js`, since browsers compare
  the worker script's bytes to find an update. Registration is skipped only on
  the dev server. The portrait lock is removed from the manifest. Ownership
  deviations, each additive: `App.tsx` mounts the notice inside the theme, and
  the browser harness fingerprints `sw.js`, the manifest and the icons so a
  change to them rebuilds. The static hosts needed no change: both already
  serve `sw.js` and the manifest `no-cache`, and the CSP allows
  `worker-src 'self'`.
- **Schema, contract, dependencies:** none.
- **Verification.** In the lane, tag `c`, on `f53effd`: tsc and eslint exit 0;
  `pnpm exec vitest run` over the offline unit tests, pwa-browser,
  continuity-console-browser, field-offline, app-e2e and route-coverage, 10
  files and 48 tests passed; bundle budget 160.4 kB. The integrating session:
  a new session test, "keeps a saved session through a lost connection and
  resumes when it returns", failed on the old restore and passes with the
  change (session and offline tests, 6 files and 40 tests passed); the walk's
  offline start now asserts the kept session and its next online reload
  resumes without signing in (pwa-browser 4 of 4). After rebasing onto
  `c7bc995`: tsc and eslint exit 0; bundle budget 160.7 kB; link checker ok,
  92 files; `pnpm exec vitest run` over app-e2e, continuity-console-browser,
  webeoc-side-by-side-browser, the session and offline tests and
  route-coverage passed, and pwa-browser passed on its re-run after the walk
  change. The walk covers install and control, manifest and installability
  checks, an offline reload with every precached file served from the cache
  and nothing else reachable, exact byte ranges online and offline, and a
  published build waiting behind the notice until Reload, with light 1440,
  light 390 and dark 1440 screenshots.
- **Evidence level:** unit, browser and build.
- **Deferred:** opening the console itself without a connection after a
  restart (the session is kept, but the console waits for the server);
  installing on a phone; the delay switching builds while the old worker is
  busy, seen only under the DevTools harness.
- **Rollback:** revert the three commits; browsers that installed the worker
  keep it until the next deploy's `sw.js` replaces it.
