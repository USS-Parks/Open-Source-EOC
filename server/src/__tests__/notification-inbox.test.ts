import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createJurisdiction } from "../auth/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The notification list reads each source the read policy allows (the
 * person's own, their current positions', and an administrator's
 * jurisdictions) through its own index and merges them. It must return
 * exactly what the policy would, newest first, across pages.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
});

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("notification list", () => {
  it("returns the reader's own, current positions' and administered notifications, newest first, across pages", async () => {
    const [heldRow] = await admin`insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'ops_chief', 'Operations Section Chief') returning id`;
    const [releasedRow] = await admin`insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'log_chief', 'Logistics Section Chief') returning id`;
    const held = heldRow!.id as string;
    const released = releasedRow!.id as string;
    await admin`insert into position_assignments (position_id, person_id, assigned_by) values (${held}, ${seed.memberId}, ${seed.adminId})`;
    await admin`insert into position_assignments (position_id, person_id, assigned_by, revoked_at, revoked_by) values (${released}, ${seed.memberId}, ${seed.adminId}, now(), ${seed.adminId})`;
    const elsewhere = await createJurisdiction(admin, "del-norte", "Del Norte County OES");

    // One a minute, oldest first, so the expected order is the insertion order reversed.
    const rows: Array<[string, string | null, string | null, string]> = [
      ["own 1", seed.memberId, null, seed.jurisdictionId],
      ["someone else's", seed.adminId, null, seed.jurisdictionId],
      ["held position 1", null, held, seed.jurisdictionId],
      ["released position", null, released, seed.jurisdictionId],
      ["own 2", seed.memberId, null, seed.jurisdictionId],
      ["other jurisdiction", null, null, elsewhere],
      ["held position 2", null, held, seed.jurisdictionId],
      ["own 3", seed.memberId, null, seed.jurisdictionId],
    ];
    for (const [index, [title, personId, positionId, jurisdictionId]] of rows.entries()) {
      await admin`
        insert into notifications (jurisdiction_id, person_id, position_id, channel, title, status, created_at)
        values (${jurisdictionId}, ${personId}, ${positionId}, 'inapp', ${title}, 'delivered',
          now() - make_interval(mins => ${rows.length - index}))`;
    }

    const list = async (token: string) => {
      const titles: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/notifications?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          headers: auth(token),
        });
        expect(response.statusCode, response.body).toBe(200);
        const body = response.json() as { notifications: Array<{ title: string }>; nextCursor: string | null };
        titles.push(...body.notifications.map((notification) => notification.title));
        cursor = body.nextCursor;
      } while (cursor);
      return titles;
    };

    const member = await tokenFor(app, "member@example.org", "another-good-password");
    expect(await list(member)).toEqual(["own 3", "held position 2", "own 2", "held position 1", "own 1"]);

    // The administrator reads every notification in the jurisdiction they administer, and none elsewhere.
    const administrator = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    expect(await list(administrator)).toEqual([
      "own 3", "held position 2", "own 2", "released position", "held position 1", "someone else's", "own 1",
    ]);
  });
});
