import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { connect, type Sql } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** Fresh schema per test file: drop public, remigrate, hand back a client. */
export async function freshDb(): Promise<Sql> {
  const sql = connect();
  await sql.unsafe("drop schema public cascade; create schema public;");
  await migrate(sql, MIGRATIONS);
  return sql;
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
export { postgres };
