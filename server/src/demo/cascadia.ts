import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { CASCADIA_CLOSURES, CASCADIA_GEOMETRY } from "./geometry/cascadia.js";
import { NORTH_COAST_PASSWORD } from "./north-coast.js";
import { scenarioClock, startScenario, type ScenarioPerson, type ScenarioRun } from "./scenario-kit.js";

/**
 * The Cascadia Earthquake and Tsunami exercise: a magnitude 9.1 subduction
 * zone earthquake offshore. The first tsunami wave reaches Humboldt Bay about
 * 15 minutes after the shaking; the bay's shores liquefy; landslides close
 * SR-299 and the other corridors; gas leaks start structure fires in several
 * towns while the regional water main is broken. Every highway is closed and
 * outside help is days away. Humboldt County OES owns the incident with a
 * cast separate from North Coast Storm's. Every place is real; every event,
 * person and figure is synthetic.
 *
 * The scenario clock is 10:05 the morning after a 07:48 earthquake.
 */

const OWNER = { slug: "humboldt-oes", name: "Humboldt County OES" };
const PARTNERS = [
  { slug: "city-eureka", name: "City of Eureka" },
  { slug: "city-arcata", name: "City of Arcata" },
  { slug: "wiyot-tribe", name: "Wiyot Tribe" },
  { slug: "blue-lake-rancheria", name: "Blue Lake Rancheria" },
  { slug: "bear-river-band", name: "Bear River Band of the Rohnerville Rancheria" },
  { slug: "hoopa-oes", name: "Hoopa Valley Tribe OES" },
  { slug: "yurok-oes", name: "Yurok Tribe OES" },
  { slug: "caltrans-d1", name: "Caltrans District 1" },
  { slug: "cal-oes", name: "Cal OES" },
  { slug: "cal-fire-huu", name: "CAL FIRE Humboldt-Del Norte Unit" },
  { slug: "uscg-humboldt", name: "US Coast Guard Sector Humboldt Bay" },
  { slug: "red-cross", name: "American Red Cross" },
  { slug: "cdph", name: "CA Dept. of Public Health" },
  { slug: "cec", name: "CA Energy Commission" },
] as const;

export const CASCADIA_PEOPLE: readonly ScenarioPerson[] = [
  { key: "delgado", displayName: "A. Delgado", email: "a.delgado@humboldt.example", organization: OWNER.slug },
  { key: "osei", displayName: "K. Osei", email: "k.osei@humboldt.example", organization: OWNER.slug },
  { key: "lindgren", displayName: "P. Lindgren", email: "p.lindgren@humboldt.example", organization: OWNER.slug },
  { key: "fraser", displayName: "N. Fraser", email: "n.fraser@humboldt.example", organization: OWNER.slug },
  { key: "mercer", displayName: "S. Mercer", email: "s.mercer@humboldt.example", organization: OWNER.slug },
  { key: "chandler", displayName: "H. Chandler", email: "h.chandler@eureka.example", organization: "city-eureka", incidentPositionTitle: "City of Eureka liaison" },
  { key: "ruiz", displayName: "M. Ruiz", email: "m.ruiz@arcata.example", organization: "city-arcata", incidentPositionTitle: "City of Arcata liaison" },
  { key: "ames", displayName: "J. Ames", email: "j.ames@wiyot.example", organization: "wiyot-tribe", incidentPositionTitle: "Wiyot Tribe liaison" },
  { key: "ford", displayName: "C. Ford", email: "c.ford@bluelake.example", organization: "blue-lake-rancheria", incidentPositionTitle: "Blue Lake Rancheria liaison" },
  { key: "gill", displayName: "T. Gill", email: "t.gill@bearriver.example", organization: "bear-river-band", incidentPositionTitle: "Bear River Band liaison" },
  { key: "hale", displayName: "R. Hale", email: "r.hale@hoopa.example", organization: "hoopa-oes", incidentPositionTitle: "Hoopa Valley Tribe liaison" },
  { key: "price", displayName: "E. Price", email: "e.price@yurok.example", organization: "yurok-oes", incidentPositionTitle: "Yurok Tribe liaison" },
  { key: "ibarra", displayName: "F. Ibarra", email: "f.ibarra@caltrans.example", organization: "caltrans-d1", incidentPositionTitle: "Caltrans liaison" },
  { key: "sutton", displayName: "G. Sutton", email: "g.sutton@caloes.example", organization: "cal-oes", incidentPositionTitle: "Cal OES liaison" },
  { key: "marsh", displayName: "H. Marsh", email: "h.marsh@calfire.example", organization: "cal-fire-huu", incidentPositionTitle: "Fire and rescue liaison" },
  { key: "kerr", displayName: "L. Kerr", email: "l.kerr@uscg.example", organization: "uscg-humboldt", incidentPositionTitle: "Coast Guard liaison" },
  { key: "vance", displayName: "P. Vance", email: "p.vance@redcross.example", organization: "red-cross", incidentPositionTitle: "Shelter liaison" },
  { key: "sharma", displayName: "Q. Sharma", email: "q.sharma@cdph.example", organization: "cdph", incidentPositionTitle: "Medical and health liaison" },
  { key: "byrne", displayName: "D. Byrne", email: "d.byrne@cec.example", organization: "cec", incidentPositionTitle: "Gas and electric liaison" },
];

