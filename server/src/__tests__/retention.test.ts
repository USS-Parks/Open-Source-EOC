import { createHmac, hkdfSync } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { forwardAudit, syslogTarget } from "../audit/syslog.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DATA_CLASSES, purgeExpired } from "../retention/service.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Records retention and audit export. Nothing is purged until an admin sets a
 * period; the purge reaches only its allowlisted tables, only expired rows and
 * only in jurisdictions with a policy, and records what it did. The audit trail
 * leaves by paged CSV or signed JSON export, and optionally by syslog.
 */

const SECRET = "test-only-audit-export-key";
const TRICKY_NAME = '=SUM(1,2) "Chief", Jr';

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let otherJurisdiction: string;
let adminToken: string;
let memberToken: string;
let trickyToken: string;
let priorKey: string | undefined;
let udp: Socket;
let udpPort: number;
const datagrams: string[] = [];
let tcp: Server;
let tcpPort: number;
const streams: Buffer[] = [];

const ago = (days: number): Date => new Date(Date.now() - days * 86_400_000);
const TABLES = [...new Set(Object.values(DATA_CLASSES).flat())];

/** One row of every purgeable kind on each side of a 30 day cutoff. */
async function seedRows(jurisdictionId: string, personId: string): Promise<void> {
  const note = async (status: string, days: number, outboxStatus: string, outboxDays: number) => {
    const [row] = await admin`
      insert into notifications (jurisdiction_id, channel, title, status, created_at)
      values (${jurisdictionId}, 'webhook', 'Test', ${status}, ${ago(days)}) returning id`;
    await admin`
      insert into delivery_outbox (jurisdiction_id, notification_id, kind, target, body, status, created_at)
      values (${jurisdictionId}, ${row!.id as string}, 'webhook', 'http://127.0.0.1:9/', '{}',
              ${outboxStatus}, ${ago(outboxDays)})`;
  };
  await note("delivered", 40, "delivered", 40);
  await note("pending", 40, "pending", 40);
  await note("delivered", 1, "dead", 40);

  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    select ${jurisdictionId}, key, version, 'Log' from board_templates limit 1 returning id`;
  const [peer] = await admin`
    insert into peers (jurisdiction_id, name, token_hash, created_by)
    values (${jurisdictionId}, 'Neighbor', ${jurisdictionId}, ${personId}) returning id`;
  for (const [created, delivered] of [[40, 40], [40, null], [1, 1]] as const) {
    await admin`
      insert into federation_outbox (peer_id, board_id, update_data, created_at, delivered_at)
      values (${peer!.id as string}, ${board!.id as string}, ${Buffer.from([1])},
              ${ago(created)}, ${delivered === null ? null : ago(delivered)})`;
  }

  const [feed] = await admin`
    insert into feeds (jurisdiction_id, name, kind, url, created_by)
    values (${jurisdictionId}, 'Source', 'geojson', 'http://127.0.0.1:9/feed', ${personId})
    returning id`;
  for (const [key, days] of [["old", 40], ["recent", 1]] as const) {
    await admin`
      insert into feed_items (feed_id, external_id, first_seen_at, fetched_at)
      values (${feed!.id as string}, ${key}, ${ago(days)}, ${ago(days)})`;
  }

  // One object whose whole chain has expired, one with a recent scan.
  for (const [tag, days] of [["TRK-OLD", [40, 39]], ["TRK-LIVE", [40, 1]]] as const) {
    const [object] = await admin`
      insert into tracked_objects (jurisdiction_id, tag, kind, label, created_by, created_at)
      values (${jurisdictionId}, ${tag}, 'person', ${tag}, ${personId}, ${ago(40)}) returning id`;
    for (const d of days) {
      await admin`
        insert into tracking_events
          (object_id, jurisdiction_id, custody_state, occurred_at, recorded_by, created_at)
        values (${object!.id as string}, ${jurisdictionId}, 'registered', ${ago(d)}, ${personId}, ${ago(d)})`;
    }
  }

  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${jurisdictionId}, 'retention_staff', 'Staff') returning id`;
  for (const [inDays, outDays] of [[41, 40], [40, null], [2, 1]] as const) {
    await admin`
      insert into staff_checkins (jurisdiction_id, person_id, position_id, method,
        checked_in_at, checked_out_at, checked_in_by, created_at)
      values (${jurisdictionId}, ${personId}, ${position!.id as string}, 'manual', ${ago(inDays)},
              ${outDays === null ? null : ago(outDays)}, ${personId}, ${ago(inDays)})`;
  }
}

