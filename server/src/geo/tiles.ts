import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { geometryFieldKey } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError } from "../auth/service.js";
import { getEffectiveBoard, visibleFields } from "../boards/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * Mapbox Vector Tiles for operational layers too large for one GeoJSON page.
 * PostGIS cuts each tile (ST_AsMVT), so no tile server runs beside the API.
 * Every tile is queried as the caller: row-level security bounds the rows and
 * a board tile carries only the fields the caller's role may read, the same
 * wall as the OGC items route. Two tile layers: `features` (one per record,
 * `_id` plus readable scalar fields) and, below CLUSTER_BELOW_ZOOM, `clusters`
 * (grid cells holding more than one point, with `point_count`).
 */

const EXTENT = 4096;
const BUFFER = 256;
/** Below this zoom, points are gathered into grid clusters per tile. */
export const CLUSTER_BELOW_ZOOM = 12;
/** Cluster cell size in tile units: a 16 x 16 grid per tile. */
const CELL = 256;

const inTileRange = (t: { z: number; x: number; y: number }) => t.x < 2 ** t.z && t.y < 2 ** t.z;
const TileXYZ = z.object({
  z: z.coerce.number().int().min(0).max(24),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});
const BoardTile = TileXYZ.extend({ boardId: z.string().uuid() }).refine(inTileRange);
const DatasetTile = TileXYZ.extend({ datasetId: z.string().uuid() }).refine(inTileRange);
type Tile = z.infer<typeof TileXYZ>;

/**
 * Render one tile from a row source selecting (fid text, props jsonb, geom
 * geometry 4326) already filtered to `bounds`. Geometry is clipped to the
 * buffered tile before projection, so nothing past the Web Mercator limit is
 * ever projected.
 */
async function renderTile(
  tx: Sql,
  t: Tile,
  rows: (bounds: never) => never,
): Promise<Buffer> {
  const envelope = tx`ST_TileEnvelope(${t.z}::int, ${t.x}::int, ${t.y}::int)` as never;
  const bounds = tx`ST_Transform(ST_TileEnvelope(${t.z}::int, ${t.x}::int, ${t.y}::int,
    margin => ${BUFFER / EXTENT}::float8), 4326)` as never;
  const cluster = t.z < CLUSTER_BELOW_ZOOM;
  const [row] = await tx`
    with src as (
      select s.fid, s.props,
        ST_AsMVTGeom(ST_Transform(ST_ClipByBox2D(s.geom, ${bounds}), 3857), ${envelope},
          ${EXTENT}::int, ${BUFFER}::int, true) as g,
        ${cluster}::boolean and GeometryType(s.geom) = 'POINT' as clustered
      from (${rows(bounds)}) s
    ),
    cells as (
      select fid, props, g, floor(ST_X(g) / ${CELL}) as cx, floor(ST_Y(g) / ${CELL}) as cy,
        count(*) over (partition by floor(ST_X(g) / ${CELL}), floor(ST_Y(g) / ${CELL})) as n
      from src
      where clustered and g is not null
        and ST_X(g) >= 0 and ST_X(g) < ${EXTENT} and ST_Y(g) >= 0 and ST_Y(g) < ${EXTENT}
    ),
    features as (
      select fid as "_id", props, g from src where not clustered and g is not null
      union all
      select fid, props, g from cells where n = 1
    ),
    clusters as (
      select count(*)::int as point_count, ST_MakePoint(avg(ST_X(g)), avg(ST_Y(g))) as g
      from cells where n > 1 group by cx, cy
    )
    select coalesce((select ST_AsMVT(f, 'features', ${EXTENT}::int, 'g') from features f), ''::bytea)
      || coalesce((select ST_AsMVT(c, 'clusters', ${EXTENT}::int, 'g') from clusters c), ''::bytea) as mvt`;
  return row!.mvt as Buffer;
}

function sendTile(reply: FastifyReply, mvt: Buffer) {
  return reply
    .header("content-type", "application/vnd.mapbox-vector-tile")
    // Private: a tile is cut for one caller's permissions. Short: records move.
    .header("cache-control", "private, max-age=5")
    .send(mvt);
}

export function tileRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/tiles/boards/:boardId/:z/:x/:y.mvt", { preHandler: authenticate }, async (req, reply) => {
    const t = BoardTile.parse(req.params);
    const mvt = await withPerson(sql, req.principal.person.id, async (tx) => {
      const board = await getEffectiveBoard(tx, req.principal, t.boardId);
      const geomKey = geometryFieldKey(board.fields);
      if (!geomKey) return null;
      const readable = visibleFields(board).map((f) => f.key).filter((key) => key !== geomKey);
      return renderTile(tx, t, (bounds) => tx`
        select r.id::text as fid,
          (select coalesce(jsonb_object_agg(p.key, p.value), '{}'::jsonb)
             from jsonb_each(r.data) p where p.key = any(${readable}::text[])) as props,
          r.geom
        from board_records r
        where r.board_id = ${t.boardId} and r.geom is not null and r.geom && ${bounds}` as never);
    });
    if (mvt === null) return reply.status(404).send({ error: "not a feature collection" });
    return sendTile(reply, mvt);
  });

  app.get("/api/v1/tiles/datasets/:datasetId/:z/:x/:y.mvt", { preHandler: authenticate }, async (req, reply) => {
    const t = DatasetTile.parse(req.params);
    const mvt = await withPerson(sql, req.principal.person.id, async (tx) => {
      const [ds] = await tx`
        select p.incident_id from data_pack_datasets d
        join data_packs p on p.id = d.pack_id
        where d.id = ${t.datasetId}`;
      if (!ds) throw new AuthError(404, "dataset not found");
      await getIncidentAuthority(tx, req.principal, ds.incident_id as string);
      return renderTile(tx, t, (bounds) => tx`
        select source_id as fid, data as props, geom
        from data_pack_items
        where dataset_id = ${t.datasetId} and geom is not null and geom && ${bounds}` as never);
    });
    return sendTile(reply, mvt);
  });
}
