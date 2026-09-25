import {
  RESOURCE_KIND_SEED,
  RESOURCE_KIND_SEED_SOURCE,
  type ResourceKind,
  type ResourceTypeLevel,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { parseCsv } from "../contacts/csv.js";

/**
 * A jurisdiction's NIMS resource typing catalog: the seed kinds from the
 * shared dictionary, kinds its administrators add, and definitions imported
 * from a FEMA Resource Typing Library Tool (RTLT) export. Requests and pool
 * resources name a kind by key, checked here on every write, because the seed
 * is code and cannot be the target of a foreign key.
 */

const SEED: readonly ResourceKind[] = RESOURCE_KIND_SEED.map((kind) => ({
  ...kind,
  source: "seed",
  rtltId: null,
  sourceNote: RESOURCE_KIND_SEED_SOURCE,
}));

export async function listKinds(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ kinds: ResourceKind[]; canManage: boolean }> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select key, name, discipline, levels, notes, source, rtlt_id, source_note from resource_kinds
    where jurisdiction_id = ${jurisdictionId} order by name, key`;
  const local: ResourceKind[] = rows.map((row) => ({
    key: row.key as string,
    name: row.name as string,
    discipline: row.discipline as string,
    levels: row.levels as ResourceTypeLevel[],
    notes: row.notes as string,
    source: row.source as "local" | "rtlt",
    rtltId: (row.rtlt_id as string | null) ?? null,
    sourceNote: row.source_note as string,
  }));
  const canManage = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId && m.role === "admin");
  return { kinds: [...SEED, ...local], canManage };
}

/**
 * Check a kind key and type level against the jurisdiction's catalog. A kind
 * with no levels takes no type; `typeRequired` is set for a pool resource,
 * which is always one definite type, and unset for a request, where no type
 * means any type of the kind.
 */
export async function requireKind(
  sql: Sql,
  jurisdictionId: string,
  key: string,
  type: number | null,
  typeRequired: boolean,
): Promise<void> {
  let levels: readonly ResourceTypeLevel[] | undefined = RESOURCE_KIND_SEED.find((kind) => kind.key === key)?.levels;
  if (!levels) {
    const [row] = await sql`select levels from resource_kinds where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
    levels = row?.levels as ResourceTypeLevel[] | undefined;
  }
  if (!levels) throw new AuthError(400, "unknown resource kind");
  if (levels.length === 0) {
    if (type !== null) throw new AuthError(400, "this resource kind has a single type");
  } else if (type === null) {
    if (typeRequired) throw new AuthError(400, "choose the type of this resource");
  } else if (!levels.some((level) => level.type === type)) {
    throw new AuthError(400, `type ${type} is not defined for this resource kind`);
  }
}

function checkLevels(levels: readonly ResourceTypeLevel[]): ResourceTypeLevel[] {
  if (new Set(levels.map((level) => level.type)).size !== levels.length)
    throw new AuthError(400, "each type level may appear once");
  return [...levels].sort((a, b) => a.type - b.type);
}

export async function addLocalKind(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { name: string; discipline: string; levels: readonly ResourceTypeLevel[]; notes: string },
): Promise<{ key: string }> {
  requireAdmin(actor, jurisdictionId);
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!slug) throw new AuthError(400, "the name needs a letter or a digit");
  const key = `local:${slug}`;
  const levels = checkLevels(input.levels);
  const [taken] = await sql`select 1 from resource_kinds where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
  if (taken) throw new AuthError(409, "a local kind with that name already exists");
  await sql`
    insert into resource_kinds (jurisdiction_id, key, name, discipline, levels, notes, source, created_by)
    values (${jurisdictionId}, ${key}, ${input.name}, ${input.discipline}, ${sql.json(levels as never)},
            ${input.notes}, 'local', ${actor.person.id})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.kind_added",
    subjectTable: "resource_kinds",
    payload: { key, name: input.name },
  });
  return { key };
}

async function localKind(sql: Sql, jurisdictionId: string, key: string): Promise<void> {
  const [row] = await sql`
    select source from resource_kinds where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
  if (!row) throw new AuthError(404, "resource kind not found");
  if (row.source !== "local") throw new AuthError(409, "only a kind this jurisdiction added can be changed here");
}

/** The type levels of a kind that requests or pool resources name. */
async function levelsInUse(sql: Sql, jurisdictionId: string, key: string): Promise<{ used: boolean; types: Set<number> }> {
  const rows = await sql`
    select resource_type from resources where jurisdiction_id = ${jurisdictionId} and resource_kind = ${key}
    union all
    select resource_type from resource_requests where jurisdiction_id = ${jurisdictionId} and resource_kind = ${key}`;
  return {
    used: rows.length > 0,
    types: new Set(rows.map((row) => row.resource_type as number | null).filter((type): type is number => type !== null)),
  };
}

/** Edit a local kind. A type level still named by a request or a resource stays. */
export async function updateLocalKind(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  key: string,
  input: { name: string; discipline: string; levels: readonly ResourceTypeLevel[]; notes: string },
): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  await localKind(sql, jurisdictionId, key);
  const levels = checkLevels(input.levels);
  const { types } = await levelsInUse(sql, jurisdictionId, key);
  const kept = new Set(levels.map((level) => level.type));
  const dropped = [...types].filter((type) => !kept.has(type)).sort((a, b) => a - b);
  if (dropped.length) throw new AuthError(409, `type ${dropped.join(", ")} is still named by a request or a resource`);
  await sql`
    update resource_kinds set name = ${input.name}, discipline = ${input.discipline},
      levels = ${sql.json(levels as never)}, notes = ${input.notes}
    where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.kind_updated",
    subjectTable: "resource_kinds",
    payload: { key, name: input.name, types: levels.map((level) => level.type) },
  });
}

