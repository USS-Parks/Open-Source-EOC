import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ICS_COMPONENT_EDITION } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, tokenFor, type Sql } from "./helpers.js";

/**
 * ICS forms as components of an operational period (Veoci and air gap VA37,
 * part one). A form starts as a draft prefilled from the incident's records,
 * is saved field by field as its next version over the one opened, is marked
 * ready, and prints any version to PDF. Every version is kept, append-only.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hostId: string;
let memberId: string;
let memberToken: string;
let viewerToken: string;
let partnerToken: string;
let outsiderToken: string;
let incidentId: string;
let otherIncidentId: string;
let objectivesId: string;

type Method = "GET" | "POST" | "PUT";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

async function start(token: string, formId: string, label?: string, periodRevision = 1) {
  return call(token, "POST", `/api/v1/incidents/${incidentId}/ics-components`, {
    formId, periodRevision, ...(label === undefined ? {} : { label }),
  });
}

async function save(token: string, id: string, values: unknown, expectedVersion: number, status = "draft", label?: string) {
  return call(token, "PUT", `/api/v1/ics-components/${id}`, {
    values, status, expectedVersion, ...(label === undefined ? {} : { label }),
  });
}

async function activate(adminToken: string, name: string): Promise<string> {
  const res = await call(adminToken, "POST", `/api/v1/jurisdictions/${hostId}/incidents`, { templateKey: "wildfire", name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().incidentId as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  hostId = await createJurisdiction(admin, "forms-host", "Forms Host EOC");
  const partnerId = await createJurisdiction(admin, "forms-partner", "Forms Mutual Aid Partner");
  const outsiderOrg = await createJurisdiction(admin, "forms-outsider", "Unrelated Agency");
  const adminId = await createPerson(admin, { email: "forms-admin@example.org", displayName: "Forms Admin", password: "forms-admin-password" });
  memberId = await createPerson(admin, { email: "forms-member@example.org", displayName: "Rosa Planner", password: "forms-member-password" });
  const viewerId = await createPerson(admin, { email: "forms-viewer@example.org", displayName: "Vic Viewer", password: "forms-viewer-password" });
  const partnerPersonId = await createPerson(admin, { email: "forms-partner@example.org", displayName: "Pat Partner", password: "forms-partner-password" });
  const outsiderId = await createPerson(admin, { email: "forms-outsider@example.org", displayName: "Olly Outsider", password: "forms-outsider-password" });
  await addMembership(admin, adminId, hostId, "admin");
  await addMembership(admin, memberId, hostId, "member");
  await addMembership(admin, viewerId, hostId, "viewer");
  await addMembership(admin, partnerPersonId, partnerId, "viewer");
  await addMembership(admin, outsiderId, outsiderOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  const adminToken = await tokenFor(app, "forms-admin@example.org", "forms-admin-password");
  memberToken = await tokenFor(app, "forms-member@example.org", "forms-member-password");
  viewerToken = await tokenFor(app, "forms-viewer@example.org", "forms-viewer-password");
  partnerToken = await tokenFor(app, "forms-partner@example.org", "forms-partner-password");
  outsiderToken = await tokenFor(app, "forms-outsider@example.org", "forms-outsider-password");
  incidentId = await activate(adminToken, "Klamath River Flood");
  otherIncidentId = await activate(adminToken, "Unrelated Wildfire");
  const starts = new Date("2026-09-25T06:00:00Z");
  const ends = new Date("2026-09-25T18:00:00Z");
  for (const [incident, revision, label] of [[incidentId, 1, "OP 1"], [incidentId, 2, "OP 2"], [otherIncidentId, 1, "OP A"]] as const) {
    await admin`
      insert into incident_area_revisions (incident_id, revision, period_label, period_starts_at, period_ends_at, reason, created_by)
      values (${incident}, ${revision}, ${label}, ${starts}, ${ends}, 'forms test period', ${adminId})`;
  }
  const grant = await call(adminToken, "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "forms-partner",
    personEmail: "forms-partner@example.org",
    incidentPositionTitle: "Mutual Aid Planning Lead",
    role: "contributor",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    reason: "VA37 partner form preparation",
  });
  expect(grant.statusCode, grant.body).toBe(201);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("ICS forms as components of an operational period", () => {
  it("starts a form as a prefilled draft and refuses a second of a form a period holds one of", async () => {
    const res = await start(memberToken, "ICS-202");
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    objectivesId = body.id;
    expect(body).toMatchObject({
      formId: "ICS-202", title: "Incident Objectives", label: "", incidentId, incidentName: "Klamath River Flood",
      periodRevision: 1, operationalPeriod: "OP 1", status: "draft", version: 1,
      preparedBy: "Rosa Planner", preparedRole: "Jurisdiction Member", edition: ICS_COMPONENT_EDITION,
    });
    expect(body.values).toEqual({
      objectives: "", commandEmphasis: "", situationalAwareness: "", siteSafetyPlanRequired: "", siteSafetyPlanLocation: "",
      attachments: ["ICS 203", "ICS 204", "ICS 205", "ICS 206", "ICS 207", "ICS 208"],
    });
    const again = await start(memberToken, "ICS-202");
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("this period already has an ICS 202; open it instead");
    // The next period holds its own.
    expect((await start(memberToken, "ICS-202", undefined, 2)).statusCode).toBe(201);
  });

  it("saves each version over the one opened, keeps every one, and prints any of them", async () => {
    const values = {
      objectives: "Keep Highway 96 open to Weitchpec\nShelter evacuees at the school gym",
      siteSafetyPlanRequired: "Yes",
      siteSafetyPlanLocation: "Safety Officer, ICP",
      attachments: ["ICS 203", "ICS 205", "ICS 208"],
    };
    const saved = await save(memberToken, objectivesId, values, 1, "ready");
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ version: 2, status: "ready", preparedBy: "Rosa Planner" });
    // A field left out takes its empty value.
    expect(saved.json().values).toEqual({ ...values, commandEmphasis: "", situationalAwareness: "" });

    const stale = await save(memberToken, objectivesId, { objectives: "Overwrite" }, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("the form changed after it was opened: version 2 is current");

    const versions = await call(memberToken, "GET", `/api/v1/ics-components/${objectivesId}/versions`);
    expect(versions.json().versions.map((v: { version: number; status: string; savedBy: string }) =>
      [v.version, v.status, v.savedBy])).toEqual([[2, "ready", "Rosa Planner"], [1, "draft", "Rosa Planner"]]);

    const pdf = await call(memberToken, "GET", `/api/v1/ics-components/${objectivesId}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toBe('attachment; filename="ics-202-klamath-river-flood-v2.pdf"');
    expect(pdf.body.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.body).toContain("Keep Highway 96 open to Weitchpec");
    expect(pdf.body).toContain("[X] ICS 205");
    expect(pdf.body).toContain("Version 2; ready");
    const first = await call(memberToken, "GET", `/api/v1/ics-components/${objectivesId}/pdf?version=1`);
    expect(first.statusCode).toBe(200);
    expect(first.body).not.toContain("Weitchpec");
    expect(first.body).toContain("Version 1; draft");
    expect((await call(memberToken, "GET", `/api/v1/ics-components/${objectivesId}/pdf?version=9`)).statusCode).toBe(404);
  });

  it("feeds the period's objectives into a new 201 and 209, and the incident's positions into the 203", async () => {
    const briefing = await start(memberToken, "ICS-201");
    expect(briefing.statusCode, briefing.body).toBe(201);
    expect(briefing.json().values.objectives).toBe("Keep Highway 96 open to Weitchpec\nShelter evacuees at the school gym");
    expect(briefing.json().values.initiated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(briefing.json().values.organization).toContainEqual(["Incident Commander", ""]);
    const status = await start(memberToken, "ICS-209");
    expect(status.json().values).toMatchObject({
      reportVersion: "Update", strategicObjectives: "Keep Highway 96 open to Weitchpec\nShelter evacuees at the school gym",
    });
    const organization = await start(memberToken, "ICS-203");
    expect(organization.json().values.command).toContainEqual(["Incident Commander", ""]);
    // The next period has no 202 of its own yet written, so its 201 starts without objectives.
    expect((await start(memberToken, "ICS-201", undefined, 2)).json().values.objectives).toBe("");
  });

  it("keeps several 204s, 213s and 214s in a period, told apart by a label", async () => {
    const unnamed = await start(memberToken, "ICS-204");
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.json().error).toBe("label: name this ICS 204 (Branch, division, group or staging area)");
    const divisionA = await start(memberToken, "ICS-204", "Division A");
    expect(divisionA.statusCode, divisionA.body).toBe(201);
    expect(divisionA.json().values.personnel).toEqual([
      ["Operations Section Chief", "", ""], ["Branch Director", "", ""],
      ["Division/Group Supervisor", "", ""], ["Staging Area Manager", "", ""],
    ]);
    const divisionB = await start(memberToken, "ICS-204", "  Division B  ");
    expect(divisionB.json().label).toBe("Division B");
    const twice = await start(memberToken, "ICS-204", "Division A");
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe("this period already has an ICS 204 named Division A");
    const renamed = await save(memberToken, divisionB.json().id, divisionB.json().values, 1, "draft", "Division A");
    expect(renamed.statusCode).toBe(409);
    // A form a period holds one of keeps no label.
    expect((await start(memberToken, "ICS-205", "Ignored")).json().label).toBe("");

    const log = await start(memberToken, "ICS-214", "Rosa Planner, Planning");
    expect(log.json().values).toMatchObject({ name: "Rosa Planner", position: "Jurisdiction Member" });

    const list = await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/ics-components?periodRevision=1`);
    expect(list.statusCode).toBe(200);
    expect(list.json().components.map((c: { formId: string; label: string }) => `${c.formId} ${c.label}`.trim())).toEqual([
      "ICS-201", "ICS-202", "ICS-203", "ICS-204 Division A", "ICS-204 Division B", "ICS-205", "ICS-209",
      "ICS-214 Rosa Planner, Planning",
    ]);
    const other = await call(memberToken, "GET", `/api/v1/incidents/${otherIncidentId}/ics-components`);
    expect(other.json().components).toEqual([]);
  });

  it("checks every value against its form and names the field it refuses", async () => {
    const channels = await start(memberToken, "ICS-205", undefined, 2);
    const id = channels.json().id as string;
    const refused = async (values: unknown, prefix: string) => {
      const res = await save(memberToken, id, values, 1);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error.startsWith(prefix), res.json().error).toBe(true);
    };
    await refused({ notAField: "x" }, "values: ");
    await refused({ channels: [["too", "short"]] }, "channels.0: ");
    await refused({ specialInstructions: 42 }, "specialInstructions: ");
    const objectives = (await call(memberToken, "GET", `/api/v1/incidents/${incidentId}/ics-components?periodRevision=2`))
      .json().components.find((c: { formId: string }) => c.formId === "ICS-202").id as string;
    const choice = await save(memberToken, objectives, { siteSafetyPlanRequired: "Maybe" }, 1);
    expect(choice.json().error.startsWith("siteSafetyPlanRequired: "), choice.body).toBe(true);
    const doubled = await save(memberToken, objectives, { attachments: ["ICS 203", "ICS 203"] }, 1);
    expect(doubled.json().error).toBe("attachments: an option is checked twice");

    const unknownForm = await start(memberToken, "ICS-999");
    expect(unknownForm.statusCode).toBe(400);
    expect(unknownForm.json().error).toBe("formId: ICS-999 is not an ICS form this workspace keeps");
    const noPeriod = await start(memberToken, "ICS-206", undefined, 7);
    expect(noPeriod.statusCode).toBe(400);
    expect(noPeriod.json().error).toBe("operational period revision is not available for this incident");
    expect((await call(memberToken, "GET", "/api/v1/ics-components/not-a-uuid")).statusCode).toBe(400);
    expect((await call(memberToken, "GET", `/api/v1/ics-components/${incidentId}`)).statusCode).toBe(404);
  });

  it("lets a partner's contributor prepare a form under their grant, recorded in the owner's trail", async () => {
    const message = await start(partnerToken, "ICS-213", "Road closure at Martins Ferry");
    expect(message.statusCode, message.body).toBe(201);
    expect(message.json()).toMatchObject({ preparedBy: "Pat Partner", preparedRole: "Mutual Aid Planning Lead" });
    expect(message.json().values.from).toBe("Pat Partner, Mutual Aid Planning Lead");
    const id = message.json().id as string;
    const saved = await save(partnerToken, id, { ...message.json().values, message: "Martins Ferry bridge closed to all traffic" }, 1);
    expect(saved.statusCode, saved.body).toBe(200);
    // A host member picks it up; the saver becomes its preparer.
    const taken = await save(memberToken, id, saved.json().values, 2, "ready");
    expect(taken.json()).toMatchObject({ version: 3, preparedBy: "Rosa Planner", preparedRole: "Jurisdiction Member" });
    const trail = await admin`
      select a.category, a.jurisdiction_id, p.display_name from audit_events a join persons p on p.id = a.person_id
      where a.subject_id = ${id} order by a.seq`;
    expect(trail.map((row) => [row.category, row.jurisdiction_id, row.display_name])).toEqual([
      ["ics_form.created", hostId, "Pat Partner"],
      ["ics_form.saved", hostId, "Pat Partner"],
      ["ics_form.saved", hostId, "Rosa Planner"],
    ]);
  });

  it("lets a reader read and print but not write, and hides the forms from an outsider", async () => {
    const list = await call(viewerToken, "GET", `/api/v1/incidents/${incidentId}/ics-components`);
    expect(list.statusCode).toBe(200);
    expect(list.json().components.length).toBeGreaterThan(5);
    expect((await call(viewerToken, "GET", `/api/v1/ics-components/${objectivesId}/pdf`)).statusCode).toBe(200);
    const refused = await start(viewerToken, "ICS-206");
    expect(refused.statusCode).toBe(403);
    expect((await save(viewerToken, objectivesId, {}, 2)).statusCode).toBe(403);
    expect((await call(outsiderToken, "GET", `/api/v1/incidents/${incidentId}/ics-components`)).statusCode).toBe(404);
    expect((await call(outsiderToken, "GET", `/api/v1/ics-components/${objectivesId}`)).statusCode).toBe(404);
    expect((await call(outsiderToken, "GET", `/api/v1/ics-components/${objectivesId}/versions`)).statusCode).toBe(404);
  });

  it("keeps every version append-only, and a change always moves the version by one", async () => {
    const asMember = <T>(fn: (tx: Sql) => Promise<T>) => withPerson(runtime, memberId, fn);
    // The runtime may only read a kept version; the owner is stopped by the trigger.
    await expect(asMember((tx) => tx`update ics_form_component_versions set label = 'x' where component_id = ${objectivesId}`))
      .rejects.toThrow(/permission denied/);
    await expect(asMember((tx) => tx`delete from ics_form_component_versions where component_id = ${objectivesId}`))
      .rejects.toThrow(/permission denied/);
    await expect(asMember((tx) => tx`insert into ics_form_component_versions
      (component_id, version, status, label, field_values, saved_by, saved_role_label)
      values (${objectivesId}, 9, 'ready', '', '{}', ${memberId}, 'Forged')`)).rejects.toThrow(/permission denied/);
    await expect(admin`update ics_form_component_versions set label = 'x' where component_id = ${objectivesId}`)
      .rejects.toThrow(/append-only/);
    await expect(admin`delete from ics_form_component_versions where component_id = ${objectivesId}`)
      .rejects.toThrow(/append-only/);
    await expect(asMember((tx) => tx`update ics_form_components set status = 'draft' where id = ${objectivesId}`))
      .rejects.toThrow(/moves its version/);
    await expect(asMember((tx) => tx`update ics_form_components set version = version + 2, status = 'draft' where id = ${objectivesId}`))
      .rejects.toThrow(/moves by one/);
    await expect(asMember((tx) => tx`update ics_form_components set form_id = 'ICS-206', version = version + 1 where id = ${objectivesId}`))
      .rejects.toThrow(/keeps its incident, period and form/);
    await expect(asMember((tx) => tx`delete from ics_form_components where id = ${objectivesId}`)).rejects.toThrow();
    const [row] = await admin`select version, status from ics_form_components where id = ${objectivesId}`;
    expect(row).toMatchObject({ version: 2, status: "ready" });
  });
});
