import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Load and scale benchmarks (VEOC-38, R1). These are the committed floor as a
 * regression guard: a board holding the SharePoint-lesson volume of 5,000
 * records still serves a view quickly, and a 150-operation concurrent burst
 * (mixed reads and writes, the shape of a 150-user activation) completes
 * within budget. Budgets are generous so CI variance never flakes; the
 * measured numbers are printed and published in docs/CAPACITY-VEOC-38.md.
 */

// Budgets: deliberately loose ceilings that only a pathological regression
// (an unindexed scan, an accidental N+1, a lock storm) would breach.
const VIEW_5000_BUDGET_MS = 5000;
const BURST_WALL_BUDGET_MS = 30000;
const BURST_P95_BUDGET_MS = 6000;
const CONCURRENCY = 150;
const VOLUME = 5000;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let boardId: string;

function auth(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
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
  boardId = (await auth("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: "activity_log" })).json()
    .id as string;
}, 120000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

describe("board record volume (the 5,000-item lesson)", () => {
  it(`serves a view over ${VOLUME} records within budget`, async () => {
    await admin`
      insert into board_records (board_id, data, created_by)
      select ${boardId}, jsonb_build_object('entry', 'Log line ' || g, 'notable', false), ${adminId}
      from generate_series(1, ${VOLUME}) g`;
    const t0 = performance.now();
    const res = await auth("GET", `/api/v1/boards/${boardId}/views/all`);
    const ms = performance.now() - t0;
    expect(res.statusCode).toBe(200);
    expect(res.json().records.length).toBe(VOLUME);
    // eslint-disable-next-line no-console
    console.log(`[load] view over ${VOLUME} records: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(VIEW_5000_BUDGET_MS);
  }, 60000);
});

describe("150-concurrent activation profile", () => {
  it(`serves ${CONCURRENCY} mixed operations within budget`, async () => {
    const durations: number[] = [];
    const task = (fn: () => Promise<{ statusCode: number }>) => async () => {
      const t0 = performance.now();
      const res = await fn();
      durations.push(performance.now() - t0);
      return res.statusCode;
    };
    const tasks: Array<() => Promise<number>> = [];
    for (let i = 0; i < CONCURRENCY; i += 1) {
      const kind = i % 3;
      if (kind === 0) tasks.push(task(() => auth("GET", "/api/v1/me")));
      else if (kind === 1) tasks.push(task(() => auth("GET", `/api/v1/boards/${boardId}/views/all`)));
      else tasks.push(task(() => auth("POST", `/api/v1/boards/${boardId}/records`, { entry: `burst ${i}` })));
    }
    const t0 = performance.now();
    const codes = await Promise.all(tasks.map((t) => t()));
    const wall = performance.now() - t0;
    const p95 = percentile(durations, 95);

    // Every operation succeeded (2xx).
    expect(codes.every((c) => c >= 200 && c < 300)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `[load] ${CONCURRENCY} concurrent ops: wall=${wall.toFixed(0)}ms p95=${p95.toFixed(0)}ms ` +
        `max=${Math.max(...durations).toFixed(0)}ms`,
    );
    expect(wall).toBeLessThan(BURST_WALL_BUDGET_MS);
    expect(p95).toBeLessThan(BURST_P95_BUDGET_MS);
  }, 60000);
});
