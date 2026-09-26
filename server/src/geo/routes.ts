import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, cutPage, decodeCursor, pageQuery } from "../db/cursor.js";
import { featureServerRoutes } from "./featureserver.js";
import { featureBoard, featureBoardList, layerRecords } from "./layers.js";
import { tileRoutes } from "./tiles.js";

/**
 * OGC API - Features read surface (INV-4). Conformance classes
 * implemented: Core and GeoJSON. Every board with a geometry field is a
 * collection; authorization is the same wall as everywhere else, so the
 * standards surface can never show more than the REST surface does.
 */

const ItemsQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: pageQuery.cursor,
  // Read the board as one of this incident's boards (see featureBoard).
  incidentId: z.string().uuid().optional(),
});

const BoardParams = z.object({ boardId: z.string().uuid() });

const CONFORMANCE = [
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
];

export function geoRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/ogc", { preHandler: authenticate }, async (_req, reply) =>
    reply.send({
      title: "Open Source EOC feature service",
      links: [
        { rel: "self", href: "/api/v1/ogc", type: "application/json" },
        { rel: "conformance", href: "/api/v1/ogc/conformance", type: "application/json" },
        { rel: "data", href: "/api/v1/ogc/collections", type: "application/json" },
      ],
    }),
  );

  app.get("/api/v1/ogc/conformance", { preHandler: authenticate }, async (_req, reply) =>
    reply.send({ conformsTo: CONFORMANCE }),
  );

  app.get("/api/v1/ogc/collections", { preHandler: authenticate }, async (req, reply) => {
    const boards = await withPerson(sql, req.principal.person.id, (tx) => featureBoardList(tx, req.principal));
    const collections = boards.map((b) => ({
      id: b.id,
      title: b.title,
      itemType: "feature",
      // A board read only through incidents: named, with an items link for each of them.
      ...(b.incidentIds ? { incidentIds: b.incidentIds } : {}),
      links: (b.incidentIds ?? [null]).map((incidentId) => ({
        rel: "items",
        href: `/api/v1/ogc/collections/${b.id}/items${incidentId ? `?incidentId=${incidentId}` : ""}`,
        type: "application/geo+json",
      })),
    }));
    return reply.send({ collections });
  });

  app.get(
    "/api/v1/ogc/collections/:boardId/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId } = BoardParams.parse(req.params);
      const query = ItemsQuery.parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, async (tx) => {
        const layer = await featureBoard(tx, req.principal, boardId, query.incidentId);
        if (!layer) return null;
        const geomKey = layer.geometry.key;
        const readable = new Set(layer.readable.map((f) => f.key));
        const bbox = query.bbox?.split(",").map(Number);
        const after = decodeCursor(query.cursor, ["at", "id"]);
        // Each feature also carries when its record last changed and who changed it,
        // so the map says how current it is and whom to ask.
        const fetched = await tx`
          select r.id, r.data, coalesce(r.updated_at, r.created_at) as changed_at,
            coalesce(updater.display_name, creator.display_name) as changed_by,
            to_char(r.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
          from board_records r
          left join persons updater on updater.id = r.updated_by
          left join persons creator on creator.id = r.created_by
          where r.board_id = ${boardId} and r.geom is not null ${layerRecords(tx, layer)}
            ${bbox ? tx`and r.geom && ST_MakeEnvelope(${bbox[0]!}, ${bbox[1]!}, ${bbox[2]!}, ${bbox[3]!}, 4326)` : tx``}
            ${after ? tx`and (r.created_at, r.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : tx``}
          order by r.created_at desc, r.id desc limit ${query.limit + 1}`;
        const { items: rows, nextCursor } = cutPage(fetched, query.limit, (r) => [r.page_at as string, r.id as string]);
        const features = rows.map((r) => {
          const data = r.data as Record<string, unknown>;
          const properties: Record<string, unknown> = {
            _updatedAt: new Date(r.changed_at as string).toISOString(),
            ...(r.changed_by ? { _updatedBy: r.changed_by as string } : {}),
          };
          for (const key of Object.keys(data)) {
            if (readable.has(key)) properties[key] = data[key];
          }
          return {
            type: "Feature" as const,
            id: r.id as string,
            geometry: data[geomKey] ?? null,
            properties,
          };
        });
        return { features, nextCursor };
      });
      if (result === null) return reply.status(404).send({ error: "not a feature collection" });
      // OGC API Features paging: the next page is a `next` link, not a body field.
      const next = result.nextCursor === null ? [] : [{
        rel: "next",
        href: `/api/v1/ogc/collections/${boardId}/items?${new URLSearchParams({
          ...(query.bbox ? { bbox: query.bbox } : {}),
          ...(query.incidentId ? { incidentId: query.incidentId } : {}),
          limit: String(query.limit),
          cursor: result.nextCursor,
        })}`,
        type: "application/geo+json",
      }];
      return reply.header("content-type", "application/geo+json").send({
        type: "FeatureCollection",
        numberReturned: result.features.length,
        features: result.features,
        links: next,
      });
    },
  );
  tileRoutes(app, sql, authenticate);
  featureServerRoutes(app, sql, authenticate);
}
