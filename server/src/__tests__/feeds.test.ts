import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { parseGeoRss } from "../feeds/parse.js";
import { createFeed, feedItems, listFeeds, pollFeed, runDueFeeds } from "../feeds/service.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Feed framework: a simulated weather feed and a simulated
 * drone track land as read-only layers with provenance and staleness;
 * a failing feed alarms and keeps trying, never a silent stop.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminPrincipal: Principal;
let memberToken: string;
let outsiderToken: string;

const CAP_ALERT = `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>NWS-2026-091701</identifier>
  <sender>w-nws.webmaster@noaa.gov</sender>
  <status>Actual</status>
  <info>
    <event>Flood Warning</event>
    <urgency>Expected</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <headline>Flood Warning for the Lower Klamath</headline>
    <area>
      <areaDesc>Lower Klamath River</areaDesc>
      <polygon>41.20,-123.80 41.20,-123.40 41.45,-123.40 41.45,-123.80 41.20,-123.80</polygon>
    </area>
  </info>
</alert>`;

const cot = (lat: number, lon: number, time: string) => `<?xml version="1.0"?>
<event version="2.0" uid="DRONE-7" type="a-f-A-M-F-Q" time="${time}" start="${time}" stale="${time}" how="m-g">
  <point lat="${lat}" lon="${lon}" hae="120" ce="5" le="5"/>
  <detail><contact callsign="EAGLE-1"/></detail>
</event>`;

const fetchOk = (body: string, type = "application/xml"): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { "content-type": type } })) as never;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  adminPrincipal = await principalForPerson(runtime, seed.adminId);
  const outsider = await admin`
    insert into persons (email, display_name, password_hash)
    select 'outsider@example.org', 'Outsider', password_hash from persons
    where email = 'member@example.org' returning id`;
  void outsider;
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});


async function newFeed(raw: Record<string, unknown>): Promise<{ id: string; ingestToken?: string }> {
  return withPerson(runtime, seed.adminId, (tx) =>
    createFeed(tx, adminPrincipal, seed.jurisdictionId, raw),
  );
}

describe("a simulated weather feed (CAP over poll)", () => {
  it("denies a member before making the outbound poll request", async () => {
    const { id } = await newFeed({
      name: "Admin-controlled poll",
      kind: "cap",
      url: "https://alerts.example.test/admin-only.xml",
    });
    const member = await principalForPerson(runtime, seed.memberId);
    let fetchCalls = 0;
    const countedFetch: typeof fetch = (async () => {
      fetchCalls += 1;
      return new Response(CAP_ALERT, { status: 200 });
    }) as never;

    await expect(withPerson(runtime, seed.memberId, (tx) =>
      pollFeed(tx, member, id, countedFetch),
    )).rejects.toMatchObject({ status: 403 });
    expect(fetchCalls).toBe(0);
  });

  it("lands the alert as a layer with provenance, severity, and freshness", async () => {
    const { id } = await newFeed({
      name: "NWS CAP",
      kind: "cap",
      url: "https://alerts.example.test/cap.xml",
      staleAfterSeconds: 600,
    });
    const result = await withPerson(runtime, seed.adminId, (tx) =>
      pollFeed(tx, adminPrincipal, id, fetchOk(CAP_ALERT)),
    );
    expect(result).toEqual({ ok: true, items: 1 });

    const layer = await withPerson(runtime, seed.adminId, (tx) =>
      feedItems(tx, adminPrincipal, id),
    );
    expect(layer.numberReturned).toBe(1);
    const f = layer.features[0]!;
    const geometry = f.geometry as { type: string; coordinates: number[][][] };
    expect(geometry.type).toBe("Polygon");
    expect(geometry.coordinates[0]![0]).toEqual([-123.8, 41.2]); // lat,lon flipped to lon,lat
    const p = f.properties as Record<string, unknown>;
    expect(p.severity).toBe("severe");
    expect(p._source).toBe("NWS CAP");
    expect(p._stale).toBe(false);
    expect(layer.feed.lastError).toBeNull();
  });

  it("flags the layer STALE once the feed outlives its freshness window", async () => {
    const { id } = await newFeed({
      name: "Stale CAP",
      kind: "cap",
      url: "https://alerts.example.test/cap.xml",
      staleAfterSeconds: 60,
    });
    const polledAt = new Date(Date.now() - 3600 * 1000); // an hour ago
    await withPerson(runtime, seed.adminId, (tx) =>
      pollFeed(tx, adminPrincipal, id, fetchOk(CAP_ALERT), polledAt),
    );
    const layer = await withPerson(runtime, seed.adminId, (tx) =>
      feedItems(tx, adminPrincipal, id),
    );
    expect(layer.feed.stale).toBe(true);
    expect((layer.features[0]!.properties as Record<string, unknown>)._stale).toBe(true);
    expect(layer.feed.ageSeconds).toBeGreaterThan(3000);
  });
});

