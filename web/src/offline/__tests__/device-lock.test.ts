import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ERASE_AFTER,
  PIN_ITERATIONS,
  createVault,
  derivePinKey,
  dropOrphanStores,
  fieldDbName,
  latestSessionVault,
  lockoutDelayMs,
  markVaultSession,
  readVault,
  unlockVault,
} from "../device-lock.js";
import {
  CLEAR_DB,
  DeviceLockedError,
  activeDevice,
  closeDevice,
  openDeviceClear,
  openDeviceVault,
  openOfflineStore,
} from "../store.js";

/**
 * The device PIN (VC-27, threat row B18): without one, the device keeps a
 * person's work in the clear store as before; under one, it is ciphertext at
 * rest under a key only the PIN opens, the clear copy gone; wrong PINs wait
 * longer each time and the count outlives a restart, the tenth erases, and
 * one person's copy never opens for another.
 */

const dana = "11111111-1111-4111-8111-111111111111";
const lee = "22222222-2222-4222-8222-222222222222";
const PIN = "480913";
/** Every try derives 600,000 PBKDF2 rounds; ten of them on a loaded machine outlast the default test time. */
const SLOW = 120_000;
let idb: IDBFactory;

beforeEach(() => {
  closeDevice();
  idb = new IDBFactory();
  vi.stubGlobal("indexedDB", idb);
});

function raw(name: string, store: string): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    const open = idb.open(name);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(store, "readonly");
      const keys = tx.objectStore(store).getAllKeys();
      const values = tx.objectStore(store).getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(new Map(keys.result.map((key, index) => [String(key), values.result[index]])));
      };
    };
  });
}

async function databases(): Promise<string[]> {
  return (await idb.databases()).map((db) => db.name ?? "");
}

const text = (value: unknown) => new TextDecoder("latin1").decode(value as Uint8Array);

describe("device PIN key derivation", () => {
  it("makes the same key from the same PIN and salt, and a different one from another PIN or salt", async () => {
    const salt = new Uint8Array(16).fill(7);
    const data = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = new Uint8Array(12);
    const wrap = async (key: CryptoKey) => Array.from(new Uint8Array(await crypto.subtle.wrapKey("raw", data, key, { name: "AES-GCM", iv })));
    const first = await wrap(await derivePinKey(PIN, salt, 1_000));
    expect(await wrap(await derivePinKey(PIN, salt, 1_000))).toEqual(first);
    expect(await wrap(await derivePinKey("480914", salt, 1_000))).not.toEqual(first);
    expect(await wrap(await derivePinKey(PIN, new Uint8Array(16).fill(8), 1_000))).not.toEqual(first);
  });

  it("keeps a random salt and the iteration count per vault, and never the PIN", async () => {
    await createVault(dana, "Dana Reyes", PIN);
    await createVault(lee, "Lee Moreno", PIN);
    const vaults = await raw("openeoc-device", "vaults");
    const [a, b] = [vaults.get(dana), vaults.get(lee)] as { salt: Uint8Array; iterations: number; wrapped: Uint8Array }[];
    expect(a!.iterations).toBe(PIN_ITERATIONS);
    expect(a!.salt).toHaveLength(16);
    expect(Array.from(a!.salt)).not.toEqual(Array.from(b!.salt));
    expect(JSON.stringify([...vaults.values()], (_k, v: unknown) => v instanceof Uint8Array ? text(v) : v)).not.toContain(PIN);
  });
});

