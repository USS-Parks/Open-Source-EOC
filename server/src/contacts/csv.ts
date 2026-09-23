import { z } from "zod";
import { E164 } from "../notify/channels.js";

/**
 * Contact import from CSV. The parser follows RFC 4180: fields separated by
 * commas, rows by CRLF or LF, a field in double quotes may hold commas, line
 * breaks and doubled quotes. It is lenient where spreadsheets are: a byte
 * order mark is dropped, blank rows are skipped, and a quote inside an
 * unquoted field is kept as text.
 */

export const IMPORT_FIELDS = ["name", "organization", "title", "email", "phone", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Record<ImportField, string | null>;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("a quoted field is not closed");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const SYNONYMS: Record<ImportField, readonly string[]> = {
  name: ["name", "fullname", "contactname"],
  organization: ["organization", "organisation", "agency", "org"],
  title: ["title", "role", "jobtitle"],
  email: ["email", "emails", "emailaddress"],
  phone: ["phone", "phones", "mobile", "cell", "phonenumber", "sms"],
  notes: ["notes", "note", "comments"],
};

/** The column each field most likely comes from, matched on header names. */
export function guessMapping(headers: readonly string[]): ImportMapping {
  const squash = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
  const mapping = {} as ImportMapping;
  for (const field of IMPORT_FIELDS) {
    mapping[field] = headers.find((h) => SYNONYMS[field].includes(squash(h))) ?? null;
  }
  return mapping;
}

/** Numbers as people write them, "+1 (707) 555-0100", reduced to E.164 digits. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s().-]/g, "");
}

export interface ImportRow {
  readonly row: number;
  readonly name: string;
  readonly organization: string | null;
  readonly title: string | null;
  readonly emails: string[];
  readonly phones: string[];
  readonly notes: string | null;
  readonly errors: string[];
}

const Email = z.email();

/** Each data row as a contact, with what is wrong with it. Row 1 is the first after the header. */
export function readRows(rows: readonly string[][], headers: readonly string[], mapping: ImportMapping): ImportRow[] {
  const at = (cells: readonly string[], field: ImportField) => {
    const column = mapping[field];
    const index = column === null ? -1 : headers.indexOf(column);
    return index < 0 ? "" : (cells[index] ?? "").trim();
  };
  return rows.map((cells, index) => {
    const errors: string[] = [];
    const name = at(cells, "name");
    if (!name) errors.push("name is empty");
    if (name.length > 200) errors.push("name is longer than 200 characters");
    const emails = at(cells, "email").split(/[\s;,]+/).filter(Boolean);
    const phones = at(cells, "phone").split(/[;,]/).map(normalizePhone).filter(Boolean);
    for (const email of emails) if (!Email.safeParse(email).success) errors.push(`${email} is not an email address`);
    for (const phone of phones) if (!E164.safeParse(phone).success) errors.push(`${phone} is not a phone number in E.164 form`);
    if (emails.length > 5 || phones.length > 5) errors.push("at most 5 email addresses and 5 phone numbers");
    const text = (field: ImportField, max: number) => {
      const value = at(cells, field);
      if (value.length > max) errors.push(`${field} is longer than ${max} characters`);
      return value || null;
    };
    return {
      row: index + 1,
      name,
      organization: text("organization", 200),
      title: text("title", 200),
      emails,
      phones,
      notes: text("notes", 2000),
      errors,
    };
  });
}
