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
import { ApiClient, ApiError, NO_CONNECTION, SessionExpiredError, type Me, type MfaChallenge, type Tokens } from "../api/client.js";

/**
 * Session state for the shell. The token pair is persisted per-viewer in
 * localStorage (guarded: private mode or blocked storage degrades to a
 * login-each-time session, never a crash), with the last profile the server
 * returned beside it. On mount, a saved session is revived by renewing the
 * access token and reading /me; the server's refusal is a clean fall back to
 * anonymous, not an error screen. With no connection the saved profile opens
 * the console offline, and the read is tried again until the server answers.
 * A session the server ends while the console is open returns to sign-in and
 * says so, rather than leaving every screen failing unauthenticated; work
 * saved on this device is kept for the next sign-in.
 */

export const SESSION_ENDED = "Your session has ended. Sign in again to continue; work saved on this device is kept.";

/** Why a sign-in failed, in words an operator can act on. */
export function signInFailure(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return "That email and password do not match an active account on this server.";
    if (cause.status === 429) return "Too many sign-in attempts. Wait a few minutes, then try again.";
    if (cause.status >= 500) return `The server could not complete the sign-in (${cause.message}). Try again shortly; if it persists, tell whoever runs the server.`;
  }
  if (cause instanceof Error && cause.message === NO_CONNECTION) {
    return "The server could not be reached. Check this device's network connection; if it persists, ask whoever runs the server whether it is running.";
  }
  return cause instanceof Error ? cause.message : "Sign-in failed.";
}

const STORAGE_KEY = "openeoc.tokens";
const PROFILE_KEY = "openeoc.me";

function loadProfile(): Me | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) as Me : null;
  } catch {
    return null;
  }
}

function saveProfile(me: Me | null): void {
  try {
    if (me) localStorage.setItem(PROFILE_KEY, JSON.stringify(me));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Without storage an offline start waits for the server instead.
  }
}

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
    else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PROFILE_KEY);
    }
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
  /** The console opened from this device's saved profile because the server cannot be reached. */
  readonly offline: boolean;
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
  const ended = useRef<() => void>(() => undefined);
  const leaving = useRef(false);
  if (!clientRef.current) {
    clientRef.current = new ApiClient({ onTokens: (tokens) => { saveTokens(tokens); if (!tokens) ended.current(); } });
  }
  const client = clientRef.current;

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  ended.current = () => {
    if (leaving.current || status !== "authed") return;
    setMe(null);
    setJurisdictionId(null);
    setStatus("anon");
    setError(SESSION_ENDED);
  };

  const adoptMe = useCallback((next: Me) => {
    saveProfile(next);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      clearTimeout(timer);
      window.removeEventListener("online", attempt);
      client
        .me()
        .then((m) => {
          if (cancelled) return;
          setError(null);
          setOffline(false);
          adoptMe(m);
          setStatus("authed");
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          // Only the server's refusal ends a saved session. Without a
          // connection the tokens are kept and the read is tried again.
          if (cause instanceof SessionExpiredError || (cause instanceof ApiError && [401, 403].includes(cause.status))) {
            client.clearTokens();
            setStatus("anon");
            setError(SESSION_ENDED);
            return;
          }
          setError("No connection to the server. Your session is kept and resumes when the connection returns.");
          const saved = loadProfile();
          if (saved) {
            adoptMe(saved);
            setOffline(true);
            setStatus("authed");
          }
          window.addEventListener("online", attempt);
          timer = setTimeout(attempt, 15_000);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", attempt);
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
      offline,
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
          setError(signInFailure(e));
          throw e;
        }
      },
      logout: async () => {
        leaving.current = true;
        try {
          await client.logout();
        } finally {
          leaving.current = false;
          setMe(null);
          setJurisdictionId(null);
          setStatus("anon");
        }
      },
    }),
    [status, me, jurisdictionId, error, offline, client, adoptMe, refreshMe],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
