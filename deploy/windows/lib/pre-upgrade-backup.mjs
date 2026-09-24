import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const utcStamp = (date) => date.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(/[-:]/g, "");

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
  const path = resolve(backupsDir, `pre-upgrade-${utcStamp(now)}.sql`);
  dump(path);
  if (!existsSync(path) || statSync(path).size === 0)
    throw new Error(`The pre-upgrade backup ${path} is missing or empty; the database was not migrated`);
  return path;
}

/**
 * The scheduled backup of a profile: a dump of its database, made with the
 * supplied `dump(path)`, as `openeoc-<UTC>.sql`, then a copy of its file store
 * as the folder `openeoc-<UTC>.blobs`. Stored files are named by their content
 * and never rewritten, so a copy taken after the dump holds every file the
 * dump refers to; uploads still in progress are left out. Each is written
 * under a .part name and renamed when complete. Only then are scheduled
 * backups older than `keepDays` removed; pre-upgrade dumps are never removed.
 */
export function scheduledBackup({ backupsDir, blobsDir, dump, keepDays = 14, now = new Date() }) {
  if (!Number.isSafeInteger(keepDays) || keepDays < 1)
    throw new Error("Keep days must be a whole number, 1 or more; nothing was backed up");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = utcStamp(now);
  const database = resolve(backupsDir, `openeoc-${stamp}.sql`);
  const files = resolve(backupsDir, `openeoc-${stamp}.blobs`);
  try {
    dump(`${database}.part`);
    if (!existsSync(`${database}.part`) || statSync(`${database}.part`).size === 0)
      throw new Error(`The database dump ${database}.part is missing or empty`);
    // ponytail: a full copy per backup; hard links would save the space if the file store grows large.
    cpSync(blobsDir, `${files}.part`, { recursive: true, filter: (source) => !basename(source).startsWith(".upload-") });
  } catch (error) {
    for (const partial of [`${database}.part`, `${files}.part`]) rmSync(partial, { recursive: true, force: true });
    throw new Error(`${String(error?.message ?? error)}; no backup was written and none was removed`, { cause: error });
  }
  renameSync(`${database}.part`, database);
  renameSync(`${files}.part`, files);
  const cutoff = utcStamp(new Date(now.getTime() - keepDays * 86_400_000));
  const removed = readdirSync(backupsDir).filter((name) => {
    const match = /^openeoc-(\d{8}T\d{6}Z)\.(?:sql|blobs)$/.exec(name);
    return match !== null && match[1] < cutoff;
  });
  for (const name of removed) rmSync(resolve(backupsDir, name), { recursive: true, force: true });
  return { database, files, removed };
}
