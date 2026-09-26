import type { Sql } from "../db/client.js";
import {
  AuthError,
  principalForPerson,
  requireAdmin,
  requireMember,
  type Principal,
} from "../auth/service.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { recordAudit } from "../audit/service.js";
import { encryptSecret, hasSecretKey } from "../secrets/envelope.js";
import {
  batchDigest,
  batchVerifies,
  instancePublicKey,
  parsePeerKey,
  pemFingerprint,
  receiptVerifies,
  signBatch,
  signReceipt,
  type SignedBatch,
} from "./identity.js";
import { FEDERATION_ORIGIN, appendRecordRemoval, type BoardSyncHub } from "../sync/hub.js";
import { recordsUpdate } from "../boards/record-sync.js";
import { publishRecordRemoved } from "../boards/removals.js";
import { lockBoardMutation } from "../boards/service.js";

/**
 * Instance federation, store-and-forward (F3). Peers are mutually
 * authenticated; sharing agreements scope which boards a peer may read or
 * write. Live sync edits to a shared board are queued, by the sync hub, in an
 * outbox that survives a partition; the delivery worker pushes it to every
 * linked peer, and when a link
 * returns after a partition the stranded batch goes then. The peer applies it
 * through the offline reconciliation path, so both sides converge with no
 * synchronous dual-commit and every jurisdiction keeps its own data.
 *
 * Deletions travel as their own entries, the deleted record's id, because a
 * Yjs deletion removes only what its sender had seen. A deletion wins: the
 * receiver deletes the record whatever edits it holds, and an edit that
 * reaches a deleted record is recorded as a conflict on the side that
 * deleted it. Records of an incident stay on their home instance: an
 * agreement is per board, and a peer could not keep them to the incident.
 *
 * A push carries at most FEDERATION_BATCH_BYTES of JSON, so a backlog after
 * a long partition, or a large board's first copy, goes as several pushes in
 * queue order rather than one a receiver refuses.
 *
 * Every batch is signed with the sending instance's Ed25519 key and verified
 * under the key recorded for that peer before anything in it is applied
 * (AG-03, ADR-0006). Revoking an agreement stops its board's flow both ways:
 * nothing more is queued or sent to the peer, and nothing the peer sends for
 * that board is accepted.
 */

/**
 * The size a push aims for, in bytes of JSON on the wire. It stays under the
 * 1 MiB request limit an instance before this one enforces, so instances on
 * different releases keep exchanging while an upgrade is under way.
 */
export const FEDERATION_BATCH_BYTES = 768 * 1024;

/** The receive route's request limit: room for a batch and for one entry larger than the batch size. */
export const FEDERATION_BODY_LIMIT = 8 * 1024 * 1024;

/** A board's first copy is cut into updates of about this much record data, each well inside one push. */
const BACKFILL_PART_BYTES = 384 * 1024;

