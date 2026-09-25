import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpGetRequest } from "node:http";
import { Agent, request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { resolve } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { startLoopbackHost } from "./lib/loopback-host.mjs";

/**
 * Many people working one incident at once, against the network host.
 * The host-demo profile (the North Coast Storm) runs as its service
 * definitions say, behind Caddy with its own certificate authority, on this
 * computer's loopback address. Synthetic accounts are added to the owning
 * organization; each person signs in with their own session from their own
 * loopback address (127.0.0.2 and up), so the server's per-address limits see
 * separate clients as they would on a network. Each person then works the
 * console for the run: screen visits, record edits over REST and over the
 * live sync socket, thread posts, resource requests submitted and moved on,
 * the notification socket, and a session renewal every ten minutes.
 *
 *   node --import ./deploy/windows/ts-loader.mjs deploy/windows/prove-load.mjs [--users=150] [--minutes=120] [--warmup=10]
 *
 * Writes LOAD-TEST-REPORT.md and LOAD-TEST-SAMPLES.jsonl at the repository
 * root, and exits non-zero when a threshold fails. Needs what
 * prove-host.mjs needs: the desktop build, the PostgreSQL runtime and Caddy.
 */

const root = process.cwd();
const option = (name, fallback) => {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? Number(match.slice(name.length + 3)) : fallback;
};
const USERS = option("users", 150);
const MINUTES = option("minutes", 120);
const WARMUP_MINUTES = option("warmup", 10);
if (USERS < 2 || USERS > 250) throw new Error("--users takes 2 to 250 (one loopback address each)");

const THRESHOLDS = { errors: 0, readP95Ms: 1000, writeP95Ms: 2000, liveP95Ms: 2000, heapGrowth: 0.1 };
const SCREEN_MS = 30_000;
const WRITE_MS = 120_000;
const EDIT_MS = 30_000;
/** One person in ten is a field user whose offline edit syncs over the board socket, as the field client does. */
const FIELD_SHARE = 10;
const FIELD_SYNC_MS = 5 * 60_000;
const RENEW_MS = 10 * 60_000;
const SAMPLE_MS = 60_000;

const out = resolve(root, "deploy/test-runtime/out/rd4-load");
mkdirSync(out, { recursive: true });
const reportPath = resolve(root, "LOAD-TEST-REPORT.md");
const samplesPath = resolve(root, "LOAD-TEST-SAMPLES.jsonl");
const requireServer = createRequire(resolve(root, "server/package.json"));
const postgres = requireServer("postgres");
const WebSocket = requireServer("ws");
const Y = requireServer("yjs");
const { createPerson, addMembership } = await import("../../server/src/auth/service.ts");

/** Milliseconds, exact to the millisecond up to a minute. */
class Histogram {
  constructor() { this.buckets = new Uint32Array(60_001); this.count = 0; this.max = 0; }
  add(ms) {
    const value = Math.min(60_000, Math.max(0, Math.round(ms)));
    this.buckets[value] += 1;
    this.count += 1;
    if (value > this.max) this.max = value;
  }
  quantile(q) {
    if (this.count === 0) return null;
    const target = Math.ceil(this.count * q);
    let seen = 0;
    for (let ms = 0; ms < this.buckets.length; ms += 1) {
      seen += this.buckets[ms];
      if (seen >= target) return ms;
    }
    return this.max;
  }
}

const measures = () => ({ reads: new Histogram(), writes: new Histogram(), live: new Histogram(), errors: 0 });
const total = measures();
let window = measures();
const errorKinds = new Map();
const counts = { signIns: 0, renewals: 0, retriedAfterRenewal: 0, screens: 0, restEdits: 0, fieldSyncs: 0, messages: 0, requestsSubmitted: 0, requestMoves: 0, notificationRefetches: 0, deliveries: 0 };
let stopping = false;
let runStartedAt = Date.now();

/**
 * Each read route's times in the 20 minutes after the warm-up and in the run's
 * last 20 minutes, so a route whose reads slow as the incident's work piles up
 * shows by name.
 */
const routes = new Map();
function routeRead(path, ms) {
  const minute = (Date.now() - runStartedAt) / 60_000;
  const phase = minute >= WARMUP_MINUTES && minute < WARMUP_MINUTES + 20 ? "early" : minute >= MINUTES - 20 ? "late" : null;
  const key = routeOf(path);
  let entry = routes.get(key);
  if (!entry) routes.set(key, entry = { count: 0, early: new Histogram(), late: new Histogram() });
  entry.count += 1;
  if (phase) entry[phase].add(ms);
}

const routeOf = (path) => path.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id");
function fail(kind) {
  if (stopping) return;
  window.errors += 1;
  total.errors += 1;
  errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
}

const jitter = (ms) => ms / 2 + Math.random() * ms;
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const git = (args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } };

