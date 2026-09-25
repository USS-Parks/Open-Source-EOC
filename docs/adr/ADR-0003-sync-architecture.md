# ADR-0003: Sync is Yjs CRDT over WebSocket with Postgres as truth

Status: accepted, 2026-09-17 (VEOC-04)

Status note, 2026-09-25 (Veoci and air gap VA5): "never silently" below
holds for edits the server refuses. A sync edit the board cannot accept (a
value its fields refuse, or an edit reaching a deleted record) is kept as a
visible conflict in `sync_conflicts` and audited as `sync.conflict`. Two
accepted edits to one field settle by the ordering rule in the addendum, and
the losing edit stays in the sync log without a conflict entry. Workflow
state such as a resource request's lifecycle is not a Yjs document: the
server applies its transitions.

## Decision

- Concurrently edited surfaces (board records mid-edit, messages, map
  annotations) are Yjs documents synced over the WebSocket endpoint.
- PostgreSQL remains the single source of truth: committed board records,
  audit entries, and files live in Postgres; a Yjs document is the editing
  and transport representation, checkpointed into Postgres on commit.
- Offline clients queue Yjs updates locally (IndexedDB) and reconcile on
  reconnect in either order; CRDT semantics resolve concurrent edits.
- Where CRDT merge semantics cannot express intent (for example two users
  closing the same resource request differently), the server derives a
  deterministic outcome by audit timestamp and surfaces the loser's edit as
  a visible conflict entry, never silently.
- Federation (VEOC-30) reuses the same update log as its store-and-forward
  payload.

## Addendum: server-authored updates (2026-09-23)

- A record written through the REST routes is appended to the sync log as a
  Yjs update in the writing transaction, under the record's own scope, and
  folded into open documents after commit. A record of an incident is
  written under that incident with only the fields its documents project;
  any other field is written under the board-wide scope alone, so the
  board-wide document is never left with a stale value that its next sync
  checkpoint would write back over the row. A record with no incident is
  federated like a sync edit; a record of an incident is not.
- The update sets each field as a new root map entry from a client id of its
  own, above the 32-bit range Yjs assigns to clients and rising with the
  server clock: whole seconds, then a random draw, never below the previous
  id the process issued. It depends on nothing in the log, so every document,
  replay and peer applies it as it is.
- Ordering rule. Yjs orders concurrent root entries for a key by client id,
  and an entry built on another follows it. So a REST write wins over every
  sync edit made without seeing it, whenever that edit arrives; a sync edit
  made after the REST write reached its client wins over it; REST writes on
  one instance apply in commit order; REST writes to one field on two
  federated instances settle by server clock to the second, then by the
  random draw. Every replica converges on one value. This is deterministic,
  not wall-clock last-writer-wins, and a losing sync edit stays in the log
  without a conflict entry.
- Each REST write adds one log row and one client to the board's state
  vector. A hydration that replays a long tail writes a snapshot, so the
  replay stays bounded when no sync client writes.

## Alternatives considered

- **Automerge:** comparable CRDT; smaller ecosystem, slower large-doc
  performance history.
- **ElectricSQL/PowerSync-class Postgres sync:** attractive but young,
  vendor-shaped, and a second sync system beside Yjs; revisit at VEOC-21 if
  Yjs-over-IndexedDB proves insufficient for table-shaped offline data.
- **Server-authoritative last-write-wins:** simple, but silent data loss in
  a partitioned EOC is disqualifying (INV-3, research anti-requirements).

## Reversal cost

High after VEOC-13 ships; this is the structural wall of offline-first.
The mitigation is that Postgres, not Yjs, holds truth: a sync-layer swap
replays from Postgres state without data loss.
