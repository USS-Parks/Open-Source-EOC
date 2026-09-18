import { describe, expect, it } from "vitest";
import { canTransition, formatCostExport, nextStates, type CostRow } from "../lifecycle.js";

/**
 * The 213RR lifecycle (VEOC-35, F5). The transition guard and the
 * reimbursement cost export are pure and golden-tested here.
 */

describe("resource-request state machine", () => {
  it("permits the NIMS ordering cycle", () => {
    expect(canTransition("submitted", "triaged")).toBe(true);
    expect(canTransition("triaged", "sourcing")).toBe(true);
    expect(canTransition("sourcing", "assigned")).toBe(true);
    expect(canTransition("assigned", "deployed")).toBe(true);
    expect(canTransition("deployed", "demobilizing")).toBe(true);
    expect(canTransition("demobilizing", "closed")).toBe(true);
  });

  it("forbids skips and moves out of terminal states", () => {
    expect(canTransition("submitted", "deployed")).toBe(false);
    expect(canTransition("closed", "sourcing")).toBe(false);
    expect(canTransition("cancelled", "submitted")).toBe(false);
    expect(canTransition("deployed", "cancelled")).toBe(false);
  });

  it("reports the reachable states", () => {
    expect(nextStates("sourcing")).toEqual(["assigned", "cancelled"]);
    expect(nextStates("closed")).toEqual([]);
  });
});

describe("cost export", () => {
  it("formats a deterministic reimbursement CSV with a total", () => {
    const rows: CostRow[] = [
      { requestId: "r1", item: "Type 3 Engine", category: "equipment", description: "48 hrs", amountCents: 250000, incurredAt: "2026-09-18" },
      { requestId: "r1", item: "Type 3 Engine", category: "personnel", description: "Crew, with a comma", amountCents: 180050, incurredAt: "2026-09-18" },
    ];
    const csv = formatCostExport(rows);
    expect(csv).toBe(
      "Request,Item,Category,Description,Amount (USD),Incurred\n" +
        "r1,Type 3 Engine,equipment,48 hrs,2500.00,2026-09-18\n" +
        'r1,Type 3 Engine,personnel,"Crew, with a comma",1800.50,2026-09-18\n' +
        ",,,TOTAL,4300.50,\n",
    );
  });
});
