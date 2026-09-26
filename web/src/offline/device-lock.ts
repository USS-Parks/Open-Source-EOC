/**
 * The device PIN for shared devices (VC-27, threat row B18), which a person
 * chooses to set. Once set, what this device keeps for them (the offline
 * store and the sealed session) is encrypted with a random AES-GCM data key,
 * and that key rests on the device
 * only wrapped under a key derived from the person's PIN: PBKDF2 with
 * SHA-256 over a random salt made on this device. The PIN is never stored,
 * sent or logged.
 *
 * A wrong PIN is counted before it is tried, so closing the page mid-try
 * still counts it. From the third in a row, each wrong PIN sets a wait that
 * starts at 30 seconds and doubles; the count and the wait are kept here, so
 * a reload does not reset them. The tenth wrong PIN erases what the device
 * keeps for that person, unsent work included.
 */

const DEVICE_DB = "openeoc-device";
const VAULTS = "vaults";

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256; kept per vault, so a later raise leaves older vaults readable. */
export const PIN_ITERATIONS = 600_000;
export const MIN_PIN_LENGTH = 6;
/** Wrong PINs before the first wait: room for a typo or two. */
export const FREE_ATTEMPTS = 3;
/** The wrong PIN that erases what the device keeps for the person. */
export const ERASE_AFTER = 10;
/** Without a touch, click or key for this long, a device PIN locks the console again. */
export const IDLE_LOCK_MS = 15 * 60_000;
const FIRST_WAIT_MS = 30_000;

/** The IndexedDB database that holds one person's sealed store on this device. */
export function fieldDbName(personId: string): string {
  return `openeoc-field:${personId}`;
}

/** How long to wait after this many wrong PINs in a row. */
export function lockoutDelayMs(failures: number): number {
  return failures < FREE_ATTEMPTS ? 0 : FIRST_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS);
}

interface VaultRecord {
  readonly personId: string;
  /** The person's name, shown on the PIN screen so the right person unlocks it. */
  readonly label: string;
  readonly salt: Uint8Array;
  readonly iterations: number;
  /** Twelve bytes of IV, then the data key wrapped with AES-GCM under the PIN key. */
  readonly wrapped: Uint8Array;
  readonly failures: number;
  readonly lockedUntil: number;
  /** Whether a signed-in session is sealed in the store, so a start can offer the PIN. */
  readonly session: boolean;
  readonly usedAt: number;
}

export interface VaultInfo {
  readonly personId: string;
  readonly label: string;
  readonly failures: number;
  readonly lockedUntil: number;
  readonly session: boolean;
  readonly attemptsLeft: number;
}

export type UnlockResult =
  | { readonly ok: true; readonly key: CryptoKey }
  | {
    readonly ok: false;
    /** wrong: refused and counted; wait: not tried, a wait is running; erased: the tenth wrong PIN erased it. */
    readonly reason: "wrong" | "wait" | "erased";
    readonly waitMs: number;
    readonly attemptsLeft: number;
  };

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** Binds a wrapped key to its person, so a vault copied under another person's id does not open. */
const wrapContext = (personId: string) => bytes(`openeoc-device-key\n${personId}`);

