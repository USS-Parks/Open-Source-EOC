import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, tokenFor, type Sql } from "./helpers.js";

/**
 * The ICS 213RR as a form component (Veoci and air gap VA38). A resource
 * request taken through acceptance, sourcing and assignment, with costs,
 * renders its 213RR with each block its record holds; it prints; it starts
 * as a form of the period, one per request, and goes into the period's IAP.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hostId: string;
let memberId: string;
let adminToken: string;
let memberToken: string;
let partnerToken: string;
let incidentId: string;
let otherIncidentId: string;
let requestId: string;
let requestNumber: number;

type Method = "GET" | "POST" | "PUT";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

async function ok(token: string, method: Method, url: string, payload?: unknown) {
  const res = await call(token, method, url, payload);
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  hostId = await createJurisdiction(admin, "rr-host", "Humboldt County OES");
  const partnerOrg = await createJurisdiction(admin, "rr-partner", "Cal OES Region II");
  const adminId = await createPerson(admin, { email: "rr-admin@example.org", displayName: "Jordan Lee", password: "rr-admin-password" });
  memberId = await createPerson(admin, { email: "rr-member@example.org", displayName: "Sam Ortiz", password: "rr-member-password" });
  const partnerId = await createPerson(admin, { email: "rr-partner@example.org", displayName: "Pat Partner", password: "rr-partner-password" });
  await addMembership(admin, adminId, hostId, "admin");
  await addMembership(admin, memberId, hostId, "member");
  await addMembership(admin, partnerId, partnerOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "rr-admin@example.org", "rr-admin-password");
  memberToken = await tokenFor(app, "rr-member@example.org", "rr-member-password");
  partnerToken = await tokenFor(app, "rr-partner@example.org", "rr-partner-password");
  incidentId = (await ok(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, { templateKey: "wildfire", name: "Klamath River Flood" })).incidentId;
  otherIncidentId = (await ok(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, { templateKey: "wildfire", name: "Unrelated Fire" })).incidentId;
  await admin`
    insert into incident_area_revisions (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
    values (${incidentId}, 1, 'OP 1', '2026-09-25T06:00:00Z', '2026-09-25T18:00:00Z', '213RR test period', ${adminId})`;
  await ok(adminToken, "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "rr-partner", personEmail: "rr-partner@example.org", incidentPositionTitle: "Mutual Aid Liaison",
    role: "coordinator", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "VA38 partner reader",
  });

  // A request taken from receipt through acceptance, sourcing, assignment and deployment, with two costs.
  const submitted = await ok(memberToken, "POST", `/api/v1/jurisdictions/${hostId}/resource-requests`, {
    origin: "eoc", item: "Swift-water rescue team", quantity: 2, priority: "immediate", incidentId,
    neededBy: "2026-09-25T20:00:00Z", notes: "Stage at the Weitchpec store",
  });
  requestId = submitted.id as string;
  requestNumber = (await ok(memberToken, "GET", `/api/v1/resource-requests/${requestId}`)).number as number;
  await ok(adminToken, "POST", `/api/v1/resource-requests/${requestId}/transition`, { toState: "accepted" });
  await ok(memberToken, "POST", `/api/v1/resource-requests/${requestId}/transition`, { toState: "sourcing", note: "Asked the region" });
  const detail = await ok(adminToken, "GET", `/api/v1/incidents/${incidentId}`);
  const logistics = detail.positions.find((p: { key: string }) => p.key === "logistics_section_chief") as { id: string };
  await ok(memberToken, "POST", `/api/v1/resource-requests/${requestId}/assign`, { positionId: logistics.id });
  await ok(memberToken, "POST", `/api/v1/resource-requests/${requestId}/transition`, { toState: "deployed" });
  await ok(memberToken, "POST", `/api/v1/resource-requests/${requestId}/costs`, {
    category: "equipment", description: "Boat fuel", amountCents: 25_050, incurredAt: "2026-09-25",
  });
  await ok(adminToken, "POST", `/api/v1/resource-requests/${requestId}/costs`, { category: "personnel", amountCents: 100_000, incurredAt: "2026-09-25" });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the ICS 213RR of a resource request", () => {
  it("fills each block the request's record holds, from receipt through deployment and its costs", async () => {
    const rr = await ok(memberToken, "GET", `/api/v1/resource-requests/${requestId}/ics-213rr`);
    const number = `REQ-${requestNumber}`;
    expect(rr).toMatchObject({ requestId, number: requestNumber, incidentId, incidentName: "Klamath River Flood" });
    expect(rr.values).toMatchObject({
      requestNumber: number,
      requestedBy: "Sam Ortiz",
      priority: "Urgent",
      logisticsOrderNumber: number,
      logisticsApproval: "Sam Ortiz",
      financeComments: "2026-09-25 equipment: $250.50 (Boat fuel)\n2026-09-25 personnel: $1000.00\nTotal: $1250.50",
      financeSignature: "Jordan Lee",
      financeAt: "2026-09-25",
    });
    expect(rr.values.requested).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(rr.values.order).toEqual([["2", "", "", "Immediate", "Swift-water rescue team", "2026-09-25 20:00 UTC",
      expect.stringMatching(/ UTC$/), "$1250.50"]]);
    expect(rr.values.sectionChiefApproval).toMatch(/^Jordan Lee, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(rr.values.supplier).toBe("Logistics Section Chief, Humboldt County OES");
    expect(rr.values.logisticsNotes.split("\n")).toEqual([
      "Stage at the Weitchpec store",
      expect.stringMatching(/: Received by Sam Ortiz \(request submitted\)$/),
      expect.stringMatching(/: Received to Accepted by Jordan Lee$/),
      expect.stringMatching(/: Accepted to Sourcing by Sam Ortiz \(Asked the region\)$/),
      expect.stringMatching(/: Sourcing to Assigned by Sam Ortiz \(assigned to Logistics Section Chief\)$/),
      expect.stringMatching(/: Assigned to In progress by Sam Ortiz$/),
    ]);
    expect(rr.form.title).toBe(`Resource Request Message: ${number}`);

    const pdf = await call(memberToken, "GET", `/api/v1/resource-requests/${requestId}/ics-213rr/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-disposition"]).toBe(`attachment; filename="ics-213rr-req-${requestNumber}.pdf"`);
    const text = [...pdf.rawPayload.toString("latin1").matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join("\n");
    for (const line of ["  3. Resource Request Number", `    ${number}`, "  9. Section Chief Approval", "  12. Name of Supplier/POC",
      "  17. Reply/Comments from Finance", "    Total: $1250.50", "  19. Date/Time"]) expect(text).toContain(line);
  });

  it("keeps the costs from a reader outside the owning organization", async () => {
    const rr = await ok(partnerToken, "GET", `/api/v1/resource-requests/${requestId}/ics-213rr`);
    expect(rr.values).toMatchObject({ financeComments: "", financeSignature: "", financeAt: "" });
    expect(rr.values.order[0][7]).toBe("");
    expect(rr.values.requestNumber).toBe(`REQ-${requestNumber}`);
  });

  it("starts as a form of the period from the request, one per request, and goes into the period's IAP", async () => {
    const start = (payload: Record<string, unknown>, incident = incidentId) =>
      call(memberToken, "POST", `/api/v1/incidents/${incident}/ics-components`, { formId: "ICS-213RR", periodRevision: 1, ...payload });
    const created = await start({ requestId, label: "Ignored" });
    expect(created.statusCode, created.body).toBe(201);
    const component = created.json();
    expect(component).toMatchObject({ formId: "ICS-213RR", label: `REQ-${requestNumber}`, resourceRequestId: requestId, version: 1 });
    expect(component.values.requestNumber).toBe(`REQ-${requestNumber}`);
    expect(component.values.financeComments).toContain("Total: $1250.50");

    const again = await start({ requestId });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe(`this period already has an ICS 213RR named REQ-${requestNumber}`);
    const none = await start({});
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toBe("requestId: start an ICS 213RR from one of the incident's resource requests");
    const elsewhere = (await ok(memberToken, "POST", `/api/v1/jurisdictions/${hostId}/resource-requests`, {
      origin: "eoc", item: "Sandbags", incidentId: otherIncidentId,
    })).id as string;
    const wrong = await start({ requestId: elsewhere });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe("requestId: that resource request belongs to another incident");

    // Logistics fills a block the request does not hold; the name stays the request's number.
    const saved = await call(memberToken, "PUT", `/api/v1/ics-components/${component.id}`, {
      values: { ...component.values, deliveryLocation: "Weitchpec store, Highway 96" }, status: "ready", expectedVersion: 1, label: "Renamed",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ label: `REQ-${requestNumber}`, version: 2, status: "ready" });
    const list = await ok(memberToken, "GET", `/api/v1/incidents/${incidentId}/ics-components?periodRevision=1`);
    expect(list.components.map((c: { formId: string; label: string }) => `${c.formId} ${c.label}`)).toEqual([`ICS-213RR REQ-${requestNumber}`]);

    const plan = await call(memberToken, "POST", `/api/v1/incidents/${incidentId}/iap`, {
      operationalPeriod: "OP 1", periodRevision: 1, componentIds: [component.id],
    });
    expect(plan.statusCode, plan.body).toBe(201);
    expect(plan.json().content.forms.map((f: { id: string; title: string }) => `${f.id} ${f.title}`))
      .toEqual([`ICS-213RR Resource Request Message: REQ-${requestNumber}`]);
  });

  it("keeps a 213RR tied to its request, and no other form to any", async () => {
    const [component] = await admin`select id from ics_form_components where form_id = 'ICS-213RR'`;
    const other = (await ok(memberToken, "POST", `/api/v1/jurisdictions/${hostId}/resource-requests`, {
      origin: "eoc", item: "Generators", incidentId,
    })).id as string;
    await expect(withPerson(runtime, memberId, (tx) => tx`
      update ics_form_components set resource_request_id = ${other}, version = version + 1 where id = ${component!.id as string}`))
      .rejects.toThrow(/keeps its incident, period and form/);
    const started = await ok(memberToken, "POST", `/api/v1/incidents/${incidentId}/ics-components`, { formId: "ICS-202", periodRevision: 1 });
    await expect(withPerson(runtime, memberId, (tx) => tx`
      update ics_form_components set resource_request_id = ${other}, version = version + 1 where id = ${started.id as string}`))
      .rejects.toThrow(/ics_form_components_request_names_213rr/);
  });
});
