import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";

/**
 * The reference scenario for the design fidelity work: a synthetic severe
 * storm exercise on the North Coast, "North Coast Storm", run as an exercise
 * by Humboldt County OES with seven participating organizations. Everything
 * operational is written through the HTTP API as the person who would write
 * it, so every count and list on the console comes from the real engines.
 * Only identities are bootstrapped directly, the way a deployment's first
 * run does.
 *
 * All scenario times are local times on the scenario day, read against the
 * scenario clock `clock` (09:42 local in the reference captures). The seed
 * records, for every API call, the wall-clock window it ran in and the
 * scenario time it stands for, so a harness can place server-stamped times on
 * the scenario clock afterwards.
 */

export const NORTH_COAST_PASSWORD = "north-coast-exercise";
export const NORTH_COAST_TIME_ZONE = "America/Los_Angeles";

export interface ScenarioPerson {
  readonly key: string;
  readonly displayName: string;
  readonly email: string;
  readonly organization: string;
  readonly incidentPositionTitle?: string;
}

export interface ScenarioWindow {
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly scenarioAt: Date;
}

export interface NorthCoastScenario {
  readonly clock: Date;
  readonly jurisdictionId: string;
  readonly incidentId: string;
  readonly organizations: Readonly<Record<string, string>>;
  readonly people: Readonly<Record<string, { readonly id: string; readonly email: string }>>;
  readonly windows: readonly ScenarioWindow[];
  readonly startedAt: Date;
  readonly endedAt: Date;
}

const OWNER = { slug: "humboldt-oes", name: "Humboldt County OES" };
const PARTNERS = [
  { slug: "caltrans-d1", name: "Caltrans District 1" },
  { slug: "cal-oes", name: "Cal OES" },
  { slug: "red-cross", name: "American Red Cross" },
  { slug: "cdph", name: "CA Dept. of Public Health" },
  { slug: "cec", name: "CA Energy Commission" },
  { slug: "calepa", name: "Cal EPA" },
  { slug: "swrcb", name: "State Water Resources Control Board" },
] as const;

export const NORTH_COAST_PEOPLE: readonly ScenarioPerson[] = [
  { key: "lee", displayName: "Jordan Lee", email: "jordan.lee@humboldt.example", organization: OWNER.slug },
  { key: "kim", displayName: "Taylor Kim", email: "taylor.kim@humboldt.example", organization: OWNER.slug },
  { key: "moreno", displayName: "L. Moreno", email: "l.moreno@humboldt.example", organization: OWNER.slug },
  { key: "nguyen", displayName: "D. Nguyen", email: "d.nguyen@humboldt.example", organization: OWNER.slug },
  { key: "martinez", displayName: "R. Martinez", email: "r.martinez@caltrans.example", organization: "caltrans-d1", incidentPositionTitle: "Caltrans liaison" },
  { key: "rkim", displayName: "R. Kim", email: "r.kim@caltrans.example", organization: "caltrans-d1", incidentPositionTitle: "Transport liaison" },
  { key: "alvarez", displayName: "M. Alvarez", email: "m.alvarez@caloes.example", organization: "cal-oes", incidentPositionTitle: "Law enforcement liaison" },
  { key: "reyes", displayName: "J. Reyes", email: "j.reyes@caloes.example", organization: "cal-oes", incidentPositionTitle: "Mass care liaison" },
  { key: "okafor", displayName: "T. Okafor", email: "t.okafor@caloes.example", organization: "cal-oes", incidentPositionTitle: "Communications liaison" },
  { key: "patel", displayName: "S. Patel", email: "s.patel@redcross.example", organization: "red-cross", incidentPositionTitle: "Shelter liaison" },
  { key: "singh", displayName: "K. Singh", email: "k.singh@cdph.example", organization: "cdph", incidentPositionTitle: "Medical and health liaison" },
  { key: "brooks", displayName: "A. Brooks", email: "a.brooks@cec.example", organization: "cec", incidentPositionTitle: "Utility liaison" },
  { key: "ortiz", displayName: "H. Ortiz", email: "h.ortiz@calepa.example", organization: "calepa", incidentPositionTitle: "Hazardous materials liaison" },
  { key: "chen", displayName: "W. Chen", email: "w.chen@swrcb.example", organization: "swrcb", incidentPositionTitle: "Water systems liaison" },
];

