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
import { demoIncident } from "../config.js";

/** A link to an incident the reader may not open: why, and whom to ask, without saying what it holds. */
const LINK_REFUSED = "The linked incident is not open to your account. If a link brought you here, ask whoever sent it, or an administrator of the organization running the incident, for access.";
import { readKept } from "../../offline/kept-board.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { parseRouteHash, replaceRouteContext, surfaceHash, type Surface } from "../router.js";
import { Icon } from "../../design/icons/index.js";

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

/** Where this device remembers the incident a person last chose in a jurisdiction. */
const lastChoiceKey = (personId: string, jurisdictionId: string) => `openeoc.incident.last:${personId}:${jurisdictionId}`;

/**
 * The incident to open when no link or choice names one: the one this person
 * last chose here, then the demonstration's own, then the first open one.
 */
export function defaultIncident(list: readonly IncidentSummary[], remembered: string | null, demoName?: string): IncidentSummary {
  return list.find((incident) => incident.id === remembered)
    ?? (demoName ? list.find((incident) => incident.name === demoName && !incident.closedAt) : undefined)
    ?? list.find((incident) => !incident.closedAt)
    ?? list[0]!;
}

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
  /** The first list read is in, or failed, and the selection has followed
   *  it, so the console can mount once, on the incident it will show. */
  readonly settled: boolean;
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

/** How an incident that is not a real-world incident is named. */
export const INCIDENT_KIND_LABEL: Readonly<Record<string, string>> = {
  exercise: "Exercise", planned_event: "Planned event", daily_ops: "Daily operations",
};

/** The incident's name, its kind when it is not a real-world incident, and closure. */
export function incidentLabel(i: IncidentSummary): string {
  const kind = INCIDENT_KIND_LABEL[i.kind];
  return `${i.name}${kind ? ` · ${kind}` : ""}${i.closedAt ? " (closed)" : ""}`;
}

export function IncidentProvider(props: { children: ReactNode }) {
  const { client, jurisdictionId, me } = useSession();
  const personId = me?.person.id ?? "";
  // Kept in the person's device store, so a console opened offline still selects the incident its queued work is for.
  const incidents = usePolled(
    () => (jurisdictionId
      ? readKept(`incidents:${personId}:${jurisdictionId}`, () => client.listIncidents(jurisdictionId))
      : Promise.resolve(EMPTY)),
    5000,
    [jurisdictionId, personId],
  );
  const list = incidents.data ?? EMPTY;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const remembered = useCallback((): string | null => {
    try { return jurisdictionId ? localStorage.getItem(lastChoiceKey(personId, jurisdictionId)) : null; } catch { return null; }
  }, [personId, jurisdictionId]);
  const fallbackId = useCallback(() => defaultIncident(list, remembered(), demoIncident()).id, [list, remembered]);
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
        : fallbackId();
      replaceRouteContext({ incidentId: fallback });
      noticeIncident.current = fallback;
      setSelectedId(fallback);
      setSelectionNotice(LINK_REFUSED);
      return;
    }
    if (selectedId && list.some((incident) => incident.id === selectedId)) return;
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    const fallback = fallbackId();
    replaceRouteContext({ incidentId: fallback });
    setSelectedId(fallback);
  }, [list, selectedId, fallbackId]);

  useEffect(() => {
    const onHashChange = () => {
      const requested = parseRouteHash(location.hash).context.incidentId;
      if (!requested) return;
      if (list.some((incident) => incident.id === requested)) {
        if (noticeIncident.current !== requested) setSelectionNotice(null);
        setSelectedId(requested);
      } else if (list.length > 0) {
        setSelectionNotice(LINK_REFUSED);
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
    // The console reopens on this incident next time on this device.
    try { if (jurisdictionId) localStorage.setItem(lastChoiceKey(personId, jurisdictionId), id); } catch { /* no storage */ }
    location.hash = surfaceHash(surface, { incidentId: id });
  }, [list, personId, jurisdictionId]);

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

  const listed = incidents.data !== null;
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
      // A listed incident is always selected once the list is in (above), so
      // a list with incidents and no selection is the moment before that.
      settled: listed ? list.length === 0 || selected !== null : incidents.error !== null,
    };
  }, [list, listed, selectedId, incidentBoardIds, incidentBoards, selectionNotice, selectIncident, selectWhenListed, incidents.loading, incidents.error, incidents.reload]);

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
    <label className="eoc-shell-select is-incident">
      <Icon name="incident" size={20} decorative className="eoc-shell-select-icon" />
      <select
        aria-label="Selected incident"
        value={selectedIncidentId ?? ""}
        onChange={(e) => selectIncident(e.target.value || null)}
      >
        {incidents.map((i) => (
          <option key={i.id} value={i.id}>
            {incidentLabel(i)}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={20} decorative className="eoc-shell-select-chevron" />
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
