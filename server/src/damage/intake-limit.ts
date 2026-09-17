/**
 * Public-intake throttle (VEOC-23). A fixed window per jurisdiction caps
 * how many self-reports the public endpoint accepts, so a flood of intake
 * cannot bury moderators or the store. Per-process for now, like the login
 * backoff; a shared limiter arrives with horizontal scaling (VEOC-38).
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function intakeAllowed(key: string, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count += 1;
  return true;
}

export function resetIntakeLimits(): void {
  buckets.clear();
}
