import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, type Readable } from "node:stream";
import { createGzip } from "node:zlib";
import type { Row } from "postgres";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, requireAdmin, type Principal } from "../auth/service.js";
import { readAllPages } from "../db/cursor.js";
import type { BlobStore } from "../files/service.js";
import { currentLifelines, getSitrep, listSitreps } from "../sitreps/service.js";

/**
 * Portable jurisdiction export (INV-9/INV-10, continuity): the jurisdiction's
 * operational record as a gzip-compressed tar archive that any tar tool
 * opens. `export.json` holds the record; `files/<sha256>` holds the bytes of
 * each stored file, so `sha256sum` checks every file against its name.
 *
 * `export.json` keeps every schema 1 key: boards with their records (geometry
 * as GeoJSON), the sitrep archive and current lifelines. Schema 2 adds
 * incidents with their areas, participants and attached boards; IAPs, every
 * revision with its ICS-204 assignments inside `content`; AARs, observations
 * and corrective actions; resource requests with their costs and state
 * history; tasks; lifeline and ESF assessments with their decisions; and file
 * metadata. Rows in the added sections carry their database column names.
 * `publicAssistanceItems` (the PA damage inventory, geometry as GeoJSON) was
 * added later as a new key; schema 2 readers that ignore unknown keys are
 * unaffected, so the version stays 2.
 *
 * Admin-only, and every read runs as that admin under RLS, so the archive
 * holds only what the admin can read. The document is written to a temporary
 * file a page at a time inside one transaction; the archive then streams that
 * file and each blob in turn, so memory holds one page or one file and no
 * database connection waits on the download.
 */

const EXPORT_SCHEMA_VERSION = 2;
const PAGE_ROWS = 500;

type Write = (text: string) => Promise<void>;

/** Write the `row` column of a paged query as one JSON array. */
async function writeRows(
  write: Write,
  pages: AsyncIterable<Row[]>,
  seen?: (row: Record<string, unknown>) => void,
): Promise<void> {
  let first = true;
  await write("[");
  for await (const rows of pages) {
    if (rows.length === 0) continue;
    if (seen) for (const r of rows) seen(r.row as Record<string, unknown>);
    await write(`${first ? "" : ","}${rows.map((r) => JSON.stringify(r.row)).join(",")}`);
    first = false;
  }
  await write("]");
}

async function writeDocument(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  write: Write,
): Promise<{ slug: string; blobs: Set<string> }> {
  const [j] = await sql`select id, slug, name from jurisdictions where id = ${jurisdictionId}`;
  if (!j) throw new AuthError(404, "jurisdiction not found");
  const jurisdiction = { id: j.id as string, slug: j.slug as string, name: j.name as string };
  const section = (name: string) => write(`,${JSON.stringify(name)}:`);
  await write(`{"schemaVersion":${EXPORT_SCHEMA_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())}`);
  await section("jurisdiction");
  await write(JSON.stringify(jurisdiction));

  const boards = await sql`
    select id, title, template_key, template_version, local_fields
    from boards where jurisdiction_id = ${jurisdictionId} and archived_at is null
    order by title`;
  await section("boards");
  await write("[");
  for (const [i, b] of boards.entries()) {
    const head = JSON.stringify({
      id: b.id as string,
      title: b.title as string,
      templateKey: b.template_key as string,
      templateVersion: b.template_version as number,
      localFields: (b.local_fields as unknown[]) ?? [],
    });
    // The board object stays open while its records follow a page at a time.
    await write(`${i ? "," : ""}${head.slice(0, -1)},"records":`);
    await writeRows(write, sql`
      select jsonb_build_object('id', id, 'data', data, 'geometry', ST_AsGeoJSON(geom)::jsonb,
        'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as row
      from board_records where board_id = ${b.id as string} order by created_at, id`.cursor(PAGE_ROWS));
    await write("}");
  }
  await write("]");

  const sitreps = await readAllPages((page) => listSitreps(sql, actor, jurisdictionId, undefined, page));
  await section("sitreps");
  await write("[");
  for (const [i, s] of sitreps.entries())
    await write(`${i ? "," : ""}${JSON.stringify(await getSitrep(sql, actor, s.id))}`);
  await write("]");
  await section("lifelines");
  await write(JSON.stringify(await currentLifelines(sql, actor, jurisdictionId)));

  await section("incidents");
  await writeRows(write, sql`
    select to_jsonb(i) || jsonb_build_object(
      'areas', coalesce((
        select jsonb_agg(to_jsonb(a) || jsonb_build_object('geometry', ST_AsGeoJSON(a.geometry)::jsonb)
                         order by a.revision)
        from incident_area_revisions a where a.incident_id = i.id), '[]'),
      'participants', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
        from incident_participants p where p.incident_id = i.id), '[]'),
      'board_ids', coalesce((
        select jsonb_agg(ib.board_id order by ib.board_id)
        from incident_boards ib where ib.incident_id = i.id), '[]')) as row
    from incidents i where i.jurisdiction_id = ${jurisdictionId}
    order by i.activated_at, i.id`.cursor(PAGE_ROWS));

  await section("iaps");
  await writeRows(write, sql`
    select to_jsonb(p) as row from iaps p join incidents i on i.id = p.incident_id
    where i.jurisdiction_id = ${jurisdictionId}
    order by p.created_at, p.id`.cursor(PAGE_ROWS));

  await section("aars");
  await writeRows(write, sql`
    select to_jsonb(a) as row from aars a where a.jurisdiction_id = ${jurisdictionId}
    order by a.created_at, a.id`.cursor(PAGE_ROWS));
  await section("aarObservations");
  await writeRows(write, sql`
    select to_jsonb(o) as row from aar_observations o where o.jurisdiction_id = ${jurisdictionId}
    order by o.created_at, o.id`.cursor(PAGE_ROWS));
  await section("correctiveActions");
  await writeRows(write, sql`
    select to_jsonb(c) as row from corrective_actions c where c.jurisdiction_id = ${jurisdictionId}
    order by c.created_at, c.id`.cursor(PAGE_ROWS));

  await section("resourceRequests");
  await writeRows(write, sql`
    select to_jsonb(r) || jsonb_build_object(
      'costs', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
        from rr_costs c where c.request_id = r.id), '[]'),
      'history', coalesce((
        select jsonb_agg(to_jsonb(e) order by e.at, e.id)
        from rr_events e where e.request_id = r.id), '[]')) as row
    from resource_requests r where r.jurisdiction_id = ${jurisdictionId}
    order by r.created_at, r.id`.cursor(PAGE_ROWS));

  await section("tasks");
  await writeRows(write, sql`
    select to_jsonb(c) || jsonb_build_object('prerequisite_task_ids', coalesce((
        select jsonb_agg(d.prerequisite_task_id order by d.prerequisite_task_id)
        from checklist_task_dependencies d where d.task_id = c.id), '[]')) as row
    from checklist_items c join incidents i on i.id = c.incident_id
    where i.jurisdiction_id = ${jurisdictionId}
    order by c.incident_id, c.sort_order, c.created_at, c.id`.cursor(PAGE_ROWS));

  await section("assessments");
  await writeRows(write, sql`
    select to_jsonb(a) as row from operational_assessments a where a.jurisdiction_id = ${jurisdictionId}
    order by a.created_at, a.id`.cursor(PAGE_ROWS));
  await section("assessmentDecisions");
  await writeRows(write, sql`
    select to_jsonb(d) as row from operational_assessment_decisions d where d.jurisdiction_id = ${jurisdictionId}
    order by d.created_at, d.id`.cursor(PAGE_ROWS));

  await section("publicAssistanceItems");
  await writeRows(write, sql`
    select (to_jsonb(p) - 'geom') || jsonb_build_object('geometry', ST_AsGeoJSON(p.geom)::jsonb) as row
    from damage_pa_items p where p.jurisdiction_id = ${jurisdictionId}
    order by p.created_at, p.id`.cursor(PAGE_ROWS));

  const blobs = new Set<string>();
  await section("files");
  await writeRows(write, sql`
    select to_jsonb(f) || jsonb_build_object('archive_path', 'files/' || f.sha256, 'folder_name', folder.name) as row
    from files f left join file_folders folder on folder.id = f.folder_id
    where f.jurisdiction_id = ${jurisdictionId}
    order by f.created_at, f.id`.cursor(PAGE_ROWS), (row) => blobs.add(row.sha256 as string));

  await write("}");
  return { slug: jurisdiction.slug, blobs };
}

