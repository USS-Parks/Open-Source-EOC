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
  readsEveryRecord,
  validateRecordReferences,
  visibleFields,
  type EffectiveBoard,
} from "../boards/service.js";
import { onRecordRemoved, type RecordRemoval } from "../boards/removals.js";
import { recordAudit } from "../audit/service.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { onBoardEvent, publishBoardEvent } from "../events/bus.js";
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
  /** Encoded state of `doc`, rebuilt lazily so repeat opens stop re-encoding. */
  encoded: Uint8Array | null;
  /**
   * Board rows keyed by the reader's visible-field signature. Two actors with
   * the same readable fields share one projection; a reader with narrower
   * fields gets its own. Cleared whenever a record changes by any path.
   */
  rows: Map<string, Map<string, Record<string, unknown>>>;
  /** Template version the doc was hydrated against, to catch an upgrade. */
  templateVersion: number;
  /** Highest sync_updates.seq folded into `doc`. */
  throughSeq: number;
  /** Updates replayed past the snapshot, the trigger for writing a new one. */
  sinceSnapshot: number;
  /** Open apply calls; eviction waits for these. */
  active: number;
  idle: NodeJS.Timeout | null;
}

/**
 * How long an entry with no subscribers is kept before its Y.Doc is dropped.
 * Long enough that a reconnecting client re-attaches to a warm doc, short
 * enough that a long activation does not accumulate every board it touched.
 */
const IDLE_EVICT_MS = 60_000;

/**
 * Updates replayed past a snapshot before a new one is written. A snapshot is
 * one encoded state, so this bounds hydration work rather than log size; the
 * log itself is append-only and is trimmed, if ever, by retention policy.
 */
const SNAPSHOT_THRESHOLD = 200;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Origin prefix of an update received from a federation peer; the peer id follows. */
export const FEDERATION_ORIGIN = "federation:";

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

export interface HubOptions {
  /** Grace period before an entry with no subscribers is dropped. */
  readonly idleEvictMs?: number;
  /** Updates past a snapshot before a new one is written. */
  readonly snapshotThreshold?: number;
}

/** Counters for the lifecycle, for tests and for the metrics endpoint. */
export interface HubStats {
  /** Y.Docs currently held. */
  readonly entries: number;
  /** Times a scope's doc was rebuilt from the log. */
  readonly hydrations: number;
  /** Times board rows were read from the database for a projection. */
  readonly rowLoads: number;
  /** Snapshots written. */
  readonly snapshots: number;
}

export class BoardSyncHub {
  private entries = new Map<string, HubEntry>();
  private readonly unlisten: () => void;
  private readonly unlistenRemovals: () => void;
  private readonly idleEvictMs: number;
  private readonly snapshotThreshold: number;
  private hydrations = 0;
  private rowLoads = 0;
  private snapshots = 0;

  constructor(private readonly sql: Sql, options: HubOptions = {}) {
    this.idleEvictMs = options.idleEvictMs ?? IDLE_EVICT_MS;
    this.snapshotThreshold = options.snapshotThreshold ?? SNAPSHOT_THRESHOLD;
    // A record written over REST never passes through apply(), so the row
    // projections have to be invalidated from the event bus or a reader would
    // keep being served the rows as they stood when the doc was first opened.
    this.unlisten = onBoardEvent((event) => {
      for (const [key, entry] of this.entries) {
        if (key.startsWith(`${event.boardId}:`)) entry.rows.clear();
      }
    });
    this.unlistenRemovals = onRecordRemoved((removal) => this.dropRecord(removal));
  }

