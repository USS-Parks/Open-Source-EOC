import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  addMembership,
  createJurisdiction,
  createPerson,
} from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let ownerToken: string;
let memberToken: string;
let viewerToken: string;
let ownerPersonId: string;
let memberPersonId: string;
let viewerPersonId: string;
let ownerJurisdictionId: string;
let viewerJurisdictionId: string;
let firstIncidentId: string;
let secondIncidentId: string;

const stateUrl = (incidentId: string, kind: string, key: string) =>
  `/api/v1/incidents/${incidentId}/saved-state/${kind}/${key}`;


async function activate(name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${ownerJurisdictionId}/incidents`,
    headers: auth(ownerToken),
    payload: { templateKey: "wildfire", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

async function putState(
  token: string,
  incidentId: string,
  key: string,
  expectedRevision: number,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PUT",
    url: stateUrl(incidentId, "workspace_layout", key),
    headers: auth(token),
    payload: { schemaVersion: 1, expectedRevision, payload },
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ownerJurisdictionId = seed.jurisdictionId;
  ownerPersonId = seed.adminId;
  memberPersonId = seed.memberId;
  viewerJurisdictionId = await createJurisdiction(admin, "mutual-aid", "Mutual Aid");
  viewerPersonId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Viewer",
    password: "viewer-good-password",
  });
  await addMembership(admin, viewerPersonId, viewerJurisdictionId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);

  app = buildApp(runtime, { oidc: null });
  expect(app.hasRoute({
    method: "GET",
    url: "/api/v1/incidents/:incidentId/saved-state",
  })).toBe(true);
  ownerToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-good-password");
  firstIncidentId = await activate("Saved State One");
  secondIncidentId = await activate("Saved State Two");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("incident saved state", () => {
  it("isolates personal state, enforces incident read authority, and rejects stale revisions", async () => {
    const created = await putState(ownerToken, firstIncidentId, "default", 0, {
      columns: ["status", "owner"],
      density: "compact",
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().state).toMatchObject({
      incidentId: firstIncidentId,
      kind: "workspace_layout",
      key: "default",
      schemaVersion: 1,
      revision: 1,
      payload: { columns: ["status", "owner"], density: "compact" },
    });

    const roundTrip = await app.inject({
      method: "GET",
      url: stateUrl(firstIncidentId, "workspace_layout", "default"),
      headers: auth(ownerToken),
    });
    expect(roundTrip.statusCode).toBe(200);
    expect(roundTrip.json().state.payload.density).toBe("compact");

    const forgedIdentity = await app.inject({
      method: "PUT",
      url: stateUrl(firstIncidentId, "workspace_layout", "forged"),
      headers: auth(ownerToken),
      payload: {
        schemaVersion: 1,
        expectedRevision: 0,
        payload: { density: "comfortable" },
        personId: memberPersonId,
      },
    });
    expect(forgedIdentity.statusCode).toBe(400);

    const otherUserRead = await app.inject({
      method: "GET",
      url: stateUrl(firstIncidentId, "workspace_layout", "default"),
      headers: auth(memberToken),
    });
    expect(otherUserRead.statusCode).toBe(404);
    expect(await withPerson(runtime, memberPersonId, (tx) => tx`
      select state_key from saved_states
      where person_id = ${ownerPersonId} and incident_id = ${firstIncidentId}`)).toHaveLength(0);

    const memberOwn = await putState(memberToken, firstIncidentId, "default", 0, {
      columns: ["title"],
    });
    expect(memberOwn.statusCode).toBe(200);
    expect(memberOwn.json().state.revision).toBe(1);

    for (const key of ["alpha", "bravo"]) {
      expect((await putState(ownerToken, firstIncidentId, key, 0, { key })).statusCode).toBe(200);
    }
    const firstPage = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${firstIncidentId}/saved-state?kind=workspace_layout&limit=2`,
      headers: auth(ownerToken),
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().states.map((state: { key: string }) => state.key)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(firstPage.json().nextCursor).toBe("bravo");
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${firstIncidentId}/saved-state?kind=workspace_layout&limit=2&cursor=bravo`,
      headers: auth(ownerToken),
    });
    expect(secondPage.json().states.map((state: { key: string }) => state.key)).toEqual(["default"]);
    expect(secondPage.json().nextCursor).toBeNull();
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${firstIncidentId}/saved-state?kind=workspace_layout&limit=101`,
      headers: auth(ownerToken),
    })).statusCode).toBe(400);

    const updated = await putState(ownerToken, firstIncidentId, "default", 1, {
      density: "comfortable",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().state).toMatchObject({ revision: 2, payload: { density: "comfortable" } });
    expect((await putState(ownerToken, firstIncidentId, "default", 1, {
      density: "stale",
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "DELETE",
      url: `${stateUrl(firstIncidentId, "workspace_layout", "default")}?expectedRevision=1`,
      headers: auth(ownerToken),
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "DELETE",
      url: `${stateUrl(firstIncidentId, "workspace_layout", "default")}?expectedRevision=2`,
      headers: auth(ownerToken),
    })).statusCode).toBe(200);

    const oversized = await putState(ownerToken, firstIncidentId, "oversized", 0, {
      value: "x".repeat(65_536),
    });
    expect(oversized.statusCode).toBe(400);

    const nearLimit = Object.fromEntries(
      Array.from({ length: 6_000 }, (_, index) => [`k${String(index).padStart(4, "0")}`, 0]),
    );
    expect(Buffer.byteLength(JSON.stringify(nearLimit), "utf8")).toBeLessThan(65_536);
    expect((await putState(ownerToken, firstIncidentId, "near-limit", 0, nearLimit)).statusCode)
      .toBe(200);

    const finiteNumbers = { values: Array.from({ length: 8_000 }, () => 1e300) };
    expect(Buffer.byteLength(JSON.stringify(finiteNumbers), "utf8")).toBeLessThan(65_536);
    expect((await putState(
      ownerToken,
      firstIncidentId,
      "finite-numbers",
      0,
      finiteNumbers,
    )).statusCode).toBe(200);

    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${firstIncidentId}/participants`,
      headers: auth(ownerToken),
      payload: {
        organizationSlug: "mutual-aid",
        personEmail: "viewer@example.org",
        incidentPositionTitle: "Situation Viewer",
        role: "viewer",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        reason: "Shared operating picture",
      },
    });
    expect(grant.statusCode).toBe(201);
    const participantId = grant.json().participant.id as string;
    expect((await putState(viewerToken, firstIncidentId, "viewer", 0, {
      panel: "map",
    })).statusCode).toBe(200);
    expect((await putState(viewerToken, secondIncidentId, "unrelated", 0, {
      panel: "map",
    })).statusCode).toBe(404);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${firstIncidentId}/participants/${participantId}/revoke`,
      headers: auth(ownerToken),
      payload: { reason: "Assignment ended" },
    });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: stateUrl(firstIncidentId, "workspace_layout", "viewer"),
      headers: auth(viewerToken),
    })).statusCode).toBe(404);
    expect(await withPerson(runtime, viewerPersonId, (tx) => tx`
      select state_key from saved_states where incident_id = ${firstIncidentId}`)).toHaveLength(0);
    expect(await withPerson(runtime, ownerPersonId, (tx) => tx`
      select state_key from saved_states
      where person_id = ${viewerPersonId} and incident_id = ${firstIncidentId}`)).toHaveLength(0);
  });
});
