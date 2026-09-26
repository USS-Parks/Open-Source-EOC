import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { CASCADIA_CLOSURES, CASCADIA_GEOMETRY } from "./geometry/cascadia.js";
import { NORTH_COAST_PASSWORD } from "./north-coast.js";
import {
  scenarioClock, seedChecklist, startScenario, zoned, type ChecklistTask, type ScenarioPerson, type ScenarioRun,
} from "./scenario-kit.js";

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
  /** Each operational period's area revision, OP 01 first. */
  const periodRevisions: number[] = [];
  for (const period of periods) {
    const result = await api<{ revision: number }>("delgado", period.at, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: revision,
      geometry: CASCADIA_AREA,
      operationalPeriod: { label: period.label, startsAt: period.startsAt, endsAt: period.endsAt },
      reason: `${period.label} planning cycle for the Cascadia Earthquake and Tsunami exercise`,
    });
    revision = result.revision;
    periodRevisions.push(revision);
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
  const logistics = position("logistics_section_chief");
  const information = position("public_information_officer");
  await api("delgado", at("08:35", -1), "POST", `/api/v1/positions/${planning}/assignments`, { personId: people["delgado"]!.id });
  await api("delgado", at("08:36", -1), "POST", `/api/v1/positions/${operations}/assignments`, { personId: people["osei"]!.id });
  await api("delgado", at("08:37", -1), "POST", `/api/v1/positions/${logistics}/assignments`, { personId: people["lindgren"]!.id });
  await api("delgado", at("08:38", -1), "POST", `/api/v1/positions/${information}/assignments`, { personId: people["fraser"]!.id });
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
  const update = (who: string, when: Date, templateKey: string, recordId: string, data: Record<string, unknown>) =>
    api(who, when, "PATCH", `/api/v1/boards/${boardFor(templateKey)}/records/${recordId}?incidentId=${incidentId}`, data);

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
  // Each open shelter's occupancy as it opened, at the end of OP 01 (when water
  // ran short and every shelter was compromised) and before dawn after the
  // aftershock; the morning's figure above comes last.
  const shelterHistory: Readonly<Record<string, readonly [number, number, number]>> = {
    "Redwood Acres Fairgrounds": [180, 310, 390],
    "College of the Redwoods, Eureka campus": [120, 220, 285],
    "Cal Poly Humboldt": [210, 400, 560],
    "McKinleyville Middle School": [60, 120, 165],
    "Blue Lake Rancheria": [70, 115, 140],
    "Fortuna Union High School": [90, 180, 235],
    "Humboldt County Fairgrounds, Ferndale": [60, 130, 170],
    "Trinity Valley Elementary School, Willow Creek": [20, 40, 55],
    "Hoopa Valley Elementary School": [15, 30, 40],
    "Winship Junior High School": [50, 100, 135],
  };
  const shelterIds: Record<string, string> = {};
  for (const [index, [name, capacity, occupancy, lon, lat, who, planned]] of shelters.entries()) {
    const when = at(`${String(11 + Math.floor(index / 4)).padStart(2, "0")}:${String(5 + (index % 4) * 12).padStart(2, "0")}`, -1);
    const [opened, evening, dawn] = shelterHistory[name] ?? [occupancy, occupancy, occupancy];
    later(when, async () => {
      shelterIds[name] = (await record(who, when, "shelters", {
        name, status: "normal", capacity, occupancy: opened, pets_accepted: true, planned: planned ?? false,
        location: { type: "Point", coordinates: [lon, lat] },
      })).id;
    });
    if (planned) continue;
    const minute = String(10 + index * 4).padStart(2, "0");
    const steps: ReadonlyArray<readonly [Date, Record<string, unknown>]> = [
      [at(`18:${minute}`, -1), { occupancy: evening, status: "compromised" }],
      [at(`05:${minute}`), { occupancy: dawn, status: "compromised" }],
      [at(`08:${minute}`), { occupancy }],
    ];
    for (const [stepAt, data] of steps) later(stepAt, () => update(who, stepAt, "shelters", shelterIds[name]!, data));
  }
  // The College of the Redwoods shelter moved everyone out while engineers checked it after the aftershock.
  later(at("03:50"), () => update("vance", at("03:50"), "shelters", shelterIds["College of the Redwoods, Eureka campus"]!, { status: "evacuating" }));

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
    ["Urban search and rescue teams", "No arrival estimate from the state: 72 to 96 hours by road, sooner only by air", "immediate", "sourcing", "12:00", -1, "osei", "10:30", undefined, -1],
    ["Structural engineers for building safety", "Four teams; local engineers assigned to search sites meanwhile", "immediate", "sourcing", "18:00", -1, "osei", "10:45", undefined, -1],
    ["Fire engines for the Eureka fires", "Local and tribal engines committed; mutual aid cannot reach by road", "immediate", "assigned", "12:00", -1, "marsh", "09:35", "marsh", -1],
    ["Water tenders for firefighting", "Hydrants dry; drafting from the bay", "immediate", "assigned", "13:00", -1, "marsh", "10:25", "marsh", -1],
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
  const requestIds: Record<string, string> = {};
  for (const [item, notes, priority, state, neededBy, neededDays, who, hhmm, owner, days = 0] of requests) {
    const when = at(hhmm, days);
    const reach = order.indexOf(state);
    later(when, async () => {
      const created = await api<{ id: string }>(who, when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
        origin: participants[who] ? "field" : "eoc", item, quantity: 1, priority, neededBy: iso(neededBy, neededDays), notes, incidentId,
      });
      requestIds[item] = created.id;
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

  // Requests that have ended: rescues done, one cancelled when people walked out, one the state could not fill.
  const endedRequests: ReadonlyArray<{
    item: string; notes: string; who: string; at: Date; neededBy: Date; steps: ReadonlyArray<readonly [string, Date, string?]>;
  }> = [
    {
      item: "Helicopter hoist rescues at Fields Landing", notes: "People on rooftops after the first wave", who: "kerr",
      at: at("08:40", -1), neededBy: at("09:00", -1),
      steps: [["accepted", at("08:41", -1)], ["sourcing", at("08:41", -1)], ["assigned", at("08:42", -1)], ["deployed", at("08:50", -1)],
        ["fulfilled", at("11:20", -1)], ["closed", at("12:15", -1)]],
    },
    {
      item: "Buses to evacuate King Salmon", notes: "Residents without cars", who: "osei", at: at("08:44", -1), neededBy: at("09:15", -1),
      steps: [["cancelled", at("09:20", -1), "The road to King Salmon flooded; residents walked to high ground"]],
    },
    {
      item: "Ambulance strike team from Mendocino County", notes: "Five ambulances for the Eureka collapse", who: "sharma",
      at: at("10:05", -1), neededBy: at("12:00", -1),
      steps: [["accepted", at("10:10", -1)], ["declined", at("11:40", -1), "No road access from the south; request air medical transport instead"]],
    },
    {
      item: "Search dogs for the Eureka apartment collapse", notes: "Two canine teams", who: "marsh", at: at("10:12", -1), neededBy: at("12:00", -1),
      steps: [["accepted", at("10:15", -1)], ["sourcing", at("10:15", -1)], ["assigned", at("10:30", -1)], ["deployed", at("11:05", -1)],
        ["fulfilled", at("06:30")], ["closed", at("07:20")]],
    },
  ];
  for (const request of endedRequests) {
    later(request.at, async () => {
      requestIds[request.item] = (await api<{ id: string }>(request.who, request.at, "POST", `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
        origin: participants[request.who] ? "field" : "eoc", item: request.item, quantity: 1, priority: "immediate",
        neededBy: request.neededBy.toISOString(), notes: request.notes, incidentId,
      })).id;
    });
    for (const [toState, stepAt, note] of request.steps) {
      later(stepAt, () => api("lindgren", stepAt, "POST", `/api/v1/resource-requests/${requestIds[request.item]!}/transition`,
        { toState, ...(note ? { note } : {}) }));
    }
  }

  // What the county has recorded against its requests so far, for reimbursement.
  const costs: ReadonlyArray<readonly [string, string, number, string, Date]> = [
    ["Fire engines for the Eureka fires", "Equipment", 486_000_00, "Engine hours, first 24 hours", at("12:30", -1)],
    ["Fire engines for the Eureka fires", "Personnel", 312_000_00, "Overtime for engine crews", at("06:00")],
    ["Water tenders for firefighting", "Equipment", 145_000_00, "Tender hours drafting from the bay", at("13:30", -1)],
    ["Boats for the Samoa Peninsula", "Equipment", 6_200_00, "Boat hours and fuel", at("06:10")],
    ["Air evacuation of critical patients", "Contract", 840_000_00, "Air ambulance flights to Redding", at("07:00")],
    ["Generators for shelters", "Equipment", 22_400_00, "Eight generator rentals, first week", at("06:20")],
    ["Meals for shelter residents", "Supplies", 57_600_00, "7,200 meals", at("07:10")],
    ["Heavy equipment for SR-299 slides", "Equipment", 39_000_00, "Excavators and haul trucks, first day", at("07:30")],
    ["Helicopter hoist rescues at Fields Landing", "Equipment", 19_800_00, "Flight hours", at("12:10", -1)],
    ["Search dogs for the Eureka apartment collapse", "Personnel", 4_600_00, "Canine team hours", at("07:15")],
  ];
  for (const [item, category, amountCents, description, when] of costs) {
    later(when, () => api("lindgren", when, "POST", `/api/v1/resource-requests/${requestIds[item]!}/costs`,
      { category, amountCents, description, incurredAt: zoned(when).date }));
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

  // The checklist: the activation's tasks, then the ones the lead adds for sections and partners.
  const toParticipant = (key: string) => ({ kind: "incident_participant" as const, incidentId, participantId: participants[key]! });
  const toPosition = (positionId: string) => ({ kind: "position" as const, positionId });
  // No incident commander is seated (the county's positions serve its other incidents too),
  // so the lead running planning takes the command checklist.
  const tasks: ChecklistTask[] = [
    { item: "Assume command and announce on the significant events board", category: "command", due: at("08:45", -1), holder: toPosition(planning) },
    { item: "Hold re-entry to the tsunami zone until the all clear", category: "command", due: at("20:00"), inProgress: true, holder: toPosition(planning) },
    { item: "Set initial incident objectives", category: "command", due: at("10:00", -1), holder: toPosition(planning) },
    { item: "Establish the operational period", category: "command", due: at("09:00", -1), holder: toPosition(planning) },
    { item: "Account for EOC staff and field crews", category: "operations", due: at("10:00", -1) },
    { item: "Reach isolated communities by any available means", category: "operations", due: at("18:00"), inProgress: true },
    { item: "Open the resource request board", category: "operations", due: at("09:30", -1) },
    { item: "Collect lifeline assessments, marking what is unknown as unknown", category: "planning", due: at("09:00"), inProgress: true },
    { item: "Start rapid damage assessment of critical facilities and bridges", category: "planning", due: at("16:00", -1) },
    { item: "Inventory local resources before outside help arrives", category: "logistics", due: at("18:00", -1) },
    { item: "Name an air or sea resupply point", category: "logistics", due: at("14:00", -1) },
    { item: "Draft the initial public statement", category: "public_information", due: at("08:30", -1) },
    { item: "Confirm how messages reach people without power or cellular service", category: "public_information", due: at("12:00"), inProgress: true },
    { item: "Map gas shutoffs in Eureka, Arcata and Fortuna", category: "operations", due: at("20:00", -1), added: at("10:00", -1), holder: toParticipant("byrne") },
    { item: "Restore water pressure to St. Joseph Hospital", category: "operations", due: at("16:00"), added: at("10:30", -1), holder: toParticipant("chandler") },
    { item: "Report bridge inspections on US-101 and SR-255", category: "operations", due: at("18:00", -1), added: at("11:30", -1), holder: toParticipant("ibarra") },
    { item: "Clear one lane of SR-299 from the Redding side", category: "operations", due: at("18:00", 1), added: at("11:35", -1), holder: toParticipant("ibarra"), inProgress: true },
    { item: "Coordinate the air evacuation of critical patients to Redding", category: "operations", due: at("12:00"), added: at("15:45", -1), holder: toParticipant("sharma"), inProgress: true },
    { item: "Pre-position fuel at the airport for the first flights", category: "logistics", due: at("08:00"), added: at("18:15", -1), holder: toPosition(logistics), inProgress: true },
    { item: "Publish the air bridge schedule for the airport", category: "logistics", due: at("07:00"), added: at("18:30", -1), holder: toParticipant("kerr") },
    { item: "Stand up the family assistance center at Redwood Acres", category: "mass_care", due: at("12:00"), added: at("18:35", -1), holder: toParticipant("vance"), inProgress: true },
    { item: "Count shelter residents by site for the situation report", category: "mass_care", due: at("06:00"), added: at("20:10", -1), holder: toParticipant("vance") },
    { item: "Confirm hospital generator fuel for 48 hours", category: "operations", due: at("08:00"), added: at("20:20", -1), holder: toParticipant("sharma"), inProgress: true },
    { item: "Reach Weitchpec and Orleans by amateur radio", category: "operations", due: at("09:00"), added: at("20:30", -1), holder: toParticipant("price") },
    { item: "Prepare the OP 04 briefing", category: "planning", due: at("19:00"), added: at("07:40"), holder: toPosition(planning) },
    { item: "Read the shelter list on the radio stations still on air", category: "public_information", due: at("11:00"), added: at("07:45"), holder: toPosition(information), inProgress: true },
    { item: "Open Sunny Brae Middle School as a shelter", category: "mass_care", due: at("14:00"), added: at("09:00"), holder: toParticipant("ruiz") },
  ];
  seedChecklist({ api, later }, "delgado", incidentId, at("08:42", -1), tasks, [
    { who: "fraser", at: at("08:50", -1), items: ["Draft the initial public statement"], position: information },
    { who: "delgado", at: at("09:05", -1),
      items: ["Assume command and announce on the significant events board", "Set initial incident objectives", "Establish the operational period"] },
    { who: "osei", at: at("09:40", -1), position: operations, items: ["Account for EOC staff and field crews", "Open the resource request board"] },
    { who: "lindgren", at: at("13:30", -1), position: logistics, items: ["Name an air or sea resupply point"] },
    { who: "delgado", at: at("15:30", -1), items: ["Start rapid damage assessment of critical facilities and bridges"] },
    { who: "ibarra", at: at("17:15", -1), items: ["Report bridge inspections on US-101 and SR-255"] },
    { who: "lindgren", at: at("17:40", -1), position: logistics, items: ["Inventory local resources before outside help arrives"] },
    { who: "byrne", at: at("19:20", -1), items: ["Map gas shutoffs in Eureka, Arcata and Fortuna"] },
    { who: "vance", at: at("05:55"), items: ["Count shelter residents by site for the situation report"] },
    { who: "kerr", at: at("06:30"), items: ["Publish the air bridge schedule for the airport"] },
  ]);

  // Incident action plans: OP 01 and OP 02 done, OP 03 approved, and the partners' own plans in their states.
  const FORMS = ["ICS-202", "ICS-203", "ICS-204", "ICS-205", "ICS-206", "ICS-207", "ICS-208"];
  const plans: ReadonlyArray<{
    who: string; period: number; forms: readonly string[]; at: Date; objectives?: string[];
    steps?: ReadonlyArray<readonly ["submit" | "approve" | "complete", string, Date]>;
  }> = [
    { who: "delgado", period: 0, forms: FORMS, at: at("08:55", -1),
      objectives: ["Account for everyone in the tsunami zone", "Hold the fires in Eureka, Arcata and Fortuna", "Open shelters on high ground"],
      steps: [["approve", "delgado", at("09:15", -1)], ["complete", "delgado", at("20:05", -1)]] },
    { who: "delgado", period: 1, forms: FORMS, at: at("19:10", -1),
      objectives: ["Reach the Samoa Peninsula at first light", "Keep the hospitals powered and supplied", "Hold the waterfront fires"],
      steps: [["approve", "delgado", at("19:40", -1)], ["complete", "delgado", at("08:05")]] },
    { who: "delgado", period: 2, forms: FORMS, at: at("07:05"),
      objectives: ["Fly out critical patients", "Water and cots to every shelter", "Open one road to the outside"],
      steps: [["approve", "delgado", at("07:50")]] },
    { who: "vance", period: 2, forms: ["ICS-202", "ICS-204", "ICS-205"], at: at("08:20"), steps: [["submit", "vance", at("09:10")]] },
    { who: "sharma", period: 2, forms: ["ICS-206"], at: at("08:35") },
    { who: "kerr", period: 2, forms: [], at: at("09:30") },
  ];
  for (const plan of plans) {
    let planId = "";
    later(plan.at, async () => {
      planId = (await api<{ id: string }>(plan.who, plan.at, "POST", `/api/v1/incidents/${incidentId}/iap`, {
        operationalPeriod: periods[plan.period]!.label, periodRevision: periodRevisions[plan.period], formIds: plan.forms,
        ...(plan.objectives ? { objectives: plan.objectives } : {}),
      })).id;
    });
    for (const [step, who, when] of plan.steps ?? []) later(when, () => api(who, when, "POST", `/api/v1/iap/${planId}/${step}`));
  }

  // Damage assessment. Official field assessments count as they are made; public reports wait in the intake queue.
  const fieldAssessments: ReadonlyArray<readonly [string, string, string, string, boolean | null, number, string, number, number, Date]> = [
    ["Apartment building, central Eureka", "multi_family", "destroyed", "rented", true, 3_200_000, "Collapsed; search and rescue on site", -124.155, 40.795, at("11:00", -1)],
    ["4th and E Streets, Eureka", "business", "destroyed", "owned", true, 1_850_000, "Burned in the Old Town fire", -124.166, 40.801, at("12:00", -1)],
    ["King Salmon Avenue, King Salmon", "single_family", "destroyed", "owned", false, 420_000, "Swept off its foundation by the tsunami", -124.217, 40.74, at("12:30", -1)],
    ["Railroad Avenue, Fields Landing", "mobile_home", "destroyed", "owned", false, 95_000, "Tsunami debris", -124.215, 40.726, at("12:45", -1)],
    ["Eureka waterfront, near the marina", "single_family", "major", "owned", null, 180_000, "Foundation failed in liquefaction", -124.163, 40.806, at("13:10", -1)],
    ["Waterfront Drive, Eureka", "business", "major", "owned", true, 640_000, "Warehouse settled and cracked", -124.174, 40.806, at("13:30", -1)],
    ["Samoa Peninsula", "single_family", "inaccessible", "unknown", null, 0, "No access; the bridge approaches are down", -124.185, 40.82, at("14:00", -1)],
    ["Buhne Drive, King Salmon", "single_family", "inaccessible", "unknown", null, 0, "Flooded; no access", -124.213, 40.745, at("14:20", -1)],
    ["Arcata, near the Plaza", "multi_family", "major", "rented", true, 520_000, "Shifted on its foundation in the aftershock", -124.085, 40.868, at("04:20")],
    ["Main Street, Fortuna", "business", "destroyed", "owned", true, 900_000, "Burned", -124.156, 40.598, at("05:00")],
    ["Manila", "mobile_home", "major", "owned", false, 60_000, "Moved off its piers", -124.165, 40.845, at("05:40")],
    ["Cutten", "single_family", "minor", "owned", true, 18_000, "Chimney down", -124.14, 40.77, at("06:10")],
    ["Loleta", "single_family", "minor", "owned", false, 12_000, "Cracked walls and broken windows", -124.224, 40.641, at("06:30")],
    ["Blue Lake", "single_family", "minor", "rented", null, 15_000, "Porch pulled away from the house", -123.99, 40.883, at("06:50")],
    ["Central Avenue, McKinleyville", "single_family", "affected", "owned", true, 4_000, "Contents damage; habitable", -124.1, 40.947, at("07:00")],
    ["Main Street, Ferndale", "business", "affected", "owned", true, 6_500, "Parapet cracks", -124.263, 40.576, at("07:20")],
  ];
  for (const [address, structureType, degree, ownership, insured, estimatedLoss, notes, lon, lat, when] of fieldAssessments) {
    later(when, () => api("mercer", when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/damage/assessments`, {
      incidentId, address, structureType, degree, ownership, insured, estimatedLoss, notes, location: { lon, lat },
    }));
  }
  // The intake is issued for this incident, so each public report it takes is the earthquake's.
  let intakeToken = "";
  later(at("15:00", -1), async () => {
    intakeToken = (await api<{ token: string }>("delgado", at("15:00", -1), "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/damage/intake/enable`, { incidentId })).token;
  });
  // Public reports come through the intake route, which reads only the intake token.
  const publicReports: ReadonlyArray<readonly [string, string, string, number, string, number, number, Date, Date?]> = [
    ["Pine Hill, Eureka", "single_family", "minor", 8_000, "Cracks in the garage slab", -124.176, 40.763, at("16:20", -1)],
    ["Sunny Brae, Arcata", "single_family", "major", 60_000, "Porch collapsed and the house leans", -124.068, 40.86, at("21:40", -1)],
    ["Westhaven", "mobile_home", "affected", 2_000, "Skirting torn off", -124.1, 41.03, at("06:50")],
    // Already assessed by the county's own team; review rejects it as a duplicate.
    ["King Salmon Avenue, King Salmon", "single_family", "destroyed", 400_000, "Our house is gone", -124.217, 40.74, at("07:30"), at("08:30")],
  ];
  for (const [address, structureType, degree, estimatedLoss, notes, lon, lat, when, rejectedAt] of publicReports) {
    let reportId = "";
    later(when, async () => {
      reportId = (await api<{ id: string }>("mercer", when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/damage/report`,
        { address, structureType, degree, estimatedLoss, notes, location: { lon, lat } }, { "x-intake-token": intakeToken })).id;
    });
    if (rejectedAt) later(rejectedAt, () => api("mercer", rejectedAt, "POST", `/api/v1/damage/assessments/${reportId}/moderate`, { decision: "rejected" }));
  }

  // Public Assistance line items the applicants have started, categories A to G.
  const paItems: ReadonlyArray<readonly [string, string, string, string, number, "draft" | "submitted" | "reviewed", number, Date]> = [
    ["Humboldt County", "a_debris_removal", "King Salmon and Fields Landing", "Tsunami debris removal from county roads and the shoreline", 2_850_000_00, "submitted", 15, at("16:00", -1)],
    ["City of Eureka", "a_debris_removal", "Old Town Eureka", "Fire debris removal after the gas leak fires", 1_200_000_00, "draft", 0, at("07:40")],
    ["Humboldt County", "b_emergency_protective_measures", "Ten shelters", "Emergency sheltering for the first 72 hours", 640_000_00, "reviewed", 40, at("17:00", -1)],
    ["City of Eureka", "b_emergency_protective_measures", "Eureka", "Search and rescue at the apartment collapse and fire suppression drafting from the bay", 480_000_00, "submitted", 60, at("18:00", -1)],
    ["Humboldt County", "c_roads_and_bridges", "King Salmon Avenue", "Roadway split by liquefaction; rebuild on new base", 3_400_000_00, "draft", 0, at("07:50")],
    ["Wiyot Tribe", "c_roads_and_bridges", "Table Bluff Road", "Cracked roadway to the reservation", 220_000_00, "submitted", 0, at("08:10")],
    ["Humboldt County", "d_water_control_facilities", "Eel River delta levees near Loleta", "Levee slumping and seepage after the shaking", 1_600_000_00, "draft", 0, at("08:20")],
    ["Humboldt County", "e_buildings_and_equipment", "Humboldt County EOC", "Structural repair of the EOC building", 950_000_00, "submitted", 5, at("19:00", -1)],
    ["Blue Lake Rancheria", "e_buildings_and_equipment", "Rancheria shelter", "Generator servicing and shelter wear", 45_000_00, "reviewed", 100, at("06:40")],
    ["City of Eureka", "f_utilities", "Eureka water distribution", "Repairs to broken distribution lines and hydrants", 2_100_000_00, "submitted", 20, at("07:00")],
    ["Bear River Band of the Rohnerville Rancheria", "f_utilities", "Loleta water tank", "Repair of the leaking water tank", 180_000_00, "reviewed", 70, at("07:10")],
    ["City of Arcata", "g_parks_recreational_other", "Arcata Marsh trails", "Trail and boardwalk damage from ground cracking", 310_000_00, "draft", 0, at("08:40")],
    ["City of Eureka", "g_parks_recreational_other", "Eureka waterfront boardwalk", "Boardwalk settled on liquefied fill", 760_000_00, "submitted", 0, at("09:00")],
  ];
  for (const [applicant, category, site, description, estimatedCostCents, status, percentComplete, when] of paItems) {
    later(when, () => api("lindgren", when, "POST", `/api/v1/jurisdictions/${jurisdictionId}/damage/pa-items`, {
      incidentId, applicant, category, site, description, estimatedCostCents, status, percentComplete,
    }));
  }

  // After-action observations as they were noted, by operational period.
  const observations: ReadonlyArray<readonly [string, string, "strength" | "improvement", string, string | null, number, string, Date]> = [
    ["public_information_and_warning", "training", "strength", "The tsunami warning went out eight minutes after the shaking stopped.", null, 0, "fraser", at("09:30", -1)],
    ["operational_communications", "equipment", "improvement", "Only two satellite terminals reached the EOC; shelters and field teams relayed through amateur radio for the first day.", "Stock a satellite terminal at every shelter site and fire station.", 0, "osei", at("18:30", -1)],
    ["mass_care_services", "organization", "strength", "The tribes opened and ran three shelters on their own lands within four hours, one on microgrid power.", null, 0, "delgado", at("19:00", -1)],
    ["logistics_and_supply_chain_management", "planning", "strength", "A local resource inventory in the first ten hours let the county assign engines, boats and generators before state help could arrive.", null, 0, "lindgren", at("19:15", -1)],
    ["fire_management_and_suppression", "equipment", "improvement", "Hydrants lost pressure when the transmission main broke; engines drafted from the bay without enough hard suction hose.", "Stage drafting kits with the engine companies near the bay.", 0, "osei", at("19:45", -1)],
    ["critical_transportation", "planning", "improvement", "The plan assumed US-101 north would reopen within a day; every corridor stayed closed and the airport became the only way in.", "Plan for every highway closed for 72 hours or more, with the airport as the resupply point.", 1, "delgado", at("22:30", -1)],
    ["public_health_healthcare_and_emergency_medical_services", "exercises", "improvement", "Hospital evacuation by air had never been exercised; patients were tracked on paper.", "Exercise air evacuation of hospital patients with the Coast Guard every year.", 1, "delgado", at("06:45")],
    ["mass_search_and_rescue_operations", "training", "improvement", "Local teams worked two collapses without a structural engineer for the first 20 hours.", "Train local engineers as structural specialists for search teams.", 1, "osei", at("07:15")],
    ["situational_assessment", "organization", "improvement", "Communications and hazardous materials stayed unknown past their update times; no one was assigned to chase them.", "Name an owner for every lifeline marked unknown at each briefing.", 2, "delgado", at("09:35")],
  ];
  for (const [capability, capabilityElement, kind, observation, recommendation, period, who, when] of observations) {
    later(when, () => api(who, when, "POST", `/api/v1/incidents/${incidentId}/aar/observations`, {
      capability, capabilityElement, kind, observation, periodRevision: periodRevisions[period],
      ...(recommendation ? { recommendation } : {}),
    }));
  }

  // Corrective actions on the improvement plan: owners, due dates and progress so far.
  const day = (days: number) => zoned(at("12:00", days)).date;
  type Owner = { kind: "position"; positionId: string } | { kind: "incident_participant"; incidentId: string; participantId: string };
  const actions: ReadonlyArray<{
    capability: string; element: string; recommendation: string; priority: string; owner: Owner; due: string | null;
    period: number; at: Date; progress?: ReadonlyArray<readonly ["in_progress" | "complete", Date]>;
  }> = [
    { capability: "public_information_and_warning", element: "training", recommendation: "Record the tsunami warning timeline for the after-action report", priority: "low",
      owner: toPosition(information), due: day(0), period: 0, at: at("09:40", -1), progress: [["in_progress", at("14:00", -1)], ["complete", at("21:00", -1)]] },
    { capability: "operational_communications", element: "planning", recommendation: "Write an amateur radio net plan for the isolated communities, with check-in times", priority: "high",
      owner: toParticipant("hale"), due: day(-1), period: 0, at: at("12:40", -1) },
    { capability: "operational_communications", element: "equipment", recommendation: "Buy and stage a satellite terminal at each shelter site and fire station", priority: "critical",
      owner: toPosition(logistics), due: day(30), period: 0, at: at("18:40", -1), progress: [["in_progress", at("06:00")]] },
    { capability: "infrastructure_systems", element: "planning", recommendation: "Map the gas shutoff valves for Eureka, Arcata and Fortuna in the EOC's map layers", priority: "medium",
      owner: toParticipant("byrne"), due: day(-1), period: 0, at: at("19:30", -1), progress: [["complete", at("19:35", -1)]] },
    { capability: "fire_management_and_suppression", element: "equipment", recommendation: "Issue drafting kits and hard suction hose to the engine companies near the bay", priority: "high",
      owner: toParticipant("marsh"), due: day(-1), period: 0, at: at("19:50", -1) },
    { capability: "logistics_and_supply_chain_management", element: "none", recommendation: "Record every local resource assignment with its cost from the first hour", priority: "unspecified",
      owner: toPosition(logistics), due: null, period: 0, at: at("19:20", -1) },
    { capability: "critical_transportation", element: "planning", recommendation: "Plan resupply through the airport for 96 hours with every highway closed", priority: "critical",
      owner: toPosition(planning), due: day(21), period: 1, at: at("22:35", -1) },
    { capability: "mass_care_services", element: "planning", recommendation: "Pre-arrange water and cots for ten shelters of 2,500 people for 96 hours", priority: "high",
      owner: toParticipant("vance"), due: day(45), period: 1, at: at("22:40", -1), progress: [["in_progress", at("07:30")]] },
    { capability: "public_health_healthcare_and_emergency_medical_services", element: "exercises", recommendation: "Exercise air evacuation of hospital patients with the Coast Guard every year", priority: "medium",
      owner: toParticipant("sharma"), due: day(120), period: 1, at: at("06:50") },
    { capability: "mass_search_and_rescue_operations", element: "training", recommendation: "Train and credential local engineers as structural specialists for search teams", priority: "medium",
      owner: toPosition(operations), due: day(90), period: 1, at: at("07:20") },
    { capability: "situational_assessment", element: "organization", recommendation: "Name an owner for every lifeline marked unknown at each briefing", priority: "high",
      owner: toPosition(planning), due: day(0), period: 2, at: at("09:40"), progress: [["in_progress", at("09:45")]] },
  ];
  for (const action of actions) {
    let actionId = "";
    later(action.at, async () => {
      actionId = (await api<{ id: string }>("delgado", action.at, "POST", `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
        incidentId, capability: action.capability, capabilityElement: action.element, recommendation: action.recommendation,
        priority: action.priority, periodRevision: periodRevisions[action.period], assignment: action.owner,
        ...(action.due ? { dueDate: action.due } : {}),
      })).id;
    });
    for (const [status, when] of action.progress ?? []) {
      later(when, () => api("delgado", when, "POST", `/api/v1/corrective-actions/${actionId}/status`, { status }));
    }
  }

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
