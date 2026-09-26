import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createJurisdiction } from "../auth/service.js";
import { resetRateLimit } from "../security/rate-limit.js";
import { auth } from "./browser.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Damage Assessment read by incident: an incident's list, summary and
 * Public Assistance items hold its own records and those recorded with no
 * incident, never another incident's; the public intake files reports under
 * the incident it was issued for. The filter runs in the reader's own
 * row-level security context, as every damage read does.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let token: string;
let jurisdictionId: string;
let storm: string;
let quake: string;
let elsewhere: string;
let adminId: string;

async function call(method: "GET" | "POST", url: string, payload?: Record<string, unknown>, headers: Record<string, string> = auth(token)) {
  const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { status: response.statusCode, body: response.body ? response.json() as Record<string, unknown> : {} };
}

const report = (address: string, incidentId?: string) => ({
  address, structureType: "single_family", degree: "major", estimatedLoss: 100_000, ...(incidentId ? { incidentId } : {}),
});
const lineItem = (applicant: string, incidentId: string | null) => ({
  incidentId, applicant, category: "a_debris_removal", estimatedCostCents: 1_000_00, status: "submitted",
});

beforeAll(async () => {
  resetRateLimit();
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  app = buildApp(runtime, { oidc: null });
  token = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const other = await createJurisdiction(admin, "far-county", "Far County OES");
  const rows = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${jurisdictionId}, 'Storm', 'exercise', ${seed.adminId}),
           (${jurisdictionId}, 'Quake', 'exercise', ${seed.adminId}),
           (${other}, 'Far fire', 'exercise', ${seed.adminId}) returning id`;
  [storm, quake, elsewhere] = rows.map((row) => row.id as string) as [string, string, string];
  const base = `/api/v1/jurisdictions/${jurisdictionId}/damage`;
  for (const [address, incidentId] of [["1 Storm Rd", storm], ["2 Quake Rd", quake], ["3 Quake Rd", quake], ["4 County Rd", undefined]] as const) {
    expect((await call("POST", `${base}/assessments`, report(address, incidentId))).status).toBe(201);
  }
  for (const [applicant, incidentId] of [["Storm applicant", storm], ["Quake applicant", quake], ["County applicant", null]] as const) {
    expect((await call("POST", `${base}/pa-items`, lineItem(applicant, incidentId))).status).toBe(201);
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const base = () => `/api/v1/jurisdictions/${jurisdictionId}/damage`;
const addresses = async (query: string) =>
  ((await call("GET", `${base()}/assessments${query}`)).body.assessments as { address: string }[]).map((row) => row.address).sort();
const applicants = async (query: string) =>
  ((await call("GET", `${base()}/pa-items${query}`)).body.items as { applicant: string }[]).map((row) => row.applicant).sort();

it("reads an incident's own reports and line items and the unscoped ones, never another incident's", async () => {
  expect(await addresses(`?incidentId=${storm}`)).toEqual(["1 Storm Rd", "4 County Rd"]);
  expect(await addresses(`?incidentId=${quake}`)).toEqual(["2 Quake Rd", "3 Quake Rd", "4 County Rd"]);
  expect(await addresses("")).toEqual(["1 Storm Rd", "2 Quake Rd", "3 Quake Rd", "4 County Rd"]);
  expect(await applicants(`?incidentId=${storm}`)).toEqual(["County applicant", "Storm applicant"]);
  expect(await applicants("")).toEqual(["County applicant", "Quake applicant", "Storm applicant"]);
});

it("counts the summary and the Public Assistance totals the same way", async () => {
  const thresholds = { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3 };
  const storms = (await call("POST", `${base()}/summary`, { ...thresholds, incidentId: storm })).body as { byDegree: Record<string, number>; publicAssistance: { items: number } };
  expect([storms.byDegree.major, storms.publicAssistance.items]).toEqual([2, 2]);
  const all = (await call("POST", `${base()}/summary`, thresholds)).body as { byDegree: Record<string, number>; publicAssistance: { items: number } };
  expect([all.byDegree.major, all.publicAssistance.items]).toEqual([4, 3]);
  const page = (await call("GET", `${base()}/pa-items?incidentId=${quake}`)).body as { totals: { items: number } };
  expect(page.totals.items).toBe(2);
});

it("files public reports under the incident the intake was issued for", async () => {
  const issued = await call("POST", `${base()}/intake/enable`, { incidentId: quake });
  expect(issued.status).toBe(201);
  const sent = await call("POST", `${base()}/report`, report("5 Public Rd"), { "x-intake-token": issued.body.token as string });
  expect(sent.status).toBe(202);
  expect(await addresses(`?incidentId=${quake}&status=submitted`)).toEqual(["5 Public Rd"]);
  expect(await addresses(`?incidentId=${storm}&status=submitted`)).toEqual([]);
});

it("refuses a report, a line item or an intake for another organization's incident", async () => {
  expect((await call("POST", `${base()}/assessments`, report("6 Far Rd", elsewhere))).status).toBe(400);
  expect((await call("POST", `${base()}/pa-items`, lineItem("Far applicant", elsewhere))).status).toBe(400);
  expect((await call("POST", `${base()}/intake/enable`, { incidentId: elsewhere })).status).toBe(400);
});

/** Close an incident as closeout does, and archive it too when asked. */
async function close(incidentId: string, archive = false): Promise<void> {
  await admin`
    update incidents set closed_at = now(), closed_by = ${adminId},
      archived_at = ${archive ? new Date() : null}, archived_by = ${archive ? adminId : null}
    where id = ${incidentId}`;
}

it("refuses reports, line items, edits and an intake in a closed or archived incident", async () => {
  const [ended] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by) values (${jurisdictionId}, 'Ended', 'exercise', ${adminId}) returning id`;
  const endedId = ended!.id as string;
  expect((await call("POST", `${base()}/pa-items`, lineItem("Ended applicant", endedId))).status).toBe(201);
  const [item] = await admin`select id from damage_pa_items where applicant = 'Ended applicant'`;
  for (const archive of [false, true]) {
    await close(endedId, archive);
    expect((await call("POST", `${base()}/assessments`, report("7 Ended Rd", endedId))).status).toBe(409);
    expect((await call("POST", `${base()}/pa-items`, lineItem("Late applicant", endedId))).status).toBe(409);
    expect((await call("POST", `${base()}/intake/enable`, { incidentId: endedId })).status).toBe(409);
    // Neither edited in place nor moved out of the closed incident.
    const edit = (incidentId: string | null) => app.inject({
      method: "PUT", url: `/api/v1/damage/pa-items/${item!.id as string}`, headers: auth(token), payload: lineItem("Ended applicant", incidentId),
    });
    expect((await edit(endedId)).statusCode).toBe(409);
    expect((await edit(null)).statusCode).toBe(409);
  }
});

