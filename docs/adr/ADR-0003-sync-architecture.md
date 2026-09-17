# ADR-0003: Sync is Yjs CRDT over WebSocket with Postgres as truth

Status: accepted, 2026-09-17 (VEOC-04)

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
