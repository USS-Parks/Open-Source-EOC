import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SavedStateListPage,
  SavedStatePayload,
  SavedStateRecord,
  SavedStateWrite,
} from "@openeoc/shared";
import { ActionButton, Menu } from "./controls.js";
import type { OperationalTablePin, OperationalTableViewState } from "./table.js";

export interface TableViewPersistence {
  listTableViewStates(
    incidentId: string,
    options?: { readonly cursor?: string; readonly limit?: number },
  ): Promise<SavedStateListPage>;
  getTableViewState(incidentId: string, key: string): Promise<SavedStateRecord>;
  saveTableViewState(
    incidentId: string,
    key: string,
    input: SavedStateWrite,
  ): Promise<SavedStateRecord>;
  deleteTableViewState(
    incidentId: string,
    key: string,
    expectedRevision: number,
  ): Promise<void>;
}

export interface OperationalTableSavedView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly revision: number;
  readonly view: OperationalTableViewState;
}

export type TableViewControllerStatus =
  | "idle"
  | "loading"
  | "saving"
  | "deleting"
  | "error"
  | "conflict";

export interface TableViewScope {
  readonly personId: string;
  readonly incidentId: string;
  readonly tableId: string;
  readonly tableSchema: string;
}

export interface UseTableViewsOptions extends TableViewScope {
  readonly persistence: TableViewPersistence;
  readonly onApply: (view: OperationalTableViewState, viewId: string) => void;
}

export interface TableViewController {
  readonly views: readonly OperationalTableSavedView[];
  readonly status: TableViewControllerStatus;
  readonly error: string | null;
  readonly activeViewId: string | null;
  readonly apply: (viewId: string) => boolean;
  readonly save: (
    viewId: string,
    label: string,
    view: OperationalTableViewState,
  ) => Promise<boolean>;
  readonly remove: (viewId: string) => Promise<boolean>;
  readonly reload: () => Promise<void>;
}

interface ControllerSnapshot {
  readonly scopeKey: string;
  readonly views: readonly OperationalTableSavedView[];
  readonly status: TableViewControllerStatus;
  readonly error: string | null;
  readonly activeViewId: string | null;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function tableViewStateKey(tableId: string, viewId: string): string {
  if (!SAFE_ID.test(tableId)) throw new Error("tableId must use letters, numbers, dot, underscore, or hyphen");
  if (!SAFE_ID.test(viewId)) throw new Error("viewId must use letters, numbers, dot, underscore, or hyphen");
  const key = `${tableId}:${viewId}`;
  if (key.length > 128) throw new Error("table view key must be at most 128 characters");
  return key;
}

export function tableViewIdFromLabel(label: string): string {
  const id = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!id) throw new Error("view label must include a letter or number");
  return id;
}

function scopeKey(scope: TableViewScope): string {
  return JSON.stringify([scope.personId, scope.incidentId, scope.tableId, scope.tableSchema]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !SAFE_ID.test(key) || typeof item !== "string")) return null;
  const parsed: Record<string, string> = {};
  for (const [key, item] of entries) parsed[key] = item as string;
  return parsed;
}

function parseNumberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !SAFE_ID.test(key) || typeof item !== "number" || !Number.isFinite(item))) return null;
  const parsed: Record<string, number> = {};
  for (const [key, item] of entries) parsed[key] = item as number;
  return parsed;
}

function parsePinRecord(value: unknown): Record<string, OperationalTablePin> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !SAFE_ID.test(key) || !["start", "end", null].includes(item as never))) return null;
  return Object.fromEntries(entries) as Record<string, OperationalTablePin>;
}

export function parseOperationalTableViewState(value: unknown): OperationalTableViewState | null {
  if (!isRecord(value)) return null;
  const order = value.columnOrder;
  const sort = value.sort;
  const pageSize = value.pageSize;
  if (value.density !== "compact" && value.density !== "comfortable") return null;
  if (!Array.isArray(order) || order.some((item) => typeof item !== "string" || !SAFE_ID.test(item))) return null;
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return null;
  const widths = parseNumberRecord(value.columnWidths);
  const pinned = parsePinRecord(value.pinned);
  const filters = parseStringRecord(value.filters);
  if (!widths || !pinned || !filters) return null;
  let parsedSort: OperationalTableViewState["sort"] = null;
  if (sort !== null) {
    if (!isRecord(sort) || typeof sort.columnId !== "string" || !SAFE_ID.test(sort.columnId)) return null;
    if (sort.direction !== "asc" && sort.direction !== "desc") return null;
    parsedSort = { columnId: sort.columnId, direction: sort.direction };
  }
  return {
    density: value.density,
    columnOrder: order as string[],
    columnWidths: widths,
    pinned,
    sort: parsedSort,
    filters,
    page: 0,
    pageSize,
  };
}

