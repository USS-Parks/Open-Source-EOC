import {
  DashboardTemplateSchema,
  STANDARD_DASHBOARDS,
  tileLevel,
  type ChartResult,
  type DashboardSnapshot,
  type DashboardTemplate,
  type DashboardWidget,
  type ListResult,
  type StatusResult,
  type TileResult,
  type WidgetFilter,
  type WidgetResult,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getEffectiveBoard, visibleFields } from "../boards/service.js";

/**
 * Dashboard service (VEOC-18). Definitions are versioned templates bound
 * to board TEMPLATE keys; every widget aggregates server-side in one SQL
 * statement over the jurisdiction's matching board, under the caller's
 * RLS context. The client receives finished numbers, never raw rows to
 * join (AR6). A widget whose board does not exist in this jurisdiction
 * reports itself missing; the rest of the picture stays up.
 */

export interface DashboardMeta {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly title: string;
  readonly template: DashboardTemplate;
}

/** Ship the standard dashboards into a fresh instance (idempotent). */
export async function ensureStandardDashboards(sql: Sql): Promise<void> {
  for (const template of STANDARD_DASHBOARDS) {
    await sql`
      insert into dashboard_templates (key, version, title, definition)
      values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})
      on conflict (key, version) do nothing`;
  }
}

export async function registerDashboardTemplate(
  sql: Sql,
  actor: Principal,
  raw: unknown,
): Promise<{ key: string; version: number }> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  const template = DashboardTemplateSchema.parse(raw);
  const [existing] = await sql`
    select 1 from dashboard_templates
    where key = ${template.key} and version = ${template.version}`;
  if (existing) throw new AuthError(409, "dashboard template version already exists");
  await sql`
    insert into dashboard_templates (key, version, title, definition)
    values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})`;
  return { key: template.key, version: template.version };
}

/** The export half of the round trip: the definition, exactly as stored. */
export async function exportDashboardTemplate(
  sql: Sql,
  key: string,
  version: number,
): Promise<DashboardTemplate> {
  const [row] = await sql`
    select definition from dashboard_templates
    where key = ${key} and version = ${version}`;
  if (!row) throw new AuthError(404, "dashboard template not found");
  return DashboardTemplateSchema.parse(row.definition);
}

export async function createDashboard(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  templateKey: string,
  version?: number,
  title?: string,
): Promise<string> {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
  const [template] = version
    ? await sql`
        select * from dashboard_templates where key = ${templateKey} and version = ${version}`
    : await sql`
        select * from dashboard_templates where key = ${templateKey}
        order by version desc limit 1`;
  if (!template) throw new AuthError(404, "dashboard template not found");
  const [row] = await sql`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    values (${jurisdictionId}, ${template.key as string}, ${template.version as number},
            ${title ?? (template.title as string)})
    returning id`;
  return row!.id as string;
}

export async function getDashboard(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
): Promise<DashboardMeta> {
  const [row] = await sql`
    select d.id, d.jurisdiction_id, d.title, t.definition
    from dashboards d join dashboard_templates t
      on t.key = d.template_key and t.version = d.template_version
    where d.id = ${dashboardId} and d.archived_at is null`;
  if (!row) throw new AuthError(404, "dashboard not found");
  if (!actor.memberships.some((m) => m.jurisdictionId === (row.jurisdiction_id as string)))
    throw new AuthError(403, "no access to this dashboard");
  return {
    id: row.id as string,
    jurisdictionId: row.jurisdiction_id as string,
    title: row.title as string,
    template: DashboardTemplateSchema.parse(row.definition),
  };
}

export interface DashboardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
}

/**
 * The active dashboards in a jurisdiction the caller belongs to. Discovery
 * for the app shell: any membership role may list, and RLS is the second wall.
 */
export async function listDashboards(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<DashboardListItem[]> {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
  const rows = await sql`
    select id, title, template_key from dashboards
    where jurisdiction_id = ${jurisdictionId} and archived_at is null
    order by title`;
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    templateKey: r.template_key as string,
  }));
}

/** Board template keys a dashboard is bound to (for live invalidation). */
export function boundBoardKeys(template: DashboardTemplate): ReadonlySet<string> {
  return new Set(template.widgets.map((w) => w.board));
}

