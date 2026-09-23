import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, type Me, type MfaChallenge, type Tokens } from "../api/client.js";

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
  readonly refreshMe: () => Promise<Me>;
  readonly recoverSession: () => Promise<void>;
  readonly switchPosition: (positionId: string | null) => Promise<void>;
  /** Resolves with a challenge when a second factor is due, else signs in. */
  readonly login: (email: string, password: string) => Promise<MfaChallenge | null>;
  /** Enter the console once the client holds a session from a second-factor step. */
  readonly completeSignIn: () => Promise<void>;
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

  const adoptMe = useCallback((next: Me) => {
    const available = new Set([
      ...next.memberships.map((membership) => membership.jurisdictionId),
      ...next.guests
        .filter((grant) => Date.parse(grant.expiresAt) > Date.now())
        .map((grant) => grant.jurisdictionId),
    ]);
    setMe(next);
    setJurisdictionId((current) => current && available.has(current)
      ? current
      : next.memberships[0]?.jurisdictionId ?? next.guests.find((grant) => available.has(grant.jurisdictionId))?.jurisdictionId ?? null);
  }, []);

  const refreshMe = useCallback(async () => {
    const next = await client.me();
    adoptMe(next);
    return next;
  }, [adoptMe, client]);

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
        adoptMe(m);
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
  }, [adoptMe, client]);

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
      setJurisdiction: (id: string) => {
        const allowed = me?.memberships.some((membership) => membership.jurisdictionId === id)
          || me?.guests.some((grant) => grant.jurisdictionId === id && Date.parse(grant.expiresAt) > Date.now());
        if (allowed) setJurisdictionId(id);
        else setError("That jurisdiction is not available to this session.");
      },
      refreshMe,
      recoverSession: async () => {
        setError(null);
        try {
          await client.resume();
          await refreshMe();
          setStatus("authed");
        } catch (cause) {
          client.clearTokens();
          setMe(null);
          setJurisdictionId(null);
          setStatus("anon");
          setError(cause instanceof Error ? cause.message : "Session recovery failed.");
          throw cause;
        }
      },
      switchPosition: async (positionId: string | null) => {
        setError(null);
        try {
          if (positionId) await client.signInPosition(positionId);
          else await client.signOutPosition();
          await refreshMe();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The acting position could not be changed.");
          throw cause;
        }
      },
      completeSignIn: async () => {
        adoptMe(await client.me());
        setStatus("authed");
      },
      login: async (email: string, password: string) => {
        setError(null);
        try {
          const result = await client.login(email, password);
          if (!("accessToken" in result)) return result;
          const m = await client.me();
          adoptMe(m);
          setStatus("authed");
          return null;
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
    [status, me, jurisdictionId, error, client, adoptMe, refreshMe],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
