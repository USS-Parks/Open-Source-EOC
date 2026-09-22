import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

interface Ack {
  type: "synced";
  operationId: string | null;
  seq: number;
  conflicts: number;
  exact: boolean;
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let baseUrl: string;
let boardId: string;
let incidentId: string;
let otherIncidentId: string;
let jurisdictionId: string;
let adminToken: string;
let memberToken: string;
let memberId: string;
let partnerToken: string;
let partnerPersonId: string;
let partnerParticipantId: string;
let restSeedRecordId: string;
const OTHER_INCIDENT_RECORD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function post(token: string, url: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

class ExactClient {
  readonly doc = new Y.Doc();
  private socket: WebSocket | null = null;
  private awaiting: {
    resolve: (ack: Ack) => void;
    reject: (error: Error) => void;
  } | null = null;

  async connect(token = memberToken, joinedIncidentId = incidentId): Promise<void> {
    const socket = new WebSocket(
      `ws://${baseUrl}/api/v1/sync/boards/${boardId}?incidentId=${joinedIncidentId}`,
    );
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as {
          type: string;
          operationId?: string | null;
          seq?: number;
          conflicts?: number;
          exact?: boolean;
          update?: string;
          code?: string;
          error?: string;
        };
        if (message.type === "state") {
          Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(message.update!, "base64")));
          resolve();
        } else if (message.type === "synced") {
          this.awaiting?.resolve(message as Ack);
          this.awaiting = null;
        } else if (message.type === "error") {
          this.awaiting?.reject(new Error(`${message.code}:${message.error}`));
          this.awaiting = null;
          reject(new Error(`${message.code}:${message.error}`));
        }
      });
    });
  }

  edit(recordId: string, fields: Record<string, unknown>): Uint8Array {
    const records = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) records.set(`${recordId}/${key}`, value);
    });
    return Y.encodeStateAsUpdate(this.doc);
  }

  send(update: Uint8Array, operationId: string, scopedIncidentId = incidentId): Promise<Ack> {
    return new Promise<Ack>((resolve, reject) => {
      this.awaiting = { resolve, reject };
      this.socket!.send(JSON.stringify({
        type: "update",
        operationId,
        incidentId: scopedIncidentId,
        update: Buffer.from(update).toString("base64"),
      }));
    });
  }

  close(): void {
    this.socket?.close();
  }
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  memberId = seed.memberId;
  const partnerJurisdictionId = await createJurisdiction(admin, "sync-partner", "Sync Partner");
  partnerPersonId = await createPerson(admin, {
    email: "sync-partner@example.org",
    displayName: "Sync Partner Operator",
    password: "sync-partner-password",
  });
  await addMembership(admin, partnerPersonId, partnerJurisdictionId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");
  partnerToken = await login("sync-partner@example.org", "sync-partner-password");
  boardId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "significant_events" },
  )).id as string;
  incidentId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name: "Continuity Primary" },
  )).incidentId as string;
  otherIncidentId = (await post(
    adminToken,
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name: "Continuity Other" },
  )).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values
    (${incidentId}, ${boardId}), (${otherIncidentId}, ${boardId})`;
  restSeedRecordId = (await post(
    adminToken,
    `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
    {
      summary: "REST-seeded incident record",
      occurred_at: "2026-09-21T18:30:00Z",
      severity: "warning",
    },
  )).id as string;
  const participant = await post(
    adminToken,
    `/api/v1/incidents/${incidentId}/participants`,
    {
      organizationSlug: "sync-partner",
      personEmail: "sync-partner@example.org",
      incidentPositionTitle: "Field Intelligence",
      role: "contributor",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: "Continuity proof",
    },
  );
  partnerParticipantId = (participant.participant as { id: string }).id;
  await admin`insert into board_records (id, board_id, incident_id, data, created_by)
    values (${OTHER_INCIDENT_RECORD_ID}, ${boardId}, ${otherIncidentId}, ${admin.json({
      summary: "Other incident only",
      occurred_at: "2026-09-21T19:00:00Z",
      severity: "info",
    })}, ${memberId})`;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("exact board continuity receipts", () => {
  it("deduplicates retries, rejects changed payload or scope, and retains conflicts", async () => {
    const seededOperationId = randomUUID();
    const seededClient = new ExactClient();
    await seededClient.connect();
    expect(seededClient.doc.getMap("records").get(`${restSeedRecordId}/summary`))
      .toBe("REST-seeded incident record");
    const seededUpdate = seededClient.edit(restSeedRecordId, {
      details: "Edited through the exact continuity stream",
    });
    expect(await seededClient.send(seededUpdate, seededOperationId)).toMatchObject({
      operationId: seededOperationId,
      conflicts: 0,
    });
    seededClient.close();
    expect((await admin`select data->>'details' as details from board_records
      where id = ${restSeedRecordId}`)[0]!.details)
      .toBe("Edited through the exact continuity stream");

    const recordId = randomUUID();
    const operationId = randomUUID();
    const client = new ExactClient();
    await client.connect();
    expect(client.doc.getMap("records").get(`${OTHER_INCIDENT_RECORD_ID}/summary`)).toBeUndefined();
    const update = client.edit(recordId, {
      summary: "Offline field report",
      occurred_at: "2026-09-21T20:00:00Z",
      severity: "warning",
    });
    const first = await client.send(update, operationId);
    expect(first).toMatchObject({ operationId, conflicts: 0, exact: true });
    expect((await admin`select incident_id from board_records where id = ${recordId}`)[0]!.incident_id)
      .toBe(incidentId);
    expect(await client.send(update, operationId)).toEqual(first);
    const changed = client.edit(recordId, { details: "changed after receipt" });
    await expect(client.send(changed, operationId)).rejects.toThrow(/^conflict:/);
    client.close();

    const wrongScope = new ExactClient();
    await wrongScope.connect();
    await expect(wrongScope.send(update, operationId, otherIncidentId)).rejects.toThrow(/^conflict:/);
    wrongScope.close();
    const [counts] = await admin`
      select
        (select count(*)::int from sync_updates where operation_id = ${operationId}) as receipts,
        (select count(*)::int from audit_events where subject_id = ${recordId}) as audits`;
    expect(counts).toMatchObject({ receipts: 1, audits: 1 });

    const badRecordId = randomUUID();
    const badOperationId = randomUUID();
    const badClient = new ExactClient();
    await badClient.connect();
    const badUpdate = badClient.edit(badRecordId, {
      summary: "Invalid offline report",
      occurred_at: "2026-09-21T20:30:00Z",
      severity: "catastrophic",
    });
    const conflict = await badClient.send(badUpdate, badOperationId);
    expect(conflict).toMatchObject({ operationId: badOperationId, conflicts: 1, exact: true });
    expect(await badClient.send(badUpdate, badOperationId)).toEqual(conflict);
    const [conflictCounts] = await admin`
      select
        (select count(*)::int from sync_updates where operation_id = ${badOperationId}) as receipts,
        (select count(*)::int from sync_conflicts where record_id = ${badRecordId}) as conflicts,
        (select count(*)::int from audit_events
          where category = 'sync.conflict' and subject_id = ${badRecordId}) as audits`;
    expect(conflictCounts).toMatchObject({ receipts: 1, conflicts: 1, audits: 1 });
    badClient.close();

    const otherBoardId = (await post(
      adminToken,
      `/api/v1/jurisdictions/${jurisdictionId}/boards`,
      { templateKey: "significant_events" },
    )).id as string;
    await admin`insert into incident_boards (incident_id, board_id)
      values (${incidentId}, ${otherBoardId})`;
    const foreignRecordId = randomUUID();
    await admin`insert into board_records (id, board_id, data, created_by)
      values (${foreignRecordId}, ${otherBoardId}, ${admin.json({
        summary: "Belongs to the other board",
        occurred_at: "2026-09-21T21:00:00Z",
        severity: "info",
      })}, ${memberId})`;
    const collisionOperationId = randomUUID();
    const collision = new ExactClient();
    await collision.connect();
    const collisionUpdate = collision.edit(foreignRecordId, {
      summary: "Must not overwrite the other board",
      occurred_at: "2026-09-21T21:00:00Z",
      severity: "warning",
    });
    await expect(collision.send(collisionUpdate, collisionOperationId))
      .rejects.toThrow(/^conflict:/);
    collision.close();
    const [foreignAfter] = await admin`
      select board_id, data->>'summary' as summary from board_records where id = ${foreignRecordId}`;
    expect(foreignAfter).toMatchObject({
      board_id: otherBoardId,
      summary: "Belongs to the other board",
    });
    expect((await admin`select count(*)::int as count from sync_updates
      where operation_id = ${collisionOperationId}`)[0]!.count).toBe(0);

    const otherScope = new ExactClient();
    await otherScope.connect(memberToken, otherIncidentId);
    expect(otherScope.doc.getMap("records").get(`${recordId}/summary`)).toBeUndefined();
    const projectionOperationId = randomUUID();
    const projection = otherScope.edit(recordId, {
      summary: "Cross-incident projection must fail",
      occurred_at: "2026-09-21T21:15:00Z",
      severity: "warning",
    });
    await expect(otherScope.send(projection, projectionOperationId, otherIncidentId))
      .rejects.toThrow(/^conflict:/);
    otherScope.close();
    expect((await admin`select count(*)::int as count from sync_updates
      where operation_id = ${projectionOperationId}`)[0]!.count).toBe(0);
    expect((await admin`select data->>'summary' as summary from board_records
      where id = ${recordId}`)[0]!.summary).toBe("Offline field report");

    const partnerRecordId = randomUUID();
    const partnerOperationId = randomUUID();
    const partner = new ExactClient();
    await partner.connect(partnerToken, incidentId);
    expect(partner.doc.getMap("records").get(`${OTHER_INCIDENT_RECORD_ID}/summary`)).toBeUndefined();
    const partnerUpdate = partner.edit(partnerRecordId, {
      summary: "Partner incident field report",
      occurred_at: "2026-09-21T21:30:00Z",
      severity: "warning",
    });
    expect(await partner.send(partnerUpdate, partnerOperationId)).toMatchObject({
      operationId: partnerOperationId,
      exact: true,
    });
    const partnerConflictRecordId = randomUUID();
    const partnerConflictOperationId = randomUUID();
    const partnerConflictUpdate = partner.edit(partnerConflictRecordId, {
      summary: "Partner invalid report",
      occurred_at: "2026-09-21T21:35:00Z",
      severity: "catastrophic",
    });
    expect(await partner.send(partnerConflictUpdate, partnerConflictOperationId)).toMatchObject({
      operationId: partnerConflictOperationId,
      conflicts: 1,
      exact: true,
    });
    partner.close();
    expect((await admin`select incident_id, created_by from board_records
      where id = ${partnerRecordId}`)[0]).toMatchObject({
      incident_id: incidentId,
      created_by: partnerPersonId,
    });
    expect((await admin`select incident_id, person_id from audit_events
      where subject_id = ${partnerRecordId}`)[0]).toMatchObject({
      incident_id: incidentId,
      person_id: partnerPersonId,
    });
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events
      where subject_id = ${partnerRecordId} and category = 'board.record.created'`)).toHaveLength(1);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from sync_conflicts
      where record_id = ${partnerConflictRecordId} and incident_id = ${incidentId}`)).toHaveLength(1);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events
      where subject_id = ${partnerConflictRecordId} and category = 'sync.conflict'`)).toHaveLength(1);
    await post(
      adminToken,
      `/api/v1/incidents/${incidentId}/participants/${partnerParticipantId}/revoke`,
      { reason: "Partner demobilized" },
    );
    const revokedPartner = new ExactClient();
    await expect(revokedPartner.connect(partnerToken, incidentId)).rejects.toThrow(/auth_required:/);
    revokedPartner.close();
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events
      where subject_id = ${partnerRecordId} and category = 'board.record.created'`)).toHaveLength(0);
    expect(await withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from sync_conflicts where record_id = ${partnerConflictRecordId}`)).toHaveLength(0);

    await admin`update jurisdiction_memberships set role = 'viewer'
      where person_id = ${memberId} and jurisdiction_id = ${jurisdictionId}`;
    const demotedReplay = new ExactClient();
    await demotedReplay.connect(memberToken, incidentId);
    expect(await demotedReplay.send(update, operationId)).toEqual(first);
    demotedReplay.close();
    await admin`update incidents set closed_at = now() where id = ${incidentId}`;
    const closedReplay = new ExactClient();
    await closedReplay.connect(memberToken, incidentId);
    expect(await closedReplay.send(update, operationId)).toEqual(first);
    closedReplay.close();
    expect((await admin`select count(*)::int as count from sync_updates
      where operation_id = ${operationId}`)[0]!.count).toBe(1);

    await admin`delete from jurisdiction_memberships where person_id = ${memberId}`;
    const stale = new ExactClient();
    await expect(stale.connect()).rejects.toThrow(/auth_required:/);
    stale.close();
    expect((await admin`select count(*)::int as count from sync_updates
      where operation_id in (${operationId}, ${badOperationId})`)[0]!.count).toBe(2);
  });
});