export async function computeDashboard(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
): Promise<DashboardSnapshot> {
  const dashboard = await getDashboard(sql, actor, dashboardId);
  const widgets: WidgetResult[] = [];
  for (const widget of dashboard.template.widgets) {
    widgets.push(await computeWidget(sql, actor, dashboard.jurisdictionId, widget));
  }
  return {
    dashboardId: dashboard.id,
    title: dashboard.title,
    computedAt: new Date().toISOString(),
    widgets,
  };
}

async function computeWidget(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  widget: DashboardWidget,
): Promise<WidgetResult> {
  const [board] = await sql`
    select id from boards
    where jurisdiction_id = ${jurisdictionId} and template_key = ${widget.board}
      and archived_at is null
    order by created_at limit 1`;
  if (!board) return missingResult(widget);
  const boardId = board.id as string;

  if (widget.kind === "tile") {
    const [row] = await sql`
      select count(*)::int as n from board_records
      where board_id = ${boardId} ${filterFragment(sql, widget.filter)}`;
    const value = (row?.n as number) ?? 0;
    return {
      kind: "tile",
      key: widget.key,
      title: widget.title,
      value,
      level: tileLevel(value, widget.thresholds),
    } satisfies TileResult;
  }

  if (widget.kind === "chart") {
    const rows = await sql`
      select coalesce(data ->> ${widget.groupBy}, '') as v, count(*)::int as n
      from board_records
      where board_id = ${boardId} ${filterFragment(sql, widget.filter)}
      group by 1 order by 1`;
    return {
      kind: "chart",
      key: widget.key,
      title: widget.title,
      groups: rows.map((r) => ({ value: r.v as string, count: r.n as number })),
    } satisfies ChartResult;
  }

  if (widget.kind === "status") {
    // Latest record per group: the current condition, older entries history.
    const rows = await sql`
      select g, v, at from (
        select data ->> ${widget.groupBy} as g,
               data ->> ${widget.valueField} as v,
               coalesce(updated_at, created_at) as at,
               row_number() over (
                 partition by data ->> ${widget.groupBy}
                 order by coalesce(updated_at, created_at) desc
               ) as rn
        from board_records
        where board_id = ${boardId} and data ? ${widget.groupBy}
      ) latest where rn = 1 order by g`;
    return {
      kind: "status",
      key: widget.key,
      title: widget.title,
      groups: rows.map((r) => ({
        group: r.g as string,
        value: (r.v as string | null) ?? null,
        at: r.at ? new Date(r.at as string).toISOString() : null,
      })),
    } satisfies StatusResult;
  }

  // list: newest records, columns masked to what the actor's role may read.
  const effective = await getEffectiveBoard(sql, actor, boardId);
  const readable = new Set(visibleFields(effective).map((f) => f.key));
  const columns = widget.columns.filter((c) => readable.has(c));
  const rows = await sql`
    select id, data from board_records
    where board_id = ${boardId} ${filterFragment(sql, widget.filter)}
    order by coalesce(updated_at, created_at) desc
    limit ${widget.limit}`;
  return {
    kind: "list",
    key: widget.key,
    title: widget.title,
    columns,
    records: rows.map((r) => {
      const data = r.data as Record<string, unknown>;
      const out: Record<string, unknown> & { id: string } = { id: r.id as string };
      for (const c of columns) if (c in data) out[c] = data[c];
      return out;
    }),
  } satisfies ListResult;
}

function missingResult(widget: DashboardWidget): WidgetResult {
  const base = { key: widget.key, title: widget.title, missing: true as const };
  if (widget.kind === "tile") return { kind: "tile", ...base, value: 0, level: "normal" };
  if (widget.kind === "chart") return { kind: "chart", ...base, groups: [] };
  if (widget.kind === "status") return { kind: "status", ...base, groups: [] };
  return { kind: "list", ...base, columns: widget.columns, records: [] };
}

/**
 * Equality over the field's text projection (booleans and numbers compare
 * via their JSON text form, which ->> yields for scalars).
 */
function filterFragment(sql: Sql, filter: WidgetFilter | undefined): never {
  return (
    filter ? sql`and data ->> ${filter.field} = ${String(filter.equals)}` : sql``
  ) as never;
}