describe("the sealed store", () => {
  it("round-trips every kind of value and keeps only ciphertext at rest", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const store = await openOfflineStore(idb, "sealed", key);
    const photo = new TextEncoder().encode("PHOTO-BYTES Bluff Creek culvert").buffer;
    await store.setMeta("field-outbox:p:i", [{ kind: "message", body: "Levee breach at Bluff Creek" }]);
    await store.saveDocAndMeta("board:p:i:b", new TextEncoder().encode("records Bluff Creek"), "board-operations:p:i", [{ update: "Bluff Creek" }]);
    await store.setMeta("field-attachment-bytes:p:i:1", photo);
    await store.setMeta("cleared", null);
    store.close();

    for (const [storeName, values] of [["meta", await raw("sealed", "meta")], ["docs", await raw("sealed", "docs")]] as const) {
      expect(values.size, storeName).toBeGreaterThan(0);
      for (const value of values.values()) {
        expect(value).toBeInstanceOf(Uint8Array);
        expect(text(value)).not.toMatch(/Bluff Creek|PHOTO-BYTES|message/);
      }
    }

    const reopened = await openOfflineStore(idb, "sealed", key);
    expect(await reopened.getMeta("field-outbox:p:i")).toEqual([{ kind: "message", body: "Levee breach at Bluff Creek" }]);
    expect(new TextDecoder().decode(await reopened.loadDoc("board:p:i:b") ?? new Uint8Array())).toBe("records Bluff Creek");
    expect(new TextDecoder().decode(await reopened.getMeta<ArrayBuffer>("field-attachment-bytes:p:i:1") ?? new ArrayBuffer(0))).toBe("PHOTO-BYTES Bluff Creek culvert");
    expect(await reopened.getMeta("cleared")).toBeNull();
    expect(await reopened.getMeta("absent")).toBeNull();
    expect(await reopened.docBoardIds()).toEqual(["board:p:i:b"]);
    reopened.close();
  });

  it("refuses a value under another key, and a value moved to another slot", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const store = await openOfflineStore(idb, "bound", key);
    await store.setMeta("field-outbox:dana:i", ["kept"]);
    store.close();
    const other = await openOfflineStore(idb, "bound", await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    await expect(other.getMeta("field-outbox:dana:i")).rejects.toThrow("could not be opened");
    other.close();

    const moved = (await raw("bound", "meta")).get("field-outbox:dana:i");
    await new Promise<void>((resolve) => {
      const open = idb.open("bound");
      open.onsuccess = () => {
        const tx = open.result.transaction("meta", "readwrite");
        tx.objectStore("meta").put(moved, "field-outbox:lee:i");
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    const same = await openOfflineStore(idb, "bound", key);
    await expect(same.getMeta("field-outbox:lee:i")).rejects.toThrow("could not be opened");
    same.close();
  });

  it("keeps work in the clear store without a PIN, and moves it into the sealed store once a PIN is set", async () => {
    openDeviceClear(dana);
    const store = await openOfflineStore();
    await store.setMeta(`field-outbox:${dana}:i`, [{ body: "Road closed at the Klamath bridge" }]);
    await store.saveDoc(`board:${dana}:i:b`, new TextEncoder().encode("Klamath bridge closure"));
    // Unprotected, as before device PINs: readable as it is.
    expect((await raw(CLEAR_DB, "meta")).get(`field-outbox:${dana}:i`)).toEqual([{ body: "Road closed at the Klamath bridge" }]);

    const key = await createVault(dana, "Dana Reyes", PIN);
    await openDeviceVault(dana, key);
    // The handle opened on the clear store follows the work into the vault.
    expect(await store.getMeta(`field-outbox:${dana}:i`)).toEqual([{ body: "Road closed at the Klamath bridge" }]);
    expect(new TextDecoder().decode(await store.loadDoc(`board:${dana}:i:b`) ?? new Uint8Array())).toBe("Klamath bridge closure");
    const sealed = await raw(fieldDbName(dana), "meta");
    expect(text(sealed.get(`field-outbox:${dana}:i`))).not.toContain("Klamath");
    // The clear copy is gone, and with no one else's work in it, the clear store too.
    await vi.waitFor(async () => expect(await databases()).not.toContain(CLEAR_DB));
  });

  it("refuses a locked store and another person's handle", async () => {
    await openDeviceVault(dana, await createVault(dana, "Dana Reyes", PIN));
    const danas = await openOfflineStore();
    await danas.setMeta(`field-outbox:${dana}:i`, ["Dana's message"]);
    closeDevice();
    await expect(danas.getMeta(`field-outbox:${dana}:i`)).rejects.toBeInstanceOf(DeviceLockedError);
    await expect(openOfflineStore()).rejects.toBeInstanceOf(DeviceLockedError);

    // Lee signs in on the same device without a PIN: the clear store, which holds nothing of Dana's.
    openDeviceClear(lee);
    const lees = await openOfflineStore();
    expect(await lees.getMeta(`field-outbox:${dana}:i`)).toBeNull();
    await expect(danas.getMeta(`field-outbox:${dana}:i`)).rejects.toBeInstanceOf(DeviceLockedError);
    expect(await unlockVault(dana, "999999")).toMatchObject({ ok: false, reason: "wrong" });
    expect(activeDevice()).toEqual({ personId: lee, sealed: false });
  });
});

describe("wrong PINs", () => {
  it("counts each try before it runs, waits longer each time, and keeps the count through a restart", async () => {
    expect([1, 2, 3, 4, 5, 9].map(lockoutDelayMs)).toEqual([0, 0, 30_000, 60_000, 120_000, 1_920_000]);
    await createVault(dana, "Dana Reyes", PIN);
    let now = Date.parse("2026-09-25T18:00:00Z");
    expect(await unlockVault(dana, "000000", idb, now)).toEqual({ ok: false, reason: "wrong", waitMs: 0, attemptsLeft: 9 });
    expect(await unlockVault(dana, "000001", idb, now)).toEqual({ ok: false, reason: "wrong", waitMs: 0, attemptsLeft: 8 });
    expect(await unlockVault(dana, "000002", idb, now)).toEqual({ ok: false, reason: "wrong", waitMs: 30_000, attemptsLeft: 7 });
    // During the wait even the right PIN is not tried, and not counted.
    expect(await unlockVault(dana, PIN, idb, now + 10_000)).toEqual({ ok: false, reason: "wait", waitMs: 20_000, attemptsLeft: 7 });
    // A restart reads the same count and wait.
    expect(await readVault(dana)).toMatchObject({ failures: 3, lockedUntil: now + 30_000, attemptsLeft: 7 });
    now += 30_000;
    expect(await unlockVault(dana, "000003", idb, now)).toEqual({ ok: false, reason: "wrong", waitMs: 60_000, attemptsLeft: 6 });
    now += 60_000;
    const opened = await unlockVault(dana, PIN, idb, now);
    expect(opened.ok).toBe(true);
    expect(await readVault(dana)).toMatchObject({ failures: 0, lockedUntil: 0 });
  }, SLOW);

  it("erases the person's vault and store on the tenth wrong PIN, unsent work included", async () => {
    await openDeviceVault(dana, await createVault(dana, "Dana Reyes", PIN));
    await (await openOfflineStore()).setMeta(`field-outbox:${dana}:i`, ["an unsent message"]);
    await markVaultSession(dana, true);
    closeDevice();
    await createVault(lee, "Lee Moreno", "112233");
    let now = Date.parse("2026-09-25T18:00:00Z");
    let last = null as Awaited<ReturnType<typeof unlockVault>> | null;
    for (let attempt = 1; attempt <= ERASE_AFTER; attempt += 1) {
      last = await unlockVault(dana, `00000${attempt}`, idb, now);
      if (!last.ok) now += last.waitMs;
    }
    expect(last).toEqual({ ok: false, reason: "erased", waitMs: 0, attemptsLeft: 0 });
    expect(await readVault(dana)).toBeNull();
    expect(await latestSessionVault()).toBeNull();
    expect(await databases()).not.toContain(fieldDbName(dana));
    expect(await unlockVault(dana, PIN, idb, now)).toMatchObject({ ok: false, reason: "erased" });
    // Another person's vault on the device is untouched.
    expect(await readVault(lee)).toMatchObject({ label: "Lee Moreno", failures: 0 });
  }, SLOW);
});

describe("the clear store shared by people without a PIN", () => {
  it("moves only one person's entries when they set a PIN, and goes once no one's are left", async () => {
    await new Promise<void>((resolve) => {
      const open = idb.open(CLEAR_DB, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore("docs"); open.result.createObjectStore("meta"); };
      open.onsuccess = () => {
        const tx = open.result.transaction(["docs", "meta"], "readwrite");
        tx.objectStore("docs").put(new TextEncoder().encode("Dana's board"), `board:${dana}:i:b`);
        tx.objectStore("meta").put([{ body: "Dana's queued message" }], `field-outbox:${dana}:i`);
        tx.objectStore("meta").put([{ body: "Lee's queued message" }], `field-outbox:${lee}:i`);
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    await openDeviceVault(dana, await createVault(dana, "Dana Reyes", PIN));
    const store = await openOfflineStore();
    expect(await store.getMeta(`field-outbox:${dana}:i`)).toEqual([{ body: "Dana's queued message" }]);
    expect(new TextDecoder().decode(await store.loadDoc(`board:${dana}:i:b`) ?? new Uint8Array())).toBe("Dana's board");
    expect(text((await raw(fieldDbName(dana), "meta")).get(`field-outbox:${dana}:i`))).not.toContain("Dana's queued");
    expect([...(await raw(CLEAR_DB, "meta")).keys()]).toEqual([`field-outbox:${lee}:i`]);
    expect(await raw(CLEAR_DB, "docs")).toEqual(new Map());

    await openDeviceVault(lee, await createVault(lee, "Lee Moreno", "112233"));
    expect(await (await openOfflineStore()).getMeta(`field-outbox:${lee}:i`)).toEqual([{ body: "Lee's queued message" }]);
    await vi.waitFor(async () => expect(await databases()).not.toContain(CLEAR_DB));
  });

  it("drops a store no vault opens", async () => {
    await openDeviceVault(dana, await createVault(dana, "Dana Reyes", PIN));
    await (await openOfflineStore()).setMeta("x", 1);
    closeDevice();
    await openOfflineStore(idb, fieldDbName(lee), await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]))
      .then((store) => store.close());
    await dropOrphanStores();
    await vi.waitFor(async () => expect(await databases()).not.toContain(fieldDbName(lee)));
    expect(await databases()).toContain(fieldDbName(dana));
  });
});
