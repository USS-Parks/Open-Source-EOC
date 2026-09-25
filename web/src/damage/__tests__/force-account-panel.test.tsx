// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForceAccountSummary } from "@openeoc/shared";
import { ForceAccountPanel } from "../ForceAccountPanel.js";

afterEach(cleanup);

const summary: ForceAccountSummary = {
  incidentId: "i1", timeZone: "UTC",
  labor: [
    { personId: "p1", personName: "Mia Member", jobTitle: "Road crew lead", date: "2026-09-20", sources: ["check_in"], regularHours: 8,
      overtimeHours: 3.5, regularCostCents: 30000, overtimeCostCents: 17325, costCents: 47325, hourlyRate: 30, overtimeRate: 45,
      fringePercent: 25, overtimeFringePercent: 10 },
    { personId: "p2", personName: "Sam Shift", jobTitle: null, date: "2026-09-19", sources: ["shift"], regularHours: 4,
      overtimeHours: 0, regularCostCents: 0, overtimeCostCents: 0, costCents: 0, hourlyRate: null, overtimeRate: null,
      fringePercent: null, overtimeFringePercent: null },
  ],
  equipment: [{ id: "e1", resourceId: "r1", resourceName: "Dump truck 12", code: "8072", equipment: "Truck, Dump", capacity: "12 CY",
    unit: "hour", operatorName: "Mia Member", date: "2026-09-20", quantity: 6, rate: 58.19, note: "", costCents: 34914 }],
  totals: { regularHours: 12, overtimeHours: 3.5, laborCents: 47325, equipmentCents: 34914, totalCents: 82239 },
  unratedPeople: [{ personId: "p2", personName: "Sam Shift" }],
  unratedCodes: [],
};

function client() {
  return {
    forceAccount: vi.fn().mockResolvedValue(summary),
    paRates: vi.fn().mockResolvedValue({
      labor: [{ personId: "p1", personName: "Mia Member", jobTitle: "Road crew lead", hourlyRate: 30, overtimeRate: 45, fringePercent: 25, overtimeFringePercent: 10, overtimeAfterHours: 8 }],
      equipment: [{ code: "8072", equipment: "Truck, Dump", manufacturer: "", specification: "", capacity: "12 CY", hp: "", notes: "", unit: "hour", rate: 58.19, source: "fema", edition: "FEMA 2025" }],
    }),
    setLaborRate: vi.fn().mockResolvedValue({ personId: "p2", personName: "Sam Shift" }),
    importEquipmentRates: vi.fn().mockResolvedValue({ inserted: 2, updated: 0 }),
    recordEquipmentHours: vi.fn().mockResolvedValue({ id: "e2" }),
    removeEquipmentHours: vi.fn().mockResolvedValue(undefined),
    rollUpForceAccount: vi.fn().mockResolvedValue({ paItemId: "pa1", summary }),
    listResources: vi.fn().mockResolvedValue([{ id: "r1", name: "Dump truck 12" }]),
    listPaItems: vi.fn().mockResolvedValue({
      items: [{ id: "pa1", incident_id: "i1", applicant: "Yurok Tribe", category: "b_emergency_protective_measures", description: "Flood fight" },
        { id: "pa2", incident_id: "other", applicant: "Elsewhere", category: "a_debris_removal", description: "Other incident" }],
      nextCursor: null, totals: { byCategory: {}, totalCost: 0, items: 0 },
    }),
  };
}

function show(api = client(), isAdmin = true) {
  const onChanged = vi.fn();
  const view = render(<ForceAccountPanel client={api} jurisdictionId="j1" incidentId="i1" incidentName="River Flood" isAdmin={isAdmin} onChanged={onChanged} />);
  return { view, api, onChanged };
}

