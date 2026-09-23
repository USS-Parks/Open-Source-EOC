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
 * Append a REST write to its board's sync log. Each field is set as a fresh
 * root entry from a client id of its own, so the update needs none of the
 * log's history: it applies as it is to every open document, a later replay
 * and a federation peer, and it follows every edit made without seeing it.
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
  await append(tx, boardId, recordId, incidentId, scoped);
  await append(tx, boardId, recordId, null, boardWide);
}

async function append(
  tx: Sql,
  boardId: string,
  recordId: string,
  incidentId: string | null,
  fields: ReadonlyArray<readonly [string, unknown]>,
): Promise<void> {
  if (fields.length === 0) return;
  const doc = new Y.Doc();
  doc.clientID = serverClientId();
  const records = doc.getMap<unknown>("records");
  doc.transact(() => {
    for (const [key, value] of fields) records.set(`${recordId}/${key}`, value);
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await tx`select append_board_record_write(${recordId}, ${Buffer.from(update)}, ${incidentId === null})`;
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
