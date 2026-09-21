import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Joint Information Center (VEOC-33A, R4). A press release routes through a
 * multi-agency approval chain (a local agency plus a federation peer over a
 * peer token); an unapproved draft cannot publish; an approved release
 * publishes to the public feed and CAP; media inquiries tie their answer to
 * approved language; and rumor-control entries surface on the briefing view.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;

async function req(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

const capDraft = {
  sender: "jic@yuroktribe.example",
  status: "Actual",
  msgType: "Alert",
  scope: "Public",
  info: [
    {
      category: ["Safety"],
      event: "Public Information Statement",
      urgency: "Expected",
      severity: "Minor",
      certainty: "Observed",
      headline: "River levels stable",
    },
  ],
};

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

describe("press release approval and publication", () => {
  it("routes through two agencies (local + peer) and only then publishes", async () => {
    // Register a federation peer that stands for a second agency.
    const peer = (await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/peers`, { name: "state" })).json();
    const peerToken = peer.token as string;

    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Boil-water notice lifted",
        body: "The boil-water notice for the lower service area is lifted effective 6 PM.",
        requiredAgencies: ["yurok", "state"],
      })
    ).json();
    const releaseId = release.id as string;

    // Unapproved: publication is refused.
    const early = await req("POST", `/api/v1/jic/releases/${releaseId}/publish`, {});
    expect(early.statusCode).toBe(409);

    // Local agency approves; still pending on the peer.
    const local = await req("POST", `/api/v1/jic/releases/${releaseId}/decisions`, {
      agency: "yurok",
      decision: "approve",
    });
    expect(local.json().status).toBe("pending");
    const stillBlocked = await req("POST", `/api/v1/jic/releases/${releaseId}/publish`, {});
    expect(stillBlocked.statusCode).toBe(409);

    // The peer agency approves across the boundary with its token.
    const peerDecision = await app.inject({
      method: "POST",
      url: "/api/v1/jic/approvals/receive",
      headers: { "x-peer-token": peerToken },
      payload: { releaseId, decision: "approve" },
    });
    expect(peerDecision.statusCode).toBe(200);
    expect(peerDecision.json().status).toBe("approved");

    // Now it publishes to the public feed and to CAP.
    const publish = await req("POST", `/api/v1/jic/releases/${releaseId}/publish`, { capDraft });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().channels).toEqual(expect.arrayContaining(["public_feed", "cap"]));

    const feed = (await req("GET", `/api/v1/jurisdictions/${jurisdictionId}/jic/public`)).json();
    expect(feed.public.some((m: { title: string }) => m.title === "Boil-water notice lifted")).toBe(true);

    const [capRow] = await admin`
      select origin from cap_alerts where jurisdiction_id = ${jurisdictionId}`;
    expect(capRow!.origin).toBe("authored");

    // The immutable approval chain records both agencies.
    const chain = await admin`
      select agency, decision, decided_by_peer from press_release_approvals
      where release_id = ${releaseId} order by agency`;
    expect(chain.map((a) => a.agency)).toEqual(["state", "yurok"]);
    expect(chain.find((a) => a.agency === "state")!.decided_by_peer).toBe("state");
  });

  it("refuses a local writer impersonating a registered peer agency", async () => {
    await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/peers`, { name: "cal-oes" });
    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Evacuation lifted",
        body: "Residents may return.",
        requiredAgencies: ["yurok", "cal-oes"],
      })
    ).json();
    const spoof = await req("POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "cal-oes",
      decision: "approve",
    });
    expect(spoof.statusCode).toBe(403);
    expect(spoof.json().error).toBe("that agency must approve over its peer token");
  });

  it("refuses a second local decision from the same person on one release", async () => {
    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Road closed at the river",
        body: "Use the north detour.",
        requiredAgencies: ["fire", "sheriff"],
      })
    ).json();
    const first = await req("POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "fire",
      decision: "approve",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("pending");
    const second = await req("POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "sheriff",
      decision: "approve",
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("this person already recorded a decision on this release");
  });

  it("refuses a local writer inventing an agency to veto a pending release", async () => {
    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Shelter capacity update",
        body: "The community center still has 40 beds.",
        requiredAgencies: ["yurok", "state"],
      })
    ).json();
    await req("POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "yurok",
      decision: "approve",
    });
    const spoof = await req("POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "not-in-the-chain",
      decision: "reject",
    });
    expect(spoof.statusCode).toBe(403);
    expect(spoof.json().error).toBe("agency is not in this release's approval chain");
    const [row] = await admin`select status from press_releases where id = ${release.id}`;
    expect(row!.status).toBe("pending");
    const chain = await admin`
      select agency from press_release_approvals where release_id = ${release.id}`;
    expect(chain.map((a) => a.agency)).toEqual(["yurok"]);
  });

  it("refuses a registered peer that is not on the release approval chain", async () => {
    const extra = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/peers`, { name: "mutual-aid" })
    ).json();
    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Road reopened",
        body: "SR-96 is open to residents.",
        requiredAgencies: ["yurok"],
      })
    ).json();
    const veto = await app.inject({
      method: "POST",
      url: "/api/v1/jic/approvals/receive",
      headers: { "x-peer-token": extra.token as string },
      payload: { releaseId: release.id, decision: "reject" },
    });
    expect(veto.statusCode).toBe(403);
    expect(veto.json().error).toBe("this peer is not in the release approval chain");
    const [row] = await admin`select status from press_releases where id = ${release.id}`;
    expect(row!.status).toBe("draft");
  });

  it("refuses a peer decision on a release from another jurisdiction path with a bad token", async () => {
    const release = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Draft only",
        body: "x",
        requiredAgencies: ["yurok"],
      })
    ).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/jic/approvals/receive",
      headers: { "x-peer-token": "not-a-peer" },
      payload: { releaseId: release.id, decision: "approve" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("media inquiries tie answers to approved language", () => {
  it("answers with a published release and refuses an unapproved one", async () => {
    // A published release to cite.
    const approved = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Shelter open at the community center",
        body: "A shelter is open at the community center with capacity for 120.",
        requiredAgencies: ["yurok"],
      })
    ).json();
    await req("POST", `/api/v1/jic/releases/${approved.id}/decisions`, { agency: "yurok", decision: "approve" });
    await req("POST", `/api/v1/jic/releases/${approved.id}/publish`, {});

    // An inquiry, logged then answered with the approved language.
    const inquiry = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/inquiries`, {
        outlet: "North Coast Journal",
        subject: "Shelter status",
        question: "Is a shelter open tonight?",
      })
    ).json();
    const answered = await req("POST", `/api/v1/jic/inquiries/${inquiry.id}/answer`, {
      responseReleaseId: approved.id,
    });
    expect(answered.statusCode).toBe(200);

    // A fresh, unapproved draft cannot be cited as an answer.
    const draft = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
        title: "Unapproved",
        body: "y",
        requiredAgencies: ["yurok"],
      })
    ).json();
    const bad = await req("POST", `/api/v1/jic/inquiries/${inquiry.id}/answer`, {
      responseReleaseId: draft.id,
    });
    expect(bad.statusCode).toBe(409);
  });
});

describe("rumor control surfaces on the briefing view", () => {
  it("includes rumor-control board entries in a composed sitrep", async () => {
    const board = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: "rumor_control" })
    ).json();
    await req("POST", `/api/v1/boards/${board.id}/records`, {
      rumor: "The bridge has collapsed",
      status: "false",
      response: "The bridge is open and inspected.",
    });
    const sitrep = (
      await req("POST", `/api/v1/jurisdictions/${jurisdictionId}/sitreps`, { period: "OP-1" })
    ).json();
    expect(sitrep.content.rumorControl).toHaveLength(1);
    expect(sitrep.content.rumorControl[0].rumor).toBe("The bridge has collapsed");
    expect(sitrep.content.rumorControl[0].status).toBe("false");
  });
});
