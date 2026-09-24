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
import type { IncidentBoardRef, IncidentSummary } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { parseRouteHash, replaceRouteContext, surfaceHash, type Surface } from "../router.js";
import "./incident-switcher.css";

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
  readonly selectionNotice: string | null;
  readonly selectIncident: (id: string | null) => void;
  /** Select an incident the list does not show yet, such as one just
   *  activated, once the server lists it; an id the next list read still
   *  lacks is dropped. Settles when the list read is in. */
  readonly selectWhenListed: (id: string) => Promise<void>;
  readonly reload: () => void;
}

/**
 * The boards that belong in view for the selected incident: jurisdiction
 * boards that serve no incident, and the selected incident's own. Another
 * incident's boards stay out. With no incident selected every board shows.
 */
export function boardsInScope<T extends { readonly incidentIds?: readonly string[] }>(
  boards: readonly T[],
  incidentId: string | null,
): readonly T[] {
  if (!incidentId) return boards;
  return boards.filter((board) => !board.incidentIds?.length || board.incidentIds.includes(incidentId));
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

  // A selection waiting for the next list read: selected if the server lists
  // it, dropped if a newer list still does not. The caller learns either way.
  const pending = useRef<{ id: string; since: readonly IncidentSummary[]; done: () => void } | null>(null);
  const reloadIncidents = incidents.reload;
  const selectWhenListed = useCallback((id: string) => new Promise<void>((done) => {
    pending.current?.done();
    pending.current = { id, since: list, done };
    reloadIncidents();
  }), [list, reloadIncidents]);
  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || list === wanted.since) return;
    pending.current = null;
    if (list.some((incident) => incident.id === wanted.id)) selectIncident(wanted.id);
    wanted.done();
  }, [list, selectIncident]);

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
      selectionNotice,
      selectIncident,
      selectWhenListed,
      reload: incidents.reload,
    };
  }, [list, selectedId, incidentBoardIds, incidentBoards, selectionNotice, selectIncident, selectWhenListed, incidents.loading, incidents.error, incidents.reload]);

  return <IncidentContext.Provider value={value}>{props.children}</IncidentContext.Provider>;
}

/** The global incident switcher, shown in the command bar. */
export function IncidentSwitcher() {
  const { incidents, selectedIncidentId, selectIncident, selectionNotice, loading, error } = useIncident();
  if (error) return <span className="eoc-text-critical">Incidents unavailable</span>;
  if (loading && incidents.length === 0)
    return <span className="eoc-muted">Loading incidents…</span>;
  if (incidents.length === 0)
    return <span className="eoc-muted">No active incident</span>;
  return (
    <label className="incident-switcher">
      <span className="eoc-muted">Incident</span>
      <select
        aria-label="Selected incident"
        value={selectedIncidentId ?? ""}
        onChange={(e) => selectIncident(e.target.value || null)}
        className="incident-switcher-select"
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
