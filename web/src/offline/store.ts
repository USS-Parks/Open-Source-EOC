import { fieldDbName } from "./device-lock.js";

/**
 * Durable offline store, IndexedDB-backed, so a field user's queued work
 * survives an app restart while disconnected: `docs` holds one Yjs state
 * blob per board (the offline edit queue lives inside the CRDT), `meta`
 * holds everything else the field client, outbox, task queue, drafts and
 * kept board forms keep. Every method is a thin promise wrapper; the field
 * client owns all semantics.
 *
 * Where it lives depends on the person (VC-27). Without a device PIN, in the
 * clear store every person shares, `openeoc-field`, each key naming its
 * person, as before device PINs: anyone using the device can read it. Under
 * a PIN, in the person's own database, each value encrypted with AES-GCM
 * under their data key before it reaches IndexedDB, bound to its store and
 * key so a value moved to another key does not open. The keys themselves
 * (such as `field-outbox:<person>:<incident>`) are not encrypted.
 */

const DB_VERSION = 1;
const DOCS = "docs";
const META = "meta";
/** The store kept in the clear, for everyone without a device PIN. */
export const CLEAR_DB = "openeoc-field";

export interface OfflineStore {
  saveDoc(boardId: string, state: Uint8Array): Promise<void>;
  saveDocAndMeta(
    boardId: string,
    state: Uint8Array,
    metaKey: string,
    metaValue: unknown,
  ): Promise<void>;
  loadDoc(boardId: string): Promise<Uint8Array | null>;
  docBoardIds(): Promise<string[]>;
  setMeta(key: string, value: unknown): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  close(): void;
}

export class DeviceLockedError extends Error {
  constructor() {
    super("This device's copy is locked. Enter your device PIN to open it.");
    this.name = "DeviceLockedError";
  }
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

function openDb(idb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS);
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    req.onsuccess = () => {
      // An erase, or the clear store emptied by a PIN, in another tab deletes the database; let it.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

/** The store as it was before device PINs: values as they are. */
function clearStore(db: () => Promise<IDBDatabase>, close: () => void): OfflineStore {
  return {
    async saveDoc(boardId, state) {
      const tx = (await db()).transaction(DOCS, "readwrite");
      // Copy into a plain ArrayBuffer-backed array so the structured clone
      // is a stable snapshot, not a view that could be detached later.
      tx.objectStore(DOCS).put(Uint8Array.from(state), boardId);
      await txDone(tx);
    },
    async saveDocAndMeta(boardId, state, metaKey, metaValue) {
      const tx = (await db()).transaction([DOCS, META], "readwrite");
      tx.objectStore(DOCS).put(Uint8Array.from(state), boardId);
      tx.objectStore(META).put(metaValue, metaKey);
      await txDone(tx);
    },
    async loadDoc(boardId) {
      const tx = (await db()).transaction(DOCS, "readonly");
      const value = await promisify(tx.objectStore(DOCS).get(boardId));
      if (!value) return null;
      return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    },
    async docBoardIds() {
      const tx = (await db()).transaction(DOCS, "readonly");
      return (await promisify(tx.objectStore(DOCS).getAllKeys())).map((k) => String(k));
    },
    async setMeta(key, value) {
      const tx = (await db()).transaction(META, "readwrite");
      tx.objectStore(META).put(value, key);
      await txDone(tx);
    },
    async getMeta<T>(key: string) {
      const tx = (await db()).transaction(META, "readonly");
      const value = await promisify(tx.objectStore(META).get(key));
      return (value as T | undefined) ?? null;
    },
    close,
  };
}

const kind = (value: unknown): string => Object.prototype.toString.call(value);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One tag byte, then the bytes: 0 JSON, 1 a Uint8Array, 2 an ArrayBuffer (a queued file). */
function encode(value: unknown): Uint8Array<ArrayBuffer> {
  const [tag, body] = kind(value) === "[object Uint8Array]"
    ? [1, value as Uint8Array]
    : kind(value) === "[object ArrayBuffer]"
      ? [2, new Uint8Array(value as ArrayBuffer)]
      : [0, encoder.encode(JSON.stringify(value ?? null))];
  const out = new Uint8Array(body.length + 1);
  out[0] = tag;
  out.set(body, 1);
  return out;
}

function decode(plain: Uint8Array): unknown {
  const body = plain.subarray(1);
  if (plain[0] === 1) return Uint8Array.from(body);
  if (plain[0] === 2) return body.slice().buffer;
  return JSON.parse(decoder.decode(body));
}

const slot = (store: string, key: string) => encoder.encode(`${store}\n${key}`);

/** Twelve bytes of IV, then the AES-GCM ciphertext of the tagged value. */
async function seal(key: CryptoKey, store: string, name: string, value: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: slot(store, name) }, key, encode(value)));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv);
  out.set(cipher, 12);
  return out;
}

