import { tableCsv } from "../boards/transfer.js";

/**
 * A fixed-taxonomy import template: the heading row, then each enumerated
 * column's allowed values listed down beneath its heading. The rows are a
 * reference to replace with records, not records.
 */
export function taxonomyTemplateCsv(headers: readonly string[], values: Readonly<Record<string, readonly string[]>>): string {
  const depth = Math.max(0, ...headers.map((header) => values[header]?.length ?? 0));
  const rows = Array.from({ length: depth }, (_, i) => headers.map((header) => values[header]?.[i] ?? ""));
  return tableCsv({ headers, rows });
}
