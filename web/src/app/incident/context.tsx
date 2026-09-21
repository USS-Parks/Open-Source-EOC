import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { IncidentSummary } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync } from "../data/hooks.js";

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

export interface IncidentValue {
  readonly incidents: readonly IncidentSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedIncidentId: string | null;
  readonly selectedIncident: IncidentSummary | null;
  /** Board ids the selected incident uses, so a surface can tag a contributed
   *  record with the incident only when its board belongs to it (VEOC-79B2). */
  readonly incidentBoardIds: ReadonlySet<string>;
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
  const incidents = useAsync(
    () => (jurisdictionId ? client.listIncidents(jurisdictionId) : Promise.resolve(EMPTY)),
    [jurisdictionId],
  );
  const list = incidents.data ?? EMPTY;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A jurisdiction switch must never carry a foreign incident id forward.
  useEffect(() => {
    setSelectedId(null);
  }, [jurisdictionId]);

  // Default to the first open incident once the list loads, and never keep a
  // selection that is no longer in the list. An explicit still-valid choice
  // is preserved.
  useEffect(() => {
    setSelectedId((cur) => {
      if (cur && list.some((i) => i.id === cur)) return cur;
      if (list.length === 0) return null;
      return (list.find((i) => !i.closedAt) ?? list[0]!).id;
    });
  }, [list]);

  // The boards the selected incident uses, so a contributed record is tagged
  // with the incident only when its board belongs to it.
  const activeId = list.find((i) => i.id === selectedId)?.id ?? null;
  const boardIds = useAsync(
    () => (activeId ? client.incidentBoardIds(activeId) : Promise.resolve(EMPTY_IDS)),
    [activeId],
  );
  const incidentBoardIds = useMemo(() => new Set(boardIds.data ?? EMPTY_IDS), [boardIds.data]);

  const value = useMemo<IncidentValue>(() => {
    const selected = list.find((i) => i.id === selectedId) ?? null;
    return {
      incidents: list,
      loading: incidents.loading,
      error: incidents.error,
      selectedIncidentId: selected?.id ?? null,
      selectedIncident: selected,
      incidentBoardIds,
      selectIncident: setSelectedId,
      reload: incidents.reload,
    };
  }, [list, selectedId, incidentBoardIds, incidents.loading, incidents.error, incidents.reload]);

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
  const { incidents, selectedIncidentId, selectIncident, loading, error } = useIncident();
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
    </label>
  );
}
