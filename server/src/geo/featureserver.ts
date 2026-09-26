import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { deriveRecordValues, signatureText, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import { isServiceToken } from "../auth/service-identities.js";
import { geoJsonToEsri, supportedSrid, unsupportedReference, wkidOf, type EsriSpatialReference } from "./esri.js";
import { featureBoard, featureBoardList, type FeatureBoard } from "./layers.js";

/**
 * A read-only ArcGIS REST FeatureServer view (VC-26) of every board the
 * caller may read that has a geometry field, so ArcGIS Pro, ArcGIS Online,
 * QGIS's ArcGIS REST provider and similar clients add a board as a layer.
 * Each board is a service and its layers are geometry kinds. Records are
 * read through the same wall as the OGC API Features items (layers.ts):
 * field read levels, and row-level security with record rules. Nothing
 * writes through this view: there is no applyEdits, and every layer says
 * `capabilities: "Query"`. Archived records are left out, as the board's
 * views leave them out. Records are addressed by `object_id`, a stored
 * number each board gives its records in turn, so an object id never changes.
 */

const ROOT = "/api/v1/esri/rest/services";
const VERSION = 11.1;
const MAX_RECORD_COUNT = 1000;
const SR_4326 = { wkid: 4326, latestWkid: 4326 };
const WORLD = { xmin: -180, ymin: -90, xmax: 180, ymax: 90 };
const OBJECT_ID = "OBJECTID";
const EARTH_RADIUS = 6_378_137;
/** Where Web Mercator stops: the latitude of y = 20,037,508 m. */
const MERCATOR_LATITUDE = 85.06;

/** Layer ids name geometry kinds, so each layer of a board keeps its id whatever the board holds. */
const LAYERS = [
  { id: 0, geometryType: "esriGeometryPoint", kinds: ["POINT"], name: "points" },
  { id: 1, geometryType: "esriGeometryPolyline", kinds: ["LINESTRING", "MULTILINESTRING"], name: "lines" },
  { id: 2, geometryType: "esriGeometryPolygon", kinds: ["POLYGON", "MULTIPOLYGON"], name: "areas" },
  { id: 3, geometryType: "esriGeometryMultipoint", kinds: ["MULTIPOINT"], name: "multipoints" },
] as const;
type Layer = (typeof LAYERS)[number];
const KIND_LAYERS: Readonly<Record<string, readonly Layer[]>> = {
  point: [LAYERS[0]], linestring: [LAYERS[1]], polygon: [LAYERS[2]], any: LAYERS,
};

const boardLayers = (geometry: FieldDef): readonly Layer[] => KIND_LAYERS[geometry.geometryKind ?? "any"] ?? LAYERS;

const ServiceParams = z.object({ boardId: z.string().uuid() });
const LayerParams = ServiceParams.extend({ layerId: z.coerce.number().int().min(0) });

const flag = (fallback: boolean) => z.preprocess((value) => typeof value === "string" ? value.toLowerCase() : value,
  z.enum(["true", "false"]).optional()).transform((value) => value === undefined ? fallback : value === "true");

/** The query parameters Esri clients send; others (quantization, precision, Z and M) are ignored. */
const QueryParams = z.object({
  f: z.string().default("json"),
  where: z.string().max(1000).optional(),
  objectIds: z.string().max(200_000).optional(),
  outFields: z.string().max(8000).optional(),
  returnGeometry: flag(true),
  returnCountOnly: flag(false),
  returnIdsOnly: flag(false),
  geometry: z.string().max(8000).optional(),
  geometryType: z.string().max(64).optional(),
  spatialRel: z.string().max(64).optional(),
  inSR: z.string().max(4000).optional(),
  outSR: z.string().max(4000).optional(),
  resultOffset: z.coerce.number().int().min(0).default(0),
  resultRecordCount: z.coerce.number().int().min(1).optional(),
  outStatistics: z.string().optional(),
  returnDistinctValues: flag(false),
  returnExtentOnly: flag(false),
});
type Query = z.infer<typeof QueryParams>;

function esriType(field: FieldDef): string {
  if (field.type === "number") return "esriFieldTypeDouble";
  if (field.type === "datetime") return "esriFieldTypeDate";
  if (field.type === "boolean") return "esriFieldTypeSmallInteger";
  return "esriFieldTypeString";
}

interface EsriField { readonly name: string; readonly type: string; readonly alias: string; readonly length?: number }

/** The layer's fields: the object id, the record's id and last change, then each readable board field. */
function esriFields(readable: readonly FieldDef[]): EsriField[] {
  return [
    { name: OBJECT_ID, type: "esriFieldTypeOID", alias: "Object ID" },
    { name: "RecordID", type: "esriFieldTypeString", alias: "Record ID", length: 36 },
    { name: "EditDate", type: "esriFieldTypeDate", alias: "Last changed", length: 8 },
    { name: "Editor", type: "esriFieldTypeString", alias: "Last changed by", length: 255 },
    ...readable.map((field) => {
      const type = esriType(field);
      return { name: field.key, type, alias: field.label, ...(type === "esriFieldTypeString" ? { length: field.maxLength ?? 4000 } : {}) };
    }),
  ];
}

function esriValue(field: FieldDef, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (field.type === "datetime") {
    const time = Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
  }
  if (field.type === "boolean") return value ? 1 : 0;
  if (field.type === "signature") return signatureText(value);
  return typeof value === "object" ? JSON.stringify(value) : value;
}

/** A supported spatial reference given as a wkid or as Esri JSON, with the PostGIS SRID it maps to. */
function spatialReference(text: string): { wkid: number; srid: 4326 | 3857 } {
  let wkid: number | null;
  if (/^\d+$/.test(text.trim())) wkid = Number(text);
  else {
    try {
      wkid = wkidOf(JSON.parse(text) as EsriSpatialReference);
    } catch {
      throw new AuthError(400, "a spatial reference is a wkid or Esri JSON such as {\"wkid\":4326}");
    }
  }
  const srid = wkid === null ? null : supportedSrid(wkid);
  if (wkid === null || srid === null) throw new AuthError(400, unsupportedReference(wkid));
  return { wkid, srid };
}

type Box = readonly [west: number, south: number, east: number, north: number];
interface Envelope { readonly boxes: readonly Box[]; readonly exact: boolean }

/**
 * An envelope in degrees as the WGS 84 boxes to test. A Web Mercator box is
 * converted here rather than by ST_Transform, which wraps longitudes and
 * would turn a box wider than the world into a sliver; its latitude stops at
 * Web Mercator's limit. A box 360 degrees wide or more is the whole world,
 * and one that crosses the antimeridian is two boxes, one on each side.
 */
export function envelopeBoxes(corners: readonly number[], srid: 4326 | 3857): Box[] {
  const [x1, y1, x2, y2] = corners as [number, number, number, number];
  const lon = (x: number) => srid === 3857 ? (x / EARTH_RADIUS) * (180 / Math.PI) : x;
  const lat = (y: number) => srid === 3857
    ? Math.max(-MERCATOR_LATITUDE, Math.min(MERCATOR_LATITUDE, (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI)))
    : Math.max(-90, Math.min(90, y));
  const [west, east] = [Math.min(lon(x1), lon(x2)), Math.max(lon(x1), lon(x2))];
  const [south, north] = [Math.min(lat(y1), lat(y2)), Math.max(lat(y1), lat(y2))];
  const span = east - west;
  if (!(span < 360)) return [[-180, south, 180, north]];
  const start = ((((west + 180) % 360) + 360) % 360) - 180;
  const end = start + span;
  return end <= 180 ? [[start, south, end, north]] : [[start, south, 180, north], [-180, south, end - 360, north]];
}

/** The `geometry` filter: an envelope as `xmin,ymin,xmax,ymax` or Esri JSON, in `inSR` or its own reference. */
function envelope(query: Query): Envelope | null {
  if (!query.geometry) return null;
  if ((query.geometryType ?? "esriGeometryEnvelope") !== "esriGeometryEnvelope")
    throw new AuthError(400, "only an envelope geometry filter is supported (geometryType=esriGeometryEnvelope)");
  const relation = query.spatialRel ?? "esriSpatialRelIntersects";
  if (relation !== "esriSpatialRelIntersects" && relation !== "esriSpatialRelEnvelopeIntersects")
    throw new AuthError(400, `spatial relation ${relation} is not supported: use esriSpatialRelIntersects or esriSpatialRelEnvelopeIntersects`);
  let box: unknown[];
  let own: EsriSpatialReference | undefined;
  const text = query.geometry.trim();
  if (text.startsWith("{")) {
    let parsed: { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown; spatialReference?: EsriSpatialReference };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new AuthError(400, "the geometry is not valid JSON");
    }
    box = [parsed.xmin, parsed.ymin, parsed.xmax, parsed.ymax];
    own = parsed.spatialReference;
  } else {
    box = text.split(",").map((part) => part.trim() === "" ? Number.NaN : Number(part));
  }
  if (box.length !== 4 || !box.every((n) => typeof n === "number" && Number.isFinite(n)))
    throw new AuthError(400, "the geometry must be an envelope: xmin,ymin,xmax,ymax or Esri JSON");
  const { srid } = own ? spatialReference(JSON.stringify(own)) : query.inSR ? spatialReference(query.inSR) : { srid: 4326 as const };
  return { boxes: envelopeBoxes(box as number[], srid), exact: relation === "esriSpatialRelIntersects" };
}

