/**
 * In-memory login backoff (threat row B11): five consecutive failures for
 * one email lock further attempts for thirty seconds. Per-process by design;
 * a shared store is future horizontal-scaling work.
 */
const WINDOW_MS = 30_000;
const MAX_FAILURES = 5;

interface Entry {
  failures: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

export function checkAllowed(email: string, now = Date.now()): boolean {
  const e = entries.get(email.toLowerCase());
  return !e || e.lockedUntil <= now;
}

export function recordFailure(email: string, now = Date.now()): void {
  const key = email.toLowerCase();
  const e = entries.get(key) ?? { failures: 0, lockedUntil: 0 };
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + WINDOW_MS;
    e.failures = 0;
  }
  entries.set(key, e);
}

export function recordSuccess(email: string): void {
  entries.delete(email.toLowerCase());
}

export function resetRateLimits(): void {
  entries.clear();
}