interface RecordCopy {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/** A record's size in an update, near enough: per field, its id-prefixed key, some framing and its value as JSON. */
function recordBytes(record: RecordCopy): number {
  let bytes = 0;
  for (const [key, value] of Object.entries(record.data)) {
    if (value !== undefined) bytes += record.id.length + key.length + 16 + Buffer.byteLength(JSON.stringify(value));
  }
  return bytes;
}

/** Records in order, cut into parts of about `maxBytes` each; a record larger than that is a part of its own. */
export function backfillParts<T extends RecordCopy>(records: readonly T[], maxBytes = BACKFILL_PART_BYTES): T[][] {
  const parts: T[][] = [];
  let part: T[] = [];
  let bytes = 0;
  for (const record of records) {
    const size = recordBytes(record);
    if (part.length > 0 && bytes + size > maxBytes) {
      parts.push(part);
      part = [];
      bytes = 0;
    }
    part.push(record);
    bytes += size;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

export async function registerPeer(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  name: string,
): Promise<{ id: string; token: string }> {
  requireAdmin(actor, jurisdictionId);
  const token = newToken();
  const [row] = await sql`
    insert into peers (jurisdiction_id, name, token_hash, created_by)
    values (${jurisdictionId}, ${name}, ${token.hash}, ${actor.person.id})
    returning id`;
  return { id: row!.id as string, token: token.token };
}

export async function createAgreement(
  sql: Sql,
  actor: Principal,
  peerId: string,
  boardId: string,
  perms: { canRead?: boolean; canWrite?: boolean; remoteBoardId?: string } = {},
): Promise<{ id: string }> {
  const [peer] = await sql`select jurisdiction_id, name from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireAdmin(actor, peer.jurisdiction_id as string);
  const [board] = await sql`select jurisdiction_id from boards where id = ${boardId}`;
  if (!board) throw new AuthError(404, "board not found");
  if ((board.jurisdiction_id as string) !== (peer.jurisdiction_id as string))
    throw new AuthError(403, "board is not in this jurisdiction");
  const [row] = await sql`
    insert into sharing_agreements
      (peer_id, board_id, can_read, can_write, remote_board_id, created_by)
    values (${peerId}, ${boardId}, ${perms.canRead ?? true}, ${perms.canWrite ?? false},
            ${perms.remoteBoardId ?? null}, ${actor.person.id})
    returning id`.catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new AuthError(409, "this board is already shared with that peer");
    throw error;
  });
  // The board's records as they stand go to the new peer first, so records
  // made before the agreement are shared as well as those after it. Each
  // part is an update of its own records, whole, so the parts apply in any
  // order.
  if (perms.canRead ?? true) {
    const records = await sql`
      select id, data from board_records where board_id = ${boardId} and incident_id is null order by created_at, id`;
    const parts = backfillParts(records.map((r) => ({ id: r.id as string, data: r.data as Record<string, unknown> })));
    for (const part of parts) {
      const update = recordsUpdate(part)!;
      await sql`select queue_federation_to(${peerId}::uuid, ${boardId}::uuid, ${Buffer.from(update)})`;
    }
    if (parts.length > 0) {
      await recordAudit(sql, actor, {
        jurisdictionId: peer.jurisdiction_id as string,
        category: "federation.backfilled",
        subjectTable: "boards",
        subjectId: boardId,
        payload: { peer: peer.name as string, records: records.length, parts: parts.length },
      });
    }
  }
  return { id: row!.id as string };
}

/** Queue a deleted record for the board's peers, never back to the one it came from. */
export async function queueRecordDeletion(tx: Sql, boardId: string, recordId: string, excludePeer: string | null): Promise<void> {
  await tx`select queue_federation_delete(${boardId}::uuid, ${recordId}::uuid, ${excludePeer}::uuid)`;
}

/**
 * Delete a record a peer deleted: its jurisdiction-wide copy here, if there
 * is one. The deletion is audited with the peer's name and passed on to the
 * board's other peers. False when there was nothing to delete.
 */
async function deleteFederatedRecord(
  tx: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  peer: { id: string; name: string },
): Promise<boolean> {
  await lockBoardMutation(tx, boardId);
  const [row] = await tx`
    select r.data, b.jurisdiction_id, b.template_key from board_records r join boards b on b.id = r.board_id
    where r.id = ${recordId} and r.board_id = ${boardId} and r.incident_id is null`;
  if (!row) return false;
  const [done] = await tx`select public.tombstone_board_record(${recordId}) as ok`;
  if (!done?.ok) return false;
  await recordAudit(tx, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    category: "board.record.deleted",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { board: row.template_key as string, previous: row.data, via: "federation", peer: peer.name },
  });
  await appendRecordRemoval(tx, boardId, recordId);
  await queueRecordDeletion(tx, boardId, recordId, peer.id);
  return true;
}

/**
 * Queue a board's update for every peer allowed to read that board. The
 * outbox is the store-and-forward buffer: it holds through a partition.
 */
export async function queueOutbound(
  sql: Sql,
  actor: Principal,
  boardId: string,
  updateBase64: string,
): Promise<{ queued: number }> {
  const agreements = await sql`
    select a.peer_id from sharing_agreements a
    join peers p on p.id = a.peer_id
    where a.board_id = ${boardId} and a.can_read and is_member_of(p.jurisdiction_id)`;
  const bytes = Buffer.from(updateBase64, "base64");
  for (const a of agreements) {
    await sql`
      insert into federation_outbox (peer_id, board_id, update_data)
      values (${a.peer_id as string}, ${boardId}, ${bytes})`;
  }
  void actor;
  return { queued: agreements.length };
}

export interface OutboxEntry {
  readonly id: string;
  readonly boardId: string;
  /** An update, or null for a deletion. */
  readonly updateBase64: string | null;
  /** The deleted record, for a deletion. */
  readonly deletedRecordId: string | null;
}

/** Undelivered updates for a peer (what a partition has stranded). */
export async function pending(sql: Sql, actor: Principal, peerId: string): Promise<OutboxEntry[]> {
  const [peer] = await sql`select jurisdiction_id from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireMember(actor, peer.jurisdiction_id as string);
  const rows = await sql`
    select id, board_id, update_data, deleted_record from federation_outbox
    where peer_id = ${peerId} and delivered_at is null order by created_at`;
  return rows.map((r) => ({
    id: r.id as string,
    boardId: r.board_id as string,
    updateBase64: r.update_data ? Buffer.from(r.update_data as Buffer).toString("base64") : null,
    deletedRecordId: (r.deleted_record as string | null) ?? null,
  }));
}

export interface SharedBoardStatus {
  readonly id: string;
  readonly boardId: string;
  readonly boardTitle: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly remoteBoardId: string | null;
  readonly pending: number;
  readonly oldestPendingAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly lastDeliveredAt: string | null;
}

export interface PeerStatus {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly endpointUrl: string | null;
  /** Whether a push token is stored; the token itself is never returned. */
  readonly tokenStored: boolean;
  /** The fingerprint of the partner's recorded public key; null until one is recorded, and its batches are refused. */
  readonly keyFingerprint: string | null;
  readonly boards: SharedBoardStatus[];
}

/** This instance's public key, for partners to record; null while the server has no secret key. */
export interface InstanceIdentity {
  readonly publicKey: string;
  readonly fingerprint: string;
}

export interface ReceivedBatch {
  readonly at: string;
  readonly peer: string;
  readonly boardId: string;
  readonly boardTitle: string | null;
  readonly updates: number;
  readonly deletes: number;
  readonly conflicts: number;
  /** Imported from a batch file rather than pushed. */
  readonly byFile: boolean;
}

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

/**
 * The administrator's view of federation: this instance's public key, every
 * peer with its link state and recorded key, the boards it shares with the
 * outbox standing per board, and the latest batches received from peers.
 */
export async function federationStatus(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ identity: InstanceIdentity | null; peers: PeerStatus[]; received: ReceivedBatch[] }> {
  requireAdmin(actor, jurisdictionId);
  const identity = await instancePublicKey(sql);
  const peers = await sql`
    select id, name, created_at, endpoint_url, outbound_token is not null as token_stored, public_key
    from peers where jurisdiction_id = ${jurisdictionId} order by name, created_at`;
  const boards = await sql`
    select a.id, a.peer_id, a.board_id, b.title, a.can_read, a.can_write, a.remote_board_id,
           count(o.id) filter (where o.delivered_at is null)::integer as pending,
           min(o.created_at) filter (where o.delivered_at is null) as oldest,
           min(o.next_attempt_at) filter (where o.delivered_at is null) as next_attempt,
           (array_agg(o.last_error order by o.next_attempt_at desc)
              filter (where o.delivered_at is null and o.last_error is not null))[1] as last_error,
           max(o.delivered_at) as last_delivered
    from sharing_agreements a
    join peers p on p.id = a.peer_id
    join boards b on b.id = a.board_id
    left join federation_outbox o on o.peer_id = a.peer_id and o.board_id = a.board_id
    where p.jurisdiction_id = ${jurisdictionId}
    group by a.id, b.id
    order by b.title, a.created_at`;
  // ponytail: walks the jurisdiction's audit index backwards to the newest ten;
  // add a partial index on this category if audit trails grow into the millions.
  const received = await sql`
    select e.created_at, e.subject_id, e.payload, b.title
    from audit_events e left join boards b on b.id = e.subject_id
    where e.jurisdiction_id = ${jurisdictionId} and e.category = 'federation.received'
    order by e.seq desc limit 10`;
  return {
    identity,
    peers: peers.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      createdAt: iso(p.created_at)!,
      endpointUrl: (p.endpoint_url as string | null) ?? null,
      tokenStored: p.token_stored as boolean,
      keyFingerprint: p.public_key ? pemFingerprint(p.public_key as string) : null,
      boards: boards
        .filter((b) => b.peer_id === p.id)
        .map((b) => ({
          id: b.id as string,
          boardId: b.board_id as string,
          boardTitle: b.title as string,
          canRead: b.can_read as boolean,
          canWrite: b.can_write as boolean,
          remoteBoardId: (b.remote_board_id as string | null) ?? null,
          pending: b.pending as number,
          oldestPendingAt: iso(b.oldest),
          nextAttemptAt: iso(b.next_attempt),
          lastError: (b.last_error as string | null) ?? null,
          lastDeliveredAt: iso(b.last_delivered),
        })),
    })),
    received: received.map((r) => {
      const payload = r.payload as { peer?: string; updates?: number; deletes?: number; conflicts?: number; via?: string };
      return {
        at: iso(r.created_at)!,
        peer: payload.peer ?? "",
        boardId: r.subject_id as string,
        boardTitle: (r.title as string | null) ?? null,
        updates: Number(payload.updates ?? 0),
        deletes: Number(payload.deletes ?? 0),
        conflicts: Number(payload.conflicts ?? 0),
        byFile: payload.via === "file",
      };
    }),
  };
}

