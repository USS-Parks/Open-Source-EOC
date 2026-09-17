/**
 * Service worker registration (VEOC-21). Safe to call unconditionally:
 * it no-ops where service workers are unavailable (older browsers, or a
 * non-secure origin), so the client still runs, just without the
 * installable-shell affordance.
 */
export async function registerFieldWorker(
  path = "/sw.js",
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(path, { scope: "/" });
  } catch {
    // Registration failure must never block the app from loading.
    return null;
  }
}