/** The incident area around Humboldt Bay, Trinidad to Fortuna, coast to the first ridges. */
export const NORTH_COAST_AREA = {
  type: "Polygon" as const,
  coordinates: [[
    [-124.165, 41.075], [-124.075, 41.07], [-124.02, 41.0], [-123.965, 40.93], [-123.93, 40.86],
    [-123.955, 40.78], [-124.03, 40.7], [-124.085, 40.6], [-124.175, 40.575], [-124.265, 40.64],
    [-124.285, 40.73], [-124.23, 40.82], [-124.19, 40.93], [-124.165, 41.0], [-124.165, 41.075],
  ]],
};

/** Local wall-clock date and UTC offset of `instant` in the scenario time zone. */
function zoned(instant: Date): { date: string; offset: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: NORTH_COAST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const offset = String(parts.timeZoneName).replace("GMT", "") || "+00:00";
  return { date: `${parts.year}-${parts.month}-${parts.day}`, offset };
}

/**
 * The scenario clock: the most recent 09:42 in the scenario time zone, so
 * every scenario time is in the past and at most a day old when the seed runs.
 */
export function northCoastClock(now = new Date()): Date {
  const { date, offset } = zoned(now);
  const today = new Date(`${date}T09:42:00${offset}`);
  if (today.getTime() <= now.getTime()) return today;
  const yesterday = zoned(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return new Date(`${yesterday.date}T09:42:00${yesterday.offset}`);
}

type Method = "GET" | "POST" | "PUT" | "PATCH";

export async function seedNorthCoast(
  app: FastifyInstance,
  sql: Sql,
  clock = northCoastClock(),
): Promise<NorthCoastScenario> {
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
  await ensureStandardDashboards(sql);

  const organizations: Record<string, string> = {};
  organizations[OWNER.slug] = await createJurisdiction(sql, OWNER.slug, OWNER.name);
  for (const partner of PARTNERS) organizations[partner.slug] = await createJurisdiction(sql, partner.slug, partner.name);
  const people: Record<string, { id: string; email: string }> = {};
  for (const person of NORTH_COAST_PEOPLE) {
    const id = await createPerson(sql, { email: person.email, displayName: person.displayName, password: NORTH_COAST_PASSWORD });
    await addMembership(sql, id, organizations[person.organization]!, person.key === "lee" ? "admin" : "member");
    people[person.key] = { id, email: person.email };
  }
  const jurisdictionId = organizations[OWNER.slug]!;

  const tokens: Record<string, string> = {};
  async function token(key: string): Promise<string> {
    if (tokens[key]) return tokens[key];
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: people[key]!.email, password: NORTH_COAST_PASSWORD },
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

  // Activation the evening before, as an exercise on the severe storm template.
  const activation = await api<{ incidentId: string }>("lee", at("17:05", -1), "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "severe_storm", name: "North Coast Storm", kind: "exercise" });
  const incidentId = activation.incidentId;

  // Operational periods: OP 01 and OP 02 behind, OP 03 current.
  const periods = [
    { label: "OP 01", startsAt: iso("18:00", -2), endsAt: iso("06:00", -1), at: at("17:20", -1) },
    { label: "OP 02", startsAt: iso("18:00", -1), endsAt: iso("06:00"), at: at("17:40", -1) },
    { label: "OP 03", startsAt: iso("06:00"), endsAt: iso("18:00"), at: at("05:40") },
  ];
  let revision = 0;
  for (const period of periods) {
    const result = await api<{ revision: number }>("lee", period.at, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: revision,
      geometry: NORTH_COAST_AREA,
      operationalPeriod: { label: period.label, startsAt: period.startsAt, endsAt: period.endsAt },
      reason: `${period.label} planning cycle for the North Coast Storm exercise`,
    });
    revision = result.revision;
  }

  // The Planning Section Chief position, held and signed in by Jordan Lee.
  const positions = await api<{ positions: { id: string; key: string }[] }>("lee", at("05:30"), "GET",
    `/api/v1/jurisdictions/${jurisdictionId}/positions`);
  const planning = positions.positions.find((position) => position.key === "planning_section_chief");
  if (!planning) throw new Error("the severe storm activation has no Planning Section Chief position");
  await api("lee", at("05:31"), "POST", `/api/v1/positions/${planning.id}/assignments`, { personId: people["lee"]!.id });
  await api("lee", at("05:32"), "POST", `/api/v1/positions/${planning.id}/sign-in`);

  // Seven participating organizations, each through a named liaison.
  const participants: Record<string, string> = {};
  const grantExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const person of NORTH_COAST_PEOPLE.filter((candidate) => candidate.incidentPositionTitle)) {
    const grant = await api<{ id: string }>("lee", at("05:45"), "POST", `/api/v1/incidents/${incidentId}/participants`, {
      organizationSlug: person.organization,
      personEmail: person.email,
      incidentPositionTitle: person.incidentPositionTitle,
      role: "contributor",
      expiresAt: grantExpiry,
      reason: "North Coast Storm exercise participation",
    });
    participants[person.key] = grant.id;
  }

  const incidentBoards = await sql`
    select b.id, b.template_key from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId}`;
  const boardFor = (templateKey: string): string => {
    const row = incidentBoards.find((candidate) => candidate.template_key === templateKey);
    if (!row) throw new Error(`the incident has no ${templateKey} board`);
    return row.id as string;
  };
  const record = (who: string, when: Date, templateKey: string, data: Record<string, unknown>) =>
    api<{ id: string }>(who, when, "POST", `/api/v1/boards/${boardFor(templateKey)}/records?incidentId=${incidentId}`, data);
  const update = (who: string, when: Date, templateKey: string, recordId: string, data: Record<string, unknown>) =>
    api(who, when, "PATCH", `/api/v1/boards/${boardFor(templateKey)}/records/${recordId}?incidentId=${incidentId}`, data);

  /** The morning's events, run below in scenario time order. */
  const plan: { when: Date; run: () => Promise<unknown> }[] = [];
  const later = (when: Date, run: () => Promise<unknown>) => { plan.push({ when, run }); };

  // Shelters: eight open with 312 occupants in all.
  const shelters = [
    { name: "Arcata Community Center", capacity: 240, occupancy: 150, pets: true },
    { name: "Eureka Municipal Auditorium", capacity: 180, occupancy: 41, pets: false },
    { name: "Redwood Acres Fairgrounds", capacity: 300, occupancy: 28, pets: true },
    { name: "Fortuna Veterans Memorial Building", capacity: 120, occupancy: 19, pets: false },
    { name: "McKinleyville Middle School", capacity: 150, occupancy: 14, pets: false },
    { name: "Wendy's Shelter", capacity: 60, occupancy: 12, pets: false },
    { name: "Blue Lake Rancheria Community Center", capacity: 90, occupancy: 7, pets: true },
    { name: "Ferndale Community Church", capacity: 50, occupancy: 4, pets: false },
  ];
  const shelterIds: Record<string, string> = {};
  for (const [index, shelter] of shelters.entries()) {
    const when = at(`06:${String(10 + index * 3).padStart(2, "0")}`);
    later(when, async () => {
      const created = await record("moreno", when, "shelters", {
        name: shelter.name, status: "normal", capacity: shelter.capacity, occupancy: shelter.occupancy,
        pets_accepted: shelter.pets,
      });
      shelterIds[shelter.name] = created.id;
    });
  }

  // Road closures on the incident area's routes.
  const closures = [
    { road: "US-101 at the Mad River bridge", reason: "Debris on the northbound lanes", status: "closed",
      line: [[-124.0965, 40.9275], [-124.0925, 40.915], [-124.0885, 40.9035]] },
    { road: "SR-299 east of Arcata", reason: "Slope failure onto both lanes", status: "closed",
      line: [[-124.037, 40.8725], [-124.012, 40.877], [-123.99, 40.8815]] },
    { road: "US-101 south of Eureka at King Salmon", reason: "Flooding across all lanes", status: "closed",
      line: [[-124.1905, 40.765], [-124.2025, 40.748], [-124.2135, 40.732]] },
    { road: "SR-211 at Fernbridge", reason: "Bridge approach inspection", status: "one_lane",
      line: [[-124.2015, 40.617], [-124.2035, 40.608]] },
  ];
  for (const [index, closure] of closures.entries()) {
    const when = at(`06:${String(30 + index * 4).padStart(2, "0")}`);
    later(when, () => record("rkim", when, "road_closures", {
      road: closure.road, reason: closure.reason, status: closure.status,
      location: { type: "LineString", coordinates: closure.line },
    }));
  }

  // Field reports from the field teams through the morning: 46 in all.
  const fieldReports: ReadonlyArray<readonly [string, string, number, number]> = [
    ["Standing water across Broadway at Wabash Ave", "hazard", -124.1705, 40.7895],
    ["Tree down across Old Arcata Rd", "hazard", -124.0795, 40.8505],
    ["Power line down on Harris St", "hazard", -124.1515, 40.7845],
    ["Culvert overtopping on Jacoby Creek Rd", "damage", -124.0535, 40.8435],
    ["Roof damage at a residence on Pickett Rd", "damage", -124.1395, 40.7765],
    ["Mud across Samoa Blvd at the Manila curve", "hazard", -124.1665, 40.8535],
    ["Sandbags needed at the Arcata Marsh gate", "resource", -124.0885, 40.8575],
    ["Storm drain blocked on Myrtle Ave", "hazard", -124.1395, 40.7955],
    ["Minor slide on Fickle Hill Rd", "hazard", -124.0595, 40.8675],
    ["Flooded parking at Bayshore Mall", "damage", -124.1805, 40.7735],
    ["Generator fuel low at Eureka shelter", "resource", -124.1605, 40.8015],
    ["Downed fence onto Central Ave", "hazard", -124.0925, 40.9445],
    ["Water over the road on Hookton Rd", "hazard", -124.2235, 40.6905],
    ["Road shoulder undercut on Elk River Rd", "damage", -124.1505, 40.7505],
    ["Debris in the lane on Murray Rd", "hazard", -124.0915, 40.9495],
    ["Outage reported on Sunny Brae", "other", -124.0715, 40.8625],
    ["Wind damage to a carport on Walnut Dr", "damage", -124.1305, 40.7665],
    ["Flooded crosswalk at 4th and G St", "hazard", -124.1645, 40.8015],
    ["Tree limbs on lines on Buttermilk Ln", "hazard", -124.0725, 40.8745],
    ["Sheltering family needs cots", "resource", -124.0835, 40.8685],
    ["Standing water on Hwy 36 approach", "hazard", -124.0985, 40.5955],
    ["Seepage at the Eel River levee", "damage", -124.2145, 40.6115],
    ["Road signs down on Fieldbrook Rd", "hazard", -124.0535, 40.9765],
    ["Minor flooding on Ferndale Main St", "damage", -124.2645, 40.5765],
    ["Loose roofing panels on a warehouse", "damage", -124.1745, 40.8005],
    ["Blocked drain on Hilfiker Ln", "hazard", -124.1845, 40.7655],
    ["Welfare check request on Spruce Point", "other", -124.1905, 40.7545],
    ["Slide debris on Westhaven Dr", "hazard", -124.1245, 41.0335],
    ["Pooling water on School Rd", "hazard", -124.0885, 40.9285],
    ["Tree against a house on Dows Prairie Rd", "damage", -124.1005, 40.9665],
    ["Beach access flooded at Moonstone", "hazard", -124.1115, 41.0325],
    ["Pump station alarm on Waterfront Dr", "other", -124.1675, 40.8055],
    ["Tarps needed for roof repairs", "resource", -124.1455, 40.7875],
    ["Traffic signal dark at Harris and F St", "hazard", -124.1615, 40.7855],
    ["Culvert debris on Freshwater Rd", "hazard", -124.0525, 40.7905],
    ["Erosion on the bluff at Trinidad Head", "damage", -124.1515, 41.0575],
    ["Flooding in the Fairhaven lots", "damage", -124.2035, 40.7765],
    ["Utility pole leaning on Myers Ave", "hazard", -124.1115, 40.8205],
    ["Water in the lobby of a senior center", "damage", -124.0835, 40.8665],
    ["Fuel request for field crew trucks", "resource", -124.1305, 40.8105],
    ["Gravel washed onto Jacoby Creek Trail", "hazard", -124.0405, 40.8305],
    ["Landslide risk above Crannell Rd", "hazard", -124.0895, 41.0025],
    ["Minor flooding on Loleta Dr", "damage", -124.2215, 40.6425],
    ["Standing water under the 101 overpass", "hazard", -124.1255, 40.8125],
    ["Stranded vehicle on Table Bluff Rd", "other", -124.2605, 40.6865],
    ["Flooding on 14th St near Eureka High School", "hazard", -124.1545, 40.7925],
  ];
  const reporters = ["kim", "moreno", "nguyen", "kim"];
  const lastReport = fieldReports.length - 1;
  for (const [index, [summary, category, lon, lat]] of fieldReports.entries()) {
    const minute = index === lastReport ? "09:18" : `0${6 + Math.floor(index / 16)}:${String(5 + (index % 16) * 3).padStart(2, "0")}`;
    const when = at(minute);
    later(when, () => record(index === lastReport ? "kim" : reporters[index % reporters.length]!, when, "field_reports", {
      summary: index === lastReport ? `${summary}. Photos attached.` : summary,
      category,
      location: { type: "Point", coordinates: [lon, lat] },
    }));
  }

  // Resource requests: 24 open, six of them immediate.
  const requests: ReadonlyArray<{ item: string; notes: string; priority: string; state: string; neededBy: string; days?: number; owner?: string; who?: string }> = [
    { item: "Clear US-101 debris at the Mad River bridge", notes: "Northbound lanes blocked by debris", priority: "immediate", state: "assigned", neededBy: "12:00", owner: "martinez" },
    { item: "Generator support for Wendy's Shelter", notes: "Shelter lacks backup power", priority: "immediate", state: "sourcing", neededBy: "12:00", owner: "alvarez" },
    { item: "Increase shelter capacity in Eureka", notes: "Open a second room at the auditorium", priority: "priority", state: "assigned", neededBy: "18:00", owner: "nguyen", who: "moreno" },
    { item: "Check access on Westhaven Drive (Trinidad)", notes: "Assess for debris and washouts", priority: "priority", state: "assigned", neededBy: "14:00", owner: "nguyen" },
    { item: "Deliver additional shelter supplies", notes: "Cots, blankets, hygiene kits", priority: "routine", state: "submitted", neededBy: "18:00", owner: "patel", who: "moreno" },
    { item: "Pump trucks for the King Salmon flooding", notes: "Two trucks with operators", priority: "immediate", state: "sourcing", neededBy: "11:00" },
    { item: "Sandbags for the Arcata Marsh gate", notes: "2,000 filled bags", priority: "immediate", state: "triaged", neededBy: "10:30" },
    { item: "Traffic control for the SR-299 closure", notes: "Flaggers and message boards", priority: "immediate", state: "assigned", neededBy: "10:00", owner: "rkim" },
    { item: "Tree crew for Old Arcata Road", notes: "Chainsaw team with chipper", priority: "immediate", state: "sourcing", neededBy: "11:30" },
    { item: "Fuel for field crew trucks", notes: "Diesel delivery to the county yard", priority: "priority", state: "triaged", neededBy: "13:00" },
    { item: "Tarps for roof repairs", notes: "200 heavy tarps", priority: "priority", state: "submitted", neededBy: "16:00" },
    { item: "Portable toilets for Redwood Acres", notes: "Six units with service", priority: "priority", state: "sourcing", neededBy: "15:00" },
    { item: "Cots for the Arcata Community Center", notes: "60 cots", priority: "priority", state: "assigned", neededBy: "12:30", owner: "patel" },
    { item: "Water tender for Blue Lake", notes: "Potable water while treatment runs on backup power", priority: "priority", state: "triaged", neededBy: "14:30" },
    { item: "Light towers for the Fernbridge inspection", notes: "Two towers", priority: "routine", state: "submitted", neededBy: "17:00" },
    { item: "Medical supplies for shelter first aid", notes: "Basic kits for eight shelters", priority: "routine", state: "triaged", neededBy: "16:30", owner: "singh" },
    { item: "Interpreters for shelter intake", notes: "Spanish and Hmong", priority: "routine", state: "submitted", neededBy: "17:30" },
    { item: "Backup radio repeater for the Eureka hills", notes: "Replace the failed repeater site", priority: "priority", state: "sourcing", neededBy: "13:30", owner: "okafor" },
    { item: "Substation inspection crew", notes: "Two substations offline", priority: "priority", state: "assigned", neededBy: "11:00", owner: "brooks" },
    { item: "Hazardous materials survey of the Eureka waterfront", notes: "Assess drums moved by flooding", priority: "routine", state: "triaged", neededBy: "15:30", owner: "ortiz" },
    { item: "Boil water test kits for Blue Lake", notes: "Sampling kits and courier", priority: "routine", state: "submitted", neededBy: "12:00", days: 1, owner: "chen" },
    { item: "Meals for shelter residents", notes: "Three meals for 320 people", priority: "priority", state: "assigned", neededBy: "11:30", owner: "reyes" },
    { item: "Pet crates for the Arcata shelter", notes: "30 crates", priority: "routine", state: "submitted", neededBy: "18:00" },
    { item: "Damage assessment team for Humboldt Bay north", notes: "Two-person windshield survey teams", priority: "routine", state: "submitted", neededBy: "12:00", days: 1 },
  ];
  const flow = ["submitted", "triaged", "sourcing", "assigned"];
  for (const [index, request] of requests.entries()) {
    const when = at(`07:${String(2 + index * 2).padStart(2, "0")}`);
    const who = request.who ?? (index % 2 === 0 ? "lee" : "nguyen");
    later(when, async () => {
      const created = await api<{ id: string }>(who, when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
        origin: "eoc", item: request.item, quantity: 1, priority: request.priority,
        neededBy: iso(request.neededBy, request.days ?? 0), notes: request.notes, incidentId,
      });
      for (const state of flow.slice(1, flow.indexOf(request.state) + 1)) {
        if (state === "assigned") continue;
        await api("lee", when, "POST", `/api/v1/resource-requests/${created.id}/transition`, { toState: state });
      }
      if (request.owner && participants[request.owner]) {
        await api("lee", when, "POST", `/api/v1/resource-requests/${created.id}/assign`,
          { kind: "incident_participant", incidentId, participantId: participants[request.owner] });
      }
      if (request.state === "assigned" && !(request.owner && participants[request.owner])) {
        await api("lee", when, "POST", `/api/v1/resource-requests/${created.id}/transition`, { toState: "assigned" });
      }
    });
  }

  // Tasks from the activation, due within this operational period.
  later(at("06:20"), async () => {
    const tasks = await api<{ tasks: { id: string; revision: number; item: string }[] }>("lee", at("06:20"), "GET",
      `/api/v1/incidents/${incidentId}/tasks`);
    for (const [index, task] of tasks.tasks.entries()) {
      await api("lee", at("06:25"), "PATCH", `/api/v1/incidents/${incidentId}/tasks/${task.id}`, {
        expectedRevision: task.revision,
        dueAt: iso(`${String(10 + index).padStart(2, "0")}:00`),
        ...(index % 3 === 0 ? { status: "in_progress" } : {}),
      });
    }
  });

  // Lifeline assessments, each by the liaison of the reporting organization.
  const lifeline = (who: string, when: string, input: Record<string, unknown>) =>
    later(at(when), () => api(who, at(when), "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
      definitionVersion: 1, assessedAt: iso(when), operationalPeriod: "OP 03", confidence: "confirmed",
      components: [], evidence: [], responsibleOrganizationIds: [], actions: [], ...input,
    }));
  lifeline("ortiz", "09:18", {
    lifeline: "hazardous_materials", condition: "unknown", confidence: "unknown",
    impactStatement: "Assessment pending. Field teams are surveying the waterfront for displaced containers.",
  });
  lifeline("rkim", "09:18", {
    lifeline: "transportation", condition: "unstable",
    impactStatement: "Three access routes closed. US-101 is closed at two segments and SR-299 east of Arcata.",
    stabilizationOutlook: "Reopen US-101 northbound by midday once debris is cleared.",
    components: [
      { key: "highways", label: "Highways and roads", condition: "unstable" },
      { key: "bridges", label: "Bridges", condition: "stabilizing" },
    ],
  });
  lifeline("reyes", "09:15", {
    lifeline: "food_hydration_shelter", condition: "stabilizing",
    impactStatement: "8 shelters supporting 312 people. Additional capacity is being readied in Eureka.",
  });
  lifeline("alvarez", "09:20", {
    lifeline: "safety_security", condition: "stable",
    impactStatement: "Patrol coverage maintained. Normal patrols with no critical issues.",
  });
  lifeline("chen", "09:22", {
    lifeline: "water_systems", condition: "stabilizing",
    impactStatement: "Treatment on backup power. Minor service disruptions and no boil notice.",
  });
  lifeline("singh", "09:25", {
    lifeline: "health_medical", condition: "stable",
    impactStatement: "Emergency services available. Hospitals operating with no surge at this time.",
  });
  lifeline("okafor", "09:28", {
    lifeline: "communications", condition: "stabilizing",
    impactStatement: "Backup links in use. Partial outages with redundant systems carrying traffic.",
  });
  lifeline("brooks", "09:35", {
    lifeline: "energy", condition: "unstable",
    impactStatement: "Two substations offline. Backup generation supports priority facilities.",
    stabilizationOutlook: "Restore power to critical facilities.",
    components: [
      { key: "electricity", label: "Electricity", condition: "unstable" },
      { key: "fuel", label: "Fuel", condition: "stabilizing" },
    ],
    evidence: [{ kind: "reported", description: "Utility outage report", sourceOrganizationId: organizations["cec"], observedAt: iso("09:30") }],
    responsibleOrganizationIds: [organizations["cec"]],
    actions: [
      { key: "generator_request", title: "Generator request", status: "in_progress", responsibleOrganizationId: organizations["cal-oes"] },
      { key: "inspect_substation", title: "Inspect substation", status: "planned", responsibleOrganizationId: organizations["cec"] },
    ],
  });

  // California ESF coordination for utilities and transportation.
  const esf = (who: string, when: string, input: Record<string, unknown>) =>
    later(at(when), () => api(who, at(when), "POST", `/api/v1/incidents/${incidentId}/esf-assessments`, {
      activation: "activated", capacity: "constrained", assessedAt: iso(when), confidence: "confirmed",
      operationalPeriod: "OP 03", supportingOrganizationIds: [], priorities: [], evidence: [], actions: [], ...input,
    }));
  esf("brooks", "09:36", {
    identity: { framework: "california", esf: "ca_esf_12", definitionVersion: 1 },
    situation: "Utility restoration is coordinated with the energy commission and the county.",
    coordinatorOrganizationId: organizations["cec"],
    missions: ["Restore the two offline substations", "Stage generators for shelters", "Fuel priority facilities", "Inspect the Fernbridge gas line"],
    relatedLifelines: ["energy", "water_systems"],
  });
  esf("rkim", "09:19", {
    identity: { framework: "california", esf: "ca_esf_1", definitionVersion: 1 },
    situation: "Route clearance and traffic control continue on US-101 and SR-299.",
    coordinatorOrganizationId: organizations["caltrans-d1"],
    missions: ["Clear US-101 at the Mad River bridge", "Traffic control on SR-299", "Inspect the Fernbridge approach"],
    relatedLifelines: ["transportation"],
  });

  // The morning's coordination traffic, in time order.
  later(at("09:28"), () => update("moreno", at("09:28"), "shelters", shelterIds["Arcata Community Center"]!, { occupancy: 187 }));

  // By 09:40 Jordan Lee has read all but the three newest of their notifications.
  later(at("09:40"), async () => {
    const inbox = await api<{ notifications: { id: string; read_at: string | null; assigned_to_current_actor: boolean }[] }>(
      "lee", at("09:40"), "GET", "/api/v1/notifications?limit=500");
    const unread = inbox.notifications.filter((item) => item.assigned_to_current_actor && !item.read_at);
    for (const item of unread.slice(3)) await api("lee", at("09:40"), "POST", `/api/v1/notifications/${item.id}/read`);
  });

  // Run the morning in scenario time order, so the record of events reads in order.
  plan.sort((left, right) => left.when.getTime() - right.when.getTime());
  for (const step of plan) await step.run();

  const endedAt = new Date();
  return { clock, jurisdictionId, incidentId, organizations, people, windows, startedAt, endedAt };
}

/**
 * Put the server-stamped times of a freshly seeded throwaway database on the
 * scenario clock. Every timestamp written during an API call moves to the
 * scenario time that call stands for, keeping its order within the call;
 * anything else written while seeding moves to just before activation. This
 * runs as the database owner with triggers off, because audit and assessment
 * rows are append-only; it is for scenario databases only.
 */
export async function placeOnScenarioClock(sql: Sql, scenario: NorthCoastScenario): Promise<void> {
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
