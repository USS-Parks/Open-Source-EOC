import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The cross-boundary incident exercise, continued on real PostgreSQL. One
 * owner and one partner organization work a wildfire while a second incident
 * runs alongside. Resource requests on both sides stay tied to the incident;
 * the partner's onboarded dataset reconciles between the COP layer, the impact
 * indicator and a direct count; a partner field report queued offline keeps
 * its author, organization and position through reconnect; and a record
 * federated to a peer instance is attributed there to the sending instance.
 * The second incident sees none of it.
 */

interface Peer {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  jurisdictionId: string;
  adminToken: string;
  boardId: string;
}

let admin: Sql, runtime: Sql, app: FastifyInstance, host: string, peer: Peer;
let ownerId: string, partnerId: string, partnerPersonId: string, partnerPositionId: string;
let ownerToken: string, partnerToken: string;
let incidentA: string, incidentB: string, roadBoardA: string, participantId: string;
let dashboardId: string, datasetId: string, reportId: string, engineId: string;
let peerIdAtOwner: string, tokenIntoPeer: string;

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const point = (longitude: number, latitude: number) => ({ type: "Point", coordinates: [longitude, latitude] });
const AREA_BBOX = [-124.3, 40.6, -123.8, 41.1] as const;

function send(token: string, method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload }) });
}

async function expectJson(
  token: string, method: "GET" | "POST" | "PUT", url: string, status: number, payload?: Record<string, unknown>,
) {
  const response = await send(token, method, url, payload);
  expect(response.statusCode, response.body).toBe(status);
  return response.json();
}

function widget(snapshot: { widgets: Array<{ key: string; value?: unknown }> }, key: string) {
  return snapshot.widgets.find((candidate) => candidate.key === key)!;
}

/**
 * A field device that keeps its edits while offline, queued with an operation
 * id, and sends them over the incident-scoped sync socket on reconnect, the
 * same protocol as the browser field client. An operation leaves the queue
 * only when the server acknowledges it.
 */
class OfflineFieldDevice {
  private readonly doc = new Y.Doc();
  readonly queue: Array<{ operationId: string; update: Uint8Array }> = [];

  edit(recordId: string, fields: Record<string, unknown>): void {
    const records = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) records.set(`${recordId}/${key}`, value);
    });
    this.queue.push({ operationId: randomUUID(), update: Y.encodeStateAsUpdate(this.doc) });
  }

  reconnect(boardId: string, incidentId: string, token: string): Promise<{ operationId: string; exact: boolean; conflicts: number }> {
    const operation = this.queue[0]!;
    const socket = new WebSocket(`ws://${host}/api/v1/sync/boards/${boardId}?incidentId=${incidentId}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sync timeout")), 15_000);
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as {
          type: string; update?: string; operationId?: string; exact?: boolean; conflicts?: number;
          code?: string; error?: string;
        };
        if (message.type === "state") {
          Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(message.update!, "base64")));
          socket.send(JSON.stringify({
            type: "update", operationId: operation.operationId, incidentId,
            update: Buffer.from(operation.update).toString("base64"),
          }));
        } else if (message.type === "synced") {
          clearTimeout(timer);
          socket.close();
          this.queue.shift();
          resolve({ operationId: message.operationId!, exact: message.exact!, conflicts: message.conflicts! });
        } else if (message.type === "error") {
          clearTimeout(timer);
          socket.close();
          reject(new Error(`${message.code}:${message.error}`));
        }
      });
    });
  }
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  partnerPersonId = await createPerson(admin, { email: "coord@example.org", displayName: "Aid Coordinator", password: "coord-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  // The partner acts in a position of its own organization.
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${partnerId}, 'aid_field_observer', 'Aid Field Observer') returning id`;
  partnerPositionId = position!.id as string;
  await admin`insert into position_assignments (position_id, person_id, assigned_by)
    values (${partnerPositionId}, ${partnerPersonId}, ${partnerPersonId})`;
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  ownerToken = await tokenFor(app, "city@example.org", "owner-good-password");
  partnerToken = await tokenFor(app, "coord@example.org", "coord-good-password");
  await expectJson(partnerToken, "POST", `/api/v1/positions/${partnerPositionId}/sign-in`, 200);

  // A separate instance, the state's, with its own database and a board to receive into.
  const peerDb = await freshDb();
  const peerSeed = await seedIdentity(peerDb.admin);
  await ensureStandardTemplates(peerDb.admin);
  const peerApp = buildApp(peerDb.runtime, { oidc: null });
  await peerApp.ready();
  const peerAdminToken = await tokenFor(peerApp, "admin@example.org", "correct-horse-battery");
  const peerBoard = await peerApp.inject({ method: "POST", url: `/api/v1/jurisdictions/${peerSeed.jurisdictionId}/boards`,
    headers: auth(peerAdminToken), payload: { templateKey: "road_closures" } });
  expect(peerBoard.statusCode, peerBoard.body).toBe(201);
  peer = { ...peerDb, app: peerApp, jurisdictionId: peerSeed.jurisdictionId, adminToken: peerAdminToken,
    boardId: peerBoard.json().id as string };
}, 120_000);