/** Mark outbox entries delivered. Called by the delivery worker after a peer accepts a batch. */
export async function markDelivered(sql: Sql, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`select mark_federation_delivered(${ids as string[]}::uuid[])`;
}

/**
 * Link a peer for push delivery: the base URL of the remote instance and the
 * token that instance issued when it registered this one. The token is stored
 * envelope-encrypted and never returned.
 */
export async function setPeerLink(
  sql: Sql,
  actor: Principal,
  peerId: string,
  endpointUrl: string,
  token: string,
): Promise<void> {
  const [peer] = await sql`select jurisdiction_id from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireAdmin(actor, peer.jurisdiction_id as string);
  if (!hasSecretKey()) {
    throw new AuthError(409, "server not provisioned for secret storage (OPENEOC_SECRET_KEY unset)");
  }
  await sql`
    update peers set endpoint_url = ${endpointUrl}, outbound_token = ${encryptSecret(token)}
    where id = ${peerId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: peer.jurisdiction_id as string,
    category: "federation.peer_linked",
    subjectTable: "peers",
    subjectId: peerId,
    payload: { endpointUrl },
  });
}

/**
 * Record a partner's public key, which its administrator read from the
 * partner's own Federation screen. Batches from the partner are applied only
 * when they verify under it; setting it again replaces it, and batches signed
 * with the old key are refused from then on.
 */
