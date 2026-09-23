import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dictionaryValues } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureDemoData, type DemoResult } from "../demo/seed.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * Portable jurisdiction export (INV-9/INV-10, continuity): an admin pulls
 * the operational record as a .tar.gz that the system tar unpacks; a member
 * cannot. Proves the schema 1 sections still round-trip, every schema 2
 * section is present, file bytes match their hashes, and nothing from
 * another jurisdiction leaks in.
 */

type Row = Record<string, unknown>;
interface Unpacked {
  readonly doc: Row & { schemaVersion: number; jurisdiction: { id: string; slug: string } };
  readonly text: string;
  readonly files: Map<string, Buffer>;
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let demo: DemoResult;
let adminToken: string;
let memberToken: string;
let demoToken: string;
let yurokBoardId: string;
let yurokFileSha: string;
let demoFile: { sha256: string; bytes: Buffer };
let iapId: string;
const dirs: string[] = [];

function request(token: string, method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: method as "GET", url, headers: auth(token), ...(payload ? { payload } : {}) });
}

async function upload(token: string, jurisdictionId: string, name: string, bytes: Buffer, contentType: string) {
  const body = await multipartUpload({ name }, bytes, contentType);
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/files`,
    headers: { ...auth(token), ...body.headers },
    payload: body.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().sha256 as string;
}

/** Unpack an archive with the system tar, which proves it is a standard tar.gz. */
function unpack(archive: Buffer): Unpacked {
  const dir = mkdtempSync(join(tmpdir(), "openeoc-export-test-"));
  dirs.push(dir);
  execFileSync("tar", ["-xzf", "-"], { cwd: dir, input: archive });
  const text = readFileSync(join(dir, "export.json"), "utf8");
  const names = readdirSync(dir).includes("files") ? readdirSync(join(dir, "files")) : [];
  return {
    doc: JSON.parse(text) as Unpacked["doc"],
    text,
    files: new Map(names.map((name) => [name, readFileSync(join(dir, "files", name))])),
  };
}

async function exportAs(token: string, jurisdictionId: string): Promise<Unpacked> {
  const res = await request(token, "GET", `/api/v1/jurisdictions/${jurisdictionId}/export`);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.headers["content-type"]).toBe("application/gzip");
  return unpack(res.rawPayload);
}

beforeAll(async () => {
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-blobs-"));
  dirs.push(process.env.OPENEOC_DATA_DIR);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");

  const board = await request(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "road_closures" });
  yurokBoardId = board.json().id as string;
  await request(memberToken, "POST", `/api/v1/boards/${yurokBoardId}/records`, {
    road: "SR-169 at Pecwan",
    reason: "Active fire",
    status: "closed",
    location: { type: "Point", coordinates: [-123.61, 41.29] },
  });
  await request(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`, { period: "OP-1" });
  const lifeline = (dictionaryValues("lifelines.lifelines") ?? [])[0];
  const status = (dictionaryValues("lifelines.status") ?? [])[0];
  await request(adminToken, "PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`, { lifeline, status });
  const paItem = await request(memberToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`, {
    applicant: "Yurok Tribe Public Works", category: "c_roads_and_bridges", estimatedCostCents: 4_500_000,
    location: { lon: -123.61, lat: 41.29 },
  });
  expect(paItem.statusCode, paItem.body).toBe(201);
  yurokFileSha = await upload(memberToken, seed.jurisdictionId, "yurok-only.txt",
    Buffer.from("Yurok evacuation roster, not for other jurisdictions"), "text/plain");

  // A second jurisdiction whose admin is a stranger to the first.
  demo = await ensureDemoData(admin);
  demoToken = await tokenFor(app, "demo-admin@example.org", "correct-horse-battery");
  const incident = demo.incidentId;
  const iap = await request(demoToken, "POST", `/api/v1/incidents/${incident}/iap`,
    { operationalPeriod: "OP SYNTHETIC 1", formIds: ["ICS-202", "ICS-204"] });
  expect(iap.statusCode, iap.body).toBe(201);
  iapId = iap.json().id as string;
  const [operations] = await admin`
    select p.id from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incident} and p.key = 'operations_section_chief'`;
  const ics204 = await request(demoToken, "PUT", `/api/v1/iap/${iapId}/ics-204`, {
    expectedContentRevision: 1,
    assignments: [{
      name: "Division Alpha",
      supervisor: { kind: "position", positionId: operations!.id as string },
      tactics: ["Hold the ridge line"],
      resources: [],
    }],
  });
  expect(ics204.statusCode, ics204.body).toBe(200);
  const aar = await request(demoToken, "POST", `/api/v1/incidents/${incident}/aar`,
    { overview: "SYNTHETIC exercise review" });
  expect(aar.statusCode, aar.body).toBe(201);
  const action = await request(demoToken, "POST", `/api/v1/jurisdictions/${demo.jurisdictionId}/corrective-actions`,
    { incidentId: incident, capability: "operational_coordination", recommendation: "Stage generators earlier" });
  expect(action.statusCode, action.body).toBe(201);
  const cost = await request(demoToken, "POST", `/api/v1/resource-requests/${demo.resourceRequestId}/costs`,
    { category: "equipment", amountCents: 12500, incurredAt: "2026-09-20" });
  expect(cost.statusCode, cost.body).toBe(201);
  const participant = await request(demoToken, "POST", `/api/v1/incidents/${incident}/participants`, {
    organizationSlug: "yurok",
    personEmail: "member@example.org",
    incidentPositionTitle: "Mutual aid liaison",
    role: "viewer",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    reason: "SYNTHETIC exercise liaison",
  });
  expect(participant.statusCode, participant.body).toBe(201);
  const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(5000)]);
  demoFile = { sha256: await upload(demoToken, demo.jurisdictionId, "ridge-map.pdf", bytes, "application/pdf"), bytes };
}, 120_000);

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("jurisdiction export", () => {
  it("gives an admin the full operational record as a downloadable archive", async () => {
    const res = await request(adminToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/export`);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain("openeoc-yurok-export.tar.gz");
    const { doc } = unpack(res.rawPayload);
    const body = doc as unknown as {
      schemaVersion: number;
      jurisdiction: { slug: string };
      boards: Array<{ templateKey: string; records: Array<{ geometry: { type: string } | null }> }>;
      sitreps: unknown[];
      lifelines: unknown[];
    };
    expect(body.schemaVersion).toBe(2);
    expect(body.jurisdiction.slug).toBe("yurok");
    const roads = body.boards.find((b) => b.templateKey === "road_closures");
    expect(roads).toBeDefined();
    expect(roads!.records).toHaveLength(1);
    expect(roads!.records[0]!.geometry?.type).toBe("Point");
    expect(body.sitreps.length).toBeGreaterThanOrEqual(1);
    expect(body.lifelines.length).toBeGreaterThanOrEqual(1);
    // The Public Assistance inventory rides along as its own section, geometry as GeoJSON.
    const pa = doc.publicAssistanceItems as Row[];
    expect(pa).toMatchObject([{
      applicant: "Yurok Tribe Public Works", category: "c_roads_and_bridges", estimated_cost_cents: 4500000,
      status: "submitted", geometry: { type: "Point", coordinates: [-123.61, 41.29] },
    }]);
    expect(pa[0]).not.toHaveProperty("geom");
  });

  it("carries incidents, IAPs, AARs, resources, tasks, assessments and file bytes", async () => {
    const { doc, files } = await exportAs(demoToken, demo.jurisdictionId);
    const rows = (key: string) => doc[key] as Row[];

    const [incident] = rows("incidents");
    expect(rows("incidents")).toHaveLength(1);
    expect(incident!.id).toBe(demo.incidentId);
    expect((incident!.areas as Row[])[0]!.geometry).toMatchObject({ type: "Polygon" });
    expect(incident!.participants).toMatchObject([{ incident_position_title: "Mutual aid liaison", role: "viewer" }]);
    expect((incident!.board_ids as string[]).length).toBeGreaterThan(0);

    const [plan] = rows("iaps");
    expect(plan).toMatchObject({ id: iapId, revision_number: 1, revision_root_id: iapId, content_revision: 2 });
    expect(JSON.stringify(plan!.content)).toContain("Division Alpha");

    expect(rows("aars")).toMatchObject([{ incident_id: demo.incidentId }]);
    expect(rows("aarObservations")).toMatchObject([{ kind: "strength" }]);
    expect(rows("correctiveActions")).toMatchObject([{ recommendation: "Stage generators earlier" }]);

    const [requested] = rows("resourceRequests");
    expect(requested).toMatchObject({ id: demo.resourceRequestId, state: "triaged" });
    expect(requested!.costs).toMatchObject([{ category: "equipment", amount_cents: 12500 }]);
    // The seed writes both events in one transaction, so they share a timestamp.
    expect((requested!.history as Row[]).map((event) => event.to_state).sort()).toEqual(["submitted", "triaged"]);

    expect(rows("tasks").length).toBeGreaterThan(0);
    expect(rows("tasks").every((task) => task.incident_id === demo.incidentId && Array.isArray(task.prerequisite_task_ids)))
      .toBe(true);
    expect(new Set(rows("assessments").map((a) => a.domain))).toEqual(new Set(["lifeline", "esf"]));
    expect(rows("assessmentDecisions")).toEqual([]);
    expect(rows("publicAssistanceItems")).toEqual([]);

    expect(rows("files")).toMatchObject([
      { name: "ridge-map.pdf", sha256: demoFile.sha256, archive_path: `files/${demoFile.sha256}` },
    ]);
    const stored = files.get(demoFile.sha256)!;
    expect(createHash("sha256").update(stored).digest("hex")).toBe(demoFile.sha256);
    expect(stored.equals(demoFile.bytes)).toBe(true);
  });

  it("holds nothing from another jurisdiction", async () => {
    const demoExport = await exportAs(demoToken, demo.jurisdictionId);
    expect(demoExport.doc.jurisdiction.id).toBe(demo.jurisdictionId);
    // The demo incident's liaison comes from the first jurisdiction, so its id
    // may appear as that participant's organization; its records may not.
    for (const foreign of [yurokBoardId, yurokFileSha, "SR-169 at Pecwan", "yurok-only.txt", "Yurok Tribe Public Works"])
      expect(demoExport.text).not.toContain(foreign);
    expect([...demoExport.files.keys()]).toEqual([demoFile.sha256]);

    const yurokExport = await exportAs(adminToken, seed.jurisdictionId);
    expect(yurokExport.text).not.toContain(demo.incidentId);
    expect(yurokExport.text).not.toContain(demoFile.sha256);
    expect([...yurokExport.files.keys()]).toEqual([yurokFileSha]);
    expect(createHash("sha256").update(yurokExport.files.get(yurokFileSha)!).digest("hex")).toBe(yurokFileSha);

    const crossed = await request(adminToken, "GET", `/api/v1/jurisdictions/${demo.jurisdictionId}/export`);
    expect(crossed.statusCode).toBe(403);
  });

  it("refuses a non-admin member", async () => {
    const res = await request(memberToken, "GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/export`);
    expect(res.statusCode).toBe(403);
  });
});
