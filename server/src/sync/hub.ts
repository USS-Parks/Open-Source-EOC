import { createHash } from "node:crypto";
import * as Y from "yjs";
import { buildRecordSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import {
  geomExpr,
  getEffectiveBoard,
  getIncidentBoardReadShape,
  lockBoardMutation,
  checkFieldWrites,
  validateRecordReferences,
  visibleFields,
  type EffectiveBoard,
} from "../boards/service.js";
import { recordAudit } from "../audit/service.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * The board sync hub (ADR-0003). One Y.Doc per board; the durable state is
 * the append-only sync_updates log, hydrated on first access and merged
 * with any REST-created records. Every applied update checkpoints the
 * changed records into board_records (the queryable truth) under the
 * originating principal, validated against the board schema; a record the
 * schema refuses becomes a visible conflict, never a silent loss.
 */

interface HubEntry {
  doc: Y.Doc;
  board: EffectiveBoard;
  subscribers: Set<(update: Uint8Array, originSession: string) => void>;
}

export interface ApplyResult {
  readonly operationId: string | null;
  readonly seq: number;
  readonly conflicts: number;
  readonly exact: boolean;
}

export interface ExactSyncContext {
  readonly operationId: string;
  readonly incidentId: string;
}

export class BoardSyncHub {
  private entries = new Map<string, HubEntry>();

  constructor(private readonly sql: Sql) {}

  /** Hydrate the legacy board-wide doc or one validated incident-scoped doc. */
  async open(
    actor: Principal,
    boardId: string,
    incidentId: string | null = null,
  ): Promise<{ state: Uint8Array }> {
    const entry = await this.entry(actor, boardId, incidentId);
    if (!incidentId) return { state: Y.encodeStateAsUpdate(entry.doc) };
    const projected = await withPerson(this.sql, actor.person.id, async (tx) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(entry.doc));
      await seedBoardRows(tx, doc, boardId, incidentId, entry.board);
      return doc;
    });
    return { state: Y.encodeStateAsUpdate(projected) };
  }

  subscribe(
    boardId: string,
    incidentId: string | null,
    fn: (update: Uint8Array, originSession: string) => void,
  ): () => void {
    const entry = this.entries.get(entryKey(boardId, incidentId));
    if (!entry) throw new Error("board not open");
    entry.subscribers.add(fn);
    return () => entry.subscribers.delete(fn);
  }

  /**
   * Apply one client update: durably append, merge into the doc, then
   * checkpoint every record the update touched, attributed to the actor.
   */
  async apply(
    actor: Principal,
    boardId: string,
    update: Uint8Array,
    originSession: string,
    context: ExactSyncContext | null = null,
  ): Promise<ApplyResult> {
    const incidentId = context?.incidentId ?? null;
    const entry = await this.entry(actor, boardId, incidentId);
    const digest = context ? syncDigest(actor.person.id, boardId, context, update) : null;
    let outcome: {
      board: EffectiveBoard;
      doc: Y.Doc | null;
      before: Map<string, Record<string, unknown>>;
      after: Map<string, Record<string, unknown>>;
      committed: Array<{ recordId: string; existing: boolean }>;
      result: ApplyResult;
      replay: boolean;
    };
    try {
      outcome = await withPerson(this.sql, actor.person.id, async (tx) => {
        await lockBoardMutation(tx, boardId);
        const board = context
          ? { ...(await getIncidentBoardReadShape(tx, actor, context.incidentId, boardId)), role: "member" as const }
          : await getEffectiveBoard(tx, actor, boardId);
        if (context) {
          const authority = await getIncidentAuthority(tx, actor, context.incidentId);
          const [attached] = await tx`
            select i.closed_at from incident_boards ib
            join incidents i on i.id = ib.incident_id
            where ib.board_id = ${boardId} and ib.incident_id = ${context.incidentId}`;
          if (!attached) throw new AuthError(409, "board is not attached to this incident");
          const [prior] = await tx`
            select board_id, incident_id, request_digest, seq, conflicts
            from sync_updates
            where origin_person = ${actor.person.id} and operation_id = ${context.operationId}`;
          if (prior) {
            if (prior.board_id !== boardId || prior.incident_id !== context.incidentId ||
                prior.request_digest !== digest) {
              throw new AuthError(409, "sync operation id was used for another payload or scope");
            }
            return {
              board,
              doc: null,
              before: new Map(),
              after: new Map(),
              committed: [],
              result: {
                operationId: context.operationId,
                seq: Number(prior.seq),
                conflicts: Number(prior.conflicts),
                exact: true,
              },
              replay: true,
            };
          }
          if (!authority.canContribute) throw new AuthError(403, "incident contribution required");
          if (attached.closed_at) throw new AuthError(409, "incident is closed");
        }

        const doc = await hydrateBoardDoc(tx, boardId, incidentId, board);
        const before = snapshotRecords(doc);
        if (incidentId) {
          for (const [recordId, data] of await loadBoardRows(tx, boardId, incidentId, board)) {
            before.set(recordId, data);
          }
        }
        Y.applyUpdate(doc, update);
        const after = snapshotRecords(doc);
        const changed = changedRecordIds(before, after);
        const checkpoint = changed.length > 0
          ? await this.checkpoint(tx, actor, board, changed, after, before, incidentId)
          : { conflicts: 0, committed: [] };
        const [row] = await tx`
          insert into sync_updates
            (board_id, update_data, origin_person, origin_position,
             incident_id, operation_id, request_digest, conflicts)
          values (${boardId}, ${Buffer.from(update)}, ${actor.person.id},
                  ${actor.position?.id ?? null}, ${context?.incidentId ?? null},
                  ${context?.operationId ?? null}, ${digest},
                  ${context ? checkpoint.conflicts : null})
          returning seq`;
        return {
          board,
          doc,
          before,
          after,
          committed: checkpoint.committed,
          result: {
            operationId: context?.operationId ?? null,
            seq: Number(row!.seq),
            conflicts: checkpoint.conflicts,
            exact: context !== null,
          },
          replay: false,
        };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new AuthError(409, "sync operation id was used for another payload or scope");
      }
      throw error;
    }
    if (outcome.replay) return outcome.result;
    entry.board = outcome.board;
    entry.doc = outcome.doc!;
    for (const fn of entry.subscribers) fn(update, originSession);
    // Post-commit notification fan-out for sync-originated changes.
    for (const c of outcome.committed) {
      const event: BoardEvent = {
        jurisdictionId: outcome.board.jurisdictionId,
        boardId: outcome.board.id,
        boardKey: outcome.board.template.key,
        recordId: c.recordId,
        event: c.existing ? "record.updated" : "record.created",
        record: outcome.after.get(c.recordId)!,
        previous: outcome.before.get(c.recordId),
      };
      await notifyBoardEvent(this.sql, actor, event);
      publishBoardEvent(event);
    }
    return outcome.result;
  }

  private async checkpoint(
    tx: Sql,
    actor: Principal,
    board: EffectiveBoard,
    recordIds: readonly string[],
    state: Map<string, Record<string, unknown>>,
    before: Map<string, Record<string, unknown>>,
    incidentId: string | null,
  ): Promise<{ conflicts: number; committed: Array<{ recordId: string; existing: boolean }> }> {
    const committed: Array<{ recordId: string; existing: boolean }> = [];
    let conflicts = 0;
    const schema = buildRecordSchema(board.fields);
    // Missing required fields may still be in flight from another client.
    // Value violations become durable conflicts instead of silent loss.
    const relaxed = buildRecordSchema(board.fields.map((field) => ({ ...field, required: false })));
    for (const recordId of recordIds) {
        const incoming = state.get(recordId)!;
        const [existing] = await tx`
          select id, data from board_records
          where id = ${recordId} and board_id = ${board.id}
            and (${incidentId}::uuid is null or incident_id = ${incidentId})`;
        const data = existing && incidentId
          ? { ...(existing.data as Record<string, unknown>), ...incoming }
          : incoming;
        if (incidentId) {
          const prior = before.get(recordId) ?? {};
          const keys = existing ? changedFieldKeys(prior, incoming) : Object.keys(incoming);
          checkFieldWrites(board, keys);
        }
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          if (relaxed.safeParse(data).success) continue; // pending, not conflict
          conflicts += 1;
          await tx`
            insert into sync_conflicts
              (board_id, incident_id, record_id, reason, rejected_data, origin_person)
            values (${board.id}, ${incidentId}, ${recordId},
                    ${parsed.error.issues[0]?.message ?? "schema violation"},
                    ${tx.json(data as never)}, ${actor.person.id})`;
          await recordAudit(tx, actor, {
            jurisdictionId: board.jurisdictionId,
            category: "sync.conflict",
            subjectTable: "board_records",
            subjectId: recordId,
            payload: { reason: parsed.error.issues[0]?.message ?? "schema violation" },
            ...(incidentId ? { incidentId } : {}),
          });
          continue;
        }
        if (incidentId) {
          await validateRecordReferences(tx, actor, board, parsed.data, incidentId);
        }
        if (existing) {
          await tx`
            update board_records
            set data = ${tx.json(parsed.data as never)}, updated_by = ${actor.person.id},
                updated_at = now(), geom = ${geomExpr(tx, board.fields, parsed.data)}
            where id = ${recordId} and board_id = ${board.id}
              and (${incidentId}::uuid is null or incident_id = ${incidentId})`;
        } else {
          await tx`
            insert into board_records
              (id, board_id, incident_id, data, created_by, created_by_position, geom)
            values (${recordId}, ${board.id}, ${incidentId}, ${tx.json(parsed.data as never)},
                    ${actor.person.id}, ${actor.position?.id ?? null},
                    ${geomExpr(tx, board.fields, parsed.data)})`;
        }
        await recordAudit(tx, actor, {
          jurisdictionId: board.jurisdictionId,
          category: existing ? "board.record.updated" : "board.record.created",
          subjectTable: "board_records",
          subjectId: recordId,
          payload: { board: board.template.key, via: "sync" },
          ...(incidentId ? { incidentId } : {}),
        });
        committed.push({ recordId, existing: Boolean(existing) });
    }
    return { conflicts, committed };
  }

  private async entry(
    actor: Principal,
    boardId: string,
    incidentId: string | null,
  ): Promise<HubEntry> {
    const key = entryKey(boardId, incidentId);
    const loaded = await withPerson(this.sql, actor.person.id, async (tx) => {
      const board = incidentId
        ? { ...(await getIncidentBoardReadShape(tx, actor, incidentId, boardId)), role: "member" as const }
        : await getEffectiveBoard(tx, actor, boardId);
      const cached = this.entries.get(key);
      if (cached) return { board, doc: null as Y.Doc | null, cached };
      const doc = await hydrateBoardDoc(tx, boardId, incidentId, board);
      return { board, doc, cached: null };
    });
    if (loaded.cached) {
      loaded.cached.board = loaded.board;
      return loaded.cached;
    }
    const entry: HubEntry = { doc: loaded.doc!, board: loaded.board, subscribers: new Set() };
    this.entries.set(key, entry);
    return entry;
  }
}