async function unseal(key: CryptoKey, store: string, name: string, stored: unknown): Promise<unknown> {
  if (!ArrayBuffer.isView(stored)) throw new Error(`A value this device keeps (${name}) is not sealed.`);
  const sealed = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: slot(store, name) }, key, sealed.slice(12),
  ).catch(() => { throw new Error(`A value this device keeps (${name}) could not be opened.`); });
  return decode(new Uint8Array(plain));
}

/** Values are sealed before a transaction opens: a transaction closes if it waits on anything else. */
function sealedStore(db: () => Promise<IDBDatabase>, key: CryptoKey, close: () => void): OfflineStore {
  const read = async (store: string, name: string) => {
    const tx = (await db()).transaction(store, "readonly");
    const value = await promisify(tx.objectStore(store).get(name));
    return value === undefined ? undefined : unseal(key, store, name, value);
  };
  return {
    async saveDoc(boardId, state) {
      const value = await seal(key, DOCS, boardId, Uint8Array.from(state));
      const tx = (await db()).transaction(DOCS, "readwrite");
      tx.objectStore(DOCS).put(value, boardId);
      await txDone(tx);
    },
    async saveDocAndMeta(boardId, state, metaKey, metaValue) {
      const doc = await seal(key, DOCS, boardId, Uint8Array.from(state));
      const meta = await seal(key, META, metaKey, metaValue);
      const tx = (await db()).transaction([DOCS, META], "readwrite");
      tx.objectStore(DOCS).put(doc, boardId);
      tx.objectStore(META).put(meta, metaKey);
      await txDone(tx);
    },
    async loadDoc(boardId) {
      return ((await read(DOCS, boardId)) as Uint8Array | undefined) ?? null;
    },
    async docBoardIds() {
      const tx = (await db()).transaction(DOCS, "readonly");
      return (await promisify(tx.objectStore(DOCS).getAllKeys())).map((k) => String(k));
    },
    async setMeta(name, value) {
      const sealed = await seal(key, META, name, value);
      const tx = (await db()).transaction(META, "readwrite");
      tx.objectStore(META).put(sealed, name);
      await txDone(tx);
    },
    async getMeta<T>(name: string) {
      return ((await read(META, name)) as T | undefined) ?? null;
    },
    close,
  };
}

/** Whose store the page has open, and under which key; a null key is the clear store. */
let device: { readonly personId: string; readonly key: CryptoKey | null } | null = null;
/** Settles once a move from the clear store into a vault is done; every call waits for it. */
let settled: Promise<void> = Promise.resolve();
const connections = new WeakMap<IDBFactory, Map<string, Promise<IDBDatabase>>>();

function connection(idb: IDBFactory, name: string): Promise<IDBDatabase> {
  let open = connections.get(idb);
  if (!open) connections.set(idb, open = new Map());
  const pool = open;
  let db = pool.get(name);
  if (!db) {
    db = openDb(idb, name).then((opened) => {
      opened.onversionchange = () => { opened.close(); pool.delete(name); };
      return opened;
    });
    db.catch(() => pool.delete(name));
    pool.set(name, db);
  }
  return db;
}

/** The person whose store is open in this page, and whether it is sealed under a PIN. */
export function activeDevice(): { readonly personId: string; readonly sealed: boolean } | null {
  return device ? { personId: device.personId, sealed: device.key !== null } : null;
}

/** Open a person's store in the clear store, as before device PINs. */
export function openDeviceClear(personId: string): void {
  closeDevice();
  device = { personId, key: null };
}