function checkWhere(where: string | undefined): void {
  const plain = (where ?? "").replace(/[\s()]/g, "");
  if (plain !== "" && plain !== "1=1") throw new AuthError(400, "only where=1=1 is supported: filter with objectIds or geometry");
}

async function boardLayer(tx: Sql, actor: Principal, boardId: string, layerId: number): Promise<{ layer: FeatureBoard; kind: Layer }> {
  const layer = await featureBoard(tx, actor, boardId);
  if (!layer) throw new AuthError(404, "not a feature service: the board has no map field you may read");
  const kind = boardLayers(layer.geometry).find((item) => item.id === layerId);
  if (!kind) throw new AuthError(404, "no such layer");
  return { layer, kind };
}

type Extent = { xmin: number; ymin: number; xmax: number; ymax: number };

/** The extent of each geometry kind among the records the caller may read. */
async function extents(tx: Sql, boardId: string): Promise<Map<string, Extent>> {
  const rows = await tx`
    select GeometryType(r.geom) as kind, min(ST_XMin(r.geom)) as xmin, min(ST_YMin(r.geom)) as ymin,
      max(ST_XMax(r.geom)) as xmax, max(ST_YMax(r.geom)) as ymax
    from board_records r where r.board_id = ${boardId} and r.geom is not null and r.archived_at is null group by 1`;
  return new Map(rows.map((r) => [r.kind as string, { xmin: r.xmin, ymin: r.ymin, xmax: r.xmax, ymax: r.ymax } as Extent]));
}

