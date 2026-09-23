import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client.js";

export const BASELINE_MIGRATION = "0001_baseline.sql";
const FIRST_POST_BASELINE_MIGRATION = "0102_";
const NUMBERED_MIGRATION = /^\d{4}_.+\.sql$/u;

/**
 * The pre-release baseline replaces the original 0001 through 0101 chain.
 * Never replay it over a cluster carrying that retired history: the baseline
 * is a complete schema, not an incremental upgrade. New migrations continue
 * at 0102 so the one-time legacy boundary remains unambiguous.
 */
export function assertCompatibleMigrationHistory(
  appliedNames: readonly string[],
  availableFiles: readonly string[],
): void {
  if (!availableFiles.includes(BASELINE_MIGRATION)) return;

  const applied = new Set(appliedNames);
  const legacyRows = appliedNames.filter((name) =>
    name !== BASELINE_MIGRATION
    && NUMBERED_MIGRATION.test(name)
    && name < FIRST_POST_BASELINE_MIGRATION,
  );
  if (legacyRows.length > 0) {
    throw new Error(
      `Refusing the pre-release schema baseline because schema_migrations contains retired rows: ${legacyRows.join(", ")}`,
    );
  }
  const unrecognizedRows = appliedNames.filter((name) =>
    name !== BASELINE_MIGRATION && !NUMBERED_MIGRATION.test(name),
  );
  if (unrecognizedRows.length > 0) {
    throw new Error(
      `Refusing the pre-release schema baseline because schema_migrations contains unrecognized rows: ${unrecognizedRows.join(", ")}`,
    );
  }
  if (applied.size > 0 && !applied.has(BASELINE_MIGRATION)) {
    throw new Error(
      "Refusing the pre-release schema baseline because this database has migration history without 0001_baseline.sql",
    );
  }
}

/**
 * Minimal forward-only migration runner. Files in the migrations directory
 * are applied in lexical order inside one transaction each and recorded in
 * schema_migrations. No down migrations: recovery is restore-from-backup,
 * which matches the deployment doctrine (ADR-0007).
 */
export async function migrate(sql: Sql, dir: string): Promise<readonly string[]> {
  await sql`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
  const applied = new Set(
    (await sql`select name from public.schema_migrations`).map((r) => r.name as string),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assertCompatibleMigrationHistory([...applied], files);
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (name) values (${file})`;
      await tx.unsafe("set search_path to public");
    });
    ran.push(file);
  }
  return ran;
}