describe("force account on screen", () => {
  it("shows labor and equipment with their totals, and who has no rate", async () => {
    const { view } = show();
    const labor = await view.findByRole("table", { name: "Labor" });
    expect(within(labor).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "NameJob titleDateRegular hoursOvertime hoursCostFrom",
      "Mia MemberRoad crew lead2026-09-2083.5$473.25check-in",
      "Sam ShiftNo labor rate2026-09-1940$0.00shift",
    ]);
    expect(view.getByRole("table", { name: "Equipment" }).textContent).toContain("Dump truck 12: Truck, Dump8072Mia Member2026-09-206 hours$58.19 per hour$349.14");
    expect(view.getByLabelText("Force account totals").textContent).toContain("$822.39");
    expect(view.getByRole("note").textContent).toContain("Costed at nothing until they have a rate: Sam Shift.");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("records equipment hours against a pool resource and a scheduled rate", async () => {
    const { view, api } = show();
    const form = await view.findByRole("form", { name: "Record equipment hours" });
    await within(form).findByRole("option", { name: "Dump truck 12" });
    fireEvent.change(within(form).getByLabelText("Pool resource"), { target: { value: "r1" } });
    fireEvent.change(within(form).getByLabelText("Equipment rate code"), { target: { value: "8072" } });
    fireEvent.change(within(form).getByLabelText("Operator"), { target: { value: "p1" } });
    fireEvent.change(within(form).getByLabelText("Date used"), { target: { value: "2026-09-21" } });
    fireEvent.change(within(form).getByLabelText("Hours used"), { target: { value: "2.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record hours" }));
    await view.findByText("Equipment hours recorded.");
    expect(api.recordEquipmentHours).toHaveBeenCalledWith("i1", {
      resourceId: "r1", rateCode: "8072", operatorPersonId: "p1", usedOn: "2026-09-21", quantity: 2.5, note: "",
    });
  });

  it("sets a labor rate for someone without one and rolls the account into this incident's line item", async () => {
    const { view, api, onChanged } = show();
    fireEvent.click(await view.findByRole("button", { name: "Set a labor rate for Sam Shift" }));
    const rate = view.getByRole("form", { name: "Labor rate for Sam Shift" });
    fireEvent.change(within(rate).getByLabelText("Job title"), { target: { value: "Equipment operator" } });
    fireEvent.change(within(rate).getByLabelText("Hourly rate (dollars)"), { target: { value: "32.5" } });
    fireEvent.click(within(rate).getByRole("button", { name: "Save labor rate" }));
    await view.findByText("Labor rate saved for Sam Shift.");
    expect(api.setLaborRate).toHaveBeenCalledWith("j1", "p2", {
      jobTitle: "Equipment operator", hourlyRate: 32.5, overtimeRate: null, fringePercent: 0, overtimeFringePercent: null, overtimeAfterHours: 8,
    });
    const roll = view.getByRole("form", { name: "Roll into a line item" });
    await within(roll).findByRole("option", { name: "Yurok Tribe, Category B: Emergency protective measures: Flood fight" });
    const options = within(roll).getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("Yurok Tribe, Category B: Emergency protective measures: Flood fight");
    expect(options).not.toContain("Elsewhere, Category A: Debris removal: Other incident");
    fireEvent.change(within(roll).getByLabelText("Line item"), { target: { value: "pa1" } });
    fireEvent.click(within(roll).getByRole("button", { name: "Roll into line item" }));
    await view.findByText("The line item's estimated cost is now $822.39, from the force account.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("imports FEMA's schedule from its CSV file", async () => {
    const { view, api } = show();
    const form = await view.findByRole("form", { name: "Import equipment rates" });
    const file = new File([
      "Cost Code,Equipment ,Specifications,Capacity or Size,HP,Notes,Unit, 2019 Updated Rate \r\n"
      + "8010,Air Compressor,Air Delivery,41 CFM,to 10,Hoses included.,hour,$1.62 \r\n"
      + "8011,Air Compressor,Air Delivery,103 CFM,to 30,Hoses included.,hour,$9.86 \r\n"
      + "8012,Air Compressor,Air Delivery,130 CFM,to 50,,hour,see note\r\n",
    ], "fema_schedule-of-equipment-rates_2019.csv", { type: "text/csv" });
    fireEvent.change(within(form).getByLabelText("Rate schedule (CSV)"), { target: { files: [file] } });
    fireEvent.change(within(form).getByLabelText("Edition"), { target: { value: "FEMA 2019" } });
    fireEvent.click(within(form).getByRole("button", { name: "Import rates" }));
    await view.findByText('2 rates added and 0 replaced from FEMA 2019. 1 lines were left out: line 4, the rate "see note" is not an amount.');
    expect(api.importEquipmentRates).toHaveBeenCalledWith("j1", expect.objectContaining({
      edition: "FEMA 2019", source: "fema",
      rows: [expect.objectContaining({ code: "8010", rate: 1.62 }), expect.objectContaining({ code: "8011", capacity: "103 CFM", rate: 9.86 })],
    }));
  });

  it("leaves rates to administrators", async () => {
    const { view } = show(client(), false);
    await view.findByRole("table", { name: "Labor" });
    expect(view.queryByRole("form", { name: "Import equipment rates" })).toBeNull();
    expect(view.queryByRole("button", { name: /Set a labor rate|Edit the labor rate/ })).toBeNull();
  });
});
