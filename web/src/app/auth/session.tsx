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
import {
  IDLE_LOCK_MS,
  createVault,
  dropOrphanStores,
  eraseVault,
  latestSessionVault,
  markVaultSession,
  readVault,
  unlockVault,
  type UnlockResult,
} from "../../offline/device-lock.js";
import {
  activeDevice,
  closeDevice,
  openDeviceClear,
  openDeviceVault,
  openOfflineStore,
} from "../../offline/store.js";
import { ApiClient, ApiError, NO_CONNECTION, SessionExpiredError, type Me, type MfaChallenge, type Tokens } from "../api/client.js";

/**
 * Session state for the shell, and what this device keeps for the person
 * signed in (VC-27).
 *
 * Without a device PIN, as before device PINs: the token pair is persisted
 * per-viewer in localStorage (guarded: private mode or blocked storage
 * degrades to a login-each-time session, never a crash), with the last
 * profile the server returned beside it, and offline work sits in the clear
 * store. On mount a saved session is revived by reading /me; the server's
 * refusal is a clean fall back to anonymous, not an error screen. With no
 * connection the saved profile opens the console offline, and the read is
 * tried again until the server answers. The console offers a device PIN.
 *
 * With a device PIN, the token pair and the profile are sealed in the
 * person's encrypted store beside their work, and nothing of theirs is kept
 * in the clear. A start asks for the PIN, then resumes the same way. The
 * console locks again after 15 minutes without use. A password sign-in of a
 * person who has a PIN here still needs the PIN, or erasing what the device
 * keeps, to go on. A different person signing in never gets another
 * person's key.
 *
 * A session the server ends while the console is open returns to sign-in and
 * says so, rather than leaving every screen failing unauthenticated; work
 * saved on this device is kept for the next sign-in.
 */

export const SESSION_ENDED = "Your session has ended. Sign in again to continue; work saved on this device is kept.";
const NO_SERVER = "No connection to the server. Your session is kept and resumes when the connection returns.";

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
const SEALED_SESSION = "device-session";

interface SealedSession {
  readonly tokens: Tokens | null;
  readonly me: Me | null;
}

const hasIndexedDb = () => typeof indexedDB !== "undefined";

/** The server refused the session, as opposed to not answering. */
const refused = (cause: unknown) =>
  cause instanceof SessionExpiredError || (cause instanceof ApiError && [401, 403].includes(cause.status));

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

export type SessionStatus = "loading" | "anon" | "locked" | "authed";

/** Whose device PIN the lock screen asks for. */
export interface LockedFor {
  readonly personId: string;
  readonly label: string;
  /** Signed in with a password just now, so erasing what the device keeps may be offered. */
  readonly proven: boolean;
}

