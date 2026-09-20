import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * After-action and improvement planning (VEOC-36). An AAR composes from
 * observations captured during the incident plus the chronology as evidence;
 * corrective actions survive incident closure and keep reporting status.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let incidentId: string;

function api(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  incidentId = (
    await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
      templateKey: "wildfire",
      name: "Bald Hills Fire",
    })
  ).json().incidentId as string;
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

describe("AAR composition", () => {
  it("composes from observations captured during the incident plus chronology", async () => {
    await api("POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability: "operational_communications",
      kind: "strength",
      observation: "The radio net held throughout the operational period.",
    });
    await api("POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability: "mass_care_services",
      capabilityElement: "training",
      kind: "improvement",
      observation: "The shelter opened two hours late.",
      recommendation: "Pre-stage shelter kits at the community center.",
    });
    await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
      incidentId,
      capability: "mass_care_services",
      capabilityElement: "equipment",
      recommendation: "Pre-stage shelter kits",
      dueDate: "2026-12-01",
    });

    // An off-doctrine capability is rejected at the API boundary.
    const bad = await api("POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability: "Made Up Capability",
      kind: "improvement",
      observation: "Should not be accepted.",
    });
    expect(bad.statusCode).toBe(400);

    const res = await api("POST", `/api/v1/incidents/${incidentId}/aar`, {
      overview: "A fast-moving wildfire above the lower service area.",
      objectives: ["Protect life safety"],
      period: "2026-09-17 to 2026-09-19",
    });
    expect(res.statusCode).toBe(201);
    const content = res.json().content;
    expect(content.strengths).toHaveLength(1);
    expect(content.improvements).toHaveLength(1);
    expect(content.improvements[0].capabilityElement).toBe("training");
    expect(content.correctiveActions).toHaveLength(1);
    expect(content.correctiveActions[0].capabilityElement).toBe("equipment");
    expect(content.chronologyCount).toBeGreaterThan(0);

    const pdf = await api("GET", `/api/v1/aar/${res.json().id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });
});

describe("corrective actions outlive the incident", () => {
  it("persist past closure and keep reporting status", async () => {
    const caId = (
      await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
        incidentId,
        capability: "planning",
        recommendation: "Revise the evacuation annex",
        dueDate: "2027-01-15",
      })
    ).json().id as string;

    // Close the incident; daily-ops continues.
    await api("POST", `/api/v1/incidents/${incidentId}/close`);

    // The corrective action is still listed after closure.
    let list = (await api("GET", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`)).json();
    expect(list.correctiveActions.some((c: { id: string }) => c.id === caId)).toBe(true);

    // It reports status through completion.
    await api("POST", `/api/v1/corrective-actions/${caId}/status`, { status: "in_progress" });
    await api("POST", `/api/v1/corrective-actions/${caId}/status`, { status: "complete" });

    // Completed actions drop from the default (open) view but show when asked.
    list = (await api("GET", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`)).json();
    expect(list.correctiveActions.some((c: { id: string }) => c.id === caId)).toBe(false);
    list = (
      await api("GET", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions?includeComplete=true`)
    ).json();
    const done = list.correctiveActions.find((c: { id: string }) => c.id === caId);
    expect(done.status).toBe("complete");
  });
});
