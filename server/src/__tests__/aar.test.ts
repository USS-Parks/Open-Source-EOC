import type { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * After-action and improvement planning. An AAR composes from
 * observations captured during the incident plus the chronology as evidence;
 * corrective actions survive incident closure and keep reporting status.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let incidentId: string;
let partnerToken: string;
let partnerParticipantId: string;
let partnerPersonId: string;

function api(method: string, url: string, payload?: Record<string, unknown>) {
  return apiAs(adminToken, method, url, payload);
}

function apiAs(token: string, method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  const partnerJurisdictionId = await createJurisdiction(admin, "mutual-aid", "Mutual Aid");
  partnerPersonId = await createPerson(admin, {
    email: "aid@example.org", displayName: "Aid Liaison", password: "partner-good-password",
  });
  await addMembership(admin, partnerPersonId, partnerJurisdictionId, "member");
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
  partnerToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "aid@example.org", password: "partner-good-password" },
    })
  ).json().accessToken as string;
  const participant = await api("POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "mutual-aid",
    personEmail: "aid@example.org",
    incidentPositionTitle: "Mutual Aid Liaison",
    role: "contributor",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    reason: "AAR corrective action follow-through",
  });
  partnerParticipantId = participant.json().participant.id as string;
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
    const rawPdfText = pdf.rawPayload.toString("latin1");
    const pdfText = [...rawPdfText.matchAll(/\((.*?)\) Tj/g)]
      .map((match) => match[1]!.replace(/\\([\\()])/g, "$1"))
      .join(" ");
    expect(pdfText).toContain("Open Source EOC");
    expect(pdfText).toContain("Incident: Bald Hills Fire");
    expect(pdfText).toContain("Source: Stored AAR snapshot");
    expect(pdfText).toMatch(/Source time: \d{4}-\d{2}-\d{2}T/);
    expect(pdfText).toContain("Page 1 of ");
    expect(pdfText).not.toContain("Handling:");
  });
});

