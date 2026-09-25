import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { parseTypeLevel } from "../resource/typing.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The NIMS resource typing catalog, the resource pool with its status moves
 * and demobilization, and the cost each request carries, on real PostgreSQL
 * with row-level security.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
const tokens: Record<"admin" | "member" | "viewer" | "outsider", string> = { admin: "", member: "", viewer: "", outsider: "" };

type Who = keyof typeof tokens;
const call = (who: Who, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(tokens[who]), ...(payload ? { payload } : {}) });
const base = () => `/api/v1/jurisdictions/${jurisdictionId}`;

async function request(fields: Record<string, unknown>, states = ["accepted", "sourcing"]): Promise<string> {
  const submitted = await call("admin", "POST", `${base()}/resource-requests`, { origin: "eoc", item: "Engine request", ...fields });
  expect(submitted.statusCode, submitted.body).toBe(201);
  const id = submitted.json().id as string;
  for (const toState of states) {
    const moved = await call("admin", "POST", `/api/v1/resource-requests/${id}/transition`, { toState });
    expect(moved.statusCode, moved.body).toBe(200);
  }
  return id;
}

async function resource(name: string, kind: string, type: number | null, who: Who = "member"): Promise<string> {
  const added = await call(who, "POST", `${base()}/resources`, { name, kind, type });
  expect(added.statusCode, added.body).toBe(201);
  return added.json().id as string;
}

const move = (id: string, body: Record<string, unknown>, who: Who = "member") =>
  call(who, "POST", `/api/v1/resources/${id}/transition`, body);

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewerId, jurisdictionId, "viewer");
  const elsewhere = await createJurisdiction(admin, "elsewhere", "Elsewhere County");
  const outsiderId = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "outsider-password-1" });
  await addMembership(admin, outsiderId, elsewhere, "admin");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  tokens.admin = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens.member = await tokenFor(app, "member@example.org", "another-good-password");
  tokens.viewer = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  tokens.outsider = await tokenFor(app, "outsider@example.org", "outsider-password-1");
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("typing catalog", () => {
  it("reads the seed to members, lets only administrators add a kind, and hides it from outsiders", async () => {
    const asMember = await call("member", "GET", `${base()}/resources/kinds`);
    expect(asMember.statusCode).toBe(200);
    expect(asMember.json().canManage).toBe(false);
    expect(asMember.json().kinds.find((k: { key: string }) => k.key === "engine")).toMatchObject({
      name: "Engine", source: "seed", levels: expect.arrayContaining([{ type: 7, capability: "" }]),
    });
    expect((await call("admin", "GET", `${base()}/resources/kinds`)).json().canManage).toBe(true);
    expect((await call("outsider", "GET", `${base()}/resources/kinds`)).statusCode).toBe(403);

    const kind = { name: "Sandbag Filling Machine", discipline: "Public Works", levels: [{ type: 1, capability: "Trailer mounted" }] };
    expect((await call("member", "POST", `${base()}/resources/kinds`, kind)).statusCode).toBe(403);
    const added = await call("admin", "POST", `${base()}/resources/kinds`, kind);
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().key).toBe("local:sandbag-filling-machine");
    expect((await call("admin", "POST", `${base()}/resources/kinds`, kind)).statusCode).toBe(409);
    const kinds = (await call("viewer", "GET", `${base()}/resources/kinds`)).json().kinds as Array<{ key: string; source: string }>;
    expect(kinds.find((k) => k.key === "local:sandbag-filling-machine")?.source).toBe("local");
  });

  it("reads type levels as digits, Type words and Roman numerals", () => {
    expect(["1", "Type 2", "type III", "Type X", "", "Single Type", "Type 0", "11", "Type"].map(parseTypeLevel))
      .toEqual([1, 2, 3, 10, null, null, undefined, undefined, undefined]);
  });

  it("imports an RTLT export all or nothing, and a second import replaces the first", async () => {
    const url = `${base()}/resources/kinds/import`;
    const bad = [
      "RTLT ID,Resource Typing Definition,Resource Category,Type Level,Capability",
      "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type I,Largest team",
      "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type 9000,Typo",
    ].join("\n");
    const refused = await call("admin", "POST", url, { csv: bad, sourceNote: "RTLT export, test" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toContain("row 3");
    const count = async () => Number((await admin`select count(*) from resource_kinds where source = 'rtlt'`)[0]!.count);
    expect(await count()).toBe(0);

    const good = [
      "RTLT ID,Resource Typing Definition,Resource Category,Type Level,Capability",
      "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type I,Largest team",
      "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type 2,Smaller team",
      "3-509-1002,Shelter Manager,Mass Care Services,Single Type,Runs a shelter",
    ].join("\n");
    expect((await call("member", "POST", url, { csv: good, sourceNote: "RTLT export" })).statusCode).toBe(403);
    const imported = await call("admin", "POST", url, { csv: good, sourceNote: "RTLT export downloaded 2026-09-23" });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().imported).toBe(2);
    const kinds = (await call("member", "GET", `${base()}/resources/kinds`)).json().kinds as Array<Record<string, unknown>>;
    expect(kinds.find((k) => k.key === "rtlt:1-508-1001")).toMatchObject({
      source: "rtlt", rtltId: "1-508-1001", discipline: "Search and Rescue", sourceNote: "RTLT export downloaded 2026-09-23",
      levels: [{ type: 1, capability: "Largest team" }, { type: 2, capability: "Smaller team" }],
    });
    expect(kinds.find((k) => k.key === "rtlt:3-509-1002")).toMatchObject({ levels: [], notes: "Runs a shelter" });

    const lines = good.split("\n");
    const again = await call("admin", "POST", url, { csv: [lines[0], lines[2], lines[3]].join("\n"), sourceNote: "second export" });
    expect(again.json().imported).toBe(2);
    expect(await count()).toBe(2);
    const replaced = (await call("member", "GET", `${base()}/resources/kinds`)).json().kinds as Array<Record<string, unknown>>;
    expect(replaced.find((k) => k.key === "rtlt:1-508-1001")).toMatchObject({
      sourceNote: "second export", levels: [{ type: 2, capability: "Smaller team" }],
    });
  });
});

