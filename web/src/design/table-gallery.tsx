import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SavedStateListPage, SavedStateRecord, SavedStateWrite } from "@openeoc/shared";
import { Theme, StatusBadge } from "./components.js";
import { ActionButton } from "./controls.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableStatus,
  type OperationalTableViewState,
} from "./table.js";
import {
  OperationalTableSavedViews,
  useOperationalTableViews,
  type TableViewPersistence,
} from "./table-saved-views.js";
import "./table-gallery.css";

interface WorkRow {
  readonly id: string;
  readonly request: string;
  readonly owner: string | null;
  readonly status: "Open" | "Assigned" | "Blocked" | "Complete";
  readonly due: string | null;
  readonly function: string;
  readonly activation: string;
  readonly coordinator: string | null;
  readonly missions: number;
}

const rows: readonly WorkRow[] = [
  { id: "REQ-1042", request: "Coordinate generator delivery for the remote mountain communications site", owner: "Morgan Alvarez", status: "Assigned", due: "14:30", function: "CA ESF 2 — Communications", activation: "Partial", coordinator: "Morgan Alvarez", missions: 4 },
  { id: "REQ-1048", request: "Confirm accessible transportation for assisted-living evacuation", owner: null, status: "Open", due: "15:00", function: "CA ESF 1 — Transportation", activation: "Full", coordinator: "Avery Chen", missions: 7 },
  { id: "REQ-1051", request: "Stage potable water at the north shelter reception point", owner: "Jordan Okafor", status: "Blocked", due: null, function: "CA ESF 6 — Mass Care and Shelter", activation: "Full", coordinator: "Jordan Okafor", missions: 12 },
  { id: "REQ-1055", request: "Validate hospital fuel burn rate for the next operational period", owner: "Priya Nair", status: "Assigned", due: "16:45", function: "CA ESF 8 — Public Health and Medical", activation: "Partial", coordinator: "Priya Nair", missions: 5 },
  { id: "REQ-1060", request: "Publish debris clearance priority routes to field supervisors", owner: "Sam Rivera", status: "Complete", due: "13:15", function: "CA ESF 3 — Construction and Engineering", activation: "Monitoring", coordinator: null, missions: 0 },
  { id: "REQ-1064", request: "Reconcile unmet animal sheltering requests from branch offices", owner: "Taylor Brooks", status: "Open", due: "18:00", function: "CA ESF 11 — Agriculture", activation: "Partial", coordinator: "Taylor Brooks", missions: 3 },
];

const statusKind = (status: WorkRow["status"]) => status === "Blocked" ? "critical" : status === "Complete" ? "success" : status === "Assigned" ? "info" : "warning";

const priorityColumns: readonly OperationalTableColumn<WorkRow>[] = [
  { id: "request", header: "Priority request", value: (row) => row.request, sortable: true, filterable: true, width: 390, minWidth: 220, maxWidth: 560 },
  { id: "owner", header: "Owner", value: (row) => row.owner, sortable: true, filterable: true, width: 180 },
  { id: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={statusKind(row.status)}>{row.status}</StatusBadge>, sortable: true, filterable: true, width: 145 },
  { id: "due", header: "Due", value: (row) => row.due, sortable: true, width: 110, align: "end" },
];

const esfColumns: readonly OperationalTableColumn<WorkRow>[] = [
  { id: "function", header: "Function", value: (row) => row.function, sortable: true, filterable: true, width: 340, minWidth: 220, maxWidth: 520 },
  { id: "activation", header: "Activation", value: (row) => row.activation, sortable: true, filterable: true, width: 150 },
  { id: "coordinator", header: "Coordinator", value: (row) => row.coordinator, sortable: true, filterable: true, width: 190 },
  { id: "missions", header: "Open missions", value: (row) => row.missions, sortable: true, width: 145, align: "end" },
];

class MemoryTableViews implements TableViewPersistence {
  private readonly records = new Map<string, SavedStateRecord>();

  async listTableViewStates(_incidentId: string, options?: { cursor?: string; limit?: number }): Promise<SavedStateListPage> {
    const keys = [...this.records.keys()].sort();
    const start = options?.cursor ? keys.findIndex((key) => key === options.cursor) + 1 : 0;
    const limit = options?.limit ?? 100;
    const pageKeys = keys.slice(Math.max(0, start), Math.max(0, start) + limit);
    return {
      states: pageKeys.map((key) => this.records.get(key)!),
      nextCursor: start + limit < keys.length ? pageKeys.at(-1) ?? null : null,
    };
  }

  async getTableViewState(_incidentId: string, key: string): Promise<SavedStateRecord> {
    const state = this.records.get(key);
    if (!state) throw new Error("Saved view not found");
    return state;
  }

  async saveTableViewState(incidentId: string, key: string, input: SavedStateWrite): Promise<SavedStateRecord> {
    const previous = this.records.get(key);
    if ((previous?.revision ?? 0) !== input.expectedRevision) {
      throw Object.assign(new Error("revision conflict"), { status: 409 });
    }
    const now = new Date().toISOString();
    const state: SavedStateRecord = {
      incidentId,
      kind: "table_view",
      key,
      schemaVersion: input.schemaVersion,
      revision: (previous?.revision ?? 0) + 1,
      payload: input.payload,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, state);
    return state;
  }

