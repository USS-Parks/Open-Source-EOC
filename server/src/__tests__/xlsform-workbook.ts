import { strToU8, zipSync } from "fflate";

type Row = Readonly<Record<string, string>>;

/** Spreadsheet column letters for a zero-based index: 0 is A, 26 is AA. */
function column(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const xml = (body: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`);
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function sheet(rows: readonly Row[]): Uint8Array {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  const body = lines.map((cells, r) => `<row r="${r + 1}">${cells.map((text, c) => text
    ? `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`
    : "").join("")}</row>`).join("");
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
}

/**
 * A real .xlsx XLSForm built in memory: survey, choices and settings
 * worksheets with inline strings, the shape a spreadsheet program saves.
 */
export function xlsFormWorkbook(sheets: { survey: readonly Row[]; choices: readonly Row[]; settings?: Row }): Buffer {
  const ns = "http://schemas.openxmlformats.org";
  const parts: Array<[string, readonly Row[]]> = [["survey", sheets.survey], ["choices", sheets.choices]];
  if (sheets.settings) parts.push(["settings", [sheets.settings]]);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(`<Types xmlns="${ns}/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + parts.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + `</Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="${ns}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": xml(`<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>`
      + parts.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<Relationships xmlns="${ns}/package/2006/relationships">`
      + parts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `</Relationships>`),
  };
  parts.forEach(([, rows], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheet(rows); });
  return Buffer.from(zipSync(files));
}

/** The field survey used by the importer, submission and browser tests: every field depth type. */
export const FIELD_SURVEY = {
  survey: [
    { type: "start", name: "started" },
    { type: "text", name: "summary", label: "Summary", required: "yes" },
    { type: "select_one counties", name: "county", label: "County", required: "yes" },
    { type: "select_one towns", name: "town", label: "Town", required: "yes", choice_filter: "county=${county}" },
    { type: "geotrace", name: "route", label: "Road segment" },
    { type: "geoshape", name: "area", label: "Affected area" },
    { type: "barcode", name: "asset_tag", label: "Asset tag" },
    { type: "image", name: "photo", label: "Photo" },
    { type: "audio", name: "voice_note", label: "Voice note" },
    { type: "begin_repeat", name: "crews", label: "Crew" },
    { type: "text", name: "crew_name", label: "Crew name", required: "yes" },
    { type: "integer", name: "crew_size", label: "Crew size", constraint: ". > 0", constraint_message: "at least one person" },
    { type: "end_repeat", name: "crews" },
  ],
  choices: [
    { list_name: "counties", name: "humboldt", label: "Humboldt" },
    { list_name: "counties", name: "del_norte", label: "Del Norte" },
    { list_name: "towns", name: "eureka", label: "Eureka", county: "humboldt" },
    { list_name: "towns", name: "arcata", label: "Arcata", county: "humboldt" },
    { list_name: "towns", name: "klamath", label: "Klamath", county: "del_norte" },
    { list_name: "towns", name: "crescent_city", label: "Crescent City", county: "del_norte" },
  ],
  settings: { form_title: "Field damage survey", form_id: "field_survey" },
};

/** A board template that receives the field survey: a line, a polygon, two attachments and the crews as JSON text. */
export const FIELD_SURVEY_TEMPLATE = {
  key: "field_survey_reports",
  version: 1,
  title: "Field Survey Reports",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "county", label: "County", type: "enum", values: ["humboldt", "del_norte"] },
    { key: "town", label: "Town", type: "text" },
    { key: "route", label: "Road segment", type: "geometry", geometryKind: "linestring" },
    { key: "area", label: "Affected area", type: "geometry", geometryKind: "polygon" },
    { key: "asset_tag", label: "Asset tag", type: "text" },
    { key: "photo", label: "Photo", type: "attachment" },
    { key: "voice_note", label: "Voice note", type: "attachment" },
    { key: "crews", label: "Crews", type: "text" },
  ],
  views: [{ key: "all", title: "All reports", columns: ["summary", "town", "asset_tag"] }],
};
