import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXlsFormWorkbook } from "../forms/xlsx-import.js";

/**
 * The workbook reader sits on an operator upload path, so this covers both
 * what it must read from a real file and what it must refuse from a hostile
 * one. The fixture is a genuine .xlsx the reader did not produce.
 */

const FIXTURE = join(import.meta.dirname, "fixtures", "xlsform-road-closure.xlsx");

describe("XLSForm workbook reader", () => {
  it("reads the survey, choices and settings sheets of a real workbook", () => {
    const sheets = readXlsFormWorkbook(readFileSync(FIXTURE));

    expect(sheets.survey.map((row) => row.name)).toEqual([
      "road", "reason", "status", "location", "thanks",
    ]);
    // Header keys come from the first row; empty cells are dropped entirely.
    expect(sheets.survey[0]).toEqual({
      type: "text", name: "road", label: "Road", required: "yes",
    });
    expect(sheets.survey[2]?.type).toBe("select_one closure_status");
    expect(sheets.choices.map((row) => row.name)).toEqual(["closed", "one_lane", "reopened"]);
    // A label with a space proves shared strings resolve rather than indices.
    expect(sheets.choices[1]?.label).toBe("One lane");
    expect(sheets.settings).toEqual({
      form_title: "Road Closure Report", form_id: "closure_report",
    });
  });

  it("refuses input that is not a readable workbook", () => {
    expect(() => readXlsFormWorkbook(Buffer.from("not a zip at all")))
      .toThrow(/not a readable \.xlsx workbook/u);
    expect(() => readXlsFormWorkbook(Buffer.alloc(0)))
      .toThrow(/not a readable \.xlsx workbook/u);
  });

  it("refuses a workbook whose container is corrupt", () => {
    // Overwrite the end-of-central-directory signature of a real workbook.
    const corrupt = Buffer.from(readFileSync(FIXTURE));
    corrupt.write("XXXX", corrupt.length - 22);
    expect(() => readXlsFormWorkbook(corrupt)).toThrow(/not a readable \.xlsx workbook/u);
  });
});
