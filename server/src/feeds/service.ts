import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/service.js";
import { parseFeed, type NormalizedItem } from "./parse.js";

/**
 * Feed framework (VEOC-19, F18). Poll feeds fetch external hazard sources
 * on an interval; push feeds accept authenticated position streams (CoT,
 * GeoJSON). Items are read-only COP layers with provenance and staleness.
 * A failing feed stays enabled and keeps alarming: the failure is a
 * notification and an audit event, never a silent stop.
 */

export const FeedSpecSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(["cap", "geojson", "georss", "cot"]),
    url: z.string().url().optional(),
    pollIntervalSeconds: z.number().int().min(30).max(86400).optional(),
    staleAfterSeconds: z.number().int().min(60).max(604800).default(900),
    push: z.boolean().default(false),
  })
  .refine((s) => s.push !== Boolean(s.url), "exactly one of url (poll) or push");
export type FeedSpec = z.infer<typeof FeedSpecSchema>;

export interface FeedHealth {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly mode: "poll" | "push";
  readonly enabled: boolean;
  readonly staleAfterSeconds: number;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
  /** Whether the configured creator can still run automated or push ingestion. */
  readonly ingestAuthorized: boolean;
  /** Current persisted last-good items. Null when the caller did not request a count. */
  readonly currentItemCount: number | null;
}

const FETCH_TIMEOUT_MS = 10000;
const TRACK_LIMIT = 200;

export async function createFeed(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  raw: unknown,
): Promise<{ id: string; ingestToken?: string }> {
  requireAdmin(actor, jurisdictionId);
  const spec = FeedSpecSchema.parse(raw);
  const token = spec.push ? newToken() : null;
  const [row] = await sql`
    insert into feeds
      (jurisdiction_id, name, kind, url, poll_interval_seconds, ingest_token_hash,
       stale_after_seconds, created_by)
    values
      (${jurisdictionId}, ${spec.name}, ${spec.kind}, ${spec.url ?? null},
       ${spec.pollIntervalSeconds ?? (spec.url ? 300 : null)}, ${token?.hash ?? null},
       ${spec.staleAfterSeconds}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "feed.created",
    subjectTable: "feeds",
    subjectId: id,
    payload: { name: spec.name, kind: spec.kind, mode: spec.push ? "push" : "poll" },
  });
  return token ? { id, ingestToken: token.token } : { id };
}

export async function listFeeds(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  now = new Date(),
): Promise<FeedHealth[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select f.id, f.name, f.kind, f.url, f.enabled, f.stale_after_seconds, f.last_success_at,
           f.last_error, f.consecutive_failures, count(fi.id)::integer as item_count,
           exists (
             select 1 from persons p
             join jurisdiction_memberships m on m.person_id = p.id
             where p.id = f.created_by and not p.disabled
               and m.jurisdiction_id = f.jurisdiction_id and m.role = 'admin'
           ) as ingest_authorized
    from feeds f left join feed_items fi on fi.feed_id = f.id
    where f.jurisdiction_id = ${jurisdictionId}
    group by f.id order by f.name`;
  return rows.map((r) => healthOf(r, now));
}

function healthOf(r: Record<string, unknown>, now: Date): FeedHealth {
  const lastSuccess = r.last_success_at ? new Date(r.last_success_at as string) : null;
  const age = lastSuccess ? Math.floor((now.getTime() - lastSuccess.getTime()) / 1000) : null;
  const staleAfter = r.stale_after_seconds as number;
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    mode: r.url ? "poll" : "push",
    enabled: Boolean(r.enabled),
    staleAfterSeconds: staleAfter,
    lastSuccessAt: lastSuccess ? lastSuccess.toISOString() : null,
    lastError: (r.last_error as string | null) ?? null,
    consecutiveFailures: r.consecutive_failures as number,
    stale: age === null || age > staleAfter,
    ageSeconds: age,
    ingestAuthorized: r.ingest_authorized === undefined || Boolean(r.ingest_authorized),
    currentItemCount: r.item_count === undefined ? null : Number(r.item_count),
  };
}

/**
 * One poll: fetch, parse, land items, record health. Failure marks the
 * feed, alarms (notification + audit), and leaves it enabled for the next
 * round. Returns the outcome; only feed-not-found throws.
 */
