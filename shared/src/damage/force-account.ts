import { z } from "zod";

/**
 * FEMA Public Assistance force account (VC-10): the applicant's own labor and
 * equipment on eligible work, costed at its own labor rates and at an
 * equipment rate schedule, and summarized in the layout of FEMA's Force
 * Account Labor Summary Record (FEMA Form 009-0-123) and Force Account
 * Equipment Summary Record (FEMA Form 009-0-124).
 *
 * Labor hours come from staff check-ins and shifts, one row per person per
 * day, split into regular and overtime hours at the person's daily overtime
 * threshold. Equipment hours are logged against pool resources. The pure
 * arithmetic here is what both the server's summary and its tests use, so a
 * summary's totals are exactly the sum of its rows.
 *
 * Which hours are eligible is the applicant's and FEMA's call under the
 * Public Assistance Program and Policy Guide (for emergency work, straight
 * time of budgeted employees is not eligible); the summary keeps regular and
 * overtime apart so that call can be made on it, and decides nothing.
 */

const Money = z.number().min(0).max(100_000);
const Text = (max: number) => z.string().trim().max(max);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine((day) => !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day, "a date that exists");

export const LaborRateSchema = z.object({
  jobTitle: Text(200).min(1),
  /** Dollars per regular hour. */
  hourlyRate: Money.positive(),
  /** Dollars per overtime hour; none means the regular rate. */
  overtimeRate: Money.positive().nullable().default(null),
  /** Fringe benefits as a percent of the regular rate. */
  fringePercent: z.number().min(0).max(100).default(0),
  /** Fringe benefits as a percent of the overtime rate; none means the regular percent. */
  overtimeFringePercent: z.number().min(0).max(100).nullable().default(null),
  /** Hours in a day after which the rest are overtime. */
  overtimeAfterHours: z.number().min(0).max(24).default(8),
}).strict();

export const EquipmentRateRowSchema = z.object({
  code: Text(40).min(1),
  equipment: Text(200).min(1),
  manufacturer: Text(200).default(""),
  specification: Text(200).default(""),
  capacity: Text(200).default(""),
  hp: Text(40).default(""),
  notes: Text(500).default(""),
  unit: Text(40).min(1).default("hour"),
  /** Dollars per unit. */
  rate: Money,
}).strict();

export const EquipmentRateImportSchema = z.object({
  /** The schedule the rows come from, such as "FEMA 2025", named on every rate. */
  edition: Text(120).min(1),
  source: z.enum(["fema", "local"]),
  rows: z.array(EquipmentRateRowSchema).min(1).max(5000),
}).strict();

export const EquipmentHoursSchema = z.object({
  /** The pool resource used; none for equipment outside the pool. */
  resourceId: z.string().uuid().nullable().default(null),
  rateCode: Text(40).min(1),
  operatorPersonId: z.string().uuid().nullable().default(null),
  usedOn: Day,
  /** Hours, or the rate's unit (miles, for a vehicle rated by the mile). */
  quantity: z.number().positive().max(10_000),
  note: Text(500).default(""),
}).strict();

export const ForceAccountRollUpSchema = z.object({
  paItemId: z.string().uuid(),
  timeZone: z.string().min(1).max(64),
}).strict();

export type LaborRate = z.infer<typeof LaborRateSchema>;
export type LaborRateInput = z.input<typeof LaborRateSchema>;
export type EquipmentRateRow = z.infer<typeof EquipmentRateRowSchema>;
export type EquipmentRateRowInput = z.input<typeof EquipmentRateRowSchema>;
export type EquipmentRateImport = z.input<typeof EquipmentRateImportSchema>;
export type EquipmentHoursInput = z.input<typeof EquipmentHoursSchema>;

export interface LaborRateView extends LaborRate {
  readonly personId: string;
  readonly personName: string;
}

export interface EquipmentRateView extends EquipmentRateRow {
  readonly source: "fema" | "local";
  readonly edition: string;
}

export interface LaborRow {
  readonly personId: string;
  readonly personName: string;
  readonly jobTitle: string | null;
  readonly date: string;
  /** Where the hours came from: a closed check-in, or a past shift no check-in covers. */
  readonly sources: ReadonlyArray<"check_in" | "shift">;
  readonly regularHours: number;
  readonly overtimeHours: number;
  readonly hourlyRate: number | null;
  readonly overtimeRate: number | null;
  readonly fringePercent: number | null;
  readonly overtimeFringePercent: number | null;
  /** Each part's cost with fringe, and their sum; zero when the person has no labor rate yet. */
  readonly regularCostCents: number;
  readonly overtimeCostCents: number;
  readonly costCents: number;
}

export interface EquipmentRow {
  readonly id: string;
  readonly resourceId: string | null;
  readonly resourceName: string | null;
  readonly code: string;
  readonly equipment: string | null;
  readonly capacity: string | null;
  readonly unit: string;
  readonly operatorName: string | null;
  readonly date: string;
  readonly quantity: number;
  readonly rate: number | null;
  readonly note: string;
  /** Zero when the code has no rate in the schedule. */
  readonly costCents: number;
}