export interface SessionValue {
  readonly status: SessionStatus;
  readonly me: Me | null;
  readonly client: ApiClient;
  readonly jurisdictionId: string | null;
  readonly role: string | null;
  readonly error: string | null;
  /** The console opened from this device's saved profile because the server cannot be reached. */
  readonly offline: boolean;
  /** Set while status is "locked". */
  readonly lockedFor: LockedFor | null;
  /** What this device keeps for the person is sealed under their PIN; otherwise it sits in the clear. */
  readonly devicePin: boolean;
  /** Offer a device PIN: the person keeps work here unprotected and has not answered "Not now" in this page. */
  readonly pinOffer: boolean;
  readonly dismissPinOffer: () => void;
  readonly setJurisdiction: (id: string) => void;
  readonly refreshMe: () => Promise<Me>;
  readonly recoverSession: () => Promise<void>;
  readonly switchPosition: (positionId: string | null) => Promise<void>;
  /** Resolves with a challenge when a second factor is due, else signs in. */
  readonly login: (email: string, password: string) => Promise<MfaChallenge | null>;
  /** Enter the console once the client holds a session from a second-factor step. */
  readonly completeSignIn: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly unlockDevice: (pin: string) => Promise<UnlockResult>;
  /** Seal what this device keeps for the signed-in person under a new PIN. */
  readonly setDevicePin: (pin: string) => Promise<void>;
  readonly lockDevice: () => void;
  /** After a password sign-in only: erase what this device keeps for the person and go on. */
  readonly eraseDevice: () => Promise<void>;
  /** Leave the PIN screen for the password sign-in; the sealed copy stays. */
  readonly usePassword: () => void;
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
  const keep = useRef<(tokens: Tokens | null) => void>(saveTokens);
  const leaving = useRef(false);
  /** The person whose session is sealed in their open vault; null keeps it in localStorage. */
  const sealedFor = useRef<string | null>(null);
  const meRef = useRef<Me | null>(null);
  /** Who signed in while their device copy waits for the PIN. */
  const pendingMe = useRef<Me | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  if (!clientRef.current) {
    clientRef.current = new ApiClient({ onTokens: (tokens) => { keep.current(tokens); if (!tokens) ended.current(); } });
  }
  const client = clientRef.current;

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [lockedFor, setLockedFor] = useState<LockedFor | null>(null);
  const [devicePin, setDevicePinFlag] = useState(false);
  /** Who answered "Not now" to the device PIN in this page; a password sign-in asks again. */
  const [offerDismissedFor, setOfferDismissedFor] = useState<string | null>(null);
  ended.current = () => {
    if (leaving.current || status !== "authed") return;
    setMe(null);
    setJurisdictionId(null);
    setStatus("anon");
    setError(SESSION_ENDED);
  };

  /** Write the session into this person's open vault; a lock in the meantime drops it. */
  const seal = useCallback((personId: string, value: SealedSession | null) => {
    writes.current = writes.current.then(async () => {
      if (activeDevice()?.personId !== personId) return;
      await (await openOfflineStore()).setMeta(SEALED_SESSION, value);
      await markVaultSession(personId, Boolean(value?.tokens));
    }).catch(() => undefined);
  }, []);

  keep.current = (tokens) => {
    const personId = sealedFor.current;
    if (!personId) return saveTokens(tokens);
    saveTokens(null);
    seal(personId, tokens ? { tokens, me: meRef.current } : null);
  };

  const adoptMe = useCallback((next: Me) => {
    meRef.current = next;
    if (sealedFor.current) {
      const tokens = client.heldTokens();
      if (tokens) seal(sealedFor.current, { tokens, me: next });
    } else {
      saveProfile(next);
    }
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
  }, [client, seal]);

  const refreshMe = useCallback(async () => {
    const next = await client.me();
    adoptMe(next);
    return next;
  }, [adoptMe, client]);

  /** Ask for a person's device PIN; the pair stays in the client's memory until the vault it belongs in opens. */
  const askForPin = useCallback((next: Me | null, personId: string, label: string, proven: boolean) => {
    saveTokens(null);
    pendingMe.current = next;
    setMe(null);
    setLockedFor({ personId, label, proven });
    setStatus("locked");
  }, []);