async function rowCounts(jurisdictionId: string): Promise<Record<string, number>> {
  const [row] = await admin`
    select
      (select count(*) from notifications where jurisdiction_id = ${jurisdictionId})::int as notifications,
      (select count(*) from delivery_outbox where jurisdiction_id = ${jurisdictionId})::int as delivery_outbox,
      (select count(*) from federation_outbox o join peers p on p.id = o.peer_id
        where p.jurisdiction_id = ${jurisdictionId})::int as federation_outbox,
      (select count(*) from feed_items i join feeds f on f.id = i.feed_id
        where f.jurisdiction_id = ${jurisdictionId})::int as feed_items,
      (select count(*) from tracked_objects where jurisdiction_id = ${jurisdictionId})::int as tracked_objects,
      (select count(*) from tracking_events where jurisdiction_id = ${jurisdictionId})::int as tracking_events,
      (select count(*) from staff_checkins where jurisdiction_id = ${jurisdictionId})::int as staff_checkins,
      (select count(*) from audit_events where jurisdiction_id = ${jurisdictionId})::int as audit_events`;
  return { ...row } as Record<string, number>;
}

function setRetention(token: string, policies: unknown) {
  return app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/retention`,
    headers: auth(token),
    payload: { policies },
  });
}

function exportPage(token: string, query: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/audit/export?${query}`,
    headers: auth(token),
  });
}

/** A minimal RFC 4180 reader, to check the export parses back cell for cell. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') cell += text[++i];
      else quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\n") {
      row.push(cell);
      cell = "";
      if (ch === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  return rows;
}

/** Verification as an administrator would do it, per the admin guide. */
function verifySignature(body: { page: unknown; signature: { value: string } }): boolean {
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : value !== null && typeof value === "object"
        ? `{${Object.keys(value).sort()
            .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
            .join(",")}}`
        : JSON.stringify(value);
  const key = Buffer.from(hkdfSync("sha256", SECRET, "", "openeoc audit export v1", 32));
  return createHmac("sha256", key).update(canonical(body.page)).digest("hex") === body.signature.value;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  otherJurisdiction = await createJurisdiction(admin, "neighbor", "Neighbor County OES");
  const otherAdmin = await createPerson(admin, {
    email: "other-admin@example.org",
    displayName: "Other Admin",
    password: "other-admin-password",
  });
  await addMembership(admin, otherAdmin, otherJurisdiction, "admin");
  const tricky = await createPerson(admin, {
    email: "tricky@example.org",
    displayName: TRICKY_NAME,
    password: "tricky-member-password",
  });
  await addMembership(admin, tricky, seed.jurisdictionId, "member");
  await seedRows(seed.jurisdictionId, seed.adminId);
  await seedRows(otherJurisdiction, otherAdmin);

  priorKey = process.env.OPENEOC_SECRET_KEY;
  delete process.env.OPENEOC_SECRET_KEY;
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  trickyToken = await tokenFor(app, "tricky@example.org", "tricky-member-password");

  udp = createSocket("udp4");
  udp.on("message", (msg) => void datagrams.push(msg.toString("utf8")));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  udpPort = udp.address().port;
  tcp = createServer((socket) => socket.on("data", (chunk) => void streams.push(chunk)));
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const address = tcp.address();
  tcpPort = typeof address === "object" && address ? address.port : 0;
}, 60000);

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  udp.close();
  await new Promise((resolve) => tcp.close(resolve));
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("retention policy", () => {
  it("is admin-only, keeps everything by default and validates periods", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/retention`,
      headers: auth(adminToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().policies).toEqual(
      Object.keys(DATA_CLASSES).map((dataClass) => ({
        dataClass, retentionDays: null, updatedAt: null, updatedBy: null,
      })),
    );
    const memberRead = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/retention`,
      headers: auth(memberToken),
    });
    expect(memberRead.statusCode).toBe(403);
    expect((await setRetention(memberToken, [{ dataClass: "feed_items", retentionDays: 30 }])).statusCode)
      .toBe(403);
    expect((await setRetention(adminToken, [{ dataClass: "feed_items", retentionDays: 0 }])).statusCode)
      .toBe(400);
    expect((await setRetention(adminToken, [{ dataClass: "audit_events", retentionDays: 30 }])).statusCode)
      .toBe(400);

    const set = await setRetention(adminToken, [
      { dataClass: "notifications", retentionDays: 30 },
      { dataClass: "deliveries", retentionDays: 30 },
      { dataClass: "feed_items", retentionDays: 30 },
      { dataClass: "tracking", retentionDays: 30 },
      { dataClass: "staff_checkins", retentionDays: null },
    ]);
    expect(set.statusCode).toBe(200);
    const policies = set.json().policies as Array<{ dataClass: string; retentionDays: number | null; updatedBy: string }>;
    expect(policies.map((p) => [p.dataClass, p.retentionDays])).toEqual([
      ["notifications", 30], ["deliveries", 30], ["feed_items", 30], ["tracking", 30], ["staff_checkins", null],
    ]);
    expect(new Set(policies.map((p) => p.updatedBy))).toEqual(new Set([seed.adminId]));
    const [event] = await admin`
      select person_id from audit_events where category = 'retention.policy.updated'`;
    expect(event?.person_id).toBe(seed.adminId);
  });
});

