import { describe, expect, it, vi } from "vitest";
import { ApiClient, SessionExpiredError } from "../api/client.js";

/**
 * The API client's contract: it presents the bearer token, renews it once
 * against a 401 and retries transparently, gives up cleanly when the
 * renewal also fails, and surfaces the server's {error} envelope as a
 * typed ApiError. A fetch stub stands in for the network.
 */

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  };
}

const me = {
  person: { id: "p", email: "e@x.org", displayName: "Duty" },
  position: null,
  memberships: [],
  sessionId: "S",
};

describe("ApiClient", () => {
  it("keeps saved dashboard scope, typed filters, paging and revision preconditions in requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, {}));
    const client = new ApiClient({ fetchImpl });
    await client.dashboardConfigData("incident/a", "saved view", { scope: "saved", filterMode: "replace",
      runtimeFilter: { field: "active", equals: false }, filters: { category: { field: "priority", equals: 2 },
        operationalPeriod: { field: "period", areaRevision: 3 } }, bbox: [-124, 39, -122, 41] });
    const request = new URL(String(fetchImpl.mock.calls[0]?.[0]), "http://local");
    expect(request.pathname).toBe("/api/v1/incidents/incident%2Fa/dashboard-configs/saved%20view/data");
    expect(Object.fromEntries(request.searchParams)).toMatchObject({ scope: "saved", filterMode: "replace",
      field: "active", equals: "false", categoryField: "priority", category: "2", periodRevision: "3", bbox: "-124,39,-122,41" });
    await client.dashboardContributions("dashboard", "roads", { incidentId: "incident/a", group: "", cursor: "next", limit: 20 });
    const records = new URL(String(fetchImpl.mock.calls[1]?.[0]), "http://local");
    expect(Object.fromEntries(records.searchParams)).toEqual({ incidentId: "incident/a", group: "", cursor: "next", limit: "20" });
    await client.deleteDashboardConfig("incident/a", "saved view", 4);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain("expectedRevision=4");
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("passes explicit incident scope to the existing board view endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { view: "all", columns: [], records: [] }));
    const client = new ApiClient({ fetchImpl });
    client.setTokens({ accessToken: "A", resumeToken: "R" });
    await client.boardView("board-a", "all", "incident-a");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/v1/boards/board-a/views/all?incidentId=incident-a");
    await client.boardView("board-a", "all", undefined, { cursor: "next-page", limit: 50 });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("/api/v1/boards/board-a/views/all?cursor=next-page&limit=50");
    await client.notificationPage({ cursor: "older" });
    expect(fetchImpl.mock.calls[2]?.[0]).toBe("/api/v1/notifications?cursor=older");
  });

  it("uses the versioned board authoring routes without a parallel configuration API", async () => {
    const calls: Call[] = [];
    const definition: Parameters<ApiClient["publishTemplate"]>[0] = {
      key: "ops", version: 2, title: "Operations", description: "",
      fields: [{ key: "summary", label: "Summary", type: "text", required: true, read: "any", write: "member" }],
      views: [{ key: "all", title: "All", kind: "list", columns: ["summary"], filter: [] }],
    };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = String(url);
      if (path.endsWith("/versions")) return res(200, { versions: [{ key: "ops", version: 1, title: "Operations" }] });
      if (path.endsWith("/versions/1")) return res(200, { ...definition, version: 1 });
      if (path === "/api/v1/templates") return res(201, { key: "ops", version: 2 });
      if (path.endsWith("/boards") && init.method === "POST") return res(201, { id: "board-2" });
      if (path.endsWith("/upgrade")) return res(200, { dropped: [] });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    client.setTokens({ accessToken: "A", resumeToken: "R" });

    expect(await client.listTemplateVersions("ops")).toHaveLength(1);
    expect((await client.getTemplateVersion("ops", 1)).version).toBe(1);
    await client.publishTemplate(definition);
    await client.createBoard("jurisdiction-a", { templateKey: "ops", version: 2, title: "Operations" });
    await client.upgradeBoard("board-a", 2);

    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/templates/ops/versions",
      "/api/v1/templates/ops/versions/1",
      "/api/v1/templates",
      "/api/v1/jurisdictions/jurisdiction-a/boards",
      "/api/v1/boards/board-a/upgrade",
    ]);
    expect(JSON.parse(String(calls[2]!.init.body))).toMatchObject({ key: "ops", version: 2 });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ templateKey: "ops", version: 2, title: "Operations" });
    expect(JSON.parse(String(calls[4]!.init.body))).toEqual({ toVersion: 2 });
  });
  it("keeps workspace CAS scope through renewal and surfaces position denial", async () => {
    const calls: Call[] = [];
    let saves = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/resume")) return res(200, { accessToken: "A2", resumeToken: "R2", sessionId: "S" });
      if (String(url).endsWith("/sign-in")) return res(403, { error: "not assigned to this position" });
      if (init.method === "PUT") {
        saves += 1;
        return saves === 1 ? res(401, { error: "expired" }) : res(409, { error: "state revision changed" });
      }
      return res(200, { states: [], nextCursor: null });
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    client.setTokens({ accessToken: "A", resumeToken: "R" });
    await expect(client.saveWorkspaceState("incident-a", "workspace_layout", "map", {
      expectedRevision: 4, schemaVersion: 1, payload: { drawerWidth: 340 },
    })).rejects.toMatchObject({ status: 409 });
    const puts = calls.filter((call) => call.init.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.url).toBe("/api/v1/incidents/incident-a/saved-state/workspace_layout/map");
    expect(puts[1]!.init.body).toBe(puts[0]!.init.body);
    await expect(client.signInPosition("unassigned")).rejects.toMatchObject({ status: 403 });
  });
  it("retains a task operation identity through authenticated session renewal", async () => {
    const calls: Call[] = [];
    let completions = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/login")) return res(200, { accessToken: "A1", resumeToken: "R", sessionId: "S" });
      if (String(url).endsWith("/auth/resume")) return res(200, { accessToken: "A2", resumeToken: "R2", sessionId: "S" });
      if (String(url).endsWith("/complete")) {
        completions += 1;
        return completions === 1 ? res(401, { error: "expired" }) : res(200, { operationId: "operation-one" });
      }
      return res(404, { error: "not found" });
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.completeIncidentTask("incident", "task", "operation-one")).operationId).toBe("operation-one");
    const attempts = calls.filter((call) => call.url.endsWith("/complete"));
    expect(attempts).toHaveLength(2);
    expect(attempts.map((call) => JSON.parse(String(call.init.body)))).toEqual([
      { operationId: "operation-one" }, { operationId: "operation-one" },
    ]);
    expect((attempts[1]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer A2");
  });

  it("sends the bearer token on authenticated calls", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      return res(200, me);
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    await client.me();

    const meCall = calls.find((c) => c.url.endsWith("/api/v1/me"));
    expect(meCall).toBeDefined();
    const headers = meCall!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer A");
  });

  it("renews the access token once on 401, then retries the call", async () => {
    let meHits = 0;
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login")) return res(200, { accessToken: "A1", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/auth/resume")) return res(200, { accessToken: "A2", resumeToken: "R2", sessionId: "S" });
      if (u.endsWith("/api/v1/me")) {
        meHits += 1;
        return meHits === 1 ? res(401, { error: "session expired" }) : res(200, me);
      }
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    const result = await client.me();
    expect(result.person.id).toBe("p");
    expect(meHits).toBe(2);
  });

  it("clears the session when the renewal also fails", async () => {
    const tokenEvents: unknown[] = [];
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login")) return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/auth/resume")) return res(401, { error: "invalid resume token" });
      return res(401, { error: "session expired" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl, onTokens: (t) => tokenEvents.push(t) });
    await client.login("e@x.org", "pw");
    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(tokenEvents[tokenEvents.length - 1]).toBeNull();
  });

  it("downloads an IAP PDF as a blob carrying the bearer token", async () => {
    const calls: Call[] = [];
    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/pdf")) {
        calls.push({ url: u, init });
        return { ok: true, status: 200, statusText: "OK", blob: async () => pdf };
      }
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    const blob = await client.downloadIapPdf("iap1");
    expect(blob.type).toBe("application/pdf");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer A");
  });

  it("lists IAPs and advances the workflow", async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url).split("?")[0]!;
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/iaps"))
        return res(200, {
          iaps: [
            {
              id: "iap1",
              operationalPeriod: "OP 1",
              status: "in_progress",
              formCount: 7,
              targetForms: 7,
              preparedBy: "Admin",
              approvedBy: null,
              approvedAt: null,
              createdAt: "2026-09-20T00:00:00Z",
            },
          ],
        });
      if (u.endsWith("/submit") || u.endsWith("/approve") || u.endsWith("/complete"))
        return res(200, { ok: true });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    const iaps = await client.listIaps("i1");
    expect(iaps[0]!.status).toBe("in_progress");
    expect(iaps[0]!.targetForms).toBe(7);
    expect((await client.submitIap("iap1")).ok).toBe(true);
    expect((await client.approveIap("iap1")).ok).toBe(true);
    expect((await client.completeIap("iap1")).ok).toBe(true);
  });

  it("uploads a file as multipart, searches, and downloads content", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });
    let sent: RequestInit | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/files") && init.method === "POST") {
        sent = init;
        return res(201, { id: "f1", sha256: "abc", version: 1 });
      }
      if (u.includes("/search?q="))
        return res(200, { hits: [{ kind: "file", id: "f1", title: "plan.pdf" }] });
      if (u.endsWith("/files/f1/content"))
        return { ok: true, status: 200, statusText: "OK", blob: async () => blob };
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    const up = await client.uploadFile("j", {
      name: "plan.pdf",
      contentType: "application/pdf",
      file: blob,
    });
    expect(up.id).toBe("f1");
    const form = sent!.body as FormData;
    expect([...form.keys()]).toEqual(["name", "file"]);
    expect(form.get("name")).toBe("plan.pdf");
    expect((form.get("file") as File).type).toBe("application/pdf");
    // The browser writes the multipart content type with its boundary.
    expect((sent!.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const hits = await client.searchJurisdiction("j", "plan");
    expect(hits[0]!.kind).toBe("file");
    const dl = await client.downloadFile("f1");
    expect(dl.type).toBe("application/octet-stream");
  });

  it("lists incident templates, activates, and closes an incident", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/incident-templates"))
        return res(200, { templates: [{ key: "wildfire", title: "Wildfire" }] });
      if (u.endsWith("/incidents") && init.method === "POST") return res(201, { incidentId: "i1" });
      if (u.endsWith("/close")) return res(200, { ok: true });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.listIncidentTemplates())[0]!.key).toBe("wildfire");
    expect((await client.activateIncident("j", { templateKey: "wildfire", name: "Fire" })).incidentId).toBe("i1");
    expect((await client.closeIncident("i1")).ok).toBe(true);
  });

  it("submits, lists, and advances a resource request", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url).split("?")[0]!;
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/resource-requests") && init.method === "POST") return res(201, { id: "r1" });
      if (u.endsWith("/resource-requests"))
        return res(200, {
          requests: [{ id: "r1", item: "Cots", quantity: 50, priority: "routine", state: "submitted" }],
        });
      if (u.endsWith("/transition")) return res(200, { state: "triaged" });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.submitResourceRequest("j", { origin: "eoc", item: "Cots", quantity: 50 })).id).toBe("r1");
    expect((await client.listResourceRequests("j"))[0]!.state).toBe("submitted");
    expect((await client.transitionResourceRequest("r1", "triaged")).state).toBe("triaged");
  });

  it("reads a picker list to its last page by cursor", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      asked.push(u.split("?")[1] ?? "");
      return u.includes("cursor=c1")
        ? res(200, { requests: [{ id: "r2", item: "Tarps" }], nextCursor: null })
        : res(200, { requests: [{ id: "r1", item: "Cots" }], nextCursor: "c1" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.listResourceRequests("j", "i1")).map((request) => request.id)).toEqual(["r1", "r2"]);
    expect(asked).toEqual(["incidentId=i1&limit=500", "incidentId=i1&cursor=c1&limit=500"]);
  });

  it("records observations, composes an AAR, and downloads its PDF", async () => {
    const pdf = new Blob([new Uint8Array([0x25, 0x50])], { type: "application/pdf" });
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/aar/observations") && init.method === "POST") return res(201, { ok: true });
      if (u.endsWith("/aar/observations"))
        return res(200, {
          observations: [
            { capability: "mass_care_services", capabilityElement: "none", kind: "strength", observation: "Fast", recommendation: null },
          ],
        });
      if (u.endsWith("/aar") && init.method === "POST") return res(201, { id: "a1" });
      if (u.endsWith("/aar/a1/pdf")) return { ok: true, status: 200, statusText: "OK", blob: async () => pdf };
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    await client.recordAarObservation("i1", { capability: "Mass Care", kind: "strength", observation: "Fast" });
    expect((await client.listAarObservations("i1"))[0]!.capability).toBe("mass_care_services");
    const { id } = await client.composeAar("i1", { overview: "Solid response." });
    expect(id).toBe("a1");
    expect((await client.downloadAarPdf(id)).type).toBe("application/pdf");
  });

  it("creates and polls a feed", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/feeds") && init.method === "POST")
        return res(201, { id: "fd1", ingestToken: "tok-123" });
      if (u.endsWith("/poll")) return res(200, { ok: true, items: 2 });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    const created = await client.createFeed("j", { name: "NWS", kind: "cap", url: "https://x/cap", push: false });
    expect(created.id).toBe("fd1");
    expect(created.ingestToken).toBe("tok-123");
    expect((await client.pollFeed("fd1")).items).toBe(2);
  });

  it("creates, lists, and updates a corrective action", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/corrective-actions") && init.method === "POST") return res(201, { id: "c1" });
      if (u.includes("/corrective-actions?"))
        return res(200, {
          correctiveActions: [
            { id: "c1", capability: "operational_communications", capabilityElement: "equipment", recommendation: "Repeater", owner: null, dueDate: null, status: "open", incidentId: null },
          ],
        });
      if (u.endsWith("/status")) return res(200, { ok: true });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.createCorrectiveAction("j", { capability: "Comms", recommendation: "Repeater" })).id).toBe("c1");
    expect((await client.listCorrectiveActions("j"))[0]!.status).toBe("open");
    expect((await client.setCorrectiveActionStatus("c1", "complete")).ok).toBe(true);
  });

  it("lists positions, creates a thread, posts and reads messages", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/positions"))
        return res(200, { positions: [{ id: "p1", key: "ops", title: "Operations Section Chief" }] });
      if (u.endsWith("/threads") && init.method === "POST") return res(201, { id: "t1" });
      if (u.endsWith("/threads")) return res(200, { threads: [{ id: "t1", kind: "group", title: "Ops", incidentId: null }] });
      if (u.includes("/messages") && init.method === "POST") return res(201, { id: "m1", deduplicated: false });
      if (u.includes("/messages"))
        return res(200, { messages: [{ id: "m1", seq: 1, sender: "Duty", body: "Hi", at: "2026-09-20T00:00:00Z" }] });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.listPositions("j"))[0]!.title).toBe("Operations Section Chief");
    expect((await client.createThread("j", { kind: "group", members: [{ kind: "position", id: "p1" }] })).id).toBe("t1");
    expect((await client.postMessage("t1", "Hi")).id).toBe("m1");
    expect((await client.listMessages("t1"))[0]!.body).toBe("Hi");
  });

  it("lists smart forms, loads a definition, and submits", async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/submit")) return res(201, { recordId: "rec1" });
      if (u.endsWith("/forms/rn")) return res(200, { key: "rn", version: 1, title: "Rapid Needs", nodes: [] });
      if (u.endsWith("/forms")) return res(200, { forms: [{ key: "rn", version: 1, title: "Rapid Needs" }] });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.listForms("j"))[0]!.key).toBe("rn");
    expect((await client.getForm("j", "rn")).title).toBe("Rapid Needs");
    expect(
      (await client.submitForm("rn", { jurisdictionId: "j", boardId: "b", answers: { summary: "x" } })).recordId,
    ).toBe("rec1");
  });

  it("registers, scans, and reunifies a tracked object", async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login"))
        return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      if (u.endsWith("/scan")) return res(201, { eventId: "e1" });
      if (u.endsWith("/tracked-objects")) return res(201, { id: "o1", tag: "T-1" });
      if (u.includes("/reunification"))
        return res(200, {
          answers: [
            {
              tag: "T-1",
              kind: "patient",
              label: "Jane",
              latest: { custodyState: "registered", station: null, location: null, occurredAt: "2026-09-20T00:00:00Z" },
            },
          ],
        });
      return res(404, { error: "nope" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    expect((await client.registerTrackedObject("j", { kind: "patient", label: "Jane" })).tag).toBe("T-1");
    expect((await client.scanTrackedObject("j", { tag: "T-1", custodyState: "in_transit" })).eventId).toBe("e1");
    expect((await client.reunify("j", { label: "Jane" }))[0]!.label).toBe("Jane");
  });

  it("loads operational Lifelines from the selected incident", async () => {
    const urls: string[] = [];
    const client = new ApiClient({ fetchImpl: (async (url: string) => {
      urls.push(String(url));
      return res(200, { definition: {}, doctrineGaps: [], states: [] });
    }) as unknown as typeof fetch });
    expect((await client.listIncidentLifelineAssessments("incident/a")).states).toEqual([]);
    expect(urls).toEqual(["/api/v1/incidents/incident%2Fa/lifeline-assessments"]);
  });

  it("sends administration changes to their routes and walks the CSV export by its header cursor", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).includes("format=csv")) {
        return { ...res(200, null), text: async () => "seq,at\r\n1,now\r\n", headers: new Headers({ "x-next-cursor": "c2" }) };
      }
      if (String(url).startsWith("/api/v1/persons")) return res(200, { person: { id: "p/1", displayName: "Guest", email: "g@x.org" } });
      return res(200, { ok: true });
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    expect((await client.findPersonByEmail("g+1@x.org")).id).toBe("p/1");
    await client.listMembers("j/1", { cursor: "next", limit: 50 });
    await client.setMemberRole("j/1", "p/1", "viewer");
    await client.setMemberDisabled("j/1", "p/1", true);
    await client.resetMemberMfa("j/1", "p/1", "lost phone");
    await client.removeMember("j/1", "p/1");
    await client.revokePositionAssignment("pos/1", "p/1");
    const page = await client.auditExportCsvPage("j/1", "c1");
    expect(page).toEqual({ csv: "seq,at\r\n1,now\r\n", nextCursor: "c2" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/persons?email=g%2B1%40x.org",
      "GET /api/v1/jurisdictions/j%2F1/members?cursor=next&limit=50",
      "PUT /api/v1/jurisdictions/j%2F1/members/p%2F1",
      "PUT /api/v1/jurisdictions/j%2F1/members/p%2F1/disabled",
      "POST /api/v1/jurisdictions/j%2F1/members/p%2F1/mfa-reset",
      "DELETE /api/v1/jurisdictions/j%2F1/members/p%2F1",
      "DELETE /api/v1/positions/pos%2F1/assignments/p%2F1",
      "GET /api/v1/jurisdictions/j%2F1/audit/export?format=csv&limit=500&cursor=c1",
    ]);
    expect(calls.slice(2, 5).map((c) => c.body)).toEqual([{ role: "viewer" }, { disabled: true }, { reason: "lost phone" }]);
  });

  it("surfaces the server error envelope as a typed ApiError", async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/login")) return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
      return res(403, { error: "no access to this jurisdiction" });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ fetchImpl });
    await client.login("e@x.org", "pw");
    await expect(client.listBoards("j")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "no access to this jurisdiction",
    });
  });
});

