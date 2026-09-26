import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signBatch } from "../federation/identity.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Signed peer identity (AG-03, ADR-0006). Two instances on separate databases
 * peer through the routes the Federation screen uses: each shows its Ed25519
 * public key, each records the other's, and each links the other for push.
 * Signed batches then flow both ways over HTTP; a forged batch is refused
 * before anything in it is applied; and revoking an agreement stops its
 * board's flow in both directions at once.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  baseUrl: string;
  jurisdictionId: string;
  adminToken: string;
  memberToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let priorKey: string | undefined;
/** On the county, the peer record for the state; the state presents `intoCounty` to push. */
let stateAtCounty: string, intoCounty: string;
/** On the state, the peer record for the county; the county presents `intoState` to push. */
let countyAtState: string, intoState: string;
let countyAgreement: string;

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "activity_log" } });
  return { admin, runtime, app, baseUrl, jurisdictionId: seed.jurisdictionId, adminToken, memberToken, boardId: board.json().id as string };
}

async function call(inst: Instance, method: "GET" | "POST" | "PUT" | "DELETE", url: string, status: number, payload?: object) {
  const res = await inst.app.inject({ method, url, headers: auth(inst.adminToken), ...(payload ? { payload } : {}) });
  expect(res.statusCode, res.body).toBe(status);
  return res.json();
}

async function federation(inst: Instance) {
  return call(inst, "GET", `/api/v1/jurisdictions/${inst.jurisdictionId}/federation`, 200);
}

async function addEntry(inst: Instance, entry: string): Promise<string> {
  return (await call(inst, "POST", `/api/v1/boards/${inst.boardId}/records`, 201, { entry })).id as string;
}

async function entriesOn(inst: Instance): Promise<string[]> {
  const rows = await inst.admin`
    select data ->> 'entry' as entry from board_records where board_id = ${inst.boardId} and deleted_at is null order by 1`;
  return rows.map((r) => r.entry as string);
}