function union(boxes: ReadonlyArray<Extent | undefined>): Extent {
  const present = boxes.filter((box): box is Extent => box !== undefined);
  if (!present.length) return WORLD;
  return {
    xmin: Math.min(...present.map((b) => b.xmin)), ymin: Math.min(...present.map((b) => b.ymin)),
    xmax: Math.max(...present.map((b) => b.xmax)), ymax: Math.max(...present.map((b) => b.ymax)),
  };
}

/** A board's title, and the geometry kind when the board has a layer for each. */
function layerName(layer: FeatureBoard, kind: Layer): string {
  return boardLayers(layer.geometry).length > 1 ? `${layer.board.title} (${kind.name})` : layer.board.title;
}

function layerInfo(layer: FeatureBoard, kind: Layer, boxes: Map<string, Extent>) {
  const fields = esriFields(layer.readable);
  return {
    currentVersion: VERSION,
    id: kind.id,
    name: layerName(layer, kind),
    type: "Feature Layer",
    description: layer.board.template.description,
    geometryType: kind.geometryType,
    sourceSpatialReference: SR_4326,
    extent: { ...union(kind.kinds.map((k) => boxes.get(k))), spatialReference: SR_4326 },
    hasZ: false,
    hasM: false,
    hasAttachments: false,
    htmlPopupType: "esriServerHTMLPopupTypeNone",
    objectIdField: OBJECT_ID,
    uniqueIdField: { name: OBJECT_ID, isSystemMaintained: true },
    globalIdField: "",
    displayField: layer.readable.find((field) => field.type === "text")?.key ?? OBJECT_ID,
    typeIdField: "",
    editFieldsInfo: { editDateField: "EditDate", editorField: "Editor" },
    fields: fields.map((field) => ({ ...field, nullable: field.name !== OBJECT_ID, editable: false, domain: null, defaultValue: null })),
    geometryField: { name: "Shape", type: "esriFieldTypeGeometry" },
    types: [],
    templates: [],
    relationships: [],
    capabilities: "Query",
    maxRecordCount: MAX_RECORD_COUNT,
    standardMaxRecordCount: MAX_RECORD_COUNT,
    supportedQueryFormats: "JSON, geoJSON",
    supportsAdvancedQueries: false,
    supportsStatistics: false,
    supportsCoordinatesQuantization: false,
    useStandardizedQueries: true,
    advancedQueryCapabilities: {
      useStandardizedQueries: true, supportsPagination: true, supportsOrderBy: false, supportsDistinct: false,
      supportsStatistics: false, supportsReturningQueryExtent: false, supportsQueryWithDistance: false,
      supportsTrueCurve: false, supportsQueryWithResultType: false,
    },
    allowGeometryUpdates: false,
    isDataVersioned: false,
  };
}

