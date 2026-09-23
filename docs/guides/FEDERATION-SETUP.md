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
- Three kinds of change are not forwarded in this release. Edits to an
  incident-scoped sync document (the continuity client joins with an
  incident) and REST writes to a record that belongs to an incident are not
  federated, because an agreement covers a board and the peer applies
  updates to its board's jurisdiction-wide document. Deleting a record is not
  forwarded: the partner keeps its copy. The route
  `POST /api/v1/peers/:peerId/queue` still queues a sync update by hand for
  every peer that reads the board.
- Records that existed before the board was shared are not sent. A later
  change to one reaches the partner as the changed fields only, and the
  partner does not list the record until every required field has arrived.
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