describe("typed requests and the pool", () => {
  it("checks the kind and type of a request and of a resource against the catalog", async () => {
    const submit = (fields: Record<string, unknown>) =>
      call("member", "POST", `${base()}/resource-requests`, { origin: "eoc", item: "Typed request", ...fields });
    expect((await submit({ resourceKind: "no_such_kind" })).statusCode).toBe(400);
    expect((await submit({ resourceKind: "engine", resourceType: 8 })).statusCode).toBe(400);
    expect((await submit({ resourceType: 3 })).statusCode).toBe(400);
    expect((await submit({ resourceKind: "rtlt:3-509-1002", resourceType: 1 })).statusCode).toBe(400);
    expect((await submit({ resourceKind: "engine", resourceType: 3 })).statusCode).toBe(201);
    const listed = (await call("member", "GET", `${base()}/resource-requests`)).json().requests as Array<Record<string, unknown>>;
    expect(listed.find((r) => r.item === "Typed request")).toMatchObject({ resourceKind: "engine", resourceType: 3, costCents: 0 });

    expect((await call("member", "POST", `${base()}/resources`, { name: "Engine 9", kind: "engine" })).statusCode).toBe(400);
    expect((await call("member", "POST", `${base()}/resources`, { name: "Engine 9", kind: "nope", type: 1 })).statusCode).toBe(400);
    expect((await call("viewer", "POST", `${base()}/resources`, { name: "Engine 9", kind: "engine", type: 3 })).statusCode).toBe(403);
    expect((await call("outsider", "POST", `${base()}/resources`, { name: "Engine 9", kind: "engine", type: 3 })).statusCode).toBe(403);
    await resource("Shelter team", "rtlt:3-509-1002", null);
    expect((await call("outsider", "GET", `${base()}/resources`)).statusCode).toBe(403);
    const pool = (await call("viewer", "GET", `${base()}/resources`)).json();
    expect(pool.resources).toEqual([expect.objectContaining({ name: "Shelter team", status: "available", type: null, request: null })]);
  });

  it("assigns only a matching resource to an open request, and demobilization is terminal", async () => {
    const requestId = await request({ resourceKind: "engine", resourceType: 3 });
    const engine2 = await resource("Engine 41", "engine", 2);
    const engine4 = await resource("Engine 44", "engine", 4);
    const tender = await resource("Tender 7", "water_tender", 1);

    expect((await move(engine4, { to: "assigned", requestId })).statusCode).toBe(409);
    expect((await move(tender, { to: "assigned", requestId })).statusCode).toBe(409);
    expect((await move(engine2, { to: "assigned" })).statusCode).toBe(400);
    const untyped = await request({});
    expect((await move(engine2, { to: "assigned", requestId: untyped })).statusCode).toBe(409);
    const unsourced = await request({ resourceKind: "engine" }, ["accepted"]);
    expect((await move(engine2, { to: "assigned", requestId: unsourced })).statusCode).toBe(409);
    expect((await move(engine2, { to: "assigned", requestId }, "viewer")).statusCode).toBe(403);
    expect((await move(engine2, { to: "assigned", requestId }, "outsider")).statusCode).toBe(404);

    const assigned = await move(engine2, { to: "assigned", requestId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect((await move(engine2, { to: "assigned", requestId })).statusCode).toBe(409);
    const pool = (await call("member", "GET", `${base()}/resources`)).json().resources as Array<Record<string, unknown>>;
    expect(pool.find((r) => r.id === engine2)).toMatchObject({ status: "assigned", request: { id: requestId, item: "Engine request" } });

    expect((await move(engine2, { to: "demobilized" })).statusCode).toBe(400);
    const demob = await move(engine2, { to: "demobilized", returnCondition: "needs_service", checks: ["equipment_returned", "inspected", "inspected"] });
    expect(demob.statusCode, demob.body).toBe(200);
    const [row] = await admin`select status, request_id, return_condition, demobilization_checks, demobilized_at from resources where id = ${engine2}`;
    expect(row).toMatchObject({ status: "demobilized", request_id: null, return_condition: "needs_service", demobilization_checks: ["equipment_returned", "inspected"] });
    expect(row!.demobilized_at).toBeInstanceOf(Date);
    expect((await move(engine2, { to: "available" })).statusCode).toBe(409);
    const [audit] = await admin`
      select payload from audit_events where subject_id = ${engine2} and category = 'resource.status' order by seq desc limit 1`;
    expect(audit!.payload).toMatchObject({ from: "assigned", to: "demobilized", requestId, returnCondition: "needs_service" });

    expect((await move(engine4, { to: "out_of_service" })).statusCode).toBe(200);
    expect((await move(engine4, { to: "assigned", requestId })).statusCode).toBe(409);
    expect((await move(engine4, { to: "available" })).statusCode).toBe(200);
    expect((await move(tender, { to: "available" })).statusCode).toBe(409);
  });

  it("refuses assignment to a request on a closed incident but still lets a resource leave it", async () => {
    const [incident] = await admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${jurisdictionId}, 'Typing incident', 'incident', ${adminId}) returning id`;
    const incidentId = incident!.id as string;
    const requestId = await request({ resourceKind: "dozer", incidentId });
    const first = await resource("Dozer 1", "dozer", 1);
    const second = await resource("Dozer 2", "dozer", 3);
    expect((await move(first, { to: "assigned", requestId })).statusCode).toBe(200);
    await admin`update incidents set closed_at = now(), closed_by = ${adminId} where id = ${incidentId}`;
    const closed = await move(second, { to: "assigned", requestId });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe("incident is closed");
    expect((await move(first, { to: "available" })).statusCode).toBe(200);
  });
});

describe("cost rollup", () => {
  it("carries each request's recorded costs on the request list, scoped by incident", async () => {
    const [incident] = await admin`
      insert into incidents (jurisdiction_id, name, kind, activated_by)
      values (${jurisdictionId}, 'Cost incident', 'incident', ${adminId}) returning id`;
    const incidentId = incident!.id as string;
    const requestId = await request({ item: "Costed tender", resourceKind: "water_tender", incidentId });
    for (const amountCents of [540_000, 9_605]) {
      const cost = await call("member", "POST", `/api/v1/resource-requests/${requestId}/costs`, { category: "equipment", amountCents });
      expect(cost.statusCode, cost.body).toBe(201);
    }
    const scoped = (await call("viewer", "GET", `${base()}/resource-requests?incidentId=${incidentId}`)).json().requests;
    expect(scoped).toEqual([expect.objectContaining({ id: requestId, resourceKind: "water_tender", costCents: 549_605 })]);
    const csv = (await call("viewer", "GET", `/api/v1/resource-requests/${requestId}/costs/export`)).body;
    expect(csv).toContain("TOTAL,5496.05");
  });
});