  /**
   * Drop a deleted record from every open document of its board and send the
   * deletion to their subscribers. The durable removal is already in the log
   * (appendRecordRemoval, in the deleting transaction); this is the live half.
   */
  private dropRecord(removal: RecordRemoval): void {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${removal.boardId}:`)) continue;
      entry.rows.clear();
      const update = removeRecordKeys(entry.doc, removal.recordId);
      if (!update) continue;
      entry.encoded = null;
      for (const fn of entry.subscribers) fn(update, "server");
    }
  }

  stats(): HubStats {
    return {
      entries: this.entries.size,
      hydrations: this.hydrations,
      rowLoads: this.rowLoads,
      snapshots: this.snapshots,
    };
  }

  /** Release timers and listeners. Safe to call twice. */
  close(): void {
    this.unlisten();
    this.unlistenRemovals();
    for (const entry of this.entries.values()) {
      if (entry.idle) clearTimeout(entry.idle);
    }
    this.entries.clear();
  }

  /** Hydrate the legacy board-wide doc or one validated incident-scoped doc. */
  async open(
    actor: Principal,
    boardId: string,
    incidentId: string | null = null,
  ): Promise<{ state: Uint8Array }> {
    const entry = await this.entry(actor, boardId, incidentId);
    // entry() cancels a pending eviction so the doc survives the call. A read
    // that never subscribes, such as a federation pull, must not leave the doc
    // pinned, so the grace period restarts here instead.
    const key = entryKey(boardId, incidentId);
    try {
      if (!incidentId) return { state: encodedState(entry) };
      // The projection is per reader: visibleFields() narrows by role, so the
      // cache is keyed by the fields this actor may see.
      const signature = visibleFields(entry.board).map((field) => field.key).sort().join(",");
      let rows = entry.rows.get(signature);
      if (!rows) {
        this.rowLoads += 1;
        rows = await withPerson(this.sql, actor.person.id, (tx) =>
          loadBoardRows(tx, boardId, incidentId, entry.board));
        entry.rows.set(signature, rows);
      }
      const projected = new Y.Doc();
      Y.applyUpdate(projected, encodedState(entry));
      applyBoardRows(projected, rows);
      return { state: Y.encodeStateAsUpdate(projected) };
    } finally {
      this.scheduleEvict(key, entry);
    }
  }

  subscribe(
    boardId: string,
    incidentId: string | null,
    fn: (update: Uint8Array, originSession: string) => void,
  ): () => void {
    const key = entryKey(boardId, incidentId);
    const entry = this.entries.get(key);
    if (!entry) throw new Error("board not open");
    entry.subscribers.add(fn);
    if (entry.idle) {
      clearTimeout(entry.idle);
      entry.idle = null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.subscribers.delete(fn);
      this.scheduleEvict(key, entry);
    };
  }

  /**
   * Drop an idle entry after a grace period. Re-subscribing cancels it, and an
   * apply in flight defers it, so a doc is never pulled out from under work.
   */
  private scheduleEvict(key: string, entry: HubEntry): void {
    if (entry.subscribers.size > 0 || entry.active > 0) return;
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      entry.idle = null;
      if (entry.subscribers.size > 0 || entry.active > 0) return;
      if (this.entries.get(key) !== entry) return;
      entry.doc.destroy();
      entry.rows.clear();
      entry.encoded = null;
      this.entries.delete(key);
    }, this.idleEvictMs);
    entry.idle.unref?.();
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
    const key = entryKey(boardId, incidentId);
    entry.active += 1;
    try {
      return await this.applyLocked(actor, boardId, incidentId, entry, update, originSession, context);
    } finally {
      entry.active -= 1;
      this.scheduleEvict(key, entry);
    }
  }

  private async applyLocked(
    actor: Principal,
    boardId: string,
    incidentId: string | null,
    entry: HubEntry,
    update: Uint8Array,
    originSession: string,
    context: ExactSyncContext | null,
  ): Promise<ApplyResult> {
    const digest = context ? syncDigest(actor.person.id, boardId, context, update) : null;
    let outcome: {
      board: EffectiveBoard;
      doc: Y.Doc | null;
      hydrated: HydratedDoc | null;
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
              hydrated: null,
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

        const hydrated = await hydrateBoardDoc(tx, boardId, incidentId, board);
        const doc = hydrated.doc;
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
        // A jurisdiction-wide update to a shared board queues for every peer
        // that may read it, in this transaction, never back to the peer it came
        // from. Incident-scoped docs are not federated.
        if (!incidentId) {
          const fromPeer = originSession.startsWith(FEDERATION_ORIGIN)
            ? originSession.slice(FEDERATION_ORIGIN.length)
            : null;
          await tx`select queue_federation(${boardId}::uuid, ${Buffer.from(update)}, ${fromPeer}::uuid)`;
        }
        // Notifications queue in this transaction; the outbox worker sends them.
        for (const c of checkpoint.committed) {
          await notifyBoardEvent(tx, actor, boardEventFor(board, c, before, after));
        }
        return {
          board,
          doc,
          hydrated: {
            doc,
            throughSeq: Number(row!.seq),
            sinceSnapshot: hydrated.sinceSnapshot + 1,
          },
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
    const previous = entry.doc;
    entry.board = outcome.board;
    entry.doc = outcome.doc!;
    entry.templateVersion = outcome.board.template.version;
    entry.throughSeq = outcome.hydrated!.throughSeq;
    entry.sinceSnapshot = outcome.hydrated!.sinceSnapshot;
    // The doc and every projection taken from it are now stale.
    entry.encoded = null;
    entry.rows.clear();
    if (previous !== entry.doc) previous.destroy();
    if (entry.sinceSnapshot >= this.snapshotThreshold) {
      await this.writeSnapshot(actor, boardId, incidentId, entry);
    }
    for (const fn of entry.subscribers) fn(update, originSession);
    for (const c of outcome.committed) {
      publishBoardEvent(boardEventFor(outcome.board, c, outcome.before, outcome.after));
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
        const conflict = async (reason: string) => {
          conflicts += 1;
          await tx`
            insert into sync_conflicts
              (board_id, incident_id, record_id, reason, rejected_data, origin_person)
            values (${board.id}, ${incidentId}, ${recordId}, ${reason},
                    ${tx.json(data as never)}, ${actor.person.id})`;
          await recordAudit(tx, actor, {
            jurisdictionId: board.jurisdictionId,
            category: "sync.conflict",
            subjectTable: "board_records",
            subjectId: recordId,
            payload: { reason },
            ...(incidentId ? { incidentId } : {}),
          });
        };
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          if (relaxed.safeParse(data).success) continue; // pending, not conflict
          await conflict(parsed.error.issues[0]?.message ?? "schema violation");
          continue;
        }
        if (incidentId) {
          await validateRecordReferences(tx, actor, board, parsed.data, incidentId);
        }
        // A write to a deleted record, or one the record's edit rule refuses
        // (the update then touches no row), is a visible conflict, never a
        // silent loss or a resurrection.
        if (!existing) {
          const [gone] = await tx`select board_record_tombstoned(${recordId}, ${board.id}) as deleted`;
          if (gone!.deleted) {
            await conflict("record was deleted");
            continue;
          }
        }
        const written = existing
          ? await tx`
              update board_records
              set data = ${tx.json(parsed.data as never)}, updated_by = ${actor.person.id},
                  updated_at = now(), geom = ${geomExpr(tx, board.fields, parsed.data)}
              where id = ${recordId} and board_id = ${board.id}
                and (${incidentId}::uuid is null or incident_id = ${incidentId})`
          : await tx`
              insert into board_records
                (id, board_id, incident_id, data, created_by, created_by_position, geom)
              values (${recordId}, ${board.id}, ${incidentId}, ${tx.json(parsed.data as never)},
                      ${actor.person.id}, ${actor.position?.id ?? null},
                      ${geomExpr(tx, board.fields, parsed.data)})`;
        if (written.count === 0) {
          await conflict("not permitted to edit this record");
          continue;
        }
        // Values before and after go into the audit entry, so the record's
        // history shows what a sync write changed.
        const prior = existing ? existing.data as Record<string, unknown> : {};
        const changed = changedFieldKeys(prior, parsed.data);
        await recordAudit(tx, actor, {
          jurisdictionId: board.jurisdictionId,
          category: existing ? "board.record.updated" : "board.record.created",
          subjectTable: "board_records",
          subjectId: recordId,
          payload: existing
            ? { board: board.template.key, via: "sync",
                patch: Object.fromEntries(changed.map((key) => [key, parsed.data[key] ?? null])),
                previous: Object.fromEntries(changed.map((key) => [key, prior[key] ?? null])) }
            : { board: board.template.key, via: "sync", data: parsed.data },
          ...(incidentId ? { incidentId } : {}),
        });
        committed.push({ recordId, existing: Boolean(existing) });
    }
    return { conflicts, committed };
  }

  /**
   * Replace this scope's snapshot with the current merged state. The log is
   * untouched; only the starting point for the next hydration moves.
   */
  private async writeSnapshot(
    actor: Principal,
    boardId: string,
    incidentId: string | null,
    entry: HubEntry,
  ): Promise<void> {
    const state = Buffer.from(Y.encodeStateAsUpdate(entry.doc));
    const throughSeq = entry.throughSeq;
    try {
      await withPerson(this.sql, actor.person.id, async (tx) => {
        await tx`
          insert into sync_snapshots (board_id, incident_id, through_seq, state)
          values (${boardId}, ${incidentId}, ${throughSeq}, ${state})
          on conflict (board_id, coalesce(incident_id, ${NIL_UUID}::uuid))
          do update set through_seq = excluded.through_seq, state = excluded.state,
                        updated_at = now()
          where sync_snapshots.through_seq < excluded.through_seq`;
      });
      entry.sinceSnapshot = 0;
      this.snapshots += 1;
    } catch {
      // A snapshot is a cache. Failing to write one must never fail the update
      // that triggered it; the next apply simply tries again.
    }
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
      // A document holds every record of its scope, so a board with
      // record-level rules is served only to callers who read every record.
      if (!readsEveryRecord(actor, board, incidentId !== null))
        throw new AuthError(403, "records on this board are restricted; use its views");
      const cached = this.entries.get(key);
      // A template upgrade changes the fields the doc was built from, so the
      // cached doc and every projection taken from it are rebuilt, not reused.
      if (cached && cached.templateVersion === board.template.version) {
        return { board, hydrated: null as HydratedDoc | null, cached };
      }
      this.hydrations += 1;
      const hydrated = await hydrateBoardDoc(tx, boardId, incidentId, board);
      return { board, hydrated, cached: cached ?? null };
    });
    // Concurrent first opens each hydrate. The first to finish installs its
    // entry and the rest adopt it; replacing it would orphan the subscribers
    // already on it, and they would never hear another update.
    const current = this.entries.get(key);
    const reuse = current?.templateVersion === loaded.board.template.version
      ? current
      : loaded.hydrated ? null : loaded.cached;
    if (reuse) {
      loaded.hydrated?.doc.destroy();
      reuse.board = loaded.board;
      if (reuse.idle) {
        clearTimeout(reuse.idle);
        reuse.idle = null;
      }
      return reuse;
    }
    const hydrated = loaded.hydrated!;
    if (current) {
      current.doc.destroy();
      if (current.idle) clearTimeout(current.idle);
    }
    const entry: HubEntry = {
      doc: hydrated.doc,
      board: loaded.board,
      subscribers: current?.subscribers ?? new Set(),
      encoded: null,
      rows: new Map(),
      templateVersion: loaded.board.template.version,
      throughSeq: hydrated.throughSeq,
      sinceSnapshot: hydrated.sinceSnapshot,
      active: current?.active ?? 0,
      idle: null,
    };
    this.entries.set(key, entry);
    return entry;
  }
}

interface HydratedDoc {
  readonly doc: Y.Doc;
  readonly throughSeq: number;
  readonly sinceSnapshot: number;
}

/** Encoded state of an entry's doc, computed once per change. */
function encodedState(entry: HubEntry): Uint8Array {
  entry.encoded ??= Y.encodeStateAsUpdate(entry.doc);
  return entry.encoded;
}

/**
 * Rebuild a scope's doc: start from its snapshot if one exists, then replay
 * only the log rows after it. Without a snapshot this is the original full
 * replay, so a board that has never been compacted behaves exactly as before.
 */
async function hydrateBoardDoc(
  sql: Sql,
  boardId: string,
  incidentId: string | null,
  board: EffectiveBoard,
): Promise<HydratedDoc> {
  const doc = new Y.Doc();
  const [snapshot] = await sql`
    select through_seq, state from sync_snapshots
    where board_id = ${boardId}
      and coalesce(incident_id, ${NIL_UUID}::uuid) = coalesce(${incidentId}::uuid, ${NIL_UUID}::uuid)`;
  let throughSeq = 0;
  if (snapshot) {
    Y.applyUpdate(doc, new Uint8Array(snapshot.state as Buffer));
    throughSeq = Number(snapshot.through_seq);
  }
  const updates = await sql`
    select seq, update_data from sync_updates
    where board_id = ${boardId}
      and (${incidentId}::uuid is null or incident_id = ${incidentId})
      and seq > ${throughSeq}
    order by seq`;
  for (const update of updates) {
    Y.applyUpdate(doc, new Uint8Array(update.update_data as Buffer));
    throughSeq = Number(update.seq);
  }
  if (!incidentId) {
    applyBoardRows(doc, await loadBoardRows(sql, boardId, null, board));
  }
  return { doc, throughSeq, sinceSnapshot: updates.length };
}

/** Seed rows the sync log has not seen, without disturbing ones it has. */
function applyBoardRows(doc: Y.Doc, rows: Map<string, Record<string, unknown>>): void {
  const records = doc.getMap<unknown>("records");
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

/** Delete every key of one record from a document; the resulting update, or null if none. */
function removeRecordKeys(doc: Y.Doc, recordId: string): Uint8Array | null {
  const records = doc.getMap<unknown>("records");
  const keys = [...records.keys()].filter((key) => key.startsWith(`${recordId}/`));
  if (keys.length === 0) return null;
  const updates: Uint8Array[] = [];
  const capture = (update: Uint8Array) => { updates.push(update); };
  doc.on("update", capture);
  doc.transact(() => { for (const key of keys) records.delete(key); });
  doc.off("update", capture);
  return updates[0] ?? null;
}

/**
 * Remove a deleted record from the durable sync log, inside the deleting
 * transaction. The board-wide replay folds in every scope's updates and the
 * board-wide snapshot, so deleting the record's keys from it covers every
 * item any document holds; the update is appended under the record's own
 * scope, which both that scope's replay and the board-wide replay apply.
 */
export async function appendRecordRemoval(tx: Sql, boardId: string, recordId: string): Promise<void> {
  const doc = new Y.Doc();
  try {
    const [snapshot] = await tx`
      select state from sync_snapshots where board_id = ${boardId} and incident_id is null`;
    if (snapshot) Y.applyUpdate(doc, new Uint8Array(snapshot.state as Buffer));
    const updates = await tx`
      select update_data from sync_updates where board_id = ${boardId} order by seq`;
    for (const row of updates) Y.applyUpdate(doc, new Uint8Array(row.update_data as Buffer));
    const removal = removeRecordKeys(doc, recordId);
    if (removal) await tx`select append_board_record_removal(${recordId}, ${Buffer.from(removal)})`;
  } finally {
    doc.destroy();
  }
}

function boardEventFor(
  board: EffectiveBoard,
  c: { recordId: string; existing: boolean },
  before: Map<string, Record<string, unknown>>,
  after: Map<string, Record<string, unknown>>,
): BoardEvent {
  return {
    jurisdictionId: board.jurisdictionId,
    boardId: board.id,
    boardKey: board.template.key,
    recordId: c.recordId,
    event: c.existing ? "record.updated" : "record.created",
    record: after.get(c.recordId)!,
    previous: before.get(c.recordId),
  };
}
