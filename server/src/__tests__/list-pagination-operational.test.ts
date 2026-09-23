import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Keyset pagination of the operational lists. Each list is seeded with rows
 * whose sort timestamps differ only in microseconds (at most five per
 * millisecond), and a walk with a small page must return every row exactly
 * once, in the list's own order. A cursor that kept only milliseconds would
 * skip or repeat rows at the page boundaries.
 */

const ROWS = 23;
const PAGE = 5;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let token: string;
let jurisdictionId: string;
let personId: string;
let incidentId: string;
const ids = { thread: "", iapRoot: "", object: "", feed: "", closures: "", dashboard: "", log: "" };

/** A sort timestamp for series row `g`: five distinct values inside one millisecond. */
const tie = () => admin`date_trunc('milliseconds', now()) + (g % 5) * interval '1 microsecond'`;
const idsOf = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((row) => row.id as string);

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  personId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null, integrations: ["tracking"] });
  token = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const activated = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: auth(token), payload: { templateKey: "daily_ops", name: "Paging activation" },
  });
  expect(activated.statusCode, activated.body).toBe(201);
  incidentId = activated.json().incidentId as string;
  const series = admin`generate_series(1, ${ROWS}) g`;
  const j = jurisdictionId;
  const p = personId;

  await admin`
    with thread as (
      insert into threads (jurisdiction_id, kind, title, created_by, created_at)
      select ${j}, 'group', 'thread ' || g, ${p}, ${tie()} from ${series} returning id)
    insert into thread_members (thread_id, member_kind, person_id, added_by)
    select id, 'person', ${p}, ${p} from thread`;
  ids.thread = idsOf(await admin`select id from threads limit 1`)[0]!;
  await admin`
    insert into messages (thread_id, sender_person, body)
    select ${ids.thread}, ${p}, 'message ' || g from ${series}`;
  await admin`
    insert into cap_alerts (jurisdiction_id, identifier, origin, status, msg_type, scope, alert, xml, created_by, created_at)
    select ${j}, 'paging-' || g, 'ingested', 'Actual', 'Alert', 'Public', '{}'::jsonb, '', ${p}, ${tie()} from ${series}`;
  await admin`
    insert into damage_assessments (jurisdiction_id, address, structure_type, degree, source, status, created_at)
    select ${j}, g || ' Main St', 'residential', 'minor', 'official', 'submitted', ${tie()} from ${series}`;
  const content = { period: "P", composedAt: "2026-09-23T00:00:00Z", lifelines: [], boards: [], significantEvents: [] };
  await admin`
    insert into sitreps (jurisdiction_id, period, content, composed_by, composed_at)
    select ${j}, 'P' || g, ${admin.json(content)}, ${p}, ${tie()} from ${series}`;
  // The IAP guards check the acting session and the approval workflow; neither is under test here.
  await admin`alter table iaps disable trigger iap_attribution_transition_guard`;
  await admin`alter table iaps disable trigger iap_revision_lineage_guard`;
  await admin`
    with iap as (select gen_random_uuid() as id, g from ${series})
    insert into iaps (id, incident_id, operational_period, content, prepared_by, prepared_organization_id,
      prepared_role_key, prepared_role_label, revision_root_id, revision_number, content_revision, created_at)
    select id, ${incidentId}, 'OP ' || g, '{}'::jsonb, ${p}, ${j}, 'planning', 'Planning', id, 1, 1, ${tie()} from iap`;
  ids.iapRoot = idsOf(await admin`
    select id from iaps where incident_id = ${incidentId} order by created_at, id limit 1`)[0]!;
  await admin`
    with chain as (select gen_random_uuid() as id, g from generate_series(2, ${ROWS}) g)
    insert into iaps (id, incident_id, operational_period, content, prepared_by, prepared_organization_id,
      prepared_role_key, prepared_role_label, revision_root_id, revision_number, content_revision, supersedes_iap_id)
    select id, ${incidentId}, 'OP 1', '{}'::jsonb, ${p}, ${j}, 'planning', 'Planning', ${ids.iapRoot}, g, 1,
      coalesce(lag(id) over (order by g), ${ids.iapRoot}::uuid) from chain`;
  await admin`alter table iaps enable trigger iap_attribution_transition_guard`;
  await admin`alter table iaps enable trigger iap_revision_lineage_guard`;
  await admin`
    insert into resource_requests (jurisdiction_id, origin, item, requested_by)
    select ${j}, 'eoc', 'item ' || (g % 4), ${p} from ${series}`;
  await admin`
    insert into aar_observations (jurisdiction_id, incident_id, capability, kind, observation, created_by, created_at)
    select ${j}, ${incidentId}, 'Planning', 'strength', 'observation ' || g, ${p}, ${tie()} from ${series}`;
  await admin`
    insert into corrective_actions (jurisdiction_id, capability, recommendation, created_by, created_at)
    select ${j}, 'Planning', 'action ' || g, ${p}, ${tie()} from ${series}`;
  await admin`
    with position as (
      insert into positions (jurisdiction_id, key, title)
      select ${j}, 'paging_' || g, 'Paging ' || g from ${series} returning id)
    insert into staff_checkins (jurisdiction_id, person_id, position_id, method, checked_in_by, checked_in_at)
    select ${j}, ${p}, id, 'manual', ${p},
      date_trunc('milliseconds', now()) + (row_number() over () % 5) * interval '1 microsecond'
    from position`;
  ids.object = idsOf(await admin`
    insert into tracked_objects (jurisdiction_id, tag, kind, label, created_by)
    values (${j}, 'PAGE-1', 'person', 'Paging object', ${p}) returning id`)[0]!;
  await admin`
    insert into tracking_events (object_id, jurisdiction_id, custody_state, occurred_at, recorded_by, created_at, note)
    select ${ids.object}, ${j}, 'in_transit',
      date_trunc('milliseconds', now()) + (g % 3) * interval '1 microsecond', ${p},
      date_trunc('milliseconds', now()) + (g % 2) * interval '1 microsecond', 'event ' || g
    from ${series}`;
  await admin`
    insert into operational_relationships (incident_id, source_domain, source_framework, source_definition_key,
      target_kind, target_id, created_by, organization_id, created_at)
    select ${incidentId}, 'lifeline', 'fema', 'safety_security', 'task', gen_random_uuid(), ${p}, ${j}, ${tie()}
    from ${series}`;
  // Tasks sort by status, due time (none last), sort order and id; ties in every key.
  await admin`
    insert into checklist_items (incident_id, item, sort_order, status, due_at)
    select ${incidentId}, 'task ' || g, g % 3 - 1, case when g % 2 = 0 then 'open' else 'in_progress' end,
      case when g % 4 = 0 then null else ${tie()} end
    from ${series}`;
  ids.feed = idsOf(await admin`
    insert into feeds (jurisdiction_id, name, kind, url, created_by)
    values (${j}, 'Paging feed', 'geojson', 'https://feeds.example.invalid/paging', ${p}) returning id`)[0]!;
  await admin`
    insert into feed_items (feed_id, external_id, title, fetched_at)
    select ${ids.feed}, 'ext-' || g, 'item ' || g, ${tie()} from ${series}`;
  const closures = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${j}/boards`,
    headers: auth(token), payload: { templateKey: "road_closures" },
  });
  ids.closures = closures.json().id as string;
  await admin`
    insert into board_records (board_id, data, geom, created_by, created_at)
    select ${ids.closures},
      jsonb_build_object('road', 'R' || g, 'reason', 'Slide', 'status', 'closed',
        'location', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(-123.5, 41.3))),
      ST_SetSRID(ST_MakePoint(-123.5, 41.3), 4326), ${p}, ${tie()}
    from ${series}`;
  await admin`
    insert into files (jurisdiction_id, name, content_type, size, sha256, uploaded_by, created_at)
    select ${j}, 'file-' || g || '.txt', 'text/plain', 1, md5(g::text) || md5(g::text), ${p}, ${tie()} from ${series}`;
  const dashboard = {
    key: "paging_dashboard", version: 1, title: "Paging dashboard",
    widgets: [{ kind: "list", key: "log", title: "Log", board: "activity_log", columns: ["entry"], limit: 10 }],
  };
  await admin`
    insert into dashboard_templates (key, version, title, definition)
    values ('paging_dashboard', 1, 'Paging dashboard', ${admin.json(dashboard)})`;
  ids.dashboard = idsOf(await admin`
    insert into dashboards (jurisdiction_id, template_key, template_version, title)
    values (${j}, 'paging_dashboard', 1, 'Paging dashboard') returning id`)[0]!;
  ids.log = idsOf(await admin`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'activity_log' order by b.created_at limit 1`)[0]!;
  await admin`
    insert into board_records (board_id, incident_id, data, created_by, created_at)
    select ${ids.log}, ${incidentId}, jsonb_build_object('entry', 'line ' || g), ${p}, ${tie()} from ${series}`;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

interface ListCase {
  readonly name: string;
  readonly path: () => string;
  /** The response key that holds the page's rows. */
  readonly key: string;
  /** Row identity in the response; `id` unless the list names it otherwise. */
  readonly idOf?: (item: Record<string, unknown>) => string;
  /** Where the next cursor lives; `nextCursor` unless the list follows another convention. */
  readonly cursorOf?: (body: Record<string, unknown>) => string | null;
  /** Every row of the list, in its order, straight from the database. */
  readonly expected: () => Promise<readonly string[]>;
  readonly eachPage?: (body: Record<string, unknown>) => void;
}

const cases: readonly ListCase[] = [
  {
    name: "threads", key: "threads", path: () => `/api/v1/jurisdictions/${jurisdictionId}/threads`,
    expected: async () => idsOf(await admin`
      select id from threads where jurisdiction_id = ${jurisdictionId} order by created_at desc, id desc`),
  },
  {
    name: "messages", key: "messages", path: () => `/api/v1/threads/${ids.thread}/messages`,
    expected: async () => idsOf(await admin`select id from messages where thread_id = ${ids.thread} order by seq`),
  },
  {
    name: "CAP alerts", key: "alerts", path: () => `/api/v1/jurisdictions/${jurisdictionId}/cap/alerts`,
    expected: async () => idsOf(await admin`
      select id from cap_alerts where jurisdiction_id = ${jurisdictionId} order by created_at desc, id desc`),
  },
  {
    name: "damage reports", key: "assessments", path: () => `/api/v1/jurisdictions/${jurisdictionId}/damage/assessments`,
    expected: async () => idsOf(await admin`
      select id from damage_assessments where jurisdiction_id = ${jurisdictionId} order by created_at desc, id desc`),
  },
  {
    name: "sitreps", key: "sitreps", path: () => `/api/v1/jurisdictions/${jurisdictionId}/sitreps`,
    expected: async () => idsOf(await admin`
      select id from sitreps where jurisdiction_id = ${jurisdictionId} order by composed_at desc, id desc`),
  },
  {
    name: "IAP workspace", key: "iaps", path: () => `/api/v1/incidents/${incidentId}/iaps`,
    expected: async () => idsOf(await admin`
      select id from iaps where incident_id = ${incidentId} order by created_at desc, id desc`),
    // Every seeded plan plus the revision lineage of the first.
    eachPage: (body) => expect((body.summary as { total: number }).total).toBe(2 * ROWS - 1),
  },
  {
    name: "IAP revisions", key: "revisions", path: () => `/api/v1/iap/${ids.iapRoot}/revisions`,
    expected: async () => idsOf(await admin`
      select id from iaps where revision_root_id = ${ids.iapRoot} order by revision_number, id`),
  },
  {
    name: "resource requests", key: "requests", path: () => `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`,
    expected: async () => idsOf(await admin`
      select id from resource_requests where jurisdiction_id = ${jurisdictionId} order by item, id`),
  },
  {
    name: "AAR observations", key: "observations", path: () => `/api/v1/incidents/${incidentId}/aar/observations`,
    expected: async () => idsOf(await admin`
      select id from aar_observations where incident_id = ${incidentId} order by created_at, id`),
  },
  {
    name: "corrective actions", key: "correctiveActions",
    path: () => `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions?includeComplete=true`,
    expected: async () => idsOf(await admin`
      select id from corrective_actions where jurisdiction_id = ${jurisdictionId} order by created_at, id`),
  },
  {
    name: "staffing check-ins", key: "onDuty", idOf: (item) => item.checkinId as string,
    path: () => `/api/v1/jurisdictions/${jurisdictionId}/staffing`,
    expected: async () => idsOf(await admin`
      select id from staff_checkins where jurisdiction_id = ${jurisdictionId} and checked_out_at is null
      order by checked_in_at, id`),
    // Vacancies are decided over every open check-in, not only the page's.
    eachPage: (body) => expect((body.vacantPositions as Array<{ key: string }>)
      .filter((position) => position.key.startsWith("paging_"))).toEqual([]),
  },
  {
    name: "tracking events", key: "chain", idOf: (item) => item.note as string,
    path: () => `/api/v1/tracked-objects/${ids.object}`,
    expected: async () => idsOf(await admin`
      select note as id from tracking_events where object_id = ${ids.object}
      order by occurred_at, created_at, tracking_events.id`),
  },
  {
    name: "operational relationships", key: "relationships",
    path: () => `/api/v1/incidents/${incidentId}/operational-relationships`,
    expected: async () => idsOf(await admin`
      select id from operational_relationships where incident_id = ${incidentId} order by created_at desc, id desc`),
  },
  {
    name: "incident tasks", key: "tasks", path: () => `/api/v1/incidents/${incidentId}/tasks`,
    expected: async () => idsOf(await admin`
      select id from checklist_items where incident_id = ${incidentId}
      order by status, coalesce(due_at, 'infinity'), sort_order, id`),
    eachPage: (body) => expect((body.analytics as { total: number }).total).toBeGreaterThanOrEqual(ROWS),
  },
  {
    name: "feed items", key: "features", path: () => `/api/v1/feeds/${ids.feed}/items`,
    expected: async () => idsOf(await admin`
      select id from feed_items where feed_id = ${ids.feed} order by fetched_at desc, id desc`),
  },
  {
    name: "OGC collection items", key: "features", path: () => `/api/v1/ogc/collections/${ids.closures}/items`,
    cursorOf: (body) => {
      const next = (body.links as Array<{ rel: string; href: string }>).find((link) => link.rel === "next");
      return next ? new URL(next.href, "http://localhost").searchParams.get("cursor") : null;
    },
    expected: async () => idsOf(await admin`
      select id from board_records where board_id = ${ids.closures} order by created_at desc, id desc`),
  },
  {
    name: "files", key: "files", path: () => `/api/v1/jurisdictions/${jurisdictionId}/files`,
    expected: async () => idsOf(await admin`
      select id from files where jurisdiction_id = ${jurisdictionId} order by created_at desc, id desc`),
  },
  {
    name: "dashboard contributions", key: "records",
    path: () => `/api/v1/dashboards/${ids.dashboard}/widgets/log/records?incidentId=${incidentId}`,
    expected: async () => idsOf(await admin`
      select id from board_records where board_id = ${ids.log} and incident_id = ${incidentId}
      order by coalesce(updated_at, created_at) desc, id desc`),
  },
];

async function walk(list: ListCase): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const path = list.path();
    const res = await app.inject({
      method: "GET",
      url: `${path}${path.includes("?") ? "&" : "?"}limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers: auth(token),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const page = body[list.key] as Array<Record<string, unknown>>;
    expect(page.length).toBeLessThanOrEqual(PAGE);
    list.eachPage?.(body);
    seen.push(...page.map(list.idOf ?? ((item) => item.id as string)));
    cursor = (list.cursorOf ?? ((next) => next.nextCursor as string | null))(body);
    pages += 1;
  } while (cursor && pages < 100);
  return seen;
}

