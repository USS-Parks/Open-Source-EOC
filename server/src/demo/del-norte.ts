import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { DEL_NORTE_CLOSURES, DEL_NORTE_GEOMETRY } from "./geometry/del-norte.js";
import { NORTH_COAST_PASSWORD } from "./north-coast.js";
import {
  grantDemoDirector, scenarioClock, seedChecklist, startScenario, zoned, type ScenarioPerson, type ScenarioRun,
} from "./scenario-kit.js";

/**
 * The Del Norte Atmospheric Rivers exercise: three atmospheric rivers in
 * eight days over Del Norte County. The third arrives on saturated ground
 * with king tides and high surf. US-101 is closed at Last Chance Grade and
 * US-199 at Patrick Creek, so the county has no road out; the Smith River and
 * the lower Klamath are in flood, Crescent City is under a boil water notice,
 * and the tribal nations run their own shelters beside the Red Cross. Del
 * Norte County OES owns the incident. Every place is real; every event,
 * person and figure is synthetic.
 *
 * The scenario clock is day 7 of the series at 06:40 local, during the third
 * storm. The incident has run thirteen twelve-hour operational periods, so
 * each lifeline's earlier assessments stand as history under the latest.
 */

/** The demo's one password, shared by every exercise's accounts. */
export const DEL_NORTE_PASSWORD = NORTH_COAST_PASSWORD;

const OWNER = { slug: "del-norte-oes", name: "Del Norte County OES" };
const PARTNERS = [
  { slug: "tolowa-deeni", name: "Tolowa Dee-ni' Nation" },
  { slug: "elk-valley-rancheria", name: "Elk Valley Rancheria" },
  { slug: "resighini-rancheria", name: "Resighini Rancheria" },
  { slug: "yurok-oes", name: "Yurok Tribe OES" },
  { slug: "crescent-city", name: "City of Crescent City" },
  { slug: "crescent-city-harbor", name: "Crescent City Harbor District" },
  { slug: "caltrans-d1", name: "Caltrans District 1" },
  { slug: "cal-oes", name: "Cal OES" },
  { slug: "red-cross", name: "American Red Cross" },
  { slug: "cdph", name: "CA Dept. of Public Health" },
  { slug: "swrcb", name: "State Water Resources Control Board" },
  { slug: "sutter-coast", name: "Sutter Coast Hospital" },
  // The county to the south receives Del Norte's air evacuees in Eureka.
  { slug: "humboldt-oes", name: "Humboldt County OES" },
] as const;

export const DEL_NORTE_PEOPLE: readonly ScenarioPerson[] = [
  { key: "rivera", displayName: "Alex Rivera", email: "alex.rivera@delnorte.example", organization: OWNER.slug },
  { key: "holt", displayName: "S. Holt", email: "s.holt@delnorte.example", organization: OWNER.slug },
  { key: "brennan", displayName: "L. Brennan", email: "l.brennan@delnorte.example", organization: OWNER.slug },
  { key: "duarte", displayName: "C. Duarte", email: "c.duarte@delnorte.example", organization: OWNER.slug },
  { key: "whitfield", displayName: "J. Whitfield", email: "j.whitfield@delnorte.example", organization: OWNER.slug },
  { key: "tran", displayName: "M. Tran", email: "m.tran@tolowa.example", organization: "tolowa-deeni", incidentPositionTitle: "Tolowa Dee-ni' Nation liaison" },
  { key: "castillo", displayName: "R. Castillo", email: "r.castillo@elkvalley.example", organization: "elk-valley-rancheria", incidentPositionTitle: "Elk Valley Rancheria liaison" },
  { key: "moss", displayName: "H. Moss", email: "h.moss@resighini.example", organization: "resighini-rancheria", incidentPositionTitle: "Resighini Rancheria liaison" },
  { key: "pierce", displayName: "G. Pierce", email: "g.pierce@yurok.example", organization: "yurok-oes", incidentPositionTitle: "Yurok Tribe liaison" },
  { key: "lindqvist", displayName: "E. Lindqvist", email: "e.lindqvist@crescentcity.example", organization: "crescent-city", incidentPositionTitle: "City liaison" },
  { key: "banks", displayName: "O. Banks", email: "o.banks@harbor.example", organization: "crescent-city-harbor", incidentPositionTitle: "Harbor liaison" },
  { key: "novak", displayName: "V. Novak", email: "v.novak@caltrans.example", organization: "caltrans-d1", incidentPositionTitle: "Caltrans liaison" },
  { key: "farouk", displayName: "A. Farouk", email: "a.farouk@caloes.example", organization: "cal-oes", incidentPositionTitle: "Cal OES Coastal Region liaison" },
  { key: "webb", displayName: "T. Webb", email: "t.webb@redcross.example", organization: "red-cross", incidentPositionTitle: "Shelter liaison" },
  { key: "serrano", displayName: "I. Serrano", email: "i.serrano@cdph.example", organization: "cdph", incidentPositionTitle: "Medical and health liaison" },
  { key: "hughes", displayName: "W. Hughes", email: "w.hughes@swrcb.example", organization: "swrcb", incidentPositionTitle: "Water systems liaison" },
  { key: "ahn", displayName: "D. Ahn", email: "d.ahn@suttercoast.example", organization: "sutter-coast", incidentPositionTitle: "Hospital liaison" },
  { key: "lund", displayName: "B. Lund", email: "b.lund@humboldt.example", organization: "humboldt-oes", incidentPositionTitle: "Humboldt County OES liaison" },
];

/** The incident area: all of Del Norte County, from the county outline the map ships. */
export const DEL_NORTE_AREA = {
  type: "Polygon" as const,
  coordinates: [[
    [-124.213, 41.998], [-123.822, 41.996], [-123.657, 41.995], [-123.517, 42.001], [-123.564, 41.905],
    [-123.603, 41.883], [-123.642, 41.888], [-123.65, 41.861], [-123.704, 41.825], [-123.675, 41.797],
    [-123.678, 41.746], [-123.66, 41.726], [-123.686, 41.645], [-123.718, 41.595], [-123.682, 41.592],
    [-123.693, 41.558], [-123.653, 41.539], [-123.614, 41.446], [-123.66, 41.382], [-123.772, 41.381],
    [-123.772, 41.464], [-124.066, 41.465], [-124.08, 41.547], [-124.134, 41.657], [-124.163, 41.74],
    [-124.195, 41.736], [-124.256, 41.783], [-124.22, 41.846], [-124.202, 41.941], [-124.213, 41.998],
  ]],
};

/** The scenario clock: the most recent 06:40 in the scenario time zone. */
export function delNorteClock(now = new Date()): Date {
  return scenarioClock("06:40", now);
}

