import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { escalate, type EscalationPayload } from "../resource/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The 213RR resource lifecycle (VEOC-35, F5). A request moves through the
 * guarded NIMS states with a full chronology and per-change notifications; a
 * request escalates field-to-state over a peer token and the upper tier
 * reports fulfillment back; and costs export for reimbursement.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  jurisdictionId: string;
  adminId: string;
  adminToken: string;
  principal: Principal;
}

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.ready();
  const adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  const principal = await principalForPerson(runtime, seed.adminId);
  return {
    admin,
    runtime,
    app,
    jurisdictionId: seed.jurisdictionId,
    adminId: seed.adminId,
    adminToken,
    principal,
  };
}

let county: Instance;
let state: Instance;

function post(inst: Instance, url: string, payload?: Record<string, unknown>) {
  return inst.app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${inst.adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}
function get(inst: Instance, url: string) {
  return inst.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${inst.adminToken}` } });
}
async function registerPeer(inst: Instance, name: string): Promise<string> {
  const res = await post(inst, `/api/v1/jurisdictions/${inst.jurisdictionId}/peers`, { name });
  return res.json().token as string;
}

beforeAll(async () => {
  county = await standUp();
  state = await standUp();
}, 60000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

describe("single-instance lifecycle", () => {
  it("walks the ordering cycle, rejects skips, and logs the chronology", async () => {
    const submit = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
      origin: "eoc",
      item: "Type 3 Engine",
      quantity: 2,
      priority: "priority",
    });
    expect(submit.statusCode).toBe(201);
    const id = submit.json().id as string;

    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "triaged" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "sourcing" });

    // A skip is refused by the state machine.
    const skip = await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "closed" });
    expect(skip.statusCode).toBe(409);

    const position = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/positions`, {
        key: "logistics_section_chief",
        title: "Logistics Section Chief",
      })
    ).json().id as string;
    const assigned = await post(county, `/api/v1/resource-requests/${id}/assign`, { positionId: position });
    expect(assigned.json().state).toBe("assigned");

    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "deployed" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "demobilizing" });
    await post(county, `/api/v1/resource-requests/${id}/transition`, { toState: "closed" });

    const detail = (await get(county, `/api/v1/resource-requests/${id}`)).json();
    expect(detail.state).toBe("closed");
    expect(detail.chronology.map((e: { toState: string }) => e.toState)).toEqual([
      "submitted",
      "triaged",
      "sourcing",
      "assigned",
      "deployed",
      "demobilizing",
      "closed",
    ]);

    // Every state change left a notification.
    const notes = await county.admin`
      select count(*)::int as n from notifications where channel = 'resource'`;
    expect(notes[0]!.n).toBeGreaterThanOrEqual(7);
  });
});

describe("cross-tier escalation, field to state and back", () => {
  it("escalates over a peer token and the upper tier reports fulfillment back", async () => {
    // state registers county so county can push up; county registers state so
    // state can report back down.
    const tokenIntoState = await registerPeer(state, "county");
    const tokenIntoCounty = await registerPeer(county, "state");

    // County submits and works it to sourcing, then cannot fill locally.
    const countyReqId = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
        origin: "field",
        item: "Swiftwater Rescue Team",
        quantity: 1,
        priority: "immediate",
      })
    ).json().id as string;
    await post(county, `/api/v1/resource-requests/${countyReqId}/transition`, { toState: "triaged" });
    await post(county, `/api/v1/resource-requests/${countyReqId}/transition`, { toState: "sourcing" });

    // Escalate up to the state tier (delivery injected into the state app).
    let stateReqId = "";
    const deliver = async (payload: EscalationPayload): Promise<void> => {
      const res = await state.app.inject({
        method: "POST",
        url: "/api/v1/resource-requests/receive",
        headers: { "x-peer-token": tokenIntoState },
        payload,
      });
      expect(res.statusCode).toBe(201);
      stateReqId = res.json().id as string;
    };
    await withPerson(county.runtime, county.adminId, (tx) =>
      escalate(tx, county.principal, countyReqId, "state", deliver),
    );
    expect(stateReqId).not.toBe("");

    // The state tier works the escalated request.
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "triaged" });
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "sourcing" });
    const statePosition = (
      await post(state, `/api/v1/jurisdictions/${state.jurisdictionId}/positions`, {
        key: "operations_section_chief",
        title: "Operations Section Chief",
      })
    ).json().id as string;
    await post(state, `/api/v1/resource-requests/${stateReqId}/assign`, { positionId: statePosition });
    await post(state, `/api/v1/resource-requests/${stateReqId}/transition`, { toState: "deployed" });

    // State reports fulfillment back down to the county's originating request.
    for (const toState of ["assigned", "deployed"]) {
      // The state tier delivers its report down to the county's app, using
      // the token county issued it.
      const res = await county.app.inject({
        method: "POST",
        url: "/api/v1/resource-requests/report",
        headers: { "x-peer-token": tokenIntoCounty },
        payload: { sourceRequestId: countyReqId, toState, note: "state task force en route" },
      });
      expect(res.statusCode).toBe(200);
    }

    // The county request has advanced and its chronology tells the whole story.
    const countyDetail = (await get(county, `/api/v1/resource-requests/${countyReqId}`)).json();
    expect(countyDetail.state).toBe("deployed");
    const notes = countyDetail.chronology.map((e: { note: string | null }) => e.note ?? "");
    expect(notes.some((n: string) => n.includes("escalated to state"))).toBe(true);
    expect(notes.some((n: string) => n.includes("state reported deployed"))).toBe(true);

    // The state-side request records where it came from.
    const [stateRow] = await state.admin`
      select source_peer, source_request_id from resource_requests where id = ${stateReqId}`;
    expect(stateRow!.source_peer).toBe("county");
    expect(stateRow!.source_request_id).toBe(countyReqId);
  });
});

describe("cost export for reimbursement", () => {
  it("exports a CSV with a total", async () => {
    const id = (
      await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/resource-requests`, {
        origin: "eoc",
        item: "Generator, 100kW",
      })
    ).json().id as string;
    await post(county, `/api/v1/resource-requests/${id}/costs`, {
      category: "equipment",
      description: "72 hours",
      amountCents: 540000,
      incurredAt: "2026-09-18",
    });
    await post(county, `/api/v1/resource-requests/${id}/costs`, {
      category: "fuel",
      amountCents: 96050,
      incurredAt: "2026-09-18",
    });
    const res = await get(county, `/api/v1/resource-requests/${id}/costs/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("Amount (USD)");
    expect(res.body).toContain("5400.00");
    expect(res.body).toContain("TOTAL,6360.50");
  });
});