/** A POSIX ustar header for one regular file. */
function tarHeader(name: string, size: number): Buffer {
  // Eleven octal digits hold sizes below 8 GiB.
  if (size >= 8 ** 11) throw new Error(`${name} is too large for a tar entry`);
  const header = Buffer.alloc(512);
  const octal = (value: number, width: number, offset: number) =>
    header.write(value.toString(8).padStart(width - 1, "0"), offset, "ascii");
  header.write(name, 0, "ascii");
  octal(0o644, 8, 100);
  octal(0, 8, 108);
  octal(0, 8, 116);
  octal(size, 12, 124);
  octal(Math.floor(Date.now() / 1000), 12, 136);
  header.write("0", 156, "ascii");
  header.write("ustar\u000000", 257, "ascii");
  // The checksum is summed with its own field read as spaces.
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\u0000 `, 148, "ascii");
  return header;
}

async function* tarEntry(name: string, size: number, body: AsyncIterable<Buffer> | Iterable<Buffer>) {
  yield tarHeader(name, size);
  yield* body;
  yield Buffer.alloc((512 - (size % 512)) % 512);
}

async function* tarEntries(docPath: string, blobs: Iterable<string>, store: BlobStore): AsyncGenerator<Buffer> {
  yield* tarEntry("export.json", (await stat(docPath)).size, createReadStream(docPath));
  for (const sha256 of blobs) {
    const bytes = await store.get(sha256);
    yield* tarEntry(`files/${sha256}`, bytes.length, [bytes]);
  }
  // Two zero blocks end the archive.
  yield Buffer.alloc(1024);
}

/** The jurisdiction export as a streamed `.tar.gz`, and the slug that names its file. */
export async function exportJurisdictionArchive(
  sql: Sql,
  store: BlobStore,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ slug: string; archive: Readable }> {
  requireAdmin(actor, jurisdictionId);
  const dir = await mkdtemp(join(tmpdir(), "openeoc-export-"));
  const cleanup = () => rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  try {
    const docPath = join(dir, "export.json");
    const file = await open(docPath, "wx");
    let written: { slug: string; blobs: Set<string> };
    try {
      written = await withPerson(sql, actor.person.id, (tx) =>
        writeDocument(tx, actor, jurisdictionId, (text) => file.appendFile(text)));
    } finally {
      await file.close();
    }
    // The temporary document goes once the archive has been read or abandoned.
    const archive = pipeline(tarEntries(docPath, written.blobs, store), createGzip(), () => void cleanup());
    return { slug: written.slug, archive };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