export async function seedDelNorte(app: FastifyInstance, sql: Sql, clock = delNorteClock()): Promise<ScenarioRun> {
  const { at, iso, api, later, runInOrder, finish, jurisdictionId, organizations, people } = await startScenario(app, sql, clock, {
    owner: OWNER, partners: PARTNERS, people: DEL_NORTE_PEOPLE, admins: ["rivera"], password: DEL_NORTE_PASSWORD,
  });

  // The county activates as the first storm makes landfall, six days before the clock.
  const activation = await api<{ incidentId: string }>("rivera", at("04:50", -6), "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "flood", name: "Del Norte Atmospheric Rivers", kind: "exercise" });
  const incidentId = activation.incidentId;

  // Thirteen twelve-hour operational periods, 06:00 and 18:00, each set half an hour ahead.
  let revision = 0;
  for (let index = 0; index < 13; index += 1) {
    const day = -6 + Math.floor(index / 2);
    const morning = index % 2 === 0;
    const label = `OP ${String(index + 1).padStart(2, "0")}`;
    const result = await api<{ revision: number }>("rivera", at(morning ? "05:30" : "17:30", day), "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: revision,
      geometry: DEL_NORTE_AREA,
      operationalPeriod: {
        label,
        startsAt: iso(morning ? "06:00" : "18:00", day),
        endsAt: iso(morning ? "18:00" : "06:00", morning ? day : day + 1),
      },
      reason: `${label} planning cycle for the Del Norte Atmospheric Rivers exercise`,
    });
    revision = result.revision;
  }

  const positions = await api<{ positions: { id: string; key: string }[] }>("rivera", at("05:00", -6), "GET",
    `/api/v1/jurisdictions/${jurisdictionId}/positions`);
  const position = (key: string) => {
    const found = positions.positions.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`the flood activation has no ${key} position`);
    return found.id;
  };
  const planning = position("planning_section_chief");
  const operations = position("operations_section_chief");
  const logistics = position("logistics_section_chief");
  const information = position("public_information_officer");
  await api("rivera", at("05:01", -6), "POST", `/api/v1/positions/${planning}/assignments`, { personId: people["rivera"]!.id });
  await api("rivera", at("05:02", -6), "POST", `/api/v1/positions/${operations}/assignments`, { personId: people["holt"]!.id });
  await api("rivera", at("05:03", -6), "POST", `/api/v1/positions/${logistics}/assignments`, { personId: people["brennan"]!.id });
  await api("rivera", at("05:04", -6), "POST", `/api/v1/positions/${information}/assignments`, { personId: people["whitfield"]!.id });
  await api("rivera", at("05:35"), "POST", `/api/v1/positions/${planning}/sign-in`);

  const participants: Record<string, string> = {};
  const grantExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const person of DEL_NORTE_PEOPLE.filter((candidate) => candidate.incidentPositionTitle)) {
    const grant = await api<{ participant: { id: string } }>("rivera", at("06:30", -6), "POST",
      `/api/v1/incidents/${incidentId}/participants`, {
        organizationSlug: person.organization,
        personEmail: person.email,
        incidentPositionTitle: person.incidentPositionTitle,
        role: "contributor",
        expiresAt: grantExpiry,
        reason: "Del Norte Atmospheric Rivers exercise participation",
      });
    participants[person.key] = grant.participant.id;
  }
  await grantDemoDirector(sql, api, "rivera", at("06:35", -6), incidentId);

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

  // Significant events across the series.
  const events: ReadonlyArray<readonly [string, string, number, string, string]> = [
    ["rivera", "03:10", -6, "First atmospheric river makes landfall; five inches of rain forecast in 36 hours", "warning"],
    ["holt", "04:40", -6, "Smith River above flood stage at the Dr. Fine Bridge", "critical"],
    ["novak", "09:30", -6, "US-199 closed by a slide between Hiouchi and Gasquet", "critical"],
    ["novak", "14:00", -5, "US-199 reopens one lane with a pilot car", "normal"],
    ["rivera", "05:15", -3, "Second atmospheric river arrives on saturated ground", "warning"],
    ["novak", "16:40", -3, "US-101 closed at Last Chance Grade: the roadway dropped", "critical"],
    ["moss", "10:00", -2, "Klamath Glen and Resighini lands flooded by the Klamath River", "critical"],
    ["rivera", "18:00", -1, "Flood watch: third atmospheric river arrives overnight with king tides", "warning"],
    ["novak", "22:50", -1, "US-199 closed again at Patrick Creek; the county has no road out", "critical"],
    ["holt", "02:10", 0, "County fiber route cut near the Smith River; cellular service degraded", "critical"],
    ["hughes", "04:30", 0, "Boil water notice for Crescent City after flood turbidity", "critical"],
    ["banks", "05:45", 0, "Surge damage to the Crescent City Harbor docks", "warning"],
    ["serrano", "06:20", 0, "Pelican Bay State Prison and Sutter Coast Hospital on generator power", "warning"],
  ];
  for (const [who, hhmm, days, summary, severity] of events) {
    const when = at(hhmm, days);
    later(when, () => record(who, when, "significant_events", { summary, occurred_at: when.toISOString(), severity }));
  }

  // Shelters: five open with 331 people, run by the Red Cross and by the tribes; two planned.
  // Each opens with `occupancy` and changes as the storms come and go (`changes`), the last change standing at the clock.
  const shelterIds: Record<string, string> = {};
  const shelters: ReadonlyArray<{
    name: string; capacity: number; occupancy: number; pets: boolean; at: [number, number]; who: string; when: Date; planned?: boolean;
    changes?: ReadonlyArray<readonly [Date, Record<string, unknown>]>;
  }> = [
    { name: "Del Norte County Fairgrounds", capacity: 300, occupancy: 40, pets: true, at: [-124.19505, 41.76022], who: "webb", when: at("08:10", -6),
      changes: [[at("18:30", -6), { occupancy: 85 }], [at("10:00", -5), { occupancy: 52 }], [at("12:00", -4), { occupancy: 30 }],
        [at("20:00", -3), { occupancy: 70 }], [at("11:30", -2), { occupancy: 118 }], [at("09:00", -1), { occupancy: 104 }], [at("05:00"), { occupancy: 146 }]] },
    { name: "Smith River Community Center", capacity: 90, occupancy: 20, pets: true, at: [-124.14771, 41.92635], who: "tran", when: at("09:20", -6),
      changes: [[at("18:40", -6), { occupancy: 34 }], [at("10:10", -5), { occupancy: 15 }], [at("12:10", -4), { occupancy: 0, status: "closed" }],
        [at("18:00", -3), { occupancy: 22, status: "normal" }], [at("11:30", -2), { occupancy: 30 }], [at("04:00"), { occupancy: 38 }]] },
    { name: "Yurok Tribe Community Center, Klamath", capacity: 120, occupancy: 52, pets: true, at: [-124.03745, 41.52936], who: "pierce", when: at("11:05", -2),
      changes: [[at("20:00", -2), { occupancy: 80 }], [at("12:00", -1), { occupancy: 63 }], [at("05:30"), { occupancy: 71 }]] },
    { name: "Elk Valley Rancheria community hall", capacity: 60, occupancy: 12, pets: false, at: [-124.15867, 41.7584], who: "castillo", when: at("16:00", -3),
      changes: [[at("11:30", -2), { occupancy: 20 }], [at("05:20"), { occupancy: 24 }]] },
    { name: "Pine Grove Elementary School", capacity: 120, occupancy: 40, pets: false, at: [-124.19425, 41.78511], who: "webb", when: at("21:30", -1),
      changes: [[at("06:15"), { occupancy: 52 }]] },
    { name: "Mary Peacock School", capacity: 100, occupancy: 0, pets: false, at: [-124.21183, 41.77737], who: "webb", when: at("05:50"), planned: true },
    { name: "Redwood Elementary School, Fort Dick", capacity: 80, occupancy: 0, pets: true, at: [-124.15045, 41.86979], who: "webb", when: at("06:05"), planned: true },
  ];
  for (const shelter of shelters) {
    later(shelter.when, async () => {
      const created = await record(shelter.who, shelter.when, "shelters", {
        name: shelter.name, status: "normal", capacity: shelter.capacity, occupancy: shelter.occupancy,
        pets_accepted: shelter.pets, planned: shelter.planned ?? false,
        location: { type: "Point", coordinates: shelter.at },
      });
      shelterIds[shelter.name] = created.id;
    });
    for (const [when, data] of shelter.changes ?? []) later(when, () => update(shelter.who, when, "shelters", shelterIds[shelter.name]!, data));
  }

  // Facilities: the EOC, the hospital and the prison, the air and sea resupply points, gauges, cameras and weather.
  const facilities: ReadonlyArray<{ name: string; kind: string; at: [number, number]; status?: string; stream?: string; notes?: string }> = [
    { name: "Incident Command Post, Del Norte County EOC", kind: "incident_command_post", at: [-124.2005, 41.7535] },
    { name: "Sutter Coast Hospital", kind: "hospital", at: [-124.19417, 41.77434], status: "compromised", notes: "On generator power since 06:00" },
    { name: "Pelican Bay State Prison", kind: "key_facility", at: [-124.15527, 41.85551], status: "compromised", notes: "On generator power; water trucked from Crescent City" },
    { name: "Air resupply staging, Del Norte County Regional Airport", kind: "staging_area", at: [-124.23806, 41.78192] },
    { name: "Airport helibase", kind: "helibase", at: [-124.2372, 41.7835] },
    { name: "Crescent City Harbor", kind: "key_facility", at: [-124.1865, 41.7455], status: "compromised", notes: "Two docks damaged; fuel pier open" },
    { name: "Klamath staging area", kind: "staging_area", at: [-124.036, 41.53] },
    { name: "Crescent City water system intake, Smith River", kind: "key_facility", at: [-124.098, 41.803], status: "compromised", notes: "Turbidity above treatment limits" },
    { name: "Smith River gauge at the Dr. Fine Bridge", kind: "key_facility", at: [-124.145, 41.895] },
    { name: "Klamath River gauge at Klamath", kind: "key_facility", at: [-124.04, 41.52] },
    { name: "US-101 at Last Chance Grade camera", kind: "camera", at: [-124.098, 41.677], status: "compromised", stream: "rtsp://cameras.exercise.invalid/us101-last-chance-grade", notes: "No feed since the fiber cut" },
    { name: "US-199 at Hiouchi camera", kind: "camera", at: [-124.072, 41.793], stream: "rtsp://cameras.exercise.invalid/us199-hiouchi" },
    { name: "Crescent City airport weather station", kind: "weather_station", at: [-124.2362, 41.7802] },
    { name: "Klamath weather station", kind: "weather_station", at: [-124.04, 41.527] },
  ];
  for (const [index, facility] of facilities.entries()) {
    const when = at(`05:${String(10 + index * 2).padStart(2, "0")}`, -6);
    later(when, () => record("holt", when, "incident_facilities", {
      name: facility.name, kind: facility.kind, status: facility.status ?? "normal",
      location: { type: "Point", coordinates: facility.at },
      ...(facility.stream ? { stream_url: facility.stream } : {}),
      ...(facility.notes ? { notes: facility.notes } : {}),
    }));
  }

  // Road closures as they stand at the clock.
  // Each closure is drawn along its road (tools/demo-geometry).
  const closures: ReadonlyArray<{ road: keyof typeof DEL_NORTE_CLOSURES; reason: string; status: string; when: Date }> = [
    { road: "US-101 at Last Chance Grade", reason: "The roadway dropped; no reopening estimate", status: "closed", when: at("16:40", -3) },
    { road: "US-199 at Patrick Creek", reason: "Slide across both lanes", status: "closed", when: at("22:50", -1) },
    { road: "US-199 between Hiouchi and Gasquet", reason: "Slide debris; one lane with a pilot car", status: "one_lane", when: at("14:00", -5) },
    { road: "Klamath Beach Road", reason: "Flooded by the Klamath River", status: "closed", when: at("09:40", -2) },
    { road: "Terwer Valley Road at Klamath Glen", reason: "Flooded; water over the road", status: "closed", when: at("09:50", -2) },
    { road: "Lake Earl Drive", reason: "Standing water across the northbound lane", status: "one_lane", when: at("03:20") },
    { road: "US-101 at the Dr. Fine Bridge", reason: "Bridge inspection after high water", status: "one_lane", when: at("04:55") },
  ];
  for (const closure of closures) {
    later(closure.when, () => record("novak", closure.when, "road_closures", {
      road: closure.road, reason: closure.reason, status: closure.status,
      location: DEL_NORTE_CLOSURES[closure.road],
    }));
  }

  // Field reports across the series: 40 in all.
  const fieldReports: ReadonlyArray<readonly [string, string, number, number, string, string, number?]> = [
    ["Smith River over its banks at Fort Dick", "hazard", -124.149, 41.868, "duarte", "04:20", -6],
    ["Water over Lake Earl Drive", "hazard", -124.182, 41.797, "duarte", "05:10", -6],
    ["Slide onto US-199 east of Hiouchi", "hazard", -124.02, 41.815, "novak", "09:15", -6],
    ["Garage flooded on Fred D. Haight Drive", "damage", -124.16, 41.915, "tran", "11:40", -6],
    ["Tree through a roof in Crescent City", "damage", -124.2, 41.76, "lindqvist", "13:05", -6],
    ["Sandbags needed at Smith River homes", "resource", -124.147, 41.927, "tran", "14:30", -6],
    ["Culvert washed out on Kings Valley Road", "damage", -124.13, 41.82, "duarte", "08:20", -5],
    ["Power out across Gasquet", "other", -123.977, 41.846, "duarte", "10:30", -5],
    ["Mudslide across Howland Hill Road", "hazard", -124.139, 41.762, "duarte", "15:10", -5],
    ["Road shoulder gone on South Fork Road", "damage", -124.0, 41.8, "duarte", "09:00", -4],
    ["Second storm: water rising at Klamath Glen", "hazard", -123.994, 41.513, "moss", "07:30", -3],
    ["Cracking across US-101 at Last Chance Grade", "hazard", -124.098, 41.676, "novak", "14:50", -3],
    ["Mobile home flooded at Klamath Glen", "damage", -123.99, 41.515, "moss", "20:10", -3],
    ["Residents stranded at Klamath Glen", "other", -123.992, 41.512, "pierce", "06:40", -2],
    ["Boat needed for Resighini welfare checks", "resource", -124.02, 41.52, "moss", "07:15", -2],
    ["Klamath Beach Road under water", "hazard", -124.065, 41.532, "pierce", "09:35", -2],
    ["Septic systems flooded at Klamath Glen", "hazard", -123.993, 41.514, "pierce", "12:00", -2],
    ["Elk Valley homes need pumping", "resource", -124.155, 41.757, "castillo", "15:40", -2],
    ["Dialysis patients cannot reach Eureka", "resource", -124.194, 41.774, "ahn", "10:10", -1],
    ["Pharmacy resupply needed in Crescent City", "resource", -124.2, 41.756, "serrano", "13:30", -1],
    ["Surf over the harbor breakwater", "hazard", -124.19, 41.742, "banks", "20:45", -1],
    ["Slide across US-199 at Patrick Creek", "hazard", -123.846, 41.872, "novak", "22:40", -1],
    ["Water rising again at Fort Dick", "hazard", -124.15, 41.87, "duarte", "23:30", -1],
    ["Fiber cable down near the Smith River", "damage", -124.12, 41.84, "holt", "02:05"],
    ["Cell site on battery at Smith River", "other", -124.148, 41.93, "tran", "02:40"],
    ["Turbidity spike at the water intake", "hazard", -124.098, 41.803, "hughes", "03:50"],
    ["Standing water on Lake Earl Drive again", "hazard", -124.18, 41.8, "duarte", "03:15"],
    ["Bridge approach scour at the Dr. Fine Bridge", "damage", -124.145, 41.895, "novak", "04:45"],
    ["Bottled water needed at the fairgrounds", "resource", -124.195, 41.76, "webb", "04:55"],
    ["Dock pilings broken in the inner harbor", "damage", -124.186, 41.746, "banks", "05:30"],
    ["Fuel dock asking for a delivery date", "resource", -124.187, 41.745, "banks", "05:40"],
    ["Klamath shelter needs cots", "resource", -124.037, 41.529, "pierce", "05:50"],
    ["Flooded road cuts off Resighini homes", "hazard", -124.02, 41.522, "moss", "06:00"],
    ["Hospital generator fuel for two days", "resource", -124.194, 41.774, "ahn", "06:05"],
    ["Prison asking about trucked water", "resource", -124.155, 41.855, "serrano", "06:10"],
    ["Power line down on Northcrest Drive", "hazard", -124.2, 41.77, "lindqvist", "06:15"],
    ["Minor slide on Elk Valley Road", "hazard", -124.17, 41.775, "castillo", "06:20"],
    ["Beach access flooded at Pebble Beach Drive", "hazard", -124.22, 41.76, "lindqvist", "06:25"],
    ["Smith River shelter asking for a nurse", "resource", -124.1477, 41.9263, "tran", "06:30"],
    ["River still rising at the Klamath gauge", "hazard", -124.04, 41.52, "pierce", "06:35"],
  ];
  const verifiedReports = fieldReports.length - 8;
  for (const [index, [summary, category, lon, lat, who, hhmm, days = 0]] of fieldReports.entries()) {
    const when = at(hhmm, days);
    let reportId = "";
    later(when, async () => {
      reportId = (await record(who, when, "field_reports", { summary, category, location: { type: "Point", coordinates: [lon, lat] } })).id;
    });
    if (index < verifiedReports) {
      const verifiedAt = new Date(when.getTime() + 20 * 60 * 1000);
      later(verifiedAt, () => update("rivera", verifiedAt, "field_reports", reportId, { verified: true }));
    }
  }

  // Damage assessments from the first two storms and the start of the third.
  const damage: ReadonlyArray<readonly [string, string, string, number, number, string, number?]> = [
    ["single_family", "minor", "Water in the garage and crawlspace", -124.16, 41.915, "11:50", -6],
    ["single_family", "major", "Tree through the roof", -124.2, 41.76, "13:30", -6],
    ["mobile_home", "major", "Floor soaked through; skirting gone", -124.149, 41.868, "15:00", -6],
    ["business", "minor", "Water in the store at Smith River", -124.147, 41.929, "16:10", -6],
    ["single_family", "affected", "Yard and driveway flooded", -124.18, 41.797, "10:00", -5],
    ["single_family", "minor", "Mud against the foundation", -124.139, 41.762, "16:00", -5],
    ["mobile_home", "destroyed", "Moved off its piers by the Klamath", -123.99, 41.515, "09:30", -2],
    ["mobile_home", "major", "Water to the windows at Klamath Glen", -123.992, 41.513, "09:45", -2],
    ["single_family", "major", "Water to the counters at Klamath Glen", -123.994, 41.512, "10:05", -2],
    ["single_family", "inaccessible", "Cut off by Terwer Valley Road flooding", -123.985, 41.522, "10:20", -2],
    ["multi_family", "minor", "Flooded ground-floor units in Elk Valley", -124.155, 41.757, "16:30", -2],
    ["business", "major", "Harbor seafood building flooded", -124.188, 41.744, "06:00", -1],
    ["single_family", "minor", "Roof and siding damage from wind", -124.2, 41.77, "11:00", -1],
    ["business", "major", "Dock office undermined by surf", -124.186, 41.746, "05:35"],
    ["single_family", "inaccessible", "Resighini homes cut off by water", -124.02, 41.522, "06:02"],
    ["mobile_home", "affected", "Water under the unit at Fort Dick", -124.15, 41.87, "06:12"],
  ];
  for (const [structure, degree, notes, lon, lat, hhmm, days = 0] of damage) {
    const when = at(hhmm, days);
    later(when, () => record("duarte", when, "damage_assessment", {
      structure_type: structure, degree, ownership: "unknown", notes,
      location: { type: "Point", coordinates: [lon, lat] },
    }));
  }

  // Resource requests: 24. With no road out, much of what the county needs comes by air or sea.
  type RequestState = "submitted" | "accepted" | "sourcing" | "assigned" | "deployed";
  const requests: ReadonlyArray<{ item: string; notes: string; priority: string; state: RequestState; neededBy: string; days?: number; quantity?: number; owner?: string; who: string; at: [string, number?] }> = [
    { item: "Sandbags for Smith River homes", notes: "5,000 filled bags", priority: "priority", state: "deployed", neededBy: "18:00", quantity: 5000, owner: "operations", who: "holt", at: ["14:40", -6] },
    { item: "Pumps for Elk Valley homes", notes: "Four trash pumps with hose", priority: "priority", state: "deployed", neededBy: "18:00", quantity: 4, owner: "castillo", who: "castillo", at: ["15:50", -2] },
    { item: "Swift water rescue team for Klamath Glen", notes: "Team with two boats", priority: "immediate", state: "deployed", neededBy: "12:00", owner: "farouk", who: "holt", at: ["06:50", -2] },
    { item: "Boat for Resighini welfare checks", notes: "Flat-bottom boat with operator", priority: "priority", state: "deployed", neededBy: "18:00", owner: "pierce", who: "moss", at: ["07:20", -2] },
    { item: "Slide removal equipment for Last Chance Grade", notes: "Excavators and haul trucks; geotechnical review first", priority: "immediate", state: "assigned", neededBy: "18:00", owner: "novak", who: "holt", at: ["17:10", -3] },
    { item: "Slide removal at Patrick Creek", notes: "Crew on the Oregon side cannot reach it until the slide stops moving", priority: "immediate", state: "assigned", neededBy: "18:00", owner: "novak", who: "holt", at: ["23:00", -1] },
    { item: "Air transport for dialysis patients", notes: "Six patients to Eureka by helicopter or fixed wing", priority: "immediate", state: "sourcing", neededBy: "12:00", quantity: 6, who: "ahn", at: ["10:20", -1] },
    { item: "Pharmacy resupply by air", notes: "Insulin, inhalers and dialysis supplies", priority: "immediate", state: "sourcing", neededBy: "14:00", who: "serrano", at: ["13:40", -1] },
    { item: "Bottled water for the boil water notice", notes: "Two truckloads staged at the airport", priority: "immediate", state: "accepted", neededBy: "12:00", who: "brennan", at: ["04:50"] },
    { item: "Portable water treatment unit", notes: "Trailer unit for the fairgrounds shelter", priority: "priority", state: "sourcing", neededBy: "18:00", who: "hughes", at: ["05:00"] },
    { item: "Drinking water sampling kits and courier", notes: "Samples must fly out for testing", priority: "priority", state: "assigned", neededBy: "10:00", owner: "hughes", who: "brennan", at: ["04:40"] },
    { item: "Diesel for the hospital generator", notes: "Three days of fuel", priority: "immediate", state: "assigned", neededBy: "12:00", owner: "operations", who: "ahn", at: ["06:08"] },
    { item: "Fuel delivery by sea to the harbor", notes: "Barge from Coos Bay once the bar is safe", priority: "priority", state: "sourcing", neededBy: "18:00", days: 1, who: "banks", at: ["05:45"] },
    { item: "Satellite links for the EOC and shelters", notes: "Four terminals while the fiber is cut", priority: "immediate", state: "accepted", neededBy: "12:00", quantity: 4, who: "holt", at: ["02:30"] },
    { item: "Generators for tribal shelters", notes: "Klamath and Smith River community centers", priority: "priority", state: "assigned", neededBy: "12:00", quantity: 2, owner: "farouk", who: "tran", at: ["02:50"] },
    { item: "Cots for the Klamath shelter", notes: "40 cots and blankets", priority: "priority", state: "assigned", neededBy: "12:00", quantity: 40, owner: "webb", who: "pierce", at: ["05:55"] },
    { item: "Meals for shelter residents", notes: "Three meals a day for 340 people", priority: "priority", state: "deployed", neededBy: "12:00", owner: "webb", who: "brennan", at: ["19:00", -2] },
    { item: "Nurse for the Smith River shelter", notes: "One nurse per shift", priority: "priority", state: "submitted", neededBy: "14:00", who: "tran", at: ["06:32"] },
    { item: "Damage assessment teams", notes: "Two teams for Klamath Glen and Fort Dick", priority: "routine", state: "accepted", neededBy: "09:00", days: 1, quantity: 2, who: "duarte", at: ["06:18"] },
    { item: "Trucked water for Pelican Bay State Prison", notes: "Potable water while the city system is under a notice", priority: "priority", state: "submitted", neededBy: "12:00", who: "serrano", at: ["06:12"] },
    { item: "Harbor debris removal", notes: "Crane barge for broken pilings", priority: "routine", state: "submitted", neededBy: "12:00", days: 2, who: "banks", at: ["05:38"] },
    { item: "Line crews for Crescent City outages", notes: "Two crews; the utility's own crews are cut off south of the grade", priority: "priority", state: "sourcing", neededBy: "18:00", quantity: 2, who: "lindqvist", at: ["06:20"] },
    { item: "Septic pumping at Klamath Glen", notes: "Vacuum trucks once the water drops", priority: "routine", state: "submitted", neededBy: "12:00", days: 2, who: "pierce", at: ["12:10", -2] },
    { item: "Traffic control on US-101 at the Dr. Fine Bridge", notes: "Flaggers for one-lane traffic", priority: "priority", state: "deployed", neededBy: "18:00", owner: "novak", who: "holt", at: ["05:00"] },
  ];
  const order: readonly RequestState[] = ["submitted", "accepted", "sourcing", "assigned", "deployed"];
  for (const request of requests) {
    const when = at(request.at[0], request.at[1]);
    const reach = order.indexOf(request.state);
    later(when, async () => {
      const created = await api<{ id: string }>(request.who, when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
        origin: participants[request.who] ? "field" : "eoc", item: request.item, quantity: request.quantity ?? 1,
        priority: request.priority, neededBy: iso(request.neededBy, request.days ?? 0), notes: request.notes, incidentId,
      });
      const move = (toState: string) => api("brennan", when, "POST", `/api/v1/resource-requests/${created.id}/transition`, { toState });
      for (const state of order.slice(1, Math.min(reach, 2) + 1)) await move(state);
      if (reach >= 3) {
        // Assigning across organizations takes the owner's incident authority.
        if (request.owner === "operations") {
          await api("rivera", when, "POST", `/api/v1/resource-requests/${created.id}/assign`, { kind: "position", positionId: operations });
        } else if (request.owner) {
          await api("rivera", when, "POST", `/api/v1/resource-requests/${created.id}/assign`,
            { kind: "incident_participant", incidentId, participantId: participants[request.owner] });
        } else {
          await move("assigned");
        }
      }
      if (reach >= 4) await move("deployed");
    });
  }

  // The checklist over the series: the activation's tasks, done in the first hours, and the ones added since.
  // No incident commander is seated, so the lead running planning takes the command checklist.
  const toParticipant = (key: string) => ({ kind: "incident_participant" as const, incidentId, participantId: participants[key]! });
  const toPosition = (positionId: string) => ({ kind: "position" as const, positionId });
  seedChecklist({ api, later }, "rivera", incidentId, at("05:10", -6), [
    { item: "Assume command and announce on the significant events board", category: "command", due: at("05:30", -6), holder: toPosition(planning) },
    { item: "Set initial incident objectives", category: "command", due: at("06:00", -6), holder: toPosition(planning) },
    { item: "Establish the operational period", category: "command", due: at("06:00", -6), holder: toPosition(planning) },
    { item: "Confirm road, river and utility status with field crews", category: "operations", due: at("08:00", -6) },
    { item: "Open the resource request board", category: "operations", due: at("06:00", -6) },
    { item: "Track river forecasts and the next storm's arrival", category: "planning", due: at("18:00"), inProgress: true },
    { item: "Collect lifeline assessments for the situation report", category: "planning", due: at("06:00"), inProgress: true },
    { item: "Start initial damage assessment", category: "planning", due: at("12:00", -6) },
    { item: "Draft the initial public statement", category: "public_information", due: at("06:00", -6) },
    { item: "Confirm media contact roster", category: "public_information", due: at("12:00", -6) },
    { item: "Deliver sandbags to Smith River homes", category: "operations", due: at("18:00", -6), added: at("14:35", -6), holder: toParticipant("tran") },
    { item: "Check on Klamath Glen residents by boat", category: "operations", due: at("18:00", -2), added: at("07:25", -2), holder: toParticipant("moss") },
    { item: "Count evacuees at every shelter each morning", category: "mass_care", due: at("06:00"), added: at("19:05", -2), holder: toParticipant("webb"), inProgress: true },
    { item: "Arrange dialysis flights to Eureka", category: "logistics", due: at("12:00", -1), added: at("10:25", -1), holder: toParticipant("ahn"), inProgress: true },
    { item: "Receive Del Norte dialysis patients at Eureka hospitals", category: "operations", due: at("12:00"), added: at("10:30", -1), holder: toParticipant("lund") },
    { item: "Publish the boil water notice in English and Spanish", category: "public_information", due: at("05:30"), added: at("04:35"), holder: toPosition(information) },
    { item: "Stage bottled water at the airport for the boil water notice", category: "logistics", due: at("09:00"), added: at("04:52"), holder: toPosition(logistics), inProgress: true },
    { item: "Inspect the Dr. Fine Bridge after the high water", category: "operations", due: at("08:00"), added: at("04:58"), holder: toParticipant("novak") },
    { item: "Open Mary Peacock School if the fairgrounds fills", category: "mass_care", due: at("12:00"), added: at("05:52"), holder: toParticipant("webb") },
    { item: "Confirm the air resupply schedule with Cal OES", category: "logistics", due: at("09:00"), added: at("06:22"), holder: toParticipant("farouk") },
    { item: "Brief the board of supervisors on the county being cut off", category: "command", due: at("10:00"), added: at("06:23"), holder: toPosition(planning) },
    { item: "Confirm Klamath Glen households are accounted for", category: "operations", due: at("11:00"), added: at("06:24"), holder: toParticipant("pierce") },
    { item: "Plan the boil water notice lifting criteria", category: "operations", due: at("16:00"), added: at("06:25"), holder: toParticipant("hughes") },
  ], [
    { who: "rivera", at: at("05:40", -6),
      items: ["Assume command and announce on the significant events board", "Set initial incident objectives", "Establish the operational period"] },
    { who: "whitfield", at: at("05:45", -6), position: information, items: ["Draft the initial public statement", "Confirm media contact roster"] },
    { who: "holt", at: at("07:50", -6), position: operations, items: ["Confirm road, river and utility status with field crews", "Open the resource request board"] },
    { who: "rivera", at: at("11:45", -6), items: ["Start initial damage assessment"] },
    { who: "tran", at: at("17:30", -6), items: ["Deliver sandbags to Smith River homes"] },
    { who: "moss", at: at("16:40", -2), items: ["Check on Klamath Glen residents by boat"] },
    { who: "whitfield", at: at("05:10"), position: information, items: ["Publish the boil water notice in English and Spanish"] },
  ]);

  // Humboldt County's liaison notes what the region should fix, on Humboldt's own improvement plan.
  const day = (days: number) => zoned(at("12:00", days)).date;
  const humboldt: ReadonlyArray<readonly [string, string, string, string, string, Date, ("in_progress" | "complete")?]> = [
    ["critical_transportation", "planning", "Plan patient air transfers from Del Norte to Eureka hospitals before US-101 and US-199 close", "high", day(30), at("11:00", -1)],
    ["operational_communications", "equipment", "Add a satellite link between the Del Norte and Humboldt EOCs", "medium", day(-1), at("02:40"), "in_progress"],
    ["public_health_healthcare_and_emergency_medical_services", "planning", "Share a regional list of dialysis patients between the two counties", "medium", day(14), at("05:15"), "complete"],
  ];
  for (const [capability, capabilityElement, recommendation, priority, dueDate, when, status] of humboldt) {
    later(when, async () => {
      const action = await api<{ id: string }>("lund", when, "POST", `/api/v1/jurisdictions/${organizations["humboldt-oes"]!}/corrective-actions`, {
        incidentId, capability, capabilityElement, recommendation, priority, dueDate, ownerPerson: people["lund"]!.id,
      });
      if (status) await api("lund", when, "POST", `/api/v1/corrective-actions/${action.id}/status`, { status });
    });
  }

  // Lifeline assessments through the series: each storm's supersede the last.
  const assessments: Record<string, string> = {};
  const lifeline = (who: string, hhmm: string, days: number, period: string, input: Record<string, unknown>) =>
    later(at(hhmm, days), async () => {
      const key = input.lifeline as string;
      const prior = assessments[key];
      const created = await api<{ id: string }>(who, at(hhmm, days), "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
        definitionVersion: 1, assessedAt: iso(hhmm, days), operationalPeriod: period, confidence: "confirmed",
        components: [], evidence: [], responsibleOrganizationIds: [], actions: [],
        ...(prior ? { supersedesAssessmentId: prior } : {}), ...input,
      });
      assessments[key] = created.id;
    });
  // The first storm.
  lifeline("novak", "10:00", -6, "OP 01", { lifeline: "transportation", condition: "unstable", impactStatement: "US-199 closed by a slide east of Hiouchi. US-101 open.", nextUpdateAt: iso("18:00", -6) });
  lifeline("webb", "12:00", -6, "OP 01", { lifeline: "food_hydration_shelter", condition: "stabilizing", impactStatement: "Two shelters open with 60 people from Smith River and Fort Dick.", nextUpdateAt: iso("18:00", -6) });
  lifeline("hughes", "12:30", -6, "OP 01", { lifeline: "water_systems", condition: "stable", impactStatement: "Crescent City treatment normal; turbidity rising but within limits.", nextUpdateAt: iso("06:00", -5) });
  lifeline("holt", "13:00", -6, "OP 01", { lifeline: "energy", condition: "stabilizing", impactStatement: "Scattered outages in Gasquet and Smith River.", nextUpdateAt: iso("06:00", -5) });
  // The second storm.
  lifeline("novak", "17:00", -3, "OP 08", { lifeline: "transportation", condition: "unstable", impactStatement: "US-101 closed at Last Chance Grade. US-199 open one lane: the only road out.", nextUpdateAt: iso("06:00", -2) });
  lifeline("webb", "12:00", -2, "OP 09", { lifeline: "food_hydration_shelter", condition: "stabilizing", impactStatement: "Four shelters with 220 people after Klamath Glen flooded.", nextUpdateAt: iso("06:00", -1) });
  lifeline("holt", "14:00", -2, "OP 09", { lifeline: "communications", condition: "stable", impactStatement: "Fiber and cellular normal.", nextUpdateAt: iso("06:00", -1) });
  // The third storm, this morning.
  lifeline("novak", "05:00", 0, "OP 13", {
    lifeline: "transportation", condition: "unstable",
    impactStatement: "US-101 closed at Last Chance Grade and US-199 at Patrick Creek. The county has no road out; resupply is by air or sea.",
    stabilizationObjective: "Open one road out of the county.",
    nextUpdateAt: iso("09:00"),
    components: [
      { key: "highways", label: "Highways", condition: "unstable", affectedGeography: "US-101 and US-199", causes: ["Slides"] },
      { key: "airport", label: "Airport", condition: "stable", affectedGeography: "Crescent City" },
      { key: "harbor", label: "Harbor", condition: "stabilizing", affectedGeography: "Crescent City", causes: ["Surge damage"] },
    ],
  });
  lifeline("hughes", "05:05", 0, "OP 13", {
    lifeline: "water_systems", condition: "unstable",
    impactStatement: "Boil water notice for Crescent City after flood turbidity. Klamath Glen septic systems flooded.",
    stabilizationObjective: "Lift the boil water notice on two clean samples.",
    nextUpdateAt: iso("12:00"),
    components: [{ key: "treatment", label: "Drinking water treatment", condition: "unstable", affectedGeography: "Crescent City", causes: ["Turbidity"], dependencies: ["Sampling kits flown out for testing"] }],
  });
  lifeline("holt", "05:20", 0, "OP 13", {
    lifeline: "communications", condition: "unstable",
    impactStatement: "The county's fiber route is cut near the Smith River. Cellular is degraded; the EOC is on radio and one satellite link.",
    stabilizationObjective: "Satellite links at the EOC and every shelter.",
    nextUpdateAt: iso("09:00"),
  });
  lifeline("holt", "05:30", 0, "OP 13", {
    lifeline: "energy", condition: "unstable",
    impactStatement: "Outages across Crescent City, Fort Dick and Klamath. The hospital and the prison run on generators.",
    stabilizationObjective: "Keep generator fuel at the hospital, the prison and the shelters.",
    nextUpdateAt: iso("09:00"),
  });
  lifeline("serrano", "06:20", 0, "OP 13", {
    lifeline: "health_medical", condition: "unstable",
    impactStatement: "Sutter Coast Hospital is open on generator power. Six dialysis patients cannot reach Eureka; pharmacy stock is low.",
    stabilizationObjective: "Air transport for dialysis and a pharmacy resupply by air.",
    nextUpdateAt: iso("10:00"),
    responsibleOrganizationIds: [organizations["sutter-coast"], organizations["cdph"]],
  });
  lifeline("webb", "06:25", 0, "OP 13", {
    lifeline: "food_hydration_shelter", condition: "stabilizing",
    impactStatement: "Five shelters hold 331 people, including shelters run by the Tolowa Dee-ni' Nation, the Yurok Tribe and Elk Valley Rancheria. Bottled water is short under the boil water notice.",
    stabilizationObjective: "Shelter and feed everyone displaced with safe water on site.",
    nextUpdateAt: iso("12:00"),
  });
  lifeline("farouk", "06:28", 0, "OP 13", {
    lifeline: "safety_security", condition: "stabilizing",
    impactStatement: "Law enforcement holding the closures. Swift water teams on standby at Klamath.",
    nextUpdateAt: iso("12:00"),
  });
  lifeline("banks", "06:30", 0, "OP 13", {
    lifeline: "hazardous_materials", condition: "unknown", confidence: "unknown",
    impactStatement: "Fuel sheen reported in the inner harbor; source not found.",
    // Due before the scenario clock, so the update reads as overdue.
    nextUpdateAt: iso("06:35"),
  });

  // California ESF coordination.
  const esf = (who: string, hhmm: string, input: Record<string, unknown>) =>
    later(at(hhmm), () => api(who, at(hhmm), "POST", `/api/v1/incidents/${incidentId}/esf-assessments`, {
      activation: "activated", capacity: "constrained", assessedAt: iso(hhmm), confidence: "confirmed",
      operationalPeriod: "OP 13", supportingOrganizationIds: [], priorities: [], evidence: [], actions: [], ...input,
    }));
  esf("novak", "05:10", {
    identity: { framework: "california", esf: "ca_esf_1", definitionVersion: 1 },
    capacity: "critical",
    situation: "Both highways out of the county are closed. Resupply by air through the county airport and by sea through the harbor.",
    coordinatorOrganizationId: organizations["caltrans-d1"],
    missions: ["Stabilize Last Chance Grade", "Clear the Patrick Creek slide", "Keep the Dr. Fine Bridge open one lane"],
    relatedLifelines: ["transportation"],
  });
  esf("webb", "06:26", {
    identity: { framework: "california", esf: "ca_esf_6", definitionVersion: 1 },
    situation: "Red Cross and the tribes shelter 331 people; two more sites are ready.",
    coordinatorOrganizationId: organizations["red-cross"],
    supportingOrganizationIds: [organizations["tolowa-deeni"], organizations["yurok-oes"], organizations["elk-valley-rancheria"]],
    missions: ["Bottled water to every shelter", "Open Mary Peacock School if Fort Dick floods"],
    relatedLifelines: ["food_hydration_shelter"],
  });
  esf("serrano", "06:22", {
    identity: { framework: "california", esf: "ca_esf_8", definitionVersion: 1 },
    capacity: "critical",
    situation: "Dialysis and pharmacy needs depend on air transport while the roads are closed.",
    coordinatorOrganizationId: organizations["cdph"],
    missions: ["Fly six dialysis patients to Eureka", "Fly in pharmacy stock"],
    relatedLifelines: ["health_medical"],
  });

  // Exercise alerts, each under its issuer's own authority.
  const alert = (who: string, hhmm: string, jurisdiction: string, withIncident: boolean, info: Record<string, unknown>) =>
    later(at(hhmm), async () => {
      const draft = await api<{ id: string }>(who, at(hhmm), "POST", `/api/v1/jurisdictions/${jurisdiction}/cap/drafts`, {
        ...(withIncident ? { incidentId } : {}),
        alert: {
          sender: `${who}@exercise.invalid`, status: "Exercise", msgType: "Alert", scope: "Public",
          note: "Exercise content only. Nothing was transmitted.", info: [info],
        },
      });
      await api(who, at(hhmm), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "in_review" });
      if (withIncident) await api("rivera", at(hhmm), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "approved" });
    });
  alert("whitfield", "04:35", jurisdictionId, true, {
    category: ["Health"], event: "Boil Water Notice", responseType: ["Execute"],
    urgency: "Immediate", severity: "Severe", certainty: "Observed",
    headline: "EXERCISE: Boil water notice for Crescent City",
    description: "Flooding raised turbidity at the Crescent City water intake above treatment limits.",
    instruction: "Boil tap water for one minute before drinking or cooking. Bottled water is at the fairgrounds.",
    area: [{ areaDesc: "Crescent City water service area" }],
  });
  alert("whitfield", "23:10", jurisdictionId, true, {
    category: ["Met"], event: "Flood Warning", responseType: ["Evacuate"],
    urgency: "Immediate", severity: "Extreme", certainty: "Observed",
    headline: "EXERCISE: Evacuation order for Fort Dick and Klamath Glen",
    description: "The Smith River and the Klamath River are rising with the third storm and high tides.",
    instruction: "Leave low ground now. Shelters are open at the fairgrounds and in Klamath.",
    area: [{ areaDesc: "Fort Dick and Klamath Glen" }],
  });
  alert("moss", "09:55", organizations["resighini-rancheria"]!, false, {
    category: ["Met"], event: "Flood Warning", responseType: ["Evacuate"],
    urgency: "Immediate", severity: "Extreme", certainty: "Observed",
    headline: "EXERCISE: Resighini Rancheria evacuation order",
    description: "The Klamath River is over its banks across Rancheria lands.",
    instruction: "Leave now for the Yurok Tribe Community Center in Klamath.",
    area: [{ areaDesc: "Resighini Rancheria" }],
  });

  // The morning release: the county has approved; the city has not yet.
  later(at("06:30"), async () => {
    const release = await api<{ id: string }>("whitfield", at("06:30"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
      title: "EXERCISE: Del Norte storm update, day 7 morning",
      body: "Exercise draft. Both highways out of Del Norte County are closed. Crescent City is under a boil water notice; bottled water is at the fairgrounds. Five shelters are open, including shelters run by the Tolowa Dee-ni' Nation, the Yurok Tribe and Elk Valley Rancheria. Supplies are arriving by air.",
      requiredAgencies: ["Del Norte County", "City of Crescent City"],
      incidentId,
    });
    await api("whitfield", at("06:31"), "POST", `/api/v1/jic/releases/${release.id}/submit`);
    await api("rivera", at("06:36"), "POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "Del Norte County", decision: "approve", note: "Approved for the county.",
    });
  });

  // The storm coordination thread.
  let threadId = "";
  later(at("06:00", -6), async () => {
    threadId = (await api<{ id: string }>("rivera", at("06:00", -6), "POST", `/api/v1/jurisdictions/${jurisdictionId}/threads`, {
      kind: "group", title: "Storm coordination", incidentId, audience: "incident",
    })).id;
  });
  const messages: ReadonlyArray<[string, string, string, number]> = [
    ["novak", "Last Chance Grade is closed until the geotechnical team clears it. No estimate.", "17:05", -3],
    ["tran", "Tolowa Dee-ni' Nation has the Smith River community center open with generator power.", "02:55", 0],
    ["hughes", "Turbidity is above limits at the intake. Recommend a boil water notice.", "04:05", 0],
    ["farouk", "Cal OES has a fixed-wing flight for Crescent City at 11:00 if the ceiling lifts.", "05:25", 0],
    ["pierce", "Yurok shelter in Klamath is at 71. We need cots and a generator.", "05:52", 0],
    ["ahn", "Hospital has two days of generator fuel. Dialysis patients must fly today.", "06:07", 0],
  ];
  for (const [who, body, hhmm, days] of messages) {
    later(at(hhmm, days), () => api(who, at(hhmm, days), "POST", `/api/v1/threads/${threadId}/messages`, { body }));
  }

  // The exercise map layers: synthetic, drawn from the basemap's terrain, rivers and roads.
  later(at("06:33"), async () => {
    const pack = await api<{ pack: { id: string } }>("rivera", at("06:33"), "POST", `/api/v1/incidents/${incidentId}/data-packs`, {
      name: "SYNTHETIC Del Norte Atmospheric Rivers exercise layers",
      organizationSlug: OWNER.slug,
      description: "Exercise-only synthetic geometry drawn from the basemap's terrain, rivers and roads. Not official flood maps.",
      // Freshness is judged against the real clock and the scenario clock can be a day
      // behind it, so the layers stay current for two days after seeding.
      datasets: [
        { key: "flood_extents", name: "SYNTHETIC flood extents", kind: "geojson", fieldMapping: MAPPING, coverage: DEL_NORTE_AREA, staleAfterSeconds: 172800 },
        { key: "slides", name: "SYNTHETIC slides", kind: "geojson", fieldMapping: MAPPING, coverage: DEL_NORTE_AREA, staleAfterSeconds: 172800 },
        { key: "outage_areas", name: "SYNTHETIC power outage areas", kind: "geojson", fieldMapping: MAPPING, coverage: DEL_NORTE_AREA, staleAfterSeconds: 172800 },
      ],
    });
    const datasets = await sql`select id, key from data_pack_datasets where pack_id = ${pack.pack.id}`;
    for (const dataset of datasets) {
      await api("rivera", at("06:34"), "POST", `/api/v1/data-packs/datasets/${dataset.id as string}/load`, {
        records: DEL_NORTE_LAYERS[dataset.key as keyof typeof DEL_NORTE_LAYERS],
      });
    }
  });

  // By 06:38 Alex Rivera has read all but the three newest notifications.
  later(at("06:38"), async () => {
    const inbox = await api<{ notifications: { id: string; read_at: string | null; assigned_to_current_actor: boolean }[] }>(
      "rivera", at("06:38"), "GET", "/api/v1/notifications?limit=500");
    const unread = inbox.notifications.filter((item) => item.assigned_to_current_actor && !item.read_at);
    for (const item of unread.slice(3)) await api("rivera", at("06:38"), "POST", `/api/v1/notifications/${item.id}/read`);
  });

  await runInOrder();
  return finish(incidentId);
}

