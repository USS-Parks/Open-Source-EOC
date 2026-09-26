import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { guessMapping, parseCsv } from "../contacts/csv.js";
import { withPerson } from "../db/context.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * The contacts directory: admins maintain contacts and ordered groups,
 * members read them, row-level security holds the same line, and contacts
 * import from CSV with a dry run before the commit.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let outsiderToken: string;
let outsiderId: string;

async function call(method: string, url: string, token: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const contactsUrl = () => `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`;
const groupsUrl = () => `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  const other = await createJurisdiction(admin, "other", "Other County OES");
  outsiderId = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "outsider-password-1" });
  await addMembership(admin, outsiderId, other, "admin");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password-1");
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("CSV parsing", () => {
  it("reads quoted fields, doubled quotes, line breaks in quotes, CRLF, a byte order mark and blank rows", () => {
    const text = '﻿Name,Notes\r\n"Parks, Basho","Says ""hi""\nsecond line"\r\n\r\nLee,plain\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Notes"],
      ["Parks, Basho", 'Says "hi"\nsecond line'],
      ["Lee", "plain"],
    ]);
  });

  it("refuses an unclosed quoted field", () => {
    expect(() => parseCsv('a,b\n1,"2\n')).toThrow("a quoted field is not closed");
  });

  it("guesses the mapping from common header names", () => {
    expect(guessMapping(["Full Name", "Agency", "Job Title", "E-mail", "Mobile", "Comments"])).toEqual({
      name: "Full Name",
      organization: "Agency",
      title: "Job Title",
      email: "E-mail",
      phone: "Mobile",
      notes: "Comments",
    });
  });
});

describe("contacts", () => {
  let dutyId: string;

  it("lets an admin create, read, update and link a contact, and members read it", async () => {
    const [position] = await admin`
      insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'duty_officer', 'Duty Officer')
      returning id`;
    const created = await call("POST", contactsUrl(), adminToken, {
      name: "Dana Duty",
      organization: "Yurok Tribe OES",
      title: "Duty officer",
      emails: ["duty@example.org"],
      phones: ["+17075550100"],
      personId: seed.memberId,
      positionId: position!.id,
      notes: "Primary after hours",
    });
    expect(created.statusCode).toBe(201);
    dutyId = created.json().id as string;
    expect(created.json()).toMatchObject({
      name: "Dana Duty",
      personName: "Member",
      positionTitle: "Duty Officer",
      emails: ["duty@example.org"],
      phones: ["+17075550100"],
      active: true,
    });

    for (const token of [memberToken, viewerToken]) {
      const list = await call("GET", contactsUrl(), token);
      expect(list.statusCode).toBe(200);
      expect(list.json().contacts.map((c: { name: string }) => c.name)).toEqual(["Dana Duty"]);
    }

    const updated = await call("PUT", `/api/v1/contacts/${dutyId}`, adminToken, {
      name: "Dana Duty",
      emails: ["duty@example.org", "dana@example.org"],
      phones: ["+17075550100"],
      active: false,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ emails: ["duty@example.org", "dana@example.org"], personId: null, active: false });
    const [audit] = await admin`select count(*)::int as n from audit_events where category like 'contact.%'`;
    expect(audit!.n).toBe(2);
  });

  it("refuses writes by members and viewers, bad addresses, and links outside the jurisdiction", async () => {
    const body = { name: "Someone", phones: ["+17075550199"] };
    expect((await call("POST", contactsUrl(), memberToken, body)).statusCode).toBe(403);
    expect((await call("POST", contactsUrl(), viewerToken, body)).statusCode).toBe(403);
    expect((await call("PUT", `/api/v1/contacts/${dutyId}`, memberToken, body)).statusCode).toBe(403);
    expect((await call("DELETE", `/api/v1/contacts/${dutyId}`, memberToken)).statusCode).toBe(403);
    expect((await call("POST", contactsUrl(), adminToken, { name: "X", phones: ["707-555-0100"] })).statusCode).toBe(400);
    expect((await call("POST", contactsUrl(), adminToken, { name: "X", emails: ["not-an-address"] })).statusCode).toBe(400);
    const outsider = await call("POST", contactsUrl(), adminToken, { name: "X", personId: outsiderId });
    expect(outsider.statusCode).toBe(422);
  });

  it("keeps another jurisdiction out, in the routes and in the database", async () => {
    expect((await call("GET", contactsUrl(), outsiderToken)).statusCode).toBe(403);
    expect((await call("PUT", `/api/v1/contacts/${dutyId}`, outsiderToken, { name: "Taken" })).statusCode).toBe(404);
    const seen = await withPerson(runtime, outsiderId, (tx) => tx`select id from contacts`);
    expect(seen).toHaveLength(0);
    // A member may read the directory but row-level security refuses its writes.
    await expect(
      withPerson(runtime, seed.memberId, (tx) => tx`
        insert into contacts (jurisdiction_id, name, updated_by)
        values (${seed.jurisdictionId}, 'Direct write', ${seed.memberId})`),
    ).rejects.toThrow(/row-level security/);
    const changed = await withPerson(runtime, seed.memberId, (tx) => tx`
      update contacts set name = 'Renamed' where id = ${dutyId} returning id`);
    expect(changed).toHaveLength(0);
  });

  it("pages the directory in name order and searches it", async () => {
    for (const name of ["Alex Able", "Blair Baker", "Casey Cole"]) {
      expect((await call("POST", contactsUrl(), adminToken, { name, organization: "County Fire" })).statusCode).toBe(201);
    }
    const first = await call("GET", `${contactsUrl()}?limit=2`, memberToken);
    expect(first.json().contacts.map((c: { name: string }) => c.name)).toEqual(["Alex Able", "Blair Baker"]);
    const second = await call("GET", `${contactsUrl()}?limit=2&cursor=${first.json().nextCursor as string}`, memberToken);
    expect(second.json().contacts.map((c: { name: string }) => c.name)).toEqual(["Casey Cole", "Dana Duty"]);
    expect(second.json().nextCursor).toBeNull();
    const search = await call("GET", `${contactsUrl()}?q=fire`, memberToken);
    expect(search.json().contacts).toHaveLength(3);
  });
});

describe("contact groups", () => {
  it("keeps members in call-down order, refuses duplicates and other jurisdictions' contacts", async () => {
    const all = (await call("GET", contactsUrl(), adminToken)).json().contacts as Array<{ id: string; name: string }>;
    const id = (name: string) => all.find((c) => c.name === name)!.id;
    const created = await call("POST", groupsUrl(), adminToken, {
      name: "Duty officers",
      contactIds: [id("Casey Cole"), id("Alex Able"), id("Blair Baker")],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().members.map((m: { name: string }) => m.name)).toEqual(["Casey Cole", "Alex Able", "Blair Baker"]);
    const groupId = created.json().id as string;

    const reordered = await call("PUT", `/api/v1/contact-groups/${groupId}`, adminToken, {
      name: "Duty officers",
      contactIds: [id("Alex Able"), id("Blair Baker")],
    });
    expect(reordered.json().members.map((m: { name: string }) => m.name)).toEqual(["Alex Able", "Blair Baker"]);
    const listed = await call("GET", groupsUrl(), viewerToken);
    expect(listed.json().groups).toHaveLength(1);
    expect(listed.json().groups[0].members).toHaveLength(2);

    expect((await call("POST", groupsUrl(), adminToken, { name: "Duty officers", contactIds: [] })).statusCode).toBe(409);
    expect((await call("POST", groupsUrl(), memberToken, { name: "Mine", contactIds: [] })).statusCode).toBe(403);
    const foreign = await withPerson(runtime, outsiderId, (tx) => tx`
      insert into contacts (jurisdiction_id, name, updated_by)
      select jurisdiction_id, 'Foreign', ${outsiderId} from jurisdiction_memberships where person_id = ${outsiderId}
      returning id`);
    const mixed = await call("POST", groupsUrl(), adminToken, { name: "Mixed", contactIds: [foreign[0]!.id as string] });
    expect(mixed.statusCode).toBe(422);

    // Deleting a contact takes it out of its groups.
    expect((await call("DELETE", `/api/v1/contacts/${id("Alex Able")}`, adminToken)).statusCode).toBe(204);
    const after = await call("GET", groupsUrl(), adminToken);
    expect(after.json().groups[0].members.map((m: { name: string }) => m.name)).toEqual(["Blair Baker"]);
    expect((await call("DELETE", `/api/v1/contact-groups/${groupId}`, adminToken)).statusCode).toBe(204);
    expect((await call("GET", groupsUrl(), adminToken)).json().groups).toHaveLength(0);
  });
});

describe("a contact's address and map point", () => {
  const point = (lng: unknown, lat: unknown) => ({ type: "Point", coordinates: [lng, lat] });
  const eurekaEoc = point(-124.1664, 40.8021);

  it("lets an admin set, keep, clear and correct both, and refuses bad values", async () => {
    const created = await call("POST", contactsUrl(), adminToken, {
      name: "Lane Located", address: "  County Operations Center, Eureka  ", location: eurekaEoc,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ address: "County Operations Center, Eureka", location: eurekaEoc });
    const id = created.json().id as string;
    const put = (body: Record<string, unknown>, token = adminToken) => call("PUT", `/api/v1/contacts/${id}`, token, { name: "Lane Located", ...body });

    // Left out, both stay as they are while the rest of the contact changes.
    expect((await put({ title: "Duty officer" })).json()).toMatchObject({ title: "Duty officer", address: "County Operations Center, Eureka", location: eurekaEoc });
    // A blank address clears it; a new point replaces the old one.
    expect((await put({ address: "   ", location: point(-124.0829, 40.8687) })).json())
      .toMatchObject({ address: null, location: point(-124.0829, 40.8687) });
    expect((await put({ address: "Arcata City Hall", location: null })).json()).toMatchObject({ address: "Arcata City Hall", location: null });
    expect((await put({ address: null })).json()).toMatchObject({ address: null, location: null });

    const refused = [
      { location: point(-190, 40) }, { location: point(-124, 91) }, { location: point("-124", 40) },
      { location: { type: "LineString", coordinates: [[-124, 40], [-123, 41]] } }, { location: [-124, 40] },
      { address: "x".repeat(301) }, { address: 42 }, { address: "816 3rd St\u0000" }, { address: "816 3rd\nSt" },
    ];
    for (const bad of refused) {
      expect((await call("POST", contactsUrl(), adminToken, { name: "Bad Place", ...bad })).statusCode, JSON.stringify(bad)).toBe(400);
      expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await put({ address: "x".repeat(300) })).statusCode).toBe(200);
    expect((await put({ location: eurekaEoc }, memberToken)).statusCode).toBe(403);
    const [stored] = await admin`select address, ST_AsText(location) as location from contacts where id = ${id}`;
    expect(stored).toEqual({ address: "x".repeat(300), location: null });
  });

  it("shows them to writers only: never to a viewer, another jurisdiction, a group list or the area search", async () => {
    const created = await call("POST", contactsUrl(), adminToken, {
      name: "Morgan Mapped", phones: ["+17075550150"], address: "County Operations Center, Eureka", location: eurekaEoc,
    });
    const id = created.json().id as string;
    const listed = async (token: string) =>
      ((await call("GET", `${contactsUrl()}?q=Morgan`, token)).json().contacts as Array<Record<string, unknown>>)[0];
    // A member may notify the contact, so reads where it is.
    expect(await listed(memberToken)).toMatchObject({ address: "County Operations Center, Eureka", location: eurekaEoc, addressPoint: null });
    // A viewer reads the directory's channels but never where anyone is.
    const viewed = await listed(viewerToken);
    expect(viewed).toMatchObject({ phones: ["+17075550150"], address: null, location: null, addressPoint: null });
    expect(JSON.stringify(viewed)).not.toMatch(/County Operations Center|-124\.1664/);

    expect((await call("GET", contactsUrl(), outsiderToken)).statusCode).toBe(403);
    const seen = await withPerson(runtime, outsiderId, (tx) => tx`select address, location from contacts where id = ${id}`);
    expect(seen).toHaveLength(0);

    const group = await call("POST", groupsUrl(), adminToken, { name: "Mapped", contactIds: [id] });
    expect(Object.keys(group.json().members[0]).sort()).toEqual(["active", "contactId", "name"]);
    const groups = await call("GET", groupsUrl(), viewerToken);
    expect(groups.body).not.toMatch(/County Operations Center|-124\.1664/);

    const area = { type: "Polygon", coordinates: [[[-124.2, 40.78], [-124.14, 40.78], [-124.14, 40.82], [-124.2, 40.82], [-124.2, 40.78]]] };
    const found = await call("POST", `${contactsUrl()}/in-area`, memberToken, { area });
    expect(found.json().contacts.map((c: { name: string }) => c.name)).toContain("Morgan Mapped");
    expect(found.body).not.toMatch(/County Operations Center|-124\.1664|\+1707/);
  });
});

describe("CSV import", () => {
  const importUrl = () => `${contactsUrl()}/import`;
  const csv = [
    "Name,Agency,Email,Mobile,Notes",
    'Harper Hill,"Public Works, Roads",harper@example.org,+1 (707) 555-0110,"Plows; chains"',
    "Indy Ives,Sheriff,indy@example.org;ives@example.org,+17075550111,",
    ",Nobody,missing-name@example.org,,",
    "Jo Jay,Health,not-an-email,7075550112,",
  ].join("\r\n");

  it("reports each row on a dry run and writes nothing", async () => {
    const before = await admin`select count(*)::int as n from contacts`;
    const res = await call("POST", importUrl(), adminToken, { csv, dryRun: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mapping).toMatchObject({ name: "Name", organization: "Agency", email: "Email", phone: "Mobile", notes: "Notes" });
    expect(body).toMatchObject({ valid: 2, invalid: 2, created: 0 });
    expect(body.rows[0]).toMatchObject({
      row: 1,
      name: "Harper Hill",
      organization: "Public Works, Roads",
      phones: ["+17075550110"],
      notes: "Plows; chains",
      errors: [],
    });
    expect(body.rows[1].emails).toEqual(["indy@example.org", "ives@example.org"]);
    expect(body.rows[2].errors).toContain("name is empty");
    expect(body.rows[3].errors).toEqual([
      "not-an-email is not an email address",
      "7075550112 is not a phone number in E.164 form",
    ]);
    const after = await admin`select count(*)::int as n from contacts`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("refuses to commit a file with errors, then commits a clean one with an explicit mapping", async () => {
    const refused = await call("POST", importUrl(), adminToken, { csv, dryRun: false });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toContain("2 of 4 rows have errors");
    expect((await call("POST", importUrl(), memberToken, { csv, dryRun: true })).statusCode).toBe(403);

    const clean = csv.split("\r\n").slice(0, 3).join("\r\n");
    const committed = await call("POST", importUrl(), adminToken, {
      csv: clean,
      dryRun: false,
      mapping: { name: "Name", email: "Email", phone: "Mobile", organization: null },
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json()).toMatchObject({ created: 2, invalid: 0 });
    const rows = await admin`select name, organization, emails, phones from contacts where name in ('Harper Hill', 'Indy Ives') order by name`;
    expect(rows.map((r) => [r.name, r.organization, r.emails, r.phones])).toEqual([
      ["Harper Hill", null, ["harper@example.org"], ["+17075550110"]],
      ["Indy Ives", null, ["indy@example.org", "ives@example.org"], ["+17075550111"]],
    ]);
    const [audit] = await admin`select payload from audit_events where category = 'contact.imported'`;
    expect(audit!.payload).toEqual({ created: 2 });
    const unknownColumn = await call("POST", importUrl(), adminToken, { csv: clean, dryRun: true, mapping: { name: "Nope" } });
    expect(unknownColumn.statusCode).toBe(422);
  });
});
