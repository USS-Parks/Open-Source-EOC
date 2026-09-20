import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { rateLimit, resetRateLimit } from "../security/rate-limit.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * VEOC-37 hardening (M4): security response headers, health and readiness
 * probes, and the shared flood limiter. The limiter's ceiling is exercised
 * directly so the test is fast and deterministic; the middleware path is
 * covered by the header and probe checks going through the same hook.
 */

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

describe("security headers", () => {
  it("sets hardening headers and a strict CSP on API responses", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(String(res.headers["strict-transport-security"])).toContain("max-age=");
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
  });
});

describe("health and readiness", () => {
  it("health is ok with no dependencies", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("ready reports ready when the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });
});

describe("shared flood limiter", () => {
  it("allows up to the ceiling, then blocks with a retry hint", () => {
    resetRateLimit();
    for (let i = 0; i < 5; i++) expect(rateLimit("client-a", 5, 10_000).allowed).toBe(true);
    const blocked = rateLimit("client-a", 5, 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps separate clients independent", () => {
    resetRateLimit();
    for (let i = 0; i < 5; i++) rateLimit("client-b", 5, 10_000);
    expect(rateLimit("client-b", 5, 10_000).allowed).toBe(false);
    expect(rateLimit("client-c", 5, 10_000).allowed).toBe(true);
  });

  it("does not throttle heavy but legitimate volume", () => {
    resetRateLimit();
    for (let i = 0; i < 300; i++) expect(rateLimit("busy", 1200, 10_000).allowed).toBe(true);
  });

  it("is disabled by a zero ceiling", () => {
    expect(rateLimit("any", 0).allowed).toBe(true);
  });
});
