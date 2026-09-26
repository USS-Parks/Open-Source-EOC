import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signBatch, signReceipt } from "../federation/identity.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Exchange by file (AG-04). Two instances on separate databases with no
 * network path between them: neither listens on a port and neither is linked
 * to the other. They exchange public keys and share a board each way, then
 * carry a board's edits and deletes by file in both directions: the sender
 * exports what waits as a file of signed batches, the partner imports it
 * through the receive lane and exports a signed receipt, and the receipt
 * marks the sender's entries delivered. Every file passes through a folder
 * standing in for removable media. A repeated import changes nothing, and a
 * file for the wrong partner or board, a tampered file, one for a revoked
 * agreement and a receipt naming batches never sent are refused whole.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  jurisdictionId: string;
  adminToken: string;
  memberToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let priorKey: string | undefined;
let media: string;
/** On the county, the peer record for the state; on the state, the one for the county. */
let stateAtCounty: string, countyAtState: string;
let stateAgreement: string;

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.ready();
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "activity_log" } });
  return { admin, runtime, app, jurisdictionId: seed.jurisdictionId, adminToken, memberToken, boardId: board.json().id as string };
}

async function call(inst: Instance, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, status: number, payload?: unknown) {
  const res = await inst.app.inject({ method, url, headers: auth(inst.adminToken), ...(payload !== undefined ? { payload: payload as object } : {}) });
  expect(res.statusCode, res.body).toBe(status);
  return res.json();
}

/** Write a file to the media folder and read it back, as a carried file is. */
function carry(name: string, content: unknown): unknown {
  const path = join(media, name);
  writeFileSync(path, JSON.stringify(content));
  return JSON.parse(readFileSync(path, "utf8"));
}

async function exportFile(from: Instance, peerId: string) {
  return call(from, "POST", `/api/v1/peers/${peerId}/exchange/export`, 200);
}

async function importFile(into: Instance, peerId: string, file: unknown, status = 200) {
  return call(into, "POST", `/api/v1/peers/${peerId}/exchange/import`, status, file);
}

async function importReceipt(into: Instance, peerId: string, receipt: unknown, status = 200) {
  return call(into, "POST", `/api/v1/peers/${peerId}/exchange/receipt`, status, receipt);
}

async function addEntry(inst: Instance, entry: string): Promise<string> {
  return (await call(inst, "POST", `/api/v1/boards/${inst.boardId}/records`, 201, { entry })).id as string;
}

/** Live entries on an instance's board, by record id. */
async function entriesOn(inst: Instance): Promise<Record<string, string>> {
  const rows = await inst.admin`
    select id, data ->> 'entry' as entry from board_records where board_id = ${inst.boardId} and deleted_at is null`;
  return Object.fromEntries(rows.map((r) => [r.id as string, r.entry as string]));
}

async function waiting(inst: Instance, peerId: string): Promise<number> {
  const [row] = await inst.admin`
    select count(*)::integer as n from federation_outbox where peer_id = ${peerId} and delivered_at is null`;
  return row!.n as number;
}

/** Everything an import could change on an instance, to show a repeat changes nothing. */
async function footprint(inst: Instance) {
  const [row] = await inst.admin`
    select (select md5(coalesce(string_agg(r::text, ',' order by r.id), '')) from board_records r) as records,
           (select count(*)::integer from sync_updates) as log,
           (select count(*)::integer from federation_outbox) as outbox,
           (select count(*)::integer from audit_events) as audit`;
  return row;
}