function update(entry: string): string {
  const doc = new Y.Doc();
  doc.transact(() => doc.getMap("records").set(`${randomUUID()}/entry`, entry));
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

async function receive(inst: Instance, token: string, body: object) {
  return inst.app.inject({ method: "POST", url: "/api/v1/federation/receive", headers: { "x-peer-token": token }, payload: body });
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-federation-identity-key";
  county = await standUp();
  state = await standUp();
}, 120_000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("signed peer identity between two instances", () => {
  it("exchanges public keys, then delivers signed batches both ways", async () => {
    // Each instance shows its own key; the private half is stored only as an envelope.
    const countyKey = (await federation(county)).identity as { publicKey: string; fingerprint: string };
    const stateKey = (await federation(state)).identity as { publicKey: string; fingerprint: string };
    expect(countyKey.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(countyKey.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(countyKey.fingerprint).not.toBe(stateKey.fingerprint);
    expect((await federation(county)).identity).toEqual(countyKey);
    const [stored] = await county.admin`select count(*)::integer as n, min(private_key_envelope) as envelope from federation_identity`;
    expect(stored!.n).toBe(1);
    expect(String(stored!.envelope)).toMatch(/^v1:/);
    expect(String(stored!.envelope)).not.toContain("PRIVATE KEY");

    // Each registers the other and records the key the other showed.
    ({ id: stateAtCounty, token: intoCounty } = await call(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/peers`, 201, { name: "State OES" }));
    ({ id: countyAtState, token: intoState } = await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, 201, { name: "County OES" }));
    expect(await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/key`, 200, { publicKey: stateKey.publicKey }))
      .toEqual({ fingerprint: stateKey.fingerprint });
    await call(state, "PUT", `/api/v1/peers/${countyAtState}/key`, 200, { publicKey: countyKey.publicKey });
    const listed = (await federation(county)).peers.find((p: { id: string }) => p.id === stateAtCounty);
    expect(listed.keyFingerprint).toBe(stateKey.fingerprint);
    expect(JSON.stringify(await federation(county))).not.toContain(String(stored!.envelope));
    const [audit] = await county.admin`select payload from audit_events where category = 'federation.peer_key_set'`;
    expect(audit!.payload).toEqual({ peer: "State OES", fingerprint: stateKey.fingerprint });

    // A key that is not an Ed25519 public key is refused.
    expect((await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/key`, 400, { publicKey: "not a key" })).error)
      .toBe("the partner key is not a PEM public key");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect((await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/key`, 400, { publicKey: ec })).error)
      .toBe("the partner key must be an Ed25519 public key");

    // Each shares its board with the other, readable and writable, into the other's board, and links it.
    countyAgreement = (await call(county, "POST", `/api/v1/peers/${stateAtCounty}/agreements`, 201,
      { boardId: county.boardId, canRead: true, canWrite: true, remoteBoardId: state.boardId })).id as string;
    await call(state, "POST", `/api/v1/peers/${countyAtState}/agreements`, 201,
      { boardId: state.boardId, canRead: true, canWrite: true, remoteBoardId: county.boardId });
    await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/link`, 200, { endpointUrl: state.baseUrl, token: intoState });
    await call(state, "PUT", `/api/v1/peers/${countyAtState}/link`, 200, { endpointUrl: county.baseUrl, token: intoCounty });

    await addEntry(county, "county: levee watch");
    await addEntry(state, "state: task force staged");
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(1);
    expect((await new DeliveryWorker(state.runtime).drain()).federated).toBe(1);
    const both = ["county: levee watch", "state: task force staged"];
    expect(await entriesOn(county)).toEqual(both);
    expect(await entriesOn(state)).toEqual(both);
  });

  it("refuses a forged batch before applying anything in it", async () => {
    const genuine = await signBatch(county.admin, state.boardId, [update("county: genuine")], []);
    const receivedBefore = await state.admin`select count(*)::integer as n from audit_events where category = 'federation.received'`;

    // Unsigned.
    const unsigned = await receive(state, intoState, { boardId: state.boardId, updates: [update("forged: unsigned")] });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json().error).toBe("the batch is not signed");
    // A genuine signature over a changed batch.
    const tampered = await receive(state, intoState, { ...genuine, updates: [update("forged: tampered")] });
    expect(tampered.statusCode).toBe(401);
    expect(tampered.json().error).toBe("the batch signature does not verify under this peer's key");
    // A genuine batch aimed at another board than the one it was signed for.
    const other = (await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/boards`, 201, { templateKey: "activity_log" })).id as string;
    expect((await receive(state, intoState, { ...genuine, boardId: other })).statusCode).toBe(401);
    // Signed by an instance other than the one the token belongs to: the state's own key.
    const byAnother = await signBatch(state.admin, state.boardId, [update("forged: wrong key")], []);
    expect((await receive(state, intoState, byAnother)).statusCode).toBe(401);
    // A malformed signature.
    expect((await receive(state, intoState, { ...genuine, signature: "not-base64!" })).statusCode).toBe(401);
    // A peer whose key was never recorded delivers nothing, signed or not.
    const unkeyed = await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, 201, { name: "Unkeyed" });
    await call(state, "POST", `/api/v1/peers/${unkeyed.id as string}/agreements`, 201, { boardId: state.boardId, canRead: false, canWrite: true });
    const refused = await receive(state, unkeyed.token as string, genuine);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("no public key is recorded for this peer; record its key before it delivers");

    expect((await entriesOn(state)).filter((e) => e.startsWith("forged") || e === "county: genuine")).toEqual([]);
    const [receivedAfter] = await state.admin`select count(*)::integer as n from audit_events where category = 'federation.received'`;
    expect(receivedAfter!.n).toBe(receivedBefore[0]!.n);

    // The genuine batch is applied.
    expect((await receive(state, intoState, genuine)).statusCode).toBe(200);
    expect(await entriesOn(state)).toContain("county: genuine");
  });

  it("holds a push the partner cannot verify, and delivers it once the partner records the right key", async () => {
    const [countyKey] = await county.admin`select public_key from federation_identity`;
    const [stateKey] = await state.admin`select public_key from federation_identity`;
    // The state records the wrong key for the county: its own.
    await call(state, "PUT", `/api/v1/peers/${countyAtState}/key`, 200, { publicKey: stateKey!.public_key as string });
    await addEntry(county, "county: road 169 closed");
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(0);
    const [held] = await county.admin`
      select attempts, last_error from federation_outbox where peer_id = ${stateAtCounty} and delivered_at is null`;
    expect(held).toMatchObject({ attempts: 1, last_error: "peer responded 401" });
    expect(await entriesOn(state)).not.toContain("county: road 169 closed");

    await call(state, "PUT", `/api/v1/peers/${countyAtState}/key`, 200, { publicKey: countyKey!.public_key as string });
    await county.admin`update federation_outbox set next_attempt_at = now() where peer_id = ${stateAtCounty} and delivered_at is null`;
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(1);
    expect(await entriesOn(state)).toContain("county: road 169 closed");
  });

  it("stops a board's flow both ways when its agreement is revoked", async () => {
    // An edit waits for the state when the county revokes.
    await addEntry(county, "county: waiting at revocation");
    const member = await county.app.inject({ method: "DELETE", url: `/api/v1/peers/${stateAtCounty}/agreements/${countyAgreement}`,
      headers: auth(county.memberToken) });
    expect(member.statusCode).toBe(403);
    await call(county, "DELETE", `/api/v1/peers/${stateAtCounty}/agreements/${randomUUID()}`, 404);
    expect(await call(county, "DELETE", `/api/v1/peers/${stateAtCounty}/agreements/${countyAgreement}`, 200)).toEqual({ dropped: 1 });
    const [audit] = await county.admin`
      select subject_id, payload from audit_events where category = 'federation.agreement_revoked'`;
    expect(audit).toEqual({ subject_id: county.boardId, payload: { peer: "State OES", canRead: true, canWrite: true, dropped: 1 } });
    const peer = (await federation(county)).peers.find((p: { id: string }) => p.id === stateAtCounty);
    expect(peer.boards).toEqual([]);

    // County to state: nothing more is queued or pushed.
    await addEntry(county, "county: after revocation");
    const [queued] = await county.admin`
      select count(*)::integer as n from federation_outbox where peer_id = ${stateAtCounty} and delivered_at is null`;
    expect(queued!.n).toBe(0);
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(0);
    const atState = await entriesOn(state);
    expect(atState).not.toContain("county: waiting at revocation");
    expect(atState).not.toContain("county: after revocation");

    // State to county: the state still has its agreement and pushes, and the county refuses the board.
    await addEntry(state, "state: after revocation");
    expect((await new DeliveryWorker(state.runtime).drain()).federated).toBe(0);
    const [refused] = await state.admin`
      select last_error from federation_outbox where peer_id = ${countyAtState} and delivered_at is null`;
    expect(refused!.last_error).toBe("peer responded 403");
    expect(await entriesOn(county)).not.toContain("state: after revocation");
    const direct = await receive(county, intoCounty, await signBatch(state.admin, county.boardId, [update("state: direct")], []));
    expect(direct.statusCode).toBe(403);
    expect(direct.json().error).toBe("no sharing agreement for that board");

    // Sharing again is a new agreement, which sends the board as it stands.
    await call(county, "POST", `/api/v1/peers/${stateAtCounty}/agreements`, 201,
      { boardId: county.boardId, canRead: true, canWrite: false, remoteBoardId: state.boardId });
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(1);
    expect(await entriesOn(state)).toContain("county: after revocation");
  });
});