export interface ForceAccountSummary {
  readonly incidentId: string;
  readonly timeZone: string;
  readonly labor: readonly LaborRow[];
  readonly equipment: readonly EquipmentRow[];
  readonly totals: {
    readonly regularHours: number;
    readonly overtimeHours: number;
    readonly laborCents: number;
    readonly equipmentCents: number;
    readonly totalCents: number;
  };
  /** People with hours and no labor rate, and equipment codes with no rate: their rows cost nothing yet. */
  readonly unratedPeople: ReadonlyArray<{ readonly personId: string; readonly personName: string }>;
  readonly unratedCodes: readonly string[];
  /** Check-ins on the incident still open: not counted until they close. */
  readonly openCheckIns: ReadonlyArray<{ readonly personId: string; readonly personName: string; readonly since: string }>;
}

const hundredths = (value: number): number => Math.round(value * 100) / 100;

/**
 * A quantity at a rate with a percent added, in cents, rounded half up, in
 * exact integer arithmetic at the stored precisions: quantities to the
 * hundredth, rates to the ten-thousandth of a dollar, percents to the
 * thousandth. Floating point would round $78.195 down.
 */
function costCents(quantity: number, rate: number, percent = 0): number {
  const q = BigInt(Math.round(quantity * 100));
  const r = BigInt(Math.round(rate * 10_000));
  const f = BigInt(Math.round((100 + percent) * 1000));
  // q * r * f is in units of 1e-11 dollars; a cent is 1e9 of them.
  return Number((q * r * f + 500_000_000n) / 1_000_000_000n);
}

/**
 * One person's day: hours split at the overtime threshold, and each part's
 * cost with fringe in cents, rounded once per part so the summary's lines
 * add up to its totals.
 */
export function laborDay(hours: number, rate: LaborRate | null): {
  regularHours: number; overtimeHours: number; regularCostCents: number; overtimeCostCents: number; costCents: number;
} {
  const total = hundredths(hours);
  const threshold = rate?.overtimeAfterHours ?? 8;
  const regularHours = hundredths(Math.min(total, threshold));
  const overtimeHours = hundredths(total - regularHours);
  if (!rate) return { regularHours, overtimeHours, regularCostCents: 0, overtimeCostCents: 0, costCents: 0 };
  const overtimeRate = rate.overtimeRate ?? rate.hourlyRate;
  const overtimeFringe = rate.overtimeFringePercent ?? rate.fringePercent;
  const regularCostCents = costCents(regularHours, rate.hourlyRate, rate.fringePercent);
  const overtimeCostCents = costCents(overtimeHours, overtimeRate, overtimeFringe);
  return { regularHours, overtimeHours, regularCostCents, overtimeCostCents, costCents: regularCostCents + overtimeCostCents };
}

/** A logged equipment use, costed at its rate, in cents. */
export function equipmentCost(quantity: number, rate: number | null): number {
  return rate === null ? 0 : costCents(quantity, rate);
}

/** The totals of a summary's rows, which is all a summary's totals are. */
export function forceAccountTotals(labor: readonly LaborRow[], equipment: readonly EquipmentRow[]): ForceAccountSummary["totals"] {
  const laborCents = labor.reduce((sum, row) => sum + row.costCents, 0);
  const equipmentCents = equipment.reduce((sum, row) => sum + row.costCents, 0);
  return {
    regularHours: hundredths(labor.reduce((sum, row) => sum + row.regularHours, 0)),
    overtimeHours: hundredths(labor.reduce((sum, row) => sum + row.overtimeHours, 0)),
    laborCents,
    equipmentCents,
    totalCents: laborCents + equipmentCents,
  };
}

/** "$1.62 " or "1,204.50" as dollars; null when it is not an amount. */
export function rateAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const HEADERS: ReadonlyArray<readonly [keyof EquipmentRateRowInput, RegExp]> = [
  ["code", /^(cost code|code)$/],
  ["equipment", /^equipment$/],
  ["manufacturer", /^manufacturer$/],
  ["specification", /^specifications?$/],
  ["capacity", /^capacity( or size|\/size)?$/],
  ["hp", /^hp$/],
  ["notes", /^notes$/],
  ["unit", /^unit$/],
  ["rate", /\brates?\b/],
];

/**
 * Equipment rates from a table read out of a CSV file: FEMA's Schedule of
 * Equipment Rates as published (Cost Code, Equipment, Specifications,
 * Capacity or Size, HP, Notes, Unit and the year's rate, with Manufacturer
 * in the 2025 schedule), or a local list with the same headings. Headings
 * match without regard to case or padding, and the rate is the first column
 * whose heading names a rate. A row without a code, an equipment name or an
 * amount is returned in `refused` with its line number.
 */
