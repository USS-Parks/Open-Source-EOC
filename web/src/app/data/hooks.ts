import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, SessionExpiredError, type RawNotification } from "../api/client.js";

/**
 * Small data-fetching helpers. `useAsync` runs a promise when its deps
 * change and exposes {data, error, loading, reload}. `usePolled` adds a
 * background refresh for the surfaces that should feel live: it keeps the
 * last data on screen while it refreshes, pauses while the page is hidden
 * and backs off after failures. `useNotifications` refetches the inbox when
 * the server pushes a change. All cancel cleanly on unmount so a late
 * response never writes into a gone component.
 */

export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/**
 * useAsync plus `refresh`, which reads again without raising `loading`, so
 * the last data stays on screen, and rejects when the read fails.
 */
function useRefreshable<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> & { readonly refresh: () => Promise<void> } {
  const [result, setResult] = useState<{ deps: readonly unknown[]; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // Each read takes the next number; only the newest may write, so a late
  // answer never overwrites a newer one or lands after unmount.
  const latest = useRef(0);
  const read = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    const load = async () => {
      const id = ++latest.current;
      try {
        const value = await fn();
        if (id !== latest.current) return;
        setResult({ deps: [...deps], data: value });
        setError(null);
      } catch (err: unknown) {
        if (id === latest.current) {
          if (
            err instanceof SessionExpiredError ||
            (err instanceof ApiError && [401, 403, 404].includes(err.status))
          )
            setResult(null);
          setError(err instanceof Error ? err.message : String(err));
        }
        throw err;
      } finally {
        if (id === latest.current) setLoading(false);
      }
    };
    read.current = load;
    setLoading(true);
    load().catch(() => undefined);
    return () => {
      latest.current += 1;
      read.current = () => Promise.resolve();
    };
  }, [...deps, nonce]);

  const refresh = useCallback(() => read.current(), []);
  return { data: result && sameDeps(result.deps, deps) ? result.data : null, error, loading, reload, refresh };
}

export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const { data, error, loading, reload } = useRefreshable(fn, deps);
  return { data, error, loading, reload };
}

/** The longest wait between polls after repeated failures. */
const POLL_BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Runs `tick` every `intervalMs` while the page is visible. A failed tick
 * doubles the wait, up to five minutes, and the next good one restores it.
 * A hidden page stops polling; when it shows again a tick runs at once.
 * Returns the function that stops polling.
 */
export function pollWhileVisible(tick: () => Promise<unknown>, intervalMs: number): () => void {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  const hidden = () => document.visibilityState === "hidden";
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || hidden()) return;
    const wait = Math.min(Math.max(POLL_BACKOFF_MAX_MS, intervalMs), intervalMs * 2 ** failures);
    timer = setTimeout(() => void run(), wait);
  };
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await tick();
      failures = 0;
    } catch {
      failures += 1;
    }
    running = false;
    schedule();
  };
  const onVisibility = () => {
    if (hidden()) clearTimeout(timer);
    else void run();
  };
  document.addEventListener("visibilitychange", onVisibility);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * useAsync that also refreshes in the background, as pollWhileVisible
 * describes. A null interval reads once, like useAsync.
 */
export function usePolled<T>(
  fn: () => Promise<T>,
  intervalMs: number | null,
  deps: readonly unknown[],
): AsyncState<T> {
  const { refresh, ...state } = useRefreshable(fn, deps);
  useEffect(() => (intervalMs === null ? undefined : pollWhileVisible(refresh, intervalMs)), [refresh, intervalMs]);
  return state;
}

/** Longest wait between reconnect attempts, and so the slowest fallback refetch. */
const STREAM_RETRY_MAX_MS = 60_000;

/**
 * The newest page of the notification inbox, refetched whenever the server
 * signals a change on the notification stream. The signal carries no content;
 * the refetch goes through the REST inbox. While the socket is down each
 * reconnect attempt, backing off to once a minute, also refetches when the
 * page is visible, which catches anything missed and renews an expired token
 * through the REST path before the next attempt. `live` is true while the
 * stream is subscribed.
 */
export function useNotifications(client: {
  notifications(): Promise<RawNotification[]>;
  fieldSyncToken(): string;
}): AsyncState<RawNotification[]> & { readonly live: boolean } {
  const state = useAsync(() => client.notifications(), [client]);
  const { reload } = state;
  const [live, setLive] = useState(false);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;
    const later = () => {
      failures += 1;
      retry = setTimeout(connect, Math.min(STREAM_RETRY_MAX_MS, 1000 * 2 ** failures));
    };
    function connect() {
      let token: string;
      try {
        token = client.fieldSyncToken();
      } catch {
        return later(); // signed out: nothing to refetch until a session returns
      }
      const url = new URL("/api/v1/notifications/stream", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
      ws.onmessage = (event: MessageEvent) => {
        const { type } = JSON.parse(String(event.data)) as { type?: string };
        if (type === "ready") {
          failures = 0;
          setLive(true);
        }
        if (type === "ready" || type === "changed") reload();
      };
      ws.onclose = () => {
        if (stopped) return;
        setLive(false);
        if (document.visibilityState !== "hidden") reload();
        later();
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [client, reload]);
  return { ...state, live };
}