const belongs = (key: string, personId: string) => key.split(":").includes(personId);

/**
 * Move what the clear store holds for this person into their sealed store,
 * then delete it there; the clear store goes once no one's work is left in
 * it. A key the sealed store already holds keeps its newer value.
 */
async function moveClearEntries(idb: IDBFactory, personId: string, target: OfflineStore): Promise<void> {
  if (typeof idb.databases === "function" && !(await idb.databases()).some((db) => db.name === CLEAR_DB)) return;
  const db = await connection(idb, CLEAR_DB);
  let left = 0;
  for (const store of [DOCS, META]) {
    const keys = (await promisify(db.transaction(store, "readonly").objectStore(store).getAllKeys())).map((k) => String(k));
    for (const key of keys) {
      if (!belongs(key, personId)) { left += 1; continue; }
      const value = await promisify(db.transaction(store, "readonly").objectStore(store).get(key));
      if (store === DOCS) {
        if (await target.loadDoc(key) === null) await target.saveDoc(key, new Uint8Array(value as ArrayBuffer));
      } else if (await target.getMeta(key) === null) {
        await target.setMeta(key, value);
      }
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      await txDone(tx);
    }
  }
  if (left === 0) idb.deleteDatabase(CLEAR_DB);
}

/**
 * Open a person's sealed store with the data key their PIN opened. What the
 * clear store holds for them moves into it and leaves the clear store;
 * calls wait until it has.
 */
export function openDeviceVault(personId: string, key: CryptoKey): Promise<void> {
  closeDevice();
  device = { personId, key };
  const factory = indexedDB;
  const run = settled.then(() => moveClearEntries(factory, personId,
    sealedStore(() => connection(factory, fieldDbName(personId)), key, () => undefined)));
  settled = run.catch(() => undefined);
  return run;
}

/** Lock: the key leaves this page's memory, and every open handle refuses until a store is opened again. */
export function closeDevice(): void {
  if (device?.key && typeof indexedDB !== "undefined") {
    const pool = connections.get(indexedDB);
    void pool?.get(fieldDbName(device.personId))?.then((db) => db.close(), () => undefined);
    pool?.delete(fieldDbName(device.personId));
  }
  device = null;
}

/**
 * A handle on one person's store that follows it from the clear store into a
 * vault, and refuses once it is locked. It opens once its database is open,
 * as the store always has, so a caller that waits for it finds the store
 * ready.
 */
async function deviceStore(personId: string, idb: IDBFactory | undefined): Promise<OfflineStore> {
  const target = async (): Promise<OfflineStore> => {
    await settled;
    if (!device || device.personId !== personId) throw new DeviceLockedError();
    const key = device.key;
    const factory = idb ?? indexedDB;
    const db = await connection(factory, key ? fieldDbName(personId) : CLEAR_DB);
    return key ? sealedStore(async () => db, key, () => undefined) : clearStore(async () => db, () => undefined);
  };
  await target();
  return {
    saveDoc: async (boardId, state) => (await target()).saveDoc(boardId, state),
    saveDocAndMeta: async (boardId, state, metaKey, metaValue) =>
      (await target()).saveDocAndMeta(boardId, state, metaKey, metaValue),
    loadDoc: async (boardId) => (await target()).loadDoc(boardId),
    docBoardIds: async () => (await target()).docBoardIds(),
    setMeta: async (key, value) => (await target()).setMeta(key, value),
    getMeta: async <T,>(key: string) => (await target()).getMeta<T>(key),
    // The connection is shared by every handle in the page; locking closes it.
    close() {},
  };
}

/**
 * The store for the person whose device is open in this page. A test or a
 * fixture may name its own database instead, sealed when it gives a key.
 */
export async function openOfflineStore(idb?: IDBFactory, name?: string, key?: CryptoKey): Promise<OfflineStore> {
  if (name !== undefined) {
    const db = await openDb(idb ?? indexedDB, name);
    return key ? sealedStore(() => Promise.resolve(db), key, () => db.close()) : clearStore(() => Promise.resolve(db), () => db.close());
  }
  if (!device) throw new DeviceLockedError();
  return deviceStore(device.personId, idb);
}
