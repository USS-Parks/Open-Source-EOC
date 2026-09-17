import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client.js";

/**
 * Minimal forward-only migration runner. Files in the migrations directory
 * are applied in lexical order inside one transaction each and recorded in
 * schema_migrations. No down migrations: recovery is restore-from-backup,
 * which matches the deployment doctrine (ADR-0007).
 */
export async function migrate(sql: Sql, dir: string): Promise<readonly string[]> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
  const applied = new Set(
    (await sql`select name from schema_migrations`).map((r) => r.name as string),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    ran.push(file);
  }
  return ran;
}
