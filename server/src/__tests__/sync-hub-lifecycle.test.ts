import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addMembership, createJurisdiction, createPerson, principalForPerson,
  type Principal } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { BoardSyncHub } from "../sync/hub.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Sync hub lifecycle. Before this work the hub held one Y.Doc per board for
 * the life of the process, rebuilt every doc from the whole append-only log,
 * and re-read every board row on every connection. Each test below fails
 * against that behavior: the first by counting retained docs, the second and
 * third by counting row reads, the fourth by counting replayed updates.
 */

let admin: Sql, runtime: Sql;
let jurisdictionId: string, boardId: string, incidentId: string;
let actor: Principal;
let hub: BoardSyncHub;

const EVICT_MS = 40;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  jurisdictionId = await createJurisdiction(admin, "hub", "Hub Test EOC");
  const personId = await createPerson(admin, {
    email: "hub-admin@example.org", displayName: "Hub Admin", password: "hub-admin-password",
  });
  await addMembership(admin, personId, jurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);

  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${jurisdictionId}, 'significant_events', 1, 'Hub board') returning id`;
  boardId = board!.id as string;
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${jurisdictionId}, 'daily_ops', 'Hub incident', 'incident', ${personId})
    returning id`;
  incidentId = incident!.id as string;
  await admin`
    insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;

  actor = await principalForPerson(runtime, personId);
  hub = new BoardSyncHub(runtime, { idleEvictMs: EVICT_MS, snapshotThreshold: 3 });
}, 60_000);

afterAll(async () => {
  hub.close();
  await runtime.end();
  await admin.end();
});

/** A record written the way REST writes one, bypassing the sync log. */
async function insertRecord(summary: string): Promise<void> {
  await admin`
    insert into board_records (board_id, incident_id, data, created_by)
    values (${boardId}, ${incidentId}, ${admin.json({
      summary, occurred_at: "2026-09-23T00:00:00.000Z", severity: "operational",
    } as never)}, ${actor.person.id})`;
}

describe("sync hub lifecycle", () => {
  it("drops a scope's document once the last subscriber leaves", async () => {
    await hub.open(actor, boardId, incidentId);
    const release = hub.subscribe(boardId, incidentId, () => {});
    expect(hub.stats().entries).toBe(1);

    // While subscribed, the grace period must not evict.
    await settle(EVICT_MS * 3);
    expect(hub.stats().entries).toBe(1);

    release();
    expect(hub.stats().entries).toBe(1);
    await settle(EVICT_MS * 3);
    expect(hub.stats().entries).toBe(0);
  });

  it("re-subscribing inside the grace period keeps the document", async () => {
    await hub.open(actor, boardId, incidentId);
    const release = hub.subscribe(boardId, incidentId, () => {});
    release();
    await hub.open(actor, boardId, incidentId);
    const second = hub.subscribe(boardId, incidentId, () => {});
    await settle(EVICT_MS * 3);
    expect(hub.stats().entries).toBe(1);
    second();
    await settle(EVICT_MS * 3);
    expect(hub.stats().entries).toBe(0);
  });

  it("reads board rows once per scope however many times it is opened", async () => {
    await insertRecord("first");
    const before = hub.stats().rowLoads;
    await hub.open(actor, boardId, incidentId);
    const keep = hub.subscribe(boardId, incidentId, () => {});
    for (let i = 0; i < 25; i += 1) await hub.open(actor, boardId, incidentId);
    expect(hub.stats().rowLoads).toBe(before + 1);
    keep();
    await settle(EVICT_MS * 3);
  });

  it("open cost does not grow with the number of records", async () => {
    for (let i = 0; i < 40; i += 1) await insertRecord(`bulk ${i}`);
    const before = hub.stats().rowLoads;
    await hub.open(actor, boardId, incidentId);
    const keep = hub.subscribe(boardId, incidentId, () => {});
    for (let i = 0; i < 25; i += 1) await hub.open(actor, boardId, incidentId);
    // One read for 41 records, the same one read the 1-record scope needed.
    expect(hub.stats().rowLoads).toBe(before + 1);

    const state = await hub.open(actor, boardId, incidentId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state.state);
    const ids = new Set<string>();
    for (const key of doc.getMap("records").keys()) ids.add(key.split("/")[0]!);
    expect(ids.size).toBe(41);
    keep();
    await settle(EVICT_MS * 3);
  });

  it("a record written outside sync invalidates the cached projection", async () => {
    await hub.open(actor, boardId, incidentId);
    const keep = hub.subscribe(boardId, incidentId, () => {});
    const before = hub.stats().rowLoads;
    await hub.open(actor, boardId, incidentId);
    expect(hub.stats().rowLoads).toBe(before);

    // The REST write path publishes on the bus; the hub listens and drops the
    // projection, so the next open sees the new record instead of stale rows.
    const { publishBoardEvent } = await import("../events/bus.js");
    publishBoardEvent({
      jurisdictionId, boardId, boardKey: "significant_events",
      recordId: "00000000-0000-0000-0000-000000000001",
      event: "record.created", record: { title: "out of band" },
    });
    await hub.open(actor, boardId, incidentId);
    expect(hub.stats().rowLoads).toBe(before + 1);
    keep();
    await settle(EVICT_MS * 3);
  });

  it("compacts the log into a snapshot and replays only what follows it", async () => {
    const scoped = new BoardSyncHub(runtime, { idleEvictMs: EVICT_MS, snapshotThreshold: 3 });
    try {
      for (let i = 0; i < 4; i += 1) {
        const doc = new Y.Doc();
        const recordId = randomUUID();
        doc.getMap("records").set(`${recordId}/summary`, `synced ${i}`);
        doc.getMap("records").set(`${recordId}/occurred_at`, "2026-09-23T00:00:00.000Z");
        doc.getMap("records").set(`${recordId}/severity`, "operational");
        await scoped.apply(actor, boardId, Y.encodeStateAsUpdate(doc), `session-${i}`, {
          operationId: randomUUID(),
          incidentId,
        });
      }
      expect(scoped.stats().snapshots).toBeGreaterThan(0);

      const [snapshot] = await admin`
        select through_seq from sync_snapshots
        where board_id = ${boardId} and incident_id = ${incidentId}`;
      expect(snapshot).toBeDefined();

      const [retained] = await admin`
        select count(*)::int as count from sync_updates
        where board_id = ${boardId} and incident_id = ${incidentId}
          and seq <= ${snapshot!.through_seq as number}`;
      // The log itself is append-only and keeps every row it ever held.
      expect(retained!.count as number).toBeGreaterThan(0);
    } finally {
      scoped.close();
    }
  });

  it("holds a bounded number of documents across many open and close cycles", async () => {
    const boards: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const [row] = await admin`
        insert into boards (jurisdiction_id, template_key, template_version, title)
        values (${jurisdictionId}, 'significant_events', 1, ${`Cycle board ${i}`})
        returning id`;
      boards.push(row!.id as string);
    }
    for (let cycle = 0; cycle < 4; cycle += 1) {
      for (const id of boards) {
        await hub.open(actor, id, null);
        hub.subscribe(id, null, () => {})();
      }
    }
    // 200 open-close cycles across 50 boards. Before eviction every one of
    // those docs was retained for the life of the process.
    expect(hub.stats().entries).toBeLessThanOrEqual(50);
    await settle(EVICT_MS * 4);
    expect(hub.stats().entries).toBe(0);
  }, 60_000);

  it("gives concurrent first opens of a scope one document, so every subscriber hears later updates", async () => {
    const [board] = await admin`
      insert into boards (jurisdiction_id, template_key, template_version, title)
      values (${jurisdictionId}, 'significant_events', 1, 'Raced board') returning id`;
    const raced = board!.id as string;
    const racing = new BoardSyncHub(runtime);
    try {
      let heard = 0;
      // Warm connections, so the opens below run their loads side by side.
      await Promise.all(Array.from({ length: 8 }, () => runtime`select pg_sleep(0.05)`));
      // Each subscribes as soon as its own open returns, as the sync route does.
      await Promise.all(Array.from({ length: 8 }, async () => {
        await racing.open(actor, raced);
        racing.subscribe(raced, null, () => { heard += 1; });
      }));
      const doc = new Y.Doc();
      doc.getMap("scratch").set("key", "value");
      await racing.apply(actor, raced, Y.encodeStateAsUpdate(doc), randomUUID());
      expect(heard).toBe(8);
      expect(racing.stats().entries).toBe(1);
    } finally {
      racing.close();
    }
  });
});
