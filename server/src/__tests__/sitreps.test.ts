import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SitrepRow, LifelineCurrent } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Situation reporting and briefing (VEOC-20, F8): lifelines entry edits
 * one lifeline without retyping the rest; a sitrep composes from current
 * board state in one action and archives immutably.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
const boards: Record<string, string> = {};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });

  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  for (const key of ["lifelines", "shelters", "road_closures", "significant_events"]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { templateKey: key },
    });
    boards[key] = res.json().id as string;
  }
  await post("shelters", { name: "Weitchpec Gym", status: "normal", capacity: 120, occupancy: 40 });
  await post("shelters", { name: "Orick School", status: "closed", capacity: 60, occupancy: 0 });
  await post("road_closures", { road: "SR-169", reason: "slide", status: "closed" });
  await post("significant_events", {
    summary: "Levee overtopping at Klamath",
    occurred_at: "2026-09-17T09:00:00Z",
    severity: "critical",
  });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

async function post(board: string, data: Record<string, unknown>): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boards[board]}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: data,
  });
  if (res.statusCode !== 201) throw new Error(`post to ${board} failed: ${res.body}`);
}

function byLifeline(list: LifelineCurrent[]): Map<string, LifelineCurrent> {
  return new Map(list.map((l) => [l.lifeline, l]));
}

describe("Community Lifelines status entry", () => {
  it("returns all eight lifelines, unknown until entered", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    const lifelines = res.json().lifelines as LifelineCurrent[];
    expect(lifelines).toHaveLength(8);
    expect(lifelines.every((l) => l.status === "unknown")).toBe(true);
  });

  it("edits one lifeline without retyping the rest, remembering each prior submission", async () => {
    const put = (lifeline: string, status: string, note?: string) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { lifeline, status, ...(note ? { note } : {}) },
      });

    await put("energy", "unstable", "substation down");
    const after2 = await put("water_systems", "stabilizing");
    // Setting water_systems did not disturb the energy entry.
    let map = byLifeline(after2.json().lifelines as LifelineCurrent[]);
    expect(map.get("energy")!.status).toBe("unstable");
    expect(map.get("energy")!.note).toBe("substation down");
    expect(map.get("water_systems")!.status).toBe("stabilizing");
    expect(map.get("communications")!.status).toBe("unknown");

    // Update just energy again; the newest entry wins, others untouched.
    const after3 = await put("energy", "stable", "restored");
    map = byLifeline(after3.json().lifelines as LifelineCurrent[]);
    expect(map.get("energy")!.status).toBe("stable");
    expect(map.get("energy")!.note).toBe("restored");
    expect(map.get("water_systems")!.status).toBe("stabilizing");
  });

  it("rejects an unknown lifeline or status", async () => {
    const badLifeline = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { lifeline: "not_a_lifeline", status: "stable" },
    });
    expect(badLifeline.statusCode).toBe(400);
    const badStatus = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/lifelines`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { lifeline: "energy", status: "purple" },
    });
    expect(badStatus.statusCode).toBe(400);
  });
});

describe("situation report composition and archive", () => {
  it("composes from current board state in one action", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { period: "OP-1" },
    });
    expect(res.statusCode).toBe(201);
    const sitrep = res.json() as SitrepRow;
    expect(sitrep.period).toBe("OP-1");

    // Lifelines frozen at their current condition (energy was set to stable).
    const map = byLifeline(sitrep.content.lifelines);
    expect(map.get("energy")!.status).toBe("stable");
    expect(map.get("water_systems")!.status).toBe("stabilizing");

    // Board summaries count records and group by status.
    const shelters = sitrep.content.boards.find((b) => b.key === "shelters")!;
    expect(shelters.records).toBe(2);
    expect(shelters.byStatus).toEqual({ normal: 1, closed: 1 });

    // Significant events carried in.
    expect(sitrep.content.significantEvents).toHaveLength(1);
    expect(sitrep.content.significantEvents[0]!.summary).toContain("Levee overtopping");
  });

  it("archives immutably: the stored content does not move when boards change afterward", async () => {
    const composed = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { period: "OP-2" },
    });
    const id = (composed.json() as SitrepRow).id;
    const before = (composed.json() as SitrepRow).content.boards.find((b) => b.key === "shelters")!;
    expect(before.records).toBe(2);

    // The world moves on.
    await post("shelters", { name: "Klamath Hall", status: "normal", capacity: 80, occupancy: 5 });

    // The archived sitrep is unchanged.
    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/sitreps/${id}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const after = (fetched.json() as SitrepRow).content.boards.find((b) => b.key === "shelters")!;
    expect(after.records).toBe(2); // still 2, not 3

    // And the database refuses to mutate a sitrep row at all.
    await expect(
      admin`update sitreps set period = 'tampered' where id = ${id}`,
    ).rejects.toThrow(/append-only|immutable/i);
    await expect(admin`delete from sitreps where id = ${id}`).rejects.toThrow(
      /append-only|immutable/i,
    );
  });

  it("lists sitreps newest first and hides them from outsiders", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const periods = (list.json().sitreps as Array<{ period: string }>).map((s) => s.period);
    expect(periods).toEqual(["OP-2", "OP-1"]);

    const outsiderId = await admin`
      insert into persons (email, display_name, password_hash)
      select 'briefing-outsider@example.org', 'Out', password_hash from persons
      where email = 'member@example.org' returning id`;
    void outsiderId;
    const outToken = await tokenFor("briefing-outsider@example.org", "another-good-password");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      headers: { authorization: `Bearer ${outToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});