export async function setPeerKey(
  sql: Sql,
  actor: Principal,
  peerId: string,
  publicKeyPem: string,
): Promise<{ fingerprint: string }> {
  const [peer] = await sql`select jurisdiction_id, name from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireAdmin(actor, peer.jurisdiction_id as string);
  const key = parsePeerKey(publicKeyPem);
  await sql`update peers set public_key = ${key.pem} where id = ${peerId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: peer.jurisdiction_id as string,
    category: "federation.peer_key_set",
    subjectTable: "peers",
    subjectId: peerId,
    payload: { peer: peer.name as string, fingerprint: key.fingerprint },
  });
  return { fingerprint: key.fingerprint };
}

/**
 * Revoke a sharing agreement. The agreement goes, and with it every entry
 * still waiting for the peer on that board, so the flow stops both ways at
 * once: nothing more is queued or pushed to the peer for the board, and the
 * receive lane refuses the peer's batches for it. The revocation is audited
 * on the board. Sharing the board again makes a new agreement, which sends
 * the board as it stands.
 */
export async function revokeAgreement(
  sql: Sql,
  actor: Principal,
  peerId: string,
  agreementId: string,
): Promise<{ dropped: number }> {
  const [agreement] = await sql`
    select a.board_id, a.can_read, a.can_write, p.jurisdiction_id, p.name
    from sharing_agreements a join peers p on p.id = a.peer_id
    where a.id = ${agreementId} and a.peer_id = ${peerId}`;
  if (!agreement) throw new AuthError(404, "agreement not found");
  requireAdmin(actor, agreement.jurisdiction_id as string);
  const boardId = agreement.board_id as string;
  // ponytail: an edit committing in the same instant can queue one entry this
  // does not see; with the agreement gone it is never claimed, and sharing
  // the board again sends the board whole anyway.
  const dropped = await sql`
    delete from federation_outbox where peer_id = ${peerId} and board_id = ${boardId} and delivered_at is null`;
  await sql`delete from sharing_agreements where id = ${agreementId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: agreement.jurisdiction_id as string,
    category: "federation.agreement_revoked",
    subjectTable: "boards",
    subjectId: boardId,
    payload: {
      peer: agreement.name as string,
      canRead: agreement.can_read as boolean,
      canWrite: agreement.can_write as boolean,
      dropped: dropped.count,
    },
  });
  return { dropped: dropped.count };
}

/** Whether a token is one this instance issued to a peer; the receive route asks before it reads a body. */
export async function isPeerToken(sql: Sql, peerToken: string): Promise<boolean> {
  const [peer] = await sql`select 1 from peers where token_hash = ${hashToken(peerToken)}`;
  return Boolean(peer);
}

/** A peer as the receive lane reads it. */
interface SendingPeer {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly publicKey: string | null;
}

/** A batch as it arrives, over the network or in a file. */
export interface IncomingBatch {
  readonly boardId: string;
  readonly updates: readonly string[];
  readonly deletes: readonly string[];
  readonly signature?: string | undefined;
}

function sendingPeer(row: Record<string, unknown>): SendingPeer {
  return {
    id: row.id as string,
    jurisdictionId: row.jurisdiction_id as string,
    name: row.name as string,
    publicKey: (row.public_key as string | null) ?? null,
  };
}

/**
 * The receive lane's checks, before anything in a batch is read or applied:
 * the peer has a recorded key, the batch is signed and verifies under it,
 * and an agreement lets the peer write the board. A batch that fails to
 * verify is refused with `unverified` (401 on the network lane).
 */
async function checkBatch(sql: Sql, peer: SendingPeer, batch: IncomingBatch, unverified = 401): Promise<void> {
  if (!peer.publicKey) throw new AuthError(403, "no public key is recorded for this peer; record its key before it delivers");
  if (!batch.signature) throw new AuthError(unverified, "the batch is not signed");
  if (!batchVerifies(peer.publicKey, batch.boardId, batch.updates, batch.deletes, batch.signature)) {
    throw new AuthError(unverified, "the batch signature does not verify under this peer's key");
  }
  const [agreement] = await sql`
    select can_write from sharing_agreements
    where peer_id = ${peer.id} and board_id = ${batch.boardId}`;
  if (!agreement) throw new AuthError(403, "no sharing agreement for that board");
  if (!(agreement.can_write as boolean))
    throw new AuthError(403, "agreement does not permit writes to that board");
}

/**
 * Apply a checked batch to its board as `actor`: each update merges through
 * the sync hub (reconciliation + checkpoint), then each deletion, and the
 * convergence is attributed to the peer in the audit trail.
 */
async function applyBatch(
  sql: Sql,
  hub: BoardSyncHub,
  actor: Principal,
  peer: SendingPeer,
  batch: IncomingBatch,
  via?: "file",
): Promise<{ applied: number; conflicts: number; deleted: number }> {
  let conflicts = 0;
  for (const u of batch.updates) {
    const result = await hub.apply(
      actor,
      batch.boardId,
      new Uint8Array(Buffer.from(u, "base64")),
      `${FEDERATION_ORIGIN}${peer.id}`,
    );
    conflicts += result.conflicts;
  }
  // Deletions after updates: a record deleted and edited in one batch is deleted.
  let deleted = 0;
  for (const recordId of batch.deletes) {
    const removed = await withPerson(sql, actor.person.id, (tx) =>
      deleteFederatedRecord(tx, actor, batch.boardId, recordId, peer));
    if (!removed) continue;
    deleted += 1;
    publishRecordRemoved({ boardId: batch.boardId, recordId, incidentId: null });
  }
  await withPerson(sql, actor.person.id, (tx) =>
    recordAudit(tx, actor, {
      jurisdictionId: peer.jurisdictionId,
      category: "federation.received",
      subjectTable: "boards",
      subjectId: batch.boardId,
      payload: { peer: peer.name, updates: batch.updates.length, deletes: deleted, conflicts, ...(via ? { via } : {}) },
    }),
  );
  return { applied: batch.updates.length, conflicts, deleted };
}

/**
 * Receive a signed batch of forwarded updates from an authenticated peer and
 * apply them to a local board the agreement lets that peer write. The
 * signature is checked against the peer's recorded key before anything else
 * is read from the batch.
 */
export async function receiveUpdates(
  sql: Sql,
  hub: BoardSyncHub,
  peerToken: string,
  targetBoardId: string,
  updatesBase64: readonly string[],
  deletes: readonly string[],
  signature: string | undefined,
): Promise<{ applied: number; conflicts: number; deleted: number }> {
  const [row] = await sql`
    select id, jurisdiction_id, name, created_by, public_key from peers where token_hash = ${hashToken(peerToken)}`;
  if (!row) throw new AuthError(401, "unknown peer");
  const peer = sendingPeer(row);
  const batch = { boardId: targetBoardId, updates: updatesBase64, deletes, signature };
  await checkBatch(sql, peer, batch);
  // Apply under a local admin's authority (the peer's registrar), so RLS
  // and checkpoint attribution stay within the receiving jurisdiction.
  const localAdmin = await principalForPerson(sql, row.created_by as string);
  return applyBatch(sql, hub, localAdmin, peer, batch);
}

// ---- Exchange by file (AG-04) ----
//
// Where no network path reaches a partner, an administrator exports what
// waits for it as a file of the same signed batches the delivery worker
// pushes, sized the same way. The partner's administrator imports the file
// through the receive lane, which checks every batch as it checks a push,
// and exports a receipt signed with the partner's key naming the batches, by
// digest, that it applied. Imported here, the receipt marks the entries of
// those batches delivered. The file carries the batches and nothing else: no
// token, address or key.

export const BATCH_FILE_FORMAT = "openeoc-federation-batches";
export const RECEIPT_FORMAT = "openeoc-federation-receipt";

/** The most batch data a file holds, so the import route takes it whole. */
export const FEDERATION_FILE_BYTES = 32 * 1024 * 1024;
/** The import route's request limit: a full file and one entry larger than the batch size. */
export const FEDERATION_FILE_LIMIT = FEDERATION_FILE_BYTES + FEDERATION_BODY_LIMIT;

/** The largest number of entries in one batch, as the delivery worker's claim. */
const BATCH_ENTRIES = 5000;

export interface BatchFile {
  readonly format: typeof BATCH_FILE_FORMAT;
  readonly version: 1;
  readonly batches: readonly SignedBatch[];
}

export interface Receipt {
  readonly format: typeof RECEIPT_FORMAT;
  readonly version: 1;
  /** The digests of the batches applied, as `batchDigest` computes them. */
  readonly batches: readonly string[];
  readonly signature: string;
}

async function peerForAdmin(sql: Sql, actor: Principal, peerId: string): Promise<SendingPeer> {
  const [row] = await sql`select id, jurisdiction_id, name, public_key from peers where id = ${peerId}`;
  if (!row) throw new AuthError(404, "peer not found");
  requireAdmin(actor, row.jurisdiction_id as string);
  return sendingPeer(row);
}

/**
 * Export what waits for a partner as a file of signed batches, in queue
 * order per receiving board, up to FEDERATION_FILE_BYTES. The entries stay
 * waiting, for the network or a later file, until a receipt marks them
 * delivered; each batch is recorded with its entries so that receipt can.
 * Entries on a board with no receiving board set stay out, as they do from a
 * push.
 */
export async function exportBatchFile(
  tx: Sql,
  actor: Principal,
  peerId: string,
): Promise<{ file: BatchFile; entries: number; remaining: number }> {
  const peer = await peerForAdmin(tx, actor, peerId);
  // Counted as the delivery worker's claim counts the JSON a push sends.
  const rows = await tx`
    with queued as (
      select o.id, o.created_at, o.update_data, o.deleted_record, a.remote_board_id,
             row_number() over queue as n,
             sum(case when o.update_data is null then 39
                      else 4 * ((octet_length(o.update_data) + 2) / 3) + 3 end) over queue as wire
      from federation_outbox o
      join sharing_agreements a on a.peer_id = o.peer_id and a.board_id = o.board_id
      where o.peer_id = ${peerId} and o.delivered_at is null and a.remote_board_id is not null
      window queue as (order by o.created_at, o.id rows between unbounded preceding and current row))
    select id, update_data, deleted_record, remote_board_id from queued
    where n = 1 or wire <= ${FEDERATION_FILE_BYTES}
    order by created_at, id`;
  if (rows.length === 0) {
    throw new AuthError(409, `nothing is waiting for ${peer.name} on a shared board with a receiving board set`);
  }
  const [waiting] = await tx`
    select count(*)::integer as n from federation_outbox where peer_id = ${peerId} and delivered_at is null`;

  interface Cut { boardId: string; ids: string[]; updates: string[]; deletes: string[]; bytes: number }
  const cuts: Cut[] = [];
  const open = new Map<string, Cut>();
  for (const row of rows) {
    const boardId = row.remote_board_id as string;
    const update = row.update_data ? Buffer.from(row.update_data as Buffer).toString("base64") : null;
    const size = update === null ? 39 : update.length + 3;
    let cut = open.get(boardId);
    if (!cut || (cut.ids.length > 0 && (cut.bytes + size > FEDERATION_BATCH_BYTES || cut.ids.length >= BATCH_ENTRIES))) {
      cut = { boardId, ids: [], updates: [], deletes: [], bytes: 0 };
      cuts.push(cut);
      open.set(boardId, cut);
    }
    cut.ids.push(row.id as string);
    cut.bytes += size;
    if (update === null) cut.deletes.push(row.deleted_record as string);
    else cut.updates.push(update);
  }

  const batches: SignedBatch[] = [];
  for (const cut of cuts) {
    batches.push(await signBatch(tx, cut.boardId, cut.updates, cut.deletes));
    await tx`
      insert into federation_file_exports (peer_id, digest, entry_ids)
      values (${peerId}, ${batchDigest(cut.boardId, cut.updates, cut.deletes)}, ${cut.ids}::uuid[])`;
  }
  await recordAudit(tx, actor, {
    jurisdictionId: peer.jurisdictionId,
    category: "federation.file_exported",
    subjectTable: "peers",
    subjectId: peerId,
    payload: { peer: peer.name, batches: batches.length, entries: rows.length },
  });
  return {
    file: { format: BATCH_FILE_FORMAT, version: 1, batches },
    entries: rows.length,
    remaining: (waiting!.n as number) - rows.length,
  };
}

/**
 * Import a partner's batch file through the receive lane. Every batch is
 * checked as the lane checks a push, under the key recorded for the partner
 * the administrator chose, before any is applied, so a file is taken whole or
 * not at all. A batch imported before is not applied again. The receipt,
 * signed with this instance's key, names every batch in the file, so
 * importing a file again yields its receipt again.
 */
export async function importBatchFile(
  sql: Sql,
  hub: BoardSyncHub,
  actor: Principal,
  peerId: string,
  batches: readonly IncomingBatch[],
): Promise<{ batches: number; alreadyImported: number; updates: number; deleted: number; conflicts: number; receipt: Receipt }> {
  const peer = await peerForAdmin(sql, actor, peerId);
  // A file has no channel to authenticate, so a batch that does not verify is
  // refused as unprocessable rather than unauthenticated.
  for (const batch of batches) await checkBatch(sql, peer, batch, 422);
  const digests = batches.map((b) => batchDigest(b.boardId, b.updates, b.deletes));
  const imported = new Set((await withPerson(sql, actor.person.id, (tx) => tx`
    select digest from federation_file_imports where peer_id = ${peerId} and digest = any(${digests}::text[])`))
    .map((r) => r.digest as string));
  let alreadyImported = 0, updates = 0, deleted = 0, conflicts = 0;
  for (const [i, batch] of batches.entries()) {
    const digest = digests[i]!;
    if (imported.has(digest)) {
      alreadyImported += 1;
      continue;
    }
    const result = await applyBatch(sql, hub, actor, peer, batch, "file");
    updates += result.applied;
    deleted += result.deleted;
    conflicts += result.conflicts;
    await withPerson(sql, actor.person.id, (tx) => tx`
      insert into federation_file_imports (peer_id, digest) values (${peerId}, ${digest}) on conflict do nothing`);
    imported.add(digest);
  }
  const named = [...new Set(digests)];
  return {
    batches: batches.length,
    alreadyImported,
    updates,
    deleted,
    conflicts,
    receipt: { format: RECEIPT_FORMAT, version: 1, batches: named, signature: await signReceipt(sql, named) },
  };
}

/**
 * Import a partner's receipt: it must verify under the partner's recorded
 * key and name only batches this instance put in a file for that partner;
 * otherwise nothing is marked. The entries of the named batches still
 * waiting are marked delivered.
 */
export async function importReceipt(
  tx: Sql,
  actor: Principal,
  peerId: string,
  receipt: { readonly batches: readonly string[]; readonly signature: string },
): Promise<{ batches: number; delivered: number; alreadyDelivered: number }> {
  const peer = await peerForAdmin(tx, actor, peerId);
  if (!peer.publicKey) throw new AuthError(403, "no public key is recorded for this peer; record its key before it delivers");
  if (!receiptVerifies(peer.publicKey, receipt.batches, receipt.signature)) {
    throw new AuthError(422, "the receipt signature does not verify under this peer's key");
  }
  const sent = await tx`
    select digest, entry_ids from federation_file_exports
    where peer_id = ${peerId} and digest = any(${receipt.batches as string[]}::text[])`;
  const known = new Set(sent.map((r) => r.digest as string));
  const unknown = receipt.batches.filter((digest) => !known.has(digest)).length;
  if (unknown > 0) {
    throw new AuthError(409, `the receipt names ${unknown === 1 ? "a batch" : `${unknown} batches`} this instance never sent to ${peer.name}`);
  }
  const ids = [...new Set(sent.flatMap((r) => r.entry_ids as string[]))];
  const marked = await tx`
    update federation_outbox set delivered_at = now()
    where peer_id = ${peerId} and id = any(${ids}::uuid[]) and delivered_at is null
    returning id`;
  await recordAudit(tx, actor, {
    jurisdictionId: peer.jurisdictionId,
    category: "federation.receipt_imported",
    subjectTable: "peers",
    subjectId: peerId,
    payload: { peer: peer.name, batches: receipt.batches.length, delivered: marked.length },
  });
  return { batches: receipt.batches.length, delivered: marked.length, alreadyDelivered: ids.length - marked.length };
}
