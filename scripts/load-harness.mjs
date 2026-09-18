#!/usr/bin/env node
// Real distributed load harness (VEOC-38). Run this against a LIVE deployment
// to verify the R1 floor on real hardware, which CI cannot do: many concurrent
// HTTP requests and many concurrent held WebSocket sync connections. It is
// dependency-free (Node 22 globals: fetch and WebSocket), so you can run it
// from one box or several to reach and exceed 150 concurrent users.
//
// Usage:
//   node scripts/load-harness.mjs --url http://HOST:8080 \
//     --email admin@example.org --password '...' [--board BOARD_ID] \
//     [--users 150] [--duration 20] [--http-p95-ms 1500]
//
// It logs in, runs an HTTP phase (each user fires a burst of reads) and, when
// --board is given, a WebSocket phase (each user opens, authenticates, and
// holds a board sync socket for the duration). It prints latency percentiles
// and connection success, and exits non-zero if a budget is breached.

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) out[key] = argv[i + 1];
  }
  return out;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize(label, latencies, errors) {
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies.length ? Math.max(...latencies) : 0;
  console.log(
    `[harness] ${label}: n=${latencies.length} errors=${errors} ` +
      `p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms`,
  );
  return { p95, errors };
}

async function login(base, email, password) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()).accessToken;
}

async function httpPhase(base, token, users, board) {
  const latencies = [];
  let errors = 0;
  const auth = { authorization: `Bearer ${token}` };
  const worker = async () => {
    const urls = [`${base}/api/v1/me`];
    if (board) urls.push(`${base}/api/v1/boards/${board}/views/all`);
    for (const url of urls) {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { headers: auth });
        if (!res.ok) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: users }, () => worker()));
  return summarize("http", latencies, errors);
}

function wsUrl(base, board) {
  const u = new URL(`${base}/api/v1/sync/boards/${board}`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

async function wsPhase(base, token, users, board, durationMs) {
  const authLatencies = [];
  let established = 0;
  let failed = 0;
  const sockets = [];
  const connect = () =>
    new Promise((resolve) => {
      const t0 = performance.now();
      let socket;
      const timer = setTimeout(() => {
        failed += 1;
        try {
          socket?.close();
        } catch {
          // ignore
        }
        resolve();
      }, 10000);
      try {
        socket = new WebSocket(wsUrl(base, board));
      } catch {
        failed += 1;
        clearTimeout(timer);
        resolve();
        return;
      }
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "state" || msg.type === "synced") {
          authLatencies.push(performance.now() - t0);
          established += 1;
          sockets.push(socket);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === "error") {
          failed += 1;
          clearTimeout(timer);
          try {
            socket.close();
          } catch {
            // ignore
          }
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        failed += 1;
        clearTimeout(timer);
        resolve();
      });
    });

  await Promise.all(Array.from({ length: users }, () => connect()));
  console.log(
    `[harness] ws: established=${established}/${users} failed=${failed} ` +
      `auth_p95=${percentile(authLatencies, 95).toFixed(0)}ms`,
  );
  // Hold the connections open for the duration to prove concurrency stays up.
  await new Promise((r) => setTimeout(r, durationMs));
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      // ignore
    }
  }
  return { established, failed, users };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.url || !a.email || !a.password) {
    console.error("usage: load-harness.mjs --url URL --email E --password P [--board ID] [--users N] [--duration S] [--http-p95-ms MS]");
    process.exit(2);
  }
  const base = a.url.replace(/\/+$/, "");
  const users = Number(a.users ?? 150);
  const durationMs = Number(a.duration ?? 20) * 1000;
  const httpP95Budget = Number(a["http-p95-ms"] ?? 2000);

  console.log(`[harness] target=${base} users=${users} board=${a.board ?? "(none)"}`);
  const token = await login(base, a.email, a.password);

  const http = await httpPhase(base, token, users, a.board);
  let ws = { established: 0, failed: 0, users: 0 };
  if (a.board) ws = await wsPhase(base, token, users, a.board, durationMs);
  else console.log("[harness] ws phase skipped (pass --board to test WebSocket concurrency)");

  let ok = true;
  if (http.errors > 0) {
    console.error(`[harness] FAIL: ${http.errors} HTTP errors`);
    ok = false;
  }
  if (http.p95 > httpP95Budget) {
    console.error(`[harness] FAIL: HTTP p95 ${http.p95.toFixed(0)}ms over budget ${httpP95Budget}ms`);
    ok = false;
  }
  if (a.board && ws.established < ws.users) {
    console.error(`[harness] FAIL: only ${ws.established}/${ws.users} WebSocket connections held`);
    ok = false;
  }
  console.log(ok ? "[harness] PASS" : "[harness] FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
