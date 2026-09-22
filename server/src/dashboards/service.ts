import {
  DashboardTemplateSchema,
  geometryFieldKey,
  STANDARD_DASHBOARDS,
  tileLevel,
  type ChartResult,
  type DashboardContributionPage,
  type DashboardFilterSet,
  type DashboardResolvedOperationalPeriod,
  type DashboardSnapshot,
  type DashboardTemplate,
  type DashboardWidget,
  type ListResult,
  type StatusResult,
  type TileResult,
  type WidgetFilter,
  type WidgetResult,
  type ViewportBbox
} from '@openeoc/shared'
import type { Sql } from '../db/client.js'
import { AuthError, type Principal } from '../auth/service.js'
import { getEffectiveBoard, getIncidentBoardReadShape, visibleFields } from '../boards/service.js'
import { getIncidentAuthority } from '../incidents/participation.js'
import { bboxEnvelope, spatialScope } from '../impact/bbox.js'

/**
 * Dashboard service. Definitions are versioned templates bound
 * to board TEMPLATE keys; every widget aggregates server-side in one SQL
 * statement over the jurisdiction's matching board, under the caller's
 * RLS context. The client receives finished numbers, never raw rows to
 * join (AR6). A widget whose board does not exist in this jurisdiction
 * reports itself missing; the rest of the picture stays up.
 */

export interface DashboardMeta {
  readonly id: string
  readonly jurisdictionId: string
  readonly title: string
  readonly template: DashboardTemplate
}

/** Ship the standard dashboards into a fresh instance (idempotent). */
export async function ensureStandardDashboards(sql: Sql): Promise<void> {
  for (const template of STANDARD_DASHBOARDS) {
    await sql`
      insert into dashboard_templates (key, version, title, definition)
      values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})
      on conflict (key, version) do nothing`
  }
}

export async function registerDashboardTemplate(
  sql: Sql,
  actor: Principal,
  raw: unknown
): Promise<{ key: string; version: number }> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, 'requires instance admin')
  const template = DashboardTemplateSchema.parse(raw)
  const [existing] = await sql`
    select 1 from dashboard_templates
    where key = ${template.key} and version = ${template.version}`
  if (existing) throw new AuthError(409, 'dashboard template version already exists')
  await sql`
    insert into dashboard_templates (key, version, title, definition)
    values (${template.key}, ${template.version}, ${template.title}, ${sql.json(template)})`
  return { key: template.key, version: template.version }
}

/** The export half of the round trip: the definition, exactly as stored. */
export async function exportDashboardTemplate(
  sql: Sql,
  key: string,
  version: number
): Promise<DashboardTemplate> {
  const [row] = await sql`
    select definition from dashboard_templates
    where key = ${key} and version = ${version}`
  if (!row) throw new AuthError(404, 'dashboard template not found')
  return DashboardTemplateSchema.parse(row.definition)
}

export async function createDashboard(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  templateKey: string,
  version?: number,
  title?: string
): Promise<string> {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId)
  if (!m || m.role !== 'admin') throw new AuthError(403, 'requires jurisdiction admin')
  const [template] = version
    ? await sql`
        select * from dashboard_templates where key = ${templateKey} and version = ${version}`
    : await sql`
        select * from dashboard_templates where key = ${templateKey}
        order by version desc limit 1`
  if (!template) throw new AuthError(404, 'dashboard template not found')
  const [row] = await sql`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    values (${jurisdictionId}, ${template.key as string}, ${template.version as number},
            ${title ?? (template.title as string)})
    returning id`
  return row!.id as string
}

export async function getDashboard(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
  incidentId?: string
): Promise<DashboardMeta> {
  const authority = incidentId ? await getIncidentAuthority(sql, actor, incidentId) : null
  if (incidentId) await sql`select set_config('app.incident_id', ${incidentId}, true)`
  const [row] = await sql`
    select d.id, d.jurisdiction_id, d.title, t.definition
    from dashboards d join dashboard_templates t
      on t.key = d.template_key and t.version = d.template_version
    where d.id = ${dashboardId} and d.archived_at is null`
  if (!row) throw new AuthError(404, 'dashboard not found')
  if (authority && authority.jurisdictionId !== (row.jurisdiction_id as string))
    throw new AuthError(404, 'dashboard not found')
  if (
    !incidentId &&
    !actor.memberships.some((m) => m.jurisdictionId === (row.jurisdiction_id as string))
  )
    throw new AuthError(403, 'no access to this dashboard')
  return {
    id: row.id as string,
    jurisdictionId: row.jurisdiction_id as string,
    title: row.title as string,
    template: DashboardTemplateSchema.parse(row.definition)
  }
}

