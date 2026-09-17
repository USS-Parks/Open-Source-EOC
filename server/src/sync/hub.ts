import * as Y from "yjs";
import { buildRecordSchema } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import type { Principal } from "../auth/service.js";
import { geomExpr, getEffectiveBoard, type EffectiveBoard } from "../boards/service.js";
import { recordAudit } from "../audit/service.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";

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
  readonly seq: number;
  readonly conflicts: number;
}

export class BoardSyncHub {
  private entries = new Map<string, HubEntry>();

  constructor(private readonly sql: Sql) {}

  /** Hydrate (or return) the live doc for a board the actor can read. */
  async open(actor: Principal, boardId: string): Promise<{ state: Uint8Array }> {
    const entry = await this.entry(actor, boardId);
    return { state: Y.encodeStateAsUpdate(entry.doc) };
  }

  subscribe(
    boardId: string,
    fn: (update: Uint8Array, originSession: string) => void,
  ): () => void {
    const entry = this.entries.get(boardId);
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
  ): Promise<ApplyResult> {
    const entry = await this.entry(actor, boardId);
    const before = snapshotRecords(entry.doc);

    const [row] = await withPerson(this.sql, actor.person.id, (tx) => {
      return tx`
        insert into sync_updates (board_id, update_data, origin_person, origin_position)
        values (${boardId}, ${Buffer.from(update)}, ${actor.person.id},
                ${actor.position?.id ?? null})
        returning seq`;
    });
    Y.applyUpdate(entry.doc, update);

    const after = snapshotRecords(entry.doc);
    const changed = changedRecordIds(before, after);
    let conflicts = 0;
    let committed: Array<{ recordId: string; existing: boolean }> = [];
    if (changed.length > 0) {
      ({ conflicts, committed } = await this.checkpoint(actor, entry, changed, after));
    }
    for (const fn of entry.subscribers) fn(update, originSession);
    // Post-commit notification fan-out for sync-originated changes.
    for (const c of committed) {
      const event: BoardEvent = {
        jurisdictionId: entry.board.jurisdictionId,
        boardId: entry.board.id,
        boardKey: entry.board.template.key,
        recordId: c.recordId,
        event: c.existing ? "record.updated" : "record.created",
        record: after.get(c.recordId)!,
        previous: before.get(c.recordId),
      };
      await notifyBoardEvent(this.sql, actor, event);
      publishBoardEvent(event);
    }
    return { seq: Number(row!.seq), conflicts };
  }

  private async checkpoint(
    actor: Principal,
    entry: HubEntry,
    recordIds: readonly string[],
    state: Map<string, Record<string, unknown>>,
  ): Promise<{ conflicts: number; committed: Array<{ recordId: string; existing: boolean }> }> {
    const committed: Array<{ recordId: string; existing: boolean }> = [];
    const schema = buildRecordSchema(entry.board.fields);
    // A record missing required fields mid-reconciliation is a normal
    // intermediate (the rest is still in flight on another client): it
    // stays in the CRDT log and projects once complete. Only VALUE
    // violations (bad enum, wrong type) are conflicts.
    const relaxed = buildRecordSchema(entry.board.fields.map((f) => ({ ...f, required: false })));
    let conflicts = 0;
    await withPerson(this.sql, actor.person.id, async (tx) => {
      for (const recordId of recordIds) {
        const data = state.get(recordId)!;
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          if (relaxed.safeParse(data).success) continue; // pending, not conflict
          conflicts += 1;
          await tx`
            insert into sync_conflicts (board_id, record_id, reason, rejected_data, origin_person)
            values (${entry.board.id}, ${recordId},
                    ${parsed.error.issues[0]?.message ?? "schema violation"},
                    ${tx.json(data as never)}, ${actor.person.id})`;
          await recordAudit(tx, actor, {
            jurisdictionId: entry.board.jurisdictionId,
            category: "sync.conflict",
            subjectTable: "board_records",
            subjectId: recordId,
            payload: { reason: parsed.error.issues[0]?.message ?? "schema violation" },
          });
          continue;
        }
        const [existing] = await tx`
          select id from board_records where id = ${recordId}`;
        if (existing) {
          await tx`
            update board_records
            set data = ${tx.json(parsed.data as never)}, updated_by = ${actor.person.id},
                updated_at = now(), geom = ${geomExpr(tx, entry.board.fields, parsed.data)}
            where id = ${recordId}`;
        } else {
          await tx`
            insert into board_records (id, board_id, data, created_by, created_by_position, geom)
            values (${recordId}, ${entry.board.id}, ${tx.json(parsed.data as never)},
                    ${actor.person.id}, ${actor.position?.id ?? null},
                    ${geomExpr(tx, entry.board.fields, parsed.data)})`;
        }
        await recordAudit(tx, actor, {
          jurisdictionId: entry.board.jurisdictionId,
          category: existing ? "board.record.updated" : "board.record.created",
          subjectTable: "board_records",
          subjectId: recordId,
          payload: { board: entry.board.template.key, via: "sync" },
        });
        committed.push({ recordId, existing: Boolean(existing) });
      }
    });
    return { conflicts, committed };
  }

  private async entry(actor: Principal, boardId: string): Promise<HubEntry> {
    const cached = this.entries.get(boardId);
    if (cached) return cached;
    const board = await withPerson(this.sql, actor.person.id, (tx) =>
      getEffectiveBoard(tx, actor, boardId),
    );
    const doc = new Y.Doc();
    const updates = await withPerson(this.sql, actor.person.id, (tx) => {
      return tx`
        select update_data from sync_updates where board_id = ${boardId} order by seq`;
    });
    for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u.update_data as Buffer));

    // Merge REST-created records the update log has never seen. Records
    // live as FLAT keys (`recordId/field`) so two clients creating the
    // same record while partitioned merge field-by-field; nested maps
    // created concurrently would replace each other wholesale.
    const records = doc.getMap<unknown>("records");
    const rows = await withPerson(this.sql, actor.person.id, (tx) => {
      return tx`select id, data from board_records where board_id = ${boardId}`;
    });
    doc.transact(() => {
      const seen = new Set<string>();
      for (const key of records.keys()) seen.add(key.split("/")[0]!);
      for (const r of rows) {
        const id = r.id as string;
        if (seen.has(id)) continue;
        for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) {
          records.set(`${id}/${k}`, v);
        }
      }
    });

    const entry: HubEntry = { doc, board, subscribers: new Set() };
    this.entries.set(boardId, entry);
    return entry;
  }
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
