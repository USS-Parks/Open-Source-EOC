import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { runDueFeeds } from "../feeds/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * No write path awaits the network inside a database transaction. Every
 * outbound call below is answered by a stand-in that, while it is awaited,
 * counts the backends of this test database holding a transaction open, and
 * that count must be zero for every call: the IPAWS send confirmation, a
 * resource request escalation, each collaboration backend call made by
 * activation, assignment, sync, announcement, a published release,
 * provisioning, archive and close, and a feed poll from the route and from
 * the scheduler.
 */

const IPAWS = "https://ipaws.invalid/IPAWS";
const PEER = "https://state.invalid";
const MATRIX = "https://matrix.invalid";
const FEEDS = "https://feeds.invalid";
const accepted = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "ipaws", "__fixtures__", "postcap-accepted.xml"),
  "utf8",
);
const gauges = JSON.stringify({
  type: "FeatureCollection",
  features: [{ type: "Feature", id: "g1", geometry: { type: "Point", coordinates: [-123.5, 41.2] }, properties: { name: "Gauge" } }],
});

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let memberId: string;
let adminToken: string;
let secondToken: string;
let priorKey: string | undefined;
let spy: { mockRestore(): void };

// The open-transaction count seen during each outbound call since the last reset.
let seen: number[] = [];
let ipawsDown = false;
let holdPeer: Promise<void> | null = null;
let peerReached: (() => void) | null = null;

/** Backends of this database, other than the one asking, idle inside an open transaction. */
async function openTransactions(): Promise<number> {
  const [row] = await admin`
    select count(*)::int as n from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'`;
  return row!.n as number;
}

function respond(url: string): Response {
  if (url.startsWith(IPAWS)) return new Response(accepted, { status: 200 });
  if (url.startsWith(PEER)) return new Response(JSON.stringify({ id: "remote" }), { status: 201 });
  if (url.startsWith(FEEDS)) return new Response(gauges, { status: 200 });
  // A Matrix homeserver whose rooms always exist and start empty.
  return new Response(JSON.stringify({ room_id: "!room:example.org", chunk: [] }), { status: 200 });
}

/** Expect at least one outbound call since the last reset, none with a transaction open. */
function expectOutside(): void {
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => 0));
}

async function outsideTransactions<T>(action: () => Promise<T>): Promise<T> {
  seen = [];
  const result = await action();
  expectOutside();
  return result;
}

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>, token = adminToken) =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-write-path-key";
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  memberId = seed.memberId;
  const secondId = await createPerson(admin, {
    email: "second-admin@example.org", displayName: "Second Admin", password: "second-admin-password",
  });
  await addMembership(admin, secondId, jurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null, integrations: ["collab"] });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  secondToken = await tokenFor(app, "second-admin@example.org", "second-admin-password");
  spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    seen.push(await openTransactions());
    if (url.startsWith(IPAWS) && ipawsDown) throw new TypeError("fetch failed");
    if (url.startsWith(PEER) && holdPeer) {
      const held = holdPeer;
      holdPeer = null;
      peerReached?.();
      await held;
    }
    return respond(url);
  });
}, 60_000);

afterAll(async () => {
  spy?.mockRestore();
  await app?.close();
  await runtime?.end();
  await admin?.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("the IPAWS send confirmation", () => {
  async function requestHandshake(identifier: string): Promise<string> {
    const [alert] = await admin`
      insert into cap_alerts (jurisdiction_id, identifier, origin, status, msg_type, scope, ipaws_eligible, alert, xml, created_by)
      select ${jurisdictionId}, ${identifier}, 'authored', 'Actual', 'Alert', 'Public', true, '{}'::jsonb,
        '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"/>', id
      from persons where email = 'admin@example.org' returning id`;
    const requested = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/ipaws/test`, { alertId: alert!.id as string });
    expect(requested.statusCode, requested.body).toBe(202);
    return requested.json().id as string;
  }

  beforeAll(async () => {
    const configured = await call("PUT", `/api/v1/jurisdictions/${jurisdictionId}/ipaws/config`, {
      environment: "test", cogId: "123456", endpointUrl: IPAWS, credential: "pin-secret",
    });
    expect(configured.statusCode, configured.body).toBe(200);
  });

  it("claims the request, posts with no transaction open, then records the submission", async () => {
    const sendId = await requestHandshake("GATE-4-1");
    const confirmed = await outsideTransactions(() =>
      call("POST", `/api/v1/jurisdictions/${jurisdictionId}/ipaws/sends/${sendId}/confirm`, undefined, secondToken));
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ accepted: true, request: { status: "confirmed" } });
    expect(confirmed.json().request.submissionId).toBe(confirmed.json().submissionId);
  });

  it("records a send the endpoint never answers as not accepted, and never sends it again", async () => {
    const sendId = await requestHandshake("GATE-4-2");
    ipawsDown = true;
    try {
      const confirmed = await outsideTransactions(() =>
        call("POST", `/api/v1/jurisdictions/${jurisdictionId}/ipaws/sends/${sendId}/confirm`, undefined, secondToken));
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect(confirmed.json()).toMatchObject({ accepted: false, request: { status: "confirmed" } });
      expect(confirmed.json().detail).toContain("did not answer");
    } finally {
      ipawsDown = false;
    }
    seen = [];
    const again = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/ipaws/sends/${sendId}/confirm`, undefined, secondToken);
    expect(again.statusCode).toBe(409);
    expect(seen).toEqual([]);
  });
});

