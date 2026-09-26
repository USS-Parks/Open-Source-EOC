import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { contactsInArea } from "../contacts/area.js";
import { searchableAddress } from "../contacts/placement.js";
import { withPerson } from "../db/context.js";
import { GAZETTEER_HEADER } from "../geocode/normalize.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Notify people in an area: who may send a mass notification learns which
 * of the jurisdiction's contacts are inside a drawn area, by a set point or
 * by the point their address placed at when saved, with names and channels
 * only. An address places only at one house number inside the
 * jurisdiction's known extent; another jurisdiction's contacts never come
 * back; a malformed or oversized area is refused; and the search stays fast
 * under a generic plan.
 */

let admin: Sql;
let runtime: Sql;
let dir: string;
let app: FastifyInstance;
let bare: FastifyInstance;
let seed: SeedResult;
let other: string;
let outsider: string;
const tokens: Record<string, string> = {};

// Around downtown Eureka; 816 3rd Street is inside it.
const EUREKA = { type: "Polygon", coordinates: [[[-124.2, 40.78], [-124.14, 40.78], [-124.14, 40.82], [-124.2, 40.82], [-124.2, 40.78]]] };

const inArea = (target: FastifyInstance, token: string | null, body: unknown, jurisdictionId = seed.jurisdictionId) =>
  target.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/contacts/in-area`,
    headers: token ? auth(token) : {},
    payload: body as Record<string, unknown>,
  });

type Found = { contacts: { id: string; name: string; channels: string[] }[]; unplaced: number };
const found = async (target = app) => (await inArea(target, tokens["member"]!, { area: EUREKA })).json() as Found;

/** A contact written straight to the table, as one saved before addresses placed would be. */
async function contact(jurisdictionId: string, name: string, part: {
  emails?: string[]; phones?: string[]; address?: string; at?: [number, number]; active?: boolean;
}) {
  await admin`
    insert into contacts (jurisdiction_id, name, emails, phones, address, location, active, updated_by)
    values (${jurisdictionId}, ${name}, ${part.emails ?? []}::text[], ${part.phones ?? []}::text[], ${part.address ?? null},
      ${part.at ? admin`ST_SetSRID(ST_MakePoint(${part.at[0]}, ${part.at[1]}), 4326)` : null},
      ${part.active ?? true}, ${seed.adminId})`;
}

/** A contact saved through the API by the jurisdiction's administrator, which places its address. */
async function saved(body: Record<string, unknown>, target = app) {
  const res = await target.inject({
    method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`, headers: auth(tokens["admin"]!), payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; addressPoint: { coordinates: [number, number] } | null };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const viewer = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewer, seed.jurisdictionId, "viewer");
  other = await createJurisdiction(admin, "other", "Other County OES");
  outsider = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "outsider-password-1" });
  await addMembership(admin, outsider, other, "admin");

  // Set points in Eureka and Arcata give the jurisdiction its known extent.
  await contact(seed.jurisdictionId, "Avery Point", { emails: ["avery@example.org"], phones: ["+17075550101"], at: [-124.17, 40.8] });
  await contact(seed.jurisdictionId, "Cameron Outside", { emails: ["cameron@example.org"], at: [-124.08, 40.87] });
  await contact(seed.jurisdictionId, "Finley Inactive", { emails: ["finley@example.org"], at: [-124.17, 40.8], active: false });
  await contact(seed.jurisdictionId, "Gale No Location", { emails: ["gale@example.org"] });
  // Saved before addresses placed: an address with no placed point is unplaced.
  await contact(seed.jurisdictionId, "Harlow Old Address", { emails: ["harlow@example.org"], address: "816 3rd Street, Eureka" });
  await contact(other, "Harper Other County", { emails: ["harper@example.org"], at: [-124.16, 40.81] });

  dir = mkdtempSync(join(tmpdir(), "contacts-area-"));
  writeFileSync(join(dir, "gazetteer.tsv"), `${GAZETTEER_HEADER}\t2026-09-26T00:00:00Z\n${[
    "place\tEureka\tcity\t\t-124.17076\t40.80188\teureka\t",
    "street\t3rd Street\ttertiary\tEureka\t-124.15693\t40.80493\t3rd street\t816,-124.16261,40.80401",
    "street\tMain Street\tresidential\tEureka\t-124.165\t40.803\tmain street\t12,-124.1655,40.8031",
    "street\tMain Street\tresidential\tArcata\t-124.083\t40.867\tmain street\t12,-124.0831,40.8671",
    "street\tA Street\tresidential\tRamona\t-116.87\t33.04\ta street\t105,-116.8712,33.0412",
  ].join("\n")}\n`);
  app = buildApp(runtime, { oidc: null, gazetteerPath: join(dir, "gazetteer.tsv") });
  bare = buildApp(runtime, { oidc: null, gazetteerPath: null });
  tokens["admin"] = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens["member"] = await tokenFor(app, "member@example.org", "another-good-password");
  tokens["viewer"] = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  tokens["outsider"] = await tokenFor(app, "outsider@example.org", "outsider-password-1");

  await saved({ name: "Bailey Address", phones: ["+17075550102"], personId: seed.memberId, address: "816 3rd St, Eureka, CA 95501" });
  await saved({ name: "Dana Unknown Address", emails: ["dana@example.org"], address: "999 Nowhere Road" });
  await saved({ name: "Emery Street Only", emails: ["emery@example.org"], address: "3rd Street Eureka" });
}, 60_000);

