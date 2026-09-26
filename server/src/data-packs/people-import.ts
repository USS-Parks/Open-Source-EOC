import { z } from "zod";
import type { Sql } from "../db/client.js";
import { addMembership, AuthError, assignPosition, requireAdmin, type Principal } from "../auth/service.js";
import { setMemberRole, type Role } from "../auth/admin.js";
import { hashPassword } from "../auth/passwords.js";
import { recordAudit } from "../audit/service.js";
import { writeImportReport, type RowOutcome } from "./import-reports.js";
import { taxonomyTemplateCsv } from "./import-template.js";

/**
 * People import (VC-13). A CSV or .xlsx file of people, each with a role
 * here and any positions, makes their accounts, memberships and position
 * assignments. Every cell is checked before anything is written, and a row
 * that cannot be made is refused with its reason while the others go in. A
 * dry run writes nothing. An account the instance already has keeps its
 * name and password and is added here; an existing member's role is never
 * changed by a file. A new account gets the first password the administrator
 * types for the run, as the People tab's "Add a person" does; the file never
 * carries one, and the password is kept only as its hash.
 */

export const MAX_PEOPLE_ROWS = 1000;
export const PEOPLE_COLUMNS = ["email", "name", "role", "positions"] as const;
const ROLES: readonly Role[] = ["admin", "member", "viewer"];
const ROLE_NAMES: Readonly<Record<Role, string>> = { admin: "administrator", member: "member", viewer: "viewer" };
const FIELD_NAMES = { email: "Email", name: "Name", role: "Role", positions: "Positions" } as const;
/** Heading spellings each column answers to, compared as lowercase letters only. */
const HEADINGS: Readonly<Record<(typeof PEOPLE_COLUMNS)[number], readonly string[]>> = {
  email: ["email", "emailaddress"],
  name: ["name", "displayname", "fullname"],
  role: ["role"],
  positions: ["positions", "position"],
};
const EMAIL = z.email().max(254);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface PeopleRowOutcome {
  /** The row's number in the file, the heading row being row 1. */
  readonly row: number;
  readonly email: string | null;
  readonly outcome: RowOutcome;
  /** What the row makes or changes, or why it is skipped or refused. */
  readonly detail: string;
}

export interface PeopleImportReport {
  readonly dryRun: boolean;
  /** Column headings the file holds, in file order. */
  readonly columns: readonly string[];
  /** Columns that are not read. */
  readonly dropped: readonly string[];
  readonly rows: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly refused: number;
  readonly outcomes: readonly PeopleRowOutcome[];
  /** The import report a commit kept; absent on a dry run. */
  readonly reportId?: string;
}

interface Planned {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /** The existing account, or null for a new one. */
  readonly personId: string | null;
  /** Whether the existing account becomes a member here. */
  readonly join: boolean;
  readonly assign: ReadonlyArray<{ id: string; title: string }>;
}

const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const quoted = (text: string) => `"${text.length > 80 ? `${text.slice(0, 80)}...` : text}"`;

/**
 * Check, and unless a dry run make, the people of a file. Returns the report,
 * and on a commit the people and positions that changed, for the route to
 * refresh after the transaction commits.
 */