/** The incident area: Humboldt Bay, the Eel River valley, McKinleyville and SR-299 to Willow Creek and Hoopa. */
export const CASCADIA_AREA = {
  type: "Polygon" as const,
  coordinates: [[
    [-124.42, 40.52], [-124.3, 40.52], [-124.1, 40.55], [-123.95, 40.7], [-123.8, 40.84],
    [-123.62, 40.88], [-123.55, 40.95], [-123.58, 41.1], [-123.7, 41.12], [-123.85, 41.0],
    [-124.05, 41.02], [-124.16, 41.08], [-124.22, 40.95], [-124.28, 40.8], [-124.36, 40.68], [-124.42, 40.52],
  ]],
};

/** The scenario clock: the most recent 10:05 in the scenario time zone. */
export function cascadiaClock(now = new Date()): Date {
  return scenarioClock("10:05", now);
}

export async function seedCascadia(app: FastifyInstance, sql: Sql, clock = cascadiaClock()): Promise<ScenarioRun> {
  const { at, iso, api, later, runInOrder, finish, jurisdictionId, organizations, people } = await startScenario(app, sql, clock, {
    owner: OWNER, partners: PARTNERS, people: CASCADIA_PEOPLE, admins: ["delgado"], password: NORTH_COAST_PASSWORD,
  });

  const activation = await api<{ incidentId: string }>("delgado", at("08:31", -1), "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "earthquake_tsunami", name: "Cascadia Earthquake and Tsunami", kind: "exercise" });
  const incidentId = activation.incidentId;

  const periods = [
    { label: "OP 01", startsAt: iso("08:30", -1), endsAt: iso("20:00", -1), at: at("08:40", -1) },
    { label: "OP 02", startsAt: iso("20:00", -1), endsAt: iso("08:00"), at: at("19:30", -1) },
    { label: "OP 03", startsAt: iso("08:00"), endsAt: iso("20:00"), at: at("07:30") },
  ];
  let revision = 0;
  for (const period of periods) {
    const result = await api<{ revision: number }>("delgado", period.at, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: revision,
      geometry: CASCADIA_AREA,
      operationalPeriod: { label: period.label, startsAt: period.startsAt, endsAt: period.endsAt },
      reason: `${period.label} planning cycle for the Cascadia Earthquake and Tsunami exercise`,
    });
    revision = result.revision;
  }

  // This incident's own positions: the county may hold other incidents' positions too.
  const positions = await sql`
    select p.id, p.key from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId}`;
  const position = (key: string) => {
    const found = positions.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`the earthquake activation has no ${key} position`);
    return found.id as string;
  };
  const planning = position("planning_section_chief");
  const operations = position("operations_section_chief");
  await api("delgado", at("08:35", -1), "POST", `/api/v1/positions/${planning}/assignments`, { personId: people["delgado"]!.id });
  await api("delgado", at("08:36", -1), "POST", `/api/v1/positions/${operations}/assignments`, { personId: people["osei"]!.id });
  await api("delgado", at("08:37", -1), "POST", `/api/v1/positions/${position("logistics_section_chief")}/assignments`, { personId: people["lindgren"]!.id });
  await api("delgado", at("08:38", -1), "POST", `/api/v1/positions/${position("public_information_officer")}/assignments`, { personId: people["fraser"]!.id });
  await api("delgado", at("07:35"), "POST", `/api/v1/positions/${planning}/sign-in`);

  const participants: Record<string, string> = {};
  const grantExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const person of CASCADIA_PEOPLE.filter((candidate) => candidate.incidentPositionTitle)) {
    const grant = await api<{ participant: { id: string } }>("delgado", at("09:10", -1), "POST",
      `/api/v1/incidents/${incidentId}/participants`, {
        organizationSlug: person.organization, personEmail: person.email,
        incidentPositionTitle: person.incidentPositionTitle, role: "contributor",
        expiresAt: grantExpiry, reason: "Cascadia Earthquake and Tsunami exercise participation",
      });
    participants[person.key] = grant.participant.id;
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

  const events: ReadonlyArray<readonly [string, string, number, string, string]> = [
    ["delgado", "07:48", -1, "Magnitude 9.1 earthquake on the Cascadia subduction zone; strong shaking for about four minutes", "critical"],
    ["delgado", "07:55", -1, "Tsunami warning: evacuate the coast and the Humboldt Bay shore to high ground", "critical"],
    ["kerr", "08:03", -1, "First tsunami wave arrives in Humboldt Bay", "critical"],
    ["mercer", "08:40", -1, "Liquefaction under the Eureka waterfront, King Salmon, Fields Landing and the Samoa Peninsula", "critical"],
    ["marsh", "09:30", -1, "Gas leaks and structure fires in Eureka, Arcata and Fortuna", "critical"],
    ["chandler", "10:15", -1, "Regional water transmission main broken; hydrant pressure lost in Eureka", "critical"],
    ["ibarra", "11:00", -1, "SR-299 closed by landslides near Lord Ellis and Berry summits", "critical"],
    ["kerr", "13:20", -1, "McKinleyville airport runway inspected and open for daylight operations", "normal"],
    ["sutton", "18:10", -1, "State estimate: 72 to 96 hours before outside resources arrive by road", "warning"],
    ["delgado", "03:40", 0, "Magnitude 7.2 aftershock; no new tsunami", "warning"],
    ["hale", "09:30", 0, "Willow Creek and Hoopa reachable by amateur radio only", "warning"],
  ];
  for (const [who, hhmm, days, summary, severity] of events) {
    const when = at(hhmm, days);
    later(when, () => record(who, when, "significant_events", { summary, occurred_at: when.toISOString(), severity }));
  }

  // Shelters on high ground: ten open with 2,315 people; one planned.
  const shelters: ReadonlyArray<readonly [string, number, number, number, number, string, boolean?]> = [
    ["Redwood Acres Fairgrounds", 500, 420, -124.12678, 40.77928, "vance"],
    ["College of the Redwoods, Eureka campus", 400, 310, -124.19455, 40.69785, "vance"],
    ["Cal Poly Humboldt", 700, 560, -124.08, 40.8765, "ruiz"],
    ["McKinleyville Middle School", 220, 180, -124.09921, 40.94611, "vance"],
    ["Blue Lake Rancheria", 160, 140, -124.0008, 40.8846, "ford"],
    ["Fortuna Union High School", 300, 260, -124.15211, 40.59459, "vance"],
    ["Humboldt County Fairgrounds, Ferndale", 250, 190, -124.26348, 40.58603, "gill"],
    ["Trinity Valley Elementary School, Willow Creek", 100, 60, -123.63949, 40.94937, "hale"],
    ["Hoopa Valley Elementary School", 100, 45, -123.67645, 41.05013, "hale"],
    ["Winship Junior High School", 200, 150, -124.13846, 40.76491, "vance"],
    ["Sunny Brae Middle School", 180, 0, -124.06777, 40.85628, "ruiz", true],
  ];
  for (const [index, [name, capacity, occupancy, lon, lat, who, planned]] of shelters.entries()) {
    const when = at(`${String(11 + Math.floor(index / 4)).padStart(2, "0")}:${String(5 + (index % 4) * 12).padStart(2, "0")}`, -1);
    later(when, () => record(who, when, "shelters", {
      name, status: planned ? "normal" : "compromised", capacity, occupancy, pets_accepted: true, planned: planned ?? false,
      location: { type: "Point", coordinates: [lon, lat] },
    }));
  }

  const facilities: ReadonlyArray<readonly [string, string, number, number, string, string?]> = [
    ["Incident Command Post, Redwood Acres", "incident_command_post", -124.1268, 40.7793, "normal", "The county EOC building is damaged"],
    ["Humboldt County EOC", "key_facility", -124.1664, 40.8021, "closed", "Structural damage; staff moved to Redwood Acres"],
    ["Air bridge staging, California Redwood Coast-Humboldt County Airport", "staging_area", -124.1079, 40.97665, "normal", "Runway open for daylight operations"],
    ["Coast Guard Air Station Humboldt Bay helibase", "helibase", -124.113, 40.972, "normal"],
    ["Murray Field", "key_facility", -124.11478, 40.80369, "closed", "Runway liquefied"],
    ["St. Joseph Hospital", "hospital", -124.1427, 40.7836, "compromised", "Damaged wing closed; on generator power"],
    ["Mad River Community Hospital", "hospital", -124.0918, 40.8993, "compromised", "On generator power; surge in the emergency department"],
    ["Redwood Memorial Hospital", "hospital", -124.13631, 40.58164, "compromised", "On generator power"],
    ["Regional water district, Essex", "key_facility", -124.03534, 40.90596, "compromised", "Transmission main broken downstream"],
    ["Humboldt Bay Generating Station", "key_facility", -124.2103, 40.7408, "closed", "Offline; in the inundation area"],
    ["Blue Lake Rancheria microgrid", "key_facility", -124.0008, 40.8846, "normal", "Powering the Rancheria shelter"],
    ["Samoa Bridge", "key_facility", -124.16073, 40.81488, "closed", "Approach spans dropped"],
    ["Airport weather station", "weather_station", -124.1086, 40.9781, "normal"],
  ];
  for (const [index, [name, kind, lon, lat, status, notes]] of facilities.entries()) {
    const when = at(`09:${String(12 + index * 3).padStart(2, "0")}`, -1);
    later(when, () => record("osei", when, "incident_facilities", {
      name, kind, status, location: { type: "Point", coordinates: [lon, lat] }, ...(notes ? { notes } : {}),
    }));
  }

  // Each closure is drawn along its road (tools/demo-geometry).
  const closures: ReadonlyArray<readonly [keyof typeof CASCADIA_CLOSURES, string, string]> = [
    ["US-101 between Eureka and Arcata", "Liquefaction and tsunami damage along the bay", "closed"],
    ["SR-255 at the Samoa Bridge", "Approach spans dropped", "closed"],
    ["US-101 at the Mad River bridge", "Bridge damage", "closed"],
    ["US-101 at Fields Landing", "Roadway split by liquefaction", "closed"],
    ["SR-211 at Fernbridge", "Bridge closed for inspection", "closed"],
    ["SR-299 near Lord Ellis Summit", "Landslide across both lanes", "closed"],
    ["SR-299 near Berry Summit", "Landslide across both lanes", "closed"],
    ["SR-299 at the Mad River bridge, Blue Lake", "Bridge deck cracked", "closed"],
    ["SR-96 north of Willow Creek", "Rockfall across the road", "closed"],
    ["Old Arcata Road", "Pavement buckled", "one_lane"],
    ["King Salmon Avenue", "Flooded and liquefied", "closed"],
  ];
  for (const [index, [road, reason, status]] of closures.entries()) {
    const when = at(`${String(9 + Math.floor(index / 4)).padStart(2, "0")}:${String(15 + (index % 4) * 10).padStart(2, "0")}`, -1);
    later(when, () => record("ibarra", when, "road_closures", { road, reason, status, location: CASCADIA_CLOSURES[road] }));
  }

  const fieldReports: ReadonlyArray<readonly [string, string, number, number, string, string, number?]> = [
    ["Water to the second floor on King Salmon Avenue", "hazard", -124.216, 40.74, "mercer", "08:20", -1],
    ["People on rooftops at Fields Landing", "other", -124.217, 40.725, "kerr", "08:35", -1],
    ["Sand boils across the Eureka waterfront", "hazard", -124.165, 40.806, "mercer", "08:50", -1],
    ["Gas smell across Old Town Eureka", "hazard", -124.168, 40.803, "chandler", "09:05", -1],
    ["Structure fire at 4th and E Streets", "hazard", -124.166, 40.801, "marsh", "09:25", -1],
    ["Structure fire on the Arcata Plaza", "hazard", -124.083, 40.868, "ruiz", "09:40", -1],
    ["Apartment building collapsed in Eureka", "damage", -124.155, 40.795, "chandler", "09:55", -1],
    ["No hydrant pressure in Eureka", "hazard", -124.16, 40.8, "marsh", "10:20", -1],
    ["Samoa Peninsula cut off; about 600 residents", "other", -124.185, 40.82, "kerr", "10:40", -1],
    ["Landslide across SR-299 at Lord Ellis", "hazard", -123.835, 40.882, "ibarra", "10:55", -1],
    ["Tuluwat Island shoreline damaged", "damage", -124.162, 40.815, "ames", "11:10", -1],
    ["Table Bluff road cracked", "damage", -124.25, 40.69, "ames", "11:30", -1],
    ["Fortuna structure fire on Main Street", "hazard", -124.156, 40.598, "marsh", "11:45", -1],
    ["Blue Lake Rancheria shelter open on microgrid power", "other", -124.0008, 40.8846, "ford", "12:05", -1],
    ["Loleta water tank leaking", "damage", -124.224, 40.641, "gill", "12:30", -1],
    ["Runway at the McKinleyville airport intact", "other", -124.108, 40.977, "kerr", "13:05", -1],
    ["Fuel tanks leaking at the Eureka waterfront", "hazard", -124.175, 40.805, "mercer", "14:00", -1],
    ["Dialysis patients need evacuation by air", "resource", -124.1427, 40.7836, "sharma", "15:30", -1],
    ["Willow Creek shelter needs water", "resource", -123.6395, 40.9494, "hale", "17:20", -1],
    ["Aftershock damage in Arcata", "damage", -124.085, 40.865, "ruiz", "03:55"],
    ["New gas leak in Fortuna", "hazard", -124.155, 40.596, "byrne", "04:30"],
    ["Cal Poly Humboldt shelter at capacity", "resource", -124.08, 40.8765, "ruiz", "06:40"],
    ["Search team needs a structural engineer", "resource", -124.155, 40.795, "marsh", "07:10"],
    ["Hoopa shelter low on food", "resource", -123.6765, 41.0501, "hale", "07:45"],
    ["Weitchpec and Orleans status unknown", "other", -123.7084, 41.1882, "price", "08:15"],
    ["Mad River Hospital oxygen for 24 hours", "resource", -124.0918, 40.8993, "sharma", "08:40"],
    ["Ferndale shelter needs cots", "resource", -124.2635, 40.586, "gill", "09:10"],
    ["Fires still burning in the Eureka waterfront", "hazard", -124.172, 40.804, "marsh", "09:40"],
    ["Missing persons list growing at Redwood Acres", "other", -124.1268, 40.7793, "vance", "09:55"],
    ["Portable toilets needed at College of the Redwoods", "resource", -124.1946, 40.6979, "vance", "10:00"],
  ];
  for (const [summary, category, lon, lat, who, hhmm, days = 0] of fieldReports) {
    const when = at(hhmm, days);
    later(when, () => record(who, when, "field_reports", { summary, category, location: { type: "Point", coordinates: [lon, lat] } }));
  }

  const damage: ReadonlyArray<readonly [string, string, string, number, number, string, number?]> = [
    ["multi_family", "destroyed", "Collapsed apartment building", -124.155, 40.795, "11:00", -1],
    ["business", "destroyed", "Burned in the Old Town fire", -124.166, 40.801, "12:00", -1],
    ["single_family", "destroyed", "Swept off its foundation by the tsunami", -124.217, 40.74, "12:30", -1],
    ["mobile_home", "destroyed", "Tsunami debris", -124.215, 40.726, "12:45", -1],
    ["single_family", "major", "Foundation failed in liquefaction", -124.163, 40.806, "13:10", -1],
    ["business", "major", "Waterfront warehouse settled and cracked", -124.174, 40.806, "13:30", -1],
    ["single_family", "inaccessible", "Samoa Peninsula: no access", -124.185, 40.82, "14:00", -1],
    ["multi_family", "major", "Arcata apartments shifted on foundations", -124.085, 40.868, "04:20"],
    ["business", "destroyed", "Burned on Fortuna Main Street", -124.156, 40.598, "05:00"],
    ["single_family", "minor", "Chimney down in Cutten", -124.14, 40.77, "06:10"],
  ];
  for (const [structure, degree, notes, lon, lat, hhmm, days = 0] of damage) {
    const when = at(hhmm, days);
    later(when, () => record("mercer", when, "damage_assessment", {
      structure_type: structure, degree, ownership: "unknown", notes, location: { type: "Point", coordinates: [lon, lat] },
    }));
  }

  // Requests: the state has little to send for days; local resources carry the first 72 hours.
  type RequestState = "submitted" | "accepted" | "sourcing" | "assigned" | "deployed";
  const requests: ReadonlyArray<readonly [string, string, string, RequestState, string, number, string, string, (string | undefined)?, number?]> = [
    ["Urban search and rescue teams", "No arrival estimate from the state: 72 to 96 hours by road, sooner only by air", "immediate", "sourcing", "12:00", -1, "osei", "10:30"],
    ["Structural engineers for building safety", "Four teams; local engineers assigned to search sites meanwhile", "immediate", "sourcing", "18:00", -1, "osei", "10:45"],
    ["Fire engines for the Eureka fires", "Local and tribal engines committed; mutual aid cannot reach by road", "immediate", "assigned", "12:00", -1, "marsh", "09:35", "marsh"],
    ["Water tenders for firefighting", "Hydrants dry; drafting from the bay", "immediate", "assigned", "13:00", -1, "marsh", "10:25", "marsh"],
    ["Air evacuation of critical patients", "Twelve patients from St. Joseph and Mad River to Redding", "immediate", "assigned", "12:00", 0, "sharma", "15:40", "kerr", -1],
    ["Dialysis by air to Redding", "Eighteen patients", "immediate", "sourcing", "12:00", 0, "sharma", "15:35", undefined, -1],
    ["Bulk drinking water", "Water for 2,500 people for three days", "immediate", "sourcing", "18:00", 0, "lindgren", "12:10", undefined, -1],
    ["Generators for shelters", "Eight shelters without power", "priority", "assigned", "18:00", 0, "lindgren", "12:20", "byrne", -1],
    ["Fuel for generators and fire apparatus", "Local tank farm damaged; fuel by sea or air", "immediate", "sourcing", "12:00", 0, "lindgren", "13:00", undefined, -1],
    ["Heavy equipment for SR-299 slides", "Caltrans crews on the Redding side working west", "priority", "assigned", "18:00", 1, "ibarra", "11:20", "ibarra", -1],
    ["Boats for the Samoa Peninsula", "Coast Guard and local boats to reach 600 residents", "immediate", "deployed", "18:00", -1, "kerr", "10:50", "kerr", -1],
    ["Satellite phones for isolated communities", "Willow Creek, Hoopa, Orleans and Weitchpec", "immediate", "accepted", "12:00", 0, "osei", "11:40", undefined, -1],
    ["Cots and blankets for shelters", "2,000 cots", "priority", "sourcing", "18:00", 0, "vance", "14:30", undefined, -1],
    ["Meals for shelter residents", "Three meals for 2,400 people", "immediate", "assigned", "12:00", 0, "vance", "14:40", "vance", -1],
    ["Medical supplies for field treatment sites", "Trauma kits and oxygen", "immediate", "sourcing", "12:00", 0, "sharma", "16:10", undefined, -1],
    ["Oxygen for Mad River Community Hospital", "24 hours left", "immediate", "accepted", "20:00", 0, "sharma", "08:45"],
    ["Food for the Hoopa shelter", "Two days of food for 60 people", "priority", "submitted", "18:00", 0, "hale", "07:50"],
    ["Cots for the Ferndale shelter", "60 cots", "priority", "submitted", "18:00", 0, "gill", "09:15"],
    ["Portable toilets for College of the Redwoods", "Twenty units", "priority", "submitted", "18:00", 0, "vance", "10:00"],
    ["Family assistance center staff", "Staff to register the missing and reunify families", "priority", "accepted", "12:00", 0, "vance", "18:30", undefined, -1],
  ];
  const order: readonly RequestState[] = ["submitted", "accepted", "sourcing", "assigned", "deployed"];
  for (const [item, notes, priority, state, neededBy, neededDays, who, hhmm, owner, days = 0] of requests) {
    const when = at(hhmm, days);
    const reach = order.indexOf(state);
    later(when, async () => {
      const created = await api<{ id: string }>(who, when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
        origin: participants[who] ? "field" : "eoc", item, quantity: 1, priority, neededBy: iso(neededBy, neededDays), notes, incidentId,
      });
      const move = (toState: string) => api("lindgren", when, "POST", `/api/v1/resource-requests/${created.id}/transition`, { toState });
      for (const next of order.slice(1, Math.min(reach, 2) + 1)) await move(next);
      if (reach >= 3) {
        if (owner) {
          await api("delgado", when, "POST", `/api/v1/resource-requests/${created.id}/assign`,
            { kind: "incident_participant", incidentId, participantId: participants[owner] });
        } else {
          await move("assigned");
        }
      }
      if (reach >= 4) await move("deployed");
    });
  }

  // Lifelines: most of what is known is partial, and much is unknown.
  const assessments: Record<string, string> = {};
  const lifeline = (who: string, hhmm: string, days: number, period: string, input: Record<string, unknown>) =>
    later(at(hhmm, days), async () => {
      const key = input.lifeline as string;
      const prior = assessments[key];
      const created = await api<{ id: string }>(who, at(hhmm, days), "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
        definitionVersion: 1, assessedAt: iso(hhmm, days), operationalPeriod: period, confidence: "estimated",
        components: [], evidence: [], responsibleOrganizationIds: [], actions: [],
        ...(prior ? { supersedesAssessmentId: prior } : {}), ...input,
      });
      assessments[key] = created.id;
    });
  lifeline("byrne", "12:00", -1, "OP 01", { lifeline: "energy", condition: "unstable", impactStatement: "Grid down across the county.", nextUpdateAt: iso("20:00", -1) });
  lifeline("osei", "12:30", -1, "OP 01", { lifeline: "communications", condition: "unknown", confidence: "unknown", impactStatement: "Cellular and fiber down. Status unknown outside the bay.", nextUpdateAt: iso("20:00", -1) });
  lifeline("ibarra", "09:00", 0, "OP 03", {
    lifeline: "transportation", condition: "unstable", confidence: "confirmed",
    impactStatement: "Every highway in and out is closed: US-101 north and south, SR-299 by landslides, SR-255 at the Samoa Bridge. The McKinleyville airport is the only way in.",
    stabilizationObjective: "One road open to Redding or to Oregon.", nextUpdateAt: iso("14:00"),
  });
  lifeline("chandler", "09:05", 0, "OP 03", {
    lifeline: "water_systems", condition: "unstable",
    impactStatement: "The regional transmission main is broken. Eureka and Arcata have no water pressure; firefighting drafts from the bay.",
    stabilizationObjective: "Restore pressure to hospitals and shelters.", nextUpdateAt: iso("14:00"),
  });
  lifeline("byrne", "09:10", 0, "OP 03", {
    lifeline: "energy", condition: "unstable",
    impactStatement: "Grid down across the county. Gas shut off in Eureka, Arcata and Fortuna after leaks. Blue Lake Rancheria's microgrid powers its shelter.",
    nextUpdateAt: iso("14:00"),
  });
  lifeline("osei", "09:20", 0, "OP 03", {
    lifeline: "communications", condition: "unknown", confidence: "unknown",
    impactStatement: "Cellular and fiber are down. Amateur radio nets and two satellite terminals carry EOC traffic. Status of Orleans and Weitchpec is unknown.",
    nextUpdateAt: iso("12:00"),
  });
  lifeline("sharma", "09:30", 0, "OP 03", {
    lifeline: "health_medical", condition: "unstable",
    impactStatement: "At 09:30: 212 injured confirmed and 130 more reported; 18 deaths confirmed and 23 more reported; 96 people reported missing. All three hospitals on generator power; St. Joseph has a closed wing.",
    stabilizationObjective: "Fly out critical patients; keep oxygen and generator fuel at the hospitals.", nextUpdateAt: iso("13:00"),
  });
  lifeline("vance", "09:40", 0, "OP 03", {
    lifeline: "food_hydration_shelter", condition: "unstable",
    impactStatement: "Ten shelters on high ground hold 2,315 people. Water and cots are short; outside supplies are days away by road.",
    nextUpdateAt: iso("13:00"),
  });
  lifeline("marsh", "09:45", 0, "OP 03", {
    lifeline: "safety_security", condition: "unstable", confidence: "confirmed",
    impactStatement: "Fires still burning on the Eureka waterfront. Search and rescue at two collapses with local teams only.",
    nextUpdateAt: iso("12:00"),
  });
  lifeline("mercer", "08:30", 0, "OP 03", {
    lifeline: "hazardous_materials", condition: "unknown", confidence: "unknown",
    impactStatement: "Fuel tanks leaking on the Eureka waterfront; the rest of the bay shore not yet surveyed.",
    // Due before the scenario clock, so the update reads as overdue.
    nextUpdateAt: iso("09:30"),
  });

  const esf = (who: string, hhmm: string, input: Record<string, unknown>) =>
    later(at(hhmm), () => api(who, at(hhmm), "POST", `/api/v1/incidents/${incidentId}/esf-assessments`, {
      activation: "activated", capacity: "critical", assessedAt: iso(hhmm), confidence: "estimated",
      operationalPeriod: "OP 03", supportingOrganizationIds: [], priorities: [], evidence: [], actions: [], ...input,
    }));
  esf("marsh", "09:50", {
    identity: { framework: "california", esf: "ca_esf_4", definitionVersion: 1 },
    situation: "Every local and tribal engine is committed. Mutual aid cannot arrive by road.",
    coordinatorOrganizationId: organizations["cal-fire-huu"], missions: ["Hold the waterfront fires", "Draft water from the bay"],
    relatedLifelines: ["safety_security", "water_systems"],
  });
  esf("sutton", "09:55", {
    identity: { framework: "california", esf: "ca_esf_9", definitionVersion: 1 },
    situation: "Local teams at two collapses. State urban search and rescue has no arrival estimate.",
    coordinatorOrganizationId: organizations["cal-oes"], missions: ["Search the Eureka apartment collapse", "Reach the Samoa Peninsula"],
    relatedLifelines: ["safety_security"],
  });
  esf("vance", "09:58", {
    identity: { framework: "california", esf: "ca_esf_6", definitionVersion: 1 },
    situation: "Ten shelters with 2,315 people; the tribes run shelters at Blue Lake, Ferndale and Hoopa.",
    coordinatorOrganizationId: organizations["red-cross"],
    supportingOrganizationIds: [organizations["blue-lake-rancheria"], organizations["bear-river-band"], organizations["hoopa-oes"]],
    missions: ["Water and cots to every shelter", "Open Sunny Brae Middle School"],
    relatedLifelines: ["food_hydration_shelter"],
  });

  later(at("07:56", -1), async () => {
    const draft = await api<{ id: string }>("fraser", at("07:56", -1), "POST", `/api/v1/jurisdictions/${jurisdictionId}/cap/drafts`, {
      incidentId,
      alert: {
        sender: "fraser@exercise.invalid", status: "Exercise", msgType: "Alert", scope: "Public",
        note: "Exercise content only. Nothing was transmitted.",
        info: [{
          category: ["Geo"], event: "Tsunami Warning", responseType: ["Evacuate"],
          urgency: "Immediate", severity: "Extreme", certainty: "Observed",
          headline: "EXERCISE: Tsunami warning for the Humboldt County coast and Humboldt Bay",
          description: "A great earthquake has struck offshore. Waves will arrive within minutes and keep coming for hours.",
          instruction: "Go to high ground or inland now, on foot if you can. Do not return until officials say it is safe.",
          area: [{ areaDesc: "Humboldt County coast and the shores of Humboldt Bay" }],
        }],
      },
    });
    await api("fraser", at("07:57", -1), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "in_review" });
    await api("delgado", at("07:58", -1), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "approved" });
  });

  later(at("09:50"), async () => {
    const release = await api<{ id: string }>("fraser", at("09:50"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
      title: "EXERCISE: Earthquake and tsunami update, morning of day 2",
      body: "Exercise draft. Every highway into Humboldt County is closed. Ten shelters on high ground are open; stay out of the tsunami zone. Water is off in Eureka and Arcata. Outside help is coming by air first and by road in three to four days.",
      requiredAgencies: ["Humboldt County", "City of Eureka", "City of Arcata"],
      incidentId,
    });
    await api("fraser", at("09:51"), "POST", `/api/v1/jic/releases/${release.id}/submit`);
    await api("delgado", at("10:00"), "POST", `/api/v1/jic/releases/${release.id}/decisions`, { agency: "Humboldt County", decision: "approve" });
  });

  let threadId = "";
  later(at("08:45", -1), async () => {
    threadId = (await api<{ id: string }>("delgado", at("08:45", -1), "POST", `/api/v1/jurisdictions/${jurisdictionId}/threads`, {
      kind: "group", title: "Earthquake coordination", incidentId, audience: "incident",
    })).id;
  });
  const messages: ReadonlyArray<[string, string, string, number]> = [
    ["kerr", "Coast Guard helicopters flying from the airport. Samoa Peninsula boats at first light.", "18:20", -1],
    ["sutton", "Cal OES: no road arrival for 72 to 96 hours. First flights into the airport tomorrow if weather allows.", "18:40", -1],
    ["ford", "Blue Lake Rancheria shelter at 140 on microgrid power. We can take 20 more.", "07:30", 0],
    ["hale", "Hoopa shelter has two days of food. We have not heard from Weitchpec.", "07:48", 0],
    ["marsh", "Waterfront fires still burning. We are drafting from the bay.", "09:42", 0],
  ];
  for (const [who, body, hhmm, days] of messages) {
    later(at(hhmm, days), () => api(who, at(hhmm, days), "POST", `/api/v1/threads/${threadId}/messages`, { body }));
  }

  later(at("09:59"), async () => {
    const pack = await api<{ pack: { id: string } }>("delgado", at("09:59"), "POST", `/api/v1/incidents/${incidentId}/data-packs`, {
      name: "SYNTHETIC Cascadia Earthquake and Tsunami exercise layers",
      organizationSlug: OWNER.slug,
      description: "Exercise-only synthetic geometry drawn from the basemap's terrain, shoreline and roads. Not official tsunami, liquefaction or landslide maps.",
      // Freshness is judged against the real clock and the scenario clock can be a day
      // behind it, so the layers stay current for two days after seeding.
      datasets: [
        { key: "inundation", name: "SYNTHETIC observed tsunami inundation", kind: "geojson", fieldMapping: MAPPING, coverage: CASCADIA_AREA, staleAfterSeconds: 172800 },
        { key: "liquefaction", name: "SYNTHETIC liquefaction areas", kind: "geojson", fieldMapping: MAPPING, coverage: CASCADIA_AREA, staleAfterSeconds: 172800 },
        { key: "hazards", name: "SYNTHETIC landslides, fires, gas leaks and bridge damage", kind: "geojson", fieldMapping: MAPPING, coverage: CASCADIA_AREA, staleAfterSeconds: 172800 },
      ],
    });
    const datasets = await sql`select id, key from data_pack_datasets where pack_id = ${pack.pack.id}`;
    for (const dataset of datasets) {
      await api("delgado", at("10:00"), "POST", `/api/v1/data-packs/datasets/${dataset.id as string}/load`, {
        records: CASCADIA_LAYERS[dataset.key as keyof typeof CASCADIA_LAYERS],
      });
    }
  });

  await runInOrder();
  return finish(incidentId);
}

