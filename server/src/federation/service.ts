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
import type { BoardSyncHub } from "../sync/hub.js";

/**
 * Instance federation, store-and-forward (F3). Peers are mutually
 * authenticated; sharing agreements scope which boards a peer may read or
 * write. Local edits are queued in an outbox that survives a partition;
 * the delivery worker pushes it to every linked peer, and when a link
 * returns after a partition the stranded batch goes then. The peer applies it
 * through the offline reconciliation path, so both sides converge with no
 * synchronous dual-commit and every jurisdiction keeps its own data.
 */

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
  const [peer] = await sql`select jurisdiction_id from peers where id = ${peerId}`;
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
    returning id`;
  return { id: row!.id as string };
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
  readonly updateBase64: string;
}

/** Undelivered updates for a peer (what a partition has stranded). */
export async function pending(sql: Sql, actor: Principal, peerId: string): Promise<OutboxEntry[]> {
  const [peer] = await sql`select jurisdiction_id from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireMember(actor, peer.jurisdiction_id as string);
  const rows = await sql`
    select id, board_id, update_data from federation_outbox
    where peer_id = ${peerId} and delivered_at is null order by created_at`;
  return rows.map((r) => ({
    id: r.id as string,
    boardId: r.board_id as string,
    updateBase64: Buffer.from(r.update_data as Buffer).toString("base64"),
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
  readonly boards: SharedBoardStatus[];
}

export interface ReceivedBatch {
  readonly at: string;
  readonly peer: string;
  readonly boardId: string;
  readonly boardTitle: string | null;
  readonly updates: number;
  readonly conflicts: number;
}

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

/**
 * The administrator's view of federation: every peer with its link state,
 * the boards it shares with the outbox standing per board, and the latest
 * batches received from peers.
 */
export async function federationStatus(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ peers: PeerStatus[]; received: ReceivedBatch[] }> {
  requireAdmin(actor, jurisdictionId);
  const peers = await sql`
    select id, name, created_at, endpoint_url, outbound_token is not null as token_stored
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
    peers: peers.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      createdAt: iso(p.created_at)!,
      endpointUrl: (p.endpoint_url as string | null) ?? null,
      tokenStored: p.token_stored as boolean,
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
      const payload = r.payload as { peer?: string; updates?: number; conflicts?: number };
      return {
        at: iso(r.created_at)!,
        peer: payload.peer ?? "",
        boardId: r.subject_id as string,
        boardTitle: (r.title as string | null) ?? null,
        updates: Number(payload.updates ?? 0),
        conflicts: Number(payload.conflicts ?? 0),
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
 * Receive a batch of forwarded updates from an authenticated peer and
 * apply them to a local board the agreement lets that peer write. Each
 * update merges through the sync hub (reconciliation + checkpoint), and
 * the convergence is attributed to the peer in the audit trail.
 */
export async function receiveUpdates(
  sql: Sql,
  hub: BoardSyncHub,
  peerToken: string,
  targetBoardId: string,
  updatesBase64: readonly string[],
): Promise<{ applied: number; conflicts: number }> {
  const [peer] = await sql`
    select id, jurisdiction_id, name, created_by from peers where token_hash = ${hashToken(peerToken)}`;
  if (!peer) throw new AuthError(401, "unknown peer");
  const [agreement] = await sql`
    select can_write from sharing_agreements
    where peer_id = ${peer.id as string} and board_id = ${targetBoardId}`;
  if (!agreement) throw new AuthError(403, "no sharing agreement for that board");
  if (!(agreement.can_write as boolean))
    throw new AuthError(403, "agreement does not permit writes to that board");

  // Apply under a local admin's authority (the peer's registrar), so RLS
  // and checkpoint attribution stay within the receiving jurisdiction.
  const localAdmin = await principalForPerson(sql, peer.created_by as string);
  let conflicts = 0;
  for (const u of updatesBase64) {
    const result = await hub.apply(
      localAdmin,
      targetBoardId,
      new Uint8Array(Buffer.from(u, "base64")),
      `federation:${peer.id as string}`,
    );
    conflicts += result.conflicts;
  }
  await withPerson(sql, localAdmin.person.id, (tx) =>
    recordAudit(tx, localAdmin, {
      jurisdictionId: peer.jurisdiction_id as string,
      category: "federation.received",
      subjectTable: "boards",
      subjectId: targetBoardId,
      payload: { peer: peer.name as string, updates: updatesBase64.length, conflicts },
    }),
  );
  return { applied: updatesBase64.length, conflicts };
}
