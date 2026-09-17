import { createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * Content-addressed blob store on plain disk (threat B10, INV-3): the
 * blob path is its SHA-256, so stored bytes are immutable by construction
 * and identical content deduplicates. No hyperscaler anywhere.
 */
export class BlobStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private pathFor(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  async put(content: Buffer): Promise<{ sha256: string; size: number }> {
    const sha256 = createHash("sha256").update(content).digest("hex");
    const path = this.pathFor(sha256);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, content);
      await rename(tmp, path);
    }
    return { sha256, size: content.length };
  }

  async get(sha256: string): Promise<Buffer> {
    return readFile(this.pathFor(sha256));
  }
}

/** Allowed upload types (threat B10): documents, images, data. No executables. */
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/json",
  "application/geo+json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export interface UploadInput {
  readonly jurisdictionId: string;
  readonly name: string;
  readonly contentType: string;
  readonly content: Buffer;
  readonly attachedKind?: "none" | "board" | "incident" | "library" | undefined;
  readonly attachedId?: string | undefined;
  readonly supersedes?: string | undefined;
}

export async function uploadFile(
  sql: Sql,
  store: BlobStore,
  actor: Principal,
  input: UploadInput,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<{ id: string; sha256: string; version: number }> {
  requireWriter(actor, input.jurisdictionId);
  if (!ALLOWED_TYPES.has(input.contentType))
    throw new AuthError(400, `content type not allowed: ${input.contentType}`);
  if (input.content.length === 0) throw new AuthError(400, "empty file");
  if (input.content.length > maxBytes)
    throw new AuthError(400, `file exceeds the ${maxBytes} byte limit`);

  let version = 1;
  if (input.supersedes) {
    const [prev] = await sql`
      select version, jurisdiction_id from files where id = ${input.supersedes}`;
    if (!prev) throw new AuthError(404, "superseded file not found");
    if ((prev.jurisdiction_id as string) !== input.jurisdictionId)
      throw new AuthError(400, "version chain cannot cross jurisdictions");
    version = (prev.version as number) + 1;
  }

  const { sha256, size } = await store.put(input.content);
  const [row] = await sql`
    insert into files
      (jurisdiction_id, name, content_type, size, sha256, version, supersedes,
       attached_kind, attached_id, uploaded_by, uploaded_by_position)
    values
      (${input.jurisdictionId}, ${input.name}, ${input.contentType}, ${size}, ${sha256},
       ${version}, ${input.supersedes ?? null}, ${input.attachedKind ?? "none"},
       ${input.attachedId ?? null}, ${actor.person.id}, ${actor.position?.id ?? null})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId: input.jurisdictionId,
    category: "file.uploaded",
    subjectTable: "files",
    subjectId: id,
    payload: { name: input.name, sha256, version },
  });
  return { id, sha256, version };
}

export interface FileMeta {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly version: number;
  readonly supersedes: string | null;
}

export async function getFileMeta(sql: Sql, fileId: string): Promise<FileMeta> {
  const [row] = await sql`
    select id, name, content_type, size, sha256, version, supersedes
    from files where id = ${fileId}`;
  if (!row) throw new AuthError(404, "file not found");
  return {
    id: row.id as string,
    name: row.name as string,
    contentType: row.content_type as string,
    size: Number(row.size),
    sha256: row.sha256 as string,
    version: row.version as number,
    supersedes: (row.supersedes as string | null) ?? null,
  };
}

export interface SearchHit {
  readonly kind: "record" | "library" | "file" | "chronology";
  readonly id: string;
  readonly title: string;
}

/**
 * Platform search. Permission awareness is structural: every query runs
 * under the actor's RLS context, so a row the caller cannot read cannot
 * be returned, whatever the query says.
 */
export async function search(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  query: string,
): Promise<SearchHit[]> {
  const isMember = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId);
  const isGuest = actor.guests.some(
    (g) => g.jurisdictionId === jurisdictionId && g.expiresAt.getTime() > Date.now(),
  );
  if (!isMember && !isGuest) throw new AuthError(403, "no access to this jurisdiction");
  const hits: SearchHit[] = [];
  const records = await sql`
    select r.id, r.data from board_records r
    join boards b on b.id = r.board_id
    where b.jurisdiction_id = ${jurisdictionId}
      and to_tsvector('english', r.data::text) @@ plainto_tsquery('english', ${query})
    limit 25`;
  for (const r of records) {
    const data = r.data as Record<string, unknown>;
    hits.push({
      kind: "record",
      id: r.id as string,
      title: String(data.summary ?? data.item ?? data.name ?? "record"),
    });
  }
  const libraries = await sql`
    select id, title from libraries
    where jurisdiction_id = ${jurisdictionId}
      and to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', ${query})
    limit 25`;
  for (const l of libraries)
    hits.push({ kind: "library", id: l.id as string, title: l.title as string });
  const files = await sql`
    select id, name from files
    where jurisdiction_id = ${jurisdictionId}
      and to_tsvector('english', translate(name, '-._/', '    '))
          @@ plainto_tsquery('english', ${query})
    limit 25`;
  for (const f of files) hits.push({ kind: "file", id: f.id as string, title: f.name as string });
  const events = await sql`
    select id, category from audit_events
    where jurisdiction_id = ${jurisdictionId}
      and to_tsvector('english', category || ' ' || payload::text)
          @@ plainto_tsquery('english', ${query})
    limit 25`;
  for (const e of events)
    hits.push({ kind: "chronology", id: e.id as string, title: e.category as string });
  return hits;
}

function requireWriter(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access");
}
