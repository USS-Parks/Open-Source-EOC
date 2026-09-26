import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, tokenFor, type Sql } from "./helpers.js";

/**
 * The map reads an incident's boards through the incident (OGC items and
 * vector tiles with `incidentId`), the way the incident's board views do: a
 * participant from another organization sees the incident's own records on
 * them, and nothing else. A stranger, another incident, a board the incident
 * does not use, a revoked grant, admin-only fields and per-record rules all
 * stay refused, on both surfaces.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
const tokens: Record<string, string> = {};
let flood: string;
let fire: string;
/** A board both incidents use, holding a record of each and one of the jurisdiction's own. */
let shared: string;
/** A board only the fire uses. */
let fireOnly: string;
/** A board of the flood whose records only their creators (and administrators) read. */
let privateBoard: string;
let revokedGrant: string;

const PASSWORD = "incident-map-layers-pass";
const people = {
  owner: "owner@map.example",
  partner: "partner@map.example",
  stranger: "stranger@map.example",
  revoked: "revoked@map.example",
  /** A partner taking part in both incidents. */
  both: "both@map.example",
} as const;

const sitesTemplate = {
  key: "map_sites", version: 1, title: "Map Sites",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "secret", label: "Admin note", type: "text", read: "admin" },
    { key: "site", label: "Site", type: "geometry", geometryKind: "point" },
  ],
  views: [{ key: "all", title: "All", columns: ["name"] }],
};
const privateTemplate = {
  key: "map_private", version: 1, title: "Map Private Reports",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "site", label: "Site", type: "geometry", geometryKind: "point" },
  ],
  views: [{ key: "all", title: "All", columns: ["name"] }],
  recordAccess: { read: [{ kind: "creator" }], edit: [{ kind: "creator" }] },
};

/** The slippy-map tile holding a WGS84 position. */
function tileOf(lng: number, lat: number, z: number): string {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return `${z}/${x}/${y}`;
}
const TILE = tileOf(-123.6, 41.2, 13);
const point = (i: number) => ({ type: "Point", coordinates: [-123.6 + i * 0.001, 41.2 + i * 0.001] });

async function call(who: keyof typeof people, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: auth(tokens[who]!), ...(payload ? { payload } : {}) });
}
async function created(who: keyof typeof people, url: string, payload: Record<string, unknown>): Promise<string> {
  const response = await call(who, "POST", url, payload);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json().id as string;
}
const items = (board: string, incidentId?: string, query = "") =>
  `/api/v1/ogc/collections/${board}/items?${incidentId ? `incidentId=${incidentId}&` : ""}${query}`;
const tile = (board: string, incidentId?: string) =>
  `/api/v1/tiles/boards/${board}/${TILE}.mvt${incidentId ? `?incidentId=${incidentId}` : ""}`;
