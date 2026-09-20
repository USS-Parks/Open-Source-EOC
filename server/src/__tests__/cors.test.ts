import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCors, corsOriginAllowed } from "../security/cors.js";
import { buildApp } from "../app.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Allowlisted CORS (M4). The allowlist logic is exercised directly with an
 * explicit list; the app wiring is checked by a preflight going through the
 * hook. CORS is off by default, so a configured integration case is covered
 * by the unit tests rather than by mutating process state.
 */

function fakeReply(): { reply: FastifyReply; headers: Record<string, string>; state: { status: number; sent: boolean } } {
  const headers: Record<string, string> = {};
  const state = { status: 200, sent: false };
  const reply = {
    header(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return reply;
    },
    code(c: number) {
      state.status = c;
      return reply;
    },
    send() {
      state.sent = true;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, headers, state };
}

function fakeReq(method: string, origin?: string): FastifyRequest {
  return { method, headers: origin ? { origin } : {} } as unknown as FastifyRequest;
}

const ALLOWED = ["https://eoc.example.gov"];

describe("CORS allowlist", () => {
  it("matches only exact configured origins", () => {
    expect(corsOriginAllowed("https://eoc.example.gov", ALLOWED)).toBe(true);
    expect(corsOriginAllowed("https://evil.example", ALLOWED)).toBe(false);
    expect(corsOriginAllowed("https://eoc.example.gov", [])).toBe(false);
  });

  it("echoes an allowed origin, never a wildcard, and varies on Origin", () => {
    const { reply, headers } = fakeReply();
    const preflight = applyCors(fakeReq("GET", "https://eoc.example.gov"), reply, ALLOWED);
    expect(preflight).toBe(false);
    expect(headers["access-control-allow-origin"]).toBe("https://eoc.example.gov");
    expect(headers["access-control-allow-origin"]).not.toBe("*");
    expect(headers["vary"]).toBe("Origin");
  });

  it("answers a preflight for an allowed origin with 204", () => {
    const { reply, headers, state } = fakeReply();
    const preflight = applyCors(fakeReq("OPTIONS", "https://eoc.example.gov"), reply, ALLOWED);
    expect(preflight).toBe(true);
    expect(state.status).toBe(204);
    expect(state.sent).toBe(true);
    expect(headers["access-control-allow-methods"]).toContain("POST");
  });

  it("adds no CORS headers for a disallowed origin", () => {
    const { reply, headers } = fakeReply();
    applyCors(fakeReq("GET", "https://evil.example"), reply, ALLOWED);
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("CORS wiring (off by default)", () => {
  let admin: Sql;
  let runtime: Sql;
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ admin, runtime } = await freshDb());
    app = buildApp(runtime, { oidc: null });
  });
  afterAll(async () => {
    await app.close();
    await runtime.end();
    await admin.end();
  });

  it("answers a preflight through the request hook", async () => {
    const res = await app.inject({ method: "OPTIONS", url: "/api/v1/health" });
    expect(res.statusCode).toBe(204);
  });

  it("does not echo an origin when none are configured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://eoc.example.gov" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
