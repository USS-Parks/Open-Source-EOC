#!/usr/bin/env node
// Synthetic activation soak. Run it against a live server to see whether the
// server's memory stays flat over hours of realistic use: many held board
// sync sockets editing their own records, periodic reads, and socket churn
// that makes the sync hub drop and reload board documents.
//
// Usage:
//   node scripts/soak.mjs --url http://HOST:8080 --email member@... \
//     --password '...' --boards ID1,ID2 --metrics-token TOKEN \
//     [--users 150] [--minutes 120] [--edit-ms 30000] [--read-ms 30000] \
//     [--churn-ms 300000] [--sample-ms 60000] [--out soak.jsonl]
//
// Sign in as a member: administrators must pass a second factor. Every
// --sample-ms it reads the metrics endpoint and appends one JSON line with
// resident and heap memory, open sockets, held documents, and the edit
// round-trip latency of that window. At the end it compares the median heap of
// the first and last fifth after a ten-minute warm-up and exits non-zero when
// the growth is over --max-growth (default 0.10).
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { clearInterval, setInterval } from "node:timers";

const Y = createRequire(new URL("../server/package.json", import.meta.url))("yjs");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (i % 2 === 0) pairs.push([value.replace(/^--/, ""), all[i + 1]]);
    return pairs;
  }, []),
);
const base = args.url;
const wsBase = base.replace(/^http/, "ws");
const boards = String(args.boards ?? "").split(",").filter(Boolean);
const users = Number(args.users ?? 150);
const minutes = Number(args.minutes ?? 120);
const editMs = Number(args["edit-ms"] ?? 30_000);
const readMs = Number(args["read-ms"] ?? 30_000);
const churnMs = Number(args["churn-ms"] ?? 300_000);
const sampleMs = Number(args["sample-ms"] ?? 60_000);
const maxGrowth = Number(args["max-growth"] ?? 0.1);
const out = args.out ?? null;
if (!base || boards.length === 0 || !args["metrics-token"]) {
  console.error("usage: see the header of scripts/soak.mjs");
  process.exit(2);
}

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: args.email, password: args.password }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const token = (await login.json()).accessToken;
const auth = { authorization: `Bearer ${token}` };

let window = [];
let errors = 0;
let stopping = false;
const jitter = (ms) => ms / 2 + Math.random() * ms;

/** One simulated operator: a socket on a board, editing one record of their own. */
function operator(index) {
  const board = boards[index % boards.length];
  const recordKey = `${randomUUID()}/entry`;
  const doc = new Y.Doc();
  let socket = null;
  let sentAt = 0;
  let editTimer = null;

  const edit = () => {
    if (stopping || !socket || socket.readyState !== WebSocket.OPEN) return;
    const before = Y.encodeStateVector(doc);
    doc.getMap("records").set(recordKey, `operator ${index} at ${new Date().toISOString()}`);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString("base64");
    sentAt = performance.now();
    socket.send(JSON.stringify({ type: "update", update }));
    editTimer = setTimeout(edit, jitter(editMs));
  };

  const connect = () => {
    if (stopping) return;
    socket = new WebSocket(`${wsBase}/api/v1/sync/boards/${board}`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "state") {
        Y.applyUpdate(doc, Buffer.from(message.update, "base64"));
        clearTimeout(editTimer);
        editTimer = setTimeout(edit, jitter(editMs));
      } else if (message.type === "update") {
        Y.applyUpdate(doc, Buffer.from(message.update, "base64"));
      } else if (message.type === "synced" && sentAt) {
        window.push(performance.now() - sentAt);
        sentAt = 0;
      } else if (message.type === "error") {
        errors += 1;
      }
    };
    socket.onerror = () => { errors += 1; };
    socket.onclose = () => {
      clearTimeout(editTimer);
      if (!stopping) setTimeout(connect, 1000);
    };
  };

  const read = async () => {
    if (stopping) return;
    const paths = ["/api/v1/me", "/api/v1/notifications", `/api/v1/boards/${board}/views/all`];
    try {
      const res = await fetch(`${base}${paths[Math.floor(Math.random() * paths.length)]}`, { headers: auth });
      if (!res.ok && res.status !== 404) errors += 1;
      await res.arrayBuffer();
    } catch {
      errors += 1;
    }
    setTimeout(read, jitter(readMs));
  };

  connect();
  setTimeout(read, jitter(readMs));
  return { drop: () => socket?.close(), close: () => { clearTimeout(editTimer); socket?.close(); } };
}

function gauge(text, name, labels = "") {
  const line = text.split("\n").find((l) => l.startsWith(`${name}${labels} `));
  return line ? Number(line.slice(line.lastIndexOf(" ") + 1)) : null;
}

const operators = [];
for (let i = 0; i < users; i += 1) {
  operators.push(operator(i));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const churn = setInterval(() => {
  // Drop a tenth of the sockets; each reconnects a second later.
  for (const op of [...operators].sort(() => Math.random() - 0.5).slice(0, Math.ceil(users / 10))) op.drop();
}, churnMs);

const started = Date.now();
const samples = [];
const sample = async () => {
  const res = await fetch(`${base}/api/v1/metrics`, {
    headers: { authorization: `Bearer ${args["metrics-token"]}` },
  });
  const text = await res.text();
  const latencies = window.sort((a, b) => a - b);
  window = [];
  const row = {
    minute: Math.round((Date.now() - started) / 60_000),
    rss: gauge(text, "openeoc_process_memory_bytes", '{kind="rss"}'),
    heapUsed: gauge(text, "openeoc_process_memory_bytes", '{kind="heap_used"}'),
    sockets: gauge(text, "openeoc_websocket_connections"),
    docs: gauge(text, "openeoc_sync_docs"),
    edits: latencies.length,
    editP95Ms: latencies.length ? Math.round(latencies[Math.floor(latencies.length * 0.95)]) : null,
    editMaxMs: latencies.length ? Math.round(latencies[latencies.length - 1]) : null,
    errors,
  };
  samples.push(row);
  console.log(JSON.stringify(row));
  if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
};
const sampler = setInterval(() => void sample().catch(() => { errors += 1; }), sampleMs);

await new Promise((resolve) => setTimeout(resolve, minutes * 60_000));
stopping = true;
clearInterval(churn);
clearInterval(sampler);
for (const op of operators) op.close();

const median = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const settled = samples.filter((s) => s.minute >= 10);
const fifth = Math.max(1, Math.floor(settled.length / 5));
const first = median(settled.slice(0, fifth).map((s) => s.heapUsed));
const last = median(settled.slice(-fifth).map((s) => s.heapUsed));
const growth = first ? (last - first) / first : 0;
const summary = { samples: samples.length, firstHeapMedian: first, lastHeapMedian: last, growth, errors };
console.log(`[soak] ${JSON.stringify(summary)}`);
if (out) appendFileSync(out, `${JSON.stringify({ summary })}\n`);
process.exit(growth > maxGrowth ? 1 : 0);
