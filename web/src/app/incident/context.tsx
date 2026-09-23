import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { IncidentBoardRef, IncidentSummary } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { parseRouteHash, replaceRouteContext, surfaceHash, type Surface } from "../router.js";

/**
 * The one selected incident for the whole operator workspace (VEOC-79B).
 * Before this, four surfaces each kept their own incident dropdown and drifted
 * apart; now a single selection drives every incident-aware surface and the
 * COP. The selection resets when the jurisdiction changes, and switching
 * incidents remounts the center surface (see Console) so no records, cached
 * responses or polling timers from the previous incident survive.
 */

const EMPTY: readonly IncidentSummary[] = [];
const EMPTY_IDS: readonly string[] = [];
const EMPTY_BOARDS: readonly IncidentBoardRef[] = [];

export interface IncidentValue {
  readonly incidents: readonly IncidentSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedIncidentId: string | null;
  readonly selectedIncident: IncidentSummary | null;
  /** Board ids the selected incident uses, so a surface can tag a contributed
   *  record with the incident only when its board belongs to it (VEOC-79B2). */
  readonly incidentBoardIds: ReadonlySet<string>;
  readonly incidentBoards: readonly IncidentBoardRef[];
  readonly incidentBoardsLoading: boolean;
  readonly selectionNotice: string | null;
  readonly selectIncident: (id: string | null) => void;
  readonly reload: () => void;
}

const IncidentContext = createContext<IncidentValue | null>(null);

export function useIncident(): IncidentValue {
  const value = useContext(IncidentContext);
  if (!value) throw new Error("useIncident must be used within <IncidentProvider>");
  return value;
}

export function incidentLabel(i: IncidentSummary): string {
  return `${i.name}${i.closedAt ? " (closed)" : ""}`;
}

export function IncidentProvider(props: { children: ReactNode }) {
  const { client, jurisdictionId } = useSession();
  const incidents = usePolled(
    () => (jurisdictionId ? client.listIncidents(jurisdictionId) : Promise.resolve(EMPTY)),
    5000,
    [jurisdictionId],
  );
  const list = incidents.data ?? EMPTY;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const noticeIncident = useRef<string | null>(null);

  // A jurisdiction switch must never carry a foreign incident id forward.
  useEffect(() => {
    setSelectedId(null);
    setSelectionNotice(null);
    noticeIncident.current = null;
  }, [jurisdictionId]);

  // Default to the first open incident once the list loads, and never keep a
  // selection that is no longer in the list. An explicit still-valid choice
  // is preserved.
  useEffect(() => {
    const route = parseRouteHash(location.hash);
    const requested = route.context.incidentId;
    if (requested && list.some((incident) => incident.id === requested)) {
      if (noticeIncident.current !== requested) setSelectionNotice(null);
      setSelectedId(requested);
      return;
    }
    if (requested && list.length > 0) {
      const fallback = selectedId && list.some((incident) => incident.id === selectedId)
        ? selectedId
        : (list.find((incident) => !incident.closedAt) ?? list[0]!).id;
      replaceRouteContext({ incidentId: fallback });
      noticeIncident.current = fallback;
      setSelectedId(fallback);
      setSelectionNotice("The linked incident is not available to this session.");
      return;
    }
    if (selectedId && list.some((incident) => incident.id === selectedId)) return;
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    const fallback = (list.find((incident) => !incident.closedAt) ?? list[0]!).id;
    replaceRouteContext({ incidentId: fallback });
    setSelectedId(fallback);
  }, [list, selectedId]);

  useEffect(() => {
    const onHashChange = () => {
      const requested = parseRouteHash(location.hash).context.incidentId;
      if (!requested) return;
      if (list.some((incident) => incident.id === requested)) {
        if (noticeIncident.current !== requested) setSelectionNotice(null);
        setSelectedId(requested);
      } else if (list.length > 0) {
        setSelectionNotice("The linked incident is not available to this session.");
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [list]);

  const selectIncident = useCallback((id: string | null) => {
    if (!id) return;
    if (!list.some((incident) => incident.id === id)) {
      setSelectionNotice("That incident is not available to this session.");
      return;
    }
    const route = parseRouteHash(location.hash);
    const surface = incidentSwitchSurface(route.surface);
    noticeIncident.current = null;
    setSelectionNotice(null);
    setSelectedId(id);
    location.hash = surfaceHash(surface, { incidentId: id });
  }, [list]);

  // The boards the selected incident uses, so a contributed record is tagged
  // with the incident only when its board belongs to it.
  const activeId = list.find((i) => i.id === selectedId)?.id ?? null;
  const boards = useAsync(
    () => (activeId ? client.incidentBoards(activeId) : Promise.resolve(EMPTY_BOARDS)),
    [activeId],
  );
  const incidentBoards = boards.data ?? EMPTY_BOARDS;
  const incidentBoardIds = useMemo(
    () => new Set(incidentBoards.map((board) => board.id) ?? EMPTY_IDS),
    [incidentBoards],
  );

  const value = useMemo<IncidentValue>(() => {
    const selected = list.find((i) => i.id === selectedId) ?? null;
    return {
      incidents: list,
      loading: incidents.loading,
      error: incidents.error,
      selectedIncidentId: selected?.id ?? null,
      selectedIncident: selected,
      incidentBoardIds,
      incidentBoards,
      incidentBoardsLoading: boards.loading,
      selectionNotice,
      selectIncident,
      reload: incidents.reload,
    };
  }, [list, selectedId, incidentBoardIds, incidentBoards, boards.loading,
    selectionNotice, selectIncident, incidents.loading, incidents.error, incidents.reload]);

  return <IncidentContext.Provider value={value}>{props.children}</IncidentContext.Provider>;
}

const switcherSelect: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "1em",
  padding: "6px 8px",
  minHeight: 44,
  borderRadius: 4,
  border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
  maxWidth: 320,
};

/** The global incident switcher, shown in the command bar. */
export function IncidentSwitcher() {
  const { incidents, selectedIncidentId, selectIncident, selectionNotice, loading, error } = useIncident();
  if (error) return <span style={{ color: "var(--eoc-status-critical)" }}>Incidents unavailable</span>;
  if (loading && incidents.length === 0)
    return <span style={{ color: "var(--eoc-text-muted)" }}>Loading incidents…</span>;
  if (incidents.length === 0)
    return <span style={{ color: "var(--eoc-text-muted)" }}>No active incident</span>;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span style={{ color: "var(--eoc-text-muted)" }}>Incident</span>
      <select
        aria-label="Selected incident"
        value={selectedIncidentId ?? ""}
        onChange={(e) => selectIncident(e.target.value || null)}
        style={switcherSelect}
      >
        {incidents.map((i) => (
          <option key={i.id} value={i.id}>
            {incidentLabel(i)}
          </option>
        ))}
      </select>
      {selectionNotice ? <small role="alert">{selectionNotice}</small> : null}
    </label>
  );
}

function incidentSwitchSurface(surface: Surface): Surface {
  switch (surface.kind) {
    case "board":
    case "board-design":
      return { kind: "boards" };
    case "sitrep":
      return { kind: "sitreps" };
    case "lifeline":
    case "esf":
      return { kind: "lifelines" };
    case "dashboard":
      return { kind: "dashboard" };
    case "not-found":
      return { kind: "map" };
    default:
      return surface;
  }
}
