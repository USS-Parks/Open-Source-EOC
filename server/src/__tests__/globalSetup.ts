import { connect } from "../db/client.js";

const DB_TAG = process.env.OPENEOC_TEST_DB_TAG;
if (DB_TAG !== undefined && !/^[a-z0-9]{1,12}$/.test(DB_TAG)) {
  throw new Error("OPENEOC_TEST_DB_TAG must contain 1 to 12 lowercase letters or digits");
}
const DB_PATTERN = DB_TAG === undefined ? "^t_[0-9a-z]{10}$" : `^t_${DB_TAG}_[0-9a-z]{10}$`;

/**
 * Vitest global setup/teardown. Nothing is set up here (the local test cluster
 * and its bootstrap database are provisioned outside the suite), but on teardown
 * the throwaway per-file databases that freshDb() creates, named
 * t_<10 base36 chars> or t_<run tag>_<10 base36 chars>, are dropped only for
 * this run's namespace. freshDb makes one database per test file and
 * only closes its connections, so without this they accumulate in the cluster
 * run after run until Postgres startup and recovery fsync take minutes. A no-op
 * when no database is configured (unit-only runs set no OPENEOC_DATABASE_URL).
 */
export async function setup(): Promise<void> {}

export async function teardown(): Promise<void> {
  if (!process.env.OPENEOC_DATABASE_URL) return;
  const sql = connect();
  try {
    const rows = await sql<{ datname: string }[]>`
      select datname from pg_database where datname ~ ${DB_PATTERN}`;
    for (const { datname } of rows) {
      // DROP DATABASE cannot run inside a transaction, so each is its own
      // autocommit statement; FORCE evicts any backend still attached.
      await sql.unsafe(`drop database if exists "${datname}" with (force)`);
    }
  } finally {
    await sql.end();
  }
}