describe("a simulated drone track (CoT over push)", () => {
  it("blocks a demoted creator before parsing while retaining last-good readiness", async () => {
    const [creatorRow] = await admin`
      insert into persons (email, display_name, password_hash)
      select 'feed-owner@example.org', 'Feed Owner', password_hash
      from persons where id = ${seed.adminId}
      returning id`;
    const creatorId = creatorRow!.id as string;
    await admin`
      insert into jurisdiction_memberships (jurisdiction_id, person_id, role)
      values (${seed.jurisdictionId}, ${creatorId}, 'admin')`;
    const creator = await principalForPerson(runtime, creatorId);
    const created = await withPerson(runtime, creatorId, (tx) =>
      createFeed(tx, creator, seed.jurisdictionId, {
        name: "Demoted push owner", kind: "geojson", push: true,
      }),
    );
    const good = await app.inject({
      method: "POST", url: `/api/v1/feeds/${created.id}/ingest`,
      headers: { "x-feed-token": created.ingestToken! },
      payload: { type: "FeatureCollection", features: [{
        type: "Feature", id: "last-good", geometry: null,
        properties: { name: "Retained item" },
      }] },
    });
    expect(good.statusCode, good.body).toBe(202);
    const [before] = await admin`
      select last_success_at, last_error, consecutive_failures,
        (select count(*)::integer from feed_items where feed_id = ${created.id}) as item_count
      from feeds where id = ${created.id}`;

    await admin`
      update jurisdiction_memberships set role = 'member'
      where jurisdiction_id = ${seed.jurisdictionId} and person_id = ${creatorId}`;
    const wrongToken = await app.inject({
      method: "POST", url: `/api/v1/feeds/${created.id}/ingest`,
      headers: { "x-feed-token": "wrong-token" }, payload: { malformed: true },
    });
    expect(wrongToken.statusCode).toBe(401);
    const denied = await app.inject({
      method: "POST", url: `/api/v1/feeds/${created.id}/ingest`,
      headers: { "x-feed-token": created.ingestToken! }, payload: { malformed: true },
    });
    expect(denied.statusCode, denied.body).toBe(403);

    const health = (await withPerson(runtime, seed.adminId, (tx) =>
      listFeeds(tx, adminPrincipal, seed.jurisdictionId),
    )).find((feed) => feed.id === created.id)!;
    expect(health).toMatchObject({
      ingestAuthorized: false,
      currentItemCount: 1,
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(health.lastSuccessAt).toBeTruthy();
    const [after] = await admin`
      select last_success_at, last_error, consecutive_failures,
        (select count(*)::integer from feed_items where feed_id = ${created.id}) as item_count
      from feeds where id = ${created.id}`;
    expect(after).toEqual(before);
  });

  it("authenticates by feed token, keeps the track, and renders the latest position", async () => {
    const { id, ingestToken } = await newFeed({ name: "UAS EAGLE-1", kind: "cot", push: true });
    expect(ingestToken).toBeTruthy();

    const t1 = "2026-09-17T11:00:00Z";
    const t2 = "2026-09-17T11:00:30Z";
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${id}/ingest`,
      headers: { "x-feed-token": ingestToken!, "content-type": "application/xml" },
      payload: cot(41.30, -123.60, t1),
    });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${id}/ingest`,
      headers: { "x-feed-token": ingestToken!, "content-type": "application/xml" },
      payload: cot(41.31, -123.58, t2),
    });
    expect(second.statusCode).toBe(202);

    const layer = await withPerson(runtime, seed.adminId, (tx) =>
      feedItems(tx, adminPrincipal, id),
    );
    expect(layer.numberReturned).toBe(1); // one aircraft, not two markers
    const f = layer.features[0]!;
    expect((f.geometry as { coordinates: number[] }).coordinates).toEqual([-123.58, 41.31]);
    const p = f.properties as Record<string, unknown>;
    expect(p.title).toBe("EAGLE-1");
    const track = p.track as [number, number, string][];
    expect(track).toHaveLength(2);
    expect(track[0]![0]).toBe(-123.6); // chronological: first position first
    expect(track[1]![0]).toBe(-123.58);
  });

  it("rejects a wrong token and a missing token", async () => {
    const { id } = await newFeed({ name: "UAS locked", kind: "cot", push: true });
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${id}/ingest`,
      headers: { "x-feed-token": "not-the-token", "content-type": "application/xml" },
      payload: cot(41, -123, "2026-09-17T11:00:00Z"),
    });
    expect(bad.statusCode).toBe(401);
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${id}/ingest`,
      headers: { "content-type": "application/xml" },
      payload: cot(41, -123, "2026-09-17T11:00:00Z"),
    });
    expect(missing.statusCode).toBe(401);
  });
});

