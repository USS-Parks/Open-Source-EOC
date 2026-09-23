import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, cutPage, decodeCursor } from "../db/cursor.js";

/** An upload written to a staging file, not yet visible in the store. */
export interface StagedBlob {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

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

  /**
   * Stream an upload to a staging file, hashing and counting as it goes, so
   * no upload is ever held in memory. More than `maxBytes` fails with 413
   * and leaves nothing behind.
   */
  async stage(source: Readable, maxBytes: number): Promise<StagedBlob> {
    const path = join(this.root, `.upload-${randomUUID()}`);
    const hash = createHash("sha256");
    let size = 0;
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > maxBytes) throw new AuthError(413, `file exceeds the ${maxBytes} byte limit`);
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(path, { flags: "wx" }),
      );
    } catch (err) {
      await rm(path, { force: true });
      throw err;
    }
    return { path, sha256: hash.digest("hex"), size };
  }

  /** Move a staged upload into the store under its hash. */
  async commit(staged: StagedBlob): Promise<void> {
    const path = this.pathFor(staged.sha256);
    if (existsSync(path)) return;
    mkdirSync(dirname(path), { recursive: true });
    await rename(staged.path, path);
  }

  /** Remove a staging file; a no-op once it has been committed. */
  async discard(staged: StagedBlob): Promise<void> {
    await rm(staged.path, { force: true });
  }

  async get(sha256: string): Promise<Buffer> {
    return readFile(this.pathFor(sha256));
  }
}

/** Allowed upload types (threat B10): documents, images, audio, data. No executables. */
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  // Audio answers to field forms, as phones and browsers record them.
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "text/plain",
  "text/csv",
  "application/json",
  "application/geo+json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export interface UploadLimits {
  /** Largest single file, in bytes. */
  readonly maxFileBytes: number;
  /** Total bytes of stored file versions one jurisdiction may hold. */
  readonly quotaBytes: number;
}

const MIB = 1024 * 1024;

/**
 * OPENEOC_MAX_UPLOAD_MB (default 25) caps one file and
 * OPENEOC_JURISDICTION_QUOTA_MB (default 10240) caps the sum of every stored
 * file version in one jurisdiction. An invalid value fails at startup.
 */
