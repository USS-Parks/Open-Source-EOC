# Federation Setup Guide

Federation lets two instances (a county and a state, say) share boards without
either depending on the other being online. Delivery is store-and-forward:
queued updates deliver when the link returns, and both sides converge.
[How updates flow](#how-updates-flow) says which edits queue.

## Register a peer

On each instance, an admin registers the other as a peer and receives a peer
token. The token authenticates that peer's inbound delivery lane. Treat it as a
secret; only its hash is stored.

## Share a board

Create a sharing agreement scoping which board a peer may read or write. An
agreement is per board, so you share exactly what you intend and nothing more.
Write access is opt-in: omit `canWrite` (or set it false) and the peer can
receive the board but cannot push updates. The board must belong to the same
jurisdiction as the peer record. Set `remoteBoardId` to the id of the board on
the peer that should receive this board's updates.

## Link a peer for push delivery

To have this instance push its outbox, an admin links the peer with
`PUT /api/v1/peers/:peerId/link`, giving the peer's base URL and the peer token
that the other instance issued when it registered this one. The token is
stored encrypted and is never shown again, so the server needs
`OPENEOC_SECRET_KEY` set. Without a link, entries stay in the outbox and can be
read with the pending route.

## The Federation screen

Jurisdiction administrators set all of this up from **Federation** under Data
and administration in the console. The entry is hidden from everyone else, and
the server refuses the status read to anyone who is not an administrator of
the jurisdiction.

1. **Register a partner.** Enter the partner's name and select **Register
   partner**. The partner's token appears once, with a **Copy token** button.
   Copy it and give it to the partner's administrator, who enters it as the
   push link token on their instance. Select **I have saved the token** to
   clear it; it cannot be shown again.
2. **Set push link.** Open **Set push link** on the partner's card and enter
   the partner's address and the token the partner issued to this instance.
   The token field is masked, the stored token is never displayed, and saving
   again replaces both the address and the token. The card then reads
   "Pushing to" the address.
3. **Share a board.** Open **Share a board**, pick one of this jurisdiction's
   boards not yet shared with the partner, choose whether the partner reads it
   or reads and writes it, and enter the receiving board ID: the id of the
   board on the partner that should receive the updates.
4. **Watch the outbox.** Each shared board shows how many updates are waiting,
   how long the oldest has waited, the next attempt, the last error and the
   last delivery. An update is held, and the card says why, until the partner
   is linked and the board has a receiving board. The badge on the partner
   reads "Up to date" when it is linked and nothing is waiting. Select **Refresh status** to
   read the outbox again.
5. **Received from partners.** The ten latest batches partners pushed to this
   instance, read from the audit trail: the board, the partner, the time, the
   number of updates and any conflicts reconciled.

The screen also states how resource escalation chooses its target: it keeps
no stored targets. Whoever escalates a request supplies the higher tier's
name, address and peer token with that escalation, so the partner links on
this screen are not used for it.

## How updates flow

- An update applied to a shared board's jurisdiction-wide sync document, over
  the live sync socket `/api/v1/sync/boards/:boardId` joined without an
  incident, queues in the outbox in the same transaction that records it: one
  entry per peer whose agreement lets it read the board. If the edit rolls
  back, nothing is queued.
- A record created or changed through the REST record routes (the console's
  board and map forms, board import, form submissions and the other server
  paths that add records) is written to the board's sync log as an update in
  the same transaction. Live sync sockets receive it without reconnecting,
  and a record with no incident queues for the board's readers exactly like
  a live sync edit.
- An update received from a peer is queued the same way for the board's other
  readers, but never back to the peer it came from, so two instances sharing
  a board do not echo updates to each other.
- Deleting a record with no incident is forwarded as its own outbox entry,
  the record's id, and the partner deletes its copy and records who asked in
  its audit trail ("board.record.deleted" with the peer's name). A deletion
  wins: the partner deletes the record whatever edits it holds, and an edit
  that reaches a deleted record is listed as a sync conflict ("record was
  deleted") on the instance that deleted it, never restoring the record. A
  deletion received from a peer is passed on to the board's other readers.
- Records that belong to an incident stay on their home instance: edits to an
  incident-scoped sync document (the continuity client joins with an
  incident), REST writes to such a record and its deletion are not
  federated, because an agreement covers a board and the partner could not
  keep the record to the incident's participants. The route
  `POST /api/v1/peers/:peerId/queue` still queues a sync update by hand for
  every peer that reads the board.
- Making an agreement sends the partner the board's records with no incident
  as they stand, so records made before the board was shared arrive whole.
  A large board goes as several outbox entries of about 384 KB of records
  each, every record whole in one of them. The organization's audit trail
  records it ("federation.backfilled" with the number of records and parts).
- When a console edit and a field edit to the same field cross, both
  instances settle on the same value: the console's REST write wins over any
  edit made without seeing it, and an edit made after it arrived wins over
  it. Two console edits to one field on different instances settle by the
  servers' clocks, to the second. The losing edit stays in the sync log but
  is not listed as a conflict.
- The server's delivery worker pushes each linked peer's batch to its receive
  lane over the peer token. While the peer is unreachable the entries stay
  queued and are retried with backoff; they never expire. The peer applies a
  batch through the same reconciliation the live sync uses, so there is no
  synchronous dual-commit and no lost data.
- A batch holds at most 768 KB of request body and 5,000 entries, so it fits
  under the 1 MB request limit of a partner still on an earlier release; an
  entry larger than that goes alone. Entries go in the order they were
  queued, per partner and board: after a failed push the same entries go
  first on the next try, and nothing queued later overtakes them. When the
  link returns after a long partition, each pass of the worker sends batch
  after batch while the partner accepts them, up to 20, and continues on the
  next pass.
- The receive lane accepts a request body up to 8 MB, and reads it only after
  the peer token is known; an unknown token gets 401 before its body is read.
  A body over the limit gets 413, which the sending instance shows as the
  entry's last error.
- The convergence is attributed to the sending peer in the audit trail.

## Resource escalation across tiers

A 213RR that a jurisdiction cannot fill escalates to a higher tier over the
same peer trust. The upper tier receives it as its own request, works it, and
reports fulfillment back down, so the originating request advances and its
chronology records the whole field-to-state-and-back path.

## Trust and hardening

Peer authentication is by token today; mutual TLS and key rotation are
deployment hardening on top. A peer can only reach boards it has an agreement
for, and only read or write as that agreement allows.
