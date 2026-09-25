import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { migrate } from "../db/migrate.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Boards an incident activated before titles took the template's name were
 * titled with the template key; the migration gives each the template's
 * title, and leaves a board someone renamed as it is.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
let admin: Sql;
let runtime: Sql;
const titles: Record<string, string> = {};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb({ migrateThrough: "0138_request_acceptance.sql" }));
  await ensureStandardTemplates(admin);
  const county = await createJurisdiction(admin, "titles-county", "Titles County");
  const person = await createPerson(admin, { email: "titles@example.org", displayName: "Titles", password: "titles-password" });
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${county}, 'Winter Storm', 'incident', ${person}) returning id`;
  for (const [key, title] of [["shelters", "Winter Storm: shelters"], ["road_closures", "County roads"]] as const) {
    const [board] = await admin`
      insert into boards (jurisdiction_id, template_key, template_version, title)
      values (${county}, ${key}, 1, ${title}) returning id`;
    await admin`insert into incident_boards (incident_id, board_id) values (${incident!.id as string}, ${board!.id as string})`;
    titles[key] = board!.id as string;
  }
  await migrate(admin, MIGRATIONS);
}, 180_000);

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe("board titles migration", () => {
  it("gives an activated board its template's title and keeps a renamed one", async () => {
    const rows = await admin`select id, title from boards where id = any(${Object.values(titles)}::uuid[])`;
    const byId = new Map(rows.map((row) => [row.id as string, row.title as string]));
    expect(byId.get(titles.shelters!)).toBe("Winter Storm: Shelters");
    expect(byId.get(titles.road_closures!)).toBe("County roads");
  });
});
