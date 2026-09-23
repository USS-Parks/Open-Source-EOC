import { prune } from "../security/rate-limit.js";
import type { Principal } from "./service.js";

/**
 * Per-process cache of request principals, keyed by the access-token hash
 * (never the token itself). Deriving a principal costs a session lookup and
 * a transaction of membership, grant, flag and position reads; within the
 * TTL a repeat request skips all of it.
 *
 * An entry never outlives its session's access expiry or the earliest guest
 * grant it carries. A change made through the API drops the entries it
 * affects once its transaction has committed: sign-out, resume and position
 * sign-in or sign-out forget the session, and a membership or guest grant
 * change forgets every session of that person. A route that changes any of
 * those must do the same. A change made outside the API (a role edited or a
 * person disabled in psql) is seen when the TTL lapses, which is why the TTL
 * is short. OPENEOC_PRINCIPAL_CACHE_MS sets it; 0 turns the cache off.
 * Per-process; v1 runs one application node (deploy/README.md).
 */
const TTL_MS = Number(process.env["OPENEOC_PRINCIPAL_CACHE_MS"] ?? 5000);
const MAX_ENTRIES = 10_000;

interface Entry {
  readonly principal: Principal;
  readonly expiresAt: number;
}

const entries = new Map<string, Entry>();
/** Bumped by every forget; a load that overlapped one is served but not kept. */
let generation = 0;

export async function cachedPrincipal(
  accessHash: string,
  load: () => Promise<{ principal: Principal; accessExpiresAt: Date }>,
): Promise<Principal> {
  const hit = entries.get(accessHash);
  if (hit && hit.expiresAt > Date.now()) return hit.principal;
  entries.delete(accessHash);
  const started = generation;
  const { principal, accessExpiresAt } = await load();
  if (TTL_MS > 0 && started === generation) {
    const now = Date.now();
    if (entries.size >= MAX_ENTRIES) prune(entries, (e) => e.expiresAt <= now, MAX_ENTRIES / 2);
    const expiresAt = Math.min(
      now + TTL_MS,
      accessExpiresAt.getTime(),
      ...principal.guests.map((g) => g.expiresAt.getTime()),
    );
    entries.set(accessHash, { principal, expiresAt });
  }
  return principal;
}

export function forgetSession(sessionId: string): void {
  forget((p) => p.sessionId === sessionId);
}

export function forgetPerson(personId: string): void {
  forget((p) => p.person.id === personId);
}

function forget(match: (principal: Principal) => boolean): void {
  generation += 1;
  for (const [key, entry] of entries) if (match(entry.principal)) entries.delete(key);
}
