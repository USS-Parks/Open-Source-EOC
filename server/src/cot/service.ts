import {
  cotFromXml,
  cotToGeoFeature,
  cotToXml,
  geoRecordToCot,
  geometryFieldKey,
  type GeoFeature,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getEffectiveBoard } from "../boards/service.js";
import { newToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/service.js";

/**
 * CoT/TAK gateway (VEOC-29, F20; ADR-0008, TypeScript path). Inbound CoT
 * tracks land as a COP feed layer; a VEOC geo record emits as a CoT event
 * a TAK server can consume. The translation lives in `shared`; this wires
 * it to the feed layers and board records.
 */

const COT_FEED_NAME = "CoT/TAK";

/** Find or create the jurisdiction's CoT feed (a push feed layer). */
async function ensureCotFeed(sql: Sql, actor: Principal, jurisdictionId: string): Promise<string> {
  const [existing] = await sql`
    select id from feeds
    where jurisdiction_id = ${jurisdictionId} and kind = 'cot' and name = ${COT_FEED_NAME}
    order by created_at limit 1`;
  if (existing) return existing.id as string;
  // The feeds table requires a url or an ingest token; the CoT feed is a
  // push layer fed by the gateway, so it carries an (unused) token hash.
  const [row] = await sql`
    insert into feeds (jurisdiction_id, name, kind, ingest_token_hash, stale_after_seconds, created_by)
    values (${jurisdictionId}, ${COT_FEED_NAME}, 'cot', ${newToken().hash}, 300, ${actor.person.id})
    returning id`;
  return row!.id as string;
}

/** Ingest a CoT event (from ATAK/TAK) and land it as a COP feed feature. */
export async function ingestCot(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  xml: string,
  now = new Date(),
): Promise<{ feedId: string; feature: GeoFeature }> {
  // The gateway lands tracks on a feed layer, which is admin-gated (the
  // feeds posture from VEOC-19); CoT ingest is a service/admin action.
  requireAdmin(actor, jurisdictionId);
  const event = cotFromXml(xml);
  const feature = cotToGeoFeature(event);
  const feedId = await ensureCotFeed(sql, actor, jurisdictionId);
  const [lon, lat] = feature.geometry!.coordinates;
  await sql`
    insert into feed_items (feed_id, external_id, title, geom, properties, track, fetched_at)
    values (${feedId}, ${event.uid}, ${feature.properties.callsign as string},
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
            ${sql.json(feature.properties as never)},
            ${sql.json([[lon, lat, now.toISOString()]] as never)}, ${now})
    on conflict (feed_id, external_id) do update set
      title = excluded.title, geom = excluded.geom, properties = excluded.properties,
      track = (
        select coalesce(jsonb_agg(t order by t ->> 2), '[]'::jsonb) from (
          select t from jsonb_array_elements(feed_items.track || excluded.track) as t
          order by t ->> 2 desc limit 200
        ) capped
      ),
      fetched_at = excluded.fetched_at`;
  await sql`
    update feeds set last_success_at = ${now}, last_error = null, consecutive_failures = 0
    where id = ${feedId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "cot.ingested",
    subjectTable: "feeds",
    subjectId: feedId,
    payload: { uid: event.uid, type: event.type },
  });
  return { feedId, feature };
}

/** Emit a VEOC geo board record as a CoT event for TAK. */
export async function emitCot(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  opts: { staleMinutes?: number | undefined; type?: string | undefined } = {},
  now = new Date(),
): Promise<{ xml: string; uid: string }> {
  const board = await getEffectiveBoard(sql, actor, boardId);
  const geomKey = geometryFieldKey(board.fields);
  if (!geomKey) throw new AuthError(400, "board has no geometry field");
  const [record] = await sql`
    select data from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (!record) throw new AuthError(404, "record not found");
  const data = record.data as Record<string, unknown>;
  const geometry = data[geomKey] as { type: string; coordinates: number[] } | null;
  if (!geometry) throw new AuthError(400, "record has no geometry");
  const event = geoRecordToCot(
    { id: recordId, geometry, properties: data },
    {
      time: now.toISOString(),
      ...(opts.staleMinutes !== undefined ? { staleMinutes: opts.staleMinutes } : {}),
      ...(opts.type !== undefined ? { type: opts.type } : {}),
    },
  );
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    category: "cot.emitted",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { uid: event.uid, type: event.type },
  });
  return { xml: cotToXml(event), uid: event.uid };
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}
