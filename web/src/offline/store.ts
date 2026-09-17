/**
 * Durable offline store (VEOC-21). IndexedDB-backed, so a field user's
 * queued work survives an app restart while disconnected. Two object
 * stores: `docs` holds one Yjs state blob per board (the offline edit
 * queue lives inside the CRDT), `meta` holds the cached session and the
 * assigned-board catalog. Every method is a thin promise wrapper; the
 * field client owns all semantics.
 */

const DB_NAME = "openeoc-field";
const DB_VERSION = 1;
const DOCS = "docs";
const META = "meta";

export interface OfflineStore {
  saveDoc(boardId: string, state: Uint8Array): Promise<void>;
  loadDoc(boardId: string): Promise<Uint8Array | null>;
  docBoardIds(): Promise<string[]>;
  setMeta(key: string, value: unknown): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  close(): void;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openOfflineStore(
  idb: IDBFactory = indexedDB,
  name = DB_NAME,
): Promise<OfflineStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS);
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return {
    async saveDoc(boardId, state) {
      const tx = db.transaction(DOCS, "readwrite");
      // Copy into a plain ArrayBuffer-backed array so the structured clone
      // is a stable snapshot, not a view that could be detached later.
      tx.objectStore(DOCS).put(Uint8Array.from(state), boardId);
      await txDone(tx);
    },
    async loadDoc(boardId) {
      const tx = db.transaction(DOCS, "readonly");
      const value = await promisify(tx.objectStore(DOCS).get(boardId));
      if (!value) return null;
      return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    },
    async docBoardIds() {
      const tx = db.transaction(DOCS, "readonly");
      const keys = await promisify(tx.objectStore(DOCS).getAllKeys());
      return keys.map((k) => String(k));
    },
    async setMeta(key, value) {
      const tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put(value, key);
      await txDone(tx);
    },
    async getMeta<T>(key: string) {
      const tx = db.transaction(META, "readonly");
      const value = await promisify(tx.objectStore(META).get(key));
      return (value as T | undefined) ?? null;
    },
    close() {
      db.close();
    },
  };
}
