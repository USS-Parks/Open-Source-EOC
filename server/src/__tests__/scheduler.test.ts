import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { createFeed } from "../feeds/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { scheduleBriefing } from "../meetings/service.js";
import { Scheduler, type SchedulerOptions } from "../scheduler/scheduler.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The in-process scheduler runs due work with no manual call: scheduled
 * notification rules, due briefings, feed polls and the outbox. One node leads
 * at a time, another takes over when it stops, and a failing job is logged
 * without stopping the others.
 */

const SCRAPE_TOKEN = "scheduler-scrape-token";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let receiver: FastifyInstance;
let receiverUrl: string;
let lockUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
const received: string[] = [];
const lines: string[] = [];
const schedulers: Scheduler[] = [];

function scheduler(options: Partial<SchedulerOptions> = {}): Scheduler {
  const s = new Scheduler(runtime, {
    lockUrl,
    logger: app.log,
    intervals: { rules: 50, briefings: 50, feeds: 50, outbox: 50 },
    leaderRetryMs: 50,
    briefings: true,
    ...options,
  });
  schedulers.push(s);
  return s;
}

async function scheduledRule(topic: string): Promise<void> {
  const rule = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`,
    headers: auth(adminToken),
    payload: {
      event: "scheduled",
      channels: [{ kind: "ntfy", url: receiverUrl, topic }],
      scheduleIntervalMinutes: 60,
    },
  });
  expect(rule.statusCode).toBe(201);
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  // The lock session may use any role on the database; the owner is at hand.
  const url = process.env.OPENEOC_DATABASE_URL;
  if (!url) throw new Error("the scheduler test needs OPENEOC_DATABASE_URL");
  const lock = new URL(url);
  lock.pathname = `/${admin.options.database}`;
  lockUrl = lock.toString();

  app = buildApp(runtime, {
    oidc: null,
    integrations: ["meetings"],
    logLevel: "info",
    logStream: { write: (line) => void lines.push(line) },
    metricsToken: SCRAPE_TOKEN,
  });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");

  receiver = Fastify({ logger: false });
  receiver.post("/*", (req, reply) => {
    received.push(req.url);
    return reply.send("ok");
  });
  receiver.get("/feed", () => ({ type: "FeatureCollection", features: [] }));
  await receiver.listen({ port: 0, host: "127.0.0.1" });
  const addr = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60000);

afterAll(async () => {
  await Promise.all(schedulers.map((s) => s.stop()));
  await app.close();
  await receiver.close();
  await runtime.end();
  await admin.end();
});

describe("scheduler", () => {
  it("fires a scheduled rule, a due briefing and a feed poll with no manual call", async () => {
    await scheduledRule("roll-call");
    const incident = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken),
      payload: { templateKey: "wildfire", name: "Bald Hills Fire" },
    });
    const incidentId = incident.json().incidentId as string;
    // A member schedules the briefing; the scheduler runs it as an admin.
    const member = await principalForPerson(runtime, seed.memberId);
    await withPerson(runtime, seed.memberId, (tx) =>
      scheduleBriefing(tx, member, incidentId, {
        title: "Morning briefing",
        scheduledAt: new Date(Date.now() - 60_000),
      }),
    );
    const adminPrincipal = await principalForPerson(runtime, seed.adminId);
    const feed = await withPerson(runtime, seed.adminId, (tx) =>
      createFeed(tx, adminPrincipal, seed.jurisdictionId, {
        name: "Local source",
        kind: "geojson",
        url: `${receiverUrl}/feed`,
        pollIntervalSeconds: 60,
      }),
    );

    const s = scheduler();
    app.metrics.delivery = s.delivery;
    app.metrics.scheduler = s;
    s.start();

    await vi.waitFor(() => expect(received).toContain("/roll-call"), { timeout: 5000 });
    await vi.waitFor(async () => {
      const [briefing] = await admin`select notified_at from briefings where incident_id = ${incidentId}`;
      expect(briefing?.notified_at).toBeTruthy();
    }, { timeout: 5000 });
    await vi.waitFor(async () => {
      const [row] = await admin`select last_success_at from feeds where id = ${feed.id}`;
      expect(row?.last_success_at).toBeTruthy();
    }, { timeout: 5000 });

    const scrape = await app.inject({
      method: "GET",
      url: "/api/v1/metrics",
      headers: auth(SCRAPE_TOKEN),
    });
    expect(scrape.body).toContain("openeoc_scheduler_leader 1");
    expect(scrape.body).toMatch(/openeoc_scheduler_last_run_seconds\{job="rules"\} \d/);
    // Many runs later the rule's interval guard still holds it to one firing.
    expect(received.filter((path) => path === "/roll-call")).toHaveLength(1);
    await s.stop();
    expect(s.status().leader).toBe(false);
  });

  it("elects one leader, and another takes over when it stops", async () => {
    const a = scheduler();
    const b = scheduler();
    a.start();
    b.start();
    await vi.waitFor(() => expect(a.status().leader || b.status().leader).toBe(true), {
      timeout: 5000,
    });
    // Several retry rounds later there is still exactly one leader.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect([a, b].filter((s) => s.status().leader)).toHaveLength(1);

    const [leader, follower] = a.status().leader ? [a, b] : [b, a];
    await leader.stop();
    await vi.waitFor(() => expect(follower.status().leader).toBe(true), { timeout: 5000 });
    await follower.stop();
  });

  it("logs a failing job and keeps running the others", async () => {
    // Without its discovery function the rules job fails on every run.
    await admin`revoke execute on function scheduler_due(text, timestamptz) from app_runtime`;
    try {
      await scheduledRule("after-failure");
      const s = scheduler();
      s.start();
      await vi.waitFor(() => {
        const failures = lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((l) => l.msg === "scheduled job failed" && l.job === "rules");
        expect(failures.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 5000 });

      // The outbox job still delivers what an administrator fires by hand.
      const fired = await app.inject({
        method: "POST",
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notifications/run-scheduled`,
        headers: auth(adminToken),
      });
      expect(fired.json().fired).toBe(1);
      await vi.waitFor(() => expect(received).toContain("/after-failure"), { timeout: 5000 });
      await s.stop();
    } finally {
      await admin`grant execute on function scheduler_due(text, timestamptz) to app_runtime`;
    }
  });
});
