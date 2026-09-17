import type { BoardEvent } from "../notify/engine.js";

/**
 * In-process board event bus. Committed record writes (REST and sync alike)
 * publish here after the transaction; live consumers (dashboard streams)
 * subscribe. A listener failure never breaks the publisher or its peers.
 */

type Listener = (event: BoardEvent) => void;

const listeners = new Set<Listener>();

export function onBoardEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publishBoardEvent(event: BoardEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // Isolated: one broken consumer must not take out the write path.
    }
  }
}
