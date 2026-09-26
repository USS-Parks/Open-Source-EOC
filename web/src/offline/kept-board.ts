import { noConnection } from "./outbox.js";
import { openOfflineStore } from "./store.js";

/**
 * Read something through the server, keeping the answer on this device under
 * `key`; with no connection, answer from the kept copy instead. A board's
 * shape kept this way lets its form open offline (AG-07).
 */
export async function readKept<T>(key: string, read: () => Promise<T>): Promise<T> {
  try {
    const value = await read();
    void keep(key, value).catch(() => undefined);
    return value;
  } catch (error) {
    if (!noConnection(error) || typeof indexedDB === "undefined") throw error;
    const store = await openOfflineStore();
    try {
      const kept = await store.getMeta<T>(key);
      if (kept === null) throw error;
      return kept;
    } finally {
      store.close();
    }
  }
}

async function keep(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const store = await openOfflineStore();
  try {
    await store.setMeta(key, value);
  } finally {
    store.close();
  }
}