export async function importPeople(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  table: { headers: readonly string[]; rows: ReadonlyArray<Record<string, string>> },
  options: { dryRun: boolean; password?: string | undefined; sourceName?: string | undefined },
): Promise<{ report: PeopleImportReport; people: string[]; positions: string[] }> {
  requireAdmin(actor, jurisdictionId);
  const columns = table.headers.filter((header) => header !== "");
  const columnOf = Object.fromEntries(PEOPLE_COLUMNS.map((name) =>
    [name, columns.find((header) => HEADINGS[name].includes(letters(header)))])) as Record<(typeof PEOPLE_COLUMNS)[number], string | undefined>;
  const missing = (["email", "name", "role"] as const).filter((name) => !columnOf[name]);
  if (missing.length) throw new AuthError(400, `the file needs email, name and role columns; it has no ${missing.join(" or ")} column`);
  const read = new Set(Object.values(columnOf));
  const dropped = columns.filter((header) => !read.has(header));

  const rows = table.rows.flatMap((row, index) =>
    Object.values(row).some((value) => value.trim() !== "") ? [{ row, rowNumber: index + 2 }] : []);
  if (rows.length > MAX_PEOPLE_ROWS) throw new AuthError(413, `a people import holds at most ${MAX_PEOPLE_ROWS} rows`);
  const cell = (row: Record<string, string>, name: (typeof PEOPLE_COLUMNS)[number]) => {
    const column = columnOf[name];
    return column ? (row[column] ?? "").trim() : "";
  };

  const positions = await sql`select id, key, title from positions where jurisdiction_id = ${jurisdictionId}`;
  const positionBy = new Map<string, { id: string; title: string }>();
  for (const p of positions) {
    const entry = { id: p.id as string, title: p.title as string };
    positionBy.set((p.key as string).toLowerCase(), entry);
    if (!positionBy.has((p.title as string).toLowerCase())) positionBy.set((p.title as string).toLowerCase(), entry);
  }
  const emails = rows.map(({ row }) => cell(row, "email").toLowerCase()).filter(Boolean);
  const accounts = new Map<string, string>();
  // A service identity's backing row (VC-25) is not a person a file can add.
  const services = new Set<string>();
  for (const p of emails.length ? await sql`select id, lower(email) as email, service_identity from persons where lower(email) = any(${emails})` : []) {
    if (p.service_identity) services.add(p.email as string);
    else accounts.set(p.email as string, p.id as string);
  }
  const ids = [...accounts.values()];
  const memberships = new Map<string, Role>();
  const held = new Set<string>();
  if (ids.length) {
    for (const m of await sql`
      select person_id, role from jurisdiction_memberships where jurisdiction_id = ${jurisdictionId} and person_id = any(${ids})`)
      memberships.set(m.person_id as string, m.role as Role);
    for (const a of await sql`
      select a.position_id, a.person_id from position_assignments a join positions p on p.id = a.position_id
      where p.jurisdiction_id = ${jurisdictionId} and a.revoked_at is null and a.person_id = any(${ids})`)
      held.add(`${a.position_id as string}:${a.person_id as string}`);
  }

  const outcomes: PeopleRowOutcome[] = [];
  const planned: Planned[] = [];
  const firstRow = new Map<string, number>();
  for (const { row, rowNumber } of rows) {
    const email = cell(row, "email");
    const name = cell(row, "name");
    const roleText = cell(row, "role");
    const reasons: string[] = [];
    const key = email.toLowerCase();
    if (!email) reasons.push("email is empty");
    else if (!EMAIL.safeParse(email).success) reasons.push(`email ${quoted(email)} is not an email address`);
    else if (firstRow.has(key)) reasons.push(`email repeats row ${firstRow.get(key)!}`);
    else if (services.has(key)) reasons.push("email belongs to a service identity, not a person");
    else firstRow.set(key, rowNumber);
    const role = ROLES.find((r) => r === roleText.toLowerCase() || ROLE_NAMES[r] === roleText.toLowerCase());
    if (!roleText) reasons.push("role is empty");
    else if (!role) reasons.push(`role ${quoted(roleText)} is not admin, member or viewer`);
    const wanted = new Map<string, { id: string; title: string }>();
    for (const token of cell(row, "positions").split(/[;,]/).map((part) => part.trim()).filter(Boolean)) {
      const position = positionBy.get(token.toLowerCase());
      if (position) wanted.set(position.id, position);
      else reasons.push(`no position ${quoted(token)} in this jurisdiction`);
    }
    const personId = accounts.get(key) ?? null;
    if (!personId) {
      if (!name) reasons.push("name is empty; a new account needs one");
      else if (name.length > 200) reasons.push("name is longer than 200 characters");
      else if (CONTROL.test(name)) reasons.push("name holds a control character");
    }
    const refuse = (detail: string) => outcomes.push({ row: rowNumber, email: email || null, outcome: "refused", detail });
    if (reasons.length || !role) {
      refuse(reasons.join("; "));
      continue;
    }
    const current = personId ? memberships.get(personId) : undefined;
    if (current && current !== role) {
      refuse(`already a member here as ${ROLE_NAMES[current]}; change a role on the People tab`);
      continue;
    }
    const assign = [...wanted.values()].filter((position) => !personId || !held.has(`${position.id}:${personId}`));
    const assigned = assign.length ? `assigned ${assign.map((position) => position.title).join(", ")}` : "";
    const detail = !personId ? [`new account as ${ROLE_NAMES[role]}`, assigned]
      : !current ? [`existing account added as ${ROLE_NAMES[role]}`, assigned]
      : [assigned];
    if (personId && current && !assign.length) {
      outcomes.push({ row: rowNumber, email, outcome: "skipped", detail: wanted.size ? "already a member with these positions" : "already a member" });
      continue;
    }
    planned.push({ email, name, role, personId, join: !current, assign });
    outcomes.push({ row: rowNumber, email, outcome: personId ? "updated" : "created", detail: detail.filter(Boolean).join("; ") });
  }

  const people: string[] = [];
  const changedPositions = new Set<string>();
  let reportId: string | undefined;
  if (!options.dryRun) {
    const anyNew = planned.some((plan) => plan.personId === null);
    if (anyNew && (options.password ?? "").length < 12)
      throw new AuthError(400, "enter a first password of at least 12 characters for the new accounts");
    // ponytail: one hash for the run. The new accounts share this first
    // password, so separate salts would not slow anyone who learned it; each
    // person's own password replaces it. Hashing once also keeps a large file
    // from holding the server on one scrypt per row.
    const hash = anyNew ? hashPassword(options.password!) : null;
    for (const plan of planned) {
      let personId = plan.personId;
      if (personId === null) {
        const [person] = await sql`
          insert into persons (email, display_name, password_hash)
          values (${plan.email}, ${plan.name}, ${hash}) returning id`;
        personId = person!.id as string;
        await addMembership(sql, personId, jurisdictionId, plan.role);
        await recordAudit(sql, actor, {
          jurisdictionId, category: "membership.added",
          subjectTable: "persons", subjectId: personId, payload: { role: plan.role, previousRole: null },
        });
      } else if (plan.join) {
        await setMemberRole(sql, actor, jurisdictionId, personId, plan.role);
      }
      for (const position of plan.assign) {
        await assignPosition(sql, actor, position.id, personId);
        changedPositions.add(position.id);
      }
      people.push(personId);
    }
    reportId = await writeImportReport(sql, actor, {
      jurisdictionId,
      kind: "people",
      subject: "Accounts and positions",
      sourceName: options.sourceName,
      mapping: PEOPLE_COLUMNS.flatMap((field) => (columnOf[field] ? [{ field: FIELD_NAMES[field], column: columnOf[field] }] : [])),
      rows: outcomes.map((o) => ({ row: o.row, ...(o.email ? { item: o.email } : {}), outcome: o.outcome, reason: o.detail })),
    });
  }
  const count = (outcome: RowOutcome) => outcomes.filter((o) => o.outcome === outcome).length;
  return {
    report: {
      dryRun: options.dryRun, columns, dropped, rows: rows.length,
      created: count("created"), updated: count("updated"), skipped: count("skipped"), refused: count("refused"),
      outcomes, ...(reportId ? { reportId } : {}),
    },
    people,
    positions: [...changedPositions],
  };
}

/**
 * The people import template (VC-13): its four columns, with the roles and
 * this jurisdiction's positions, the ICS dictionary's and any added here,
 * listed beneath their headings.
 */
export async function peopleImportTemplate(sql: Sql, actor: Principal, jurisdictionId: string): Promise<string> {
  requireAdmin(actor, jurisdictionId);
  const positions = await sql`select key from positions where jurisdiction_id = ${jurisdictionId} order by key`;
  return taxonomyTemplateCsv(PEOPLE_COLUMNS, { role: ROLES, positions: positions.map((p) => p.key as string) });
}
