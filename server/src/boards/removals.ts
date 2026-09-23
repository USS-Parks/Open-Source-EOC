/**
 * In-process notice that a record was deleted, published after the deleting
 * transaction commits. The sync hub listens so open documents drop the record
 * and their subscribers hear it; a listener failure never breaks the delete.
 */

export interface RecordRemoval {
  readonly boardId: string;
  readonly recordId: string;
  readonly incidentId: string | null;
}

type Listener = (removal: RecordRemoval) => void;

const listeners = new Set<Listener>();

export function onRecordRemoved(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publishRecordRemoved(removal: RecordRemoval): void {
  for (const fn of listeners) {
    try {
      fn(removal);
    } catch {
      // Isolated, as on the board event bus.
    }
  }
}
