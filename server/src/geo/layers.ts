import { BoardTemplateSchema, effectiveFields, geometryFieldKey, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import type { Principal } from "../auth/service.js";
import { getBoardReadShape, roleFor, visibleFields, type EffectiveBoard } from "../boards/service.js";

/**
 * A board as a map layer for one caller: the one read wall the OGC API
 * Features, vector tile and Esri FeatureServer surfaces share (INV-4,
 * VC-26). The caller's board role decides which fields are read, the map
 * field included, and row-level security which records, record rules
 * included, so no standards surface can show more than the board itself.
 */
export interface FeatureBoard {
  readonly board: EffectiveBoard;
  readonly geometry: FieldDef;
  /** The fields the caller may read, the geometry field left out. */
  readonly readable: readonly FieldDef[];
  /** The incident the board was read through; its records are then the only ones served. */
  readonly incidentId: string | null;
}

/** The board's map field (its first geometry field) when the caller's role may read it. */
function mapField(board: EffectiveBoard): FieldDef | null {
  const key = geometryFieldKey(board.fields);
  return visibleFields(board).find((field) => field.key === key) ?? null;
}

/**
 * The board as the caller may read it, or null when it has no map field the
 * caller may read: a location only administrators read is no layer at all
 * for anyone else. 403 without a board role. With an incident, the board is
 * read as one of that incident's boards through the REST board read's shape:
 * 404 unless the caller reads the incident, 400 unless the board is attached
 * to it, and the caller's own role or else member field level.
 */
export async function featureBoard(
  tx: Sql, actor: Principal, boardId: string, incidentId?: string,
): Promise<FeatureBoard | null> {
  const { board } = await getBoardReadShape(tx, actor, boardId, incidentId);
  const geometry = mapField(board);
  if (!geometry) return null;
  return {
    board, geometry, incidentId: incidentId ?? null,
    readable: visibleFields(board).filter((field) => field.key !== geometry.key),
  };
}

/**
 * The records a map layer serves, as a condition on `board_records r`: not
 * archived (archive hides a record from default views), and with an
 * incident, that incident's only, as the incident board views read them.
 */
export function layerRecords(tx: Sql, layer: FeatureBoard): never {
  return tx`and r.archived_at is null
    ${layer.incidentId ? tx`and r.incident_id = ${layer.incidentId}` : tx``}` as never;
}

/**
 * Every unarchived board row-level security lets the caller see that has a
 * map field the caller may read. A board seen without a board role is seen
 * through incidents the caller reads; it is read through them, at member
 * field level, so `incidentIds` names them. It is null for a board the
 * caller holds a role on.
 */
export async function featureBoardList(tx: Sql, actor: Principal): Promise<Array<{
  id: string; title: string; geometry: FieldDef; incidentIds: string[] | null;
}>> {
  // incident_boards answers under row-level security: only incidents the caller reads.
  const rows = await tx`
    select b.id, b.jurisdiction_id, b.title, b.local_fields, t.definition,
      coalesce((select array_agg(ib.incident_id::text order by ib.incident_id)
        from incident_boards ib where ib.board_id = b.id), '{}') as incident_ids
    from boards b join board_templates t
      on t.key = b.template_key and t.version = b.template_version
    where b.archived_at is null
    order by b.title, b.id`;
  return rows.flatMap((r) => {
    const template = BoardTemplateSchema.parse(r.definition);
    const { fields } = effectiveFields(template, (r.local_fields as FieldDef[]) ?? []);
    const shape = { id: r.id as string, jurisdictionId: r.jurisdiction_id as string, title: r.title as string, template, fields };
    const role = roleFor(actor, shape.jurisdictionId, shape.id);
    const incidentIds = role ? null : r.incident_ids as string[];
    if (incidentIds?.length === 0) return [];
    const geometry = mapField({ ...shape, role: role ?? "member" });
    return geometry ? [{ id: shape.id, title: shape.title, geometry, incidentIds }] : [];
  });
}
