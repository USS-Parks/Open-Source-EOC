import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { generateSigningKeyPair } from "../boards/package.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signSolutionPackage } from "../data-packs/solution.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The hotline and shelter registration pack (VC-21), as shipped in
 * deploy/packs, signed and imported on a fresh profile: its evacuation and
 * sheltering activation opens both boards with their reports, escalation
 * rules and dashboard. A member logs a hotline call and registers a
 * household; the escalation reaches Operations without the caller's details;
 * a viewer reads the call's topic but not who called, and no registration.
 * A pack changed after signing is refused and imports nothing.
 */

const PACK = join(import.meta.dirname, "..", "..", "..", "deploy", "packs", "hotline-and-shelter", "package.json");
const pack = JSON.parse(readFileSync(PACK, "utf8"));
const publisher = generateSigningKeyPair();
const keyDir = mkdtempSync(join(tmpdir(), "openeoc-hotline-"));
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let incidentId: string;
let priorKeys: string | undefined;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  ({ jurisdictionId, adminId } = seed);
  await admin`update persons set is_instance_admin = true where id = ${adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-test-password" });
  await addMembership(admin, viewerId, jurisdictionId, "viewer");
  writeFileSync(join(keyDir, "publishers.pem"), `${publisher.publicKeyPem}\n`);
  priorKeys = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = join(keyDir, "publishers.pem");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-test-password");
});

afterAll(async () => {
  if (priorKeys === undefined) delete process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  else process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = priorKeys;
  rmSync(keyDir, { recursive: true, force: true });
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as never }) });
const importPack = (signed: unknown) => call("POST", `/api/v1/jurisdictions/${jurisdictionId}/solution-packages`, adminToken, signed);
const boardOf = async (templateKey: string) => (await admin`
  select b.id from incident_boards ib join boards b on b.id = ib.board_id
  where ib.incident_id = ${incidentId} and b.template_key = ${templateKey}`)[0]!.id as string;

describe("the hotline and shelter registration pack", () => {
  it("refuses the pack changed after signing and imports nothing", async () => {
    const signed = signSolutionPackage(pack, publisher.privateKeyPem);
    // Loosening who reads registrations is exactly the change a signature must catch.
    const tampered = structuredClone(signed);
    delete (tampered.contents.boardTemplates[1] as { recordAccess?: unknown }).recordAccess;
    const refused = await importPack(tampered);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/changed after it was signed/);
    expect(await admin`select 1 from board_templates where key in ('hotline_log', 'shelter_registrations')`).toHaveLength(0);
  });

  it("imports on a fresh profile and activates an incident with both boards, their reports, rules and dashboard", async () => {
    const imported = await importPack(signSolutionPackage(pack, publisher.privateKeyPem));
    expect(imported.statusCode, imported.body).toBe(201);
    const created = imported.json().parts as Record<string, { created: string[] }>;
    expect(Object.fromEntries(Object.entries(created).map(([kind, part]) => [kind, part.created.length]))).toEqual({
      boardTemplates: 2, incidentTemplates: 1, forms: 0, dashboardTemplates: 1, reportTemplates: 4, ruleTemplates: 2,
    });

    // The import checks report and rule fields but not a dashboard's, so every widget field is held to its board here.
    for (const widget of pack.contents.dashboardTemplates[0].widgets) {
      const [board] = await admin`select definition from board_templates where key = ${widget.board} order by version desc limit 1`;
      const fields = new Set((board!.definition.fields as Array<{ key: string }>).map((field) => field.key));
      const named = [widget.filter?.field, widget.groupBy, ...(widget.columns ?? [])].filter(Boolean);
      expect(named.filter((field) => !fields.has(field)), widget.key).toEqual([]);
    }

    const opened = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, adminToken,
      { templateKey: "evacuation_and_sheltering", name: "River flood" });
    expect(opened.statusCode, opened.body).toBe(201);
    expect(opened.json()).toMatchObject({
      positions: 10, boards: 8, checklistItems: 21, contactGroups: 0, reports: 4, rules: 2, dashboards: 1, threads: 3, fileFolders: 2,
    });
    incidentId = opened.json().incidentId as string;
    const titles = await admin`select key, title from positions where jurisdiction_id = ${jurisdictionId} and key in ('hotline_supervisor', 'mass_care_coordinator') order by key`;
    expect(titles.map((row) => row.title)).toEqual(["Hotline Supervisor", "Mass Care Coordinator"]);
    const boards = await admin`
      select b.template_key, b.title from incident_boards ib join boards b on b.id = ib.board_id
      where ib.incident_id = ${incidentId} and b.template_key in ('hotline_log', 'shelter_registrations') order by b.template_key`;
    expect(boards.map((row) => row.title)).toEqual(["River flood: Hotline and Inquiry Log", "River flood: Shelter Registrations"]);
    const reports = await admin`select name, schedule from reports where incident_id = ${incidentId} order by name`;
    // On demand only: a stored report file would outlive the record rules that keep registrations from viewers.
    expect(reports.map((row) => [row.name, row.schedule])).toEqual([
      ["River flood: Hotline follow-up", null], ["River flood: Hotline topics", null],
      ["River flood: Shelter needs", null], ["River flood: Shelter roster", null],
    ]);
  });

  it("takes a hotline call and a shelter registration, escalates the call without who called, and keeps registrations from viewers", async () => {
    const hotline = await boardOf("hotline_log");
    const shelters = await boardOf("shelter_registrations");
    const [ops] = await admin`select id from positions where jurisdiction_id = ${jurisdictionId} and key = 'operations_section_chief'`;
    await admin`insert into position_assignments (position_id, person_id, assigned_by) values (${ops!.id}, ${adminId}, ${adminId})`;

    const record = (board: string, data: Record<string, unknown>) =>
      call("POST", `/api/v1/boards/${board}/records?incidentId=${incidentId}`, memberToken, data);
    const escalated = await record(hotline, {
      received_at: "2026-09-25T14:05:00-07:00", channel: "phone", caller_name: "Dana Pryor", caller_contact: "707-555-0142",
      area: "Riverside", category: "evacuation", question: "My neighbor uses a wheelchair and has no ride out",
      answer: "Passed to Operations for a ride", status: "escalated", follow_up_by: "Operations",
    });
    expect(escalated.statusCode, escalated.body).toBe(201);
    const rumor = await record(hotline, {
      received_at: "2026-09-25T14:20:00-07:00", channel: "text_message", area: "Valley", category: "rumor",
      question: "Is the dam about to fail?", status: "follow_up", follow_up_by: "PIO", follow_up_due: "2026-09-25T16:00:00-07:00",
    });
    expect(rumor.statusCode, rumor.body).toBe(201);
    const registered = await record(shelters, {
      arrived_at: "2026-09-25T15:10:00-07:00", shelter: "Valley School gym", space: "Cot 14", household_head: "Jordan Lee",
      members: "Casey Lee, 9\nMorgan Lee, 71", people: 3, children: 1, contact: "707-555-0199", home_area: "Riverside",
      needs_health: true, needs_independence: true, needs_detail: "Power for an oxygen concentrator; a walker",
      referral: "shelter_health_staff", pets: 1, pet_details: "One dog, crated in the pet area", share_consent: false,
      reunification: "looking_for_someone", looking_for: "Riley Lee, 34, last seen at work downtown", status: "in_shelter",
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const departed = await record(shelters, {
      arrived_at: "2026-09-25T13:00:00-07:00", shelter: "Valley School gym", household_head: "Avery Stone", people: 2,
      status: "departed", departed_at: "2026-09-25T18:00:00-07:00", departed_to: "Relatives out of the area",
    });
    expect(departed.statusCode, departed.body).toBe(201);

    // Operations hears of the escalation, and of one escalated later, in words any board reader may see.
    expect((await call("PATCH", `/api/v1/boards/${hotline}/records/${rumor.json().id}?incidentId=${incidentId}`, memberToken,
      { status: "escalated" })).statusCode).toBe(200);
    const told = await admin`select channel, title, body from notifications where person_id = ${adminId} and channel = 'inapp' order by created_at`;
    expect(told.map((row) => row.title)).toEqual([
      "New River flood: Hotline and Inquiry Log record: Riverside",
      "River flood: Hotline and Inquiry Log record updated: Valley",
    ]);
    expect(told[1]!.body).toContain("Status: Escalated (was Follow up)");
    const outbound = await admin`select body from delivery_outbox where jurisdiction_id = ${jurisdictionId}`;
    for (const text of [...told.map((row) => `${row.title}\n${row.body}`), ...outbound.map((row) => row.body as string)]) {
      for (const secret of ["Dana", "555", "wheelchair", "Is the dam"]) expect(text).not.toContain(secret);
    }

    // Members read every registration; a viewer reads none, and reads the calls' topics.
    const view = async (board: string, token: string) => {
      const response = await call("GET", `/api/v1/boards/${board}/views/all?incidentId=${incidentId}`, token);
      expect(response.statusCode, response.body).toBe(200);
      return response.json().records as Array<Record<string, unknown>>;
    };
    expect((await view(shelters, memberToken)).map((row) => row.household_head).sort()).toEqual(["Avery Stone", "Jordan Lee"]);
    expect(await view(shelters, viewerToken)).toEqual([]);
    expect((await view(hotline, viewerToken)).map((row) => row.category).sort()).toEqual(["evacuation", "rumor"]);

    // The reports, as the member and as the viewer: the viewer's leave out who called and what they asked.
    const reportIds = Object.fromEntries((await admin`select id, name from reports where incident_id = ${incidentId}`)
      .map((row) => [(row.name as string).replace("River flood: ", ""), row.id as string]));
    const output = async (name: string, token: string) => {
      const response = await call("GET", `/api/v1/reports/${reportIds[name]}/output`, token);
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    const roster = await output("Shelter roster", memberToken);
    expect(roster.rows.map((row: { household_head: string }) => row.household_head)).toEqual(["Jordan Lee"]);
    expect(roster.total.totals).toMatchObject({ "people:sum": 3, "children:sum": 1, "pets:sum": 1 });
    expect((await output("Shelter needs", memberToken)).rows[0]).toMatchObject({ needs_health: true, needs_independence: true, referral: "shelter_health_staff" });
    expect((await output("Hotline follow-up", memberToken)).rows.map((row: { caller_name?: string }) => row.caller_name ?? "").sort())
      .toEqual(["", "Dana Pryor"]);
    expect((await output("Shelter roster", viewerToken)).rows).toEqual([]);
    expect((await output("Hotline follow-up", viewerToken)).omitted).toEqual(["caller_name", "caller_contact", "question"]);

    // The dashboard counts what the member entered.
    const [dashboard] = await admin`select dashboard_id from incident_dashboards where incident_id = ${incidentId}`;
    const data = await call("GET", `/api/v1/dashboards/${dashboard!.dashboard_id}/data?incidentId=${incidentId}`, memberToken);
    expect(data.statusCode, data.body).toBe(200);
    const widgets = Object.fromEntries((data.json().widgets as Array<{ key: string }>).map((widget) => [widget.key, widget]));
    expect(widgets.calls_escalated).toMatchObject({ value: 2, level: "warn" });
    expect(widgets.calls_follow_up).toMatchObject({ value: 0 });
    expect(widgets.households_in_shelter).toMatchObject({ value: 1 });
    expect(widgets.looking_for_someone).toMatchObject({ value: 1, level: "warn" });
    expect(widgets.households_by_shelter).toMatchObject({ groups: [{ value: "Valley School gym", count: 1 }] });
  });
});