describe("audit chronology client", () => {
  const reply = (body: string, headers: Record<string, string> = {}) => ({
    ok: true, status: 200, statusText: "OK", headers: new Headers(headers),
    text: async () => body, json: async () => JSON.parse(body),
  });

  it("sends the chronology filters and page, and posts a correction note", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { entries: [], nextCursor: null }));
    const client = new ApiClient({ fetchImpl });
    await client.listChronology("j/1", { incidentId: "i1", categories: ["incident.activated", "correction"],
      from: "2026-09-23T00:00:00.000Z" }, { cursor: "next", limit: 50 });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]), "http://local");
    expect(url.pathname).toBe("/api/v1/jurisdictions/j%2F1/chronology");
    expect(Object.fromEntries(url.searchParams)).toEqual({ cursor: "next", limit: "50", incidentId: "i1",
      category: "incident.activated,correction", from: "2026-09-23T00:00:00.000Z" });
    await client.listChronology("j");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("/api/v1/jurisdictions/j/chronology");
    fetchImpl.mockResolvedValueOnce(res(201, { id: "c1" }));
    expect(await client.correctAuditEvent("e1", "Road reopened at 09:10")).toBe("c1");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe("/api/v1/audit/e1/corrections");
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ note: "Road reopened at 09:10" }) });
  });

  it("joins every CSV export page under one header row", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply("seq,id\r\n1,a\r\n", { "x-next-cursor": "c2" }))
      .mockResolvedValueOnce(reply("seq,id\r\n2,b\r\n"));
    const client = new ApiClient({ fetchImpl });
    const blob = await client.exportAuditTrail("j", "csv");
    expect(await blob.text()).toBe("seq,id\r\n1,a\r\n2,b\r\n");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/v1/jurisdictions/j/audit/export?format=csv&limit=500",
      "/api/v1/jurisdictions/j/audit/export?format=csv&limit=500&cursor=c2",
    ]);
  });

  it("keeps each signed JSON export page whole, in order", async () => {
    const first = { page: { cursor: null, nextCursor: "c2", entries: [] }, signature: { value: "s1" } };
    const second = { page: { cursor: "c2", nextCursor: null, entries: [] }, signature: { value: "s2" } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(200, first)).mockResolvedValueOnce(res(200, second));
    const client = new ApiClient({ fetchImpl });
    const blob = await client.exportAuditTrail("j", "json");
    expect(JSON.parse(await blob.text())).toEqual([first, second]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("format=json&limit=500&cursor=c2");
  });
});