function update(entry: string): string {
  const doc = new Y.Doc();
  doc.transact(() => doc.getMap("records").set(`${randomUUID()}/entry`, entry));
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-federation-file-key";
  media = mkdtempSync(join(tmpdir(), "openeoc-media-"));
  county = await standUp();
  state = await standUp();

  // Each registers the other and records the key the other shows; no push link is ever set.
  stateAtCounty = (await call(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/peers`, 201, { name: "State OES" })).id as string;
  countyAtState = (await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, 201, { name: "County OES" })).id as string;
  const countyKey = (await call(county, "GET", `/api/v1/jurisdictions/${county.jurisdictionId}/federation`, 200)).identity.publicKey as string;
  const stateKey = (await call(state, "GET", `/api/v1/jurisdictions/${state.jurisdictionId}/federation`, 200)).identity.publicKey as string;
  await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/key`, 200, { publicKey: stateKey });
  await call(state, "PUT", `/api/v1/peers/${countyAtState}/key`, 200, { publicKey: countyKey });
  // Each shares its board with the other, readable and writable, into the other's board.
  await call(county, "POST", `/api/v1/peers/${stateAtCounty}/agreements`, 201,
    { boardId: county.boardId, canRead: true, canWrite: true, remoteBoardId: state.boardId });
  stateAgreement = (await call(state, "POST", `/api/v1/peers/${countyAtState}/agreements`, 201,
    { boardId: state.boardId, canRead: true, canWrite: true, remoteBoardId: county.boardId })).id as string;
}, 120_000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
  if (media) rmSync(media, { recursive: true, force: true });
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("exchange by file between two instances with no network path", () => {
  let levee: string, shelter: string;

  it("carries the county's edits and deletes to the state, and the receipt back", async () => {
    // Nothing links the two: no address, no push token, and no port is listening.
    for (const [inst, peer] of [[county, stateAtCounty], [state, countyAtState]] as const) {
      const [row] = await inst.admin`select endpoint_url, outbound_token from peers where id = ${peer}`;
      expect(row).toEqual({ endpoint_url: null, outbound_token: null });
      expect(inst.app.server.listening).toBe(false);
    }

    levee = await addEntry(county, "county: levee watch");
    shelter = await addEntry(county, "county: shelter open");
    await call(county, "PATCH", `/api/v1/boards/${county.boardId}/records/${levee}`, 200, { entry: "county: levee breached" });
    await call(county, "DELETE", `/api/v1/boards/${county.boardId}/records/${shelter}`, 200);
    const queued = await waiting(county, stateAtCounty);
    expect(queued).toBeGreaterThanOrEqual(4);

    // The file holds signed batches and nothing else: no token, address or key.
    const exported = await exportFile(county, stateAtCounty);
    expect(exported).toMatchObject({ entries: queued, remaining: 0 });
    expect(exported.file.format).toBe("openeoc-federation-batches");
    expect(exported.file.version).toBe(1);
    for (const batch of exported.file.batches as Array<Record<string, unknown>>) {
      expect(Object.keys(batch).sort()).toEqual(["boardId", "deletes", "signature", "updates"]);
      expect(batch.boardId).toBe(state.boardId);
    }
    expect(Object.keys(exported.file).sort()).toEqual(["batches", "format", "version"]);
    const [identity] = await county.admin`select private_key_envelope from federation_identity`;
    expect(JSON.stringify(exported.file)).not.toContain(String(identity!.private_key_envelope));
    const [exportAudit] = await county.admin`select payload from audit_events where category = 'federation.file_exported'`;
    expect(exportAudit!.payload).toEqual({ peer: "State OES", batches: exported.file.batches.length, entries: queued });
    // The entries stay waiting until the receipt comes back.
    expect(await waiting(county, stateAtCounty)).toBe(queued);

    const file = carry("county-to-state.json", exported.file);
    const imported = await importFile(state, countyAtState, file);
    expect(imported).toMatchObject({ batches: exported.file.batches.length, alreadyImported: 0, deleted: 1, conflicts: 0 });
    expect(await entriesOn(state)).toEqual({ [levee]: "county: levee breached" });
    const [received] = await state.admin`
      select payload ->> 'via' as via, payload ->> 'peer' as peer from audit_events where category = 'federation.received'`;
    expect(received).toEqual({ via: "file", peer: "County OES" });
    const status = await call(state, "GET", `/api/v1/jurisdictions/${state.jurisdictionId}/federation`, 200);
    expect(status.received[0]).toMatchObject({ peer: "County OES", byFile: true, deletes: 1 });

    // Importing the same file again changes nothing, and yields the same receipt.
    const before = await footprint(state);
    const again = await importFile(state, countyAtState, carry("county-to-state-again.json", exported.file));
    expect(again).toMatchObject({ alreadyImported: exported.file.batches.length, updates: 0, deleted: 0, conflicts: 0 });
    expect(again.receipt).toEqual(imported.receipt);
    expect(await footprint(state)).toEqual(before);

    // The receipt marks the county's entries delivered; a repeated receipt marks nothing more.
    const receipt = carry("state-receipt.json", imported.receipt);
    expect(await importReceipt(county, stateAtCounty, receipt))
      .toEqual({ batches: exported.file.batches.length, delivered: queued, alreadyDelivered: 0 });
    expect(await waiting(county, stateAtCounty)).toBe(0);
    const [receiptAudit] = await county.admin`select payload from audit_events where category = 'federation.receipt_imported'`;
    expect(receiptAudit!.payload).toEqual({ peer: "State OES", batches: exported.file.batches.length, delivered: queued });
    expect(await importReceipt(county, stateAtCounty, receipt))
      .toEqual({ batches: exported.file.batches.length, delivered: 0, alreadyDelivered: queued });

    // With nothing waiting there is nothing to export.
    const empty = await county.app.inject({ method: "POST", url: `/api/v1/peers/${stateAtCounty}/exchange/export`, headers: auth(county.adminToken) });
    expect(empty.statusCode).toBe(409);
    expect(empty.json().error).toBe("nothing is waiting for State OES on a shared board with a receiving board set");
  });

  it("carries the state's edits and deletes back to the county the same way", async () => {
    // The county's records arrived with their ids; the state edits one, deletes it again, and adds its own.
    const staged = await addEntry(state, "state: task force staged");
    await call(state, "PATCH", `/api/v1/boards/${state.boardId}/records/${staged}`, 200, { entry: "state: task force en route" });
    await call(state, "DELETE", `/api/v1/boards/${state.boardId}/records/${levee}`, 200);
    const queued = await waiting(state, countyAtState);
    expect(queued).toBeGreaterThanOrEqual(3);

    const exported = await exportFile(state, countyAtState);
    expect(exported.entries).toBe(queued);
    const imported = await importFile(county, stateAtCounty, carry("state-to-county.json", exported.file));
    expect(imported).toMatchObject({ alreadyImported: 0, deleted: 1 });
    expect(await entriesOn(county)).toEqual({ [staged]: "state: task force en route" });
    // What came from the state by file is not queued back to it.
    expect(await waiting(county, stateAtCounty)).toBe(0);

    const before = await footprint(county);
    expect(await importFile(county, stateAtCounty, carry("state-to-county-again.json", exported.file)))
      .toMatchObject({ alreadyImported: exported.file.batches.length, updates: 0, deleted: 0 });
    expect(await footprint(county)).toEqual(before);

    expect(await importReceipt(state, countyAtState, carry("county-receipt.json", imported.receipt)))
      .toMatchObject({ delivered: queued, alreadyDelivered: 0 });
    expect(await waiting(state, countyAtState)).toBe(0);
    // Both boards now agree.
    expect(await entriesOn(state)).toEqual(await entriesOn(county));
  });

  it("refuses a tampered file, a file for another partner or board, and anything but a batch file, applying nothing", async () => {
    await addEntry(county, "county: road 169 closed");
    const exported = await exportFile(county, stateAtCounty);
    const genuine = exported.file as { batches: Array<{ boardId: string; updates: string[]; deletes: string[]; signature: string }> };
    // Another partner on the state, with its own key and an agreement to write the state's board.
    const other = (await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, 201, { name: "Other OES" })).id as string;
    const otherKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    await call(state, "PUT", `/api/v1/peers/${other}/key`, 200, { publicKey: otherKey });
    await call(state, "POST", `/api/v1/peers/${other}/agreements`, 201, { boardId: state.boardId, canRead: false, canWrite: true });
    const unshared = (await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/boards`, 201, { templateKey: "activity_log" })).id as string;
    const before = await footprint(state);

    // Tampered: an update changed after signing.
    const tampered = { ...genuine, batches: [{ ...genuine.batches[0]!, updates: [update("forged: tampered")] }] };
    expect((await importFile(state, countyAtState, carry("tampered.json", tampered), 422)).error)
      .toBe("the batch signature does not verify under this peer's key");
    // Unsigned.
    const { signature: _dropped, ...unsigned } = genuine.batches[0]!;
    expect((await importFile(state, countyAtState, { ...genuine, batches: [unsigned] }, 422)).error).toBe("the batch is not signed");

    // For another partner: imported on the card of a partner whose key did not sign it.
    expect((await importFile(state, other, carry("wrong-partner.json", genuine), 422)).error)
      .toBe("the batch signature does not verify under this peer's key");

    // For a board the state does not share with the county, even behind a genuine batch: the file is refused whole.
    const wrongBoard = await signBatch(county.admin, unshared, [update("county: wrong board")], []);
    expect((await importFile(state, countyAtState, { ...genuine, batches: [...genuine.batches, wrongBoard] }, 403)).error)
      .toBe("no sharing agreement for that board");

    // A receipt where a batch file belongs, and a file that is not JSON of either kind.
    const receiptShaped = { format: "openeoc-federation-receipt", version: 1, batches: ["a".repeat(64)], signature: "x" };
    expect((await importFile(state, countyAtState, receiptShaped, 400)).error)
      .toBe("the file is not a federation batch file from Open Source EOC");
    expect((await importFile(state, countyAtState, { batches: "nothing" }, 400)).error)
      .toBe("the file is not a federation batch file from Open Source EOC");

    // No session, no import; a member cannot import, export or record a receipt.
    const anonymous = await state.app.inject({ method: "POST", url: `/api/v1/peers/${countyAtState}/exchange/import`, payload: genuine });
    expect(anonymous.statusCode).toBe(401);
    for (const [path, payload] of [["import", genuine], ["export", {}], ["receipt", receiptShaped]] as const) {
      const res = await state.app.inject({ method: "POST", url: `/api/v1/peers/${countyAtState}/exchange/${path}`,
        headers: auth(state.memberToken), payload });
      expect(res.statusCode, `${path}: ${res.body}`).toBe(403);
    }

    // None of that changed anything on the state; the genuine file still applies.
    expect(await footprint(state)).toEqual(before);
    await importFile(state, countyAtState, genuine);
    expect(Object.values(await entriesOn(state))).toContain("county: road 169 closed");
  });

  it("refuses a receipt that names batches never sent, a tampered receipt and one from another partner", async () => {
    await addEntry(county, "county: generator fueled");
    const exported = await exportFile(county, stateAtCounty);
    const { receipt } = await importFile(state, countyAtState, exported.file);
    const queued = await waiting(county, stateAtCounty);
    expect(queued).toBeGreaterThan(0);

    // Genuinely signed by the state, but naming a batch the county never put in a file.
    const stranger = "f".repeat(64);
    const unsent = { format: "openeoc-federation-receipt", version: 1, batches: [...receipt.batches, stranger],
      signature: await signReceipt(state.admin, [...receipt.batches, stranger]) };
    expect((await importReceipt(county, stateAtCounty, unsent, 409)).error)
      .toBe("the receipt names a batch this instance never sent to State OES");
    // A digest list changed after signing.
    expect((await importReceipt(county, stateAtCounty, { ...receipt, batches: [stranger] }, 422)).error)
      .toBe("the receipt signature does not verify under this peer's key");
    // The genuine receipt imported on the card of another partner.
    const other = (await call(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/peers`, 201, { name: "Other OES" })).id as string;
    await call(county, "PUT", `/api/v1/peers/${other}/key`, 200,
      { publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString() });
    expect((await importReceipt(county, other, receipt, 422)).error).toBe("the receipt signature does not verify under this peer's key");
    // A batch file where a receipt belongs.
    expect((await importReceipt(county, stateAtCounty, exported.file, 400)).error).toBe("the file is not a federation receipt from Open Source EOC");

    // Nothing was marked; the genuine receipt then marks them.
    expect(await waiting(county, stateAtCounty)).toBe(queued);
    expect(await importReceipt(county, stateAtCounty, receipt)).toMatchObject({ delivered: queued });
  });

  it("refuses a file for a revoked agreement, and exports nothing for one", async () => {
    await addEntry(county, "county: before revocation");
    const exported = await exportFile(county, stateAtCounty);
    // The state revokes the agreement that lets the county write its board.
    await call(state, "DELETE", `/api/v1/peers/${countyAtState}/agreements/${stateAgreement}`, 200);
    const before = await footprint(state);
    expect((await importFile(state, countyAtState, exported.file, 403)).error).toBe("no sharing agreement for that board");
    expect(await footprint(state)).toEqual(before);
    expect(Object.values(await entriesOn(state))).not.toContain("county: before revocation");

    // On the county, revoking drops what waited, so no file is made for the board.
    const agreement = (await call(county, "GET", `/api/v1/jurisdictions/${county.jurisdictionId}/federation`, 200))
      .peers.find((p: { id: string }) => p.id === stateAtCounty).boards[0].id as string;
    await call(county, "DELETE", `/api/v1/peers/${stateAtCounty}/agreements/${agreement}`, 200);
    await addEntry(county, "county: after revocation");
    const res = await county.app.inject({ method: "POST", url: `/api/v1/peers/${stateAtCounty}/exchange/export`, headers: auth(county.adminToken) });
    expect(res.statusCode).toBe(409);
  });
});
