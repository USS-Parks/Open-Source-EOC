import { BoardTemplateSchema, effectiveFields, geometryFieldKey, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import type { Principal } from "../auth/service.js";
import { getEffectiveBoard, roleFor, visibleFields, type EffectiveBoard } from "../boards/service.js";

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
}

/** The board's map field (its first geometry field) when the caller's role may read it. */
function mapField(board: EffectiveBoard): FieldDef | null {
  const key = geometryFieldKey(board.fields);
  return visibleFields(board).find((field) => field.key === key) ?? null;
}

/**
 * The board as the caller may read it, or null when it has no map field the
 * caller may read: a location only administrators read is no layer at all
 * for anyone else. 403 without a board role.
 */
export async function featureBoard(tx: Sql, actor: Principal, boardId: string): Promise<FeatureBoard | null> {
  const board = await getEffectiveBoard(tx, actor, boardId);
  const geometry = mapField(board);
  if (!geometry) return null;
  return { board, geometry, readable: visibleFields(board).filter((field) => field.key !== geometry.key) };
}

/**
 * Every unarchived board row-level security lets the caller see that has a
 * map field the caller may read. A board seen without a board role (through
 * an incident the caller takes part in) is listed by its map field alone;
 * its items then answer for that access.
 */
export async function featureBoardList(tx: Sql, actor: Principal): Promise<Array<{ id: string; title: string; geometry: FieldDef }>> {
  const rows = await tx`
    select b.id, b.jurisdiction_id, b.title, b.local_fields, t.definition
    from boards b join board_templates t
      on t.key = b.template_key and t.version = b.template_version
    where b.archived_at is null
    order by b.title, b.id`;
  return rows.flatMap((r) => {
    const template = BoardTemplateSchema.parse(r.definition);
    const { fields } = effectiveFields(template, (r.local_fields as FieldDef[]) ?? []);
    const shape = { id: r.id as string, jurisdictionId: r.jurisdiction_id as string, title: r.title as string, template, fields };
    const role = roleFor(actor, shape.jurisdictionId, shape.id);
    const geometry = role ? mapField({ ...shape, role }) : fields.find((field) => field.key === geometryFieldKey(fields));
    return geometry ? [{ id: shape.id, title: shape.title, geometry }] : [];
  });
}
