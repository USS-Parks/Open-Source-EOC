import * as XLSX from "xlsx";
import { importXlsForm, type FormDefinition, type SheetRow, type XlsFormSheets } from "@openeoc/shared";

/**
 * Real .xlsx import (VEOC-22). Reads an XLSForm workbook's survey,
 * choices, and settings sheets into normalized rows, then hands them to
 * the pure isomorphic importer. Keeping the binary reader here leaves the
 * shared package free of Node/file dependencies. SheetJS is Apache-2.0
 * with an all-Apache-2.0 tree, matching the project license.
 */

function sheetRows(wb: XLSX.WorkBook, name: string): SheetRow[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  // First row as headers; every cell read as a trimmed string.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const text = String(v ?? "").trim();
      if (text !== "") record[k.trim()] = text;
    }
    return record;
  });
}

export function readXlsFormWorkbook(buffer: Buffer): XlsFormSheets {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const survey = sheetRows(wb, "survey");
  const choices = sheetRows(wb, "choices");
  const settingsRows = sheetRows(wb, "settings");
  return { survey, choices, settings: settingsRows[0] };
}

export function importXlsFormWorkbook(
  buffer: Buffer,
  meta: { key: string; version?: number; title?: string; boardTemplate?: string },
): FormDefinition {
  return importXlsForm(readXlsFormWorkbook(buffer), meta);
}
