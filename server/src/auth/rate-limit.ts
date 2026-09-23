import { prune } from "../security/rate-limit.js";

/**
 * In-memory login backoff (threat row B11): five failures for one key lock
 * further attempts for thirty seconds. Keys are emails at the login route and
 * `mfa:<person>` for second-factor codes. A key's failures are forgotten
 * fifteen minutes after its last one. The caller picks the key (any email
 * string will do), so the table is also capped: at MAX_ENTRIES it drops
 * forgotten keys, then the stalest, down to half. Evicting a live lock that
 * way costs an attacker thousands of password checks, far more than the lock.
 * Per-process; v1 runs one application node (deploy/README.md).
 */
const WINDOW_MS = 30_000;
const MAX_FAILURES = 5;
const FORGET_MS = 15 * 60_000;
const MAX_ENTRIES = 10_000;

interface Entry {
  failures: number;
  lockedUntil: number;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

/** The key's entry, dropping it first if its failures are forgotten. */
function live(key: string, now: number): Entry | undefined {
  const e = entries.get(key);
  if (e && e.expiresAt <= now) {
    entries.delete(key);
    return undefined;
  }
  return e;
}

export function checkAllowed(email: string, now = Date.now()): boolean {
  const e = live(email.toLowerCase(), now);
  return !e || e.lockedUntil <= now;
}

export function recordFailure(email: string, now = Date.now()): void {
  const key = email.toLowerCase();
  let e = live(key, now);
  if (!e) {
    if (entries.size >= MAX_ENTRIES) prune(entries, (x) => x.expiresAt <= now, MAX_ENTRIES / 2);
    e = { failures: 0, lockedUntil: 0, expiresAt: 0 };
  }
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + WINDOW_MS;
    e.failures = 0;
  }
  e.expiresAt = now + FORGET_MS;
  entries.delete(key); // re-insert last, so map order is last-failure order
  entries.set(key, e);
}

export function recordSuccess(email: string): void {
  entries.delete(email.toLowerCase());
}

export function resetRateLimits(): void {
  entries.clear();
}