export interface DashboardListItem {
  readonly id: string
  readonly title: string
  readonly templateKey: string
}

/**
 * The active dashboards in a jurisdiction the caller belongs to. Discovery
 * for the app shell: any membership role may list, and RLS is the second wall.
 */
export async function listDashboards(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId?: string
): Promise<DashboardListItem[]> {
  const authority = incidentId ? await getIncidentAuthority(sql, actor, incidentId) : null
  if (authority && authority.jurisdictionId !== jurisdictionId)
    throw new AuthError(404, 'jurisdiction not found')
  if (incidentId) await sql`select set_config('app.incident_id', ${incidentId}, true)`
  if (!incidentId && !actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, 'no access to this jurisdiction')
  const rows = await sql`
    select id, title, template_key from dashboards
    where jurisdiction_id = ${jurisdictionId} and archived_at is null
    order by title`
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    templateKey: r.template_key as string
  }))
}

/** Board template keys a dashboard is bound to (for live invalidation). */
export function boundBoardKeys(template: DashboardTemplate): ReadonlySet<string> {
  return new Set(template.widgets.map((w) => w.board))
}

export async function computeDashboard(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
  runtimeFilter?: WidgetFilter,
  incidentId?: string,
  bbox?: ViewportBbox,
  filters?: DashboardFilterSet
): Promise<DashboardSnapshot> {
  const dashboard = await getDashboard(sql, actor, dashboardId, incidentId)
  const resolvedOperationalPeriod = await resolveDashboardOperationalPeriod(
    sql,
    actor,
    incidentId,
    filters?.operationalPeriod
  )
  const operationalPeriodFilter =
    filters?.operationalPeriod && resolvedOperationalPeriod
      ? { field: filters.operationalPeriod.field, equals: resolvedOperationalPeriod.label }
      : undefined
  const widgets: WidgetResult[] = []
  for (const widget of dashboard.template.widgets) {
    widgets.push(
      await computeWidget(
        sql,
        actor,
        dashboard.jurisdictionId,
        widget,
        runtimeFilter,
        incidentId,
        bbox,
        filters,
        operationalPeriodFilter
      )
    )
  }
  return {
    dashboardId: dashboard.id,
    ...(incidentId || bbox ? { scope: spatialScope(bbox) } : {}),
    title: dashboard.title,
    computedAt: new Date().toISOString(),
    widgets,
    filter: runtimeFilter ?? null,
    filters: filters ?? null,
    resolvedOperationalPeriod
  }
}

export async function resolveDashboardOperationalPeriod(
  sql: Sql,
  actor: Principal,
  incidentId: string | undefined,
  selection: DashboardFilterSet['operationalPeriod']
): Promise<DashboardResolvedOperationalPeriod | null> {
  if (!selection) return null
  if (!incidentId) throw new AuthError(400, 'operational period requires an incident scope')
  await getIncidentAuthority(sql, actor, incidentId)
  const [period] = await sql`
    select period_label, period_starts_at, period_ends_at
    from incident_area_revisions
    where incident_id = ${incidentId} and revision = ${selection.areaRevision}
      and period_label is not null`
  if (!period) throw new AuthError(400, 'operational period revision is unavailable')
  const variants = await sql`
    select period_starts_at, period_ends_at
    from incident_area_revisions
    where incident_id = ${incidentId} and period_label = ${period.period_label as string}
    group by period_starts_at, period_ends_at`
  if (variants.length > 1)
    throw new AuthError(400, 'operational period label is ambiguous in this incident')
  return {
    areaRevision: selection.areaRevision,
    label: period.period_label as string,
    startsAt: new Date(period.period_starts_at as Date | string).toISOString(),
    endsAt: new Date(period.period_ends_at as Date | string).toISOString()
  }
}

