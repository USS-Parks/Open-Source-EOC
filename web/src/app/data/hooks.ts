import { useCallback, useEffect, useState } from "react";
import { ApiError, SessionExpiredError } from "../api/client.js";

/**
 * Small data-fetching helpers. `useAsync` runs a promise when its deps
 * change and exposes {data, error, loading, reload}. `usePolled` adds a
 * fixed-interval refresh for the surfaces that should feel live until the
 * WebSocket streams are wired (M2/M4). Both cancel cleanly on unmount so a
 * late response never writes into a gone component.
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
