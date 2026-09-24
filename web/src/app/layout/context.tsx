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
import type { IncidentAreaRevision, SavedStatePayload, SavedStateRecord } from "@openeoc/shared";
import { Icon } from "../../design/icons/index.js";
import type { ThemeName } from "../../design/tokens.js";
import { ApiError } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useIncident } from "../incident/context.js";
import { parseRouteHash, replaceRouteContext, surfaceHash } from "../router.js";
import type { WorkspaceArrangement } from "./AppShell.js";

export interface WorkspaceLayoutState {
  readonly compactNavigation: boolean;
  readonly drawerOpen: boolean;
  readonly drawerWidth: number;
}

export interface OperationalPeriodChoice {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

type WorkspaceSyncPhase = "idle" | "loading" | "current" | "saving" | "conflict" | "error";
type WorkspaceKind = "workspace_preferences" | "workspace_layout";

type SaveTarget = {
  readonly kind: WorkspaceKind;
  readonly key: string;
};

export interface WorkspaceContextValue {
  readonly loadedScope: string | null;
  readonly phase: WorkspaceSyncPhase;
  readonly message: string | null;
  readonly conflict: boolean;
  readonly periods: readonly OperationalPeriodChoice[];
  readonly selectedPeriodRevision: number | null;
  readonly selectedPeriodLabel: string;
  readonly theme: ThemeName;
  readonly layout: (arrangement: WorkspaceArrangement) => WorkspaceLayoutState;
  readonly selectPeriod: (revision: number | null) => void;
  readonly toggleTheme: () => void;
  readonly updateLayout: (arrangement: WorkspaceArrangement, state: WorkspaceLayoutState) => void;
  readonly reloadSaved: () => void;
  readonly keepSession: () => Promise<void>;
}

const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  compactNavigation: false,
  drawerOpen: true,
  drawerWidth: 340,
};

const DEFAULT_LAYOUTS: Record<WorkspaceArrangement, WorkspaceLayoutState> = {
  map: DEFAULT_LAYOUT,
  boards: DEFAULT_LAYOUT,
  planning: DEFAULT_LAYOUT,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used within <WorkspaceContextProvider>");
  return value;
}

function parseLayout(payload: SavedStatePayload): WorkspaceLayoutState | null {
  const compactNavigation = payload.compactNavigation;
  const drawerOpen = payload.drawerOpen;
  const drawerWidth = payload.drawerWidth;
  if (typeof compactNavigation !== "boolean" || typeof drawerOpen !== "boolean"
    || typeof drawerWidth !== "number" || !Number.isFinite(drawerWidth)) return null;
  return {
    compactNavigation,
    drawerOpen,
    drawerWidth: Math.min(520, Math.max(280, Math.round(drawerWidth))),
  };
}

function parsePreferences(payload: SavedStatePayload): {
  theme: ThemeName | null;
  periodRevision: number | null;
} {
  return {
    theme: payload.theme === "light" || payload.theme === "dark" ? payload.theme : null,
    periodRevision: typeof payload.periodRevision === "number" && Number.isInteger(payload.periodRevision)
      && payload.periodRevision > 0 ? payload.periodRevision : null,
  };
}