function parseSavedView(
  state: SavedStateRecord,
  scope: TableViewScope,
): OperationalTableSavedView | null {
  const prefix = `${scope.tableId}:`;
  if (state.kind !== "table_view" || !state.key.startsWith(prefix)) return null;
  if (state.schemaVersion !== 1 || !isRecord(state.payload)) return null;
  if (state.payload.tableId !== scope.tableId || state.payload.tableSchema !== scope.tableSchema) return null;
  if (typeof state.payload.label !== "string" || state.payload.label.trim().length === 0) return null;
  const view = parseOperationalTableViewState(state.payload.view);
  if (!view) return null;
  const id = state.key.slice(prefix.length);
  if (!SAFE_ID.test(id)) return null;
  return { id, key: state.key, label: state.payload.label, revision: state.revision, view };
}

function savedPayload(
  scope: TableViewScope,
  label: string,
  view: OperationalTableViewState,
): SavedStatePayload {
  const cleanView = {
    density: view.density,
    columnOrder: [...view.columnOrder],
    columnWidths: { ...view.columnWidths },
    pinned: { ...view.pinned },
    sort: view.sort ? { ...view.sort } : null,
    filters: { ...view.filters },
    pageSize: view.pageSize,
  };
  return {
    tableId: scope.tableId,
    tableSchema: scope.tableSchema,
    label: label.trim(),
    view: cleanView,
  } as unknown as SavedStatePayload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Saved views could not be updated.";
}

function isConflict(error: unknown): boolean {
  return isRecord(error) && error.status === 409;
}

function emptySnapshot(key: string): ControllerSnapshot {
  return { scopeKey: key, views: [], status: "loading", error: null, activeViewId: null };
}

