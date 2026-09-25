/**
 * Service worker registration and the update hand-off. Safe to call
 * unconditionally: it no-ops where service workers are unavailable (older
 * browsers, or a non-secure origin), so the client still runs, just without
 * the installable shell and the offline start.
 *
 * A new build installs as a waiting worker. The shell shows the update notice
 * while one waits; applyUpdate() lets it take over and reloads once it does.
 */

const UPDATE_CHECK_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

export function updateWaiting(): boolean {
  return waiting !== null;
}

export function onUpdateWaiting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyUpdate(): void {
  if (!waiting) return;
  // Another tab may already have switched this worker on; then only a reload is left.
  if (waiting.state !== "installed") return location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
}

function watch(worker: ServiceWorker | null): void {
  if (!worker) return;
  const check = () => {
    // With no controller this is the first install, not an update.
    if (worker.state !== "installed" || !navigator.serviceWorker.controller) return;
    waiting = worker;
    for (const listener of listeners) listener();
  };
  check();
  worker.addEventListener("statechange", check);
}

export async function registerFieldWorker(
  path = `${import.meta.env.BASE_URL}sw.js`,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  // Ask the browser not to evict this origin's storage, which holds the
  // offline outbox. Browsers decide on their own; nothing waits on it.
  void navigator.storage?.persist?.().catch(() => false);
  try {
    const registration = await navigator.serviceWorker.register(path);
    watch(registration.waiting);
    watch(registration.installing);
    registration.addEventListener("updatefound", () => watch(registration.installing));
    // The first install leaves the map files until the worker takes over;
    // this copies whatever the precache still lacks, on every start.
    void navigator.serviceWorker.ready.then((ready) => ready.active?.postMessage({ type: "COMPLETE_PRECACHE" }));
    // A console left open through a shift still learns of a new build.
    setInterval(() => void registration.update().catch(() => undefined), UPDATE_CHECK_MS);
    return registration;
  } catch {
    // Registration failure must never block the app from loading.
    return null;
  }
}
