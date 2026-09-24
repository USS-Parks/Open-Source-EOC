import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Before a newer build migrates an existing profile database, dump it to
 * `backupsDir` with the supplied `dump(path)`. Returns the dump's path, or
 * null when there is nothing to protect: a new database with no migration
 * history, or no migration pending. Throws, so nothing is migrated, when the
 * dump fails or leaves no bytes.
 */
export function backupBeforeMigrate({ applied, files, backupsDir, dump, now = new Date() }) {
  if (applied.length === 0) return null;
  const done = new Set(applied);
  if (files.every((file) => done.has(file))) return null;
  mkdirSync(backupsDir, { recursive: true });
  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(/[-:]/g, "");
  const path = resolve(backupsDir, `pre-upgrade-${stamp}.sql`);
  dump(path);
  if (!existsSync(path) || statSync(path).size === 0)
    throw new Error(`The pre-upgrade backup ${path} is missing or empty; the database was not migrated`);
  return path;
}
