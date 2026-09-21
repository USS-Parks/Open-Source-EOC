import { z } from "zod";
import type { SpatialQueryScope, ViewportBbox } from "@openeoc/shared";
import type { Sql } from "../db/client.js";

export const ViewportBboxParam = z.string().transform((raw, ctx): ViewportBbox => {
  const parts = raw.split(",");
  const values = parts.map((part) => part.trim() === "" ? Number.NaN : Number(part));
  const [west, south, east, north] = values;
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) ||
      west! < -180 || east! > 180 || south! < -90 || north! > 90 ||
      west! >= east! || south! >= north!) {
    ctx.addIssue({ code: "custom", message: "bbox must be finite ordered WGS84 west,south,east,north" });
    return z.NEVER;
  }
  return [west!, south!, east!, north!] as const;
});

export function spatialScope(bbox: ViewportBbox | undefined): SpatialQueryScope {
  return bbox ? { kind: "viewport", bbox } : { kind: "incident-area", bbox: null };
}

export function bboxEnvelope(sql: Sql, bbox: ViewportBbox): never {
  return sql`ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` as never;
}

export function analysisArea(sql: Sql, bbox: ViewportBbox | undefined): never {
  return (bbox
    ? sql`ST_Intersection(geometry, ${bboxEnvelope(sql, bbox)})`
    : sql`geometry`) as never;
}