const names = (body: { features: Array<{ properties: { name?: string } }> }) =>
  body.features.map((feature) => feature.properties.name).sort();

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const owner = await createJurisdiction(admin, "harbor-oes", "Harbor OES");
  const partner = await createJurisdiction(admin, "valley-aid", "Valley Aid");
  const ids: Record<string, string> = {};
  for (const [key, email] of Object.entries(people)) {
    ids[key] = await createPerson(admin, { email, displayName: key, password: PASSWORD });
    await addMembership(admin, ids[key]!, key === "owner" ? owner : partner, key === "owner" ? "admin" : "member");
  }
  await admin`update persons set is_instance_admin = true where id = ${ids.owner!}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  for (const [key, email] of Object.entries(people)) tokens[key] = await tokenFor(app, email, PASSWORD);

  for (const template of [sitesTemplate, privateTemplate]) {
    expect((await call("owner", "POST", "/api/v1/templates", template)).statusCode).toBeLessThan(300);
  }
  const activate = async (name: string) => {
    const response = await call("owner", "POST", `/api/v1/jurisdictions/${owner}/incidents`, { templateKey: "daily_ops", name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().incidentId as string;
  };
  flood = await activate("Harbor Flood");
  fire = await activate("Ridge Fire");
  const board = (templateKey: string) => created("owner", `/api/v1/jurisdictions/${owner}/boards`, { templateKey });
  shared = await board("map_sites");
  fireOnly = await board("map_sites");
  privateBoard = await board("map_private");
  await admin`insert into incident_boards (incident_id, board_id) values
    (${flood}, ${shared}), (${fire}, ${shared}), (${fire}, ${fireOnly}), (${flood}, ${privateBoard})`;

  const grant = async (who: "partner" | "revoked" | "both", incident = flood) => {
    const response = await call("owner", "POST", `/api/v1/incidents/${incident}/participants`, {
      organizationSlug: "valley-aid", personEmail: people[who], incidentPositionTitle: "Aid liaison",
      role: "contributor", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Joint response",
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().participant.id as string;
  };
  await grant("partner");
  revokedGrant = await grant("revoked");
  await grant("both", flood);
  await grant("both", fire);

  const records = `/api/v1/boards/${shared}/records`;
  await created("owner", `${records}?incidentId=${flood}`, { name: "Flood levee", secret: "flood-secret", site: point(0) });
  await created("owner", `${records}?incidentId=${flood}`, { name: "Flood shelter", secret: "flood-secret", site: point(1) });
  await created("owner", `${records}?incidentId=${fire}`, { name: "Fire camp", secret: "fire-secret", site: point(2) });
  await created("owner", records, { name: "Standing depot", secret: "standing-secret", site: point(3) });
  // Archive hides a record from default views, the map's included.
  const archived = await created("owner", `${records}?incidentId=${flood}`, { name: "Flood archived", site: point(7) });
  const archive = await call("owner", "POST", `${records}/${archived}/archive`);
  expect(archive.statusCode, archive.body).toBe(200);
  await created("owner", `/api/v1/boards/${fireOnly}/records?incidentId=${fire}`, { name: "Fire helibase", site: point(4) });
  const privateRecords = `/api/v1/boards/${privateBoard}/records?incidentId=${flood}`;
  await created("owner", privateRecords, { name: "Owner report", site: point(5) });
  await created("partner", privateRecords, { name: "Partner report", site: point(6) });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("an incident's boards on the map, read through the incident", () => {
  it("gives a participant the incident's own records on its board, at member field level", async () => {
    const unscoped = await call("partner", "GET", items(shared));
    expect(unscoped.statusCode).toBe(403);

    const scoped = await call("partner", "GET", items(shared, flood));
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(names(scoped.json())).toEqual(["Flood levee", "Flood shelter"]);
    expect(scoped.body).not.toContain("secret");
    expect(scoped.body).not.toContain("Fire camp");
    expect(scoped.body).not.toContain("Standing depot");

    // The next page stays in the incident's scope.
    const first = await call("partner", "GET", items(shared, flood, "limit=1"));
    const next = (first.json().links as Array<{ rel: string; href: string }>).find((link) => link.rel === "next")!;
    expect(next.href).toContain(`incidentId=${flood}`);
    const second = await call("partner", "GET", next.href);
    expect(second.statusCode).toBe(200);
    expect([...names(first.json()), ...names(second.json())].sort()).toEqual(["Flood levee", "Flood shelter"]);

    const detail = await call("partner", "GET", `/api/v1/incidents/${flood}`);
    expect(detail.json().boards).toContainEqual({ id: shared, title: "Map Sites", templateKey: "map_sites" });
  });

  it("keeps a member's unscoped reading, and scopes it to the incident when asked", async () => {
    expect(names((await call("owner", "GET", items(shared))).json()))
      .toEqual(["Fire camp", "Flood levee", "Flood shelter", "Standing depot"]);
    const scoped = await call("owner", "GET", items(shared, flood));
    expect(names(scoped.json())).toEqual(["Flood levee", "Flood shelter"]);
    // An administrator of the board's jurisdiction keeps its role, and so its admin fields.
    expect(scoped.body).toContain("flood-secret");
    expect(scoped.body).not.toContain("fire-secret");
  });

  it("refuses a stranger, an incident the caller does not take part in, and a board the incident does not use", async () => {
    for (const url of [items(shared, flood), items(shared), items(fireOnly, flood), tile(shared, flood)]) {
      const refused = await call("stranger", "GET", url);
      expect(refused.statusCode, url).toBe(404);
      expect(refused.body).not.toContain("Flood");
    }
    for (const url of [items(shared, fire), tile(shared, fire), items(fireOnly, fire)]) {
      const refused = await call("partner", "GET", url);
      expect(refused.statusCode, url).toBe(404);
      expect(refused.body).not.toContain("Fire");
    }
    // The fire's board named through the flood the partner does take part in.
    for (const url of [items(fireOnly, flood), tile(fireOnly, flood)]) {
      const refused = await call("partner", "GET", url);
      expect(refused.statusCode, url).toBe(400);
      expect(refused.body).not.toContain("Fire helibase");
    }
    expect((await call("partner", "GET", items(fireOnly))).statusCode).toBe(404);
    expect((await call("partner", "GET", items(shared, "not-an-incident"))).statusCode).toBe(400);
    expect((await call("partner", "GET", `/api/v1/tiles/boards/${shared}/${TILE}.mvt?incidentId=x`)).statusCode).toBe(400);
  });

  it("keeps per-record rules: a participant reads only the records the board's rule admits", async () => {
    expect(names((await call("partner", "GET", items(privateBoard, flood))).json())).toEqual(["Partner report"]);
    expect(names((await call("owner", "GET", items(privateBoard, flood))).json())).toEqual(["Owner report", "Partner report"]);
    const tiled = await call("partner", "GET", tile(privateBoard, flood));
    expect(tiled.statusCode).toBe(200);
    expect(tiled.rawPayload.includes("Partner report")).toBe(true);
    expect(tiled.rawPayload.includes("Owner report")).toBe(false);
  });

  it("cuts the same scope into vector tiles", async () => {
    expect((await call("partner", "GET", tile(shared))).statusCode).toBe(403);
    const tiled = await call("partner", "GET", tile(shared, flood));
    expect(tiled.statusCode).toBe(200);
    const bytes = tiled.rawPayload;
    for (const kept of ["Flood levee", "Flood shelter"]) expect(bytes.includes(kept), kept).toBe(true);
    for (const left of ["Fire camp", "Standing depot", "secret"]) expect(bytes.includes(left), left).toBe(false);
    const member = (await call("owner", "GET", tile(shared))).rawPayload;
    for (const all of ["Fire camp", "Standing depot", "Flood levee"]) expect(member.includes(all), all).toBe(true);
  });

  it("lists a board read only through incidents with an items link for each, and a member's board as before", async () => {
    const listed = async (who: keyof typeof people) => ((await call(who, "GET", "/api/v1/ogc/collections")).json().collections as Array<{
      id: string; incidentIds?: string[]; links: Array<{ href: string }>;
    }>).find((collection) => collection.id === shared)!;
    const member = await listed("owner");
    expect(member.incidentIds).toBeUndefined();
    expect(member.links.map((link) => link.href)).toEqual([`/api/v1/ogc/collections/${shared}/items`]);
    // A member's map reads its own board unscoped, so records that name no incident stay on it.
    expect(names((await call("owner", "GET", member.links[0]!.href)).json())).toContain("Standing depot");

    const partner = await listed("partner");
    expect(partner.incidentIds).toEqual([flood]);
    expect(partner.links.map((link) => link.href)).toEqual([`/api/v1/ogc/collections/${shared}/items?incidentId=${flood}`]);
    const followed = await call("partner", "GET", partner.links[0]!.href);
    expect(followed.statusCode).toBe(200);
    expect(names(followed.json())).toEqual(["Flood levee", "Flood shelter"]);

    const both = await listed("both");
    expect(both.links.map((link) => link.href).sort())
      .toEqual([flood, fire].map((id) => `/api/v1/ogc/collections/${shared}/items?incidentId=${id}`).sort());
    for (const link of both.links) expect((await call("both", "GET", link.href)).statusCode, link.href).toBe(200);
  });

  it("leaves archived records off the map, in items and tiles", async () => {
    for (const who of ["owner", "partner"] as const) {
      for (const url of [items(shared, flood), tile(shared, flood)]) {
        const response = await call(who, "GET", url);
        expect(response.statusCode, url).toBe(200);
        expect(response.rawPayload.includes("Flood archived"), `${who} ${url}`).toBe(false);
      }
    }
    expect((await call("owner", "GET", items(shared))).body).not.toContain("Flood archived");
    expect((await call("owner", "GET", tile(shared))).rawPayload.includes("Flood archived")).toBe(false);
    const [row] = await admin`select archived_at from board_records where data ->> 'name' = 'Flood archived'`;
    expect(row!.archived_at).not.toBeNull();
  });

  it("answers 400 to an items request whose board id is not a UUID", async () => {
    expect((await call("owner", "GET", "/api/v1/ogc/collections/not-a-uuid/items")).statusCode).toBe(400);
  });

  it("refuses a revoked participant at once", async () => {
    expect((await call("revoked", "GET", items(shared, flood))).statusCode).toBe(200);
    const revoke = await call("owner", "POST", `/api/v1/incidents/${flood}/participants/${revokedGrant}/revoke`, { reason: "Assignment ended" });
    expect(revoke.statusCode, revoke.body).toBe(200);
    for (const url of [items(shared, flood), tile(shared, flood)]) {
      const refused = await call("revoked", "GET", url);
      expect(refused.statusCode, url).toBe(404);
      expect(refused.body).not.toContain("Flood");
    }
  });
});
