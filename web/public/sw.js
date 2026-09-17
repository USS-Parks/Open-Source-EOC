/*
 * Field client service worker (VEOC-21). The app shell is cache-first so
 * the client boots with no network; navigations fall back to the cached
 * shell offline (INV-3). API calls are never cached here: offline writes
 * go through the durable outbox and reconcile on reconnect, so a stale
 * cached response must never stand in for the live data.
 */
const SHELL_CACHE = "openeoc-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // API traffic is live-or-nothing: pass straight through, never cache.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, cached shell as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Static assets: cache first, then network, caching what comes back.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && request.method === "GET") {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