afterAll(async () => {
  await Promise.all([app, bare].map((target) => target?.close()));
  await runtime?.end();
  await admin?.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("placing a contact's address when it is saved", () => {
  it("reads an address without its ZIP code or state", () => {
    expect(searchableAddress("816 3rd St, Eureka, CA 95501")).toBe("816 3rd St, Eureka");
    expect(searchableAddress("816 3rd St Eureka CA 95501-1234")).toBe("816 3rd St Eureka");
    expect(searchableAddress("816 3rd St, Eureka, ca")).toBe("816 3rd St, Eureka");
    // A street type is not a state, and a state needs a comma or a ZIP code after it.
    expect(searchableAddress("12 Oak Ct")).toBe("12 Oak Ct");
    expect(searchableAddress("12 Main St")).toBe("12 Main St");
  });

  it("places one house number inside the jurisdiction's extent, and nothing else", async () => {
    // The same house number on Main Street in two towns: no town given, no point.
    expect((await saved({ name: "Ira Two Towns", address: "12 Main St" })).addressPoint).toBeNull();
    expect((await saved({ name: "Jo Arcata", address: "12 Main St, Arcata" })).addressPoint?.coordinates).toEqual([-124.0831, 40.8671]);
    // Found only in Ramona, far outside the jurisdiction's extent.
    expect((await saved({ name: "Kit Ramona", address: "105 A St" })).addressPoint).toBeNull();
    // With no gazetteer, nothing places.
    expect((await saved({ name: "Lee No Gazetteer", address: "816 3rd Street, Eureka" }, bare)).addressPoint).toBeNull();
  });
});

describe("POST /api/v1/jurisdictions/:jurisdictionId/contacts/in-area", () => {
  it("finds contacts inside by set point and by placed address, with names and channels only", async () => {
    const res = await inArea(app, tokens["member"]!, { area: EUREKA });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Found;
    expect(body.contacts.map(({ name, channels }) => ({ name, channels }))).toEqual([
      { name: "Avery Point", channels: ["email", "sms"] },
      { name: "Bailey Address", channels: ["sms", "inapp"] },
    ]);
    // Unplaced: the unknown address, the street alone, the address saved before placing, two towns, Ramona, no gazetteer.
    expect(body.unplaced).toBe(6);
    expect(Object.keys(body).sort()).toEqual(["contacts", "unplaced"]);
    expect(Object.keys(body.contacts[0]!).sort()).toEqual(["channels", "id", "name"]);
    expect(res.body).not.toMatch(/816|3rd St|-124|avery@|\+1707/);
  });

  it("never returns another jurisdiction's contacts, and row-level security holds without the route's guard", async () => {
    expect((await found()).contacts.map((c) => c.name)).not.toContain("Harper Other County");
    const theirs = (await inArea(app, tokens["outsider"]!, { area: EUREKA }, other)).json() as Found;
    expect(theirs.contacts.map((c) => c.name)).toEqual(["Harper Other County"]);
    expect((await inArea(app, tokens["outsider"]!, { area: EUREKA })).statusCode).toBe(403);
    const direct = await withPerson(runtime, seed.memberId, (tx) => contactsInArea(tx, other, EUREKA as never));
    expect(direct.contacts).toEqual([]);
  });

  it("refuses a member who may not send mass notifications, and anonymous callers", async () => {
    const res = await inArea(app, tokens["viewer"]!, { area: EUREKA });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toMatch(/Avery/);
    expect((await inArea(app, null, { area: EUREKA })).statusCode).toBe(401);
  });

  it("refuses an area that is not a closed, valid polygon of a bounded size", async () => {
    const ring = EUREKA.coordinates[0]!;
    const refused = async (area: unknown) => (await inArea(app, tokens["member"]!, { area })).statusCode;
    expect(await refused({ type: "Polygon", coordinates: [ring.slice(0, -1)] })).toBe(400);
    expect(await refused({ type: "Polygon", coordinates: [[ring[0], ring[1], ring[0]]] })).toBe(400);
    expect(await refused({ type: "Polygon", coordinates: [[[-200, 40], ...ring.slice(1, -1), [-200, 40]]] })).toBe(400);
    expect(await refused({ type: "Point", coordinates: [-124.17, 40.8] })).toBe(400);
    const many = Array.from({ length: 2001 }, (_, i) => [-124.2 + Math.cos(i / 318) * 0.01, 40.8 + Math.sin(i / 318) * 0.01]);
    expect(await refused({ type: "Polygon", coordinates: [[...many, many[0]]] })).toBe(400);
    // A bow tie whose outline crosses itself, and a hole outside its shell.
    const bowTie = await inArea(app, tokens["member"]!, { area: { type: "Polygon", coordinates: [[[-124.2, 40.78], [-124.14, 40.82], [-124.14, 40.78], [-124.2, 40.82], [-124.2, 40.78]]] } });
    expect(bowTie.statusCode).toBe(422);
    expect(bowTie.json().error).toMatch(/not a valid shape/);
    const hole = [[-123, 40], [-122.9, 40], [-122.9, 40.1], [-123, 40.1], [-123, 40]];
    expect(await refused({ type: "Polygon", coordinates: [ring, hole] })).toBe(422);
    expect(await refused({ type: "MultiPolygon", coordinates: [EUREKA.coordinates] })).toBe(200);
  });

  it("finds a contact whose address or point an administrator set through the contacts API, until it is cleared", async () => {
    const names = async () => (await found()).contacts.map((c) => c.name);
    const byAddress = await saved({ name: "Casey Via Address", emails: ["casey@example.org"], address: "816 3rd Street, Eureka" });
    const byPoint = await saved({ name: "Jules Via Point", emails: ["jules@example.org"], location: { type: "Point", coordinates: [-124.15, 40.79] } });
    expect(await names()).toEqual(["Avery Point", "Bailey Address", "Casey Via Address", "Jules Via Point"]);
    const put = (id: string, body: Record<string, unknown>) =>
      app.inject({ method: "PUT", url: `/api/v1/contacts/${id}`, headers: auth(tokens["admin"]!), payload: body });
    await put(byPoint.id, { name: "Jules Via Point", location: null });
    // Moving the address to one that does not place clears the old point with it.
    const moved = await put(byAddress.id, { name: "Casey Via Address", address: "999 Nowhere Road" });
    expect(moved.json().addressPoint).toBeNull();
    expect(await names()).toEqual(["Avery Point", "Bailey Address"]);
  });

  it("names the send limit when an area holds more contacts than one send reaches", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`, headers: auth(tokens["member"]!),
      payload: { subject: "Too many", message: "x", channels: ["email"], mode: "broadcast", contactIds: Array.from({ length: 501 }, () => randomUUID()) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/at most 500 contacts/);
  });

  it("builds the area once per search under a generic plan, so a large area over many contacts stays fast", async () => {
    const bulk = await createJurisdiction(admin, "bulk", "Bulk County OES");
    await addMembership(admin, outsider, bulk, "admin");
    await admin`
      insert into contacts (jurisdiction_id, name, emails, location, updated_by)
      select ${bulk}, 'Bulk ' || n, array['bulk' || n || '@example.org'],
        ST_SetSRID(ST_MakePoint(-124.17 + (n % 50) * 0.0001, 40.8 + (n / 50) * 0.0001), 4326), ${seed.adminId}
      from generate_series(1, 2000) n`;
    const corners = Array.from({ length: 1999 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 1999;
      return [-124.17 + 0.05 * Math.cos(angle), 40.8 + 0.05 * Math.sin(angle)] as [number, number];
    });
    const circle = { type: "Polygon" as const, coordinates: [[...corners, corners[0]!]] };
    const started = performance.now();
    const result = await withPerson(runtime, outsider, async (tx) => {
      await tx`set local plan_cache_mode = force_generic_plan`;
      return contactsInArea(tx, bulk, circle);
    });
    expect(result.contacts).toHaveLength(2000);
    // Built per contact, this took about 9 s; built once it takes well under one.
    expect(performance.now() - started).toBeLessThan(4000);
  });
});