describe("retention purge", () => {
  it("never targets a table with a delete trigger", async () => {
    const guarded = await admin`
      select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and (t.tgtype & 8) <> 0 and c.relname = any(${TABLES})`;
    expect(guarded).toEqual([]);
    // The check itself sees the audit trail's guard.
    const [audit] = await admin`
      select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relname = 'audit_events' and (t.tgtype & 8) <> 0`;
    expect(audit?.n).toBe(1);
  });

  it("deletes only expired rows of configured classes in configured jurisdictions", async () => {
    const before = await rowCounts(seed.jurisdictionId);
    const otherBefore = await rowCounts(otherJurisdiction);

    const purged = await purgeExpired(runtime);
    const expected = {
      notifications: 1,
      delivery_outbox: 2,
      federation_outbox: 1,
      feed_items: 1,
      tracked_objects: 1,
      tracking_events: 2,
    };
    expect(purged).toEqual({ [seed.jurisdictionId]: expected });

    const after = await rowCounts(seed.jurisdictionId);
    expect(after).toEqual({
      ...before,
      notifications: before.notifications! - 1,
      delivery_outbox: before.delivery_outbox! - 2,
      federation_outbox: before.federation_outbox! - 1,
      feed_items: before.feed_items! - 1,
      tracked_objects: before.tracked_objects! - 1,
      tracking_events: before.tracking_events! - 2,
      audit_events: before.audit_events! + 1,
    });
    // A jurisdiction with no policy loses nothing and gains no event.
    expect(await rowCounts(otherJurisdiction)).toEqual(otherBefore);

    // What survived: pending work, recent rows and the live chain.
    const notes = await admin`
      select status, created_at > now() - interval '2 days' as recent from notifications
      where jurisdiction_id = ${seed.jurisdictionId} order by status`;
    expect(notes.map((n) => [n.status, n.recent])).toEqual([["delivered", true], ["pending", false]]);
    const [pendingOutbox] = await admin`
      select count(*)::int as n from delivery_outbox
      where jurisdiction_id = ${seed.jurisdictionId} and status = 'pending'`;
    expect(pendingOutbox?.n).toBe(1);
    const tags = await admin`select tag from tracked_objects where jurisdiction_id = ${seed.jurisdictionId}`;
    expect(tags.map((t) => t.tag)).toEqual(["TRK-LIVE"]);

    const [event] = await admin`
      select person_id, subject_table, payload from audit_events
      where jurisdiction_id = ${seed.jurisdictionId} and category = 'retention.purged'`;
    expect(event?.person_id).toBe(seed.adminId);
    expect(event?.payload).toEqual({
      retentionDays: { notifications: 30, deliveries: 30, feed_items: 30, tracking: 30 },
      purged: expected,
    });

    // Nothing left to purge: no second event.
    expect(await purgeExpired(runtime)).toEqual({});
    expect((await rowCounts(seed.jurisdictionId)).audit_events).toBe(after.audit_events);
  });

  it("purges a class once its period is set, keeping open check-ins", async () => {
    expect((await setRetention(adminToken, [{ dataClass: "staff_checkins", retentionDays: 30 }])).statusCode)
      .toBe(200);
    expect(await purgeExpired(runtime)).toEqual({ [seed.jurisdictionId]: expect.objectContaining({ staff_checkins: 1 }) });
    const left = await admin`
      select checked_out_at is null as open from staff_checkins
      where jurisdiction_id = ${seed.jurisdictionId} order by checked_in_at`;
    expect(left.map((r) => r.open)).toEqual([true, false]);
  });
});