describe("a resource request escalation", () => {
  async function submitted(item: string): Promise<string> {
    const res = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, { origin: "field", item });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }
  const escalate = (id: string) =>
    call("POST", `/api/v1/resource-requests/${id}/escalate`, { peerName: "state", peerBaseUrl: PEER, peerToken: "peer-token" });
  const escalations = async (id: string) => (await admin`
    select count(*)::int as n from rr_events where request_id = ${id} and note = 'escalated to state'`)[0]!.n as number;

  it("delivers with no transaction open and records the escalation after", async () => {
    const id = await submitted("Swiftwater Rescue Team");
    const res = await outsideTransactions(() => escalate(id));
    expect(res.statusCode, res.body).toBe(200);
    expect(await escalations(id)).toBe(1);
    const [audit] = await admin`select count(*)::int as n from audit_events where category = 'rr.escalated' and subject_id = ${id}`;
    expect(audit!.n).toBe(1);
  });

  it("refuses a second escalation of the same request while the first is being delivered", async () => {
    const id = await submitted("Water Tender");
    let release!: () => void;
    holdPeer = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { peerReached = resolve; });
    const first = escalate(id);
    await reached;
    const second = await escalate(id);
    release();
    expect(second.statusCode, second.body).toBe(409);
    expect((await first).statusCode).toBe(200);
    expect(await escalations(id)).toBe(1);
    // The claim is released once the escalation is recorded.
    expect((await escalate(id)).statusCode).toBe(200);
  });
});

describe("collaboration backend calls", () => {
  let incidentId: string;

  beforeAll(async () => {
    const backend = await call("PUT", `/api/v1/jurisdictions/${jurisdictionId}/collab/backend`, {
      kind: "matrix", baseUrl: MATRIX, token: "bot-token", homeserver: "example.org", enabled: true,
    });
    expect(backend.statusCode, backend.body).toBe(200);
  });

  async function activate(name: string): Promise<string> {
    const res = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, { templateKey: "wildfire", name });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().incidentId as string;
  }

  it("activation provisions the space after the activation commits", async () => {
    seen = [];
    incidentId = await activate("Gate Four Flood");
    expectOutside();
    const [space] = await admin`select status from collab_spaces where incident_id = ${incidentId}`;
    expect(space!.status).toBe("active");
  });

  it("a position assignment re-syncs membership", async () => {
    const detail = (await call("GET", `/api/v1/incidents/${incidentId}`)).json();
    const commander = (detail.positions as Array<{ key: string; id: string }>).find((p) => p.key === "incident_commander")!;
    const res = await outsideTransactions(() => call("POST", `/api/v1/positions/${commander.id}/assignments`, { personId: memberId }));
    expect(res.statusCode, res.body).toBe(201);
  });

  it("provisioning, sync and an announcement", async () => {
    for (const [path, payload] of [["provision"], ["sync"], ["announce", { text: "Levee overtopping reported" }]] as const) {
      const res = await outsideTransactions(() => call("POST", `/api/v1/incidents/${incidentId}/collab/${path}`, payload));
      expect(res.statusCode, `${path}: ${res.body}`).toBe(200);
      expect(res.json().degraded, path).toBe(false);
    }
  });

  it("a published release announces in the incident's channels", async () => {
    const draft = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
      title: "Evacuation order", body: "Leave the river corridor now.", requiredAgencies: ["yurok"], incidentId,
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const releaseId = draft.json().id as string;
    expect((await call("POST", `/api/v1/jic/releases/${releaseId}/decisions`, { agency: "yurok", decision: "approve" })).statusCode).toBe(200);
    const published = await outsideTransactions(() => call("POST", `/api/v1/jic/releases/${releaseId}/publish`, { toCollab: true }));
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().channels).toContain("collab");
    const [row] = await admin`select count(*)::int as n from press_release_publications where release_id = ${releaseId} and channel = 'collab'`;
    expect(row!.n).toBe(1);
  });

  it("archiving, directly and when an incident closes", async () => {
    const archived = await outsideTransactions(() => call("POST", `/api/v1/incidents/${incidentId}/collab/archive`));
    expect(archived.json()).toEqual({ archived: true });
    const closing = await activate("Gate Four Fire");
    const closed = await outsideTransactions(() => call("POST", `/api/v1/incidents/${closing}/close`));
    expect(closed.statusCode, closed.body).toBe(200);
    const [space] = await admin`select status from collab_spaces where incident_id = ${closing}`;
    expect(space!.status).toBe("archived");
  });
});

describe("a feed poll", () => {
  async function feed(name: string): Promise<string> {
    const res = await call("POST", `/api/v1/jurisdictions/${jurisdictionId}/feeds`, {
      name, kind: "geojson", url: `${FEEDS}/${encodeURIComponent(name)}`, pollIntervalSeconds: 60,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  it("from the route", async () => {
    const id = await feed("River gauges");
    const res = await outsideTransactions(() => call("POST", `/api/v1/feeds/${id}/poll`));
    expect(res.json()).toEqual({ ok: true, items: 1 });
  });

  it("from the scheduler", async () => {
    await feed("Scheduled gauges");
    const ran = await outsideTransactions(() => runDueFeeds(runtime));
    expect(ran).toBeGreaterThanOrEqual(1);
  });
});