function info(record: VaultRecord): VaultInfo {
  return {
    personId: record.personId,
    label: record.label,
    failures: record.failures,
    lockedUntil: record.lockedUntil,
    session: record.session,
    attemptsLeft: ERASE_AFTER - record.failures,
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withVaults<T>(idb: IDBFactory, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DEVICE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(VAULTS, { keyPath: "personId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    const tx = db.transaction(VAULTS, mode);
    const result = await request(run(tx.objectStore(VAULTS)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

const getVault = async (idb: IDBFactory, personId: string) =>
  (await withVaults<VaultRecord | undefined>(idb, "readonly", (store) => store.get(personId))) ?? null;
const putVault = (idb: IDBFactory, record: VaultRecord) => withVaults(idb, "readwrite", (store) => store.put(record));

/** The key a PIN and salt make. Wrong PINs make other keys, which the wrapped data key refuses. */
export async function derivePinKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations = PIN_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bytes(pin.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

function unwrap(pinKey: CryptoKey, record: VaultRecord): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    record.wrapped.slice(12),
    pinKey,
    { name: "AES-GCM", iv: record.wrapped.slice(0, 12), additionalData: wrapContext(record.personId) },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function pinProblem(pin: string, repeat: string): string | null {
  if (pin.length < MIN_PIN_LENGTH) return `A device PIN has at least ${MIN_PIN_LENGTH} digits or characters.`;
  if (pin !== repeat) return "The two PINs do not match.";
  return null;
}

/**
 * Make a person's vault: a new data key, wrapped under their PIN. Returns
 * the data key, usable but not exportable. Replaces any vault the person
 * had, whose store must already be erased.
 */
export async function createVault(personId: string, label: string, pin: string, idb: IDBFactory = indexedDB): Promise<CryptoKey> {
  if (pin.length < MIN_PIN_LENGTH) throw new Error(`A device PIN has at least ${MIN_PIN_LENGTH} digits or characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinKey = await derivePinKey(pin, salt);
  const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.wrapKey("raw", dataKey, pinKey, {
    name: "AES-GCM", iv, additionalData: wrapContext(personId),
  }));
  const wrapped = new Uint8Array(12 + sealed.length);
  wrapped.set(iv);
  wrapped.set(sealed, 12);
  const record: VaultRecord = {
    personId, label, salt, iterations: PIN_ITERATIONS, wrapped,
    failures: 0, lockedUntil: 0, session: false, usedAt: Date.now(),
  };
  await putVault(idb, record);
  return unwrap(pinKey, record);
}

export async function readVault(personId: string, idb: IDBFactory = indexedDB): Promise<VaultInfo | null> {
  const record = await getVault(idb, personId);
  return record ? info(record) : null;
}

/** The vault most recently opened that still holds a signed-in session: whom the start asks for a PIN. */
export async function latestSessionVault(idb: IDBFactory = indexedDB): Promise<VaultInfo | null> {
  const all = await withVaults<VaultRecord[]>(idb, "readonly", (store) => store.getAll());
  const withSession = all.filter((record) => record.session).sort((a, b) => b.usedAt - a.usedAt);
  return withSession[0] ? info(withSession[0]) : null;
}

export async function markVaultSession(personId: string, session: boolean, idb: IDBFactory = indexedDB): Promise<void> {
  const record = await getVault(idb, personId);
  if (record && record.session !== session) await putVault(idb, { ...record, session });
}

/**
 * Try a PIN. A running wait refuses without counting; otherwise the try is
 * counted first and forgiven only when the PIN opens the key.
 */
export async function unlockVault(personId: string, pin: string, idb: IDBFactory = indexedDB, now = Date.now()): Promise<UnlockResult> {
  const record = await getVault(idb, personId);
  if (!record) return { ok: false, reason: "erased", waitMs: 0, attemptsLeft: 0 };
  if (now < record.lockedUntil) {
    return { ok: false, reason: "wait", waitMs: record.lockedUntil - now, attemptsLeft: ERASE_AFTER - record.failures };
  }
  const failures = record.failures + 1;
  await putVault(idb, { ...record, failures, lockedUntil: now + lockoutDelayMs(failures) });
  let key: CryptoKey;
  try {
    key = await unwrap(await derivePinKey(pin, new Uint8Array(record.salt), record.iterations), record);
  } catch {
    if (failures >= ERASE_AFTER) {
      await eraseVault(personId, idb);
      return { ok: false, reason: "erased", waitMs: 0, attemptsLeft: 0 };
    }
    return { ok: false, reason: "wrong", waitMs: lockoutDelayMs(failures), attemptsLeft: ERASE_AFTER - failures };
  }
  await putVault(idb, { ...record, failures: 0, lockedUntil: 0, usedAt: Date.now() });
  return { ok: true, key };
}

/**
 * Erase what this device keeps for a person: the vault first, which leaves
 * the store unreadable at once, then the store itself. An open connection in
 * another tab closes on the version change; a blocked delete finishes when
 * it does.
 */
export async function eraseVault(personId: string, idb: IDBFactory = indexedDB): Promise<void> {
  await withVaults(idb, "readwrite", (store) => store.delete(personId));
  await new Promise<void>((resolve) => {
    const req = idb.deleteDatabase(fieldDbName(personId));
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/**
 * Delete stores no vault can open: left by an erase that did not finish, or
 * by a vault removed in another tab. Where the browser cannot list its
 * databases, nothing is deleted.
 */
export async function dropOrphanStores(idb: IDBFactory = indexedDB): Promise<void> {
  if (typeof idb.databases !== "function") return;
  const names = (await idb.databases()).map((db) => db.name ?? "").filter((name) => name.startsWith("openeoc-field:"));
  if (!names.length) return;
  const vaults = new Set((await withVaults<VaultRecord[]>(idb, "readonly", (store) => store.getAll())).map((record) => fieldDbName(record.personId)));
  for (const name of names) if (!vaults.has(name)) idb.deleteDatabase(name);
}