const MAPPING = {
  title: "properties.title", category: "properties.category", status: "properties.status",
  note: "properties.note", sourceId: "properties.id", geometry: "geometry",
};
/** A layer feature whose geometry tools/demo-geometry generated under the same id. */
const feature = (id: keyof typeof CASCADIA_GEOMETRY, title: string, category: string, status: string, note: string) =>
  ({ properties: { id, title, category, status, note }, geometry: CASCADIA_GEOMETRY[id] });

const CASCADIA_LAYERS = {
  inundation: [
    feature("south-bay", "SYNTHETIC inundation: King Salmon and Fields Landing", "Tsunami inundation", "critical", "Observed from the air."),
    feature("waterfront", "SYNTHETIC inundation: Eureka waterfront", "Tsunami inundation", "critical", "Observed from the air."),
    feature("samoa", "SYNTHETIC inundation: Samoa Peninsula bay side", "Tsunami inundation", "critical", "Observed from the air."),
    feature("arcata-bottoms", "SYNTHETIC inundation: Arcata bottoms", "Tsunami inundation", "critical", "Observed from the air."),
  ],
  liquefaction: [
    feature("liq-waterfront", "SYNTHETIC liquefaction: Eureka waterfront fill", "Liquefaction", "critical", "Sand boils and settled buildings."),
    feature("liq-king-salmon", "SYNTHETIC liquefaction: King Salmon", "Liquefaction", "critical", "Roads split."),
    feature("liq-corridor", "SYNTHETIC liquefaction: US-101 corridor", "Liquefaction", "critical", "Roadway on fill failed."),
  ],
  hazards: [
    feature("slide-lord-ellis", "SYNTHETIC landslide near Lord Ellis Summit", "Slide", "closed", "SR-299 closed."),
    feature("slide-berry", "SYNTHETIC landslide near Berry Summit", "Slide", "closed", "SR-299 closed."),
    feature("fire-old-town", "SYNTHETIC structure fire, Old Town Eureka", "Structure fire", "critical", "Burning since 09:25 yesterday."),
    feature("fire-waterfront", "SYNTHETIC structure fire, Eureka waterfront", "Structure fire", "critical", "Still burning."),
    feature("fire-plaza", "SYNTHETIC structure fire, Arcata Plaza", "Structure fire", "warning", "Contained overnight."),
    feature("fire-fortuna", "SYNTHETIC structure fire, Fortuna Main Street", "Structure fire", "warning", "Contained."),
    feature("gas-fortuna", "SYNTHETIC gas leak, Fortuna", "Gas leak", "critical", "Reported after the aftershock."),
    feature("gas-arcata", "SYNTHETIC gas leak, Sunny Brae", "Gas leak", "warning", "Shut off at the meter."),
    feature("bridge-samoa", "SYNTHETIC bridge damage, Samoa Bridge", "Bridge damage", "closed", "Approach spans dropped."),
    feature("bridge-mad-river", "SYNTHETIC bridge damage, US-101 Mad River bridge", "Bridge damage", "closed", "US-101 closed at the bridge."),
    feature("bridge-fernbridge", "SYNTHETIC bridge damage, Fernbridge", "Bridge damage", "warning", "Closed for inspection."),
    feature("bridge-blue-lake", "SYNTHETIC bridge damage, SR-299 Mad River bridge at Blue Lake", "Bridge damage", "closed", "Bridge deck cracked."),
  ],
};