describe("operational list pages", () => {
  it.each(cases)("$name: a cursor walk returns every row once, in order", async (list) => {
    const expected = await list.expected();
    expect(expected.length).toBeGreaterThanOrEqual(ROWS);
    expect(await walk(list)).toEqual(expected);
  });

  it.each(cases)("$name: refuses a malformed cursor and an oversized page", async (list) => {
    const path = list.path();
    const separator = path.includes("?") ? "&" : "?";
    for (const query of ["cursor=not-a-cursor", "limit=1001"]) {
      const res = await app.inject({ method: "GET", url: `${path}${separator}${query}`, headers: auth(token) });
      expect(res.statusCode, `${query}: ${res.body}`).toBe(400);
    }
  });

  it("keeps the message poll: `after` returns only newer messages", async () => {
    const [cut] = await admin`select seq from messages where thread_id = ${ids.thread} order by seq offset 19 limit 1`;
    const res = await app.inject({
      method: "GET", url: `/api/v1/threads/${ids.thread}/messages?after=${cut!.seq as string}`, headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: Array<{ seq: number }>; nextCursor: string | null };
    expect(body.messages.map((message) => message.seq)).toEqual(
      (await admin`select seq from messages where thread_id = ${ids.thread} and seq > ${cut!.seq as string}::bigint order by seq`)
        .map((row) => Number(row.seq)));
    expect(body.nextCursor).toBeNull();
  });
});
