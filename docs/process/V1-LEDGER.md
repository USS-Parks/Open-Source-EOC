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
