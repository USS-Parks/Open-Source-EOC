import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureScenarioTemplates } from "./scenario-templates.js";

/**
 * The machinery every exercise scenario seeds with. A scenario writes
 * everything operational through the HTTP API as the person who would write
 * it, so every count and list on the console comes from the real engines;
 * only organizations and people are bootstrapped directly, the way a
 * deployment's first run does. Each API call records the wall-clock window it
 * ran in and the scenario time it stands for, so `placeOnScenarioClock` can
 * move server-stamped times onto the scenario clock afterwards.
 */

export const SCENARIO_TIME_ZONE = "America/Los_Angeles";

export interface ScenarioPerson {
  readonly key: string;
  readonly displayName: string;
  readonly email: string;
  readonly organization: string;
  readonly incidentPositionTitle?: string;
}

export interface ScenarioOrganization {
  readonly slug: string;
  readonly name: string;
}

export interface ScenarioWindow {
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly scenarioAt: Date;
}

/** One seeded scenario: its clock, its owner and incident, its cast, and the windows its API calls ran in. */
export interface ScenarioRun {
  readonly clock: Date;
  readonly jurisdictionId: string;
  readonly incidentId: string;
  readonly organizations: Readonly<Record<string, string>>;
  readonly people: Readonly<Record<string, { readonly id: string; readonly email: string }>>;
  readonly windows: readonly ScenarioWindow[];
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** Local wall-clock date and UTC offset of `instant` in the scenario time zone. */
export function zoned(instant: Date): { date: string; offset: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SCENARIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const offset = String(parts.timeZoneName).replace("GMT", "") || "+00:00";
  return { date: `${parts.year}-${parts.month}-${parts.day}`, offset };
}

/**
 * A scenario clock: the most recent `hhmm` in the scenario time zone, so
 * every scenario time is in the past and at most a day old when the seed runs.
 */
export function scenarioClock(hhmm: string, now = new Date()): Date {
  const { date, offset } = zoned(now);
  const today = new Date(`${date}T${hhmm}:00${offset}`);
  if (today.getTime() <= now.getTime()) return today;
  const yesterday = zoned(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return new Date(`${yesterday.date}T${hhmm}:00${yesterday.offset}`);
}

export interface ScenarioCast {
  readonly owner: ScenarioOrganization;
  readonly partners: readonly ScenarioOrganization[];
  readonly people: readonly ScenarioPerson[];
  /** Keys of the people who administer their organization. */
  readonly admins: readonly string[];
  readonly password: string;
}

type Method = "GET" | "POST" | "PUT" | "PATCH";

/**
 * Stand up a scenario's organizations and people and return the calls it
 * seeds with. An organization another scenario already created is reused by
 * its slug, so several scenarios share one database the way a regional host
 * serves several organizations.
 */
export async function startScenario(app: FastifyInstance, sql: Sql, clock: Date, cast: ScenarioCast) {
  const startedAt = new Date();
  const windows: ScenarioWindow[] = [];
  /** Scenario day local time "HH:MM", optionally days from the scenario day. */
  const at = (hhmm: string, days = 0): Date => {
    const day = new Date(clock.getTime() + days * 24 * 60 * 60 * 1000);
    const { date, offset } = zoned(day);
    return new Date(`${date}T${hhmm}:00${offset}`);
  };
  const iso = (hhmm: string, days = 0) => at(hhmm, days).toISOString();

  await ensureStandardTemplates(sql);
  await ensureStandardIncidentTemplates(sql);
  await ensureScenarioTemplates(sql);
  await ensureStandardDashboards(sql);

  const organizations: Record<string, string> = {};
  for (const organization of [cast.owner, ...cast.partners]) {
    const [existing] = await sql`select id from jurisdictions where slug = ${organization.slug}`;
    organizations[organization.slug] = existing
      ? existing.id as string
      : await createJurisdiction(sql, organization.slug, organization.name);
  }
  const people: Record<string, { id: string; email: string }> = {};
  for (const person of cast.people) {
    const id = await createPerson(sql, { email: person.email, displayName: person.displayName, password: cast.password });
    await addMembership(sql, id, organizations[person.organization]!, cast.admins.includes(person.key) ? "admin" : "member");
    people[person.key] = { id, email: person.email };
  }
  const jurisdictionId = organizations[cast.owner.slug]!;

  const tokens: Record<string, string> = {};
  async function token(key: string): Promise<string> {
    if (tokens[key]) return tokens[key];
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: people[key]!.email, password: cast.password },
    });
    if (response.statusCode !== 200) throw new Error(`sign-in for ${key} failed: ${response.statusCode} ${response.body}`);
    tokens[key] = response.json().accessToken as string;
    return tokens[key];
  }
  /** One API call as `who`, standing for scenario time `when`. */
  async function api<T = Record<string, unknown>>(who: string, when: Date, method: Method, url: string, payload?: unknown): Promise<T> {
    const authorization = `Bearer ${await token(who)}`;
    const begun = new Date();
    const response = await app.inject({
      method, url, headers: { authorization },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    windows.push({ startedAt: begun, endedAt: new Date(), scenarioAt: when });
    if (response.statusCode >= 300) throw new Error(`${method} ${url} as ${who} failed: ${response.statusCode} ${response.body}`);
    return (response.body ? response.json() : {}) as T;
  }

  /** Events queued with `later`, run by `runInOrder` in scenario time order. */
  const plan: { when: Date; run: () => Promise<unknown> }[] = [];
  const later = (when: Date, run: () => Promise<unknown>) => { plan.push({ when, run }); };
  /** Run the queued events in scenario time order, so the record of events reads in order. */
  async function runInOrder(): Promise<void> {
    plan.sort((left, right) => left.when.getTime() - right.when.getTime());
    for (const step of plan.splice(0)) await step.run();
  }
  const finish = (incidentId: string): ScenarioRun =>
    ({ clock, jurisdictionId, incidentId, organizations, people, windows, startedAt, endedAt: new Date() });

  return { at, iso, api, later, runInOrder, finish, jurisdictionId, organizations, people };
}

/** The demo's one sign-in: North Coast Storm's lead, Humboldt County OES's administrator. */
export const DEMO_DIRECTOR_EMAIL = "jordan.lee@humboldt.example";

/**
 * Seat the demo's director on an incident another organization owns, as a
 * coordinator for Humboldt County OES, when the director is in this database,
 * so the one demo sign-in reaches every exercise.
 */
export async function grantDemoDirector(
  sql: Sql,
  api: (who: string, when: Date, method: "POST", url: string, payload?: unknown) => Promise<unknown>,
  owner: string,
  when: Date,
  incidentId: string,
): Promise<void> {
  const [director] = await sql`select 1 from persons where email = ${DEMO_DIRECTOR_EMAIL}`;
  if (!director) return;
  await api(owner, when, "POST", `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "humboldt-oes", personEmail: DEMO_DIRECTOR_EMAIL, incidentPositionTitle: "Exercise director",
    role: "coordinator", expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    reason: "The demo's exercise director",
  });
}

/**
 * Put the server-stamped times of a freshly seeded throwaway database on the
 * scenario clock. Every timestamp written during an API call moves to the
 * scenario time that call stands for, keeping its order within the call;
 * anything else written while seeding moves to just before activation. This
 * runs as the database owner with triggers off, because audit and assessment
 * rows are append-only; it is for scenario databases only. Several scenarios
 * seeded one after another into one database are each placed by their own
 * run, since their wall-clock windows do not overlap.
 */
export async function placeOnScenarioClock(sql: Sql, scenario: ScenarioRun): Promise<void> {
  const columns = await sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type = 'timestamp with time zone'`;
  const before = new Date(scenario.windows[0]!.scenarioAt.getTime() - 60 * 60 * 1000);
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`create temporary table scenario_windows
      (started timestamptz, ended timestamptz, scenario timestamptz) on commit drop`;
    for (const window of scenario.windows) {
      await tx`insert into scenario_windows values (${window.startedAt}, ${window.endedAt}, ${window.scenarioAt})`;
    }
    for (const column of columns) {
      const table = tx(column.table_name as string);
      const name = tx(column.column_name as string);
      await tx`update ${table} set ${name} = w.scenario + (${table}.${name} - w.started)
        from scenario_windows w where ${table}.${name} between w.started and w.ended`;
      await tx`update ${table} set ${name} = ${before}
        where ${name} between ${scenario.startedAt} and ${scenario.endedAt}`;
    }
  });
}
