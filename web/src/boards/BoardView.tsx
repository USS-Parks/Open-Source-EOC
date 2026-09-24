import { useEffect, useMemo, useState, type ReactNode } from "react";
import { applyView, choiceLabel, type FieldDef, type ViewRecord } from "@openeoc/shared";
import type { BoardTemplate } from "@openeoc/shared";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../design/table.js";
import "./board-tools.css";

/**
 * Display view: a board's records through one of its declared views.
 * Rendering is a pure function of records, so when the sync layer
 * streams updates into state, every open view follows.
 */
export function BoardView(props: {
  template: BoardTemplate;
  viewKey: string;
  records: readonly ViewRecord[];
  viewState?: OperationalTableViewState;
  onViewStateChange?: (state: OperationalTableViewState, reason: string) => void;
  selectedRecordId?: string | null;
  onSelectRecord?: (recordId: string | null) => void;
  toolbar?: ReactNode;
  status?: "ready" | "loading" | "empty" | "error";
  errorMessage?: string;
  onRetry?: () => void;
  onLoadMore?: () => Promise<void>;
}) {
  const view = props.template.views.find((v) => v.key === props.viewKey);
  if (!view) return <p role="alert">Unknown view: {props.viewKey}</p>;

  return <ResolvedBoardView {...props} view={view} />;
}

function ResolvedBoardView(props: Parameters<typeof BoardView>[0] & {
  view: BoardTemplate["views"][number];
}) {
  const fields = useMemo(() => new Map(props.template.fields.map((field) => [field.key, field])), [props.template.fields]);
  const columns = useMemo<readonly OperationalTableColumn<ViewRecord>[]>(() => props.view.columns.map((key, index) => ({
    id: key,
    header: fields.get(key)?.label ?? key,
    value: (record) => formatCell(record[key], fields.get(key)?.type),
    render: (record) => <span title={formatCell(record[key], fields.get(key)?.type)}>{formatCell(record[key], fields.get(key)?.type)}
      {index === 0 && record.archivedAt ? <span className="board-archived-tag">Archived</span> : null}</span>,
    sortable: true,
    filterable: true,
    missingLabel: "Unavailable",
  })), [fields, props.view.columns]);
  const defaultState = useMemo(() => createOperationalTableViewState(columns), [columns]);
  const [localState, setLocalState] = useState(defaultState);
  const [localSelection, setLocalSelection] = useState<ReadonlySet<string>>(new Set());
  const state = props.viewState ?? localState;

  useEffect(() => {
    if (!props.viewState) setLocalState(defaultState);
    if (props.selectedRecordId === undefined) setLocalSelection(new Set());
  }, [defaultState, props.selectedRecordId, props.viewKey, props.viewState]);

  const filtered = useMemo(() => {
    const base = applyView(props.view, props.records, { fields: props.template.fields });
    const rows = base.filter((record) => Object.entries(state.filters).every(([key, expected]) =>
      formatCell(record[key]).toLocaleLowerCase().includes(expected.trim().toLocaleLowerCase())));
    if (!state.sort) return rows;
    const { columnId, direction } = state.sort;
    return [...rows].sort((left, right) => {
      const order = formatCell(left[columnId]).localeCompare(formatCell(right[columnId]), undefined, { numeric: true });
      return direction === "asc" ? order : -order;
    });
  }, [props.records, props.template.fields, props.view, state.filters, state.sort]);
  const pageStart = state.page * state.pageSize;
  const rows = filtered.slice(pageStart, pageStart + state.pageSize);
  const selectedIds = props.selectedRecordId === undefined
    ? localSelection
    : new Set(props.selectedRecordId ? [props.selectedRecordId] : []);
  const changeView = (next: OperationalTableViewState, reason: string) => {
    if (props.onViewStateChange) props.onViewStateChange(next, reason);
    else setLocalState(next);
  };
  const changeSelection = (next: ReadonlySet<string>, reason: string) => {
    const newest = [...next].find((id) => !selectedIds.has(id)) ?? [...next][0] ?? null;
    // An opened record may sit outside the loaded rows, as a linked record on
    // another page or outside the incident does; only the operator changes it.
    if (props.onSelectRecord && reason === "rows-reconciled") return;
    if (props.onSelectRecord) props.onSelectRecord(newest);
    else setLocalSelection(newest ? new Set([newest]) : new Set());
  };

  return (
    <OperationalTable
      tableId={`${props.template.key}.${props.view.key}`}
      caption={`${props.template.title}: ${props.view.title}`}
      columns={columns}
      rows={rows}
      rowId={(record) => record.id}
      datasetKey={`${props.template.key}:${props.template.version}:${props.view.key}`}
      status={props.status ?? (props.records.length ? "ready" : "empty")}
      {...(props.errorMessage ? { errorMessage: props.errorMessage } : {})}
      {...(props.onRetry ? { onRetry: props.onRetry } : {})}
      {...(props.onLoadMore ? { onLoadMore: props.onLoadMore } : {})}
      emptyTitle="No records in this view"
      emptyDescription="Clear a filter or choose another board view."
      viewState={state}
      onViewStateChange={changeView}
      totalRows={filtered.length}
      hasPreviousPage={state.page > 0}
      hasNextPage={pageStart + state.pageSize < filtered.length}
      selectedIds={selectedIds}
      onSelectionChange={changeSelection}
      toolbar={props.toolbar ?? <strong>{props.view.title}</strong>}
    />
  );
}

function formatCell(value: unknown, type?: FieldDef["type"]): string {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return type === "enum" ? choiceLabel(String(value)) : String(value);
}