  async deleteTableViewState(_incidentId: string, key: string, expectedRevision: number): Promise<void> {
    const previous = this.records.get(key);
    if (!previous || previous.revision !== expectedRevision) {
      throw Object.assign(new Error("revision conflict"), { status: 409 });
    }
    this.records.delete(key);
  }
}

function sortAndFilter(
  source: readonly WorkRow[],
  columns: readonly OperationalTableColumn<WorkRow>[],
  state: OperationalTableViewState,
): readonly WorkRow[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const filtered = source.filter((row) => Object.entries(state.filters).every(([columnId, filter]) => {
    const column = byId.get(columnId);
    if (!column) return true;
    return String(column.value(row) ?? "").toLocaleLowerCase().includes(filter.toLocaleLowerCase());
  }));
  const column = state.sort ? byId.get(state.sort.columnId) : undefined;
  if (!column || !state.sort) return filtered;
  const direction = state.sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => String(column.value(left) ?? "").localeCompare(String(column.value(right) ?? ""), undefined, { numeric: true }) * direction);
}

function Gallery() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tableKind, setTableKind] = useState<"priority" | "esf">("priority");
  const [demoStatus, setDemoStatus] = useState<OperationalTableStatus>("ready");
  const columns = tableKind === "priority" ? priorityColumns : esfColumns;
  const [stateByTable, setStateByTable] = useState<Record<string, OperationalTableViewState>>(() => ({
    priority: { ...createOperationalTableViewState(priorityColumns), pinned: { request: "start" } },
    esf: { ...createOperationalTableViewState(esfColumns), pinned: { function: "start" } },
  }));
  const state = stateByTable[tableKind]!;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState("No bulk action has run.");
  const persistence = useMemo(() => new MemoryTableViews(), []);
  const tableId = tableKind === "priority" ? "priority-work" : "related-esfs";
  const schema = tableKind === "priority" ? "priority-v1" : "esf-v1";
  const savedViews = useOperationalTableViews({
    persistence,
    personId: "gallery-operator",
    incidentId: "gallery-incident",
    tableId,
    tableSchema: schema,
    onApply: (view) => setStateByTable((current) => ({ ...current, [tableKind]: view })),
  });
  const filtered = sortAndFilter(rows, columns, state);
  const start = state.page * state.pageSize;
  const pageRows = filtered.slice(start, start + state.pageSize);
  const status = demoStatus === "ready" && filtered.length === 0 ? "empty" : demoStatus;

  const switchTable = (next: "priority" | "esf") => {
    setTableKind(next);
    setSelectedIds(new Set());
    setDemoStatus("ready");
  };

  return (
    <Theme name={theme}>
      <main className="d07-gallery" data-review-theme={theme}>
        <header className="d07-gallery-header">
          <div>
            <span className="d07-gallery-eyebrow">Operational table system</span>
            <h1>Current work, aligned for quick scanning</h1>
            <p>Dense incident records remain readable, explicit, and safe for scoped actions.</p>
          </div>
          <div className="d07-gallery-switches">
            <ActionButton kind="secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Use dark theme" : "Use light theme"}</ActionButton>
            <ActionButton kind={tableKind === "priority" ? "primary" : "secondary"} onClick={() => switchTable("priority")}>Priority work</ActionButton>
            <ActionButton kind={tableKind === "esf" ? "primary" : "secondary"} onClick={() => switchTable("esf")}>Related ESFs</ActionButton>
          </div>
        </header>
        <section className="d07-gallery-state-controls" aria-label="Review states">
          {(["ready", "loading", "empty", "error"] as const).map((item) => (
            <ActionButton key={item} kind={demoStatus === item ? "primary" : "quiet"} onClick={() => setDemoStatus(item)}>{item[0]!.toUpperCase() + item.slice(1)}</ActionButton>
          ))}
        </section>
        <OperationalTable
          tableId={tableId}
          caption={tableKind === "priority" ? "Priority work" : "Related ESF coordination"}
          columns={columns}
          rows={pageRows}
          rowId={(row) => row.id}
          datasetKey={`${tableId}:${schema}`}
          status={status}
          errorMessage="The operational records service is unavailable. Existing selections cannot be acted on."
          onRetry={() => setDemoStatus("ready")}
          viewState={state}
          onViewStateChange={(next) => setStateByTable((current) => ({ ...current, [tableKind]: next }))}
          totalRows={filtered.length}
          hasPreviousPage={state.page > 0}
          hasNextPage={start + state.pageSize < filtered.length}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          bulkActions={[{
            id: "assign",
            label: "Assign selected",
            onInvoke: (ids) => setNotice(`Exact records queued: ${ids.join(", ")}`),
          }]}
          toolbar={(
            <OperationalTableSavedViews
              controller={savedViews}
              viewState={state}
              scopeKey={`gallery-operator:gallery-incident:${tableId}:${schema}`}
            />
          )}
        />
        <p className="d07-gallery-notice" role="status">{notice}</p>
      </main>
    </Theme>
  );
}

export function mountOperationalTableReview(element: Element) {
  createRoot(element).render(<Gallery />);
}