async function computeWidget(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  widget: DashboardWidget,
  runtimeFilter?: WidgetFilter,
  incidentId?: string,
  bbox?: ViewportBbox,
  filters?: DashboardFilterSet,
  operationalPeriodFilter?: WidgetFilter
): Promise<WidgetResult> {
  // Board selection. An incident-scoped dashboard (VEOC-79B2) aggregates over
  // the board THIS incident uses for the widget's template, because activation
  // gives each incident its own board instance; scoping by incident_id alone
  // would read a sibling incident's board. Having selected the incident's
  // board, the incident clause below narrows to its incident-tagged records so
  // the totals reconcile with the scoped board view. Unscoped keeps the
  // jurisdiction's first board of the template.
  const resolved = await resolveWidgetBoard(sql, actor, jurisdictionId, widget, incidentId)
  if (!resolved) return missingResult(widget)
  const { boardId, effective, readable } = resolved
  if (!widgetFieldsReadable(widget, runtimeFilter, filters, operationalPeriodFilter, readable))
    return missingResult(widget, readable)
  const geometryKey = geometryFieldKey(effective.fields)
  if (bbox && (!geometryKey || !readable.has(geometryKey))) return missingResult(widget, readable)
  const incidentClause = incidentFragment(sql, incidentId)
  const viewportClause = viewportFragment(sql, bbox)
  const filtersClause = filtersFragment(
    sql,
    widget.filter,
    runtimeFilter,
    filters,
    operationalPeriodFilter
  )

  if (widget.kind === 'tile') {
    const [row] = await sql`
      select
        count(*)::int as n,
        count(*) filter (where created_at > now() - interval '24 hours')::int as recent
      from board_records
      where board_id = ${boardId} ${filtersClause} ${incidentClause} ${viewportClause}`
    const value = (row?.n as number) ?? 0
    return {
      kind: 'tile',
      key: widget.key,
      title: widget.title,
      value,
      level: tileLevel(value, widget.thresholds),
      trend: (row?.recent as number) ?? 0
    } satisfies TileResult
  }

  if (widget.kind === 'chart') {
    const rows = await sql`
      select coalesce(data ->> ${widget.groupBy}, '') as v, count(*)::int as n
      from board_records
      where board_id = ${boardId} ${filtersClause} ${incidentClause} ${viewportClause}
      group by 1 order by 1`
    return {
      kind: 'chart',
      key: widget.key,
      title: widget.title,
      display: widget.display,
      field: widget.groupBy,
      groups: rows.map((r) => ({ value: r.v as string, count: r.n as number }))
    } satisfies ChartResult
  }

  if (widget.kind === 'status') {
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
          ${filtersClause} ${incidentClause} ${viewportClause}
      ) latest where rn = 1 order by g`
    return {
      kind: 'status',
      key: widget.key,
      title: widget.title,
      groups: rows.map((r) => ({
        group: r.g as string,
        value: (r.v as string | null) ?? null,
        at: r.at ? new Date(r.at as string).toISOString() : null
      }))
    } satisfies StatusResult
  }

  // list: newest records, columns masked to what the actor's role may read.
  const columns = widget.columns.filter((c) => readable.has(c))
  const rows = await sql`
    select id, data from board_records
    where board_id = ${boardId} ${filtersClause} ${incidentClause} ${viewportClause}
    order by coalesce(updated_at, created_at) desc
    limit ${widget.limit}`
  return {
    kind: 'list',
    key: widget.key,
    title: widget.title,
    columns,
    records: rows.map((r) => {
      const data = r.data as Record<string, unknown>
      const out: Record<string, unknown> & { id: string } = { id: r.id as string }
      for (const c of columns) if (c in data) out[c] = data[c]
      return out
    })
  } satisfies ListResult
}

interface ResolvedWidgetBoard {
  readonly boardId: string
  readonly effective: Awaited<ReturnType<typeof getEffectiveBoard>>
  readonly readable: ReadonlySet<string>
}

async function resolveWidgetBoard(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  widget: DashboardWidget,
  incidentId?: string
): Promise<ResolvedWidgetBoard | null> {
  const [board] = incidentId
    ? await sql`
        select b.id from boards b
        join incident_boards ib on ib.board_id = b.id
        where ib.incident_id = ${incidentId} and b.template_key = ${widget.board}
          and b.archived_at is null
        order by b.created_at limit 1`
    : await sql`
        select id from boards
        where jurisdiction_id = ${jurisdictionId} and template_key = ${widget.board}
          and archived_at is null
        order by created_at limit 1`
  if (!board) return null
  const boardId = board.id as string
  const effective = incidentId
    ? await getIncidentBoardReadShape(sql, actor, incidentId, boardId)
    : await getEffectiveBoard(sql, actor, boardId)
  const readable = new Set(visibleFields(effective).map((field) => field.key))
  return { boardId, effective, readable }
}

/** Reject aggregate inputs that would reveal a field hidden from this role. */
function widgetFieldsReadable(
  widget: DashboardWidget,
  runtimeFilter: WidgetFilter | undefined,
  filters: DashboardFilterSet | undefined,
  operationalPeriodFilter: WidgetFilter | undefined,
  readable: ReadonlySet<string>
): boolean {
  if (widget.filter && !readable.has(widget.filter.field)) return false
  if (runtimeFilter && !readable.has(runtimeFilter.field)) return false
  if (filters?.category && !readable.has(filters.category.field)) return false
  if (operationalPeriodFilter && !readable.has(operationalPeriodFilter.field)) return false
  if (widget.kind === 'chart') return readable.has(widget.groupBy)
  if (widget.kind === 'status')
    return readable.has(widget.groupBy) && readable.has(widget.valueField)
  return true
}

function missingResult(widget: DashboardWidget, readable?: ReadonlySet<string>): WidgetResult {
  const base = { key: widget.key, title: widget.title, missing: true as const }
  if (widget.kind === 'tile') return { kind: 'tile', ...base, value: 0, level: 'normal' }
  if (widget.kind === 'chart')
    return { kind: 'chart', ...base, display: widget.display, groups: [] }
  if (widget.kind === 'status') return { kind: 'status', ...base, groups: [] }
  return {
    kind: 'list',
    ...base,
    columns: readable ? widget.columns.filter((column) => readable.has(column)) : widget.columns,
    records: []
  }
}

/**
 * Equality over the field's text projection (booleans and numbers compare
 * via their JSON text form, which ->> yields for scalars).
 */
function filterFragment(sql: Sql, filter: WidgetFilter | undefined): never {
  return (filter ? sql`and data ->> ${filter.field} = ${String(filter.equals)}` : sql``) as never
}

function filtersFragment(
  sql: Sql,
  staticFilter: WidgetFilter | undefined,
  runtimeFilter: WidgetFilter | undefined,
  filters: DashboardFilterSet | undefined,
  operationalPeriodFilter: WidgetFilter | undefined
): never {
  const dateFrom = filters?.date?.from
  const dateTo = filters?.date?.to
  return sql`${filterFragment(sql, staticFilter)} ${filterFragment(sql, runtimeFilter)}
    ${filterFragment(sql, filters?.category)}
    ${filterFragment(sql, operationalPeriodFilter)}
    ${dateFrom ? sql`and coalesce(updated_at, created_at) >= ${dateFrom}` : sql``}
    ${dateTo ? sql`and coalesce(updated_at, created_at) < ${dateTo}` : sql``}` as never
}

function cursorValue(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      !Number.isFinite(Date.parse(parsed[0])) ||
      typeof parsed[1] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed[1])
    )
      throw new Error('bad cursor')
    return { at: parsed[0], id: parsed[1] }
  } catch {
    throw new AuthError(400, 'invalid contribution cursor')
  }
}

function contributionCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id]), 'utf8').toString('base64url')
}

export async function listDashboardContributions(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
  widgetKey: string,
  incidentId: string,
  runtimeFilter: WidgetFilter | undefined,
  filters: DashboardFilterSet | undefined,
  group: string | undefined,
  cursor: string | undefined,
  requestedLimit: number,
  bbox?: ViewportBbox
): Promise<DashboardContributionPage> {
  const dashboard = await getDashboard(sql, actor, dashboardId, incidentId)
  const widget = dashboard.template.widgets.find((candidate) => candidate.key === widgetKey)
  if (!widget) throw new AuthError(404, 'dashboard widget not found')
  if (widget.kind === 'status')
    throw new AuthError(409, 'status widgets do not expose contributing records')
  if (group !== undefined && widget.kind !== 'chart')
    throw new AuthError(400, 'group drilldown requires a chart widget')
  const resolvedOperationalPeriod = await resolveDashboardOperationalPeriod(
    sql,
    actor,
    incidentId,
    filters?.operationalPeriod
  )
  const operationalPeriodFilter =
    filters?.operationalPeriod && resolvedOperationalPeriod
      ? { field: filters.operationalPeriod.field, equals: resolvedOperationalPeriod.label }
      : undefined
  const resolved = await resolveWidgetBoard(
    sql,
    actor,
    dashboard.jurisdictionId,
    widget,
    incidentId
  )
  if (!resolved) throw new AuthError(404, 'dashboard widget source not found')
  const { boardId, effective, readable } = resolved
  if (!widgetFieldsReadable(widget, runtimeFilter, filters, operationalPeriodFilter, readable))
    throw new AuthError(404, 'dashboard widget not found')
  const geometryKey = geometryFieldKey(effective.fields)
  if (bbox && (!geometryKey || !readable.has(geometryKey)))
    throw new AuthError(404, 'dashboard widget not found')
  const groupFilter =
    group === undefined || widget.kind !== 'chart'
      ? undefined
      : { field: widget.groupBy, equals: group }
  const baseFilters = filtersFragment(
    sql,
    widget.filter,
    runtimeFilter,
    filters,
    operationalPeriodFilter
  )
  const incidentClause = incidentFragment(sql, incidentId)
  const viewportClause = viewportFragment(sql, bbox)
  const groupClause =
    groupFilter === undefined
      ? sql``
      : sql`and coalesce(data ->> ${groupFilter.field}, '') = ${String(groupFilter.equals)}`
  const parsedCursor = cursorValue(cursor)
  const limit = Math.max(1, Math.min(requestedLimit, 100))
  const geometryProjection =
    geometryKey && readable.has(geometryKey) ? sql`ST_AsGeoJSON(geom)::jsonb` : sql`null::jsonb`
  const [countRow] = await sql`
    select count(*)::int as total from board_records
    where board_id = ${boardId} ${baseFilters} ${groupClause}
      ${incidentClause} ${viewportClause}`
  const rows = await sql`
    with matched as (
      select id, data, coalesce(updated_at, created_at) as at, geom
      from board_records
      where board_id = ${boardId} ${baseFilters} ${groupClause}
        ${incidentClause} ${viewportClause}
    )
    select id, data, at, at::text as cursor_at, ${geometryProjection} as geometry
    from matched
    where (${parsedCursor?.at ?? null}::timestamptz is null
      or (at, id) < (${parsedCursor?.at ?? null}::timestamptz, ${parsedCursor?.id ?? null}::uuid))
    order by at desc, id desc
    limit ${limit + 1}`
  const page = rows.slice(0, limit)
  const columns =
    widget.kind === 'list' ? widget.columns.filter((column) => readable.has(column)) : [...readable]
  return {
    dashboardId,
    widgetKey,
    scope: spatialScope(bbox),
    total: (countRow?.total as number | undefined) ?? 0,
    records: page.map((row) => {
      const source = row.data as Record<string, unknown>
      const data: Record<string, unknown> = {}
      for (const field of columns) if (field in source) data[field] = source[field]
      return {
        id: row.id as string,
        at: new Date(row.at as Date | string).toISOString(),
        data,
        ...(geometryKey && readable.has(geometryKey)
          ? { geometry: (row.geometry as Record<string, unknown> | null) ?? null }
          : {})
      }
    }),
    nextCursor:
      rows.length > limit
        ? contributionCursor(page.at(-1)!.cursor_at as string, page.at(-1)!.id as string)
        : null
  }
}

export async function dashboardWidgetCapabilities(
  sql: Sql,
  actor: Principal,
  dashboardId: string,
  widgetKey: string,
  incidentId: string,
  runtimeFilter?: WidgetFilter,
  filters?: DashboardFilterSet
): Promise<{ widget: DashboardWidget; readableGeometry: boolean; drilldown: boolean }> {
  const dashboard = await getDashboard(sql, actor, dashboardId, incidentId)
  const widget = dashboard.template.widgets.find((candidate) => candidate.key === widgetKey)
  if (!widget) throw new AuthError(404, 'dashboard widget not found')
  const resolvedOperationalPeriod = await resolveDashboardOperationalPeriod(
    sql,
    actor,
    incidentId,
    filters?.operationalPeriod
  )
  const operationalPeriodFilter =
    filters?.operationalPeriod && resolvedOperationalPeriod
      ? { field: filters.operationalPeriod.field, equals: resolvedOperationalPeriod.label }
      : undefined
  const resolved = await resolveWidgetBoard(
    sql,
    actor,
    dashboard.jurisdictionId,
    widget,
    incidentId
  )
  if (
    !resolved ||
    !widgetFieldsReadable(
      widget,
      runtimeFilter,
      filters,
      operationalPeriodFilter,
      resolved.readable
    )
  )
    return { widget, readableGeometry: false, drilldown: false }
  const geometryKey = geometryFieldKey(resolved.effective.fields)
  return {
    widget,
    readableGeometry: geometryKey !== null && resolved.readable.has(geometryKey),
    drilldown: widget.kind !== 'status'
  }
}

/**
 * Narrow an aggregate to one incident's tagged records, or no-op when the
 * dashboard is unscoped. Row-level security is still the access wall; this
 * only filters within what the actor may already read (VEOC-79B2).
 */
function incidentFragment(sql: Sql, incidentId: string | undefined): never {
  return (incidentId ? sql`and incident_id = ${incidentId}` : sql``) as never
}

function viewportFragment(sql: Sql, bbox: ViewportBbox | undefined): never {
  if (!bbox) return sql`` as never
  const envelope = bboxEnvelope(sql, bbox)
  return sql`and geom is not null and geom && ${envelope} and ST_Intersects(geom, ${envelope})` as never
}
