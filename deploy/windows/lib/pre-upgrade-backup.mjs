import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
 * Beside a pre-upgrade dump, a report an administrator can review before
 * relying on the upgrade: the migrations applied, each with the comment at
 * its head that says what it changes, what an upgrade keeps, and the way
 * back. Written as the dump's name with .txt; returns its path.
 */
export function writeUpgradeReport({ backup, applied, migrationsDir, profile, now = new Date() }) {
  const lines = [
    `Open Source EOC upgrade of the ${profile} profile, ${now.toISOString()}`,
    "",
    "Before migrating, the database was dumped to:",
    `  ${backup}`,
    "",
    `Migrations applied (${applied.length}), each with what it changes:`,
    "",
  ];
  for (const file of applied) {
    const head = [];
    for (const line of readFileSync(resolve(migrationsDir, file), "utf8").split(/\r?\n/)) {
      if (!line.startsWith("--")) break;
      head.push(`  ${line.replace(/^--\s?/, "")}`);
    }
    lines.push(file, ...(head.length ? head : ["  No description at the head of the migration."]), "");
  }
  lines.push(
    "What an upgrade keeps: boards with their local fields, templates and views; dashboards; notification rules;",
    "positions and who holds them; memberships, guest and participant grants; saved layouts. Templates shipped",
    "with a new version are added beside the ones in use and never written over.",
    "",
    "The way back: stop the profile, install the previous version, and restore the dump above as the",
    "\"Go back\" section of docs/guides/UPGRADE.md shows, or put back the copy of the profile directory",
    "taken before the upgrade.",
    "",
  );
  const path = backup.replace(/\.sql$/, ".txt");
  writeFileSync(path, lines.join("\n"));
  return path;
}

/**
 * Copy a file store for a backup as hard links, which take no space of their
 * own: stored files are named by their content and never rewritten, so a link
 * holds the bytes a copy would. A file that cannot be linked (the backups on
 * another volume, a file system without links) is copied. Uploads still in
 * progress are left out.
 */
function linkStore(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".upload-")) continue;
    const source = resolve(from, entry.name);
    const target = resolve(to, entry.name);
    if (entry.isDirectory()) linkStore(source, target);
    else if (entry.isFile()) {
      try {
        linkSync(source, target);
      } catch {
        copyFileSync(source, target);
      }
    }
  }
}

/**
 * The scheduled backup of a profile: a dump of its database, made with the
 * supplied `dump(path)`, as `openeoc-<UTC>.sql`, then a copy of its file store
 * as the folder `openeoc-<UTC>.blobs`, made of hard links where it can be.
 * Stored files are named by their content and never rewritten, so a copy taken
 * after the dump holds every file the dump refers to; uploads still in
 * progress are left out. Each is written
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
    linkStore(blobsDir, `${files}.part`);
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
