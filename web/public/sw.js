/* global Headers, Response, navigator */
/*
 * Service worker for the installed web app. The production build writes this
 * file into the bundle with PRECACHE filled in (web/src/offline/precache-plugin.ts),
 * so every build that changes a file is a new worker. A new worker waits
 * until the operator chooses Reload in the shell's update notice.
 *
 * - The precache holds this build's shell, every code-split chunk, the
 *   manifest and icons, the map glyphs, the NAPSG symbols and the bundled
 *   basemap. It is served cache first. On the first install the map files,
 *   most of the bytes, are copied after the worker takes over, so a reload
 *   without a connection opens the console as soon as its own files are in.
 * - Navigations go to the network first; the cached shell answers offline.
 * - API calls and WebSocket streams are never cached. The app keeps offline
 *   work in its own IndexedDB outbox, so a stored response must never stand
 *   in for live data.
 * - Range requests pass straight through, so the large PMTiles archives are
 *   read from the server exactly as before. The one exception is the bundled
 *   basemap, which is precached whole: when the network fails, its ranges are
 *   answered from that copy with the exact bytes asked for.
 * - Other same-origin files the map asks for, such as tiles from a
 *   self-hosted tile server, go to the network first and are kept in a
 *   runtime cache for offline use, within RUNTIME_BUDGET_BYTES.
 */
const PRECACHE = { version: "unbuilt", files: [] };

// 50 MB holds about two thousand 25 kB map tiles, a shift of panning over an
// operating area, while leaving most of a phone's storage to the offline
// outbox. Oldest entries leave first.
const RUNTIME_BUDGET_BYTES = 50 * 1024 * 1024;
// Past this share of the origin's quota nothing new is cached at runtime.
const QUOTA_CEILING = 0.9;
const SIZE_HEADER = "x-openeoc-bytes";
const PRECACHE_NAME = `openeoc-precache-${PRECACHE.version}`;
const RUNTIME_NAME = "openeoc-runtime";
const precached = new Set(PRECACHE.files.map((file) => new URL(file, self.location.href).href));
const shellUrl = new URL("index.html", self.location.href).href;
const MAP_FILES = /\/(fonts|napsg|basemap)\//;

/** Copy every listed file not yet in the precache, one at a time, so it never crowds out the console's own requests. */
async function fillPrecache(skip = () => false) {
  const cache = await caches.open(PRECACHE_NAME);
  const held = new Set((await cache.keys()).map((request) => request.url));
  for (const url of precached) if (!held.has(url) && !skip(url)) await cache.add(url);
}

self.addEventListener("install", (event) => {
  // An update copies everything before it can take over; the first install
  // leaves the map files to the page's COMPLETE_PRECACHE message.
  const first = !self.registration.active;
  event.waitUntil(fillPrecache((url) => first && MAP_FILES.test(url)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys())
      if (key !== PRECACHE_NAME && key !== RUNTIME_NAME) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "COMPLETE_PRECACHE") event.waitUntil(fillPrecache());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.headers.has("range")) {
    if (precached.has(url.href)) event.respondWith(fetch(request).catch(() => cachedRange(request)));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(shellUrl, { cacheName: PRECACHE_NAME })) ?? Response.error()));
    return;
  }
  if (precached.has(url.href)) {
    event.respondWith(caches.match(url.href, { cacheName: PRECACHE_NAME }).then((cached) => cached ?? fetch(request)));
    return;
  }
  event.respondWith(networkFirst(event, request));
});

async function networkFirst(event, request) {
  try {
    const response = await fetch(request);
    const noStore = /no-store/i.test(response.headers.get("cache-control") ?? "");
    if (response.status === 200 && response.type === "basic" && !noStore)
      event.waitUntil(remember(request.url, response.clone()));
    return response;
  } catch (error) {
    const cached = await caches.match(request.url, { cacheName: RUNTIME_NAME });
    if (cached) return cached;
    throw error;
  }
}

/** Answer a byte range of a precached file, as the server would. */
async function cachedRange(request) {
  const cached = await caches.match(request.url, { cacheName: PRECACHE_NAME });
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!cached || !match) return Response.error();
  const body = await cached.blob();
  const start = Number(match[1]);
  const end = Math.min(match[2] === "" ? body.size - 1 : Number(match[2]), body.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${body.size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": cached.headers.get("content-type") ?? "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${body.size}`,
      "content-length": String(end - start + 1),
    },
  });
}

// URL to stored size in bytes, oldest first, mirroring the runtime cache.
// Rebuilt from the cache once each time the browser starts this worker.
let runtimeIndex;

async function remember(url, response) {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota && (estimate.usage ?? 0) / estimate.quota >= QUOTA_CEILING) return;
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(SIZE_HEADER, String(body.size));
  const cache = await caches.open(RUNTIME_NAME);
  await cache.put(url, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  runtimeIndex ??= readIndex(cache);
  const index = await runtimeIndex;
  index.delete(url);
  index.set(url, body.size);
  for (const old of overBudget(index, RUNTIME_BUDGET_BYTES)) {
    index.delete(old);
    await cache.delete(old);
  }
}

async function readIndex(cache) {
  const index = new Map();
  for (const request of await cache.keys()) {
    const cached = await cache.match(request);
    index.set(request.url, Number(cached?.headers.get(SIZE_HEADER)) || 0);
  }
  return index;
}

/** The oldest entries to drop so the rest fit within the budget. */
function overBudget(index, budget) {
  let total = 0;
  for (const bytes of index.values()) total += bytes;
  const drop = [];
  for (const [url, bytes] of index) {
    if (total <= budget) break;
    drop.push(url);
    total -= bytes;
  }
  return drop;
}
