import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string, outsiderId: string;
let adminPersonId: string, memberPersonId: string, partnerPersonId: string;
let adminToken: string, memberToken: string, partnerToken: string, outsiderToken: string;
let incidentA: string, incidentB: string;
let datasetA: string, datasetB: string, participantId: string;
let lifelineBoardA: string, lifelineRecordA: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function activate(name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "daily_ops", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

async function addCatalogDataset(
  incidentId: string,
  key: string,
  coverage: unknown | null,
  items: Array<{ sourceId: string; geometry: unknown; data?: Record<string, unknown> }>,
): Promise<string> {
  const [pack] = await admin`
    insert into data_packs (incident_id, organization_id, name, created_by)
    values (${incidentId}, ${ownerId}, ${key}, ${adminPersonId}) returning id`;
  const [dataset] = await admin`
    insert into data_pack_datasets
      (pack_id, key, name, kind, field_mapping, coverage, stale_after_seconds,
       last_success_at, item_count)
    values (${pack!.id as string}, ${key}, ${key}, 'geojson', '{}'::jsonb,
      ST_GeomFromGeoJSON(${coverage === null ? null : JSON.stringify(coverage)}),
      604800, now(), ${items.length}) returning id`;
  const datasetId = dataset!.id as string;
  for (const item of items) {
    await admin`
      insert into data_pack_items
        (dataset_id, incident_id, source_id, data, geom, loaded_by)
      values (${datasetId}, ${incidentId}, ${item.sourceId},
        ${admin.json((item.data ?? {}) as never)},
        ST_GeomFromGeoJSON(${JSON.stringify(item.geometry)}), ${adminPersonId})`;
  }
  return datasetId;
}

async function attachLifelineBoard(
  incidentId: string,
  status: string,
  note: string,
): Promise<{ boardId: string; recordId: string }> {
  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${ownerId}, 'lifelines', 1, ${`Lifelines ${incidentId}`}) returning id`;
  const boardId = board!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  const [record] = await admin`
    insert into board_records (board_id, incident_id, data, created_by)
    values (${boardId}, ${incidentId},
      ${admin.json({ lifeline: "energy", status, note } as never)}, ${memberPersonId})
    returning id`;
  return { boardId, recordId: record!.id as string };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "impact-city", "Impact City EOC");
  partnerId = await createJurisdiction(admin, "impact-aid", "Impact Mutual Aid");
  outsiderId = await createJurisdiction(admin, "impact-outside", "Outside EOC");
  adminPersonId = await createPerson(admin, {
    email: "impact-admin@example.org", displayName: "Impact Admin", password: "impact-admin-password",
  });
  memberPersonId = await createPerson(admin, {
    email: "impact-member@example.org", displayName: "Impact Member", password: "impact-member-password",
  });
  partnerPersonId = await createPerson(admin, {
    email: "impact-partner@example.org", displayName: "Impact Partner", password: "impact-partner-password",
  });
  const outsiderPersonId = await createPerson(admin, {
    email: "impact-outside@example.org", displayName: "Impact Outsider", password: "impact-outside-password",
  });
  await addMembership(admin, adminPersonId, ownerId, "admin");
  await addMembership(admin, memberPersonId, ownerId, "member");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await addMembership(admin, outsiderPersonId, outsiderId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("impact-admin@example.org", "impact-admin-password");
  memberToken = await login("impact-member@example.org", "impact-member-password");
  partnerToken = await login("impact-partner@example.org", "impact-partner-password");
  outsiderToken = await login("impact-outside@example.org", "impact-outside-password");
  incidentA = await activate("Impact Alpha");
  incidentB = await activate("Impact Bravo");

  const granted = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentA}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug: "impact-aid",
      personEmail: "impact-partner@example.org",
      incidentPositionTitle: "Impact Liaison",
      role: "viewer",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      reason: "Impact analysis access",
    },
  });
  expect(granted.statusCode).toBe(201);
  participantId = granted.json().participant.id as string;

  await admin`
    insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
    values
      (${incidentA}, 1, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 1, 1))}), 'initial', ${adminPersonId}),
      (${incidentA}, 2, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 2, 1))}), 'expanded', ${adminPersonId}),
      (${incidentA}, 3, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 0.5, 1))}), 'shrunk', ${adminPersonId}),
      (${incidentB}, 1, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 1, 1))}), 'separate incident', ${adminPersonId})`;

  const fullCoverage = polygon(-1, -1, 3, 2);
  datasetA = await addCatalogDataset(incidentA, "humboldt_parcels", fullCoverage, [
    { sourceId: "a-inside", geometry: { type: "Point", coordinates: [0.25, 0.5] } },
    { sourceId: "b-boundary", geometry: { type: "Point", coordinates: [1, 0.5] } },
    { sourceId: "c-expanded", geometry: { type: "Point", coordinates: [1.5, 0.5] } },
    { sourceId: "d-outside", geometry: { type: "Point", coordinates: [4, 4] } },
  ]);
  await addCatalogDataset(incidentA, "hifld_critical_facilities", polygon(0, 0, 0.25, 1), [
    { sourceId: "facility-partial", geometry: { type: "Point", coordinates: [0.1, 0.5] } },
  ]);
  datasetB = await addCatalogDataset(incidentB, "humboldt_parcels", fullCoverage, [
    { sourceId: "a-inside", geometry: { type: "Point", coordinates: [0.75, 0.5] } },
  ]);

  ({ boardId: lifelineBoardA, recordId: lifelineRecordA } =
    await attachLifelineBoard(incidentA, "unstable", "Utility report"));
  await attachLifelineBoard(incidentB, "stable", "Separate incident report");
});

afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("incident impact service and routes", () => {
  it("authorizes members and named participants while denying unrelated callers", async () => {
    const url = `/api/v1/incidents/${incidentA}/impact?revision=2`;
    expect((await app.inject({ method: "GET", url, headers: auth(memberToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url, headers: auth(partnerToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url, headers: auth(outsiderToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentA}/impact?revision=99`,
      headers: auth(memberToken),
    })).statusCode).toBe(404);
  });

  it("returns current and explicit impacts, isolated reports, and honest unknowns", async () => {
    const explicit = await app.inject({
      method: "GET", url: `/api/v1/incidents/${incidentA}/impact?revision=2`, headers: auth(memberToken),
    });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().impact).toMatchObject({
      areaRevision: 2,
      categories: {
        structures_parcels: { value: 3 },
        infrastructure_facilities: { value: null, coverage: "partial" },
        population: { value: null },
      },
    });
    const energy = explicit.json().lifelines.find((entry: { lifeline: string }) => entry.lifeline === "energy");
    expect(energy).toMatchObject({
      status: "unstable",
      note: "Utility report",
      recordId: lifelineRecordA,
      boardId: lifelineBoardA,
      reportedBy: { personId: memberPersonId, personName: "Impact Member" },
    });
    expect(explicit.json().lifelineInterpretation).toContain("does not imply lifeline failure");
    expect(explicit.json().lifelines.find(
      (entry: { lifeline: string }) => entry.lifeline === "water_systems",
    )).toMatchObject({ status: "unknown", recordId: null });

    const current = await app.inject({
      method: "GET", url: `/api/v1/incidents/${incidentA}/impact`, headers: auth(memberToken),
    });
    expect(current.json().impact).toMatchObject({
      areaRevision: 3,
      categories: { structures_parcels: { value: 1 } },
    });
    const separate = await app.inject({
      method: "GET", url: `/api/v1/incidents/${incidentB}/impact`, headers: auth(memberToken),
    });
    expect(separate.json().impact.categories.structures_parcels.value).toBe(1);
    expect(separate.json().lifelines.find(
      (entry: { lifeline: string }) => entry.lifeline === "energy",
    )).toMatchObject({ status: "stable", note: "Separate incident report" });
  });

  it("explains expansion and shrinkage against the same current baselines", async () => {
    const expanded = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentA}/impact/compare?fromRevision=1&toRevision=2`,
      headers: auth(memberToken),
    });
    expect(expanded.statusCode).toBe(200);
    expect(expanded.json().baselineStatement).toContain("not a historical baseline snapshot");
    expect(expanded.json().categories.structures_parcels).toMatchObject({
      fromValue: 2, toValue: 3, delta: 1,
    });
    expect(expanded.json().categories.structures_parcels.sources[0]).toMatchObject({
      fromValue: 2, toValue: 3, delta: 1,
    });
    expect(expanded.json().categories.infrastructure_facilities.delta).toBeNull();

    const shrunk = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentA}/impact/compare?fromRevision=2`,
      headers: auth(memberToken),
    });
    expect(shrunk.json()).toMatchObject({ fromRevision: 2, toRevision: 3 });
    expect(shrunk.json().categories.structures_parcels).toMatchObject({
      fromValue: 3, toValue: 1, delta: -2,
    });
  });

  it("pages contributing records and reconciles them to the selected source aggregate", async () => {
    const base = `/api/v1/incidents/${incidentA}/impact/sources/${datasetA}/records?revision=2&limit=2`;
    const first = await app.inject({ method: "GET", url: base, headers: auth(memberToken) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ areaRevision: 2, category: "structures_parcels" });
    expect(first.json().source.value).toBe(3);
    expect(first.json().records.map((record: { sourceId: string }) => record.sourceId)).toEqual([
      "a-inside", "b-boundary",
    ]);
    const second = await app.inject({
      method: "GET",
      url: `${base}&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
      headers: auth(memberToken),
    });
    expect(second.json().records.map((record: { sourceId: string }) => record.sourceId)).toEqual([
      "c-expanded",
    ]);
    expect(second.json().nextCursor).toBeNull();
    expect(first.json().records.length + second.json().records.length).toBe(3);

    expect((await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentA}/impact/sources/${datasetB}/records?revision=2`,
      headers: auth(memberToken),
    })).statusCode).toBe(404);
  });

  it("applies the board field-read mask to incident lifeline reports", async () => {
    const [stored] = await admin`
      select definition from board_templates where key = 'lifelines' and version = 1`;
    const definition = stored!.definition as {
      version: number;
      fields: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const restricted = {
      ...definition,
      version: 2,
      fields: definition.fields.map((field) =>
        field.key === "status" || field.key === "note" ? { ...field, read: "admin" } : field,
      ),
    };
    await admin`
      insert into board_templates (key, version, title, definition)
      values ('lifelines', 2, 'Restricted Lifelines', ${admin.json(restricted as never)})`;
    await admin`update boards set template_version = 2 where id = ${lifelineBoardA}`;

    for (const token of [memberToken, partnerToken]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/incidents/${incidentA}/impact?revision=2`,
        headers: auth(token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().lifelines.find(
        (entry: { lifeline: string }) => entry.lifeline === "energy",
      )).toMatchObject({
        status: "unknown",
        note: null,
        recordId: lifelineRecordA,
      });
      expect(JSON.stringify(response.json())).not.toContain("Utility report");
    }

    const normal = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentB}/impact`,
      headers: auth(memberToken),
    });
    expect(normal.json().lifelines.find(
      (entry: { lifeline: string }) => entry.lifeline === "energy",
    )).toMatchObject({ status: "stable", note: "Separate incident report" });
  });

  it("removes impact access immediately when named participation is revoked", async () => {
    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentA}/participants/${participantId}/revoke`,
      headers: auth(adminToken),
      payload: { reason: "Impact assignment ended" },
    });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentA}/impact`,
      headers: auth(partnerToken),
    })).statusCode).toBe(404);
  });
});