const dataRoot = mkdtempSync(resolve(tmpdir(), "oel-"));
const metricsToken = randomBytes(24).toString("hex");
const started = new Date();
let host = null;
const result = { status: "running", users: USERS, minutes: MINUTES };
try {
  host = await startLoopbackHost({
    root, dataRoot, out,
    distRoot: resolve(root, "deploy/windows/out/build/app-dist"),
    publicRoot: resolve(root, "web/public"),
    pgDist: resolve(process.env.OPENEOC_PG_DIST ?? resolve(root, "deploy/test-runtime/out/pgsql")),
    caddyExe: resolve(process.env.OPENEOC_CADDY ?? resolve(root, "deploy/windows/out/runtime-inputs/host-tools/caddy/caddy.exe")),
    serverEnv: { OPENEOC_METRICS_TOKEN: metricsToken },
  });
  const port = host.httpsPort;
  const ca = host.rootPem;

  // The synthetic people, members of the organization that owns the incident.
  const ownerPassword = readFileSync(resolve(host.profileRoot, "secrets/postgres.password"), "utf8").trim();
  const sql = postgres({ host: "127.0.0.1", port: host.pgPort, username: "postgres", password: ownerPassword, database: "openeoc_host_demo", onnotice: () => undefined });
  const password = `load-${randomBytes(12).toString("hex")}`;
  const people = [];
  let jurisdictionId;
  let incidentId;
  try {
    [{ id: jurisdictionId }] = await sql`select id from jurisdictions where slug = 'humboldt-oes'`;
    [{ id: incidentId }] = await sql`select id from incidents where name = 'North Coast Storm'`;
    for (let index = 0; index < USERS; index += 1) {
      const number = String(index + 1).padStart(3, "0");
      const email = `load.operator.${number}@humboldt.example`;
      const id = await createPerson(sql, { email, displayName: `Load Operator ${number}`, password });
      await addMembership(sql, id, jurisdictionId, "member");
      people.push({ email, address: `127.0.0.${index + 2}` });
    }
  } finally {
    await sql.end();
  }

  /** One HTTPS call from a person's own address; resolves with status and parsed body, or null on a network failure. */
  function send(agent, token, method, path, body) {
    return new Promise((resolvePromise) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const call = httpsRequest({
        host: "127.0.0.1", port, method, path: `/api/v1${path}`, agent, timeout: 30_000,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          resolvePromise({ status: response.statusCode, json });
        });
        response.on("error", () => resolvePromise(null));
      });
      call.on("timeout", () => call.destroy(new Error("timeout")));
      call.on("error", () => resolvePromise(null));
      if (payload) call.write(payload);
      call.end();
    });
  }

  function person(index) {
    const { email, address } = people[index];
    const agent = new Agent({ ca, localAddress: address, keepAlive: true, maxSockets: 6 });
    const timers = new Set();
    const sockets = new Set();
    const label = String(index + 1).padStart(3, "0");
    let token = null;
    let resumeToken = null;
    let recordId = null;
    let boards = {};
    let threadId = null;
    const ownRequests = [];
    const later = (ms, run) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!stopping) void run(); }, ms);
      timers.add(timer);
    };

    async function call(kind, method, path, body) {
      const begun = performance.now();
      let response = await send(agent, token, method, path, body);
      if (response?.status === 401 && !stopping) {
        // A renewal replaces the session's access token, so a request sent
        // with the old one a moment before is refused. The web client renews
        // and retries once; so does each person here, and the time counts.
        await renewNow();
        counts.retriedAfterRenewal += 1;
        response = await send(agent, token, method, path, body);
      }
      const ms = performance.now() - begun;
      if (!stopping) {
        const histogram = kind === "write" ? "writes" : "reads";
        window[histogram].add(ms);
        total[histogram].add(ms);
        if (kind === "read") routeRead(path, ms);
      }
      if (!response) { fail(`${method} ${routeOf(path)}: no response`); return null; }
      if (response.status >= 400) { fail(`${method} ${routeOf(path)}: ${response.status}`); return null; }
      return response.json;
    }

    const I = () => encodeURIComponent(incidentId);
    const screens = {
      overview: () => [`/incidents/${I()}/summary`, `/incidents/${I()}/activity?limit=10`, `/incidents/${I()}/lifeline-assessments`,
        `/jurisdictions/${jurisdictionId}/incidents/overview?archived=exclude`, "/notifications"],
      map: () => [boards.shelters, boards.road_closures, boards.incident_facilities, boards.field_reports]
        .filter(Boolean).map((board) => `/ogc/collections/${board}/items`).concat(`/incidents/${I()}/impact`),
      fieldReports: () => [`/boards/${boards.field_reports}?incidentId=${I()}`, `/boards/${boards.field_reports}/views/all?incidentId=${I()}&limit=500`],
      shelters: () => [`/boards/${boards.shelters}?incidentId=${I()}`, `/boards/${boards.shelters}/views/all?incidentId=${I()}`],
      requests: () => [`/incidents/${I()}/resource-requests`],
      threads: () => [`/incidents/${I()}/threads`, ...(threadId ? [`/threads/${threadId}/messages?after=0`] : [])],
      lifelines: () => [`/incidents/${I()}/lifeline-assessments`, `/incidents/${I()}/esf-assessments`],
    };
    const weighted = ["overview", "overview", "overview", "map", "map", "fieldReports", "fieldReports", "shelters", "requests", "threads", "lifelines"];

    async function visit() {
      const paths = screens[pick(weighted)]();
      await Promise.all(paths.map((path) => call("read", "GET", path)));
      counts.screens += 1;
      later(jitter(SCREEN_MS), visit);
    }

    const writes = [
      async () => {
        if (!threadId) return;
        if (await call("write", "POST", `/threads/${threadId}/messages`, { body: `Load operator ${label}: status check at ${new Date().toISOString()}` })) counts.messages += 1;
      },
      async () => {
        const created = await call("write", "POST", `/jurisdictions/${jurisdictionId}/resource-requests`, {
          origin: "eoc", item: `Load operator ${label} supplies`, quantity: 1, priority: pick(["routine", "priority"]),
          neededBy: new Date(Date.now() + 6 * 3_600_000).toISOString(), notes: "Synthetic load request", incidentId,
        });
        if (created?.id) { ownRequests.push({ id: created.id, state: "submitted" }); counts.requestsSubmitted += 1; }
      },
      async () => {
        const next = { submitted: "accepted", accepted: "sourcing", sourcing: "assigned", assigned: "deployed", deployed: "fulfilled", fulfilled: "closed" };
        const open = ownRequests.find((item) => next[item.state]);
        if (!open) return;
        const moved = await call("write", "POST", `/resource-requests/${open.id}/transition`, { toState: next[open.state] });
        if (moved?.state) { open.state = moved.state; counts.requestMoves += 1; }
      },
    ];
    async function write() {
      await pick(writes)();
      later(jitter(WRITE_MS), write);
    }

    let renewing = null;
    /** Renew the session once, however many requests ask at the same time. */
    function renewNow() {
      renewing ??= (async () => {
        const begun = performance.now();
        const response = await send(agent, null, "POST", "/auth/resume", { resumeToken });
        if (!stopping) { window.writes.add(performance.now() - begun); total.writes.add(performance.now() - begun); }
        if (!response || response.status !== 200) fail(`POST /auth/resume: ${response?.status ?? "no response"}`);
        else { token = response.json.accessToken; resumeToken = response.json.resumeToken ?? resumeToken; counts.renewals += 1; }
      })().finally(() => { renewing = null; });
      return renewing;
    }

    async function renew() {
      await renewNow();
      later(RENEW_MS, renew);
    }

    /** A socket that authenticates with the current token and reconnects if the server drops it. */
    function socket(path, onMessage) {
      if (stopping) return;
      const ws = new WebSocket(`wss://127.0.0.1:${port}/api/v1${path}`, { ca, localAddress: address });
      sockets.add(ws);
      ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === "error") fail(`socket ${routeOf(path)}: ${message.code ?? message.error}`);
        else onMessage(ws, message);
      });
      ws.on("error", () => fail(`socket ${routeOf(path)}: transport error`));
      ws.on("close", () => {
        sockets.delete(ws);
        if (!stopping) { fail(`socket ${routeOf(path)}: closed by the server`); later(1000, () => socket(path, onMessage)); }
      });
    }

    /** The console's edit: the person's own field report, over REST, stamped so others can time its arrival. */
    async function edit() {
      if (await call("write", "PATCH", `/boards/${boards.field_reports}/records/${recordId}?incidentId=${I()}`,
        { summary: `Load operator ${label} note ${Date.now()}` })) counts.restEdits += 1;
      later(jitter(EDIT_MS), edit);
    }

    /**
     * The time from an edit's send to this person's receipt, read from the
     * stamp in the update frame itself. Only field users keep the board's
     * document, as the field client does; everyone else reads the frames,
     * so the generator's own work stays small and does not colour the times.
     * A field user's frame carries the whole document: its newest stamp is
     * the edit just sent.
     */
    function measureDelivery(update) {
      let newest = 0;
      let author = null;
      for (const match of Buffer.from(update, "base64").toString("latin1").matchAll(/Load operator (\d{3}) note (\d{13})/g)) {
        const at = Number(match[2]);
        if (at > newest) { newest = at; author = match[1]; }
      }
      if (!newest || author === label || stopping) return;
      const ms = Date.now() - newest;
      window.live.add(ms);
      total.live.add(ms);
      counts.deliveries += 1;
    }

    /** The board's live socket; a field user also syncs a queued edit over it: the whole document, with an operation id. */
    function syncFieldReports(field) {
      const doc = field ? new Y.Doc() : null;
      const records = doc?.getMap("records");
      const pending = new Map();
      let syncing = false;
      let current = null;
      const sync = () => {
        const ws = current;
        if (ws?.readyState === WebSocket.OPEN) {
          doc.transact(() => records.set(`${recordId}/summary`, `Load operator ${label} note ${Date.now()}`));
          const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
          pending.set(ws, performance.now());
          ws.send(JSON.stringify({ type: "update", update, operationId: randomUUID(), incidentId }));
        }
        later(jitter(FIELD_SYNC_MS), sync);
      };
      socket(`/sync/boards/${boards.field_reports}?incidentId=${I()}`, (ws, message) => {
        current = ws;
        if (message.type === "state" || message.type === "update") {
          if (doc) Y.applyUpdate(doc, Buffer.from(message.update, "base64"), message.type);
          // The board's full state on joining is history, not a live delivery.
          if (message.type === "update") measureDelivery(message.update);
          if (message.type === "state" && field && !syncing) { syncing = true; later(jitter(FIELD_SYNC_MS), sync); }
        } else if (message.type === "synced") {
          const begun = pending.get(ws);
          pending.delete(ws);
          if (begun !== undefined && !stopping) { window.writes.add(performance.now() - begun); total.writes.add(performance.now() - begun); counts.fieldSyncs += 1; }
        }
      });
    }

    async function start() {
      const begun = performance.now();
      const login = await send(agent, null, "POST", "/auth/login", { email, password });
      total.writes.add(performance.now() - begun);
      window.writes.add(performance.now() - begun);
      if (!login || login.status !== 200 || !login.json?.accessToken) { fail(`POST /auth/login: ${login?.status ?? "no response"}`); return; }
      ({ accessToken: token, resumeToken } = login.json);
      counts.signIns += 1;
      await call("read", "GET", "/me");
      const [incident, organizationBoards] = await Promise.all([
        call("read", "GET", `/incidents/${I()}`), call("read", "GET", `/jurisdictions/${jurisdictionId}/boards`)]);
      const attached = new Set((incident?.boards ?? []).map((board) => board.id));
      boards = Object.fromEntries((organizationBoards?.boards ?? []).filter((board) => attached.has(board.id)).map((board) => [board.templateKey, board.id]));
      const threads = await call("read", "GET", `/incidents/${I()}/threads`);
      threadId = threads?.threads?.find((thread) => thread.title === "Road status")?.id ?? threads?.threads?.[0]?.id ?? null;
      await Promise.all(screens.overview().map((path) => call("read", "GET", path)));
      const created = await call("write", "POST", `/boards/${boards.field_reports}/records?incidentId=${I()}`, {
        summary: `Load operator ${label} note ${Date.now()}`, category: "other",
        location: { type: "Point", coordinates: [-124.16 + Math.random() * 0.1, 40.75 + Math.random() * 0.1] },
      });
      recordId = created?.id ?? null;
      if (recordId) {
        syncFieldReports(index % FIELD_SHARE === 0);
        later(jitter(EDIT_MS), edit);
      }
      socket("/notifications/stream", (ws, message) => {
        if (message.type === "changed") void call("read", "GET", "/notifications").then(() => { counts.notificationRefetches += 1; });
      });
      later(jitter(SCREEN_MS), visit);
      later(jitter(WRITE_MS), write);
      later(RENEW_MS, renew);
    }

    return {
      start,
      close() {
        for (const timer of timers) clearTimeout(timer);
        for (const ws of sockets) ws.close();
        agent.destroy();
      },
    };
  }

  // People arrive over the first three minutes, as an activation fills a room.
  const crowd = people.map((_, index) => person(index));
  const runStarted = Date.now();
  runStartedAt = runStarted;
  const arrival = (3 * 60_000) / USERS;
  for (const member of crowd) {
    void member.start();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, arrival));
  }

  // Once a minute: the server's own memory and connection gauges, and this window's latencies.
  function metrics() {
    return new Promise((resolvePromise) => {
      const call = httpGetRequest({ host: "127.0.0.1", port: host.httpPort, path: "/api/v1/metrics", headers: { authorization: `Bearer ${metricsToken}` }, timeout: 10_000 }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
      });
      call.on("error", () => resolvePromise(""));
      call.on("timeout", () => call.destroy(new Error("timeout")));
      call.end();
    });
  }
  const gauge = (text, name, labels = "") => {
    const line = text.split("\n").find((entry) => entry.startsWith(`${name}${labels} `));
    return line ? Number(line.slice(line.lastIndexOf(" ") + 1)) : null;
  };
  writeFileSync(samplesPath, "");
  const samples = [];
  // The generator's own event-loop delay: a busy generator delays every time it takes, so it is sampled too.
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const sample = async () => {
    const text = await metrics();
    const current = window;
    window = measures();
    const row = {
      minute: Math.round((Date.now() - runStarted) / 60_000),
      at: new Date().toISOString(),
      rssBytes: gauge(text, "openeoc_process_memory_bytes", '{kind="rss"}'),
      heapUsedBytes: gauge(text, "openeoc_process_memory_bytes", '{kind="heap_used"}'),
      sockets: gauge(text, "openeoc_websocket_connections"),
      syncDocs: gauge(text, "openeoc_sync_docs"),
      reads: current.reads.count, readP50Ms: current.reads.quantile(0.5), readP95Ms: current.reads.quantile(0.95), readMaxMs: current.reads.max,
      writes: current.writes.count, writeP50Ms: current.writes.quantile(0.5), writeP95Ms: current.writes.quantile(0.95), writeMaxMs: current.writes.max,
      liveDeliveries: current.live.count, liveP50Ms: current.live.quantile(0.5), liveP95Ms: current.live.quantile(0.95), liveMaxMs: current.live.max,
      errors: current.errors,
      generatorDelayP99Ms: Math.round(loopDelay.percentile(99) / 1e6),
    };
    loopDelay.reset();
    samples.push(row);
    appendFileSync(samplesPath, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
  };
  const sampler = setInterval(() => void sample(), SAMPLE_MS);
  // The run ends at its length, or early when an operator leaves a STOP file in
  // the output folder; a run stopped early does not pass.
  const stopFile = resolve(out, "STOP");
  rmSync(stopFile, { force: true });
  while (Date.now() - runStarted < MINUTES * 60_000 && !existsSync(stopFile)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  const stoppedAt = existsSync(stopFile) ? Math.round((Date.now() - runStarted) / 60_000) : null;
  clearInterval(sampler);
  await sample();
  stopping = true;
  for (const member of crowd) member.close();

  const median = (values) => {
    const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const settled = samples.filter((row) => row.minute > WARMUP_MINUTES);
  const fifth = Math.max(1, Math.floor(settled.length / 5));
  const heapFirst = median(settled.slice(0, fifth).map((row) => row.heapUsedBytes));
  const heapLast = median(settled.slice(-fifth).map((row) => row.heapUsedBytes));
  const rssFirst = median(settled.slice(0, fifth).map((row) => row.rssBytes));
  const rssLast = median(settled.slice(-fifth).map((row) => row.rssBytes));
  const heapGrowth = heapFirst ? (heapLast - heapFirst) / heapFirst : null;
  const rssGrowth = rssFirst ? (rssLast - rssFirst) / rssFirst : null;
  const outcome = {
    errors: total.errors,
    readP95Ms: total.reads.quantile(0.95),
    writeP95Ms: total.writes.quantile(0.95),
    liveP95Ms: total.live.quantile(0.95),
    heapGrowth,
  };
  const checks = [
    ["Errors (failed requests, socket errors, dropped sockets)", `${THRESHOLDS.errors}`, `${outcome.errors}`, outcome.errors <= THRESHOLDS.errors],
    ["Reads, 95th percentile", `under ${THRESHOLDS.readP95Ms} ms`, `${outcome.readP95Ms} ms`, outcome.readP95Ms !== null && outcome.readP95Ms < THRESHOLDS.readP95Ms],
    ["Writes, 95th percentile", `under ${THRESHOLDS.writeP95Ms} ms`, `${outcome.writeP95Ms} ms`, outcome.writeP95Ms !== null && outcome.writeP95Ms < THRESHOLDS.writeP95Ms],
    ["A live edit reaching the other people, 95th percentile", `under ${THRESHOLDS.liveP95Ms} ms`, `${outcome.liveP95Ms} ms`, outcome.liveP95Ms !== null && outcome.liveP95Ms < THRESHOLDS.liveP95Ms],
    [`Server heap growth after a ${WARMUP_MINUTES}-minute warm-up`, `under ${THRESHOLDS.heapGrowth * 100}%`, heapGrowth === null ? "not measured" : `${(heapGrowth * 100).toFixed(1)}%`, heapGrowth !== null && heapGrowth < THRESHOLDS.heapGrowth],
  ];
  const passed = checks.every((check) => check[3]) && counts.signIns === USERS && stoppedAt === null;
  const mb = (bytes) => bytes === null ? "n/a" : (bytes / 1_048_576).toFixed(0);
  const cpu = cpus();
  const commit = git(["rev-parse", "--short", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]) ? " with uncommitted changes" : "";
  const lines = [
    `# Load test: ${USERS} people on one incident`,
    "",
    `Run ${started.toISOString()} for ${MINUTES} minutes, from commit \`${commit}\`${dirty}.`,
    `Result: **${passed ? "PASS" : "FAIL"}**, every threshold below${passed ? " met" : " recorded; at least one failed"}.`,
    ...(stoppedAt === null ? [] : [`Stopped by the operator at minute ${stoppedAt} of ${MINUTES}, so the run did not complete its length.`]),
    "Written by `deploy/windows/prove-load.mjs`; the minute-by-minute samples are in `LOAD-TEST-SAMPLES.jsonl`.",
    "",
    "## What ran",
    "",
    "- **Host:** the network host profile with the North Coast Storm demo (`host-demo`), started exactly as its generated service definitions say: PostgreSQL from the host settings file, the server with its delivery queue and scheduler, and Caddy serving HTTPS with the host's own certificate authority. It ran as this user on the loopback address with spare ports; installing the services and the firewall rule is the setup program's part and changes nothing measured here.",
    `- **Machine:** ${cpu[0]?.model?.trim() ?? "unknown CPU"}, ${cpu.length} logical processors, ${(totalmem() / 1_073_741_824).toFixed(0)} GB memory, Windows ${Number(release().split(".")[2]) >= 22000 ? "11" : "10"} (${release()}), Node ${process.version}.`,
    "- **Load generator:** on the same machine as the host, so it competes with the server for the processor and the result understates what a dedicated host does.",
    `- **People:** ${USERS} synthetic accounts added as members of Humboldt County OES, the incident's owning organization. Each signs in with its own password session and connects from its own loopback address (127.0.0.2 to 127.0.0.${USERS + 1}), so the server's per-address flood and sign-in limits see ${USERS} separate clients, as on a network. People arrive over the first three minutes.`,
    "- **What each person does, for the whole run:**",
    `  - holds two live sockets through HTTPS: the incident's Field Reports board sync, and the notification stream (refetching the inbox when told something changed);`,
    `  - visits a screen about every ${SCREEN_MS / 1000} seconds (15 to 45), each visit firing that screen's reads together as the console does: the overview (summary, activity, lifelines, incident list, inbox) three times in eleven, the map (four board layers and the impact analysis) twice, Field Reports twice, Shelters, resource requests, threads and messages, and lifelines with the ESF grid once each;`,
    `  - edits their own field report's summary about every ${EDIT_MS / 1000} seconds over REST, as the console does; the server folds the edit into the board's live document and every other person receives it on their socket;`,
    `  - one person in ${FIELD_SHARE} is a field user whose queued offline edit syncs over the board socket about every ${FIELD_SYNC_MS / 60_000} minutes (2.5 to 7.5), as the field client does, sending the whole document with an operation id;`,
    `  - makes another REST write about every ${WRITE_MS / 60_000} minutes (1 to 3): posting in the Road status thread, submitting a resource request, or moving one of their requests to its next stage;`,
    "  - renews the session every ten minutes, and, like the web client, renews and retries once when a request meets a refused access token.",
    "- **Measured:** every request's time from send to full response at the client, reads and writes apart (sign-in, renewals and field sync acknowledgements count as writes); for each edit, the time from the sender's send to each other person's receipt on the live socket; the server's heap and resident memory from its metrics endpoint once a minute.",
    "",
    "## Thresholds",
    "",
    "| Measure | Threshold | Result | |",
    "|---|---|---|---|",
    ...checks.map(([measure, threshold, value, ok]) => `| ${measure} | ${threshold} | ${value} | ${ok ? "pass" : "**fail**"} |`),
    `| Everyone signed in | ${USERS} | ${counts.signIns} | ${counts.signIns === USERS ? "pass" : "**fail**"} |`,
    "",
    "## Volumes and other percentiles",
    "",
    "| | Count | 50th | 95th | 99th | Longest |",
    "|---|---|---|---|---|---|",
    ...[["Reads", total.reads], ["Writes", total.writes], ["Live edit deliveries", total.live]].map(([name, histogram]) =>
      `| ${name} | ${histogram.count} | ${histogram.quantile(0.5)} ms | ${histogram.quantile(0.95)} ms | ${histogram.quantile(0.99)} ms | ${histogram.max} ms |`),
    "",
    `Sign-ins ${counts.signIns}, session renewals ${counts.renewals} (${counts.retriedAfterRenewal} requests sent with the access token a renewal had just replaced, renewed and retried once as the web client does), screen visits ${counts.screens}, REST record edits ${counts.restEdits}, field syncs acknowledged ${counts.fieldSyncs}, thread messages ${counts.messages}, resource requests submitted ${counts.requestsSubmitted} and moved on ${counts.requestMoves} times, inbox refetches on a notification signal ${counts.notificationRefetches}.`,
    "",
    `Server memory after warm-up (median of the first and last fifth of the settled samples): heap ${mb(heapFirst)} MB to ${mb(heapLast)} MB, resident ${mb(rssFirst)} MB to ${mb(rssLast)} MB${rssGrowth === null ? "" : ` (${(rssGrowth * 100).toFixed(1)}%)`}.`,
    "",
    "## Reads by route",
    "",
    `The 95th percentile of each read route in the 20 minutes after the warm-up (minutes ${WARMUP_MINUTES} to ${WARMUP_MINUTES + 20}) and in the run's last 20 minutes (${MINUTES - 20} to ${MINUTES}), most read first.`,
    "",
    "| Route | Reads | 95th, after warm-up | 95th, last 20 minutes |",
    "|---|---|---|---|",
    ...[...routes].sort((a, b) => b[1].count - a[1].count).map(([route, entry]) =>
      `| \`GET ${route}\` | ${entry.count} | ${entry.early.quantile(0.95) ?? "n/a"} ms | ${entry.late.quantile(0.95) ?? "n/a"} ms |`),
    "",
    "## Every ten minutes",
    "",
    "| Minute | Heap MB | Resident MB | Sockets | Reads | Read 95th | Writes | Write 95th | Live 95th | Errors | Generator delay 99th |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...samples.filter((row, index) => row.minute % 10 === 0 || index === samples.length - 1).map((row) =>
      `| ${row.minute} | ${mb(row.heapUsedBytes)} | ${mb(row.rssBytes)} | ${row.sockets ?? "n/a"} | ${row.reads} | ${row.readP95Ms ?? "n/a"} ms | ${row.writes} | ${row.writeP95Ms ?? "n/a"} ms | ${row.liveP95Ms ?? "n/a"} ms | ${row.errors} | ${row.generatorDelayP99Ms} ms |`),
    "",
    "## Errors",
    "",
    ...(errorKinds.size === 0 ? ["None."] : [...errorKinds].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `- ${kind}: ${count}`)),
    "",
  ];
  writeFileSync(reportPath, lines.join("\n"));
  Object.assign(result, { status: passed ? "passed" : "failed", outcome, counts, errors: Object.fromEntries(errorKinds) });
  if (!passed) process.exitCode = 1;
} catch (error) {
  result.status = "failed";
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  stopping = true;
  // A host that fails to stop is recorded; the report and result are still written.
  if (host) await host.stop().catch((error) => { result.stopError = String(error?.message ?? error); });
  result.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "passed") rmSync(dataRoot, { recursive: true, force: true });
}