describe("ingestion failures alarm and never silently stop", () => {
  it("marks the feed, raises a notification and an audit event, then recovers", async () => {
    const { id } = await newFeed({
      name: "Flaky source",
      kind: "geojson",
      url: "https://flaky.example.test/data.json",
    });
    const failing: typeof fetch = (async () =>
      new Response("boom", { status: 500 })) as never;
    const result = await withPerson(runtime, seed.adminId, (tx) =>
      pollFeed(tx, adminPrincipal, id, failing),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");

    const feeds = await withPerson(runtime, seed.adminId, (tx) =>
      listFeeds(tx, adminPrincipal, seed.jurisdictionId),
    );
    const flaky = feeds.find((f) => f.id === id)!;
    expect(flaky.enabled).toBe(true); // still trying, not stopped
    expect(flaky.lastError).toContain("500");
    expect(flaky.consecutiveFailures).toBe(1);

    const [alarmRow] = await admin`
      select title, status from notifications
      where detail ->> 'feedId' = ${id}`;
    expect(alarmRow!.status).toBe("failed");
    expect(alarmRow!.title).toContain("Flaky source");
    const [auditRow] = await admin`
      select category from audit_events
      where category = 'feed.ingest.failed' and subject_id = ${id}`;
    expect(auditRow).toBeTruthy();

    // The next successful poll clears the health flags.
    const fc = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "s1",
          geometry: { type: "Point", coordinates: [-123.5, 41.2] },
          properties: { name: "River gauge", status: "normal" },
        },
      ],
    });
    const recovered = await withPerson(runtime, seed.adminId, (tx) =>
      pollFeed(tx, adminPrincipal, id, fetchOk(fc, "application/json")),
    );
    expect(recovered).toEqual({ ok: true, items: 1 });
    const after = await withPerson(runtime, seed.adminId, (tx) =>
      listFeeds(tx, adminPrincipal, seed.jurisdictionId),
    );
    const healthy = after.find((f) => f.id === id)!;
    expect(healthy.lastError).toBeNull();
    expect(healthy.consecutiveFailures).toBe(0);
    expect(healthy.stale).toBe(false);
  });

  it("an unparseable body is a failure too, not an empty success", async () => {
    const { id } = await newFeed({
      name: "Garbage source",
      kind: "cap",
      url: "https://garbage.example.test/x",
    });
    const result = await withPerson(runtime, seed.adminId, (tx) =>
      pollFeed(tx, adminPrincipal, id, fetchOk("<html>maintenance page</html>", "text/html")),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CAP");
  });
});

