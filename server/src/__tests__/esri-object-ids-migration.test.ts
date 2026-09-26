import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { migrate } from "../db/migrate.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Object ids for the Esri view (VC-26) on a database an earlier release
 * left: the migration numbers each board's existing records 1, 2, 3 in the
 * order they were created, and from then on a trigger takes the board's next
 * number on every insert, overwrites a number a caller gives, and keeps the
 * number through an update. The counters are out of the runtime role's reach.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
let admin: Sql;
let runtime: Sql;
let person: string;
const boards: Record<string, string> = {};
const records: Record<string, string> = {};

async function record(board: string, name: string, createdAt: string | null = null, objectId: number | null = null): Promise<string> {
  const [row] = await admin`
    insert into board_records (board_id, data, created_by, created_at${objectId === null ? admin`` : admin`, object_id`})
    values (${boards[board]!}, ${admin.json({ entry: name })}, ${person}, ${createdAt ?? new Date().toISOString()}
      ${objectId === null ? admin`` : admin`, ${objectId}`})
    returning id`;
  return row!.id as string;
}
const objectIds = async (board: string) =>
  (await admin`select data ->> 'entry' as name, object_id from board_records where board_id = ${boards[board]!} order by object_id`)
    .map((r) => [r.name as string, Number(r.object_id)]);

beforeAll(async () => {
  ({ admin, runtime } = await freshDb({ migrateThrough: "0167_service_identities.sql" }));
  await ensureStandardTemplates(admin);
  const county = await createJurisdiction(admin, "object-ids-county", "Object Ids County");
  person = await createPerson(admin, { email: "ids@example.org", displayName: "Ids", password: "object-ids-password" });
  for (const name of ["log", "other", "later"]) {
    const [board] = await admin`
      insert into boards (jurisdiction_id, template_key, template_version, title)
      values (${county}, 'activity_log', 1, ${name}) returning id`;
    boards[name] = board!.id as string;
  }
  // Written out of creation order, with the other board's record between them.
  records.second = await record("log", "second", "2026-09-20T10:00:00Z");
  records.other = await record("other", "other first", "2026-09-20T09:30:00Z");
  records.first = await record("log", "first", "2026-09-20T09:00:00Z");
  records.third = await record("log", "third", "2026-09-20T11:00:00Z");
  await migrate(admin, MIGRATIONS);
}, 180_000);

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe("board record object ids", () => {
  it("numbers each board's existing records from 1 in the order they were created", async () => {
    expect(await objectIds("log")).toEqual([["first", 1], ["second", 2], ["third", 3]]);
    expect(await objectIds("other")).toEqual([["other first", 1]]);
  });

  it("gives each new record its board's next number, whatever number the insert names, and keeps it through updates", async () => {
    await record("log", "fourth");
    await record("other", "other second", null, 999);
    await record("later", "first on a board with none");
    expect((await objectIds("log")).at(-1)).toEqual(["fourth", 4]);
    expect(await objectIds("other")).toEqual([["other first", 1], ["other second", 2]]);
    expect(await objectIds("later")).toEqual([["first on a board with none", 1]]);
    await admin`update board_records set object_id = 42, data = ${admin.json({ entry: "second, edited" })} where id = ${records.second!}`;
    expect(await objectIds("log")).toEqual([["first", 1], ["second, edited", 2], ["third", 3], ["fourth", 4]]);
    expect((await admin`select count(*)::int as n from board_records where object_id is null`)[0]!.n).toBe(0);
  });

  it("keeps the counters from the runtime role", async () => {
    await expect(runtime`select * from board_record_counters`).rejects.toThrow(/permission denied/);
    await expect(runtime`update board_record_counters set last_object_id = 0`).rejects.toThrow(/permission denied/);
  });
});
