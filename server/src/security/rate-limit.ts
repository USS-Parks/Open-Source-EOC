/**
 * A shared request flood limiter (security audit, RA-1). A fixed
 * window per client key (source IP) that trips only on a flood, so it never
 * touches the latency of normal operation: one Map lookup per request, no
 * allocation on the hot path. The default ceiling is set high on purpose,
 * so heavy but legitimate operation (live polling, a 150-user activation)
 * never trips it; only abuse does. Per-process, like the login backoff; v1
 * runs one application node (deploy/README.md). The table holds at most
 * MAX_KEYS clients, so a spray of source addresses cannot grow it without
 * bound. Set the max to 0 to disable it.
 */

const WINDOW_MS = Number(process.env["OPENEOC_RATELIMIT_WINDOW_MS"] ?? 10_000);
const MAX = Number(process.env["OPENEOC_RATELIMIT_MAX"] ?? 1200);
const MAX_KEYS = 20_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/** Count one request against `key`'s current window and decide. */
export function rateLimit(key: string, max = MAX, windowMs = WINDOW_MS, now = Date.now()): RateDecision {
  if (max <= 0) return { allowed: true, retryAfterMs: 0 };
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Halving at the cap keeps the sweep amortized: one full pass per
    // MAX_KEYS / 2 new clients, never one per request.
    if (!bucket && buckets.size >= MAX_KEYS) prune(buckets, (b) => b.resetAt <= now, MAX_KEYS / 2);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.delete(key); // re-insert last, so map order is window-start order
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) return { allowed: false, retryAfterMs: bucket.resetAt - now };
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Bound an in-memory limiter table: drop expired entries, then the oldest
 * (a Map iterates in insertion order) until at most `keep` remain.
 */
export function prune<V>(map: Map<string, V>, expired: (value: V) => boolean, keep: number): void {
  for (const [key, value] of map) if (expired(value)) map.delete(key);
  for (const key of map.keys()) {
    if (map.size <= keep) break;
    map.delete(key);
  }
}

/** Test hook: clear all counters. */
export function resetRateLimit(): void {
  buckets.clear();
}
