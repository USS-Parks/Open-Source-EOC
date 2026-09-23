import { useCallback, useEffect, useState } from "react";
import { ApiError, SessionExpiredError, type RawNotification } from "../api/client.js";

/**
 * Small data-fetching helpers. `useAsync` runs a promise when its deps
 * change and exposes {data, error, loading, reload}. `usePolled` adds a
 * fixed-interval refresh for the surfaces that should feel live until the
 * WebSocket streams are wired; `useNotifications` refetches the inbox when
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

export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [result, setResult] = useState<{ deps: readonly unknown[]; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((value) => {
        if (cancelled) return;
        setResult({ deps: [...deps], data: value });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (
          err instanceof SessionExpiredError ||
          (err instanceof ApiError && [401, 403, 404].includes(err.status))
        )
          setResult(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  return { data: result && sameDeps(result.deps, deps) ? result.data : null, error, loading, reload };
}

export function usePolled<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: readonly unknown[],
): AsyncState<T> {
  const state = useAsync(fn, deps);
  const { reload } = state;
  useEffect(() => {
    const timer = setInterval(reload, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);
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
