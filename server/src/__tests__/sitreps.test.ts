import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SitrepRow, LifelineCurrent } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Situation reporting and briefing (F8): lifelines entry edits
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

  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
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
    const outToken = await tokenFor(app, "briefing-outsider@example.org", "another-good-password");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      headers: { authorization: `Bearer ${outToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const legacyContent = {
      period: "Legacy jurisdiction archive",
      composedAt: "2026-09-17T08:00:00Z",
      lifelines: [], boards: [], significantEvents: [], rumorControl: [],
    };
    const [legacy] = await admin`
      insert into sitreps (jurisdiction_id, period, content, composed_by)
      values (${seed.jurisdictionId}, ${legacyContent.period},
        ${admin.json(legacyContent as never)}, ${seed.memberId}) returning id`;
    const legacyRead = await app.inject({
      method: "GET", url: `/api/v1/sitreps/${legacy!.id as string}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(legacyRead.statusCode, legacyRead.body).toBe(200);
    expect((legacyRead.json() as SitrepRow).period).toBe("Legacy jurisdiction archive");
  });

  it("freezes attributed incident assessments and keeps another incident unknown", async () => {
    await ensureStandardIncidentTemplates(admin);
    const headers = { authorization: `Bearer ${adminToken}` };
    const activate = async (name: string) => {
      const response = await app.inject({ method: "POST", headers,
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
        payload: { templateKey: "daily_ops", name } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().incidentId as string;
    };
    const incidentId = await activate("Briefing assessment A");
    const other = await activate("Briefing assessment B");
    const payload = { lifeline: "energy", condition: "unstable", confidence: "confirmed",
      assessedAt: "2026-09-21T10:00:00Z", impactStatement: "Substation offline",
      stabilizationOutlook: "Restore critical facilities first",
      actions: [{ key: "generator", title: "Stage backup generator", status: "in_progress",
        dueAt: "2026-09-21T14:00:00Z" }] };
    const report = await app.inject({ method: "POST", headers,
      url: `/api/v1/incidents/${incidentId}/lifeline-assessments`, payload });
    expect(report.statusCode, report.body).toBe(201);
    const compose = async (scope: string) => {
      const response = await app.inject({ method: "POST", headers,
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
        payload: { period: "Assessment period", incidentId: scope } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json() as SitrepRow;
    };
    const frozen = await compose(incidentId);
    const energy = frozen.content.lifelines.find((line) => line.lifeline === "energy")!;
    expect(energy).toMatchObject({ status: "unstable", note: "Substation offline",
      assessment: { id: report.json().id, person: "Admin", payload: {
        actions: [{ title: "Stage backup generator" }] } } });
    expect((await compose(other)).content.lifelines.every((line) => line.status === "unknown")).toBe(true);
    const revised = await app.inject({ method: "POST", headers,
      url: `/api/v1/incidents/${incidentId}/lifeline-assessments`, payload: {
        ...payload, condition: "stable", impactStatement: "Power restored",
        supersedesAssessmentId: report.json().id } });
    expect(revised.statusCode, revised.body).toBe(201);
    const archive = await app.inject({ method: "GET", headers, url: `/api/v1/sitreps/${frozen.id}` });
    expect(archive.json().content).toEqual(frozen.content);
    expect((await compose(incidentId)).content.lifelines.find((line) => line.lifeline === "energy")?.status).toBe("stable");
    const missing = await app.inject({ method: "POST", headers,
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      payload: { period: "Invalid", incidentId: "10000000-0000-4000-8000-000000000099" } });
    expect(missing.statusCode).toBe(404);
  });

  it("composes an incident-only briefing with ESF, JIC sources, freshness, and revisions", async () => {
    await ensureStandardIncidentTemplates(admin);
    const headers = { authorization: `Bearer ${adminToken}` };
    const activate = async (name: string) => {
      const response = await app.inject({ method: "POST", headers,
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
        payload: { templateKey: "daily_ops", name } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().incidentId as string;
    };
    const incidentA = await activate("D26 briefing incident A");
    const incidentB = await activate("D26 briefing incident B");
    const attachedBoard = async (incidentId: string, templateKey: string) => {
      const created = await app.inject({ method: "POST", headers,
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
        payload: { templateKey, title: `${incidentId}:${templateKey}` } });
      expect(created.statusCode, created.body).toBe(201);
      const boardId = created.json().id as string;
      await admin`insert into incident_boards (incident_id, board_id)
        values (${incidentId}, ${boardId})`;
      return boardId;
    };
    const incidentBoards = async (incidentId: string) => {
      const rows = await admin`
        select b.id, b.template_key from incident_boards ib join boards b on b.id = ib.board_id
        where ib.incident_id = ${incidentId}`;
      return new Map(rows.map((row) => [row.template_key as string, row.id as string]));
    };
    const aBoards = await incidentBoards(incidentA);
    const bBoards = await incidentBoards(incidentB);
    const rumorBoard = await attachedBoard(incidentA, "rumor_control");
    const talkingBoard = await attachedBoard(incidentA, "talking_points");
    const record = async (boardId: string, incidentId: string, data: Record<string, unknown>) => {
      const response = await app.inject({ method: "POST", headers,
        url: `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, payload: data });
      expect(response.statusCode, response.body).toBe(201);
    };
    await record(aBoards.get("significant_events")!, incidentA, {
      summary: "A-only verified road closure", occurred_at: "2026-09-21T11:00:00Z",
      severity: "critical", verified: true,
    });
    await record(bBoards.get("significant_events")!, incidentB, {
      summary: "B-only unrelated evacuation", occurred_at: "2026-09-21T11:30:00Z",
      severity: "critical", verified: true,
    });
    await record(rumorBoard, incidentA, {
      rumor: "A-only rumor", status: "false", response: "A-only confirmed response",
    });
    await record(talkingBoard, incidentA, {
      topic: "Road access", point: "Use the signed detour.", approved: true,
    });
    await admin`
      update board_templates
      set definition = jsonb_set(definition, '{fields,1,read}', '"admin"'::jsonb, true)
      where key = 'talking_points' and version = 1`;
    const esf = await app.inject({ method: "POST", headers,
      url: `/api/v1/incidents/${incidentA}/esf-assessments`, payload: {
        identity: { framework: "federal", esf: "esf_12_energy" },
        activation: "activated", capacity: "constrained",
        assessedAt: "2026-09-21T11:15:00Z", confidence: "confirmed",
        situation: "Fuel delivery is constrained.", relatedLifelines: ["energy"],
      } });
    expect(esf.statusCode, esf.body).toBe(201);

    const compose = () => app.inject({ method: "POST", headers,
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      payload: { period: "D26 OP", incidentId: incidentA } });
    const firstResponse = await compose();
    expect(firstResponse.statusCode, firstResponse.body).toBe(201);
    const first = firstResponse.json() as SitrepRow;
    expect(first).toMatchObject({ incidentId: incidentA, incidentName: "D26 briefing incident A",
      revision: 1 });
    expect(first.content.archiveReaderLevel).toBe("admin");
    expect(first.content.sourceTime).toBeTruthy();
    expect(first.content.significantEvents.map((line) => line.summary)).toEqual([
      "A-only verified road closure",
    ]);
    expect(JSON.stringify(first.content)).not.toContain("B-only unrelated evacuation");
    expect(first.content.esfs).toEqual([expect.objectContaining({
      framework: "federal", esf: "esf_12_energy", activation: "activated",
      capacity: "constrained", situation: "Fuel delivery is constrained.",
    })]);
    expect(first.content.talkingPoints).toEqual([
      expect.objectContaining({ topic: "Road access", point: "Use the signed detour." }),
    ]);
    expect(first.content.rumorControl).toEqual([
      expect.objectContaining({ rumor: "A-only rumor", response: "A-only confirmed response" }),
    ]);

    await record(aBoards.get("significant_events")!, incidentA, {
      summary: "Later A event", occurred_at: "2026-09-21T12:00:00Z",
      severity: "warning", verified: true,
    });
    const secondResponse = await compose();
    expect(secondResponse.statusCode, secondResponse.body).toBe(201);
    expect(secondResponse.json()).toMatchObject({ revision: 2 });
    const archived = await app.inject({ method: "GET", headers,
      url: `/api/v1/sitreps/${first.id}` });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().content).toEqual(first.content);
    const filtered = await app.inject({ method: "GET", headers,
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps?incidentId=${incidentA}` });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().sitreps).toHaveLength(2);
    expect(filtered.json().sitreps[0]).toMatchObject({
      incidentId: incidentA, incidentName: "D26 briefing incident A", revision: 2,
    });

    const memberCompose = await app.inject({ method: "POST",
      headers: { authorization: `Bearer ${memberToken}` },
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/sitreps`,
      payload: { period: "D26 member mask", incidentId: incidentA } });
    expect(memberCompose.statusCode, memberCompose.body).toBe(201);
    expect((memberCompose.json() as SitrepRow).content.archiveReaderLevel).toBe("member");
    expect((memberCompose.json() as SitrepRow).content.talkingPoints).toEqual([]);
    expect(JSON.stringify(memberCompose.json())).not.toContain("Use the signed detour.");
    const deniedAdminArchive = await app.inject({ method: "GET",
      headers: { authorization: `Bearer ${memberToken}` },
      url: `/api/v1/sitreps/${first.id}` });
    expect(deniedAdminArchive.statusCode).toBe(403);
    const memberArchive = await app.inject({ method: "GET",
      headers: { authorization: `Bearer ${memberToken}` },
      url: `/api/v1/sitreps/${(memberCompose.json() as SitrepRow).id}` });
    expect(memberArchive.statusCode, memberArchive.body).toBe(200);
    expect(JSON.stringify(memberArchive.json())).not.toContain("Use the signed detour.");
  });
});
