import { z } from "zod";

const coordinate = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ring = z.array(coordinate).min(4).max(10001).superRefine((points, ctx) => {
  const first = points[0], last = points.at(-1);
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1])
    ctx.addIssue({ code: "custom", message: "Boundary rings must close at their first point." });
  if (new Set(points.slice(0, -1).map((p) => p.join(","))).size < 3)
    ctx.addIssue({ code: "custom", message: "A boundary needs at least three distinct points." });
});
const polygon = z.array(ring).min(1).max(256);

/** Administrative boundaries are reference data, never a geometry constraint. */
export const IncidentAreaGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1).max(256) }),
]).superRefine((geometry, ctx) => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const count = polygons.reduce((sum, p) => sum + p.reduce((n, r) => n + r.length, 0), 0);
  if (count > 10000) ctx.addIssue({ code: "custom", message: "Use at most 10,000 boundary points." });
});
export type IncidentAreaGeometry = z.infer<typeof IncidentAreaGeometrySchema>;

export const OperationalPeriodSchema = z.object({
  label: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
}).strict().refine((period) => Date.parse(period.endsAt) > Date.parse(period.startsAt), {
  message: "The operational period must end after it starts.", path: ["endsAt"],
});
export type OperationalPeriod = z.infer<typeof OperationalPeriodSchema>;

export const IncidentAreaUpdateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  geometry: IncidentAreaGeometrySchema.nullable(),
  operationalPeriod: OperationalPeriodSchema.nullable(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type IncidentAreaUpdate = z.infer<typeof IncidentAreaUpdateSchema>;

export interface IncidentAreaRevision {
  readonly incidentId: string;
  readonly revision: number;
  readonly geometry: IncidentAreaGeometry | null;
  readonly operationalPeriod: OperationalPeriod | null;
  readonly reason: string;
  readonly createdAt: string | null;
  readonly createdBy: string | null;
  readonly positionId: string | null;
  readonly createdByName: string | null;
  readonly positionTitle: string | null;
}
