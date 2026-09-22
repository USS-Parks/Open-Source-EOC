import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BoardTemplateSchema, effectiveFields, geometryFieldKey, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { getEffectiveBoard, visibleFields } from "../boards/service.js";

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
});

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
    const rows = await withPerson(sql, req.principal.person.id, (tx) => {
      return tx`
        select b.id, b.title, b.local_fields, t.definition
        from boards b join board_templates t
          on t.key = b.template_key and t.version = b.template_version
        where b.archived_at is null`;
    });
    const collections = [];
    for (const r of rows) {
      const template = BoardTemplateSchema.parse(r.definition);
      const { fields } = effectiveFields(template, (r.local_fields as FieldDef[]) ?? []);
      if (!geometryFieldKey(fields)) continue;
      collections.push({
        id: r.id as string,
        title: r.title as string,
        itemType: "feature",
        links: [
          {
            rel: "items",
            href: `/api/v1/ogc/collections/${r.id as string}/items`,
            type: "application/geo+json",
          },
        ],
      });
    }
    return reply.send({ collections });
  });

  app.get(
    "/api/v1/ogc/collections/:boardId/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const { boardId } = req.params as { boardId: string };
      const query = ItemsQuery.parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, async (tx) => {
        const board = await getEffectiveBoard(tx, req.principal, boardId);
        const geomKey = geometryFieldKey(board.fields);
        if (!geomKey) return null;
        const readable = new Set(visibleFields(board).map((f) => f.key));
        const bbox = query.bbox?.split(",").map(Number);
        const rows = bbox
          ? await tx`
              select id, data from board_records
              where board_id = ${boardId} and geom is not null
                and geom && ST_MakeEnvelope(${bbox[0]!}, ${bbox[1]!}, ${bbox[2]!}, ${bbox[3]!}, 4326)
              order by created_at desc limit ${query.limit}`
          : await tx`
              select id, data from board_records
              where board_id = ${boardId} and geom is not null
              order by created_at desc limit ${query.limit}`;
        const features = rows.map((r) => {
          const data = r.data as Record<string, unknown>;
          const properties: Record<string, unknown> = {};
          for (const key of Object.keys(data)) {
            if (key !== geomKey && readable.has(key)) properties[key] = data[key];
          }
          return {
            type: "Feature" as const,
            id: r.id as string,
            geometry: data[geomKey] ?? null,
            properties,
          };
        });
        return features;
      });
      if (result === null) return reply.status(404).send({ error: "not a feature collection" });
      return reply.header("content-type", "application/geo+json").send({
        type: "FeatureCollection",
        numberReturned: result.length,
        features: result,
      });
    },
  );
}
