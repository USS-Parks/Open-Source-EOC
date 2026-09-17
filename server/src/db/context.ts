import type { Sql } from "./client.js";

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
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.person_id', ${personId}, true)`;
    // A transaction handle carries the full tagged-template query surface
    // the service layer uses; services never open nested transactions.
    return fn(tx as unknown as Sql);
  })) as T;
}
