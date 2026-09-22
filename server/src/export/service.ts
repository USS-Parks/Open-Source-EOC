import type { SitrepRow } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, type Principal } from "../auth/service.js";
import { currentLifelines, getSitrep, listSitreps } from "../sitreps/service.js";

/**
 * Portable jurisdiction export (INV-9/INV-10, continuity). An admin can pull
 * the jurisdiction's operational record as plain JSON: boards with their
 * records (geometry as GeoJSON), the sitrep archive, and current lifelines.
 * This is the no-lock-in guarantee made concrete and a human-readable
 * companion to the full database backup (deploy/backup.sh). Admin-only, and
 * RLS is the second wall.
 */

export interface ExportedRecord {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly geometry: unknown | null;
  readonly createdAt: string;
}
export interface ExportedBoard {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly localFields: readonly unknown[];
  readonly records: readonly ExportedRecord[];
}
export interface JurisdictionExport {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly jurisdiction: { readonly id: string; readonly slug: string; readonly name: string };
  readonly boards: readonly ExportedBoard[];
  readonly sitreps: readonly SitrepRow[];
  readonly lifelines: readonly unknown[];
}

export async function exportJurisdiction(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<JurisdictionExport> {
  requireAdmin(actor, jurisdictionId);
  const [j] = await sql`select id, slug, name from jurisdictions where id = ${jurisdictionId}`;
  if (!j) throw new AuthError(404, "jurisdiction not found");

  const boardRows = await sql`
    select id, title, template_key, template_version, local_fields
    from boards where jurisdiction_id = ${jurisdictionId} and archived_at is null
    order by title`;
  const boards: ExportedBoard[] = [];
  for (const b of boardRows) {
    const recs = await sql`
      select id, data, ST_AsGeoJSON(geom) as geometry, created_at
      from board_records where board_id = ${b.id as string} order by created_at`;
    boards.push({
      id: b.id as string,
      title: b.title as string,
      templateKey: b.template_key as string,
      templateVersion: b.template_version as number,
      localFields: (b.local_fields as unknown[]) ?? [],
      records: recs.map((r) => ({
        id: r.id as string,
        data: r.data as Record<string, unknown>,
        geometry: r.geometry ? (JSON.parse(r.geometry as string) as unknown) : null,
        createdAt: new Date(r.created_at as string).toISOString(),
      })),
    });
  }

  const sitrepList = await listSitreps(sql, actor, jurisdictionId);
  const sitreps: SitrepRow[] = [];
  for (const s of sitrepList) sitreps.push(await getSitrep(sql, actor, s.id));
  const lifelines = await currentLifelines(sql, actor, jurisdictionId);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    jurisdiction: { id: j.id as string, slug: j.slug as string, name: j.name as string },
    boards,
    sitreps,
    lifelines,
  };
}