async function hydrateBoardDoc(
  sql: Sql,
  boardId: string,
  incidentId: string | null,
  board: EffectiveBoard,
): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const updates = await sql`
    select update_data from sync_updates
    where board_id = ${boardId}
      and (${incidentId}::uuid is null or incident_id = ${incidentId})
    order by seq`;
  for (const update of updates) {
    Y.applyUpdate(doc, new Uint8Array(update.update_data as Buffer));
  }
  if (!incidentId) await seedBoardRows(sql, doc, boardId, null, board);
  return doc;
}

async function seedBoardRows(
  sql: Sql,
  doc: Y.Doc,
  boardId: string,
  incidentId: string | null,
  board: EffectiveBoard,
): Promise<void> {
  const records = doc.getMap<unknown>("records");
  const rows = await loadBoardRows(sql, boardId, incidentId, board);
  doc.transact(() => {
    const seen = new Set<string>();
    for (const key of records.keys()) seen.add(key.split("/")[0]!);
    for (const [id, data] of rows) {
      if (seen.has(id)) continue;
      for (const [key, value] of Object.entries(data)) records.set(`${id}/${key}`, value);
    }
  });
}

async function loadBoardRows(
  sql: Sql,
  boardId: string,
  incidentId: string | null,
  board: EffectiveBoard,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await sql`
    select id, data from board_records
    where board_id = ${boardId}
      and (${incidentId}::uuid is null or incident_id = ${incidentId})`;
  const readable = incidentId ? new Set(visibleFields(board).map((field) => field.key)) : null;
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.data as Record<string, unknown>)) {
      if (!readable || readable.has(key)) data[key] = value;
    }
    result.set(row.id as string, data);
  }
  return result;
}

const entryKey = (boardId: string, incidentId: string | null): string =>
  incidentId ? `${boardId}:incident:${incidentId}` : `${boardId}:legacy`;

function syncDigest(
  personId: string,
  boardId: string,
  context: ExactSyncContext,
  update: Uint8Array,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      personId,
      boardId,
      incidentId: context.incidentId,
      operationId: context.operationId,
    }))
    .update(update)
    .digest("hex");
}

function snapshotRecords(doc: Y.Doc): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const records = doc.getMap<unknown>("records");
  for (const [key, value] of records.entries()) {
    const slash = key.indexOf("/");
    if (slash <= 0) continue;
    const id = key.slice(0, slash);
    const field = key.slice(slash + 1);
    const rec = out.get(id) ?? {};
    rec[field] = value;
    out.set(id, rec);
  }
  return out;
}

function changedRecordIds(
  before: Map<string, Record<string, unknown>>,
  after: Map<string, Record<string, unknown>>,
): string[] {
  const changed: string[] = [];
  for (const [id, data] of after) {
    const prev = before.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(data)) changed.push(id);
  }
  return changed;
}

function changedFieldKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(after).filter((key) =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
