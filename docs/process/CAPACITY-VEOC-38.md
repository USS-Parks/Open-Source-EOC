# Capacity, Load, and the Long Incident (VEOC-38)

This records the committed operating floor (R1: at least 150 concurrent active
users per instance), the measured headroom, and the reproducible harness that
proves it and guards against regression in CI.

## Committed floor (R1)

- **150 concurrent active users per instance**, mixed editors, viewers, and
  field clients, served within the latency budgets below. This is a floor, not
  a ceiling; measured headroom is well beyond it.

## The harness

`server/src/__tests__/load.test.ts` is the reproducible harness and the CI
regression guard. It runs against the real Fastify app on a real PostgreSQL,
the same stack production uses. Two profiles:

1. **Volume (the SharePoint 5,000-item lesson).** A single board is loaded with
   5,000 records and a view is served over it. The board-records index on
   `(board_id, created_at desc)` keeps this a bounded, ordered scan rather than
   the list-view collapse that a 5,000-item SharePoint list hit.
2. **150-concurrent activation profile.** 150 operations are fired
   concurrently in a one-third mix of `GET /me` (viewer/session), a board view
   read (editor/viewer), and a record write (editor/field), the shape of a
   150-user activation. Every operation must return 2xx and the burst must
   finish within budget.

Reproduce locally with a running test PostgreSQL:

```
npx vitest run server/src/__tests__/load.test.ts --disableConsoleIntercept
```

The `--disableConsoleIntercept` flag prints the measured numbers.

## Budgets (the CI ceilings)

These are deliberately loose: only a pathological regression (an unindexed
scan, an accidental N+1, a lock storm) breaches them, so CI variance never
flakes while a real regression still trips the guard.

| Metric | Budget |
|---|---|
| View over 5,000 records | < 5,000 ms |
| 150-op burst, wall clock | < 30,000 ms |
| 150-op burst, p95 per op | < 6,000 ms |

## Measured numbers (this reference environment)

Measured on the project's sandbox test cluster (PostgreSQL 16, single node,
unix-socket). Absolute numbers vary by hardware; the point is the wide margin
under budget.

| Metric | Measured | Budget | Margin |
|---|---|---|---|
| View over 5,000 records | ~65 ms | 5,000 ms | ~77x |
| 150-op burst, wall clock | ~1,310 ms | 30,000 ms | ~23x |
| 150-op burst, p95 per op | ~1,237 ms | 6,000 ms | ~5x |

The 150-op burst completing in ~1.3 s of wall time, against a connection pool
far smaller than 150, shows the request path is not the bottleneck at the R1
floor; database connections queue and drain quickly.

## Federation fan-out and sync convergence

- **Federation fan-out** is store-and-forward (VEOC-30): outbound updates queue
  per peer and deliver asynchronously, so a slow or absent peer never blocks the
  local write path. Fan-out cost is linear in peers and off the critical path.
- **Sync convergence** rides the VEOC-13 CRDT reconciliation: updates merge and
  checkpoint, and convergence is proven functionally by the sync and federation
  suites. Convergence is bounded by update volume, not by round trips, because
  there is no synchronous dual-commit anywhere.

## What was found and fixed

- No target missed at the R1 floor in this environment; the volume path was
  already indexed and the concurrent path already pooled.
- **Headroom item (accepted, not blocking R1):** `listViewRecords` returns a
  board's full record set and applies the view in memory. It is fast to well
  past 5,000 records, but a months-long incident that accumulates tens of
  thousands of records on one board should move to server-side pagination and
  filter push-down. Tracked as the next scaling step; the shared limiter for
  rate limiting (RA-1 in the security audit) lands with the same work.

## Real distributed load verification (run before release)

The CI benchmark drives the app in-process; it proves the request and volume
paths do not blow up, but it does not open 150 real WebSocket connections over
a network. The honest 150-user proof runs against a live deployment on real
hardware with `scripts/load-harness.mjs`, which is dependency-free (Node 22
`fetch` and `WebSocket`) and can be run from one machine or several to reach
and exceed 150 concurrent users:

```
node scripts/load-harness.mjs --url http://HOST:8080 \
  --email admin@example.org --password '...' --board BOARD_ID \
  --users 150 --duration 20 --http-p95-ms 1500
```

It logs in, fires a concurrent HTTP read burst (latency percentiles and error
rate), then opens and holds one board sync WebSocket per user for the duration
(how many of the 150 connections stay up, and auth latency), and exits non-zero
if a budget is breached. Run it against the home deployment as the real
150-concurrency and WebSocket check before any 1.0 announcement.

## Risk acceptances

- **Single-node measurement.** The published in-process numbers are
  single-instance. The R1 floor is per instance, which is what the requirement
  commits to; horizontal scaling is additive and out of scope for this floor.
- **Real-network 150-user proof runs out of band.** The distributed harness
  above is the verification on real hardware; CI cannot open 150 network
  sockets, so that run is a release-time step, not a CI gate.
