/**
 * A shared request flood limiter (VEOC-37 security audit, RA-1). A fixed
 * window per client key (source IP) that trips only on a flood, so it never
 * touches the latency of normal operation: one Map lookup per request, no
 * allocation on the hot path. The default ceiling is set high on purpose,
 * so heavy but legitimate operation (live polling, a 150-user activation)
 * never trips it; only abuse does. Per-process, like the login backoff; a
 * shared store lands with horizontal scaling (VEOC-38). Set the max to 0 to
 * disable it.
 */

const WINDOW_MS = Number(process.env["OPENEOC_RATELIMIT_WINDOW_MS"] ?? 10_000);
const MAX = Number(process.env["OPENEOC_RATELIMIT_MAX"] ?? 1200);
const PRUNE_AT = 20_000;

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
  if (buckets.size > PRUNE_AT) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) return { allowed: false, retryAfterMs: bucket.resetAt - now };
  return { allowed: true, retryAfterMs: 0 };
}

/** Test hook: clear all counters. */
export function resetRateLimit(): void {
  buckets.clear();
}