it("stops the intake filing into its incident once it closes, answering as a wrong token does", async () => {
  const [flood] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by) values (${jurisdictionId}, 'Flood', 'exercise', ${adminId}) returning id`;
  const floodId = flood!.id as string;
  const issued = (await call("POST", `${base()}/intake/enable`, { incidentId: floodId })).body.token as string;
  const send = (address: string, intakeToken: string) => app.inject({
    method: "POST", url: `${base()}/report`, headers: { "x-intake-token": intakeToken }, payload: report(address),
  });
  expect((await send("8 Flood Rd", issued)).statusCode).toBe(202);
  const [queued] = await admin`select id from damage_assessments where address = '8 Flood Rd'`;
  await close(floodId);
  const refused = await send("9 Flood Rd", issued);
  const wrong = await send("9 Flood Rd", "not-the-token");
  expect([refused.statusCode, refused.body]).toEqual([wrong.statusCode, wrong.body]);
  expect(refused.statusCode).toBe(401);
  // The report queued before closeout is neither accepted nor rejected after it: the figures hold at the one unscoped major report.
  const moderate = (decision: string) =>
    call("POST", `/api/v1/damage/assessments/${queued!.id as string}/moderate`, { decision });
  expect((await moderate("approved")).status).toBe(409);
  expect((await moderate("rejected")).status).toBe(409);
  const figures = (await call("POST", `${base()}/summary`, { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3, incidentId: floodId })).body;
  expect((figures.byDegree as Record<string, number>).major).toBe(1);
});

it("names the incident in the declaration from the incident the figures count, not from free text", async () => {
  const thresholds = { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3 };
  const named = await call("POST", `${base()}/declaration`, { ...thresholds, incidentId: storm, incident: "Some other incident" });
  expect(named.status).toBe(200);
  expect(named.body.document as string).toContain("Incident: Storm");
  expect(named.body.document as string).not.toContain("Some other incident");
  expect((await call("POST", `${base()}/declaration`, thresholds)).status).toBe(400);
  expect((await call("POST", `${base()}/declaration`, { ...thresholds, incidentId: elsewhere })).status).toBe(400);
});
