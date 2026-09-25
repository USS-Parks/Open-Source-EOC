import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type Sql } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

const DB_TAG = process.env.OPENEOC_TEST_DB_TAG;
if (DB_TAG !== undefined && !/^[a-z0-9]{1,12}$/.test(DB_TAG)) {
  throw new Error("OPENEOC_TEST_DB_TAG must contain 1 to 12 lowercase letters or digits");
}

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
 * The migrated schema every test database copies, named by the run tag and a
 * hash of the migration files so a changed migration builds a new one.
 * Migrating once and copying keeps each file's setup short; migrating per file
 * under the shared lock made files queue past their hook timeout on a loaded
 * machine.
 */
const TEMPLATE_PREFIX = DB_TAG === undefined ? "tpl_" : `tpl_${DB_TAG}_`;
const TEMPLATE = (() => {
  const hash = createHash("sha256");
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    hash.update(file).update("|").update(readFileSync(join(MIGRATIONS, file))).update("|");
  }
  return `${TEMPLATE_PREFIX}${hash.digest("hex").slice(0, 16)}`;
})();

/**
 * One throwaway database per test file, so files can run concurrently
 * without racing each other's schemas. A run tag isolates concurrent teardown.
 * It copies the migrated template, or with `fromScratch` runs every
 * migration on an empty database, for suites that prove the migrations;
 * `migrateThrough` stops after the named migration, as a database an earlier
 * release left would be.
 */
export async function freshDb(options: { fromScratch?: boolean; migrateThrough?: string } = {}): Promise<TestDb> {
  const scratch = options.fromScratch === true || options.migrateThrough !== undefined;
  const suffix = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  const dbName = DB_TAG === undefined ? `t_${suffix}` : `t_${DB_TAG}_${suffix}`;
  const bootstrap = connect();
  const url = process.env.OPENEOC_DATABASE_URL;
  const database = (name: string) => url ? connect({ url: withUrlParts(url, { database: name }) }) : connect({ database: name });
  try {
    // Concurrent test files race shared-catalog changes (role alteration,
    // grants inside migrations: "tuple concurrently updated"), so the whole
    // per-file setup runs under one advisory lock. It also staggers file
    // starts, which keeps a full parallel run inside the cluster's
    // connection limit.
    await bootstrap`select pg_advisory_lock(421)`;
    try {
      const [ready] = await bootstrap`select 1 from pg_database where datname = ${TEMPLATE}`;
      if (scratch) {
        await bootstrap.unsafe(`create database ${dbName}`);
        const fresh = database(dbName);
        try {
          await migrate(fresh, MIGRATIONS, options.migrateThrough === undefined ? {} : { through: options.migrateThrough });
        } finally {
          await fresh.end();
        }
      } else if (!ready) {
        // Built under a working name and renamed when complete, so an
        // interrupted build is never copied. This run tag's templates of
        // other migration sets are dropped.
        const building = `${TEMPLATE}_wip`;
        await bootstrap.unsafe(`drop database if exists "${building}" with (force)`);
        await bootstrap.unsafe(`create database "${building}"`);
        const template = database(building);
        try {
          await migrate(template, MIGRATIONS);
        } finally {
          await template.end();
        }
        await bootstrap.unsafe(`alter database "${building}" rename to "${TEMPLATE}"`);
        for (const { datname } of await bootstrap<{ datname: string }[]>`
          select datname from pg_database
          where datname ~ ${`^${TEMPLATE_PREFIX}[0-9a-f]{16}$`} and datname <> ${TEMPLATE}`) {
          await bootstrap.unsafe(`drop database if exists "${datname}" with (force)`);
        }
      }
      // Migrations create the app_runtime role (0002); the password can only
      // be set after they have run. A fresh CI cluster proves the order.
      await bootstrap.unsafe(`alter role app_runtime login password '${RUNTIME_TEST_PASSWORD}'`);
      if (!scratch) await bootstrap.unsafe(`create database ${dbName} template "${TEMPLATE}" strategy wal_log`);
    } finally {
      await bootstrap`select pg_advisory_unlock(421)`;
    }
  } finally {
    await bootstrap.end();
  }
  const admin = database(dbName);
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

/**
 * Bearer token for a seeded account. Twenty-three test files carried their own
 * copy of this login round trip; they now share this one so a change to the
 * login contract lands in a single place.
 */
export async function tokenFor(
  app: { inject(options: unknown): Promise<{ statusCode: number; json(): { accessToken?: string } }> },
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${response.statusCode}`);
  }
  const token = response.json().accessToken;
  if (!token) throw new Error(`login returned no access token for ${email}`);
  return token;
}

/** Authorization header for a bearer token. */
export const auth = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
});

export type { Sql };
