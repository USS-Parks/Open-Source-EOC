import { describe, expect, it } from "vitest";
import { API_CONTRACT, API_VERSION, generateApiDocs, type ApiContract } from "../contract.js";

/**
 * The frozen contract (VEOC-31, INV-4/INV-9). These tests guard the shape
 * of the published surface and the docs generated from it. A server-side
 * contract test separately holds the running app to the same list, so the
 * documented API and the deployed API cannot drift apart.
 */

describe("API contract", () => {
  it("is versioned and internally consistent", () => {
    expect(API_CONTRACT.version).toBe(API_VERSION);
    expect(API_CONTRACT.rest.length).toBeGreaterThan(0);
    expect(API_CONTRACT.websockets.length).toBeGreaterThan(0);
  });

  it("keeps local alert review, notification acknowledgement, and external transmission as separate endpoints", () => {
    const endpoints = new Set(API_CONTRACT.rest.map((entry) => `${entry.method} ${entry.path}`));
    expect(endpoints.has("POST /api/v1/jurisdictions/:jurisdictionId/cap/drafts")).toBe(true);
    expect(endpoints.has("POST /api/v1/cap/alerts/:id/review")).toBe(true);
    expect(endpoints.has("POST /api/v1/notifications/:notificationId/read")).toBe(true);
    expect(endpoints.has("POST /api/v1/notifications/:notificationId/acknowledge")).toBe(true);
    expect(endpoints.has("POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws")).toBe(true);
  });

  it("has no duplicate REST method+path pairs", () => {
    const seen = new Set<string>();
    for (const e of API_CONTRACT.rest) {
      const key = `${e.method} ${e.path}`;
      expect(seen.has(key), `duplicate endpoint ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("scopes every REST path under the versioned prefix", () => {
    for (const e of API_CONTRACT.rest) {
      expect(e.path.startsWith(`/api/${API_VERSION}/`)).toBe(true);
    }
  });

  it("gives every REST endpoint a declared auth mode", () => {
    const modes = new Set(["bearer", "peer-token", "feed-token", "intake-token", "none"]);
    for (const e of API_CONTRACT.rest) {
      expect(modes.has(e.auth), `${e.method} ${e.path} has auth ${e.auth}`).toBe(true);
    }
  });

  it("generates Markdown docs from the contract, grouped by tag", () => {
    const docs = generateApiDocs();
    expect(docs).toContain(`# Open Source EOC Public API (${API_VERSION})`);
    expect(docs).toContain("## REST");
    expect(docs).toContain("## WebSocket channels");
    expect(docs).toContain("## Webhook events");
    // Every REST endpoint appears in the generated docs verbatim.
    for (const e of API_CONTRACT.rest) {
      expect(docs).toContain(`\`${e.method} ${e.path}\``);
    }
    // Tags are rendered as sorted section headings.
    const tags = [...new Set(API_CONTRACT.rest.map((e) => e.tag))];
    for (const tag of tags) expect(docs).toContain(`### ${tag}`);
  });

  it("regenerates identically for a given contract (deterministic)", () => {
    const a = generateApiDocs(API_CONTRACT);
    const b = generateApiDocs(API_CONTRACT);
    expect(a).toBe(b);
  });

  it("accepts an alternate contract argument", () => {
    const tiny: ApiContract = {
      version: "v9",
      rest: [{ method: "GET", path: "/api/v9/ping", tag: "meta", summary: "Liveness", auth: "none" }],
      websockets: [],
      webhooks: [],
    };
    const docs = generateApiDocs(tiny);
    expect(docs).toContain("# Open Source EOC Public API (v9)");
    expect(docs).toContain("`GET /api/v9/ping`");
  });
});
