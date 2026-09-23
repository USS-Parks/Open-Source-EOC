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
