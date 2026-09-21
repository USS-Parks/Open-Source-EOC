import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { withPerson } from "../db/context.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Incident-scoped board records (VEOC-79B1): a participant contributes records
 * to a board the incident uses, tagged with that incident, without changing
 * the board's source ownership; two incidents stay distinct; legacy records
 * are not silently assigned; outsiders and revoked grants fail.
 */

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string, outsiderOrg: string;
let partnerPersonId: string, outsiderPersonId: string;
let ownerToken: string, partnerToken: string, outsiderToken: string;
let incidentA: string, incidentB: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const eventData = (summary: string) => ({
  summary,
  occurred_at: "2026-09-20T10:00:00Z",
  severity: "critical",
});

async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return r.json().accessToken as string;
}
async function activate(name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "daily_ops", name } });
  expect(r.statusCode).toBe(201);
  return r.json().incidentId as string;
}
async function eventBoard(incidentId: string): Promise<string> {
  const [row] = await admin`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'significant_events'`;
  return row!.id as string;
}
const createRecord = (boardId: string, token: string, data: Record<string, unknown>, incidentId?: string) =>
  app.inject({ method: "POST",
    url: `/api/v1/boards/${boardId}/records${incidentId ? `?incidentId=${incidentId}` : ""}`,
    headers: auth(token), payload: data });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  outsiderOrg = await createJurisdiction(admin, "ridge-county", "Ridge County EOC");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  partnerPersonId = await createPerson(admin, { email: "coord@example.org", displayName: "Coordinator", password: "coord-good-password" });
  outsiderPersonId = await createPerson(admin, { email: "out@example.org", displayName: "Outsider", password: "outsider-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await addMembership(admin, outsiderPersonId, outsiderOrg, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city@example.org", "owner-good-password");
  partnerToken = await login("coord@example.org", "coord-good-password");
  outsiderToken = await login("out@example.org", "outsider-good-password");
  incidentA = await activate("Valley Response");
  incidentB = await activate("Separate Flood");
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("incident-scoped board records", () => {
  it("shares a participant's contribution to the incident, keeps ownership, and isolates", async () => {
    const boardA = await eventBoard(incidentA);
    const boardB = await eventBoard(incidentB);

    // An owner record with no incident stays jurisdiction-local, never silently
    // assigned to the open incident.
    const local = await createRecord(boardA, ownerToken, eventData("Local note"));
    expect(local.statusCode).toBe(201);
    const localId = local.json().id as string;
    expect((await admin`select incident_id from board_records where id = ${localId}`)[0]!.incident_id).toBeNull();

    // The partner joins incident A as a coordinator (a contributor).
    expect((await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentA}/participants`,
      headers: auth(ownerToken), payload: { organizationSlug: "valley-mutual-aid", personEmail: "coord@example.org",
        incidentPositionTitle: "Mutual Aid Liaison", role: "coordinator",
        expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: "Joint response" } })).statusCode).toBe(201);

    // The partner contributes a record to incident A's board. It is tagged with
    // the incident; the board's source ownership is unchanged.
    const shared = await createRecord(boardA, partnerToken, eventData("Partner field note"), incidentA);
    expect(shared.statusCode).toBe(201);
    const sharedId = shared.json().id as string;
    const [meta] = await admin`
      select r.incident_id, r.created_by, b.jurisdiction_id
      from board_records r join boards b on b.id = r.board_id where r.id = ${sharedId}`;
    expect(meta!.incident_id).toBe(incidentA);
    expect(meta!.created_by).toBe(partnerPersonId);
    expect(meta!.jurisdiction_id).toBe(ownerId); // source ownership unchanged

    // The partner can read the incident record and the incident board, but not
    // the owner's jurisdiction-local record.
    expect(await withPerson(runtime, partnerPersonId, (tx) =>
      tx`select id from board_records where id = ${sharedId}`)).toHaveLength(1);
    expect(await withPerson(runtime, partnerPersonId, (tx) =>
      tx`select id from boards where id = ${boardA}`)).toHaveLength(1);
    expect(await withPerson(runtime, partnerPersonId, (tx) =>
      tx`select id from board_records where id = ${localId}`)).toHaveLength(0);

    // Isolation: the partner is not in incident B and cannot contribute there.
    expect((await createRecord(boardB, partnerToken, eventData("B note"), incidentB)).statusCode).toBe(404);
    // An outsider organization cannot contribute to incident A.
    expect((await createRecord(boardA, outsiderToken, eventData("Outsider note"), incidentA)).statusCode).toBe(404);
    // A jurisdiction writer cannot tag a record into an incident whose boards
    // do not include this board (boardB belongs to B, not A).
    expect((await createRecord(boardB, ownerToken, eventData("Wrong incident"), incidentA)).statusCode).toBe(400);

    // Revoking the partner ends contribution and read access at once.
    const participantId = (await admin`
      select id from incident_participants where incident_id = ${incidentA} and person_id = ${partnerPersonId}`)[0]!.id as string;
    expect((await app.inject({ method: "POST",
      url: `/api/v1/incidents/${incidentA}/participants/${participantId}/revoke`,
      headers: auth(ownerToken), payload: { reason: "Ended" } })).statusCode).toBe(200);
    expect((await createRecord(boardA, partnerToken, eventData("After revoke"), incidentA)).statusCode).toBe(404);
    expect(await withPerson(runtime, partnerPersonId, (tx) =>
      tx`select id from board_records where id = ${sharedId}`)).toHaveLength(0);
  });
});
