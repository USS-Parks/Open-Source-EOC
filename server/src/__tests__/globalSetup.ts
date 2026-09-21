import { connect } from "../db/client.js";

/**
 * Vitest global setup/teardown. Nothing is set up here (the local test cluster
 * and its bootstrap database are provisioned outside the suite), but on teardown
 * the throwaway per-file databases that freshDb() creates, named
 * t_<10 base36 chars>, are dropped. freshDb makes one database per test file and
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
      select datname from pg_database where datname ~ '^t_[0-9a-z]{10}$'`;
    for (const { datname } of rows) {
      // DROP DATABASE cannot run inside a transaction, so each is its own
      // autocommit statement; FORCE evicts any backend still attached.
      await sql.unsafe(`drop database if exists "${datname}" with (force)`);
    }
  } finally {
    await sql.end();
  }
}