export async function pollFeed(
  sql: Sql,
  actor: Principal,
  feedId: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ ok: boolean; items?: number; error?: string }> {
  const [feed] = await sql`
    select id, jurisdiction_id, name, kind, url from feeds
    where id = ${feedId} and url is not null`;
  if (!feed) throw new AuthError(404, "feed not found");
  requireAdmin(actor, feed.jurisdiction_id as string);
  try {
    const res = await fetchImpl(feed.url as string, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`feed responded ${res.status}`);
    const items = parseFeed(feed.kind as string, await res.text());
    await landItems(sql, feedId, items, now);
    await sql`
      update feeds
      set last_polled_at = ${now}, last_success_at = ${now}, last_error = null,
          consecutive_failures = 0
      where id = ${feedId}`;
    return { ok: true, items: items.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      update feeds
      set last_polled_at = ${now}, last_error = ${message},
          consecutive_failures = consecutive_failures + 1
      where id = ${feedId}`;
    await alarm(sql, actor, feed.jurisdiction_id as string, feedId, feed.name as string, message);
    return { ok: false, error: message };
  }
}

/** Push ingestion (CoT or GeoJSON positions) authenticated by feed token. */
export async function ingestPush(
  sql: Sql,
  feedId: string,
  token: string,
  body: string,
  now = new Date(),
): Promise<{ items: number }> {
  // Token check runs on the internal lane; the write then runs under the
  // feed creator's authority, same as a scheduled poll.
  const [feed] = await sql`
    select id, jurisdiction_id, name, kind, ingest_token_hash, created_by from feeds
    where id = ${feedId} and ingest_token_hash is not null and enabled`;
  if (!feed || feed.ingest_token_hash !== hashToken(token))
    throw new AuthError(401, "invalid feed token");
  const creator = await principalForPerson(sql, feed.created_by as string);
  requireAdmin(creator, feed.jurisdiction_id as string);
  try {
    const items = parseFeed(feed.kind as string, body);
    await withPerson(sql, creator.person.id, async (tx) => {
      await landItems(tx, feedId, items, now);
      await tx`
        update feeds set last_success_at = ${now}, last_error = null,
          consecutive_failures = 0
        where id = ${feedId}`;
    });
    return { items: items.length };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    await withPerson(sql, creator.person.id, async (tx) => {
      await tx`
        update feeds set last_error = ${message},
          consecutive_failures = consecutive_failures + 1
        where id = ${feedId}`;
      await alarm(
        tx,
        creator,
        feed.jurisdiction_id as string,
        feedId,
        feed.name as string,
        message,
      );
    });
    throw new AuthError(400, message);
  }
}

/** Run every due poll feed, each under its creator's authority. */
export async function runDueFeeds(
  sql: Sql,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<number> {
  // Internal scheduler lane: no person context, sees feeds only.
  const due = await sql`
    select id, jurisdiction_id, created_by from feeds
    where enabled and url is not null
      and (last_polled_at is null
           or last_polled_at <= ${now}::timestamptz
               - make_interval(secs => poll_interval_seconds))`;
  let ran = 0;
  for (const feed of due) {
    let creator: Principal;
    try {
      creator = await principalForPerson(sql, feed.created_by as string);
      requireAdmin(creator, feed.jurisdiction_id as string);
    } catch (reason) {
      if (reason instanceof AuthError && (reason.status === 401 || reason.status === 403)) continue;
      throw reason;
    }
    await withPerson(sql, creator.person.id, (tx) =>
      pollFeed(tx, creator, feed.id as string, fetchImpl, now),
    );
    ran += 1;
  }
  return ran;
}

async function landItems(
  sql: Sql,
  feedId: string,
  items: readonly NormalizedItem[],
  now: Date,
): Promise<void> {
  for (const item of items) {
    const geomJson = item.geometry ? JSON.stringify(item.geometry) : null;
    const position =
      item.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
    await sql`
      insert into feed_items
        (feed_id, external_id, title, severity, geom, properties, track, fetched_at)
      values
        (${feedId}, ${item.externalId}, ${item.title}, ${item.severity ?? null},
         ${geomJson ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)` : null},
         ${sql.json(item.properties as never)},
         ${sql.json((position ? [[...position, now.toISOString()]] : []) as never)}, ${now})
      on conflict (feed_id, external_id) do update set
        title = excluded.title,
        severity = excluded.severity,
        geom = excluded.geom,
        properties = excluded.properties,
        -- Position streams keep a bounded track; the newest point appends.
        track = (
          select coalesce(jsonb_agg(t order by t ->> 2), '[]'::jsonb) from (
            select t from jsonb_array_elements(feed_items.track || excluded.track) as t
            order by t ->> 2 desc limit ${TRACK_LIMIT}
          ) capped
        ),
        fetched_at = excluded.fetched_at`;
  }
}

async function alarm(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  feedId: string,
  name: string,
  message: string,
): Promise<void> {
  await sql`
    insert into notifications
      (jurisdiction_id, person_id, channel, title, body, status, detail)
    values
      (${jurisdictionId}, ${actor.person.id}, 'feed',
       ${`Feed failing: ${name}`}, ${message}, 'failed',
       ${sql.json({ feedId } as never)})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "feed.ingest.failed",
    subjectTable: "feeds",
    subjectId: feedId,
    payload: { name, error: message },
  });
}

export interface FeedItemsResult {
  readonly type: "FeatureCollection";
  readonly feed: FeedHealth;
  readonly numberReturned: number;
  readonly features: ReadonlyArray<Record<string, unknown>>;
}

/** Items as a GeoJSON layer with provenance and staleness on every feature. */
export async function feedItems(
  sql: Sql,
  actor: Principal,
  feedId: string,
  now = new Date(),
): Promise<FeedItemsResult> {
  const [feed] = await sql`
    select f.*, exists (
      select 1 from persons p
      join jurisdiction_memberships m on m.person_id = p.id
      where p.id = f.created_by and not p.disabled
        and m.jurisdiction_id = f.jurisdiction_id and m.role = 'admin'
    ) as ingest_authorized
    from feeds f where f.id = ${feedId}`;
  if (!feed) throw new AuthError(404, "feed not found");
  requireMember(actor, feed.jurisdiction_id as string);
  const health = healthOf(feed, now);
  const rows = await sql`
    select id, external_id, title, severity, properties, track, fetched_at,
           ST_AsGeoJSON(geom)::jsonb as geometry
    from feed_items where feed_id = ${feedId}
    order by fetched_at desc limit 1000`;
  return {
    type: "FeatureCollection",
    feed: health,
    numberReturned: rows.length,
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id as string,
      geometry: r.geometry ?? null,
      properties: {
        ...(r.properties as Record<string, unknown>),
        title: r.title,
        severity: r.severity,
        track: r.track,
        _source: health.name,
        _fetchedAt: new Date(r.fetched_at as string).toISOString(),
        _stale: health.stale,
        _ageSeconds: health.ageSeconds,
      },
    })),
  };
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