describe("the scheduler", () => {
  it("polls due feeds under their creator's authority and respects intervals", async () => {
    const [revokedCreatorRow] = await admin`
      insert into persons (email, display_name, password_hash)
      select 'revoked-poll-owner@example.org', 'Revoked Poll Owner', password_hash
      from persons where id = ${seed.adminId}
      returning id`;
    const revokedCreatorId = revokedCreatorRow!.id as string;
    await admin`
      insert into jurisdiction_memberships (jurisdiction_id, person_id, role)
      values (${seed.jurisdictionId}, ${revokedCreatorId}, 'admin')`;
    const revokedCreator = await principalForPerson(runtime, revokedCreatorId);
    await withPerson(runtime, revokedCreatorId, (tx) =>
      createFeed(tx, revokedCreator, seed.jurisdictionId, {
        name: "Revoked scheduled source",
        kind: "georss",
        url: "https://revoked.example.test/no-fetch",
        pollIntervalSeconds: 60,
      }),
    );
    await admin`
      update jurisdiction_memberships set role = 'member'
      where jurisdiction_id = ${seed.jurisdictionId} and person_id = ${revokedCreatorId}`;
    const { id } = await newFeed({
      name: "Scheduled GeoRSS",
      kind: "georss",
      url: "https://rss.example.test/quakes",
      pollIntervalSeconds: 60,
    });
    const rss = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:georss="http://www.georss.org/georss"><channel>
        <title>Quakes</title>
        <item><title>M2.1 near Orleans</title><guid>q-1</guid>
          <georss:point>41.30 -123.53</georss:point></item>
      </channel></rss>`;
    const fetchedUrls: string[] = [];
    const schedulerFetch: typeof fetch = (async (input: Parameters<typeof fetch>[0]) => {
      fetchedUrls.push(String(input));
      return new Response(rss, { status: 200, headers: { "content-type": "application/xml" } });
    }) as never;
    const ran = await runDueFeeds(runtime, schedulerFetch);
    expect(ran).toBeGreaterThanOrEqual(1);
    expect(fetchedUrls).toContain("https://rss.example.test/quakes");
    expect(fetchedUrls).not.toContain("https://revoked.example.test/no-fetch");
    const layer = await withPerson(runtime, seed.adminId, (tx) =>
      feedItems(tx, adminPrincipal, id),
    );
    expect(layer.numberReturned).toBe(1);
    expect((layer.features[0]!.geometry as { coordinates: number[] }).coordinates).toEqual([
      -123.53, 41.3,
    ]);

    // Nothing is due immediately after; the interval gates the next round.
    const again = await runDueFeeds(runtime, schedulerFetch);
    expect(again).toBe(0);
    expect(fetchedUrls).not.toContain("https://revoked.example.test/no-fetch");
  });
});

describe("read walls", () => {
  it("members read feed layers; outsiders do not", async () => {
    const { id } = await newFeed({
      name: "Wall check",
      kind: "geojson",
      url: "https://wall.example.test/x",
    });
    const member = await app.inject({
      method: "GET",
      url: `/api/v1/feeds/${id}/items`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(member.statusCode).toBe(200);
    const outsider = await app.inject({
      method: "GET",
      url: `/api/v1/feeds/${id}/items`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect([403, 404]).toContain(outsider.statusCode);
  });
});

describe("parser details", () => {
  it("GeoRSS items without a point still land, geometryless", () => {
    const items = parseGeoRss(`<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item><title>No location</title><guid>n-1</guid></item>
      </channel></rss>`);
    expect(items).toHaveLength(1);
    expect(items[0]!.geometry).toBeNull();
  });
});
