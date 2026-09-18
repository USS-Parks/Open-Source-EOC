import type { Sql } from "../db/client.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { recordAudit } from "../audit/service.js";
import type { BoardSyncHub } from "../sync/hub.js";

/**
 * Instance federation, store-and-forward (VEOC-30, F3). Peers are mutually
 * authenticated; sharing agreements scope which boards a peer may read or
 * write. Local edits are queued in an outbox that survives a partition;
 * when a link returns, the batch is delivered and the peer applies it
 * through the VEOC-13 reconciliation, so both sides converge with no
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
  perms: { canRead?: boolean; canWrite?: boolean } = {},
): Promise<{ id: string }> {
  const [peer] = await sql`select jurisdiction_id from peers where id = ${peerId}`;
  if (!peer) throw new AuthError(404, "peer not found");
  requireAdmin(actor, peer.jurisdiction_id as string);
  const [board] = await sql`select jurisdiction_id from boards where id = ${boardId}`;
  if (!board) throw new AuthError(404, "board not found");
  if ((board.jurisdiction_id as string) !== (peer.jurisdiction_id as string))
    throw new AuthError(403, "board is not in this jurisdiction");
  const [row] = await sql`
    insert into sharing_agreements (peer_id, board_id, can_read, can_write, created_by)
    values (${peerId}, ${boardId}, ${perms.canRead ?? true}, ${perms.canWrite ?? false},
            ${actor.person.id})
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

export async function markDelivered(sql: Sql, actor: Principal, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    update federation_outbox set delivered_at = now()
    where id in ${sql(ids as string[])} and delivered_at is null`;
  void actor;
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

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
