import { describe, expect, it } from "vitest";
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
