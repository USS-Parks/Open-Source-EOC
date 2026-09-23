# Federation Setup Guide

Federation lets two instances (a county and a state, say) share boards without
either depending on the other being online. Delivery is store-and-forward:
local edits queue and deliver when the link returns, and both sides converge.

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

## How updates flow

- Local edits to a shared board queue in an outbox, one entry per peer allowed
  to read it.
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