export function equipmentRatesFromTable(table: readonly (readonly string[])[]): {
  rows: EquipmentRateRowInput[]; refused: Array<{ line: number; reason: string }>;
} {
  const [header, ...body] = table;
  const names = (header ?? []).map((name) => name.trim().toLowerCase().replace(/\s+/g, " "));
  const column = new Map<keyof EquipmentRateRowInput, number>();
  for (const [field, pattern] of HEADERS) {
    const index = names.findIndex((name) => pattern.test(name));
    if (index >= 0 && !column.has(field)) column.set(field, index);
  }
  const words = { code: "Cost Code", equipment: "Equipment", rate: "rate" } as const;
  const missing = (["code", "equipment", "rate"] as const).filter((field) => !column.has(field)).map((field) => words[field]);
  if (missing.length > 0) {
    const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} or ${missing.at(-1)}` : missing[0];
    throw new Error(`The header needs Cost Code, Equipment and a rate column; it has no ${list} column.`);
  }
  const rows: EquipmentRateRowInput[] = [];
  const refused: Array<{ line: number; reason: string }> = [];
  for (const [index, cells] of body.entries()) {
    const cell = (field: keyof EquipmentRateRowInput) => (cells[column.get(field) ?? -1] ?? "").trim();
    const line = index + 2;
    const rate = rateAmount(cell("rate"));
    if (!cell("code") || !cell("equipment")) { refused.push({ line, reason: "no cost code or equipment name" }); continue; }
    if (rate === null) { refused.push({ line, reason: `the rate "${cell("rate")}" is not an amount` }); continue; }
    rows.push({
      code: cell("code"), equipment: cell("equipment"), manufacturer: cell("manufacturer"),
      specification: cell("specification"), capacity: cell("capacity"), hp: cell("hp"), notes: cell("notes"),
      unit: cell("unit") || "hour", rate,
    });
  }
  return { rows, refused };
}

/** A cell, quoted when it must be, and kept from being read as a formula when it starts like one. */
const csvCell = (value: string | number): string => {
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (rows: ReadonlyArray<ReadonlyArray<string | number>>): string =>
  `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
/** Dollars to the cent, or to the ten-thousandth when a rate carries more, so a line's cost is its hours times the rate shown. */
const money = (dollars: number): string => {
  const exact = dollars.toFixed(4).replace(/0{1,2}$/, "");
  return exact.length < dollars.toFixed(2).length ? dollars.toFixed(2) : exact;
};
const cents = (value: number): string => (value / 100).toFixed(2);

/**
 * The labor rows in the layout of the Force Account Labor Summary Record:
 * each person's regular and overtime hours on their own lines, with the
 * hourly rate, the benefit rate per hour, the total hourly rate and the cost.
 */
export function laborSummaryCsv(summary: ForceAccountSummary): string {
  const lines: Array<Array<string | number>> = [[
    "Name", "Job title", "Date", "Hours type", "Hours", "Hourly rate", "Benefit rate per hour", "Total hourly rate", "Total cost",
  ]];
  for (const row of summary.labor) {
    const parts: Array<[string, number, number | null, number | null, number]> = [
      ["Regular", row.regularHours, row.hourlyRate, row.fringePercent, row.regularCostCents],
      ["Overtime", row.overtimeHours, row.overtimeRate ?? row.hourlyRate, row.overtimeFringePercent ?? row.fringePercent, row.overtimeCostCents],
    ];
    for (const [kind, hours, rate, fringe, cost] of parts) {
      if (hours <= 0) continue;
      const benefit = rate === null ? null : rate * (fringe ?? 0) / 100;
      lines.push([
        row.personName, row.jobTitle ?? "", row.date, kind, hours.toFixed(2),
        rate === null ? "no rate" : money(rate), benefit === null ? "" : money(benefit),
        rate === null ? "" : money(rate + (benefit ?? 0)), cents(cost),
      ]);
    }
  }
  lines.push(["Total", "", "", "", (summary.totals.regularHours + summary.totals.overtimeHours).toFixed(2), "", "", "", cents(summary.totals.laborCents)]);
  return csv(lines);
}

/** The equipment rows in the layout of the Force Account Equipment Summary Record. */
export function equipmentSummaryCsv(summary: ForceAccountSummary): string {
  const lines: Array<Array<string | number>> = [[
    "Type of equipment", "Equipment code number", "Capacity or size", "Operator", "Date", "Hours used", "Unit", "Equipment rate", "Total cost",
  ]];
  for (const row of summary.equipment) {
    lines.push([
      row.equipment ?? row.resourceName ?? row.code, row.code, row.capacity ?? "", row.operatorName ?? "", row.date,
      row.quantity.toFixed(2), row.unit, row.rate === null ? "no rate" : money(row.rate), cents(row.costCents),
    ]);
  }
  lines.push(["Total", "", "", "", "", "", "", "", cents(summary.totals.equipmentCents)]);
  return csv(lines);
}
