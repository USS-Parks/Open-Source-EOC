import { randomInt } from "node:crypto";
import * as Y from "yjs";
import type { Sql } from "../db/client.js";
import { afterCommit } from "../db/context.js";

/**
 * REST record writes in the board sync log. A record written over REST is
 * appended to its board's log as a Yjs update in the writing transaction and
 * announced in process once that commits; the sync hub listens, folds the
 * update into its open documents and sends it to their subscribers.
 */

export interface RecordWrite {
  readonly boardId: string;
  /** The record's incident scope, or null for a jurisdiction-wide record. */
  readonly incidentId: string | null;
  readonly update: Uint8Array;
}

type Listener = (write: RecordWrite) => void;

const listeners = new Set<Listener>();

export function onRecordWritten(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let lastClientId = 0;

/**
 * Client id for one server-authored update. Yjs orders concurrent root
 * entries for a key by client id and draws its own ids below 2^32, so these
 * sit above every sync client's and rise with the clock: whole seconds in the
 * high bits, a random draw below them, and never lower than the id this
 * process issued last. The range lasts until the year 2242.
 */
function serverClientId(): number {
  lastClientId = Math.max(lastClientId + 1, Math.floor(Date.now() / 1000) * 2 ** 20 + randomInt(2 ** 20));
  return lastClientId;
}

/**
 * The writer of an unfederated scope's REST writes, one per scope in this
 * process. Its updates continue its own clock, so a document gains one writer
 * per process rather than one per write: Yjs does work in proportion to a
 * document's writers on every update it applies, and a busy board's document
 * would otherwise slow every open copy of it, write by write. A scope's REST
 * writes are serialized by a transaction lock, so the log holds a writer's
 * updates in clock order. A write that rolled back takes its writer with it,
 * since later updates would wait on clocks the log never received; so does a
 * write not yet known to have committed, unless its row is in the log.
 */
interface Writer {
  readonly doc: Y.Doc;
  /** The log row of the writer's last update, once inserted. */
  lastSeq: number | null;
  /** Whether that update is known to have committed. */
  confirmed: boolean;
}

const writers = new Map<string, Writer>();

async function writerFor(tx: Sql, scope: string): Promise<Writer> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`sync-writer:${scope}`}, 0))`;
  let writer = writers.get(scope);
  if (writer && !writer.confirmed) {
    const [kept] = writer.lastSeq === null ? [] : await tx`
      select exists (select 1 from sync_updates where seq = ${writer.lastSeq}) as kept`;
    if (kept?.kept) writer.confirmed = true;
    else {
      writer.doc.destroy();
      writers.delete(scope);
      writer = undefined;
    }
  }
  if (!writer) {
    const doc = new Y.Doc();
    doc.clientID = serverClientId();
    writer = { doc, lastSeq: null, confirmed: true };
    writers.set(scope, writer);
  }
  return writer;
}

/**
 * Append a REST write to its board's sync log. A record of an incident is
 * written by its scope's continuing writer (above); its updates are never
 * federated, and every copy of its documents is built from the whole log. A
 * jurisdiction record's board-wide updates are federated, so each field is
 * set as a fresh root entry from a client id of its own: the update needs
 * none of the log's history and applies as it is to a peer. Either way it
 * follows every edit made without seeing it.
 *
 * A record of an incident goes under that incident, limited to
 * `incidentFields`, the fields its documents project. Any other field goes
 * under the board-wide scope alone, which is not federated for such a record,
 * so the board-wide document never keeps a stale value that its next sync
 * checkpoint would write back over the row.
 */
export async function appendRecordWrite(
  tx: Sql,
  boardId: string,
  recordId: string,
  incidentId: string | null,
  values: Readonly<Record<string, unknown>>,
  incidentFields: ReadonlySet<string>,
): Promise<void> {
  const fields = Object.entries(values).filter(([, value]) => value !== undefined);
  const scoped = incidentId ? fields.filter(([key]) => incidentFields.has(key)) : fields;
  const boardWide = incidentId ? fields.filter(([key]) => !incidentFields.has(key)) : [];
  await append(tx, boardId, recordId, incidentId, scoped, incidentId !== null);
  await append(tx, boardId, recordId, null, boardWide, incidentId !== null);
}

async function append(
  tx: Sql,
  boardId: string,
  recordId: string,
  incidentId: string | null,
  fields: ReadonlyArray<readonly [string, unknown]>,
  continuing: boolean,
): Promise<void> {
  if (fields.length === 0) return;
  const set = (doc: Y.Doc) => {
    const records = doc.getMap<unknown>("records");
    doc.transact(() => {
      for (const [key, value] of fields) records.set(`${recordId}/${key}`, value);
    });
  };
  let update: Uint8Array;
  let writer: Writer | null = null;
  if (continuing) {
    writer = await writerFor(tx, `${boardId}:${incidentId ?? "board"}`);
    // Unconfirmed from here until this write is known to have committed.
    writer.confirmed = false;
    writer.lastSeq = null;
    const parts: Uint8Array[] = [];
    const capture = (part: Uint8Array) => { parts.push(part); };
    writer.doc.on("update", capture);
    set(writer.doc);
    writer.doc.off("update", capture);
    update = parts.length === 1 ? parts[0]! : Y.mergeUpdates(parts);
  } else {
    const doc = new Y.Doc();
    doc.clientID = serverClientId();
    set(doc);
    update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
  }
  const [row] = await tx`select append_board_record_write(${recordId}, ${Buffer.from(update)}, ${incidentId === null}) as seq`;
  if (writer) {
    const confirmedWriter = writer;
    confirmedWriter.lastSeq = Number(row!.seq);
    afterCommit(tx, () => { confirmedWriter.confirmed = true; });
  }
  afterCommit(tx, () => {
    for (const fn of listeners) {
      try {
        fn({ boardId, incidentId, update });
      } catch {
        // Isolated, as on the board event bus.
      }
    }
  });
}
