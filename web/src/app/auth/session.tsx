import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, type Me, type Tokens } from "../api/client.js";

/**
 * Session state for the shell. The token pair is persisted per-viewer in
 * localStorage (guarded: private mode or blocked storage degrades to a
 * login-each-time session, never a crash). On mount, a saved session is
 * revived by renewing the access token and reading /me; a failure there is
 * a clean fall back to anonymous, not an error screen.
 */

const STORAGE_KEY = "openeoc.tokens";

function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.accessToken === "string" && typeof parsed.resumeToken === "string")
      return { accessToken: parsed.accessToken, resumeToken: parsed.resumeToken };
  } catch {
    // Unreadable or blocked storage: treat as no saved session.
  }
  return null;
}

function saveTokens(tokens: Tokens | null): void {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A viewer with storage disabled simply keeps the session in memory.
  }
}

export type SessionStatus = "loading" | "anon" | "authed";

export interface SessionValue {
  readonly status: SessionStatus;
  readonly me: Me | null;
  readonly client: ApiClient;
  readonly jurisdictionId: string | null;
  readonly role: string | null;
  readonly error: string | null;
  readonly setJurisdiction: (id: string) => void;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within <SessionProvider>");
  return value;
}

export function SessionProvider(props: { client?: ApiClient; children: ReactNode }) {
  const clientRef = useRef<ApiClient | null>(props.client ?? null);
  if (!clientRef.current) clientRef.current = new ApiClient({ onTokens: saveTokens });
  const client = clientRef.current;

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const saved = loadTokens();
    if (!saved) {
      setStatus("anon");
      return;
    }
    client.setTokens(saved);
    client
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setJurisdictionId((cur) => cur ?? m.memberships[0]?.jurisdictionId ?? null);
        setStatus("authed");
      })
      .catch(() => {
        if (cancelled) return;
        client.clearTokens();
        setStatus("anon");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      client,
      jurisdictionId,
      role:
        me && jurisdictionId
          ? (me.memberships.find((x) => x.jurisdictionId === jurisdictionId)?.role ?? null)
          : null,
      error,
      setJurisdiction: (id: string) => setJurisdictionId(id),
      login: async (email: string, password: string) => {
        setError(null);
        try {
          await client.login(email, password);
          const m = await client.me();
          setMe(m);
          setJurisdictionId((cur) => cur ?? m.memberships[0]?.jurisdictionId ?? null);
          setStatus("authed");
        } catch (e) {
          client.clearTokens();
          setStatus("anon");
          setError(e instanceof Error ? e.message : "login failed");
          throw e;
        }
      },
      logout: async () => {
        try {
          await client.logout();
        } finally {
          setMe(null);
          setJurisdictionId(null);
          setStatus("anon");
        }
      },
    }),
    [status, me, jurisdictionId, error, client],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
