import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { generateSigningKeyPair } from "../boards/package.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signSolutionPackage } from "../data-packs/solution.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * VA12: the small EOC starter pack, as shipped in deploy/packs, signed and
 * imported on a fresh profile, activates an incident with its positions,
 * boards, checklists, contact groups, reports and notification rules, with
 * no configuration. Its incident templates are held to what activation can
 * make: a template naming a report on a board it does not open, or a rule
 * reaching a group it does not name, is refused when saved.
 */

const PACK = join(import.meta.dirname, "..", "..", "..", "deploy", "packs", "small-eoc-starter", "package.json");
const publisher = generateSigningKeyPair();
const keyDir = mkdtempSync(join(tmpdir(), "openeoc-starter-"));
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let token: string;
let priorKeys: string | undefined;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  writeFileSync(join(keyDir, "publishers.pem"), `${publisher.publicKeyPem}\n`);
  priorKeys = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = join(keyDir, "publishers.pem");
  app = buildApp(runtime, { oidc: null });
  token = await tokenFor(app, "admin@example.org", "correct-horse-battery");
});

afterAll(async () => {
  if (priorKeys === undefined) delete process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  else process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = priorKeys;
  rmSync(keyDir, { recursive: true, force: true });
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const activate = (templateKey: string, name: string, kind = "incident") => app.inject({
  method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`, headers: auth(token), payload: { templateKey, name, kind },
});

describe("the small EOC starter pack", () => {
  it("imports on a fresh profile and activates an incident with everything it names, with no configuration", async () => {
    const pkg = signSolutionPackage(JSON.parse(readFileSync(PACK, "utf8")), publisher.privateKeyPem);
    const imported = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/solution-packages`,
      headers: auth(token), payload: pkg });
    expect(imported.statusCode, imported.body).toBe(201);
    const created = imported.json().parts as Record<string, { created: string[] }>;
    expect(Object.fromEntries(Object.entries(created).map(([kind, part]) => [kind, part.created.length]))).toEqual({
      boardTemplates: 1, incidentTemplates: 2, forms: 1, dashboardTemplates: 1, reportTemplates: 3, ruleTemplates: 2,
    });

    const opened = await activate("small_eoc_activation", "Winter storm");
    expect(opened.statusCode, opened.body).toBe(201);
    expect(opened.json()).toMatchObject({ positions: 9, boards: 7, checklistItems: 29, contactGroups: 2, reports: 3, rules: 2 });
    const incidentId = opened.json().incidentId as string;

    const positions = await admin`
      select p.key, p.title from incident_positions ip join positions p on p.id = ip.position_id
      where ip.incident_id = ${incidentId} order by p.key`;
    expect(positions.map((row) => row.key)).toContain("community_liaison");
    expect(positions.find((row) => row.key === "community_liaison")!.title).toBe("Community Liaison");
    const boards = await admin`
      select b.template_key, b.title from incident_boards ib join boards b on b.id = ib.board_id
      where ib.incident_id = ${incidentId} order by b.template_key`;
    expect(boards.map((row) => row.template_key)).toEqual([
      "activity_log", "resource_request", "road_closures", "shelters", "significant_events", "situation_report", "welfare_checks",
    ]);
    expect(boards.find((row) => row.template_key === "welfare_checks")!.title).toBe("Winter storm: Welfare Checks");
    // Timed checklist items are due from the activation; a dependent one waits on its prerequisite.
    const [firstMessage] = await admin`
      select extract(epoch from due_at - (select activated_at from incidents where id = ${incidentId}))::int as after
      from checklist_items where incident_id = ${incidentId} and item like 'Issue the first public message%'`;
    expect(firstMessage!.after).toBe(3600);
    expect(await admin`
      select 1 from checklist_task_dependencies d join checklist_items i on i.id = d.task_id
      where i.incident_id = ${incidentId} and i.item = 'Hold the first briefing'`).toHaveLength(1);

    const groups = await admin`select name from contact_groups where jurisdiction_id = ${jurisdictionId} order by name`;
    expect(groups.map((row) => row.name)).toEqual(["Community outreach", "EOC command and general staff"]);
    const reports = await admin`
      select r.name, r.schedule, b.template_key from reports r join boards b on b.id = r.board_id
      where r.incident_id = ${incidentId} order by r.name`;
    expect(reports.map((row) => [row.name, row.template_key])).toEqual([
      ["Winter storm: Open resource requests", "resource_request"],
      ["Winter storm: Shelter census", "shelters"],
      ["Winter storm: Welfare follow-up", "welfare_checks"],
    ]);
    // A scheduled report stores its file; recipients are the jurisdiction's to add.
    expect(reports[1]!.schedule).toMatchObject({ cadence: { kind: "interval", minutes: 720 }, format: "pdf", storeFile: true, emails: [] });
    const rules = await admin`
      select r.event, r.condition, r.channels, b.template_key from notification_rules r join boards b on b.id = r.board_id
      where b.id in (select board_id from incident_boards where incident_id = ${incidentId}) order by b.template_key`;
    expect(rules.map((row) => [row.template_key, row.event])).toEqual([["resource_request", "record.created"], ["welfare_checks", "record.updated"]]);
    const [logistics] = await admin`select id from positions where jurisdiction_id = ${jurisdictionId} and key = 'logistics_section_chief'`;
    expect(rules[0]!.channels).toEqual([{ kind: "position", positionId: logistics!.id, reach: "holders", via: ["inapp", "email"] }]);
    const [outreach] = await admin`select id from contact_groups where jurisdiction_id = ${jurisdictionId} and name = 'Community outreach'`;
    expect(rules[1]!.channels).toContainEqual({ kind: "group", groupId: outreach!.id, via: ["inapp"] });
    expect(await admin`select 1 from form_definitions where jurisdiction_id = ${jurisdictionId} and key = 'welfare_check'`).toHaveLength(1);
  });

  it("fills a new contact group with the jurisdiction's contacts at its positions, in order, and uses one it already has", async () => {
    const position = async (key: string) => (await admin`select id from positions where jurisdiction_id = ${jurisdictionId} and key = ${key}`)[0]!.id as string;
    for (const [name, key] of [["Pat Ops", "operations_section_chief"], ["Ada Command", "incident_commander"], ["Lee Planning", "planning_section_chief"]] as const) {
      const response = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/contacts`, headers: auth(token),
        payload: { name, emails: [`${name.split(" ")[0]!.toLowerCase()}@example.org`], positionId: await position(key) } });
      expect(response.statusCode, response.body).toBe(201);
    }
    const exercise = await activate("small_eoc_tabletop", "Spring tabletop", "exercise");
    expect(exercise.statusCode, exercise.body).toBe(201);
    expect(exercise.json()).toMatchObject({ positions: 6, contactGroups: 1, reports: 1, rules: 0 });
    const members = await admin`
      select c.name, m.priority from contact_group_members m join contact_groups g on g.id = m.group_id join contacts c on c.id = m.contact_id
      where g.jurisdiction_id = ${jurisdictionId} and g.name = 'Exercise players' order by m.priority`;
    expect(members.map((row) => row.name)).toEqual(["Ada Command", "Pat Ops", "Lee Planning"]);

    // A second activation uses the groups the first made; its reports and rules are its own.
    const again = await activate("small_eoc_activation", "Spring flood");
    expect(again.json()).toMatchObject({ contactGroups: 0, reports: 3, rules: 2 });
    expect((await admin`select count(*)::int as n from contact_groups where jurisdiction_id = ${jurisdictionId}`)[0]!.n).toBe(3);
  });

  it("refuses to save an incident template naming parts activation could not make", async () => {
    const save = (template: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/v1/incident-templates/pack_check",
      headers: auth(token), payload: { expectedVersion: 0, template: { title: "Check", positions: ["incident_commander"], checklists: [], ...template } } });
    const offBoard = await save({ boards: ["activity_log"], reports: ["shelter_census"] });
    expect(offBoard.statusCode).toBe(400);
    expect(offBoard.json().error).toBe("reports: shelter_census runs on board template shelters, which this template does not open");
    const noGroup = await save({ boards: ["welfare_checks"], positions: ["incident_commander", "operations_section_chief"], rules: ["welfare_needs_help"] });
    expect(noGroup.json().error).toBe("rules: welfare_needs_help reaches the contact group Community outreach, which is not one of the template's contact groups");
    const strangerPosition = await save({ boards: ["activity_log"], contactGroups: [{ name: "Staff", positions: ["safety_officer"] }] });
    expect(strangerPosition.json().error).toBe("contactGroups: safety_officer in Staff is not one of the template's positions");
    expect((await save({ boards: ["activity_log"], reports: ["no_such_report"] })).json().error).toBe("reports: no report template no_such_report");
  });
});
