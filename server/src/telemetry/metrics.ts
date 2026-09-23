import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { AuthError } from "../auth/service.js";
import type { DrainResult } from "../notify/outbox.js";
import type { SchedulerStatus } from "../scheduler/scheduler.js";
import type { BoardSyncHub } from "../sync/hub.js";

/** Upper bounds, in seconds, of the request duration histogram. */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogram {
  readonly counts: number[];
  sum: number;
  count: number;
}

/**
 * Process-local request counters, and the scheduler and its delivery worker
 * when this process runs them (the entrypoint attaches them). Request ids are
 * never labels: they are unbounded, so a slow request is counted here by
 * route and found by id in the log.
 */
export class Metrics {
  delivery: { stats(): DrainResult } | null = null;
  scheduler: { status(): SchedulerStatus } | null = null;
  private readonly requests = new Map<string, number>();
  private readonly slow = new Map<string, number>();
  private readonly durations = new Map<string, Histogram>();

  observe(method: string, route: string, statusCode: number, ms: number, slow: boolean): void {
    const series = labels({ method, route });
    const byStatus = labels({ method, route, status: `${Math.floor(statusCode / 100)}xx` });
    this.requests.set(byStatus, (this.requests.get(byStatus) ?? 0) + 1);
    if (slow) this.slow.set(series, (this.slow.get(series) ?? 0) + 1);
    const h = this.durations.get(series) ?? { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
    const seconds = ms / 1000;
    BUCKETS.forEach((le, i) => {
      if (seconds <= le) h.counts[i] = (h.counts[i] ?? 0) + 1;
    });
    h.sum += seconds;
    h.count += 1;
    this.durations.set(series, h);
  }

  requestLines(): string[] {
    const out: string[] = [];
    family(out, "openeoc_http_requests_total", "counter",
      "HTTP requests by method, route pattern and status class.", [...this.requests]);
    family(out, "openeoc_http_slow_requests_total", "counter",
      "Requests slower than OPENEOC_SLOW_REQUEST_MS, by method and route pattern.", [...this.slow]);
    const name = "openeoc_http_request_duration_seconds";
    out.push(`# HELP ${name} Request duration by method and route pattern.`, `# TYPE ${name} histogram`);
    for (const [series, h] of this.durations) {
      const open = series.slice(0, -1);
      BUCKETS.forEach((le, i) => out.push(`${name}_bucket${open},le="${le}"} ${h.counts[i] ?? 0}`));
      out.push(`${name}_bucket${open},le="+Inf"} ${h.count}`);
      out.push(`${name}_sum${series} ${h.sum}`, `${name}_count${series} ${h.count}`);
    }
    return out;
  }
}

function labels(values: Record<string, string>): string {
  const pairs = Object.entries(values).map(
    ([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
  );
  return `{${pairs.join(",")}}`;
}

function family(
  out: string[],
  name: string,
  type: "counter" | "gauge",
  help: string,
  samples: readonly (readonly [string, number])[],
): void {
  out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  for (const [series, value] of samples) out.push(`${name}${series} ${value}`);
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * One log line and one metrics observation per request, and the request id
 * echoed on every response so an operator can quote it back.
 */
export function observeRequests(app: FastifyInstance, metrics: Metrics, slowMs: number): void {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    const durationMs = reply.elapsedTime;
    const slow = durationMs > slowMs;
    metrics.observe(req.method, route, reply.statusCode, durationMs, slow);
    const fields = {
      method: req.method,
      route,
      path: req.url.split("?")[0],
      statusCode: reply.statusCode,
      durationMs: Math.round(durationMs),
    };
    if (slow) req.log.warn(fields, "slow request");
    else req.log.info(fields, "request completed");
  });
}

/**
 * Prometheus text exposition. Served only when a scrape token is configured,
 * and then only to a caller presenting it; otherwise the route answers 404 as
 * if it did not exist.
 */
export function metricsRoutes(
  app: FastifyInstance,
  sql: Sql,
  hub: BoardSyncHub,
  metrics: Metrics,
  token: string | null,
): void {
  app.get("/api/v1/metrics", async (req, reply) => {
    if (!token) return reply.code(404).send({ error: "not found" });
    if (!sameSecret(req.headers.authorization ?? "", `Bearer ${token}`)) {
      throw new AuthError(401, "not authenticated");
    }
    const out = metrics.requestLines();
    const memory = process.memoryUsage();
    family(out, "openeoc_process_memory_bytes", "gauge",
      "Process memory: resident set, V8 heap used and total, and external buffers.",
      [[`{kind="rss"}`, memory.rss], [`{kind="heap_used"}`, memory.heapUsed],
        [`{kind="heap_total"}`, memory.heapTotal], [`{kind="external"}`, memory.external]]);
    family(out, "openeoc_websocket_connections", "gauge",
      "Open WebSocket connections (board sync and dashboard streams).",
      [["", app.websocketServer.clients.size]]);
    const hubStats = hub.stats();
    family(out, "openeoc_sync_docs", "gauge", "Board documents held in memory by the sync hub.",
      [["", hubStats.entries]]);
    family(out, "openeoc_sync_hydrations_total", "counter",
      "Board documents rebuilt from the update log.", [["", hubStats.hydrations]]);
    family(out, "openeoc_sync_row_loads_total", "counter",
      "Board row reads made for sync projections.", [["", hubStats.rowLoads]]);
    family(out, "openeoc_sync_snapshots_total", "counter",
      "Sync snapshots written.", [["", hubStats.snapshots]]);
    if (metrics.delivery) {
      family(out, "openeoc_delivery_outcomes_total", "counter",
        "Delivery worker outcomes in this process since start.",
        Object.entries(metrics.delivery.stats()).map(([outcome, n]) => [labels({ outcome }), n]));
    }
    if (metrics.scheduler) {
      const status = metrics.scheduler.status();
      family(out, "openeoc_scheduler_leader", "gauge",
        "1 when this process holds the scheduler lock and runs the scheduled jobs.",
        [["", status.leader ? 1 : 0]]);
      family(out, "openeoc_scheduler_last_run_seconds", "gauge",
        "Unix time each scheduled job last finished a run in this process.",
        Object.entries(status.lastRun).map(([job, at]) => [labels({ job }), at.getTime() / 1000]));
    }
    family(out, "openeoc_db_pool_max", "gauge",
      "Configured maximum connections of this process's database client.",
      [["", sql.options.max]]);
    let up = 1;
    try {
      const [queues] = await sql`select * from outbox_counts()`;
      const connections = await sql`
        select coalesce(state, 'unknown') as state, count(*)::int as n
        from pg_stat_activity
        where usename = current_user and datname = current_database()
        group by 1 order by 1`;
      family(out, "openeoc_delivery_queue", "gauge",
        "Outbound webhook and push deliveries by status: pending or dead-lettered.", [
          [labels({ status: "pending" }), Number(queues?.delivery_pending ?? 0)],
          [labels({ status: "dead" }), Number(queues?.delivery_dead ?? 0)],
        ]);
      family(out, "openeoc_federation_queue_pending", "gauge",
        "Federation outbox entries not yet delivered to their peer.",
        [["", Number(queues?.federation_pending ?? 0)]]);
      family(out, "openeoc_db_connections", "gauge",
        "Connections held by the runtime database role, by state, as PostgreSQL reports them. " +
          "Counts every process using the role, and includes this scrape.",
        connections.map((r) => [labels({ state: String(r.state) }), Number(r.n)]));
    } catch (err) {
      up = 0;
      req.log.warn({ err }, "metrics database probe failed");
    }
    family(out, "openeoc_db_up", "gauge", "1 when the metrics database probe succeeded.", [["", up]]);
    return reply.type("text/plain; version=0.0.4; charset=utf-8").send(`${out.join("\n")}\n`);
  });
}
