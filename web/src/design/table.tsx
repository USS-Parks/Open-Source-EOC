import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ActionButton, Menu } from "./controls.js";
import { EmptyState, ErrorState, LoadingState } from "./feedback.js";
import "./table.css";

export type OperationalTableDensity = "compact" | "comfortable";
export type OperationalTablePin = "start" | "end" | null;
export type OperationalTableStatus = "ready" | "loading" | "empty" | "error";
export type OperationalTableSortDirection = "asc" | "desc";

export interface OperationalTableSort {
  readonly columnId: string;
  readonly direction: OperationalTableSortDirection;
}

export interface OperationalTableViewState {
  readonly density: OperationalTableDensity;
  readonly columnOrder: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly pinned: Readonly<Record<string, OperationalTablePin>>;
  readonly sort: OperationalTableSort | null;
  readonly filters: Readonly<Record<string, string>>;
  readonly page: number;
  readonly pageSize: number;
}

export interface OperationalTableColumn<Row> {
  readonly id: string;
  readonly header: string;
  readonly value: (row: Row) => string | number | boolean | null | undefined;
  readonly render?: (row: Row) => ReactNode;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly filterPlaceholder?: string;
  readonly missingLabel?: string;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly align?: "start" | "center" | "end";
}

export interface OperationalTableBulkAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onInvoke: (recordIds: readonly string[]) => void;
}

export type OperationalTableSelectionReason =
  | "row"
  | "page"
  | "rows-reconciled"
  | "dataset-changed";

export interface OperationalTableProps<Row> {
  readonly tableId: string;
  readonly caption: string;
  readonly columns: readonly OperationalTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowId: (row: Row) => string;
  readonly datasetKey: string;
  readonly status: OperationalTableStatus;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly viewState: OperationalTableViewState;
  readonly onViewStateChange: (state: OperationalTableViewState, reason: string) => void;
  readonly totalRows: number | null;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (
    ids: ReadonlySet<string>,
    reason: OperationalTableSelectionReason,
  ) => void;
  readonly bulkActions?: readonly OperationalTableBulkAction[];
  readonly toolbar?: ReactNode;
}

const DEFAULT_WIDTH = 180;
const DEFAULT_MIN_WIDTH = 96;
const DEFAULT_MAX_WIDTH = 520;