describe("staffing client", () => {
  it("reads a staffing page by cursor and posts check-in, badge scan, check-out, badge and shift writes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { onDuty: [], nextCursor: null, vacantPositions: [], upcomingShifts: [] }));
    const client = new ApiClient({ fetchImpl });
    await client.staffingSummary("j/1", { cursor: "next" });
    await client.staffingSummary("j");
    await client.checkIn("j", { personId: "p", positionId: "pos", incidentId: "i" });
    await client.scanCheckIn("j", { badgeToken: "abc", positionId: "pos" });
    await client.checkOut("c/1");
    await client.issueBadge("j", { personId: "p", label: "Planning Section Chief" });
    await client.createShift("j", { positionId: "pos", startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T20:00:00.000Z" });
    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, (init as RequestInit).method, (init as RequestInit).body]);
    expect(calls).toEqual([
      ["/api/v1/jurisdictions/j%2F1/staffing?cursor=next", "GET", undefined],
      ["/api/v1/jurisdictions/j/staffing", "GET", undefined],
      ["/api/v1/jurisdictions/j/checkins", "POST", JSON.stringify({ personId: "p", positionId: "pos", incidentId: "i" })],
      ["/api/v1/jurisdictions/j/checkins/scan", "POST", JSON.stringify({ badgeToken: "abc", positionId: "pos" })],
      ["/api/v1/checkins/c%2F1/checkout", "POST", undefined],
      ["/api/v1/jurisdictions/j/badges", "POST", JSON.stringify({ personId: "p", label: "Planning Section Chief" })],
      ["/api/v1/jurisdictions/j/shifts", "POST",
        JSON.stringify({ positionId: "pos", startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T20:00:00.000Z" })],
    ]);
  });
});
