import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AarRollup } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The cross-incident after-action rollup lists corrective actions across
 * every incident the reader may read and no other: an incident of another
 * organization never appears, a participant sees the incident but only the
 * actions they may read, and the range keeps incidents active in it.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let yurokId: string;
let aidId: string;
let otherId: string;
const tokens: Record<string, string> = {};
const incidents: Record<string, string> = {};
const actions: Record<string, string> = {};

async function call(who: string, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await app.inject({
    method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}),
  });
  if (method === "POST") expect(response.statusCode, response.body).toBe(201);
  return response;
}

async function rollup(who: string, query = ""): Promise<AarRollup> {
  const response = await call(who, "GET", `/api/v1/aar/rollup${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as AarRollup;
}

async function action(who: string, jurisdictionId: string, key: string, body: Record<string, unknown>) {
  actions[key] = (await call(who, "POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, body)).json().id as string;
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  ({ jurisdictionId: yurokId } = await seedIdentity(admin));
  aidId = await createJurisdiction(admin, "mutual-aid", "Mutual Aid");
  otherId = await createJurisdiction(admin, "other-county", "Other County OES");
  const aid = await createPerson(admin, { email: "aid@example.org", displayName: "Aid Liaison", password: "partner-good-password" });
  await addMembership(admin, aid, aidId, "admin");
  const other = await createPerson(admin, { email: "other@example.org", displayName: "Other Admin", password: "other-good-password" });
  await addMembership(admin, other, otherId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  tokens["yurok"] = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens["aid"] = await tokenFor(app, "aid@example.org", "partner-good-password");
  tokens["other"] = await tokenFor(app, "other@example.org", "other-good-password");

  const incident = async (who: string, jurisdictionId: string, key: string, name: string) => {
    incidents[key] = (await call(who, "POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, { templateKey: "wildfire", name })).json().incidentId as string;
  };
  await incident("yurok", yurokId, "current", "Bald Hills Fire");
  await incident("yurok", yurokId, "past", "Winter Storm 2025");
  await incident("other", otherId, "foreign", "Other County Flood");
  // The past incident ran and closed in January 2025.
  await admin`update incidents set activated_at = '2025-01-03T08:00:00Z', closed_at = '2025-01-10T20:00:00Z'
    where id = ${incidents["past"]!}`;

  const participant = await call("yurok", "POST", `/api/v1/incidents/${incidents["current"]}/participants`, {
    organizationSlug: "mutual-aid", personEmail: "aid@example.org", incidentPositionTitle: "Mutual Aid Liaison",
    role: "contributor", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "AAR follow-through",
  });
  const participantId = participant.json().participant.id as string;
  const [position] = await admin`select id from positions where jurisdiction_id = ${yurokId} limit 1`;

  await action("yurok", yurokId, "positionOwned", {
    incidentId: incidents["current"], capability: "planning", capabilityElement: "training",
    recommendation: "Publish the handoff checklist", priority: "high", dueDate: "2026-10-01",
    assignment: { kind: "position", positionId: position!.id as string },
  });
  await action("yurok", yurokId, "unassigned", {
    incidentId: incidents["current"], capability: "mass_care_services", recommendation: "Pre-stage shelter kits", priority: "low",
  });
  await action("yurok", yurokId, "partnerOwned", {
    incidentId: incidents["current"], capability: "operational_coordination", capabilityElement: "planning",
    recommendation: "Confirm the mutual-aid radio plan", priority: "critical",
    assignment: { kind: "incident_participant", incidentId: incidents["current"], participantId },
  });
  await action("yurok", yurokId, "past", {
    incidentId: incidents["past"], capability: "planning", recommendation: "Revise the winter storm annex", priority: "medium",
  });
  await action("aid", aidId, "aidOwn", {
    incidentId: incidents["current"], capability: "logistics_and_supply_chain_management",
    recommendation: "Stage the mutual-aid cache closer to the fire", priority: "medium",
  });
  await action("other", otherId, "foreign", {
    incidentId: incidents["foreign"], capability: "planning", recommendation: "Not for other organizations", priority: "high",
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id).sort();
const incidentIds = (...names: string[]) => names.map((name) => incidents[name]!).sort();
const actionIds = (...names: string[]) => names.map((name) => actions[name]!).sort();

describe("cross-incident after-action rollup", () => {
  it("lists the organization's incidents and actions and never another organization's", async () => {
    const result = await rollup("yurok");
    expect(ids(result.incidents)).toEqual(incidentIds("current", "past"));
    expect(ids(result.correctiveActions)).toEqual(actionIds("positionOwned", "unassigned", "partnerOwned", "past"));
    const byId = new Map(result.correctiveActions.map((item) => [item.id, item]));
    // The responsible organization is the owner's: the position's, the participant's, or none yet.
    expect(byId.get(actions["positionOwned"]!)!.ownerOrganization).toEqual({ id: yurokId, name: "Yurok Tribe OES" });
    expect(byId.get(actions["partnerOwned"]!)!.ownerOrganization).toEqual({ id: aidId, name: "Mutual Aid" });
    expect(byId.get(actions["unassigned"]!)!.ownerOrganization).toBeNull();
    expect(byId.get(actions["positionOwned"]!)).toMatchObject({
      incidentId: incidents["current"], organizationName: "Yurok Tribe OES", capability: "planning",
      capabilityElement: "training", priority: "high", status: "open", dueDate: "2026-10-01",
    });
    expect(JSON.stringify(result)).not.toContain("Other County");
  });

  it("keeps incidents active in the range", async () => {
    const since = await rollup("yurok", `?from=${encodeURIComponent("2026-01-01T08:00:00.000Z")}`);
    expect(ids(since.incidents)).toEqual(incidentIds("current"));
    expect(ids(since.correctiveActions)).toEqual(actionIds("positionOwned", "unassigned", "partnerOwned"));
    const before = await rollup("yurok", `?from=${encodeURIComponent("2025-01-01T08:00:00.000Z")}&to=${encodeURIComponent("2025-02-01T08:00:00.000Z")}`);
    expect(ids(before.incidents)).toEqual(incidentIds("past"));
    expect(ids(before.correctiveActions)).toEqual(actionIds("past"));
    const bad = await call("yurok", "GET", "/api/v1/aar/rollup?from=last-week");
    expect(bad.statusCode).toBe(400);
  });

  it("shows a participant the incident, its own actions and those assigned to it, and nothing else", async () => {
    const result = await rollup("aid");
    expect(ids(result.incidents)).toEqual(incidentIds("current"));
    expect(ids(result.correctiveActions)).toEqual(actionIds("partnerOwned", "aidOwn"));
  });

  it("shows another organization only its own", async () => {
    const result = await rollup("other");
    expect(ids(result.incidents)).toEqual(incidentIds("foreign"));
    expect(ids(result.correctiveActions)).toEqual(actionIds("foreign"));
  });
});
