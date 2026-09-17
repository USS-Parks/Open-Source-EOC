import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type Sql } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

// Test-only credential for the RLS-bound runtime role in the throwaway
// test cluster; production deployments set their own (see 0002_authz.sql).
const RUNTIME_TEST_PASSWORD = "app-runtime-test-only";

export interface TestDb {
  /** Superuser connection: migrations, seeding, direct assertions. RLS does not apply. */
  admin: Sql;
  /** The application's connection: RLS applies. The app is built on this. */
  runtime: Sql;
}

/**
 * One throwaway database per test file, so files can run concurrently
 * without racing each other's schemas.
 */
export async function freshDb(): Promise<TestDb> {
  const dbName = `t_${Math.random().toString(36).slice(2, 12)}`;
  const bootstrap = connect();
  const url = process.env.OPENEOC_DATABASE_URL;
  let admin: Sql;
  // Concurrent test files race shared-catalog changes (role alteration,
  // grants inside migrations: "tuple concurrently updated"), so the whole
  // per-file setup runs under one advisory lock.
  await bootstrap`select pg_advisory_lock(421)`;
  try {
    await bootstrap.unsafe(`create database ${dbName}`);
    await bootstrap.unsafe(`alter role app_runtime login password '${RUNTIME_TEST_PASSWORD}'`);
    admin = url
      ? connect({ url: withUrlParts(url, { database: dbName }) })
      : connect({ database: dbName });
    await migrate(admin, MIGRATIONS);
  } finally {
    await bootstrap`select pg_advisory_unlock(421)`;
    await bootstrap.end();
  }
  const runtime = url
    ? connect({
        url: withUrlParts(url, {
          database: dbName,
          user: "app_runtime",
          password: RUNTIME_TEST_PASSWORD,
        }),
      })
    : connect({ database: dbName, user: "app_runtime" });
  return { admin, runtime };
}

function withUrlParts(
  url: string,
  parts: { database?: string; user?: string; password?: string },
): string {
  const u = new URL(url);
  if (parts.database) u.pathname = `/${parts.database}`;
  if (parts.user) u.username = parts.user;
  if (parts.password) u.password = parts.password;
  return u.toString();
}

export interface SeedResult {
  jurisdictionId: string;
  adminId: string;
  memberId: string;
}

export async function seedIdentity(sql: Sql): Promise<SeedResult> {
  const jurisdictionId = await createJurisdiction(sql, "yurok", "Yurok Tribe OES");
  const adminId = await createPerson(sql, {
    email: "admin@example.org",
    displayName: "Admin",
    password: "correct-horse-battery",
  });
  const memberId = await createPerson(sql, {
    email: "member@example.org",
    displayName: "Member",
    password: "another-good-password",
  });
  await addMembership(sql, adminId, jurisdictionId, "admin");
  await addMembership(sql, memberId, jurisdictionId, "member");
  return { jurisdictionId, adminId, memberId };
}

export type { Sql };
