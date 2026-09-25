import { describe, expect, it } from "vitest";
import { RESOURCE_REQUEST_REASON_REQUIRED, RESOURCE_REQUEST_STAGES, requestStage } from "../../dictionary/resource-request.js";
import { canTransition, formatCostExport, nextStates, type CostRow } from "../lifecycle.js";
import { buildRecordSchema, STANDARD_TEMPLATES } from "../../index.js";

/**
 * The 213RR lifecycle (F5). The transition guard and the
 * reimbursement cost export are pure and golden-tested here.
 */

describe("resource-request state machine", () => {
  it("reads a stored triaged value on the Resource Requests board as accepted", () => {
    const board = STANDARD_TEMPLATES.find((template) => template.key === "resource_request")!;
    const parsed = buildRecordSchema(board.fields).parse({ item: "Sandbags", quantity: 10, priority: "routine", state: "triaged" });
    expect(parsed.state).toBe("accepted");
  });

  it("permits the NIMS ordering cycle, with acceptance apart from receipt and fulfillment apart from closing", () => {
    expect(canTransition("submitted", "accepted")).toBe(true);
    expect(canTransition("accepted", "sourcing")).toBe(true);
    expect(canTransition("sourcing", "assigned")).toBe(true);
    expect(canTransition("assigned", "deployed")).toBe(true);
    expect(canTransition("deployed", "fulfilled")).toBe(true);
    expect(canTransition("fulfilled", "demobilizing")).toBe(true);
    expect(canTransition("fulfilled", "closed")).toBe(true);
    expect(canTransition("demobilizing", "closed")).toBe(true);
  });

  it("forbids skips, moves out of ended states, and the old name", () => {
    expect(canTransition("submitted", "deployed")).toBe(false);
    expect(canTransition("submitted", "triaged")).toBe(false);
    expect(canTransition("closed", "sourcing")).toBe(false);
    expect(canTransition("cancelled", "submitted")).toBe(false);
    expect(canTransition("declined", "accepted")).toBe(false);
    expect(canTransition("deployed", "cancelled")).toBe(false);
  });

  it("declines only before a source is found", () => {
    expect(canTransition("submitted", "declined")).toBe(true);
    expect(canTransition("accepted", "declined")).toBe(true);
    expect(canTransition("sourcing", "declined")).toBe(false);
  });

  it("reports the reachable states", () => {
    expect(nextStates("sourcing")).toEqual(["assigned", "cancelled"]);
    expect(nextStates("closed")).toEqual([]);
    expect(nextStates("declined")).toEqual([]);
  });

  it("reads each state as its stage, the old accepted name included", () => {
    expect(requestStage("submitted")).toBe("Received");
    expect(requestStage("accepted")).toBe("Accepted");
    expect(requestStage("triaged")).toBe("Accepted");
    expect(requestStage("deployed")).toBe("In progress");
    expect(RESOURCE_REQUEST_STAGES.closed!.next).toBeNull();
    expect(RESOURCE_REQUEST_REASON_REQUIRED).toEqual(["declined", "cancelled"]);
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