async function optionalState(promise: Promise<SavedStateRecord>): Promise<SavedStateRecord | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function periodChoices(incidentId: string, revisions: readonly IncidentAreaRevision[]): OperationalPeriodChoice[] {
  const seen = new Set<string>();
  const choices: OperationalPeriodChoice[] = [];
  for (const revision of [...revisions].sort((a, b) => b.revision - a.revision)) {
    if (revision.incidentId !== incidentId || !revision.operationalPeriod) continue;
    const period = revision.operationalPeriod;
    const key = `${period.label}\u0000${period.startsAt}\u0000${period.endsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ revision: revision.revision, ...period });
  }
  return choices;
}

function targetKey(target: SaveTarget): string {
  return `${target.kind}:${target.key}`;
}

export function WorkspaceContextProvider(props: {
  readonly theme: ThemeName;
  readonly onThemeChange: (theme: ThemeName) => void;
  readonly children: ReactNode;
}) {
  const { client, me } = useSession();
  const incident = useIncident();
  const incidentId = incident.selectedIncidentId;
  const personId = me?.person.id ?? null;
  const scope = personId && incidentId ? `${personId}:${incidentId}` : null;
  const generation = useRef(0);
  const records = useRef(new Map<string, SavedStateRecord>());
  const blocked = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const conflictTarget = useRef<SaveTarget | null>(null);
  const layoutsRef = useRef(DEFAULT_LAYOUTS);
  const periodRef = useRef<number | null>(null);
  const themeRef = useRef(props.theme);
  const externalThemeRef = useRef(props.theme);
  const onThemeChangeRef = useRef(props.onThemeChange);
  const readyRef = useRef(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [phase, setPhase] = useState<WorkspaceSyncPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [periods, setPeriods] = useState<readonly OperationalPeriodChoice[]>([]);
  const [selectedPeriodRevision, setSelectedPeriodRevision] = useState<number | null>(null);
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS);
  externalThemeRef.current = props.theme;
  onThemeChangeRef.current = props.onThemeChange;

  const preferencePayload = useCallback((): SavedStatePayload => ({
    theme: themeRef.current,
    periodRevision: periodRef.current,
  }), []);

  const layoutPayload = useCallback((arrangement: WorkspaceArrangement): SavedStatePayload => ({
    compactNavigation: layoutsRef.current[arrangement].compactNavigation,
    drawerOpen: layoutsRef.current[arrangement].drawerOpen,
    drawerWidth: layoutsRef.current[arrangement].drawerWidth,
  }), []);

  const enqueue = useCallback((target: SaveTarget, payload: SavedStatePayload) => {
    if (!scope || !incidentId || !readyRef.current || blocked.current) return;
    const capturedGeneration = generation.current;
    setPhase("saving");
    setMessage("Saving workspace settings");
    queue.current = queue.current.catch(() => undefined).then(async () => {
      if (capturedGeneration !== generation.current || blocked.current) return;
      const prior = records.current.get(targetKey(target));
      try {
        const saved = await client.saveWorkspaceState(incidentId, target.kind, target.key, {
          schemaVersion: 1,
          expectedRevision: prior?.revision ?? 0,
          payload,
        });
        if (capturedGeneration !== generation.current) return;
        records.current.set(targetKey(target), saved);
        setPhase("current");
        setMessage("Workspace settings saved");
      } catch (error) {
        if (capturedGeneration !== generation.current) return;
        blocked.current = true;
        conflictTarget.current = target;
        if (error instanceof ApiError && error.status === 409) {
          setPhase("conflict");
          setMessage("Workspace settings changed in another session.");
        } else {
          setPhase("error");
          setMessage(error instanceof Error ? error.message : "Workspace settings could not be saved.");
        }
      }
    });
  }, [client, incidentId, scope]);

  useEffect(() => {
    const capturedGeneration = ++generation.current;
    readyRef.current = false;
    blocked.current = false;
    conflictTarget.current = null;
    queue.current = Promise.resolve();
    records.current = new Map();
    setLoadedScope(null);
    setMessage(null);
    setPeriods([]);
    setSelectedPeriodRevision(null);
    periodRef.current = null;
    layoutsRef.current = DEFAULT_LAYOUTS;
    setLayouts(DEFAULT_LAYOUTS);
    if (!scope || !incidentId) {
      setPhase("idle");
      return;
    }
    setPhase("loading");
    void Promise.all([
      client.getIncidentArea(incidentId),
      client.incidentAreaHistory(incidentId),
      optionalState(client.getWorkspaceState(incidentId, "workspace_preferences", "shell")),
      ...(["map", "boards", "planning"] as const).map((arrangement) =>
        optionalState(client.getWorkspaceState(incidentId, "workspace_layout", arrangement))),
    ]).then(([current, history, preferenceState, mapState, boardsState, planningState]) => {
      if (capturedGeneration !== generation.current) return;
      // Read the route now, not when loading began: a deep link that arrived
      // meanwhile carries its own record, filter and period.
      const route = parseRouteHash(location.hash);
      const allPeriods = periodChoices(incidentId, [current, ...history]);
      const preference = preferenceState ? parsePreferences(preferenceState.payload) : { theme: null, periodRevision: null };
      const requestedPeriod = route.context.incidentId === incidentId ? route.context.periodRevision : undefined;
      const candidate = requestedPeriod === undefined ? preference.periodRevision : requestedPeriod;
      // Without a saved or linked choice the workspace opens on the incident's current period.
      const currentPeriod = current.operationalPeriod ? allPeriods.find((period) => period.revision === current.revision)?.revision ?? null : null;
      const selected = candidate
        ? allPeriods.some((period) => period.revision === candidate) ? candidate : null
        : currentPeriod;
      const nextLayouts = { ...DEFAULT_LAYOUTS };
      for (const [arrangement, state] of [
        ["map", mapState], ["boards", boardsState], ["planning", planningState],
      ] as const) {
        const parsed = state ? parseLayout(state.payload) : null;
        if (parsed) nextLayouts[arrangement] = parsed;
        if (state) records.current.set(targetKey({ kind: "workspace_layout", key: arrangement }), state);
      }
      if (preferenceState) records.current.set(targetKey({ kind: "workspace_preferences", key: "shell" }), preferenceState);
      setPeriods(allPeriods);
      setSelectedPeriodRevision(selected);
      periodRef.current = selected;
      layoutsRef.current = nextLayouts;
      setLayouts(nextLayouts);
      if (preference.theme) {
        themeRef.current = preference.theme;
        onThemeChangeRef.current(preference.theme);
      } else themeRef.current = externalThemeRef.current;
      if (candidate && !selected) {
        const contextWithoutPeriod: { -readonly [Key in keyof typeof route.context]: typeof route.context[Key] } = { ...route.context };
        replaceRouteContext({ ...contextWithoutPeriod, incidentId, periodRevision: null });
        setMessage("The saved operational period is unavailable for this incident.");
      } else {
        if (requestedPeriod === undefined) {
          replaceRouteContext({ ...route.context, incidentId, periodRevision: selected });
        }
        setMessage("Workspace settings loaded");
      }
      readyRef.current = true;
      setLoadedScope(scope);
      setPhase("current");
    }).catch((error: unknown) => {
      if (capturedGeneration !== generation.current) return;
      setLoadedScope(scope);
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Workspace settings could not be loaded.");
    });
  }, [client, incidentId, reloadVersion, scope]);

  useEffect(() => {
    const onHashChange = () => {
      if (!readyRef.current || !incidentId) return;
      const route = parseRouteHash(location.hash);
      if (route.context.incidentId !== incidentId) return;
      const requested = route.context.periodRevision;
      const next = requested === undefined ? null : requested;
      if (next !== null && !periods.some((period) => period.revision === next)) {
        setMessage("That operational period is not available for this incident.");
        return;
      }
      if (requested === undefined) {
        replaceRouteContext({ ...route.context, incidentId, periodRevision: null });
      }
      if (periodRef.current === next) return;
      periodRef.current = next;
      setSelectedPeriodRevision(next);
      enqueue({ kind: "workspace_preferences", key: "shell" }, preferencePayload());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [enqueue, incidentId, periods, preferencePayload]);

  const selectPeriod = useCallback((revision: number | null) => {
    if (!readyRef.current) return;
    const valid = revision === null || periods.some((period) => period.revision === revision);
    if (!valid) {
      setMessage("That operational period is not available for this incident.");
      return;
    }
    setSelectedPeriodRevision(revision);
    periodRef.current = revision;
    const route = parseRouteHash(location.hash);
    const contextWithoutPeriod: { -readonly [Key in keyof typeof route.context]: typeof route.context[Key] } = { ...route.context };
    location.hash = surfaceHash(route.surface, {
      ...contextWithoutPeriod,
      ...(incidentId ? { incidentId } : {}),
      periodRevision: revision,
    });
    enqueue({ kind: "workspace_preferences", key: "shell" }, preferencePayload());
  }, [enqueue, incidentId, periods, preferencePayload]);

  const toggleTheme = useCallback(() => {
    const next = themeRef.current === "dark" ? "light" : "dark";
    themeRef.current = next;
    onThemeChangeRef.current(next);
    enqueue({ kind: "workspace_preferences", key: "shell" }, preferencePayload());
  }, [enqueue, preferencePayload]);

  const updateLayout = useCallback((arrangement: WorkspaceArrangement, state: WorkspaceLayoutState) => {
    const normalized = { ...state, drawerWidth: Math.min(520, Math.max(280, Math.round(state.drawerWidth))) };
    const next = { ...layoutsRef.current, [arrangement]: normalized };
    layoutsRef.current = next;
    setLayouts(next);
    enqueue({ kind: "workspace_layout", key: arrangement }, layoutPayload(arrangement));
  }, [enqueue, layoutPayload]);

  const keepSession = useCallback(async () => {
    const target = conflictTarget.current;
    if (!target || !incidentId) return;
    const capturedGeneration = generation.current;
    setPhase("saving");
    setMessage("Reconciling workspace settings");
    try {
      const latest = await optionalState(client.getWorkspaceState(incidentId, target.kind, target.key));
      if (capturedGeneration !== generation.current) return;
      if (latest) records.current.set(targetKey(target), latest);
      else records.current.delete(targetKey(target));
      blocked.current = false;
      conflictTarget.current = null;
      const payload = target.kind === "workspace_preferences"
        ? preferencePayload()
        : layoutPayload(target.key as WorkspaceArrangement);
      enqueue(target, payload);
    } catch (error) {
      if (capturedGeneration !== generation.current) return;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Workspace settings could not be reconciled.");
    }
  }, [client, enqueue, incidentId, layoutPayload, preferencePayload]);

  const selectedPeriod = periods.find((period) => period.revision === selectedPeriodRevision);
  const selectedPeriodLabel = selectedPeriod ? periodLabel(selectedPeriod) : "Not set";
  const value = useMemo<WorkspaceContextValue>(() => ({
    loadedScope,
    phase,
    message,
    conflict: phase === "conflict",
    periods,
    selectedPeriodRevision,
    selectedPeriodLabel,
    theme: props.theme,
    layout: (arrangement) => layouts[arrangement],
    selectPeriod,
    toggleTheme,
    updateLayout,
    reloadSaved: () => setReloadVersion((current) => current + 1),
    keepSession,
  }), [keepSession, layouts, loadedScope, message, periods, phase, props.theme, selectPeriod, selectedPeriodRevision, toggleTheme, updateLayout]);

  return <WorkspaceContext.Provider value={value}>{props.children}</WorkspaceContext.Provider>;
}

/** "OP 03 · 0600–1800 PDT": the period's label and its hours in the viewer's time zone. */
export function periodLabel(period: { readonly label: string; readonly startsAt: string; readonly endsAt: string }): string {
  const starts = new Date(period.startsAt);
  const ends = new Date(period.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return period.label;
  const hours = (value: Date) => new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(value).replace(":", "");
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(starts)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  return `${period.label} · ${hours(starts)}–${hours(ends)}${zone ? ` ${zone}` : ""}`;
}

export function OperationalPeriodControl() {
  const workspace = useWorkspaceContext();
  return (
    <label className="eoc-shell-select is-plain is-period">
      <Icon name="operationalPeriods" size={20} decorative className="eoc-shell-select-icon" />
      <select
        aria-label="Operational period"
        value={workspace.selectedPeriodRevision ?? ""}
        disabled={workspace.phase === "loading"}
        onChange={(event) => workspace.selectPeriod(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">No operational period</option>
        {workspace.periods.map((period) => (
          <option key={period.revision} value={period.revision}>{periodLabel(period)}</option>
        ))}
      </select>
    </label>
  );
}

export function PositionControl() {
  const session = useSession();
  const [positions, setPositions] = useState<readonly { id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const jurisdictionId = session.jurisdictionId;

  useEffect(() => {
    const current = ++generation.current;
    setError(null);
    if (!jurisdictionId) {
      setPositions([]);
      return;
    }
    setLoading(true);
    void session.client.listAssignedPositions(jurisdictionId).then((next) => {
      if (current === generation.current) setPositions(next);
    }).catch((cause: unknown) => {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Assigned positions unavailable");
    }).finally(() => {
      if (current === generation.current) setLoading(false);
    });
  }, [jurisdictionId, session.client, session.me?.position?.id]);

  const active = session.me?.position;
  const options = active && !positions.some((position) => position.id === active.id)
    ? [{ id: active.id, title: active.title }, ...positions]
    : positions;
  return (
    <label className="eoc-shell-select is-plain is-position">
      <Icon name="participants" size={20} decorative className="eoc-shell-select-icon" />
      <select
        aria-label="Acting position"
        value={active?.id ?? ""}
        disabled={loading}
        aria-describedby={error ? "position-switch-error" : undefined}
        onChange={(event) => {
          setError(null);
          setLoading(true);
          void session.switchPosition(event.target.value || null)
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Position change denied"))
            .finally(() => setLoading(false));
        }}
      >
        <option value="">No acting position</option>
        {options.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}
      </select>
      <Icon name="chevronDown" size={20} decorative className="eoc-shell-select-chevron" />
      {error ? <small id="position-switch-error" role="alert">{error}</small> : null}
    </label>
  );
}
