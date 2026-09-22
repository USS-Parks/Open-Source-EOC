import { RESOURCE_REQUEST_TRANSITIONS } from "../dictionary/resource-request.js";

/**
 * The 213RR resource-request lifecycle (F5). The state machine is
 * the dictionary's transition table; these helpers make it enforceable, and
 * the cost export formats a request's incurred costs for reimbursement. All
 * pure, so both are golden-testable with no database.
 */

/** Whether a request may move from one state to another. */
export function canTransition(from: string, to: string): boolean {
  return (RESOURCE_REQUEST_TRANSITIONS[from] ?? []).includes(to as never);
}

/** The states reachable from a given state. */
export function nextStates(from: string): readonly string[] {
  return RESOURCE_REQUEST_TRANSITIONS[from] ?? [];
}

export interface CostRow {
  readonly requestId: string;
  readonly item: string;
  readonly category: string;
  readonly description: string;
  readonly amountCents: number;
  readonly incurredAt: string;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function usd(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Format incurred costs as a deterministic CSV for reimbursement
 * documentation, with a trailing total row. Rows render in the order given.
 */
export function formatCostExport(rows: readonly CostRow[]): string {
  const header = ["Request", "Item", "Category", "Description", "Amount (USD)", "Incurred"];
  const lines = [header.join(",")];
  let total = 0;
  for (const r of rows) {
    total += r.amountCents;
    lines.push(
      [
        csvCell(r.requestId),
        csvCell(r.item),
        csvCell(r.category),
        csvCell(r.description),
        usd(r.amountCents),
        csvCell(r.incurredAt),
      ].join(","),
    );
  }
  lines.push(["", "", "", "TOTAL", usd(total), ""].join(","));
  return lines.join("\n") + "\n";
}
