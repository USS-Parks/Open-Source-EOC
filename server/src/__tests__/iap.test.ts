import type { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * ICS forms and the IAP builder (F5). An IAP for the demo incident
 * assembles from the current org chart and assignments with only objectives
 * and the operational period supplied by hand; the 214 derives from the
 * activity log automatically; command approves; and it exports to PDF.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let memberId: string;
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
  adminId = seed.adminId;
  memberId = seed.memberId;
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

  const act = await api("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "Bald Hills Fire",
  });
  incidentId = act.json().incidentId as string;
  const detail = (await api("GET", `/api/v1/incidents/${incidentId}`)).json();
  const posId = (key: string): string =>
    detail.positions.find((p: { key: string; id: string }) => p.key === key).id;
  await api("POST", `/api/v1/positions/${posId("incident_commander")}/assignments`, { personId: adminId });
  await api("POST", `/api/v1/positions/${posId("operations_section_chief")}/assignments`, { personId: memberId });

  // Log two activity-log entries so the 214 has something to derive from.
  const logBoard = detail.boards.find((b: { id: string; title: string }) => b.title.endsWith("activity_log")).id;
  await api("POST", `/api/v1/boards/${logBoard}/records`, { entry: "Assumed command" });
  await api("POST", `/api/v1/boards/${logBoard}/records`, { entry: "Set initial objectives" });
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

describe("ICS form prefill from live data", () => {
  it("prefills the 203 from current assignments", async () => {
    const res = await api("GET", `/api/v1/incidents/${incidentId}/ics-forms/ICS-203?period=OP%201`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().sections[0].rows as string[][];
    expect(rows).toContainEqual(["Incident Commander", "Admin"]);
    expect(rows).toContainEqual(["Operations Section Chief", "Member"]);
  });

  it("derives the 214 from the activity log automatically", async () => {
    const res = await api("GET", `/api/v1/incidents/${incidentId}/ics-forms/ICS-214?period=OP%201`);
    const rows = res.json().sections[0].rows as string[][];
    expect(rows.map((r) => r[1])).toEqual(["Assumed command", "Set initial objectives"]);
  });
});

describe("IAP assembly, approval, and PDF export", () => {
  let iapId: string;

  it("assembles the operational period from live data with minimal input", async () => {
    const res = await api("POST", `/api/v1/incidents/${incidentId}/iap`, {
      operationalPeriod: "OP 1 (0600-1800)",
      objectives: ["Protect life safety", "Establish the operational period"],
    });
    expect(res.statusCode).toBe(201);
    iapId = res.json().id as string;
    const content = res.json().content;
    // The default IAP form set, in order.
    expect(content.forms.map((f: { id: string }) => f.id)).toEqual([
      "ICS-202",
      "ICS-203",
      "ICS-204",
      "ICS-205",
      "ICS-206",
      "ICS-207",
      "ICS-208",
    ]);
    const org = content.forms.find((f: { id: string }) => f.id === "ICS-203").sections[0].rows;
    expect(org).toContainEqual(["Incident Commander", "Admin"]);
    const objectives = content.forms.find((f: { id: string }) => f.id === "ICS-202").sections[0].lines;
    expect(objectives).toContain("Protect life safety");
  });

  it("requires command approval and then exports a valid PDF", async () => {
    const approve = await api("POST", `/api/v1/iap/${iapId}/approve`);
    expect(approve.statusCode).toBe(200);
    const fetched = await api("GET", `/api/v1/iap/${iapId}`);
    expect(fetched.json().status).toBe("approved");

    const pdf = await api("GET", `/api/v1/iap/${iapId}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    const rawPdfText = pdf.rawPayload.toString("latin1");
    const pdfText = [...rawPdfText.matchAll(/\((.*?)\) Tj/g)]
      .map((match) => match[1]!.replace(/\\([\\()])/g, "$1"))
      .join(" ");
    expect(pdfText).toContain("Open Source EOC");
    expect(pdfText).toContain("Incident: Bald Hills Fire");
    expect(pdfText).toContain("Operational period: OP 1 (0600-1800)");
    expect(pdfText).toContain("Source: Stored IAP snapshot");
    expect(pdfText).toMatch(/Source time: \d{4}-\d{2}-\d{2}T/);
    expect(pdfText).toContain("Revision: IAP revision 1; content revision 1; status approved");
    expect(pdfText).toContain("Page 1 of ");
    expect(pdfText).not.toContain("Handling:");

    const proofDir = process.env.OPENEOC_IAP_PROOF_DIR;
    if (proofDir) {
      await mkdir(proofDir, { recursive: true });
      await writeFile(join(proofDir, "iap-approved.pdf"), pdf.rawPayload);
    }
  });
});

describe("the IAP working list and its five-state workflow", () => {
  let iapId: string;

  const findIap = async (id: string) => {
    const list = (await api("GET", `/api/v1/incidents/${incidentId}/iaps`)).json();
    return list.iaps.find((i: { id: string }) => i.id === id);
  };

  it("lists a fresh plan as in progress with a full progress bar", async () => {
    iapId = (
      await api("POST", `/api/v1/incidents/${incidentId}/iap`, {
        operationalPeriod: "OP 2 (1800-0600)",
        objectives: ["Hold the line"],
      })
    ).json().id as string;
    const row = await findIap(iapId);
    expect(row.status).toBe("in_progress");
    expect(row.formCount).toBe(7);
    expect(row.targetForms).toBe(7);
    expect(row.preparedBy).toBe("Admin");
    expect(row.approvedBy).toBeNull();
  });

  it("advances submit -> approve -> complete and blocks illegal transitions", async () => {
    // Complete cannot skip approval.
    expect((await api("POST", `/api/v1/iap/${iapId}/complete`)).statusCode).toBe(409);

    expect((await api("POST", `/api/v1/iap/${iapId}/submit`)).statusCode).toBe(200);
    expect((await findIap(iapId)).status).toBe("in_approval");
    // A plan already in approval cannot be submitted again.
    expect((await api("POST", `/api/v1/iap/${iapId}/submit`)).statusCode).toBe(409);

    expect((await api("POST", `/api/v1/iap/${iapId}/approve`)).statusCode).toBe(200);
    let row = await findIap(iapId);
    expect(row.status).toBe("approved");
    expect(row.approvedBy).toBe("Admin");

    expect((await api("POST", `/api/v1/iap/${iapId}/complete`)).statusCode).toBe(200);
    row = await findIap(iapId);
    expect(row.status).toBe("complete");
    // A complete plan cannot be approved again.
    expect((await api("POST", `/api/v1/iap/${iapId}/approve`)).statusCode).toBe(409);
  });
});
