import { applyView, type ViewRecord } from "@openeoc/shared";
import type { BoardTemplate } from "@openeoc/shared";
import { BoardTable } from "../design/layout.js";

/**
 * Display view: a board's records through one of its declared views.
 * Rendering is a pure function of records, so when the sync layer
 * (VEOC-13) streams updates into state, every open view follows.
 */
export function BoardView(props: {
  template: BoardTemplate;
  viewKey: string;
  records: readonly ViewRecord[];
}) {
  const view = props.template.views.find((v) => v.key === props.viewKey);
  if (!view) return <p role="alert">Unknown view: {props.viewKey}</p>;
  const rows = applyView(view, props.records);
  const labels = new Map(props.template.fields.map((f) => [f.key, f.label]));
  return (
    <BoardTable
      caption={`${props.template.title}: ${view.title}`}
      columns={view.columns.map((c) => labels.get(c) ?? c)}
      rows={rows.map((r) => view.columns.map((c) => formatCell(r[c])))}
    />
  );
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
