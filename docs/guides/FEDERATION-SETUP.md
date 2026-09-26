# Federation Setup Guide

Federation lets two instances (a county and a state, say) share boards without
either depending on the other being online. Delivery is store-and-forward:
queued updates deliver when the link returns, and both sides converge.
[How updates flow](#how-updates-flow) says which edits queue.

## Register a peer

On each instance, an admin registers the other as a peer and receives a peer
token. The token admits that peer to this instance's inbound delivery lane.
Treat it as a secret; only its hash is stored.

## Exchange public keys

Each instance holds one Ed25519 key pair, made the first time an
administrator opens the federation status. The private key is stored
encrypted under `OPENEOC_SECRET_KEY`, so the server needs that set; until it
is, the instance has no key and cannot federate. Every batch an instance
pushes is signed with its key, and the receiving instance applies a batch only
when its signature verifies under the public key recorded for that peer. A
batch that is unsigned, signed with another key, changed after signing or
aimed at another board than the one it was signed for is refused with 401,
and nothing in it is applied. A peer with no recorded key is refused with
403.

The two administrators exchange public keys and compare fingerprints (the
SHA-256 of the key, shown beside it) by a channel they trust, such as a phone
call, before either records a key. Record a peer's key with
`PUT /api/v1/peers/:peerId/key`, giving the PEM public key. Recording it again
replaces it, and batches signed with the old key are refused from then on.

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

## Revoke an agreement

`DELETE /api/v1/peers/:peerId/agreements/:agreementId` revokes a sharing
agreement. The agreement is removed with every entry still waiting for the
peer on that board, so the board stops flowing both ways at once: nothing more
is queued or pushed to the peer for it, and the receive lane refuses the
peer's batches for it with 403. The partner's own outbox keeps its entries for
the board and shows "peer responded 403" as their last error until its
administrator revokes its side too. The revocation is recorded on the board
in the audit trail ("federation.agreement_revoked", with the peer, the access
it had and the number of waiting entries dropped). Sharing the board again
makes a new agreement, which sends the board's records as they stand.

## Exchange by file

Where no network path reaches a partner, such as an isolated enclave or a
site whose link is down for days, the two instances carry a shared board's
updates on removable media instead. Keys and agreements are set up as above,
each agreement with its receiving board; no push link is needed.

1. **Export.** On the sending instance,
   `POST /api/v1/peers/:peerId/exchange/export` returns what waits for the
   partner as a file of signed batches: the batches the delivery worker would
   push, signed with the same key, sized the same way (768 KB and 5,000
   entries each) and in the same queue order per receiving board. The file
   holds the batches and nothing else: no token, address or key. A file
   holds up to 32 MB of batches; what is past that, and what waits on a board
   with no receiving board set, stays out, and the export says how many. The
   exported entries stay waiting: for a push if a link returns, or for a
   later file. With nothing to export the route answers 409.
2. **Import.** On the receiving instance, an administrator imports the file
   for the partner that sent it with
   `POST /api/v1/peers/:peerId/exchange/import`. Every batch is checked as
   the receive lane checks a push, under the key recorded for that partner,
   before any is applied, so a file is taken whole or not at all. A batch
   that is unsigned or changed after signing, or a file signed by another
   partner, refuses the file with 422; a batch for a board the partner may
   not write (never shared, shared without write, or its agreement revoked)
   refuses it with 403; a file that is not a batch file gets 400. A batch
   that verifies is applied through the same lane as a push, attributed to
   the partner, and recorded as "federation.received" with `via` "file". A
   batch imported before is not applied again, so importing the same file
   twice changes nothing.
3. **Receipt.** The import returns a receipt, signed with the receiving
   instance's key, naming every batch in the file by digest: the SHA-256 of
   what the batch's signature covers. Importing the same file again returns
   the same receipt, which is how a lost receipt is made again.
4. **Mark delivered.** On the sending instance,
   `POST /api/v1/peers/:peerId/exchange/receipt` checks the receipt's
   signature under the partner's recorded key (422 if it does not verify)
   and that it names only batches this instance put in a file for that
   partner (409 if not); either way nothing is marked. The entries of the
   named batches that are still waiting are then marked delivered. A receipt
   imported twice marks nothing more.

Each direction works the same way: each instance exports its own waiting
updates and imports the other's file. The audit trail records each export
("federation.file_exported", with the number of batches and entries) and
each receipt ("federation.receipt_imported", with the number marked
delivered). Records that belong to an incident stay on their home instance
by file as by network.

## The Federation screen

Jurisdiction administrators set all of this up from **Federation** under Data
and administration in the console. The entry is hidden from everyone else, and
the server refuses the status read to anyone who is not an administrator of
the jurisdiction.

1. **This instance's key.** The panel shows the instance's public key and its
   fingerprint, with a **Copy public key** button. Give the key to each
   partner's administrator and compare fingerprints with them. The private
   key is never shown.
2. **Register a partner.** Enter the partner's name and select **Register
   partner**. The partner's token appears once, with a **Copy token** button.
   Copy it and give it to the partner's administrator, who enters it as the
   push link token on their instance. Select **I have saved the token** to
   clear it; it cannot be shown again.
3. **Set partner key.** Open **Set partner key** on the partner's card, paste
   the public key shown on the partner's own Federation screen, and select
   **Save partner key**. The card's Partner key reads "Recorded" and the
   fingerprint is shown; until then the card says the partner's batches are
   refused.
4. **Set push link.** Open **Set push link** on the partner's card and enter
   the partner's address and the token the partner issued to this instance.
   The token field is masked, the stored token is never displayed, and saving
   again replaces both the address and the token. The card then reads
   "Pushing to" the address.
5. **Share a board.** Open **Share a board**, pick one of this jurisdiction's
   boards not yet shared with the partner, choose whether the partner reads it
   or reads and writes it, and enter the receiving board ID: the id of the
   board on the partner that should receive the updates.
6. **Watch the outbox.** Each shared board shows how many updates are waiting,
   how long the oldest has waited, the next attempt, the last error and the
   last delivery. An update is held, and the card says why, until the partner
   is linked and the board has a receiving board. The badge on the partner
   reads "Up to date" when it is linked and nothing is waiting. Select **Refresh status** to
   read the outbox again.
7. **Revoke sharing.** Each shared board has **Revoke sharing**. It asks
   first, saying that nothing more is sent to or accepted from the partner for
   the board and how many waiting updates are dropped; **Revoke agreement**
   revokes it and the board leaves the card.
8. **Exchange by file.** Open **Exchange by file** on the partner's card.
   **Export waiting updates** saves the file for the partner and says how
   many updates it holds and how many stay out. On the partner, choose the
   file under **Batch file from** and the sender's name and select **Import
   batch file**; the screen says how many batches, updates and deletions were
   applied, or that the file was imported before and nothing changed, or,
   when a file is refused, "Nothing was imported" and why. **Export receipt**
   then saves the receipt for that file. Back on the sender, choose it under
   **Receipt from** and select **Import receipt**; the screen says how many
   updates were marked delivered, and the waiting count drops.
9. **Received from partners.** The ten latest batches partners pushed to this
   instance or it imported from their files, read from the audit trail: the
   board, the partner, "by file" for an imported one, the time, the number of
   updates and any conflicts reconciled.

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
- The server's delivery worker signs each linked peer's batch with the
  instance's key and pushes it to the peer's receive lane with the peer token. While the peer is unreachable the entries stay
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
  The batch's signature is checked against the peer's recorded key before
  anything in it is applied.
  A body over the limit gets 413, which the sending instance shows as the
  entry's last error.
- The convergence is attributed to the sending peer in the audit trail.

## Resource escalation across tiers

A 213RR that a jurisdiction cannot fill escalates to a higher tier over the
same peer trust. The upper tier receives it as its own request, works it, and
reports fulfillment back down, so the originating request advances and its
chronology records the whole field-to-state-and-back path.

## Trust and hardening

Trust in a batch comes from its signature: the peer token only admits the
request, and TLS only protects the channel. A peer can only reach boards it
has an agreement for, and only read or write as that agreement allows.
Rotating `OPENEOC_SECRET_KEY` re-encrypts the instance's private key with the
other stored secrets. The instance key itself is not rotated from the
console; a replaced key means every partner records the new one. Signatures
do not carry a time: a batch replayed later changes nothing, because updates
merge and a deleted record stays deleted. That is also why a file carried for
days still applies. A carried file has no channel to trust at all: its
batches are trusted by the sender's signature and its receipt by the
receiver's. The file is not encrypted, so whoever holds the media can read
the board updates in it; carry it as the board's contents deserve.

Resource escalation and JIC approval deliveries, the other lanes a peer token
opens, are not signed; they rest on the token alone.
