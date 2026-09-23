import type { Sql } from "./client.js";

const commitHooks = new WeakMap<object, Array<() => void>>();

/**
 * Run `fn` once the withPerson transaction `tx` has committed, and never if it
 * rolls back. Used to announce a committed change to in-process listeners.
 * A handle that did not come from withPerson has no commit to wait for, so
 * the call is dropped.
 */
export function afterCommit(tx: Sql, fn: () => void): void {
  commitHooks.get(tx)?.push(fn);
}

/**
 * Run `fn` in a transaction with the acting person bound to the database
 * session, so row-level security policies (the second wall, ADR-0005) see
 * who is acting. Every service call on behalf of a principal goes through
 * here; a query that escapes the service layer without a person context
 * sees no tenant rows at all.
 */
export async function withPerson<T>(
  sql: Sql,
  personId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  const hooks: Array<() => void> = [];
  const result = (await sql.begin(async (tx) => {
    commitHooks.set(tx, hooks);
    await tx`select set_config('app.person_id', ${personId}, true)`;
    // A transaction handle carries the full tagged-template query surface
    // the service layer uses; services never open nested transactions.
    return fn(tx as unknown as Sql);
  })) as T;
  for (const hook of hooks) {
    try {
      hook();
    } catch {
      // The transaction has committed; a listener failure must not undo that.
    }
  }
  return result;
}