describe("AAR accountability and operational-period scope", () => {
  it("reconciles records and preserves an immutable report snapshot", async () => {
    const now = Date.now();
    const firstPeriod = {
      label: "Operational Period 1",
      startsAt: new Date(now - 600_000).toISOString(),
      endsAt: new Date(now + 600_000).toISOString(),
    };
    const secondPeriod = {
      label: "Operational Period 2",
      startsAt: new Date(now + 600_000).toISOString(),
      endsAt: new Date(now + 1_200_000).toISOString(),
    };
    expect((await api("PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: 0, geometry: null, operationalPeriod: firstPeriod,
      reason: "AAR period one",
    })).statusCode).toBe(200);
    expect((await api("PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: 1, geometry: null, operationalPeriod: secondPeriod,
      reason: "AAR period two",
    })).statusCode).toBe(200);
    const otherIncident = (await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
      templateKey: "wildfire", name: "Unrelated Ridge Fire",
    })).json().incidentId as string;
    expect(otherIncident).not.toBe(incidentId);

    const periodOneObservation = await api("POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability: "planning", kind: "improvement",
      observation: "The planning handoff lacked a written checklist.",
      recommendation: "Publish the handoff checklist.", periodRevision: 1,
    });
    expect(periodOneObservation.statusCode).toBe(201);
    await api("POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability: "public_information_and_warning", kind: "strength",
      observation: "The second-period briefing was timely.", periodRevision: 2,
    });
    const periodOneAction = await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
      incidentId, capability: "planning", recommendation: "Publish the handoff checklist",
      priority: "high", dueDate: "2026-10-01", periodRevision: 1,
    });
    expect(periodOneAction.statusCode).toBe(201);
    await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
      incidentId, capability: "public_information_and_warning",
      recommendation: "Retain the briefing template", priority: "low", periodRevision: 2,
    });

    const analyticsResponse = await api(
      "GET", `/api/v1/incidents/${incidentId}/aar/analytics?periodRevision=1`,
    );
    expect(analyticsResponse.statusCode).toBe(200);
    const scoped = analyticsResponse.json();
    expect(scoped.observations.map((item: { id: string }) => item.id))
      .toEqual([periodOneObservation.json().id]);
    expect(scoped.correctiveActions.map((item: { id: string }) => item.id))
      .toEqual([periodOneAction.json().id]);
    expect(scoped.analytics.totals).toEqual({ observations: 1, correctiveActions: 1, records: 2 });
    for (const item of [
      ...scoped.analytics.byPriority,
      ...scoped.analytics.byStatus,
      ...scoped.analytics.byCapability,
    ]) {
      expect(item.count).toBe(item.observationIds.length + item.correctiveActionIds.length);
    }
    expect(scoped.analytics.byPriority.find((item: { key: string }) => item.key === "high").count).toBe(1);
    expect(scoped.analytics.byStatus.find((item: { key: string }) => item.key === "open").count).toBe(1);

    const [expectedChronology] = await admin`
      select count(*)::integer as count from audit_events
      where incident_id = ${incidentId}
        and created_at >= ${new Date(firstPeriod.startsAt)}
        and created_at < ${new Date(firstPeriod.endsAt)}`;
    const composed = await api("POST", `/api/v1/incidents/${incidentId}/aar`, {
      overview: "Operational Period 1 review", objectives: ["Improve the handoff"],
      periodRevision: 1,
    });
    expect(composed.statusCode).toBe(201);
    expect(composed.json().content.operationalPeriod).toMatchObject({
      revision: 1, label: "Operational Period 1",
      startsAt: firstPeriod.startsAt, endsAt: firstPeriod.endsAt,
    });
    expect(composed.json().content.analytics.totals.records).toBe(2);
    expect(composed.json().content.chronologyCount).toBe(expectedChronology!.count);

    const updated = await api("PATCH", `/api/v1/corrective-actions/${periodOneAction.json().id as string}`, {
      expectedRevision: 0, status: "in_progress",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ revision: 1, status: "in_progress" });
    const stale = await api("PATCH", `/api/v1/corrective-actions/${periodOneAction.json().id as string}`, {
      expectedRevision: 0, priority: "critical",
    });
    expect(stale.statusCode).toBe(409);

    const pdf = await api("GET", `/api/v1/aar/${composed.json().id as string}/pdf`);
    const rawPdfText = pdf.rawPayload.toString("latin1");
    const pdfText = [...rawPdfText.matchAll(/\((.*?)\) Tj/g)]
      .map((match) => match[1]!.replace(/\\([\\()])/g, "$1"))
      .join(" ");
    expect(pdfText).toContain("Operational Period Revision: 1");
    expect(pdfText).toContain("priority: high; owner: unassigned; due: 2026-10-01");
    expect(pdfText).toContain("status: open; revision: 0");
    expect(pdfText).not.toContain("status: in_progress; revision: 1");

    const proofDir = process.env.OPENEOC_AAR_PROOF_DIR;
    if (proofDir) {
      await mkdir(proofDir, { recursive: true });
      await writeFile(join(proofDir, "accountability.pdf"), pdf.rawPayload);
    }
  });

  it("limits an assigned external participant to status follow-through", async () => {
    const created = await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
      incidentId, capability: "operational_coordination",
      recommendation: "Confirm the mutual-aid radio plan", priority: "critical",
      assignment: {
        kind: "incident_participant", incidentId, participantId: partnerParticipantId,
      },
      dueDate: "2026-10-15",
    });
    expect(created.statusCode).toBe(201);
    const actionId = created.json().id as string;
    const assigned = await apiAs(partnerToken, "GET", `/api/v1/corrective-actions/${actionId}`);
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      id: actionId, owner: "Mutual Aid Liaison", priority: "critical", revision: 0,
    });
    expect((await apiAs(partnerToken, "GET", `/api/v1/incidents/${incidentId}/aar/analytics`)).statusCode)
      .toBe(403);
    expect((await apiAs(partnerToken, "GET", `/api/v1/incidents/${incidentId}/aar/observations`)).statusCode)
      .toBe(403);

    const complete = await apiAs(partnerToken, "PATCH", `/api/v1/corrective-actions/${actionId}`, {
      expectedRevision: 0, status: "complete",
    });
    expect(complete.statusCode, complete.body).toBe(200);
    expect(complete.json()).toMatchObject({
      status: "complete", revision: 1, completedBy: "Aid Liaison",
    });
    expect(complete.json().completedAt).not.toBeNull();
    const readOwnReceipt = () => withPerson(runtime, partnerPersonId, (tx) => tx`
      select id from audit_events where subject_id = ${actionId}
        and category = 'aar.corrective_action_updated'`);
    expect(await readOwnReceipt()).toHaveLength(1);
    const forbiddenMetadata = await apiAs(
      partnerToken, "PATCH", `/api/v1/corrective-actions/${actionId}`,
      { expectedRevision: 1, priority: "low" },
    );
    expect(forbiddenMetadata.statusCode).toBe(403);

    const reopened = await api("PATCH", `/api/v1/corrective-actions/${actionId}`, {
      expectedRevision: 1, status: "in_progress",
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({
      status: "in_progress", revision: 2,
      completedAt: complete.json().completedAt, completedBy: "Aid Liaison",
    });
    const revoked = await api(
      "POST", `/api/v1/incidents/${incidentId}/participants/${partnerParticipantId}/revoke`,
      { reason: "Corrective action reassigned" },
    );
    expect(revoked.statusCode).toBe(200);
    expect(await readOwnReceipt()).toHaveLength(0);
    expect((await apiAs(partnerToken, "GET", `/api/v1/corrective-actions/${actionId}`)).statusCode).toBe(404);
    expect((await apiAs(partnerToken, "PATCH", `/api/v1/corrective-actions/${actionId}`, {
      expectedRevision: 2, status: "complete",
    })).statusCode).toBe(404);
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