describe("audit export", () => {
  it("pages CSV with escaping and a formula guard, admin only", async () => {
    const [target] = await admin`
      select id from audit_events where jurisdiction_id = ${seed.jurisdictionId} order by seq limit 1`;
    const correction = await app.inject({
      method: "POST",
      url: `/api/v1/audit/${target!.id as string}/corrections`,
      headers: auth(trickyToken),
      payload: { note: '@first, "second"' },
    });
    expect(correction.statusCode).toBe(201);

    expect((await exportPage(memberToken, "format=csv")).statusCode).toBe(403);

    const seqs: number[] = [];
    const persons: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await exportPage(adminToken, `format=csv&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      const [header, ...rows] = parseCsv(res.body);
      expect(header?.slice(0, 4)).toEqual(["seq", "id", "at", "person"]);
      expect(rows.length).toBeLessThanOrEqual(2);
      seqs.push(...rows.map((r) => Number(r[0])));
      persons.push(...rows.map((r) => r[3]!));
      cursor = res.headers["x-next-cursor"] as string | undefined;
      pages++;
    } while (cursor);

    const all = await admin`
      select seq from audit_events where jurisdiction_id = ${seed.jurisdictionId} order by seq`;
    expect(seqs).toEqual(all.map((r) => Number(r.seq)));
    expect(pages).toBe(Math.ceil(all.length / 2));
    expect(persons).toContain(`'${TRICKY_NAME}`);

    const last = await exportPage(adminToken, `format=csv&limit=500`);
    expect(last.body).toContain(`"'=SUM(1,2) ""Chief"", Jr"`);
  });

  it("refuses signed JSON without a secret key", async () => {
    expect((await exportPage(adminToken, "format=json")).statusCode).toBe(409);
  });

  it("signs each JSON page so the chain verifies and tampering fails", async () => {
    process.env.OPENEOC_SECRET_KEY = SECRET;
    try {
      expect((await exportPage(memberToken, "format=json")).statusCode).toBe(403);
      const bodies: Array<{
        page: { cursor: string | null; nextCursor: string | null; firstSeq: number; lastSeq: number;
                entries: Array<{ seq: number; category: string }> };
        signature: { algorithm: string; value: string };
      }> = [];
      let cursor: string | null = null;
      do {
        const res = await exportPage(adminToken, `format=json&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.signature.algorithm).toBe("HMAC-SHA256");
        expect(verifySignature(body)).toBe(true);
        expect(body.page.cursor).toBe(cursor);
        expect(body.page.firstSeq).toBe(body.page.entries[0].seq);
        expect(body.page.lastSeq).toBe(body.page.entries.at(-1).seq);
        bodies.push(body);
        cursor = body.page.nextCursor;
      } while (cursor);
      expect(bodies.length).toBeGreaterThan(1);

      const tampered = structuredClone(bodies[0]!);
      tampered.page.entries[0]!.category = "forged";
      expect(verifySignature(tampered)).toBe(false);
      const skipped = structuredClone(bodies[0]!);
      skipped.page.nextCursor = bodies[1]!.page.nextCursor;
      expect(verifySignature(skipped)).toBe(false);
    } finally {
      delete process.env.OPENEOC_SECRET_KEY;
    }
  });
});

describe("syslog forwarding", () => {
  const ids = (messages: string[]): string[] =>
    messages.map((m) => (JSON.parse(m.slice(m.indexOf(" audit - ") + 9)) as { id: string }).id);

  it("forwards each new audit event once over UDP", async () => {
    const target = syslogTarget(`udp://127.0.0.1:${udpPort}`)!;
    // The first pass sets the mark; forwarding starts from there.
    await forwardAudit(runtime, target);
    const res = await setRetention(adminToken, [{ dataClass: "feed_items", retentionDays: 60 }]);
    expect(res.statusCode).toBe(200);
    const [event] = await admin`
      select id from audit_events where category = 'retention.policy.updated' order by seq desc limit 1`;
    const eventId = event!.id as string;

    // A transaction still open elsewhere on the cluster holds the horizon back.
    await vi.waitFor(async () => {
      await forwardAudit(runtime, target);
      expect(ids(datagrams)).toContain(eventId);
    }, { timeout: 20000, interval: 200 });
    expect(await forwardAudit(runtime, target)).toBe(0);
    expect(ids(datagrams).filter((id) => id === eventId)).toHaveLength(1);
    expect(new Set(ids(datagrams)).size).toBe(datagrams.length);

    const message = datagrams.find((m) => m.includes(eventId))!;
    expect(message).toMatch(/^<110>1 \d{4}-\d{2}-\d{2}T\S+Z \S+ openeoc \d+ audit - \{/);
    const body = JSON.parse(message.slice(message.indexOf(" audit - ") + 9));
    expect(body).toMatchObject({
      id: eventId,
      jurisdictionId: seed.jurisdictionId,
      personId: seed.adminId,
      category: "retention.policy.updated",
    });
  });

  it("frames messages by octet count over TCP", async () => {
    const target = syslogTarget(`tcp://127.0.0.1:${tcpPort}`)!;
    await setRetention(adminToken, [{ dataClass: "feed_items", retentionDays: 90 }]);
    const [event] = await admin`
      select id from audit_events where category = 'retention.policy.updated' order by seq desc limit 1`;
    await vi.waitFor(async () => {
      await forwardAudit(runtime, target);
      expect(Buffer.concat(streams).toString("utf8")).toContain(event!.id as string);
    }, { timeout: 20000, interval: 200 });
    let rest = Buffer.concat(streams);
    const frames: string[] = [];
    while (rest.length > 0) {
      const space = rest.indexOf(0x20);
      const length = Number(rest.subarray(0, space).toString("ascii"));
      frames.push(rest.subarray(space + 1, space + 1 + length).toString("utf8"));
      rest = rest.subarray(space + 1 + length);
    }
    expect(ids(frames)).toContain(event!.id as string);
  });

  it("runs the purge and forwarding from the scheduler, and refuses a bad sink URL", async () => {
    const url = new URL(process.env.OPENEOC_DATABASE_URL!);
    url.pathname = `/${admin.options.database}`;
    const options = { lockUrl: url.toString(), logger: app.log, leaderRetryMs: 50 };
    expect(() => new Scheduler(runtime, { ...options, syslogUrl: "http://127.0.0.1:514" }))
      .toThrow(/unsupported OPENEOC_SYSLOG_URL/);
    const scheduler = new Scheduler(runtime, {
      ...options,
      intervals: { retention: 50, syslog: 50 },
      syslogUrl: `udp://127.0.0.1:${udpPort}`,
    });
    scheduler.start();
    try {
      await vi.waitFor(() => {
        const { lastRun } = scheduler.status();
        expect(lastRun.retention).toBeDefined();
        expect(lastRun.syslog).toBeDefined();
      }, { timeout: 10000 });
    } finally {
      await scheduler.stop();
    }
  });
});