export function useOperationalTableViews(options: UseTableViewsOptions): TableViewController {
  const scope = useMemo<TableViewScope>(() => ({
    personId: options.personId,
    incidentId: options.incidentId,
    tableId: options.tableId,
    tableSchema: options.tableSchema,
  }), [options.incidentId, options.personId, options.tableId, options.tableSchema]);
  const currentScopeKey = useMemo(() => scopeKey(scope), [scope]);
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<ControllerSnapshot>(() => emptySnapshot(currentScopeKey));
  const visible = snapshot.scopeKey === currentScopeKey ? snapshot : emptySnapshot(currentScopeKey);

  const load = useCallback(async (key: string, token: number, preserve: boolean) => {
    setSnapshot((previous) => ({
      scopeKey: key,
      views: preserve && previous.scopeKey === key ? previous.views : [],
      activeViewId: preserve && previous.scopeKey === key ? previous.activeViewId : null,
      status: "loading",
      error: null,
    }));
    try {
      const collected: OperationalTableSavedView[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let finished = false;
      while (!finished) {
        const page = await options.persistence.listTableViewStates(
          scope.incidentId,
          cursor ? { cursor, limit: 100 } : { limit: 100 },
        );
        for (const state of page.states) {
          const parsed = parseSavedView(state, scope);
          if (parsed) collected.push(parsed);
        }
        if (!page.nextCursor) {
          finished = true;
          continue;
        }
        if (cursors.has(page.nextCursor)) throw new Error("Saved view pagination repeated a cursor");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (generation.current !== token || scopeKey(scope) !== key) return;
      collected.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
      setSnapshot({ scopeKey: key, views: collected, status: "idle", error: null, activeViewId: null });
    } catch (error) {
      if (generation.current !== token) return;
      setSnapshot((previous) => previous.scopeKey === key
        ? { ...previous, status: "error", error: errorMessage(error) }
        : previous);
    }
  }, [options.persistence, scope]);

  useEffect(() => {
    const token = ++generation.current;
    void load(currentScopeKey, token, false);
    return () => {
      generation.current += 1;
    };
  }, [currentScopeKey, load]);

  const reload = useCallback(async () => {
    const token = ++generation.current;
    await load(currentScopeKey, token, true);
  }, [currentScopeKey, load]);

  const apply = useCallback((viewId: string): boolean => {
    const current = snapshot.scopeKey === currentScopeKey ? snapshot : emptySnapshot(currentScopeKey);
    const view = current.views.find((candidate) => candidate.id === viewId);
    if (!view) return false;
    options.onApply(view.view, view.id);
    setSnapshot((previous) => previous.scopeKey === currentScopeKey
      ? { ...previous, activeViewId: view.id, error: null }
      : previous);
    return true;
  }, [currentScopeKey, options, snapshot]);

  const save = useCallback(async (
    viewId: string,
    label: string,
    view: OperationalTableViewState,
  ): Promise<boolean> => {
    const current = snapshot.scopeKey === currentScopeKey ? snapshot : emptySnapshot(currentScopeKey);
    const previous = current.views.find((candidate) => candidate.id === viewId);
    const token = ++generation.current;
    setSnapshot((state) => state.scopeKey === currentScopeKey
      ? { ...state, status: "saving", error: null }
      : state);
    try {
      const key = tableViewStateKey(scope.tableId, viewId);
      const saved = await options.persistence.saveTableViewState(scope.incidentId, key, {
        schemaVersion: 1,
        expectedRevision: previous?.revision ?? 0,
        payload: savedPayload(scope, label, view),
      });
      if (generation.current !== token || scopeKey(scope) !== currentScopeKey) return false;
      const parsed = parseSavedView(saved, scope);
      if (!parsed) throw new Error("The server returned an invalid table view");
      const next = current.views.filter((candidate) => candidate.id !== viewId).concat(parsed)
        .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
      setSnapshot({ scopeKey: currentScopeKey, views: next, status: "idle", error: null, activeViewId: viewId });
      return true;
    } catch (error) {
      if (generation.current !== token) return false;
      setSnapshot((state) => state.scopeKey === currentScopeKey
        ? { ...state, status: isConflict(error) ? "conflict" : "error", error: errorMessage(error) }
        : state);
      return false;
    }
  }, [currentScopeKey, options.persistence, scope, snapshot]);

  const remove = useCallback(async (viewId: string): Promise<boolean> => {
    const current = snapshot.scopeKey === currentScopeKey ? snapshot : emptySnapshot(currentScopeKey);
    const existing = current.views.find((candidate) => candidate.id === viewId);
    if (!existing) return false;
    const token = ++generation.current;
    setSnapshot((state) => state.scopeKey === currentScopeKey
      ? { ...state, status: "deleting", error: null }
      : state);
    try {
      await options.persistence.deleteTableViewState(scope.incidentId, existing.key, existing.revision);
      if (generation.current !== token || scopeKey(scope) !== currentScopeKey) return false;
      setSnapshot({
        scopeKey: currentScopeKey,
        views: current.views.filter((candidate) => candidate.id !== viewId),
        status: "idle",
        error: null,
        activeViewId: current.activeViewId === viewId ? null : current.activeViewId,
      });
      return true;
    } catch (error) {
      if (generation.current !== token) return false;
      setSnapshot((state) => state.scopeKey === currentScopeKey
        ? { ...state, status: isConflict(error) ? "conflict" : "error", error: errorMessage(error) }
        : state);
      return false;
    }
  }, [currentScopeKey, options.persistence, scope.incidentId, snapshot]);

  return {
    views: visible.views,
    status: visible.status,
    error: visible.error,
    activeViewId: visible.activeViewId,
    apply,
    save,
    remove,
    reload,
  };
}

export function OperationalTableSavedViews(props: {
  readonly controller: TableViewController;
  readonly viewState: OperationalTableViewState;
  readonly scopeKey: string;
}) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(""), [props.scopeKey]);
  const viewId = useMemo(() => {
    if (!label.trim()) return null;
    try {
      return tableViewIdFromLabel(label);
    } catch {
      return null;
    }
  }, [label]);
  const busy = ["loading", "saving", "deleting"].includes(props.controller.status);
  return (
    <div className="eoc-operational-table-saved-views">
      <Menu
        label="Saved views"
        items={[
          ...props.controller.views.map((view) => ({
            id: view.id,
            label: view.label,
            onSelect: () => props.controller.apply(view.id),
          })),
          { id: "reload", label: "Reload saved views", onSelect: () => void props.controller.reload() },
        ]}
      />
      <label>
        <span>View name</span>
        <input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <ActionButton
        loading={props.controller.status === "saving"}
        loadingLabel="Saving view…"
        disabled={busy || !viewId}
        onClick={() => {
          if (viewId) void props.controller.save(viewId, label, props.viewState);
        }}
      >Save view</ActionButton>
      {props.controller.activeViewId ? (
        <ActionButton
          kind="quiet"
          disabled={busy}
          onClick={() => void props.controller.remove(props.controller.activeViewId!)}
        >Delete active view</ActionButton>
      ) : null}
      {props.controller.error ? (
        <p role="alert" data-conflict={props.controller.status === "conflict" || undefined}>
          {props.controller.status === "conflict"
            ? "This saved view changed elsewhere. Your table settings are intact; reload before saving again."
            : props.controller.error}
        </p>
      ) : null}
    </div>
  );
}