export function createOperationalTableViewState(
  columns: readonly Pick<OperationalTableColumn<unknown>, "id" | "width">[],
  options: Partial<Pick<OperationalTableViewState, "density" | "pageSize">> = {},
): OperationalTableViewState {
  return {
    density: options.density ?? "compact",
    columnOrder: columns.map((column) => column.id),
    columnWidths: Object.fromEntries(columns.map((column) => [column.id, column.width ?? DEFAULT_WIDTH])),
    pinned: {},
    sort: null,
    filters: {},
    page: 0,
    pageSize: options.pageSize ?? 25,
  };
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

function orderedColumns<Row>(
  columns: readonly OperationalTableColumn<Row>[],
  order: readonly string[],
): readonly OperationalTableColumn<Row>[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const ordered: OperationalTableColumn<Row>[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const column = byId.get(id);
    if (column && !seen.has(id)) {
      seen.add(id);
      ordered.push(column);
    }
  }
  for (const column of columns) if (!seen.has(column.id)) ordered.push(column);
  return ordered;
}

function columnBounds<Row>(column: OperationalTableColumn<Row>) {
  const min = Math.max(64, column.minWidth ?? DEFAULT_MIN_WIDTH);
  const max = Math.max(min, column.maxWidth ?? DEFAULT_MAX_WIDTH);
  return { min, max };
}

function columnWidth<Row>(
  column: OperationalTableColumn<Row>,
  widths: Readonly<Record<string, number>>,
): number {
  const { min, max } = columnBounds(column);
  const requested = widths[column.id] ?? column.width ?? DEFAULT_WIDTH;
  return Math.min(max, Math.max(min, Math.round(requested)));
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

function HeaderCheckbox(props: {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.indeterminate;
  }, [props.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all records on this page"
      checked={props.checked}
      disabled={props.disabled}
      onChange={props.onChange}
    />
  );
}

function ResizeHandle<Row>(props: {
  readonly column: OperationalTableColumn<Row>;
  readonly width: number;
  readonly onWidth: (width: number) => void;
}) {
  const { min, max } = columnBounds(props.column);
  const setDelta = (delta: number) => props.onWidth(Math.min(max, Math.max(min, props.width + delta)));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") setDelta(-step);
    else if (event.key === "ArrowRight") setDelta(step);
    else if (event.key === "Home") props.onWidth(min);
    else if (event.key === "End") props.onWidth(max);
    else return;
    event.preventDefault();
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = props.width;
    const move = (moveEvent: globalThis.PointerEvent) => {
      props.onWidth(Math.min(max, Math.max(min, startWidth + moveEvent.clientX - startX)));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    event.preventDefault();
  }

  return (
    <div
      className="eoc-operational-table-resize"
      role="separator"
      aria-label={`Resize ${props.column.header} column`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={props.width}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}

export function OperationalTable<Row>(props: OperationalTableProps<Row>) {
  const columns = useMemo(
    () => orderedColumns(props.columns, props.viewState.columnOrder),
    [props.columns, props.viewState.columnOrder],
  );
  const rowEntries = useMemo(() => props.rows.map((row) => ({ row, id: props.rowId(row) })), [props.rows, props.rowId]);
  const eligibleIds = useMemo(() => new Set(rowEntries.map((entry) => entry.id)), [rowEntries]);
  const previousDataset = useRef(props.datasetKey);
  const pendingDatasetClear = useRef(false);
  const datasetChanged = previousDataset.current !== props.datasetKey;
  const datasetResetPending = datasetChanged || pendingDatasetClear.current;
  const safeSelectedIds = useMemo(() => {
    if (props.status !== "ready" || datasetResetPending) return new Set<string>();
    return new Set([...props.selectedIds].filter((id) => eligibleIds.has(id)));
  }, [datasetResetPending, eligibleIds, props.selectedIds, props.status]);

  useEffect(() => {
    if (previousDataset.current === props.datasetKey) return;
    previousDataset.current = props.datasetKey;
    pendingDatasetClear.current = props.selectedIds.size > 0;
    if (pendingDatasetClear.current) props.onSelectionChange(new Set(), "dataset-changed");
  }, [props.datasetKey, props.onSelectionChange, props.selectedIds]);

  useEffect(() => {
    if (pendingDatasetClear.current && props.selectedIds.size === 0) {
      pendingDatasetClear.current = false;
    }
  }, [props.selectedIds]);

  useEffect(() => {
    if (datasetResetPending || props.status !== "ready" || sameIds(safeSelectedIds, props.selectedIds)) return;
    props.onSelectionChange(safeSelectedIds, "rows-reconciled");
  }, [datasetResetPending, props.onSelectionChange, props.selectedIds, props.status, safeSelectedIds]);

  const widths = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, columnWidth(column, props.viewState.columnWidths)])),
    [columns, props.viewState.columnWidths],
  );
  const pinOffsets = useMemo(() => {
    const starts: Record<string, number> = {};
    const ends: Record<string, number> = {};
    let start = 44;
    for (const column of columns) {
      if (props.viewState.pinned[column.id] === "start") {
        starts[column.id] = start;
        start += widths[column.id] ?? DEFAULT_WIDTH;
      }
    }
    let end = 0;
    for (const column of [...columns].reverse()) {
      if (props.viewState.pinned[column.id] === "end") {
        ends[column.id] = end;
        end += widths[column.id] ?? DEFAULT_WIDTH;
      }
    }
    return { starts, ends };
  }, [columns, props.viewState.pinned, widths]);

  const changeView = (patch: Partial<OperationalTableViewState>, reason: string) => {
    props.onViewStateChange({ ...props.viewState, ...patch }, reason);
  };
  const changeQuery = (patch: Partial<OperationalTableViewState>, reason: string) => {
    changeView({ ...patch, page: 0 }, reason);
  };
  const setWidth = (columnId: string, width: number) => {
    changeView({ columnWidths: { ...props.viewState.columnWidths, [columnId]: width } }, "column-width");
  };
  const setPin = (columnId: string, pin: OperationalTablePin) => {
    changeView({ pinned: { ...props.viewState.pinned, [columnId]: pin } }, "column-pin");
  };
  const moveColumn = (columnId: string, direction: -1 | 1) => {
    const order = columns.map((column) => column.id);
    const index = order.indexOf(columnId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    changeView({ columnOrder: order }, "column-order");
  };
  const toggleSort = (columnId: string) => {
    const current = props.viewState.sort;
    const sort = current?.columnId !== columnId
      ? { columnId, direction: "asc" as const }
      : current.direction === "asc"
        ? { columnId, direction: "desc" as const }
        : null;
    changeQuery({ sort }, "sort");
  };
  const setFilter = (columnId: string, value: string) => {
    const filters = { ...props.viewState.filters };
    if (value) filters[columnId] = value;
    else delete filters[columnId];
    changeQuery({ filters }, "filter");
  };
  const toggleRow = (id: string) => {
    const next = new Set(safeSelectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onSelectionChange(next, "row");
  };
  const allSelected = eligibleIds.size > 0 && safeSelectedIds.size === eligibleIds.size;
  const togglePage = () => {
    props.onSelectionChange(allSelected ? new Set() : new Set(eligibleIds), "page");
  };
  const selectedForAction = [...safeSelectedIds].sort();
  const selectionDisabled = props.status !== "ready" || eligibleIds.size === 0;

  const columnStyle = (column: OperationalTableColumn<Row>): CSSProperties => {
    const pin = props.viewState.pinned[column.id];
    return {
      width: widths[column.id],
      minWidth: widths[column.id],
      maxWidth: widths[column.id],
      left: pin === "start" ? pinOffsets.starts[column.id] : undefined,
      right: pin === "end" ? pinOffsets.ends[column.id] : undefined,
      textAlign: column.align ?? "start",
    };
  };

  const footerStart = props.totalRows === null
    ? `${rowEntries.length} loaded; total unknown`
    : props.totalRows === 0
      ? "0 records"
      : `${Math.min(props.viewState.page * props.viewState.pageSize + 1, props.totalRows)}–${Math.min((props.viewState.page + 1) * props.viewState.pageSize, props.totalRows)} of ${props.totalRows}`;

  return (
    <section
      className="eoc-operational-table"
      data-density={props.viewState.density}
      data-table-id={props.tableId}
    >
      <div className="eoc-operational-table-toolbar">
        <div className="eoc-operational-table-toolbar-main">{props.toolbar}</div>
        <label className="eoc-operational-table-density">
          <span>Density</span>
          <select
            value={props.viewState.density}
            onChange={(event) => changeView({ density: event.target.value as OperationalTableDensity }, "density")}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
      </div>
      {props.bulkActions?.length ? (
        <div className="eoc-operational-table-bulk" aria-live="polite">
          <strong>{selectedForAction.length} selected on this page</strong>
          {props.bulkActions.map((action) => (
            <ActionButton
              key={action.id}
              kind="secondary"
              disabled={selectionDisabled || selectedForAction.length === 0 || action.disabled}
              onClick={() => action.onInvoke(selectedForAction)}
            >
              {action.label}
            </ActionButton>
          ))}
        </div>
      ) : null}
      {props.status === "loading" ? <LoadingState label={`Loading ${props.caption}`} lines={4} /> : null}
      {props.status === "error" ? (
        <ErrorState
          title={`Could not load ${props.caption}`}
          message={props.errorMessage ?? "The records could not be loaded."}
          action={props.onRetry ? <ActionButton onClick={props.onRetry}>Try again</ActionButton> : undefined}
        />
      ) : null}
      {props.status === "empty" ? (
        <EmptyState
          title={props.emptyTitle ?? "No matching records"}
          description={props.emptyDescription ?? "No records match the current filters."}
        />
      ) : null}
      {props.status === "ready" ? (
        <div className="eoc-operational-table-scroll" tabIndex={0} aria-label={`${props.caption} scroll area`}>
          <table>
            <caption>{props.caption}</caption>
            <thead>
              <tr>
                <th className="eoc-operational-table-select" scope="col">
                  <HeaderCheckbox
                    checked={allSelected}
                    indeterminate={safeSelectedIds.size > 0 && !allSelected}
                    disabled={selectionDisabled}
                    onChange={togglePage}
                  />
                </th>
                {columns.map((column, index) => {
                  const pin = props.viewState.pinned[column.id] ?? null;
                  const sort = props.viewState.sort?.columnId === column.id ? props.viewState.sort.direction : null;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      className={pin ? "is-pinned" : undefined}
                      data-pin={pin ?? undefined}
                      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
                      style={columnStyle(column)}
                    >
                      <div className="eoc-operational-table-heading">
                        {column.sortable ? (
                          <button type="button" className="eoc-operational-table-sort" onClick={() => toggleSort(column.id)}>
                            <span>{column.header}</span><span aria-hidden="true">{sort === "asc" ? "↑" : sort === "desc" ? "↓" : "↕"}</span>
                          </button>
                        ) : <span>{column.header}</span>}
                        <Menu
                          label={`${column.header} column actions`}
                          items={[
                            { id: "pin-start", label: "Pin to start", disabled: pin === "start", onSelect: () => setPin(column.id, "start") },
                            { id: "pin-end", label: "Pin to end", disabled: pin === "end", onSelect: () => setPin(column.id, "end") },
                            { id: "unpin", label: "Unpin", disabled: pin === null, onSelect: () => setPin(column.id, null) },
                            { id: "left", label: "Move left", disabled: index === 0, onSelect: () => moveColumn(column.id, -1) },
                            { id: "right", label: "Move right", disabled: index === columns.length - 1, onSelect: () => moveColumn(column.id, 1) },
                          ]}
                        />
                      </div>
                      <ResizeHandle column={column} width={widths[column.id] ?? DEFAULT_WIDTH} onWidth={(width) => setWidth(column.id, width)} />
                    </th>
                  );
                })}
              </tr>
              <tr className="eoc-operational-table-filter-row">
                <th className="eoc-operational-table-select" scope="col"><span className="eoc-sr-only">Filters</span></th>
                {columns.map((column) => {
                  const pin = props.viewState.pinned[column.id] ?? null;
                  return (
                    <th key={column.id} className={pin ? "is-pinned" : undefined} data-pin={pin ?? undefined} style={columnStyle(column)}>
                      {column.filterable ? (
                        <label>
                          <span className="eoc-sr-only">Filter {column.header}</span>
                          <input
                            type="search"
                            value={props.viewState.filters[column.id] ?? ""}
                            placeholder={column.filterPlaceholder ?? `Filter ${column.header}`}
                            onChange={(event) => setFilter(column.id, event.target.value)}
                          />
                        </label>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowEntries.map(({ row, id }) => (
                <tr key={id} data-selected={safeSelectedIds.has(id) || undefined}>
                  <td className="eoc-operational-table-select">
                    <input
                      type="checkbox"
                      aria-label={`Select record ${id}`}
                      checked={safeSelectedIds.has(id)}
                      onChange={() => toggleRow(id)}
                    />
                  </td>
                  {columns.map((column) => {
                    const value = column.value(row);
                    const missing = value === null || value === undefined || value === "";
                    const pin = props.viewState.pinned[column.id] ?? null;
                    return (
                      <td
                        key={column.id}
                        className={pin ? "is-pinned" : undefined}
                        data-pin={pin ?? undefined}
                        data-missing={missing || undefined}
                        style={columnStyle(column)}
                      >
                        {missing ? <span>{column.missingLabel ?? "Not provided"}</span> : column.render?.(row) ?? String(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="eoc-operational-table-footer">
        <span>{footerStart}</span>
        <label>
          <span>Rows per page</span>
          <select
            value={props.viewState.pageSize}
            onChange={(event) => changeQuery({ pageSize: clampPageSize(Number(event.target.value)) }, "page-size")}
          >
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div className="eoc-operational-table-pages">
          <ActionButton
            kind="quiet"
            disabled={props.status === "loading" || !props.hasPreviousPage}
            onClick={() => changeView({ page: Math.max(0, props.viewState.page - 1) }, "page")}
          >Previous</ActionButton>
          <span>Page {props.viewState.page + 1}</span>
          <ActionButton
            kind="quiet"
            disabled={props.status === "loading" || !props.hasNextPage}
            onClick={() => changeView({ page: props.viewState.page + 1 }, "page")}
          >Next</ActionButton>
        </div>
      </div>
    </section>
  );
}