/**
 * The same bearer check as every route, fed from where Esri clients put a
 * token: `Authorization`, else `X-Esri-Authorization` (ArcGIS sends "Bearer
 * <token>" there), else the `token` query parameter. Those two carry only a
 * service identity's token: a person's session stays in `Authorization`, so
 * it never lands in a GIS project file or an address. The request log line
 * never carries a query string, and a logged request is serialized without
 * one (telemetry/logging.ts), so a token in the URL stays out of logs.
 */
function esriAuthenticate(authenticate: (req: FastifyRequest) => Promise<void>) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.headers.authorization) {
      const header = req.headers["x-esri-authorization"];
      const query = (req.query as { token?: unknown }).token;
      const token = typeof header === "string" ? header.trim().replace(/^Bearer\s+/i, "")
        : typeof query === "string" ? query.trim() : "";
      if (token && !isServiceToken(token)) {
        throw new AuthError(401, "only a service identity's token is taken from X-Esri-Authorization or the token parameter; "
          + "send a person's session as Authorization: Bearer");
      }
      if (token) req.headers.authorization = `Bearer ${token}`;
    }
    await authenticate(req);
  };
}

export function featureServerRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  const preHandler = esriAuthenticate(authenticate);

  app.get(ROOT, { preHandler }, async (req) => {
    const boards = await withPerson(sql, req.principal.person.id, (tx) => featureBoardList(tx, req.principal));
    return { currentVersion: VERSION, folders: [], services: boards.map((b) => ({ name: b.id, type: "FeatureServer" })) };
  });

  app.get(`${ROOT}/:boardId/FeatureServer`, { preHandler }, async (req) => {
    const { boardId } = ServiceParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, async (tx) => {
      const layer = await featureBoard(tx, req.principal, boardId);
      if (!layer) throw new AuthError(404, "not a feature service: the board has no map field you may read");
      const kinds = boardLayers(layer.geometry);
      const boxes = await extents(tx, boardId);
      const full = { ...union(kinds.flatMap((kind) => kind.kinds.map((k) => boxes.get(k)))), spatialReference: SR_4326 };
      return {
        currentVersion: VERSION,
        serviceDescription: layer.board.title,
        description: layer.board.template.description,
        copyrightText: "",
        capabilities: "Query",
        maxRecordCount: MAX_RECORD_COUNT,
        supportedQueryFormats: "JSON, geoJSON",
        hasVersionedData: false,
        supportsDisconnectedEditing: false,
        syncEnabled: false,
        allowGeometryUpdates: false,
        units: "esriDecimalDegrees",
        spatialReference: SR_4326,
        initialExtent: full,
        fullExtent: full,
        layers: kinds.map((kind) => ({
          id: kind.id, name: layerName(layer, kind), parentLayerId: -1, defaultVisibility: true, subLayerIds: null,
          minScale: 0, maxScale: 0, geometryType: kind.geometryType,
        })),
        tables: [],
      };
    });
  });

  app.get(`${ROOT}/:boardId/FeatureServer/layers`, { preHandler }, async (req) => {
    const { boardId } = ServiceParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, async (tx) => {
      const layer = await featureBoard(tx, req.principal, boardId);
      if (!layer) throw new AuthError(404, "not a feature service: the board has no map field you may read");
      const boxes = await extents(tx, boardId);
      return { layers: boardLayers(layer.geometry).map((kind) => layerInfo(layer, kind, boxes)), tables: [] };
    });
  });

  app.get(`${ROOT}/:boardId/FeatureServer/:layerId`, { preHandler }, async (req) => {
    const { boardId, layerId } = LayerParams.parse(req.params);
    return withPerson(sql, req.principal.person.id, async (tx) => {
      const { layer, kind } = await boardLayer(tx, req.principal, boardId, layerId);
      return layerInfo(layer, kind, await extents(tx, boardId));
    });
  });

  app.get(`${ROOT}/:boardId/FeatureServer/:layerId/query`, { preHandler }, async (req, reply) => {
    const { boardId, layerId } = LayerParams.parse(req.params);
    const given = Object.fromEntries(Object.entries(req.query as Record<string, unknown>).filter(([, value]) => value !== ""));
    const query = QueryParams.parse(given);
    const format = query.f === "pjson" ? "json" : query.f;
    if (format !== "json" && format !== "geojson") throw new AuthError(400, `f=${query.f} is not supported: use f=json or f=geojson`);
    if (query.outStatistics || query.returnDistinctValues || query.returnExtentOnly)
      throw new AuthError(400, "statistics, distinct values and extent-only queries are not supported");
    checkWhere(query.where);
    const ids = query.objectIds?.replace(/\s/g, "").split(",");
    if (ids && !ids.every((id) => /^\d{1,15}$/.test(id))) throw new AuthError(400, "objectIds must be a comma-separated list of integers");
    const out = format === "json" && query.outSR ? spatialReference(query.outSR) : { wkid: 4326, srid: 4326 as const };
    const area = envelope(query);
    const count = Math.min(query.resultRecordCount ?? MAX_RECORD_COUNT, MAX_RECORD_COUNT);
    const body = await withPerson(sql, req.principal.person.id, async (tx) => {
      const { layer, kind } = await boardLayer(tx, req.principal, boardId, layerId);
      const hit = (box: Box) => {
        const bounds = tx`ST_MakeEnvelope(${box[0]}::float8, ${box[1]}::float8, ${box[2]}::float8, ${box[3]}::float8, 4326)`;
        return area!.exact ? tx`ST_Intersects(r.geom, ${bounds})` : tx`r.geom && ${bounds}`;
      };
      const [first, second] = area?.boxes ?? [];
      const where = tx`r.board_id = ${boardId} and r.geom is not null and r.archived_at is null
        and GeometryType(r.geom) = any(${kind.kinds}::text[])
        ${ids ? tx`and r.object_id = any(${ids}::bigint[])` : tx``}
        ${first ? tx`and (${hit(first)} ${second ? tx`or ${hit(second)}` : tx``})` : tx``}`;
      if (query.returnCountOnly) {
        const [row] = await tx`select count(*)::int as n from board_records r where ${where}`;
        return { count: row!.n as number };
      }
      if (query.returnIdsOnly) {
        const rows = await tx`select r.object_id from board_records r where ${where} order by r.object_id`;
        return { objectIdFieldName: OBJECT_ID, objectIds: rows.map((r) => Number(r.object_id)) };
      }
      // Web Mercator stops short of the poles; a stray coordinate there is
      // clipped rather than failing the page.
      const shape = !query.returnGeometry || format === "geojson" ? tx`null::jsonb`
        : out.srid === 3857
          ? tx`ST_AsGeoJSON(ST_ForcePolygonCW(ST_Transform(ST_ClipByBox2D(r.geom,
              ST_MakeEnvelope(-180, -85.06, 180, 85.06, 4326)), 3857)))::jsonb`
          : tx`ST_AsGeoJSON(ST_ForcePolygonCW(r.geom))::jsonb`;
      const fetched = await tx`
        select r.object_id, r.id, r.data, coalesce(r.updated_at, r.created_at) as changed_at,
          coalesce(updater.display_name, creator.display_name) as changed_by, ${shape} as shape
        from board_records r
        left join persons updater on updater.id = r.updated_by
        left join persons creator on creator.id = r.created_by
        where ${where}
        order by r.object_id offset ${query.resultOffset} limit ${count + 1}`;
      const exceeded = fetched.length > count;
      const fields = esriFields(layer.readable);
      const wanted = query.outFields === undefined ? new Set([OBJECT_ID.toLowerCase()])
        : query.outFields.split(",").some((name) => name.trim() === "*") ? null
          : new Set(query.outFields.split(",").map((name) => name.trim().toLowerCase()).concat(OBJECT_ID.toLowerCase()));
      const selected = fields.filter((field) => !wanted || wanted.has(field.name.toLowerCase()));
      const features = fetched.slice(0, count).map((r) => {
        const values = deriveRecordValues(layer.board.fields, r.data as Record<string, unknown>);
        const all: Record<string, unknown> = {
          [OBJECT_ID]: Number(r.object_id),
          RecordID: r.id as string,
          EditDate: new Date(r.changed_at as string).getTime(),
          Editor: (r.changed_by as string | null) ?? null,
        };
        for (const field of layer.readable) all[field.key] = esriValue(field, values[field.key]);
        const attributes = Object.fromEntries(selected.map((field) => [field.name, all[field.name]]));
        if (format === "geojson") {
          const geometry = query.returnGeometry ? (r.data as Record<string, unknown>)[layer.geometry.key] ?? null : null;
          return { type: "Feature", id: Number(r.object_id), geometry, properties: attributes };
        }
        const geometry = r.shape ? geoJsonToEsri(r.shape as { type: string; coordinates: unknown }) : null;
        return { attributes, ...(geometry ? { geometry } : {}) };
      });
      if (format === "geojson") {
        return { type: "FeatureCollection", features, ...(exceeded ? { properties: { exceededTransferLimit: true } } : {}) };
      }
      return {
        objectIdFieldName: OBJECT_ID,
        uniqueIdField: { name: OBJECT_ID, isSystemMaintained: true },
        globalIdFieldName: "",
        geometryType: kind.geometryType,
        spatialReference: { wkid: out.wkid, latestWkid: out.srid },
        fields: selected,
        features,
        exceededTransferLimit: exceeded,
      };
    });
    if (format === "geojson" && !query.returnCountOnly && !query.returnIdsOnly) reply.header("content-type", "application/geo+json");
    return body;
  });
}
