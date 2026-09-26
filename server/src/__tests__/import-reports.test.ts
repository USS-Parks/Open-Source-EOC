import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importXlsForm } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { parseCsv } from "../boards/transfer.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * Validated migration (VC-13) on real PostgreSQL. A WebEOC import, a parcel
 * baseline import and a form import each keep a report of what they read and
 * did, row by row with each refusal's reason and the mapping used, with who
 * ran it; a check writes none. An administrator of the jurisdiction reads a
 * report and signs it off once; no one else does. A people file makes
 * accounts, memberships and position assignments, refuses each row it
 * cannot make with the reason, changes nothing on a check, and never keeps
 * the first password in the clear. The import templates list the product's
 * dictionary values under their enumerated columns. A board record import
 * keeps its report with the importer's organization.
 */

const FIRST_PASSWORD = "river-bend-first-2026";
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let boardId: string;
let countyPersonId: string;
const positionIds: Record<string, string> = {};

const reportCount = async () => (await admin`select count(*)::int as n from import_reports`)[0]!.n as number;
const report = (id: string, token = adminToken) => app.inject({ method: "GET", url: `/api/v1/import-reports/${id}`, headers: auth(token) });

async function upload(url: string, csv: string, fields: Record<string, string>, token = adminToken) {
  const body = await multipartUpload(fields, csv, "text/csv");
  return app.inject({ method: "POST", url, headers: { ...auth(token), ...body.headers }, payload: body.payload });
}
/** A people file as the screen sends it: the password field, if any, then the file. */
async function people(csv: string, query: string, fields: { password?: string } = {}, token = adminToken) {
  const form = new FormData();
  if (fields.password) form.append("password", fields.password);
  form.append("file", new Blob([csv], { type: "text/csv" }), "staff.csv");
  const request = new Request("http://upload.invalid/", { method: "POST", body: form });
  return app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/people-import${query}`,
    headers: { ...auth(token), "content-type": request.headers.get("content-type")! }, payload: Buffer.from(await request.arrayBuffer()) });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  for (const [key, title] of [["incident_commander", "Incident Commander"], ["planning_section_chief", "Planning Section Chief"],
    ["operations_section_chief", "Operations Section Chief"]] as const) {
    const [row] = await admin`insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, ${key}, ${title}) returning id`;
    positionIds[key] = row!.id as string;
  }
  // The member already holds Operations here.
  await admin`insert into position_assignments (position_id, person_id, assigned_by)
    values (${positionIds.operations_section_chief!}, ${seed.memberId}, ${seed.adminId})`;
  const county = await createJurisdiction(admin, "humboldt", "Humboldt County OES");
  countyPersonId = await createPerson(admin, { email: "Liaison@County.example.org", displayName: "County Liaison", password: "county-own-password" });
  await addMembership(admin, countyPersonId, county, "member");
  const outsiderId = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "outsider-good-password" });
  await addMembership(admin, outsiderId, county, "admin");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-good-password");
  boardId = (await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "significant_events", title: "Events from WebEOC" } })).json().id as string;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("import reports", () => {
  it("keeps a report of a WebEOC import with its mapping and each row's outcome, and none for a check", async () => {
    const csv = "dataid,Summary,severity,occurred\r\n"
      + "11,Levee seep,warning,2026-09-20T15:10:00Z\r\n"
      + "12,,warning,2026-09-20T15:20:00Z\r\n"
      + "13,Power out,High,2026-09-20T15:30:00Z\r\n"
      + "14,Road closed,critical,2026-09-20T15:40:00Z\r\n";
    const fields = { name: "events.csv", mapping: JSON.stringify({ summary: "Summary", severity: "severity", occurred_at: "occurred" }) };
    const url = `/api/v1/boards/${boardId}/webeoc-import`;
    const dry = await upload(`${url}?dryRun=true`, csv, fields);
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json().reportId).toBeUndefined();
    expect(await reportCount()).toBe(0);

    const done = await upload(url, csv, fields, memberToken);
    expect(done.statusCode, done.body).toBe(201);
    // The member who ran it reads the report back through the database's rule, but the screen is an administrator's.
    expect((await report(done.json().reportId, memberToken)).statusCode).toBe(403);
    const kept = await report(done.json().reportId);
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({
      kind: "webeoc", subject: "Events from WebEOC", sourceName: "events.csv", runBy: "Member",
      read: 4, created: 2, updated: 0, skipped: 0, refused: 2, signOff: null,
      mapping: [{ field: "Summary", column: "Summary" }, { field: "Occurred", column: "occurred" }, { field: "Severity", column: "severity" }],
      rows: [
        { row: 2, item: "dataid 11", outcome: "created" },
        { row: 3, item: "dataid 12", outcome: "refused", reason: "Summary is required and this row leaves it empty" },
        { row: 4, item: "dataid 13", outcome: "refused", reason: 'Severity "High" is not one of its options: normal, warning, critical, unknown' },
        { row: 5, item: "dataid 14", outcome: "created" },
      ],
    });
  });

  it("keeps a report of a parcel baseline import: created, updated, and a parcel listed twice refused", async () => {
    const rows = (value: number) => [
      { parcelId: "APN-1", address: "1 River Rd", structureType: "single_family", replacementValue: value },
      { parcelId: "APN-2", address: "2 River Rd", structureType: "mobile_home", replacementValue: 90000 },
      { parcelId: "APN-1", address: "1 River Rd, again", structureType: "single_family", replacementValue: 1 },
    ];
    const url = `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/baseline`;
    const first = await app.inject({ method: "POST", url, headers: auth(adminToken), payload: { rows: rows(250000).slice(0, 1) } });
    expect(first.json()).toMatchObject({ imported: 1 });
    const res = await app.inject({ method: "POST", url, headers: auth(adminToken), payload: { rows: rows(260000), fileName: "parcels.csv" } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().imported).toBe(2);
    const [parcel] = await admin`select address, replacement_value::float8 as value from damage_baselines where parcel_id = 'APN-1'`;
    expect(parcel).toEqual({ address: "1 River Rd", value: 260000 });
    expect((await report(res.json().reportId)).json()).toMatchObject({
      kind: "parcel_baseline", subject: "Parcel baseline", sourceName: "parcels.csv", runBy: "Admin",
      read: 3, created: 1, updated: 1, refused: 1,
      mapping: expect.arrayContaining([{ field: "Parcel ID", column: "parcelId" }]),
      rows: [
        { item: "parcel APN-1", outcome: "updated" },
        { item: "parcel APN-2", outcome: "created" },
        { item: "parcel APN-1", outcome: "refused", reason: "the file lists this parcel earlier; the first one is kept" },
      ],
    });
  });

  it("keeps a report of a form import", async () => {
    const form = importXlsForm({ survey: [{ type: "text", name: "site", label: "Site", required: "yes" }], choices: [] },
      { key: "damage_walk", title: "Damage walk" });
    const res = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`, headers: auth(adminToken), payload: form });
    expect(res.statusCode, res.body).toBe(201);
    expect((await report(res.json().reportId)).json()).toMatchObject({
      kind: "form", subject: "Forms", read: 1, created: 1, rows: [{ item: "Form Damage walk (damage_walk), version 1", outcome: "created" }],
    });
  });

  it("lists reports newest first to administrators of the jurisdiction, and an administrator signs one off once", async () => {
    const list = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/import-reports?limit=2`, headers: auth(adminToken) });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().reports.map((r: { kind: string }) => r.kind)).toEqual(["form", "parcel_baseline"]);
    const next = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/import-reports?cursor=${list.json().nextCursor}`,
      headers: auth(adminToken) });
    expect(next.json().reports.map((r: { kind: string }) => r.kind)).toEqual(["parcel_baseline", "webeoc"]);
    expect(list.json().reports[0].rows).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/import-reports`, headers: auth(memberToken) })).statusCode).toBe(403);

    const id = list.json().reports[0].id as string;
    expect((await report(id, outsiderToken)).statusCode).toBe(404);
    const signOff = (token: string, note = "Checked against the WebEOC board.") =>
      app.inject({ method: "POST", url: `/api/v1/import-reports/${id}/sign-off`, headers: auth(token), payload: { note } });
    // A member sees no report they did not run, and no other jurisdiction's administrator sees it at all.
    expect((await signOff(memberToken)).statusCode).toBe(404);
    expect((await signOff(outsiderToken)).statusCode).toBe(404);
    const signed = await signOff(adminToken);
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json().signOff).toMatchObject({ by: "Admin", note: "Checked against the WebEOC board." });
    const again = await signOff(adminToken, "");
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("this report was signed off by Admin");
    const [audit] = await admin`select person_id, payload from audit_events where category = 'import.report.signed_off'`;
    expect(audit).toEqual({ person_id: seed.adminId, payload: { kind: "form", subject: "Forms" } });
    // The database holds the report to its one change, whatever the application asks.
    await expect(runtime.begin(async (tx) => {
      await tx`select set_config('app.person_id', ${seed.adminId}, true)`;
      await tx`update import_reports set created_count = 0 where id = ${id}`;
    })).rejects.toThrow(/permission denied/);
  });

  it("serves a board import template whose choice columns hold the dictionary's values", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/import-template`, headers: auth(memberToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="significant_events-import-template.csv"');
    expect(parseCsv(res.body)).toEqual([
      ["summary", "details", "occurred_at", "severity", "verified"],
      ["", "", "", "normal", ""],
      ["", "", "", "warning", ""],
      ["", "", "", "critical", ""],
      ["", "", "", "unknown", ""],
    ]);
    expect((await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/import-template`, headers: auth(outsiderToken) })).statusCode).toBe(404);
  });
});

describe("people import", () => {
  const FILE = "email,name,role,positions,phone\r\n"
    + "ana.reyes@example.org,Ana Reyes,member,planning_section_chief,707-555-0101\r\n"
    + "liaison@county.example.org,Someone Else,viewer,,\r\n"
    + "member@example.org,Member,member,Operations Section Chief; incident_commander,\r\n"
    + "admin@example.org,Admin,viewer,,\r\n"
    + "not-an-email,Nobody,member,,\r\n"
    + "ANA.REYES@example.org,Ana Again,member,,\r\n"
    + "sam.lee@example.org,Sam Lee,Administrator,public_information_officer,\r\n"
    + "kim@example.org,,captain,,\r\n"
    + "\r\n"
    + "joe.moss@example.org,Joe Moss,viewer,,\r\n";
  const OUTCOMES = [
    { row: 2, email: "ana.reyes@example.org", outcome: "created", detail: "new account as member; assigned Planning Section Chief" },
    { row: 3, email: "liaison@county.example.org", outcome: "updated", detail: "existing account added as viewer" },
    { row: 4, email: "member@example.org", outcome: "updated", detail: "assigned Incident Commander" },
    { row: 5, email: "admin@example.org", outcome: "refused", detail: "already a member here as administrator; change a role on the People tab" },
    { row: 6, email: "not-an-email", outcome: "refused", detail: 'email "not-an-email" is not an email address' },
    { row: 7, email: "ANA.REYES@example.org", outcome: "refused", detail: "email repeats row 2" },
    { row: 8, email: "sam.lee@example.org", outcome: "refused", detail: 'no position "public_information_officer" in this jurisdiction' },
    { row: 9, email: "kim@example.org", outcome: "refused", detail: 'role "captain" is not admin, member or viewer; name is empty; a new account needs one' },
    { row: 11, email: "joe.moss@example.org", outcome: "created", detail: "new account as viewer" },
  ];

  it("serves a template whose role and position columns list the allowed values", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/people-import/template`, headers: auth(adminToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(parseCsv(res.body)).toEqual([
      ["email", "name", "role", "positions"],
      ["", "", "admin", "incident_commander"],
      ["", "", "member", "operations_section_chief"],
      ["", "", "viewer", "planning_section_chief"],
    ]);
    expect((await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/people-import/template`,
      headers: auth(memberToken) })).statusCode).toBe(403);
  });

  it("checks a file row by row and changes nothing", async () => {
    const before = await reportCount();
    const dry = await people(FILE, "?dryRun=true", { password: FIRST_PASSWORD });
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json()).toMatchObject({ dryRun: true, rows: 9, created: 2, updated: 2, skipped: 0, refused: 5, dropped: ["phone"], outcomes: OUTCOMES });
    expect(await admin`select 1 from persons where lower(email) in ('ana.reyes@example.org', 'joe.moss@example.org')`).toHaveLength(0);
    expect(await admin`select 1 from jurisdiction_memberships where person_id = ${countyPersonId} and jurisdiction_id = ${seed.jurisdictionId}`).toHaveLength(0);
    expect(await reportCount()).toBe(before);
  });

  it("refuses to make accounts without a first password, refuses a member, and refuses a file with no email column", async () => {
    const res = await people(FILE, "");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("enter a first password of at least 12 characters for the new accounts");
    expect((await people(FILE, "", { password: "short" })).statusCode).toBe(400);
    expect((await people(FILE, "", { password: FIRST_PASSWORD }, memberToken)).statusCode).toBe(403);
    const noEmail = await people("name,role\r\nAna,member\r\n", "?dryRun=true");
    expect(noEmail.statusCode).toBe(400);
    expect(noEmail.json().error).toBe("the file needs email, name and role columns; it has no email column");
    expect(await admin`select 1 from persons where lower(email) = 'ana.reyes@example.org'`).toHaveLength(0);
  });

  it("makes the accounts, memberships and positions the check showed, and keeps the report without the password", async () => {
    const res = await people(FILE, "", { password: FIRST_PASSWORD });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ dryRun: false, created: 2, updated: 2, refused: 5, outcomes: OUTCOMES });

    const members = await admin`
      select p.email, p.display_name, m.role from jurisdiction_memberships m join persons p on p.id = m.person_id
      where m.jurisdiction_id = ${seed.jurisdictionId} order by lower(p.email)`;
    expect(members.map((m) => [m.email, m.display_name, m.role])).toEqual([
      ["admin@example.org", "Admin", "admin"],
      ["ana.reyes@example.org", "Ana Reyes", "member"],
      ["joe.moss@example.org", "Joe Moss", "viewer"],
      ["Liaison@County.example.org", "County Liaison", "viewer"],
      ["member@example.org", "Member", "member"],
    ]);
    const held = await admin`
      select p.email, pos.key from position_assignments a join persons p on p.id = a.person_id join positions pos on pos.id = a.position_id
      where a.revoked_at is null order by p.email, pos.key`;
    expect(held.map((h) => [h.email, h.key])).toEqual([
      ["ana.reyes@example.org", "planning_section_chief"],
      ["member@example.org", "incident_commander"],
      ["member@example.org", "operations_section_chief"],
    ]);
    // The new account signs in with the first password; the county account keeps its own.
    await tokenFor(app, "ana.reyes@example.org", FIRST_PASSWORD);
    await tokenFor(app, "liaison@county.example.org", "county-own-password");
    const [hash] = await admin`select password_hash from persons where email = 'ana.reyes@example.org'`;
    expect(hash!.password_hash).toMatch(/^scrypt:/);
    for (const [table, column] of [["import_reports", "row_outcomes"], ["import_reports", "mapping"], ["audit_events", "payload"], ["persons", "password_hash"]] as const) {
      expect(await admin`select 1 from ${admin(table)} where ${admin(column)}::text like ${`%${FIRST_PASSWORD}%`}`).toHaveLength(0);
    }
    const [membership] = await admin`select payload from audit_events where category = 'membership.added' order by seq limit 1`;
    expect(membership!.payload).toEqual({ role: "member", previousRole: null });

    expect((await report(res.json().reportId)).json()).toMatchObject({
      kind: "people", subject: "Accounts and positions", sourceName: "staff.csv", read: 9, created: 2, updated: 2, refused: 5,
      mapping: [{ field: "Email", column: "email" }, { field: "Name", column: "name" }, { field: "Role", column: "role" }, { field: "Positions", column: "positions" }],
      rows: expect.arrayContaining([
        { row: 2, item: "ana.reyes@example.org", outcome: "created", reason: "new account as member; assigned Planning Section Chief" },
        { row: 5, item: "admin@example.org", outcome: "refused", reason: "already a member here as administrator; change a role on the People tab" },
      ]),
    });

    // The same file again changes nothing it already made.
    const again = await people(FILE, "?dryRun=true");
    expect(again.json()).toMatchObject({ created: 0, updated: 0, skipped: 4 });
    expect(again.json().outcomes.slice(0, 3).map((o: { detail: string }) => o.detail))
      .toEqual(["already a member with these positions", "already a member", "already a member with these positions"]);
  });
});

// Last: activating the incident makes the wildfire template's positions, which the people import counts.
describe("board record import reports", () => {
  it("keeps a report of a board record import, none for a refused file, and a partner's with the partner", async () => {
    const csv = "Summary,Occurred,Severity\nBridge closed,2026-09-25T08:00:00Z,critical\n,,\nShelter opened,2026-09-25T09:00:00Z,normal\n";
    const before = await reportCount();
    const imported = await upload(`/api/v1/boards/${boardId}/import`, csv, { name: "events.csv" });
    expect(imported.statusCode, imported.body).toBe(201);
    const reportId = imported.json().reportId as string;
    const kept = (await report(reportId)).json();
    expect(kept).toMatchObject({
      kind: "board_records", subject: "Events from WebEOC", sourceName: "events.csv",
      read: 2, created: 2, refused: 0,
      mapping: [{ field: "Summary", column: "Summary" }, { field: "Occurred", column: "Occurred" }, { field: "Severity", column: "Severity" }],
    });
    // The blank line is not a row; each row names the record it made.
    const records = await admin`select id from board_records where board_id = ${boardId} and data ->> 'summary' in ('Bridge closed', 'Shelter opened')`;
    expect(kept.rows.map((row: { row: number; item: string }) => row.row)).toEqual([2, 4]);
    expect(new Set(kept.rows.map((row: { item: string }) => row.item))).toEqual(new Set(records.map((r) => r.id)));
    const refused = await upload(`/api/v1/boards/${boardId}/import`, "Summary,Severity\nNo time,bad\n", { name: "bad.csv" });
    expect(refused.statusCode).toBe(422);
    expect(await reportCount()).toBe(before + 1);

    // A partner contributing to the incident imports into its board; the report is the partner's.
    const incident = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken), payload: { templateKey: "wildfire", name: "Ridge Fire" } });
    expect(incident.statusCode, incident.body).toBeLessThan(300);
    const incidentId = incident.json().incidentId as string;
    const granted = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/participants`, headers: auth(adminToken), payload: {
      organizationSlug: "humboldt", personEmail: "liaison@county.example.org", incidentPositionTitle: "County Liaison",
      role: "contributor", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Joint response",
    } });
    expect(granted.statusCode, granted.body).toBeLessThan(300);
    const [events] = await admin`
      select b.id from incident_boards ib join boards b on b.id = ib.board_id
      where ib.incident_id = ${incidentId} and b.template_key = 'significant_events'`;
    const liaisonToken = await tokenFor(app, "liaison@county.example.org", "county-own-password");
    const partner = await upload(`/api/v1/boards/${events!.id as string}/import?incidentId=${incidentId}`,
      "Summary,Occurred,Severity\nCounty crews staged,2026-09-25T10:00:00Z,normal\n", { name: "county.csv" }, liaisonToken);
    expect(partner.statusCode, partner.body).toBe(201);
    const [filed] = await admin`select j.slug from import_reports r join jurisdictions j on j.id = r.jurisdiction_id where r.id = ${partner.json().reportId as string}`;
    expect(filed!.slug).toBe("humboldt");
    expect((await report(partner.json().reportId as string, outsiderToken)).statusCode).toBe(200);
  });
});