afterAll(async () => {
  for (const instance of [app, peer?.app]) await instance?.close();
  for (const sql of [runtime, admin, peer?.runtime, peer?.admin]) await sql?.end();
});

describe("cross-boundary incident exercise: resources, COP and KPIs, attribution", () => {
  it("activates two incidents, expands the first, onboards the partner to it alone and shares its closures board", async () => {
    const activate = async (name: string) => (await expectJson(ownerToken, "POST",
      `/api/v1/jurisdictions/${ownerId}/incidents`, 201, { templateKey: "wildfire", name })).incidentId as string;
    incidentA = await activate("Valley Complex Fire");
    incidentB = await activate("Separate Flood");
    await expectJson(ownerToken, "PUT", `/api/v1/incidents/${incidentA}/operational-area`, 200, {
      expectedRevision: 0, geometry: polygon(...AREA_BBOX), operationalPeriod: null, reason: "Initial fire perimeter" });
    const grant = await expectJson(ownerToken, "POST", `/api/v1/incidents/${incidentA}/participants`, 201, {
      organizationSlug: "valley-mutual-aid", personEmail: "coord@example.org", incidentPositionTitle: "Mutual Aid Liaison",
      role: "coordinator", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Joint response" });
    participantId = grant.participant.id as string;
    expect((await send(partnerToken, "GET", `/api/v1/incidents/${incidentA}`)).statusCode).toBe(200);
    expect((await send(partnerToken, "GET", `/api/v1/incidents/${incidentB}`)).statusCode).toBe(404);

    const [board] = await admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${incidentA} and b.template_key = 'road_closures'`;
    roadBoardA = board!.id as string;
    dashboardId = (await expectJson(ownerToken, "POST", `/api/v1/jurisdictions/${ownerId}/dashboards`, 201,
      { templateKey: "eoc_status" })).id as string;

    // The owner shares the incident's closures board with the state before any field work.
    const registered = await expectJson(ownerToken, "POST", `/api/v1/jurisdictions/${ownerId}/peers`, 201, { name: "State OES" });
    peerIdAtOwner = registered.id as string;
    await expectJson(ownerToken, "POST", `/api/v1/peers/${peerIdAtOwner}/agreements`, 201,
      { boardId: roadBoardA, canRead: true, canWrite: false });
    const intoPeer = await peer.app.inject({ method: "POST", url: `/api/v1/jurisdictions/${peer.jurisdictionId}/peers`,
      headers: auth(peer.adminToken), payload: { name: "Valley City EOC" } });
    tokenIntoPeer = intoPeer.json().token as string;
    const peerAgreement = await peer.app.inject({ method: "POST", url: `/api/v1/peers/${intoPeer.json().id as string}/agreements`,
      headers: auth(peer.adminToken), payload: { boardId: peer.boardId, canRead: true, canWrite: true } });
    expect(peerAgreement.statusCode, peerAgreement.body).toBe(201);
  });

  it("reconciles the partner's onboarded dataset across the COP layer, the impact indicator and a direct count", async () => {
    await expectJson(partnerToken, "POST", `/api/v1/incidents/${incidentA}/data-packs`, 201, {
      name: "Mutual aid shelters", organizationSlug: "valley-mutual-aid",
      datasets: [{ key: "statewide_shelters", name: "Mutual aid shelters", kind: "geojson",
        coverage: polygon(-125, 32, -114, 42.1), fieldMapping: { title: "name", sourceId: "id", geometry: "geometry" } }] });
    const listed = await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentA}/datasets`, 200);
    datasetId = (listed.datasets as Array<{ id: string; key: string }>).find((d) => d.key === "statewide_shelters")!.id;
    const loaded = await expectJson(partnerToken, "POST", `/api/v1/data-packs/datasets/${datasetId}/load`, 200, { records: [
      { id: "shelter-fortuna", name: "Fortuna Veterans Hall", geometry: point(-124.1, 40.8) },
      { id: "shelter-rio-dell", name: "Rio Dell Fire Hall", geometry: point(-124.0, 40.95) },
      { id: "shelter-cal-expo", name: "Cal Expo", geometry: point(-121.4, 38.6) },
    ] });
    expect(loaded.result).toMatchObject({ accepted: 3, itemCount: 3, availability: "available" });

    // A direct count: the partner's items inside the incident's current area.
    const [direct] = await admin`
      select count(*)::int as n from data_pack_items i
      join incident_area_revisions a on a.incident_id = i.incident_id
      where i.dataset_id = ${datasetId}
        and a.revision = (select max(revision) from incident_area_revisions where incident_id = ${incidentA})
        and ST_Intersects(i.geom, a.geometry)`;
    expect(direct!.n).toBe(2);

    // The COP layer holds every item; clipped to the incident area it holds the counted ones.
    const layer = await expectJson(ownerToken, "GET", `/api/v1/datasets/${datasetId}/items`, 200);
    expect((layer.features as Array<{ id: string }>).map((f) => f.id))
      .toEqual(["shelter-cal-expo", "shelter-fortuna", "shelter-rio-dell"]);
    const clipped = await expectJson(ownerToken, "GET", `/api/v1/datasets/${datasetId}/items?bbox=${AREA_BBOX.join(",")}`, 200);
    expect((clipped.features as Array<{ id: string }>).map((f) => f.id)).toEqual(["shelter-fortuna", "shelter-rio-dell"]);

    // The impact indicator reports the same count and names the partner's dataset as its source.
    const shelters = (await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentA}/impact`, 200)).impact.categories.shelters;
    expect(shelters).toMatchObject({ value: direct!.n, coverage: "complete", reason: null });
    expect(shelters.sources).toEqual([expect.objectContaining({ datasetId, value: direct!.n, contributingRecords: direct!.n })]);
    expect((await expectJson(partnerToken, "GET", `/api/v1/incidents/${incidentA}/impact`, 200))
      .impact.categories.shelters.value).toBe(direct!.n);

    // The second incident has no dataset, no layer and no count from it.
    expect((await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentB}/datasets`, 200)).datasets).toEqual([]);
    const impactB = (await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentB}/impact`, 200)).impact;
    expect(impactB.categories.shelters.value).toBeNull();
    expect(JSON.stringify(impactB)).not.toContain(datasetId);
    expect((await send(partnerToken, "GET", `/api/v1/incidents/${incidentB}/impact`)).statusCode).toBe(404);
  });

  it("keeps the author, organization and position of a partner field report queued offline and synced on reconnect", async () => {
    const device = new OfflineFieldDevice();
    reportId = randomUUID();
    device.edit(reportId, { road: "SR-36 at Bridgeville", reason: "Fire across the roadway", status: "closed",
      location: point(-124.05, 40.85) });
    expect(await admin`select id from board_records where id = ${reportId}`).toHaveLength(0);

    const ack = await device.reconnect(roadBoardA, incidentA, partnerToken);
    expect(ack).toMatchObject({ exact: true, conflicts: 0 });
    expect(device.queue).toHaveLength(0);

    // The server of record keeps the author and the position the partner acted in, in its own organization.
    const [stored] = await admin`
      select r.incident_id, r.created_by, r.created_by_position, p.jurisdiction_id as position_organization
      from board_records r left join positions p on p.id = r.created_by_position where r.id = ${reportId}`;
    expect(stored).toMatchObject({ incident_id: incidentA, created_by: partnerPersonId,
      created_by_position: partnerPositionId, position_organization: partnerId });
    const [origin] = await admin`select origin_person, origin_position from sync_updates where operation_id = ${ack.operationId}`;
    expect(origin).toMatchObject({ origin_person: partnerPersonId, origin_position: partnerPositionId });
    const [created] = await admin`
      select person_id, position_id, incident_id, payload ->> 'via' as via from audit_events
      where subject_id = ${reportId} and category = 'board.record.created'`;
    expect(created).toMatchObject({ person_id: partnerPersonId, position_id: partnerPositionId, incident_id: incidentA, via: "sync" });

    // The owner reads the report as the partner's; the incident roster names the partner's organization
    // and incident position; the partner's own read names the position it acted in.
    const detailUrl = `/api/v1/boards/${roadBoardA}/records/${reportId}/detail?incidentId=${incidentA}`;
    expect((await expectJson(ownerToken, "GET", detailUrl, 200)).createdBy)
      .toMatchObject({ personId: partnerPersonId, displayName: "Aid Coordinator", positionId: partnerPositionId });    const roster = (await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentA}/participants`, 200)).participants;
    expect((roster as Array<{ personId: string }>).find((p) => p.personId === partnerPersonId))
      .toMatchObject({ organizationName: "Valley Mutual Aid", incidentPositionTitle: "Mutual Aid Liaison" });
    expect((await expectJson(partnerToken, "GET", detailUrl, 200)).createdBy.positionTitle).toBe("Aid Field Observer");

    // The report is the incident's field impact: the scoped dashboard counts it, reconciled against a
    // direct count, and the second incident's does not.
    const [closures] = await admin`
      select count(*)::int as n from board_records
      where board_id = ${roadBoardA} and incident_id = ${incidentA} and data ->> 'status' = 'closed'`;
    expect(closures!.n).toBe(1);
    expect(widget(await expectJson(ownerToken, "GET", `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentA}`, 200),
      "closed_roads").value).toBe(closures!.n);
    expect(widget(await expectJson(ownerToken, "GET", `/api/v1/dashboards/${dashboardId}/data?incidentId=${incidentB}`, 200),
      "closed_roads").value).toBe(0);
  });

  it("ties resource requests from both organizations to the incident and keeps them out of the second", async () => {
    // The owner requests an engine on the incident and names the partner's participant as the supplier.
    engineId = (await expectJson(ownerToken, "POST", `/api/v1/jurisdictions/${ownerId}/resource-requests`, 201,
      { origin: "eoc", item: "Engine strike team", quantity: 1, priority: "immediate", incidentId: incidentA })).id as string;
    for (const toState of ["triaged", "sourcing"]) {
      await expectJson(ownerToken, "POST", `/api/v1/resource-requests/${engineId}/transition`, 200, { toState });
    }
    await expectJson(ownerToken, "POST", `/api/v1/resource-requests/${engineId}/assign`, 200,
      { kind: "incident_participant", incidentId: incidentA, participantId });
    const engine = await expectJson(ownerToken, "GET", `/api/v1/resource-requests/${engineId}`, 200);
    expect(engine).toMatchObject({
      incidentId: incidentA, state: "assigned",
      receivingOrganization: { id: ownerId, name: "Valley City EOC" },
      supplyingOrganization: { id: partnerId, name: "Valley Mutual Aid" },
      assignment: { kind: "incident_participant", personName: "Aid Coordinator", incidentPositionTitle: "Mutual Aid Liaison" },
    });
    expect(engine.chronology.at(-1)).toMatchObject({ toState: "assigned", by: "City Admin", note: "assigned to Mutual Aid Liaison" });

    // The partner requests cots on the same incident; its own organization receives that request.
    const cotsId = (await expectJson(partnerToken, "POST", `/api/v1/jurisdictions/${partnerId}/resource-requests`, 201,
      { origin: "field", item: "Cots", quantity: 200, incidentId: incidentA })).id as string;
    expect(await expectJson(partnerToken, "GET", `/api/v1/resource-requests/${cotsId}`, 200))
      .toMatchObject({ incidentId: incidentA, receivingOrganization: { id: partnerId }, chronology: [{ by: "Aid Coordinator" }] });
    expect((await send(partnerToken, "POST", `/api/v1/jurisdictions/${partnerId}/resource-requests`,
      { origin: "field", item: "Cots", incidentId: incidentB })).statusCode).toBe(404);

    const items = async (token: string, jurisdictionId: string, incidentId: string) =>
      ((await expectJson(token, "GET", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests?incidentId=${incidentId}`, 200))
        .requests as Array<{ item: string }>).map((request) => request.item);
    expect(await items(ownerToken, ownerId, incidentA)).toEqual(["Engine strike team"]);
    expect(await items(partnerToken, partnerId, incidentA)).toEqual(["Cots"]);
    expect(await items(ownerToken, ownerId, incidentB)).toEqual([]);
  });

  it("federates a record outside the incident to the state with attribution, and never the partner's incident report", async () => {
    const orick = (await expectJson(ownerToken, "POST", `/api/v1/boards/${roadBoardA}/records`, 201,
      { road: "US-101 at Orick", reason: "Bridge inspection", status: "one_lane" })).id as string;
    const pending = (await expectJson(ownerToken, "GET", `/api/v1/peers/${peerIdAtOwner}/pending`, 200))
      .pending as Array<{ updateBase64: string }>;
    expect(pending).toHaveLength(1);
    const delivered = await peer.app.inject({ method: "POST", url: "/api/v1/federation/receive",
      headers: { "x-peer-token": tokenIntoPeer }, payload: { boardId: peer.boardId, updates: pending.map((e) => e.updateBase64) } });
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.json()).toMatchObject({ applied: 1, conflicts: 0 });

    // At the state: the same record, whole, and an audit trail that names the sending instance.
    const atPeer = await peer.admin`select id, data ->> 'road' as road from board_records where board_id = ${peer.boardId}`;
    expect(atPeer.map((row) => ({ id: row.id, road: row.road }))).toEqual([{ id: orick, road: "US-101 at Orick" }]);
    const [received] = await peer.admin`
      select payload from audit_events where category = 'federation.received' and subject_id = ${peer.boardId}`;
    expect(received!.payload).toMatchObject({ peer: "Valley City EOC", updates: 1, conflicts: 0 });
    // At the origin the record keeps its author.
    expect((await expectJson(ownerToken, "GET", `/api/v1/boards/${roadBoardA}/records/${orick}/detail`, 200)).createdBy)
      .toMatchObject({ displayName: "City Admin" });
    expect(await peer.admin`select id from board_records where id = ${reportId}`).toHaveLength(0);
  });

  it("publishes the plan, revokes the partner at once with attribution kept, and closes the first incident alone", async () => {
    expect((await send(ownerToken, "POST", `/api/v1/incidents/${incidentA}/iap`, { operationalPeriod: "OP 1" })).statusCode).toBe(201);

    await expectJson(ownerToken, "POST", `/api/v1/incidents/${incidentA}/participants/${participantId}/revoke`, 200,
      { reason: "Assignment ended" });
    expect((await send(partnerToken, "GET", `/api/v1/incidents/${incidentA}`)).statusCode).toBe(404);
    expect((await send(partnerToken, "POST", `/api/v1/jurisdictions/${partnerId}/resource-requests`,
      { origin: "field", item: "Water", incidentId: incidentA })).statusCode).toBe(404);
    const late = new OfflineFieldDevice();
    late.edit(randomUUID(), { road: "Late report", reason: "Queued after the assignment ended", status: "closed" });
    await expect(late.reconnect(roadBoardA, incidentA, partnerToken)).rejects.toThrow(/^auth_required:/);
    expect(late.queue).toHaveLength(1);
    expect((await expectJson(ownerToken, "GET",
      `/api/v1/boards/${roadBoardA}/records/${reportId}/detail?incidentId=${incidentA}`, 200)).createdBy)
      .toMatchObject({ personId: partnerPersonId, displayName: "Aid Coordinator" });
    const roster = (await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentA}/participants`, 200)).participants;
    expect((roster as Array<{ personId: string; revokedAt: string | null }>).find((p) => p.personId === partnerPersonId))
      .toMatchObject({ organizationName: "Valley Mutual Aid", incidentPositionTitle: "Mutual Aid Liaison", revokedAt: expect.any(String) });

    expect((await send(ownerToken, "POST", `/api/v1/incidents/${incidentA}/close`)).statusCode).toBe(200);
    const frozen = await send(ownerToken, "POST", `/api/v1/resource-requests/${engineId}/transition`, { toState: "deployed" });
    expect(frozen.statusCode, frozen.body).toBe(409);
    expect((await expectJson(ownerToken, "GET", `/api/v1/incidents/${incidentB}`, 200)).closedAt).toBeNull();
    expect((await send(partnerToken, "GET", `/api/v1/incidents/${incidentB}`)).statusCode).toBe(404);
  });
});
