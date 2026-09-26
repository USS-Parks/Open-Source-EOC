import { describe, expect, it } from "vitest";
import {
  EquipmentHoursSchema,
  equipmentCost,
  equipmentRatesFromTable,
  equipmentSummaryCsv,
  forceAccountTotals,
  laborDay,
  laborSummaryCsv,
  rateAmount,
  type EquipmentRow,
  type ForceAccountSummary,
  type LaborRow,
} from "../force-account.js";

const rate = {
  jobTitle: "Road crew lead", hourlyRate: 30, overtimeRate: 45, fringePercent: 25, overtimeFringePercent: 10, overtimeAfterHours: 8,
};

describe("force account arithmetic", () => {
  it("splits a day at the overtime threshold and costs each part with its fringe", () => {
    expect(laborDay(11.5, rate)).toEqual({ regularHours: 8, overtimeHours: 3.5, regularCostCents: 30000, overtimeCostCents: 17325, costCents: 47325 });
    expect(laborDay(6, { ...rate, overtimeAfterHours: 4, overtimeRate: null, overtimeFringePercent: null }))
      .toEqual({ regularHours: 4, overtimeHours: 2, regularCostCents: 15000, overtimeCostCents: 7500, costCents: 22500 });
    expect(laborDay(9.333333, null)).toEqual({ regularHours: 8, overtimeHours: 1.33, regularCostCents: 0, overtimeCostCents: 0, costCents: 0 });
    expect(equipmentCost(6, 58.19)).toBe(34914);
    expect(equipmentCost(2, null)).toBe(0);
  });

  it("rounds half a cent up, exactly, and shows a rate to the precision it carries so each line adds up", () => {
    // 4.01 h x $19.50 is $78.195; floating point makes it $78.19.
    expect(laborDay(4.01, { ...rate, hourlyRate: 19.5, fringePercent: 0 }).regularCostCents).toBe(7820);
    expect(equipmentCost(0.5, 0.585)).toBe(29);
    const day = laborDay(8, { ...rate, hourlyRate: 25, fringePercent: 7.65 });
    expect(day.regularCostCents).toBe(21530);
    const labor: LaborRow[] = [{
      personId: "p1", personName: "=HYPERLINK(\"http://x\")", jobTitle: "@clerk", date: "2026-09-20", sources: ["check_in"], ...day,
      hourlyRate: 25, overtimeRate: 25, fringePercent: 7.65, overtimeFringePercent: 7.65,
    }];
    const summary: ForceAccountSummary = {
      incidentId: "i1", timeZone: "UTC", labor, equipment: [], totals: forceAccountTotals(labor, []),
      unratedPeople: [], unratedCodes: [], openCheckIns: [],
    };
    const [, line] = laborSummaryCsv(summary).split("\r\n");
    // 8 h x $26.9125 = $215.30; a text cell that starts like a formula is kept as text.
    expect(line).toBe(`"'=HYPERLINK(""http://x"")",'@clerk,2026-09-20,Regular,8.00,25.00,1.9125,26.9125,215.30`);
  });

  it("refuses a date that does not exist", () => {
    expect(EquipmentHoursSchema.safeParse({ rateCode: "8010", usedOn: "2026-02-30", quantity: 1 }).success).toBe(false);
    expect(EquipmentHoursSchema.safeParse({ rateCode: "8010", usedOn: "2028-02-29", quantity: 1 }).success).toBe(true);
  });

  it("reads amounts as FEMA prints them", () => {
    expect(rateAmount("$1.62 ")).toBe(1.62);
    expect(rateAmount("1,204.50")).toBe(1204.5);
    expect(rateAmount("n/a")).toBeNull();
  });

  it("reads FEMA's published schedule headings, 2019 and 2025, and names the lines it leaves out", () => {
    const fema2019 = [
      ["Cost Code", "Equipment ", "Specifications", "Capacity or Size", "HP", "Notes", "Unit", " 2019 Updated Rate "],
      ["8010", "Air Compressor", "Air Delivery", "41 CFM", "to 10", "Hoses included.", "hour", "$1.62 "],
      ["8011", "Air Compressor", "Air Delivery", "103 CFM", "to 30", "Hoses included.", "hour", "$9.86 "],
      ["", "Air Compressor", "", "", "", "", "hour", "$1.00"],
      ["8012", "Air Compressor", "", "", "", "", "hour", "see note"],
    ];
    const read = equipmentRatesFromTable(fema2019);
    expect(read.rows).toEqual([
      { code: "8010", equipment: "Air Compressor", manufacturer: "", specification: "Air Delivery", capacity: "41 CFM", hp: "to 10", notes: "Hoses included.", unit: "hour", rate: 1.62 },
      { code: "8011", equipment: "Air Compressor", manufacturer: "", specification: "Air Delivery", capacity: "103 CFM", hp: "to 30", notes: "Hoses included.", unit: "hour", rate: 9.86 },
    ]);
    expect(read.refused).toEqual([
      { line: 4, reason: "no cost code or equipment name" },
      { line: 5, reason: 'the rate "see note" is not an amount' },
    ]);
    const fema2025 = [
      ["Cost Code", "Equipment", "Manufacturer", "Specification", "Capacity or Size", "HP", "Notes", "Unit", "2025 Rates"],
      ["8072", "Truck, Dump", "Any", "Capacity", "12 CY", "to 400", "", "hour", "$58.19"],
    ];
    expect(equipmentRatesFromTable(fema2025).rows[0]).toMatchObject({ code: "8072", manufacturer: "Any", capacity: "12 CY", rate: 58.19 });
    expect(() => equipmentRatesFromTable([["Name", "Price"]])).toThrow("it has no Cost Code, Equipment or rate column.");
  });

  it("writes FEMA-format summaries whose lines add up to the totals", () => {
    const labor: LaborRow[] = [11.5, 2].map((hours, index) => {
      const day = laborDay(hours, rate);
      return {
        personId: "p1", personName: "Mia, Member", jobTitle: rate.jobTitle, date: `2026-09-2${index}`, sources: ["check_in"], ...day,
        hourlyRate: 30, overtimeRate: 45, fringePercent: 25, overtimeFringePercent: 10,
      };
    });
    const equipment: EquipmentRow[] = [{
      id: "e1", resourceId: "r1", resourceName: "Dump truck 12", code: "8072", equipment: "Truck, Dump", capacity: "12 CY", unit: "hour",
      operatorName: "Mia, Member", date: "2026-09-20", quantity: 6, rate: 58.19, note: "", costCents: equipmentCost(6, 58.19),
    }];
    const summary: ForceAccountSummary = {
      incidentId: "i1", timeZone: "America/Los_Angeles", labor, equipment, totals: forceAccountTotals(labor, equipment),
      unratedPeople: [], unratedCodes: [], openCheckIns: [],
    };
    expect(summary.totals).toEqual({ regularHours: 10, overtimeHours: 3.5, laborCents: 54825, equipmentCents: 34914, totalCents: 89739 });
    const laborLines = laborSummaryCsv(summary).trimEnd().split("\r\n");
    expect(laborLines).toEqual([
      "Name,Job title,Date,Hours type,Hours,Hourly rate,Benefit rate per hour,Total hourly rate,Total cost",
      '"Mia, Member",Road crew lead,2026-09-20,Regular,8.00,30.00,7.50,37.50,300.00',
      '"Mia, Member",Road crew lead,2026-09-20,Overtime,3.50,45.00,4.50,49.50,173.25',
      '"Mia, Member",Road crew lead,2026-09-21,Regular,2.00,30.00,7.50,37.50,75.00',
      "Total,,,,13.50,,,,548.25",
    ]);
    const lineSum = laborLines.slice(1, -1).reduce((sum, line) => sum + Math.round(Number(line.split(",").at(-1)) * 100), 0);
    expect(lineSum).toBe(summary.totals.laborCents);
    expect(equipmentSummaryCsv(summary).trimEnd().split("\r\n")).toEqual([
      "Type of equipment,Equipment code number,Capacity or size,Operator,Date,Hours used,Unit,Equipment rate,Total cost",
      'Truck, Dump,8072,12 CY,"Mia, Member",2026-09-20,6.00,hour,58.19,349.14'.replace("Truck, Dump", '"Truck, Dump"'),
      "Total,,,,,,,,349.14",
    ]);
  });
});