/** Delete a local kind that no request or resource names. */
export async function deleteLocalKind(sql: Sql, actor: Principal, jurisdictionId: string, key: string): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  await localKind(sql, jurisdictionId, key);
  if ((await levelsInUse(sql, jurisdictionId, key)).used)
    throw new AuthError(409, "a request or a resource still names this kind");
  await sql`delete from resource_kinds where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.kind_deleted",
    subjectTable: "resource_kinds",
    payload: { key },
  });
}

const IMPORT_COLUMNS = {
  name: ["name", "kindname", "resourcename", "resourcetypingdefinition"],
  id: ["id", "rtltid", "resourceid"],
  discipline: ["discipline", "category", "resourcecategory"],
  type: ["type", "typelevel", "level"],
  description: ["description", "capability"],
} as const;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const MAX_IMPORT_ROWS = 5000;

/** "3", "Type 3" or "Type III" to 3; blank or "Single Type" to null; anything else undefined. */
export function parseTypeLevel(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "" || /^single(\s+type)?$/i.test(text)) return null;
  const level = text.replace(/^type\s*/i, "");
  const n = /^\d+$/.test(level) ? Number(level) : ROMAN.indexOf(level.toUpperCase()) + 1;
  return n >= 1 && n <= 10 ? n : undefined;
}

/**
 * Import an RTLT export: one row per type level of a definition, grouped by
 * its RTLT ID. Every row imports or none does, and the new set replaces the
 * previous import. The source note says which export the file came from.
 */
export async function importKinds(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  csv: string,
  sourceNote: string,
): Promise<{ imported: number }> {
  requireAdmin(actor, jurisdictionId);
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (err) {
    throw new AuthError(422, `the file is not valid CSV: ${err instanceof Error ? err.message : String(err)}`);
  }
  const headers = (table[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const column = (field: keyof typeof IMPORT_COLUMNS) =>
    headers.findIndex((h) => (IMPORT_COLUMNS[field] as readonly string[]).includes(h));
  const at = { name: column("name"), id: column("id"), discipline: column("discipline"), type: column("type"), description: column("description") };
  if (at.name < 0 || at.id < 0) throw new AuthError(422, "the file needs a name column and an RTLT ID column");
  const data = table.slice(1);
  if (data.length === 0) throw new AuthError(422, "the file has no definitions");
  if (data.length > MAX_IMPORT_ROWS) throw new AuthError(422, `import at most ${MAX_IMPORT_ROWS} rows at a time`);

  const kinds = new Map<string, { name: string; discipline: string; levels: ResourceTypeLevel[]; notes: string }>();
  const errors: string[] = [];
  for (const [index, row] of data.entries()) {
    const line = index + 2;
    const cell = (i: number) => (i < 0 ? "" : (row[i] ?? "").trim());
    const id = cell(at.id);
    const name = cell(at.name);
    const type = parseTypeLevel(cell(at.type));
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) {
      errors.push(`row ${line}: the RTLT ID is missing or malformed`);
    } else if (!name || name.length > 200) {
      errors.push(`row ${line}: the name is missing or over 200 characters`);
    } else if (type === undefined) {
      errors.push(`row ${line}: "${cell(at.type)}" is not a type from 1 to 10`);
    } else {
      const kind = kinds.get(id) ?? { name, discipline: cell(at.discipline).slice(0, 200), levels: [], notes: "" };
      kinds.set(id, kind);
      const description = cell(at.description).slice(0, 2000);
      if (type === null) kind.notes = description;
      else if (kind.levels.some((level) => level.type === type)) errors.push(`row ${line}: type ${type} of ${id} appears twice`);
      else kind.levels.push({ type, capability: description });
    }
  }
  if (errors.length > 0) {
    const shown = errors.slice(0, 20).join("; ");
    throw new AuthError(422, `${errors.length} rows have errors and nothing was imported: ${shown}`);
  }

  const rows = [...kinds].map(([id, kind]) => ({
    key: `rtlt:${id}`,
    rtlt_id: id,
    name: kind.name,
    discipline: kind.discipline,
    levels: kind.levels.sort((a, b) => a.type - b.type),
    notes: kind.notes,
  }));
  await sql`delete from resource_kinds where jurisdiction_id = ${jurisdictionId} and source = 'rtlt'`;
  await sql`
    insert into resource_kinds (jurisdiction_id, key, name, discipline, levels, notes, source, rtlt_id, source_note, created_by)
    select ${jurisdictionId}, x.key, x.name, x.discipline, x.levels, x.notes, 'rtlt', x.rtlt_id, ${sourceNote}, ${actor.person.id}
    from jsonb_to_recordset(${sql.json(rows as never)}) as x(key text, rtlt_id text, name text, discipline text, levels jsonb, notes text)`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.kinds_imported",
    subjectTable: "resource_kinds",
    payload: { kinds: rows.length, sourceNote },
  });
  return { imported: rows.length };
}
