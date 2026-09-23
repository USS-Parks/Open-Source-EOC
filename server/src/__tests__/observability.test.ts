import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Structured logs and the metrics endpoint. An operator who has only the log
 * and a metrics scrape can find a slow request and a failed delivery: the log
 * carries the request id, route, status and duration, or the delivery id and
 * its error, and the metrics count both.
 */

const SCRAPE_TOKEN = "scrape-token-for-tests";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let adminToken: string;
let jurisdictionId: string;
let boardId: string;
const lines: string[] = [];

function logged(): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function scrape(): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/api/v1/metrics", headers: auth(SCRAPE_TOKEN) });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
  return res.body;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, {
    oidc: null,
    logLevel: "info",
    logStream: { write: (line) => void lines.push(line) },
    // Every request counts as slow, so any one of them is the probe.
    slowRequestMs: 0,
    metricsToken: SCRAPE_TOKEN,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "activity_log" },
  });
  boardId = board.json().id as string;
}, 60000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("a slow request is findable from the log and the metrics", () => {
  it("logs the request id, route, status and duration, and counts it by route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { ...auth(adminToken), "x-request-id": "probe-slow-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-request-id"]).toBe("probe-slow-1");
    const line = logged().find((l) => l.reqId === "probe-slow-1");
    expect(line).toMatchObject({
      level: 40,
      msg: "slow request",
      method: "GET",
      route: "/api/v1/me",
      path: "/api/v1/me",
      statusCode: 200,
    });
    expect(typeof line!.durationMs).toBe("number");

    const metrics = await scrape();
    expect(metrics).toMatch(/^openeoc_http_slow_requests_total\{method="GET",route="\/api\/v1\/me"\} [1-9]/m);
    expect(metrics).toMatch(
      /^openeoc_http_requests_total\{method="GET",route="\/api\/v1\/me",status="2xx"\} [1-9]/m,
    );
    expect(metrics).toMatch(
      /^openeoc_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/me"\} [1-9]/m,
    );
  });

  it("replaces an unsafe incoming request id and never logs credentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "not a safe id {}" },
    });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    app.log.info(
      { headers: { authorization: "Bearer leak-check" }, password: "leak-check", body: { token: "leak-check" } },
      "redaction probe",
    );
    const all = lines.join("");
    expect(all).toContain("redaction probe");
    expect(all).not.toContain("leak-check");
    expect(all).not.toContain(adminToken);
  });
});

describe("a failed delivery is findable from the log and the metrics", () => {
  it("logs the dead letter with its delivery id and error, and counts it", async () => {
    const rule = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-rules`,
      headers: auth(adminToken),
      payload: {
        boardId,
        event: "record.created",
        // Nothing listens on the discard port.
        channels: [{ kind: "webhook", url: "http://127.0.0.1:9/hook-secret-path" }],
      },
    });
    expect(rule.statusCode).toBe(201);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(adminToken),
      payload: { entry: "to a closed port" },
    });
    expect(write.statusCode).toBe(201);

    const worker = new DeliveryWorker(runtime, { maxAttempts: 1, logger: app.log });
    app.metrics.delivery = worker;
    expect((await worker.drain()).dead).toBe(1);
    const [row] = await admin`select id from delivery_outbox where status = 'dead'`;
    const line = logged().find((l) => l.msg === "delivery dead-lettered");
    expect(line).toMatchObject({
      level: 50,
      deliveryId: row!.id,
      target: "http://127.0.0.1:9",
      attempts: 1,
    });
    expect(line!.error).toBeTruthy();
    expect(JSON.stringify(line)).not.toContain("hook-secret-path");

    const metrics = await scrape();
    expect(metrics).toMatch(/^openeoc_delivery_queue\{status="dead"\} 1$/m);
    expect(metrics).toMatch(/^openeoc_delivery_queue\{status="pending"\} 0$/m);
    expect(metrics).toMatch(/^openeoc_delivery_outcomes_total\{outcome="dead"\} 1$/m);
    expect(metrics).toMatch(/^openeoc_federation_queue_pending 0$/m);
  });
});

describe("the metrics endpoint", () => {
  it("reports open sockets, the sync hub and the database pool", async () => {
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/boards/${boardId}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    try {
      const metrics = await scrape();
      expect(metrics).toMatch(/^openeoc_websocket_connections 1$/m);
      expect(metrics).toMatch(/^openeoc_sync_docs \d+$/m);
      expect(metrics).toMatch(/^openeoc_sync_hydrations_total \d+$/m);
      expect(metrics).toMatch(/^openeoc_db_pool_max 10$/m);
      expect(metrics).toMatch(/^openeoc_db_connections\{state="active"\} [1-9]/m);
      expect(metrics).toMatch(/^openeoc_db_up 1$/m);
    } finally {
      socket.close();
    }
  });

  it("requires the scrape token, and does not exist while none is configured", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/metrics" });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({ method: "GET", url: "/api/v1/metrics", headers: auth("wrong") });
    expect(wrong.statusCode).toBe(401);
    // An operator's session token is not a scrape token.
    const operator = await app.inject({ method: "GET", url: "/api/v1/metrics", headers: auth(adminToken) });
    expect(operator.statusCode).toBe(401);

    const unconfigured = buildApp(runtime, { oidc: null, metricsToken: null });
    try {
      const res = await unconfigured.inject({ method: "GET", url: "/api/v1/metrics", headers: auth(SCRAPE_TOKEN) });
      expect(res.statusCode).toBe(404);
    } finally {
      await unconfigured.close();
    }
  });
});
