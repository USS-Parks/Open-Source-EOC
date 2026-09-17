import type { ViewDef } from "./fields.js";

export type ViewRecord = Record<string, unknown> & { id: string };

/**
 * Apply a display view's filters and sort. One implementation serves the
 * server and the browser so a view can never mean two different things.
 */
export function applyView(view: ViewDef, records: readonly ViewRecord[]): ViewRecord[] {
  let out = [...records];
  for (const f of view.filter) {
    out = out.filter((rec) => {
      const v = rec[f.field];
      if (f.op === "eq") return v === f.value;
      if (f.op === "neq") return v !== f.value;
      return Array.isArray(f.value) && f.value.includes(String(v));
    });
  }
  if (view.sort) {
    const { field, dir } = view.sort;
    out.sort((a, b) => {
      const av = String(a[field] ?? "");
      const bv = String(b[field] ?? "");
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  return out;
}
