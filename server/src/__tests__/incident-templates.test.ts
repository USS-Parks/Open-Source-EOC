import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Incident templates as data (Veoci and air gap VA6). The activation list
 * reads the database; an instance administrator authors a template and saves
 * new versions over the version they opened; every version is kept,
 * append-only; an incident records the version it opened from, and a later
 * edit changes no incident.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let instanceToken: string;
let jurisdictionAdminToken: string;
let memberToken: string;

const tsunami = {
  title: "Tsunami Warning",
  positions: ["incident_commander", "operations_section_chief", "tribal_liaison"],
  positionTitles: { tribal_liaison: "Tribal Liaison" },
  boards: ["significant_events", "activity_log"],
  checklists: [
    {
      position: "incident_commander",
      items: [
        "Sound the tsunami warning",
        { item: "Confirm the evacuation routes are open", category: "evacuation", key: "routes" },
        { item: "Open the high-ground shelter", category: "sheltering", dependsOn: ["routes"] },
      ],
    },
    { position: "tribal_liaison", items: ["Call the village representatives"] },
  ],
};

async function save(token: string, key: string, template: unknown, expectedVersion: number) {
  return app.inject({
    method: "PUT", url: `/api/v1/incident-templates/${key}`, headers: auth(token), payload: { template, expectedVersion },
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  const second = await createPerson(admin, { email: "county-admin@example.org", displayName: "County Admin", password: "county-admin-password" });
  await addMembership(admin, second, jurisdictionId, "admin");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  instanceToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  jurisdictionAdminToken = await tokenFor(app, "county-admin@example.org", "county-admin-password");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("incident templates as data", () => {
  it("lists the templates in the database, each seeded one at version 1 with its history", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/incident-templates", headers: auth(memberToken) });
    expect(res.statusCode, res.body).toBe(200);
    const wildfire = res.json().templates.find((t: { key: string }) => t.key === "wildfire");
    expect(wildfire).toMatchObject({ key: "wildfire", title: "Wildfire", version: 1, positions: 8, boards: 6, checklistItems: 7 });
    const history = await app.inject({ method: "GET", url: "/api/v1/incident-templates/wildfire/versions", headers: auth(memberToken) });
    expect(history.json().versions).toEqual([
      expect.objectContaining({ version: 1, title: "Wildfire", savedBy: null }),
    ]);
  });

  it("lets an instance administrator author a template and save new versions over the one opened", async () => {
    const created = await save(instanceToken, "tsunami_warning", tsunami, 0);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toEqual({ key: "tsunami_warning", version: 1 });

    const second = { ...tsunami, checklists: [...tsunami.checklists, { position: "operations_section_chief", items: ["Stage the swift-water team"] }] };
    const saved = await save(instanceToken, "tsunami_warning", second, 1);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ key: "tsunami_warning", version: 2 });

    // A save over the version someone else replaced is refused, not lost.
    const stale = await save(instanceToken, "tsunami_warning", tsunami, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("the template changed after it was opened: version 2 is current");
    expect((await save(instanceToken, "tsunami_warning", tsunami, 0)).statusCode).toBe(409);

    const current = await app.inject({ method: "GET", url: "/api/v1/incident-templates/tsunami_warning", headers: auth(memberToken) });
    expect(current.json()).toMatchObject({ version: 2, template: { key: "tsunami_warning", title: "Tsunami Warning" } });
    expect(current.json().template.checklists).toHaveLength(3);
    const history = await app.inject({ method: "GET", url: "/api/v1/incident-templates/tsunami_warning/versions", headers: auth(memberToken) });
    expect(history.json().versions.map((v: { version: number; savedBy: string }) => [v.version, v.savedBy])).toEqual([[2, "Admin"], [1, "Admin"]]);
  });

  it("refuses anyone but an instance administrator, and a template that would not activate", async () => {
    expect((await save(jurisdictionAdminToken, "flood_watch", tsunami, 0)).statusCode).toBe(403);
    expect((await save(memberToken, "flood_watch", tsunami, 0)).statusCode).toBe(403);
    const refused = async (template: unknown, message: string) => {
      const res = await save(instanceToken, "flood_watch", template, 0);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error).toBe(message);
    };
    await refused({ ...tsunami, boards: ["significant_events", "levee_gauges"] }, "boards: no board template levee_gauges");
    await refused({ ...tsunami, checklists: [{ position: "safety_officer", items: ["Brief the crews"] }] },
      "checklists: safety_officer is not one of the template's positions");
    await refused({ ...tsunami, positions: ["incident_commander", "incident_commander"] }, "positions: incident_commander is listed twice");
    await refused({ ...tsunami, positionTitles: { planning_section_chief: "Planner" } },
      "positionTitles: planning_section_chief is not one of the template's positions");
    await refused({ ...tsunami, checklists: [{ position: "incident_commander", items: [
      { item: "A", key: "a", dependsOn: ["b"] }, { item: "B", key: "b", dependsOn: ["a"] },
    ] }] }, "checklists: checklist task dependencies must not contain a cycle");
    expect((await save(instanceToken, "Flood-Watch", tsunami, 0)).statusCode).toBe(400);
    const [none] = await admin`select count(*)::int as n from incident_templates where key = 'flood_watch'`;
    expect(none!.n).toBe(0);
  });

  it("opens an incident from the current version and records it; a later edit changes no incident", async () => {
    const activated = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`, headers: auth(instanceToken),
      payload: { templateKey: "tsunami_warning", name: "Klamath tsunami warning" },
    });
    expect(activated.statusCode, activated.body).toBe(201);
    const incidentId = activated.json().incidentId as string;
    expect(activated.json()).toMatchObject({ positions: 3, boards: 2, checklistItems: 5 });
    const detail = (await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}`, headers: auth(instanceToken) })).json();
    expect(detail).toMatchObject({ templateKey: "tsunami_warning", templateVersion: 2 });
    expect(detail.positions.map((p: { title: string }) => p.title).sort())
      .toEqual(["Incident Commander", "Operations Section Chief", "Tribal Liaison"]);
    const [audit] = await admin`select payload from audit_events where category = 'incident.activated' and subject_id = ${incidentId}`;
    expect(audit!.payload).toMatchObject({ template: "tsunami_warning", templateVersion: 2 });

    // Version 3 drops a list; the incident keeps what version 2 gave it.
    expect((await save(instanceToken, "tsunami_warning", tsunami, 2)).json()).toEqual({ key: "tsunami_warning", version: 3 });
    const after = (await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}`, headers: auth(instanceToken) })).json();
    expect(after.checklists).toHaveLength(5);
    expect(after.templateVersion).toBe(2);
  });

  it("keeps every version append-only, and any change to a template is its next version", async () => {
    await expect(admin`update incident_template_versions set title = 'Changed' where key = 'tsunami_warning'`)
      .rejects.toThrow(/append-only/);
    await expect(admin`delete from incident_template_versions where key = 'tsunami_warning'`).rejects.toThrow(/append-only/);
    // A change made straight in the database is numbered and kept like a save from the screen.
    await admin`update incident_templates set title = 'Tsunami Warning (local)' where key = 'tsunami_warning'`;
    const [row] = await admin`select version from incident_templates where key = 'tsunami_warning'`;
    expect(row!.version).toBe(4);
    const [kept] = await admin`select title from incident_template_versions where key = 'tsunami_warning' and version = 4`;
    expect(kept!.title).toBe("Tsunami Warning (local)");
    await expect(admin`update incident_templates set version = version + 2, title = 'Skipped' where key = 'tsunami_warning'`)
      .rejects.toThrow(/moves by one/);
    await expect(admin`update incident_templates set key = 'renamed' where key = 'tsunami_warning'`)
      .rejects.toThrow(/keeps its key/);
    // Seeding again changes nothing; a template seeded fresh starts its own history.
    await ensureStandardIncidentTemplates(admin);
    const [versions] = await admin`select count(*)::int as n from incident_template_versions where key = 'wildfire'`;
    expect(versions!.n).toBe(1);
  });
});