export function uploadLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  const mb = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback * MIB;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of megabytes`);
    return Math.floor(value * MIB);
  };
  return {
    maxFileBytes: mb("OPENEOC_MAX_UPLOAD_MB", 25),
    quotaBytes: mb("OPENEOC_JURISDICTION_QUOTA_MB", 10240),
  };
}

export interface UploadInput {
  readonly jurisdictionId: string;
  readonly name: string;
  readonly contentType: string;
  readonly content: Readable;
  readonly attachedKind?: "none" | "board" | "record" | "incident" | "library" | undefined;
  readonly attachedId?: string | undefined;
  readonly supersedes?: string | undefined;
}

/** Namespace of the per-jurisdiction quota lock, in the two-key advisory lock space. */
const QUOTA_LOCK = 0x0f11e5;

/**
 * Store one upload. The bytes stream to a staging file before any
 * transaction opens, so a slow client holds no database connection. The
 * quota check, the file row and the move into the store then run in one
 * transaction under a per-jurisdiction advisory lock, so two concurrent
 * uploads cannot both pass a check only one of them fits.
 */
export async function uploadFile(
  sql: Sql,
  store: BlobStore,
  actor: Principal,
  input: UploadInput,
  limits: UploadLimits,
): Promise<{ id: string; sha256: string; version: number }> {
  requireWriter(actor, input.jurisdictionId);
  if (!ALLOWED_TYPES.has(input.contentType))
    throw new AuthError(400, `content type not allowed: ${input.contentType}`);
  const staged = await store.stage(input.content, limits.maxFileBytes);
  try {
    if (staged.size === 0) throw new AuthError(400, "empty file");
    return await withPerson(sql, actor.person.id, async (tx) => {
      await tx`select pg_advisory_xact_lock(${QUOTA_LOCK}, hashtext(${input.jurisdictionId}))`;
      const [usage] = await tx`
        select coalesce(sum(size), 0)::bigint as used from files
        where jurisdiction_id = ${input.jurisdictionId}`;
      const used = Number(usage!.used);
      if (used + staged.size > limits.quotaBytes)
        throw new AuthError(
          409,
          `jurisdiction file quota exceeded: ${used} of ${limits.quotaBytes} bytes in use, this file is ${staged.size} bytes`,
        );
      await assertAttachmentTarget(tx, input.jurisdictionId, input.attachedKind ?? "none", input.attachedId);

      let version = 1;
      if (input.supersedes) {
        const [prev] = await tx`
          select version, jurisdiction_id from files where id = ${input.supersedes}`;
        if (!prev) throw new AuthError(404, "superseded file not found");
        if ((prev.jurisdiction_id as string) !== input.jurisdictionId)
          throw new AuthError(400, "version chain cannot cross jurisdictions");
        version = (prev.version as number) + 1;
      }

      const [row] = await tx`
        insert into files
          (jurisdiction_id, name, content_type, size, sha256, version, supersedes,
           attached_kind, attached_id, uploaded_by, uploaded_by_position)
        values
          (${input.jurisdictionId}, ${input.name}, ${input.contentType}, ${staged.size}, ${staged.sha256},
           ${version}, ${input.supersedes ?? null}, ${input.attachedKind ?? "none"},
           ${input.attachedId ?? null}, ${actor.person.id}, ${actor.position?.id ?? null})
        returning id`;
      const id = row!.id as string;
      await recordAudit(tx, actor, {
        jurisdictionId: input.jurisdictionId,
        category: "file.uploaded",
        subjectTable: "files",
        subjectId: id,
        payload: { name: input.name, sha256: staged.sha256, version },
      });
      // Last, so a failed move rolls the row back instead of leaving it
      // pointing at no bytes.
      await store.commit(staged);
      return { id, sha256: staged.sha256, version };
    });
  } finally {
    await store.discard(staged);
  }
}

export type FileAttachmentKind = "none" | "board" | "record" | "incident" | "library";

export interface FileMeta {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly version: number;
  readonly supersedes: string | null;
  readonly attachedKind: FileAttachmentKind;
  readonly attachedId: string | null;
  readonly attachedBoardId: string | null;
  readonly attachedIncidentId: string | null;
  readonly createdAt: string;
  readonly uploadedBy: { readonly personId: string; readonly displayName: string; readonly positionTitle: string | null };
}

export async function getFileMeta(sql: Sql, fileId: string): Promise<FileMeta> {
  // The jurisdiction wall lives in the query itself, not only in the files
  // RLS policy, so a file never crosses tenants even under the owner
  // connection (first boot, main.ts) where RLS does not apply. This mirrors
  // the files_read policy exactly: membership of the file's jurisdiction.
  const [row] = await sql`
    select f.id, f.name, f.content_type, f.size, f.sha256, f.version, f.supersedes,
           f.attached_kind, f.attached_id, f.created_at, f.uploaded_by,
           p.display_name as uploaded_by_name, pos.title as uploaded_by_position,
           case when f.attached_kind = 'record' then br.board_id
                when f.attached_kind = 'board' then f.attached_id else null end as attached_board_id,
           case when f.attached_kind = 'record' then br.incident_id
                else null end as attached_incident_id
    from files f
    join persons p on p.id = f.uploaded_by
    left join positions pos on pos.id = f.uploaded_by_position
    left join board_records br on f.attached_kind = 'record' and br.id = f.attached_id
    where f.id = ${fileId} and is_member_of(f.jurisdiction_id)`;
  if (!row) throw new AuthError(404, "file not found");
  return {
    id: row.id as string,
    name: row.name as string,
    contentType: row.content_type as string,
    size: Number(row.size),
    sha256: row.sha256 as string,
    version: row.version as number,
    supersedes: (row.supersedes as string | null) ?? null,
    attachedKind: row.attached_kind as FileAttachmentKind,
    attachedId: (row.attached_id as string | null) ?? null,
    attachedBoardId: (row.attached_board_id as string | null) ?? null,
    attachedIncidentId: (row.attached_incident_id as string | null) ?? null,
    createdAt: new Date(row.created_at as Date | string).toISOString(),
    uploadedBy: {
      personId: row.uploaded_by as string,
      displayName: row.uploaded_by_name as string,
      positionTitle: (row.uploaded_by_position as string | null) ?? null,
    },
  };
}

export interface FilePage {
  readonly files: readonly FileMeta[];
  readonly nextCursor: string | null;
}

export async function listFiles(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  options: { readonly attachedKind?: FileAttachmentKind | undefined; readonly attachedId?: string | undefined; readonly cursor?: string | undefined; readonly limit: number },
): Promise<FilePage> {
  requireReader(actor, jurisdictionId);
  const after = decodeCursor(options.cursor, ["at", "id"]);
  const limit = Math.max(1, Math.min(options.limit, 100));
  if (options.attachedId !== undefined && options.attachedKind === undefined)
    throw new AuthError(400, "attachment kind is required with an attachment id");
  if (options.attachedKind !== undefined && options.attachedKind !== "none" && options.attachedId === undefined)
    throw new AuthError(400, "attachment id is required for the selected kind");
  if (options.attachedKind === "none" && options.attachedId !== undefined)
    throw new AuthError(400, "unattached files cannot name an attachment target");
  const rows = await sql`
    select f.id, f.name, f.content_type, f.size, f.sha256, f.version, f.supersedes,
           f.attached_kind, f.attached_id, f.created_at, f.uploaded_by,
           p.display_name as uploaded_by_name, pos.title as uploaded_by_position,
           case when f.attached_kind = 'record' then br.board_id
                when f.attached_kind = 'board' then f.attached_id else null end as attached_board_id,
           case when f.attached_kind = 'record' then br.incident_id
                else null end as attached_incident_id,
           to_char(f.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from files f
    join persons p on p.id = f.uploaded_by
    left join positions pos on pos.id = f.uploaded_by_position
    left join board_records br on f.attached_kind = 'record' and br.id = f.attached_id
    where f.jurisdiction_id = ${jurisdictionId}
      and (${options.attachedKind ?? null}::text is null or f.attached_kind = ${options.attachedKind ?? null})
      and (${options.attachedId ?? null}::uuid is null or f.attached_id = ${options.attachedId ?? null})
      ${after ? sql`and (f.created_at, f.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by f.created_at desc, f.id desc
    limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (row) => [row.page_at as string, row.id as string]);
  return { files: items.map(fileMetaFromRow), nextCursor };
}

export interface SearchHit {
  readonly kind: "record" | "library" | "file" | "chronology";
  readonly id: string;
  readonly title: string;
  readonly boardId?: string;
  readonly incidentId?: string | null;
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
    select r.id, r.data, r.board_id, r.incident_id from board_records r
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
      boardId: r.board_id as string,
      incidentId: (r.incident_id as string | null) ?? null,
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

function fileMetaFromRow(row: Record<string, unknown>): FileMeta {
  return {
    id: row.id as string,
    name: row.name as string,
    contentType: row.content_type as string,
    size: Number(row.size),
    sha256: row.sha256 as string,
    version: Number(row.version),
    supersedes: (row.supersedes as string | null) ?? null,
    attachedKind: row.attached_kind as FileAttachmentKind,
    attachedId: (row.attached_id as string | null) ?? null,
    attachedBoardId: (row.attached_board_id as string | null) ?? null,
    attachedIncidentId: (row.attached_incident_id as string | null) ?? null,
    createdAt: new Date(row.created_at as Date | string).toISOString(),
    uploadedBy: {
      personId: row.uploaded_by as string,
      displayName: row.uploaded_by_name as string,
      positionTitle: (row.uploaded_by_position as string | null) ?? null,
    },
  };
}

async function assertAttachmentTarget(
  sql: Sql,
  jurisdictionId: string,
  kind: FileAttachmentKind,
  id: string | undefined,
): Promise<void> {
  if (kind === "none") {
    if (id !== undefined) throw new AuthError(400, "unattached files cannot name an attachment target");
    return;
  }
  if (!id) throw new AuthError(400, "attachment target is required");
  const rows = kind === "board"
    ? await sql`select id from boards where id = ${id} and jurisdiction_id = ${jurisdictionId}`
    : kind === "record"
      ? await sql`select r.id from board_records r join boards b on b.id = r.board_id
          where r.id = ${id} and b.jurisdiction_id = ${jurisdictionId}`
      : kind === "incident"
        ? await sql`select id from incidents where id = ${id} and jurisdiction_id = ${jurisdictionId}`
        : await sql`select id from libraries where id = ${id} and jurisdiction_id = ${jurisdictionId}`;
  if (!rows[0]) throw new AuthError(400, "attachment target not found in this jurisdiction");
}

function requireReader(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((membership) => membership.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