const MAPPING = {
  title: "properties.title", category: "properties.category", status: "properties.status",
  note: "properties.note", sourceId: "properties.id", geometry: "geometry",
};

/** A layer feature whose geometry tools/demo-geometry generated under the same id. */
const feature = (id: keyof typeof DEL_NORTE_GEOMETRY, title: string, category: string, status: string, note: string) =>
  ({ properties: { id, title, category, status, note }, geometry: DEL_NORTE_GEOMETRY[id] });

const DEL_NORTE_LAYERS = {
  flood_extents: [
    feature("smith-lower", "SYNTHETIC Smith River flooding, Fort Dick to the mouth", "Flood extent", "critical", "Observed at 05:30."),
    feature("klamath-glen", "SYNTHETIC Klamath River flooding, Klamath Glen and Resighini", "Flood extent", "critical", "Observed at 06:00."),
    feature("lake-earl", "SYNTHETIC Lake Earl high water", "Flood extent", "warning", "Rising with the tide."),
    feature("harbor", "SYNTHETIC harbor surge", "Flood extent", "warning", "Surf over the breakwater at high tide."),
  ],
  slides: [
    feature("last-chance", "SYNTHETIC Last Chance Grade failure", "Slide", "closed", "Roadway dropped on day 4."),
    feature("patrick-creek", "SYNTHETIC Patrick Creek slide", "Slide", "closed", "Both lanes blocked."),
    feature("hiouchi", "SYNTHETIC Hiouchi slide", "Slide", "one_lane", "One lane with a pilot car."),
    feature("howland-hill", "SYNTHETIC Howland Hill Road slide", "Slide", "warning", "Mud across the road."),
  ],
  outage_areas: [
    feature("crescent-city", "SYNTHETIC Crescent City outage", "Power outage", "critical", "About 4,000 customers."),
    feature("fort-dick", "SYNTHETIC Fort Dick and Smith River outage", "Power outage", "critical", "About 1,200 customers."),
    feature("klamath", "SYNTHETIC Klamath outage", "Power outage", "critical", "About 600 customers."),
  ],
};