  /** Open the console for whoever the server says is signed in, or ask for their device PIN first. */
  const enter = useCallback(async (next: Me, proven: boolean) => {
    const personId = next.person.id;
    if (proven) setOfferDismissedFor(null);
    const open = activeDevice();
    if (open?.personId === personId) {
      sealedFor.current = open.sealed ? personId : null;
      if (open.sealed) keep.current(client.heldTokens());
      setDevicePinFlag(open.sealed);
      adoptMe(next);
      setStatus("authed");
      return;
    }
    // Another person's key leaves this page before anything of this one's opens.
    closeDevice();
    sealedFor.current = null;
    setDevicePinFlag(false);
    const vault = hasIndexedDb() ? await readVault(personId).catch(() => null) : null;
    if (vault) {
      askForPin(next, personId, vault.label, proven);
      return;
    }
    openDeviceClear(personId);
    adoptMe(next);
    setStatus("authed");
  }, [adoptMe, askForPin, client]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saved = loadTokens();
    const attempt = () => {
      clearTimeout(timer);
      window.removeEventListener("online", attempt);
      client
        .me()
        .then(async (m) => {
          if (cancelled) return;
          setError(null);
          setOffline(false);
          await enter(m, false);
        })
        .catch(async (cause: unknown) => {
          if (cancelled) return;
          // Only the server's refusal ends a saved session. Without a
          // connection the tokens are kept and the read is tried again.
          if (refused(cause)) {
            client.clearTokens();
            setStatus("anon");
            setError(SESSION_ENDED);
            return;
          }
          setError(NO_SERVER);
          const profile = loadProfile();
          const vault = profile && hasIndexedDb() ? await readVault(profile.person.id).catch(() => null) : null;
          if (cancelled) return;
          if (profile && vault) {
            askForPin(null, profile.person.id, vault.label, false);
            return;
          }
          if (profile) {
            // The offline effect below keeps trying the server.
            openDeviceClear(profile.person.id);
            adoptMe(profile);
            setOffline(true);
            setStatus("authed");
            return;
          }
          window.addEventListener("online", attempt);
          timer = setTimeout(attempt, 15_000);
        });
    };
    void (async () => {
      if (hasIndexedDb()) await dropOrphanStores().catch(() => undefined);
      if (cancelled) return;
      if (saved) {
        client.setTokens(saved);
        attempt();
        return;
      }
      const vault = hasIndexedDb() ? await latestSessionVault().catch(() => null) : null;
      if (cancelled) return;
      if (vault) {
        setLockedFor({ personId: vault.personId, label: vault.label, proven: false });
        setStatus("locked");
      } else {
        setStatus("anon");
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", attempt);
    };
  }, [adoptMe, askForPin, client, enter]);

  // Opened offline from the saved profile: sign in for real once the server answers.
  useEffect(() => {
    if (!offline || status !== "authed") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      clearTimeout(timer);
      client.me().then((m) => {
        setOffline(false);
        setError(null);
        adoptMe(m);
      }, (cause: unknown) => {
        // A refusal has already returned the console to sign-in.
        if (!refused(cause)) timer = setTimeout(attempt, 15_000);
      });
    };
    addEventListener("online", attempt);
    timer = setTimeout(attempt, 15_000);
    return () => {
      clearTimeout(timer);
      removeEventListener("online", attempt);
    };
  }, [adoptMe, client, offline, status]);

  const lockDevice = useCallback(() => {
    const open = activeDevice();
    if (!open?.sealed) return;
    closeDevice();
    sealedFor.current = null;
    setLockedFor({ personId: open.personId, label: meRef.current?.person.displayName ?? "", proven: false });
    setMe(null);
    setStatus("locked");
  }, []);

