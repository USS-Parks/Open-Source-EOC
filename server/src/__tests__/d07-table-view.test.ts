import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import type { SavedStateListPage, SavedStateRecord, SavedStateWrite } from "@openeoc/shared";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

interface TableApiClient {
  login(email: string, password: string): Promise<{ accessToken: string }>;
  listTableViewStates(incidentId: string, options?: { cursor?: string; limit?: number }): Promise<SavedStateListPage>;
  getTableViewState(incidentId: string, key: string): Promise<SavedStateRecord>;
  saveTableViewState(incidentId: string, key: string, input: SavedStateWrite): Promise<SavedStateRecord>;
  deleteTableViewState(incidentId: string, key: string, expectedRevision: number): Promise<void>;
}

type TableApiClientConstructor = new (options: {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
}) => TableApiClient;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let owner: TableApiClient;
let member: TableApiClient;
let firstIncidentId: string;
let secondIncidentId: string;

function appFetch(instance: FastifyInstance): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, "http://openeoc.test");
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : null;
    const response = await instance.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      url: `${url.pathname}${url.search}`,
      headers,
      ...(body === null ? {} : { payload: body }),
    });
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) for (const item of value) responseHeaders.append(key, item);
      else if (value !== undefined) responseHeaders.set(key, String(value));
    }
    return new Response(response.body, {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: responseHeaders,
    });
  };
}

async function activate(token: string, jurisdictionId: string, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: { authorization: `Bearer ${token}` },
    payload: { templateKey: "wildfire", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const fetchImpl = appFetch(app);
  const clientPath = "../../../web/src/app/api/" + "client.js";
  const clientModule = await import(clientPath) as { ApiClient: TableApiClientConstructor };
  owner = new clientModule.ApiClient({ baseUrl: "http://openeoc.test", fetchImpl });
  member = new clientModule.ApiClient({ baseUrl: "http://openeoc.test", fetchImpl });
  const ownerLogin = await owner.login("admin@example.org", "correct-horse-battery");
  await member.login("member@example.org", "another-good-password");
  firstIncidentId = await activate(ownerLogin.accessToken, seed.jurisdictionId, "D07 Table One");
  secondIncidentId = await activate(ownerLogin.accessToken, seed.jurisdictionId, "D07 Table Two");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("D07 table views through ApiClient and the real SEAM", () => {
  it("round-trips scoped table state, isolates people and incidents, and enforces CAS", async () => {
    const payload = {
      tableId: "priority-work",
      tableSchema: "priority-v1",
      label: "Night operations",
      view: {
        density: "compact",
        columnOrder: ["request", "owner", "status"],
        columnWidths: { request: 360, owner: 180, status: 140 },
        pinned: { request: "start" },
        sort: { columnId: "status", direction: "asc" },
        filters: { status: "Open" },
        pageSize: 25,
      },
    } as const;
    const created = await owner.saveTableViewState(firstIncidentId, "priority-work:night", {
      schemaVersion: 1,
      expectedRevision: 0,
      payload,
    });
    expect(created).toMatchObject({
      incidentId: firstIncidentId,
      kind: "table_view",
      key: "priority-work:night",
      revision: 1,
      payload,
    });

    const roundTrip = await owner.getTableViewState(firstIncidentId, "priority-work:night");
    expect(roundTrip.payload).toEqual(payload);
    const listed = await owner.listTableViewStates(firstIncidentId, { limit: 1 });
    expect(listed.states.map((state) => state.key)).toEqual(["priority-work:night"]);

    await expect(member.getTableViewState(firstIncidentId, "priority-work:night"))
      .rejects.toMatchObject({ status: 404 });
    await expect(owner.getTableViewState(secondIncidentId, "priority-work:night"))
      .rejects.toMatchObject({ status: 404 });

    const memberOwn = await member.saveTableViewState(firstIncidentId, "priority-work:night", {
      schemaVersion: 1,
      expectedRevision: 0,
      payload: { ...payload, label: "Member view" },
    });
    expect(memberOwn.revision).toBe(1);
    expect((await owner.getTableViewState(firstIncidentId, "priority-work:night")).payload.label)
      .toBe("Night operations");

    const updated = await owner.saveTableViewState(firstIncidentId, "priority-work:night", {
      schemaVersion: 1,
      expectedRevision: 1,
      payload: { ...payload, label: "Night operations updated" },
    });
    expect(updated.revision).toBe(2);
    await expect(owner.saveTableViewState(firstIncidentId, "priority-work:night", {
      schemaVersion: 1,
      expectedRevision: 1,
      payload: { ...payload, label: "Stale overwrite" },
    })).rejects.toMatchObject({ status: 409 });
    expect((await owner.getTableViewState(firstIncidentId, "priority-work:night")).payload.label)
      .toBe("Night operations updated");

    await expect(owner.deleteTableViewState(firstIncidentId, "priority-work:night", 1))
      .rejects.toMatchObject({ status: 409 });
    await owner.deleteTableViewState(firstIncidentId, "priority-work:night", 2);
    await expect(owner.getTableViewState(firstIncidentId, "priority-work:night"))
      .rejects.toMatchObject({ status: 404 });
  });
});