  useEffect(() => {
    if (status !== "authed" || !devicePin) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const check = () => { if (Date.now() - last >= IDLE_LOCK_MS) lockDevice(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) addEventListener(name, touch, { passive: true });
    // Timers sleep in a hidden page; coming back checks the time that passed.
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 15_000);
    return () => {
      for (const name of events) removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [devicePin, lockDevice, status]);

  /** Continue as the person in the clear store, their session kept as before device PINs. */
  const continueClear = useCallback((personId: string, known: Me) => {
    openDeviceClear(personId);
    sealedFor.current = null;
    setDevicePinFlag(false);
    keep.current(client.heldTokens());
    adoptMe(known);
    setStatus("authed");
  }, [adoptMe, client]);

  const unlockDevice = useCallback(async (pin: string): Promise<UnlockResult> => {
    const target = lockedFor;
    if (!target) throw new Error("Nothing on this device is waiting for a PIN.");
    const result = await unlockVault(target.personId, pin);
    const known = pendingMe.current;
    if (!result.ok) {
      if (result.reason === "erased") {
        setLockedFor(null);
        pendingMe.current = null;
        if (target.proven && known) continueClear(target.personId, known);
        else {
          if (client.heldTokens()) client.clearTokens();
          setStatus("anon");
          setError(`Too many wrong PINs. This device erased the work it kept for ${target.label}.`);
        }
      }
      return result;
    }
    // What the clear store held for the person moves in before anything reads the vault.
    await openDeviceVault(target.personId, result.key);
    sealedFor.current = target.personId;
    setDevicePinFlag(true);
    const sealed = await (await openOfflineStore()).getMeta<SealedSession>(SEALED_SESSION).catch(() => null);
    const held = client.heldTokens();
    if (held) keep.current(held);
    else if (sealed?.tokens) client.setTokens(sealed.tokens);
    setLockedFor(null);
    pendingMe.current = null;
    if (target.proven && known) {
      adoptMe(known);
      setStatus("authed");
      return result;
    }
    if (!client.heldTokens()) {
      setStatus("anon");
      return result;
    }
    try {
      adoptMe(await client.me());
      setOffline(false);
      setError(null);
    } catch (cause) {
      if (refused(cause)) {
        setStatus("anon");
        setError(SESSION_ENDED);
        return result;
      }
      const kept = sealed?.me ?? known ?? meRef.current;
      if (!kept) {
        setStatus("anon");
        setError(NO_SERVER);
        return result;
      }
      adoptMe(kept);
      setOffline(true);
      setError(NO_SERVER);
    }
    setStatus("authed");
    return result;
  }, [adoptMe, client, continueClear, lockedFor]);

  const setDevicePin = useCallback(async (pin: string) => {
    const open = activeDevice();
    // Another tab may have set one meanwhile; a second vault would orphan what the first sealed.
    if (!open || open.sealed || await readVault(open.personId)) {
      throw new Error("A device PIN is already set for you on this device. Reload the app to enter it.");
    }
    const key = await createVault(open.personId, meRef.current?.person.displayName ?? "", pin);
    // What the clear store holds for the person moves into the vault and leaves the clear store.
    await openDeviceVault(open.personId, key);
    sealedFor.current = open.personId;
    setDevicePinFlag(true);
    // The token pair and profile move into the vault; the clear copies go.
    keep.current(client.heldTokens());
  }, [client]);

  const eraseDevice = useCallback(async () => {
    const target = lockedFor;
    const known = pendingMe.current;
    if (!target?.proven || !known) return;
    await eraseVault(target.personId);
    setLockedFor(null);
    pendingMe.current = null;
    continueClear(target.personId, known);
  }, [continueClear, lockedFor]);

  const usePassword = useCallback(() => {
    setLockedFor(null);
    pendingMe.current = null;
    sealedFor.current = null;
    // The pair in memory goes; the sealed copy stays for the PIN.
    if (client.heldTokens()) client.clearTokens();
    setStatus("anon");
  }, [client]);

  const personId = me?.person.id ?? null;
  const pinOffer = status === "authed" && !devicePin && personId !== null && offerDismissedFor !== personId && hasIndexedDb();

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
      lockedFor,
      devicePin,
      pinOffer,
      dismissPinOffer: () => setOfferDismissedFor(personId),
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
        await enter(await client.me(), true);
      },
      login: async (email: string, password: string) => {
        setError(null);
        try {
          const result = await client.login(email, password);
          if (!("accessToken" in result)) return result;
          await enter(await client.me(), true);
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
          await writes.current;
          // A sealed store locks; the clear store stays as it always has.
          closeDevice();
          sealedFor.current = null;
          meRef.current = null;
          setDevicePinFlag(false);
          setOffline(false);
          setMe(null);
          setJurisdictionId(null);
          setStatus("anon");
        }
      },
      unlockDevice,
      setDevicePin,
      lockDevice,
      eraseDevice,
      usePassword,
    }),
    [status, me, jurisdictionId, error, offline, lockedFor, devicePin, pinOffer, personId, client, enter, refreshMe,
      unlockDevice, setDevicePin, lockDevice, eraseDevice, usePassword],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
