import type { FastifyInstance } from "fastify";
import type { Sql } from "../db/client.js";
import { DEERHORN_CLOSURES, DEERHORN_GEOMETRY } from "./geometry/deerhorn.js";
import { NORTH_COAST_PASSWORD } from "./north-coast.js";
import {
  grantDemoDirector, scenarioClock, seedChecklist, startScenario, zoned, type ScenarioPerson, type ScenarioRun,
} from "./scenario-kit.js";

/**
 * The Deerhorn Lightning Complex exercise: dry lightning starts five fires in
 * one evening at the Klamath and Trinity confluence. The Deerhorn Fire starts
 * on the line between the Hoopa Valley Reservation and Yurok lands just south
 * of Weitchpec. Hoopa Valley Tribe OES owns the incident record and Yurok
 * Tribe OES sits in unified command as a coordinator. Each government issues
 * its own evacuation orders under its own authority, a joint release waits on
 * both tribes and CAL FIRE, and cultural resource information stays with the
 * tribes. Every place is real; every event, person and figure is synthetic.
 *
 * The scenario clock is day 3 of the complex at 15:10 local, the afternoon
 * burn period. Times are written against it the way North Coast Storm's are.
 */

/** The demo's one password, shared by every exercise's accounts. */
export const DEERHORN_PASSWORD = NORTH_COAST_PASSWORD;

const OWNER = { slug: "hoopa-oes", name: "Hoopa Valley Tribe OES" };
const PARTNERS = [
  { slug: "yurok-oes", name: "Yurok Tribe OES" },
  { slug: "karuk-tribe", name: "Karuk Tribe" },
  { slug: "cal-fire-huu", name: "CAL FIRE Humboldt-Del Norte Unit" },
  { slug: "six-rivers-nf", name: "Six Rivers National Forest" },
  { slug: "bia-pacific", name: "Bureau of Indian Affairs Pacific Region" },
  { slug: "humboldt-oes", name: "Humboldt County OES" },
  { slug: "caltrans-d1", name: "Caltrans District 1" },
  { slug: "red-cross", name: "American Red Cross" },
  { slug: "kimaw-medical", name: "K'ima:w Medical Center" },
] as const;

export const DEERHORN_PEOPLE: readonly ScenarioPerson[] = [
  { key: "morgan", displayName: "Casey Morgan", email: "casey.morgan@hoopa.example", organization: OWNER.slug },
  { key: "bennett", displayName: "R. Bennett", email: "r.bennett@hoopa.example", organization: OWNER.slug },
  { key: "ellis", displayName: "J. Ellis", email: "j.ellis@hoopa.example", organization: OWNER.slug },
  { key: "rowe", displayName: "M. Rowe", email: "m.rowe@hoopa.example", organization: OWNER.slug },
  { key: "quinn", displayName: "T. Quinn", email: "t.quinn@hoopa.example", organization: OWNER.slug },
  { key: "hayes", displayName: "S. Hayes", email: "s.hayes@yurok.example", organization: "yurok-oes", incidentPositionTitle: "Unified Command" },
  { key: "warren", displayName: "K. Warren", email: "k.warren@yurok.example", organization: "yurok-oes", incidentPositionTitle: "Yurok field operations" },
  { key: "lowe", displayName: "D. Lowe", email: "d.lowe@yurok.example", organization: "yurok-oes", incidentPositionTitle: "Yurok cultural resources liaison" },
  { key: "flores", displayName: "L. Flores", email: "l.flores@karuk.example", organization: "karuk-tribe", incidentPositionTitle: "Karuk liaison" },
  { key: "kowalski", displayName: "D. Kowalski", email: "d.kowalski@calfire.example", organization: "cal-fire-huu", incidentPositionTitle: "Fire operations liaison" },
  { key: "nakamura", displayName: "P. Nakamura", email: "p.nakamura@fs.example", organization: "six-rivers-nf", incidentPositionTitle: "Forest Service liaison" },
  { key: "grant", displayName: "E. Grant", email: "e.grant@bia.example", organization: "bia-pacific", incidentPositionTitle: "BIA fire liaison" },
  { key: "ortega", displayName: "M. Ortega", email: "m.ortega@humboldt.example", organization: "humboldt-oes", incidentPositionTitle: "County liaison" },
  { key: "sato", displayName: "B. Sato", email: "b.sato@caltrans.example", organization: "caltrans-d1", incidentPositionTitle: "Caltrans liaison" },
  { key: "adams", displayName: "N. Adams", email: "n.adams@redcross.example", organization: "red-cross", incidentPositionTitle: "Shelter liaison" },
  { key: "iverson", displayName: "R. Iverson", email: "r.iverson@kimaw.example", organization: "kimaw-medical", incidentPositionTitle: "Medical liaison" },
];

/** The incident area: the confluence at Weitchpec, SR-169 to Pecwan, Bluff Creek and the north end of the Hoopa Valley. */
export const DEERHORN_AREA = {
  type: "Polygon" as const,
  coordinates: [[
    [-123.93, 41.37], [-123.80, 41.36], [-123.66, 41.33], [-123.575, 41.29], [-123.56, 41.22],
    [-123.59, 41.14], [-123.64, 41.09], [-123.70, 41.08], [-123.76, 41.11], [-123.83, 41.17],
    [-123.90, 41.24], [-123.95, 41.31], [-123.93, 41.37],
  ]],
};

/** The Deerhorn Fire's point of origin, as Basho gave it. */
export const DEERHORN_ORIGIN: [number, number] = [-123.693213, 41.175669];

/** The scenario clock: the most recent 15:10 in the scenario time zone. */
export function deerhornClock(now = new Date()): Date {
  return scenarioClock("15:10", now);
}

export async function seedDeerhorn(app: FastifyInstance, sql: Sql, clock = deerhornClock()): Promise<ScenarioRun> {
  const { at, iso, api, later, runInOrder, finish, jurisdictionId, organizations, people } = await startScenario(app, sql, clock, {
    owner: OWNER, partners: PARTNERS, people: DEERHORN_PEOPLE, admins: ["morgan"], password: DEERHORN_PASSWORD,
  });

  // Unified command stands up the evening of the lightning.
  const activation = await api<{ incidentId: string }>("morgan", at("21:05", -2), "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "wildfire_complex", name: "Deerhorn Lightning Complex", kind: "exercise" });
  const incidentId = activation.incidentId;

  const periods = [
    { label: "OP 01", startsAt: iso("21:00", -2), endsAt: iso("07:00", -1), at: at("21:20", -2) },
    { label: "OP 02", startsAt: iso("07:00", -1), endsAt: iso("19:00", -1), at: at("06:40", -1) },
    { label: "OP 03", startsAt: iso("19:00", -1), endsAt: iso("07:00"), at: at("18:40", -1) },
    { label: "OP 04", startsAt: iso("07:00"), endsAt: iso("19:00"), at: at("06:40") },
  ];
  let revision = 0;
  for (const period of periods) {
    const result = await api<{ revision: number }>("morgan", period.at, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: revision,
      geometry: DEERHORN_AREA,
      operationalPeriod: { label: period.label, startsAt: period.startsAt, endsAt: period.endsAt },
      reason: `${period.label} planning cycle for the Deerhorn Lightning Complex exercise`,
    });
    revision = result.revision;
  }

  const positions = await api<{ positions: { id: string; key: string }[] }>("morgan", at("21:10", -2), "GET",
    `/api/v1/jurisdictions/${jurisdictionId}/positions`);
  const position = (key: string) => {
    const found = positions.positions.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`the wildfire complex activation has no ${key} position`);
    return found.id;
  };
  const command = position("incident_commander");
  const operations = position("operations_section_chief");
  const logistics = position("logistics_section_chief");
  const information = position("public_information_officer");
  await api("morgan", at("21:11", -2), "POST", `/api/v1/positions/${command}/assignments`, { personId: people["morgan"]!.id });
  await api("morgan", at("21:12", -2), "POST", `/api/v1/positions/${operations}/assignments`, { personId: people["bennett"]!.id });
  await api("morgan", at("21:13", -2), "POST", `/api/v1/positions/${logistics}/assignments`, { personId: people["ellis"]!.id });
  await api("morgan", at("21:14", -2), "POST", `/api/v1/positions/${information}/assignments`, { personId: people["rowe"]!.id });
  await api("morgan", at("06:35"), "POST", `/api/v1/positions/${command}/sign-in`);

  // Yurok Tribe OES joins in unified command as a coordinator; the others contribute.
  const participants: Record<string, string> = {};
  const grantExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const [index, person] of DEERHORN_PEOPLE.filter((candidate) => candidate.incidentPositionTitle).entries()) {
    const grant = await api<{ participant: { id: string } }>("morgan", at(index === 0 ? "21:25" : "22:40", -2), "POST",
      `/api/v1/incidents/${incidentId}/participants`, {
        organizationSlug: person.organization,
        personEmail: person.email,
        incidentPositionTitle: person.incidentPositionTitle,
        role: person.key === "hayes" ? "coordinator" : "contributor",
        expiresAt: grantExpiry,
        reason: "Deerhorn Lightning Complex exercise participation",
      });
    participants[person.key] = grant.participant.id;
  }
  await grantDemoDirector(sql, api, "morgan", at("22:45", -2), incidentId);

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

  // Significant events across the three days.
  const events: ReadonlyArray<{ who: string; when: Date; summary: string; severity: string }> = [
    { who: "morgan", when: at("19:52", -2), summary: "Dry lightning: more than 60 strikes over the Klamath and Trinity confluence", severity: "warning" },
    { who: "warren", when: at("20:15", -2), summary: "Deerhorn Fire reported on the Hoopa and Yurok boundary south of Weitchpec", severity: "critical" },
    { who: "morgan", when: at("21:30", -2), summary: "Unified command established: Hoopa Valley Tribe and Yurok Tribe", severity: "normal" },
    { who: "kowalski", when: at("13:40", -1), summary: "Bluff Creek and Slate Creek fires merge north of Weitchpec", severity: "critical" },
    { who: "bennett", when: at("16:20", -1), summary: "SR-96 closed between Hoopa and Weitchpec", severity: "critical" },
    { who: "warren", when: at("12:55"), summary: "Deerhorn Fire spots across SR-96 below Weitchpec", severity: "critical" },
    { who: "hayes", when: at("13:25"), summary: "Yurok Tribe issues an evacuation order for Weitchpec; evacuees go north on SR-96 to Orleans", severity: "critical" },
    { who: "morgan", when: at("13:40"), summary: "Hoopa Valley Tribe issues an evacuation order for the north end of the Hoopa Valley", severity: "critical" },
    { who: "hayes", when: at("14:05"), summary: "SR-169 residents directed to the Pecwan temporary refuge area; the road out through Weitchpec is cut", severity: "critical" },
    { who: "kowalski", when: at("14:50"), summary: "Red flag warning extended through 20:00", severity: "warning" },
  ];
  for (const event of events) {
    later(event.when, () => record(event.who, event.when, "significant_events", {
      summary: event.summary, occurred_at: event.when.toISOString(), severity: event.severity,
    }));
  }

  // Shelters and the Pecwan temporary refuge area: 229 people in all by 14:30.
  // Each opens with `occupancy` and changes through the night and the afternoon's orders (`changes`).
  const shelterIds: Record<string, string> = {};
  const shelters: ReadonlyArray<{
    name: string; capacity: number; occupancy: number; pets: boolean; at: [number, number]; when: Date; who: string; planned?: boolean;
    changes?: ReadonlyArray<readonly [Date, Record<string, unknown>]>;
  }> = [
    { name: "Hoopa Valley Elementary School", capacity: 150, occupancy: 18, pets: true, at: [-123.67645, 41.05013], when: at("17:30", -1), who: "ellis",
      // Smoke got into the gym overnight until the room air cleaners arrived.
      changes: [[at("22:00", -1), { occupancy: 31 }], [at("02:30"), { status: "compromised" }], [at("09:10"), { status: "normal" }],
        [at("13:55"), { occupancy: 48 }], [at("14:20"), { occupancy: 64 }]] },
    { name: "Trinity Valley Elementary School, Willow Creek", capacity: 120, occupancy: 9, pets: false, at: [-123.63949, 40.94937], when: at("17:45", -1), who: "adams",
      changes: [[at("23:10", -1), { occupancy: 24 }], [at("14:22"), { occupancy: 38 }]] },
    { name: "Yurok Tribe Community Center, Klamath", capacity: 120, occupancy: 6, pets: true, at: [-124.03745, 41.52936], when: at("18:10", -1), who: "warren",
      changes: [[at("21:30", -1), { occupancy: 15 }], [at("09:00"), { occupancy: 22 }]] },
    { name: "Orleans Elementary School", capacity: 80, occupancy: 20, pets: true, at: [-123.54293, 41.30205], when: at("13:50"), who: "flores",
      changes: [[at("14:28"), { occupancy: 47 }]] },
    { name: "Pecwan temporary refuge area", capacity: 80, occupancy: 41, pets: true, at: [-123.8525, 41.3432], when: at("14:05"), who: "warren",
      changes: [[at("14:25"), { occupancy: 58, status: "compromised" }]] },
    { name: "Junction Elementary School, Somes Bar", capacity: 60, occupancy: 0, pets: false, at: [-123.49645, 41.39235], when: at("14:15"), who: "flores", planned: true },
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

  // Facilities: command, air operations, staging, camp, medical, cameras and weather.
  const facilities: ReadonlyArray<{ name: string; kind: string; at: [number, number]; status?: string; stream?: string; notes?: string }> = [
    { name: "Incident Command Post, Hoopa", kind: "incident_command_post", at: [-123.67, 41.048] },
    { name: "Hoopa Valley Tribe EOC", kind: "key_facility", at: [-123.6857, 41.064] },
    { name: "Yurok Tribe EOC, Klamath", kind: "key_facility", at: [-124.03765, 41.52932] },
    { name: "Hoopa Airport helibase", kind: "helibase", at: [-123.6686, 41.0427] },
    { name: "Orleans helispot", kind: "helispot", at: [-123.5405, 41.2965] },
    { name: "Willow Creek staging area", kind: "staging_area", at: [-123.627, 40.944] },
    { name: "Orleans staging area", kind: "staging_area", at: [-123.545, 41.304] },
    { name: "Deerhorn Complex base camp, Willow Creek", kind: "base", at: [-123.616, 40.937] },
    { name: "K'ima:w Medical Center", kind: "hospital", at: [-123.6795, 41.0602], status: "compromised", notes: "Clean air room open; smoke in the valley" },
    { name: "Mad River Community Hospital", kind: "hospital", at: [-124.0918, 40.8993] },
    { name: "Large animal evacuation site, Willow Creek", kind: "key_facility", at: [-123.61828, 40.94458] },
    { name: "Weitchpec ridge camera", kind: "camera", at: [-123.72, 41.16], status: "compromised", stream: "rtsp://cameras.exercise.invalid/weitchpec-ridge", notes: "Intermittent since the fiber burned" },
    { name: "Hoopa valley camera", kind: "camera", at: [-123.65, 41.075], stream: "rtsp://cameras.exercise.invalid/hoopa-valley" },
    { name: "Hoopa weather station", kind: "weather_station", at: [-123.674, 41.045] },
    { name: "Orleans weather station", kind: "weather_station", at: [-123.538, 41.3] },
  ];
  for (const [index, facility] of facilities.entries()) {
    const when = at(`22:${String(10 + index * 2).padStart(2, "0")}`, -2);
    later(when, () => record("bennett", when, "incident_facilities", {
      name: facility.name, kind: facility.kind, status: facility.status ?? "normal",
      location: { type: "Point", coordinates: facility.at },
      ...(facility.stream ? { stream_url: facility.stream } : {}),
      ...(facility.notes ? { notes: facility.notes } : {}),
    }));
  }

  // Road closures, each drawn along its road (tools/demo-geometry).
  const closures: ReadonlyArray<{ road: keyof typeof DEERHORN_CLOSURES; reason: string; status: string; when: Date }> = [
    { road: "SR-96 between Hoopa and Weitchpec", reason: "Fire burning on both sides of the highway", status: "closed", when: at("16:20", -1) },
    { road: "Bald Hills Road", reason: "Fire crossing the road east of the summit", status: "closed", when: at("09:10", -1) },
    { road: "Bluff Creek Road", reason: "Merged fire front; no access", status: "closed", when: at("13:45", -1) },
    { road: "SR-169 at Weitchpec", reason: "Spot fire at the junction; the only road out for Pecwan and Wautec", status: "closed", when: at("13:05") },
    { road: "SR-96 from Weitchpec to Orleans", reason: "Evacuation traffic northbound only, pilot car", status: "one_lane", when: at("13:30") },
  ];
  for (const closure of closures) {
    later(closure.when, () => record("sato", closure.when, "road_closures", {
      road: closure.road, reason: closure.reason, status: closure.status,
      location: DEERHORN_CLOSURES[closure.road],
    }));
  }

  // Field reports from both tribes' crews and the fire agencies: 36 in all.
  const fieldReports: ReadonlyArray<readonly [string, string, number, number, string, string, number?]> = [
    ["Lightning start on the ridge south of Weitchpec", "hazard", -123.6932, 41.1757, "warren", "20:10", -2],
    ["Second start above Bluff Creek", "hazard", -123.665, 41.245, "warren", "20:25", -2],
    ["Smoke showing near Slate Creek", "hazard", -123.6495, 41.258, "nakamura", "20:40", -2],
    ["Start reported on the slope above Pecwan", "hazard", -123.835, 41.325, "warren", "21:05", -2],
    ["Small start near Bald Hills Road", "hazard", -123.79, 41.215, "grant", "21:30", -2],
    ["Engine crew staged at Weitchpec store", "resource", -123.7084, 41.1882, "kowalski", "22:15", -2],
    ["Power line down across SR-96 near Deerhorn", "hazard", -123.694, 41.172, "bennett", "07:20", -1],
    ["Fire backing down toward the Trinity River", "hazard", -123.688, 41.16, "bennett", "08:05", -1],
    ["Livestock need moving at Tish Tang", "resource", -123.6443, 41.0227, "rowe", "08:40", -1],
    ["Downed trees across Bald Hills Road", "hazard", -123.82, 41.245, "warren", "09:05", -1],
    ["Elder on oxygen needs transport from Pecwan", "resource", -123.854, 41.344, "warren", "09:30", -1],
    ["Weitchpec community water tank at half", "resource", -123.7, 41.19, "warren", "10:10", -1],
    ["Heavy smoke at Hoopa Valley Elementary School", "hazard", -123.6765, 41.0501, "rowe", "10:45", -1],
    ["Bluff Creek and Slate Creek fire fronts joining", "hazard", -123.657, 41.25, "nakamura", "13:35", -1],
    ["Structure threatened on Bluff Creek Road", "damage", -123.664, 41.24, "kowalski", "14:20", -1],
    ["Fiber cable burned on the SR-96 pole line", "damage", -123.69, 41.165, "bennett", "15:30", -1],
    ["Traffic backed up at the Hoopa bridge", "hazard", -123.678, 41.07, "rowe", "16:40", -1],
    ["Residents declining to leave on Bluff Creek Road", "other", -123.662, 41.255, "warren", "17:15", -1],
    ["Outbuilding lost near Deerhorn", "damage", -123.696, 41.179, "bennett", "18:50", -1],
    ["Pecwan store generator low on fuel", "resource", -123.853, 41.3435, "warren", "21:20", -1],
    ["Fire slowed overnight on the Pecwan slope", "other", -123.838, 41.328, "grant", "05:40"],
    ["Cultural monitor needed at the new dozer line", "resource", -123.705, 41.16, "kowalski", "07:45"],
    ["Air quality hazardous in Hoopa this morning", "hazard", -123.6857, 41.064, "iverson", "08:20"],
    ["Dialysis patients need transport to Arcata", "resource", -123.6795, 41.0602, "iverson", "08:55"],
    ["Wind shifting to the northeast at Weitchpec", "hazard", -123.7084, 41.1882, "warren", "11:30"],
    ["Spot fire across SR-96 below Weitchpec", "hazard", -123.7, 41.182, "warren", "12:50"],
    ["Weitchpec residents loading vehicles", "other", -123.709, 41.189, "warren", "13:20"],
    ["Evacuation traffic heavy northbound toward Orleans", "hazard", -123.62, 41.27, "sato", "13:45"],
    ["Pecwan families arriving at the refuge area", "other", -123.8525, 41.3432, "warren", "14:00"],
    ["Satellite terminal needed at the refuge area", "resource", -123.852, 41.343, "warren", "14:10"],
    ["Orleans shelter needs cots and blankets", "resource", -123.5429, 41.302, "flores", "14:20"],
    ["Propane tank venting at a burned structure", "hazard", -123.697, 41.18, "kowalski", "14:30"],
    ["Horse trailer stuck on the Orleans road", "other", -123.61, 41.275, "sato", "14:40"],
    ["Ember cast onto the Weitchpec school grounds", "hazard", -123.6967, 41.1897, "warren", "14:52"],
    ["Hoopa shelter asking for more room air cleaners", "resource", -123.6765, 41.0501, "ellis", "14:58"],
    ["Smoke column building over Bluff Creek", "hazard", -123.66, 41.25, "nakamura", "15:05"],
  ];
  // The Planning function verifies each report about 15 minutes after it
  // arrives; the latest seven are still unverified at 15:10.
  const verifiedReports = fieldReports.length - 7;
  for (const [index, [summary, category, lon, lat, who, hhmm, days = 0]] of fieldReports.entries()) {
    const when = at(hhmm, days);
    let reportId = "";
    later(when, async () => {
      reportId = (await record(who, when, "field_reports", {
        summary, category, location: { type: "Point", coordinates: [lon, lat] },
      })).id;
    });
    if (index < verifiedReports) {
      const verifiedAt = new Date(when.getTime() + 15 * 60 * 1000);
      later(verifiedAt, () => update("morgan", verifiedAt, "field_reports", reportId, { verified: true }));
    }
  }

  // Resource requests: 22 in all. Hoopa's sections submit most; a partner may
  // submit to the owner too. The owner accepts, sources and assigns.
  type RequestState = "submitted" | "accepted" | "sourcing" | "assigned" | "deployed";
  const requests: ReadonlyArray<{ item: string; notes: string; priority: string; state: RequestState; neededBy: string; days?: number; quantity?: number; owner?: string; who: string; at: [string, number?] }> = [
    { item: "Type 3 engines for structure protection at Weitchpec", notes: "Four engines with crews", priority: "immediate", state: "deployed", neededBy: "19:00", quantity: 4, owner: "kowalski", who: "bennett", at: ["21:50", -2] },
    { item: "Water tenders for the Deerhorn Fire", notes: "Two tenders drafting from the Trinity", priority: "immediate", state: "deployed", neededBy: "19:00", quantity: 2, owner: "kowalski", who: "bennett", at: ["22:05", -2] },
    { item: "Hand crew for the Bluff Creek fire", notes: "Forest Service crew", priority: "immediate", state: "deployed", neededBy: "19:00", owner: "nakamura", who: "bennett", at: ["06:30", -1] },
    { item: "Tribal fire crew for the Pecwan fire", notes: "BIA-funded crew with a squad boss", priority: "priority", state: "deployed", neededBy: "19:00", owner: "grant", who: "warren", at: ["07:10", -1] },
    { item: "Buses for elders leaving Weitchpec", notes: "Two buses with wheelchair lifts", priority: "immediate", state: "deployed", neededBy: "17:00", quantity: 2, owner: "operations", who: "ellis", at: ["08:40", -1] },
    { item: "Livestock trailers for Tish Tang", notes: "Six trailers with drivers", priority: "priority", state: "assigned", neededBy: "16:00", quantity: 6, owner: "operations", who: "rowe", at: ["08:50", -1] },
    { item: "Room air cleaners for the clean air room", notes: "60 units for K'ima:w and the Hoopa shelter", priority: "priority", state: "assigned", neededBy: "16:00", quantity: 60, owner: "iverson", who: "ellis", at: ["10:55", -1] },
    { item: "N95 respirators for residents", notes: "2,000 fitted masks with instructions", priority: "priority", state: "deployed", neededBy: "18:00", quantity: 2000, owner: "iverson", who: "ellis", at: ["11:05", -1] },
    { item: "Traffic control at the Hoopa bridge", notes: "Flaggers and message boards", priority: "priority", state: "deployed", neededBy: "19:00", owner: "sato", who: "bennett", at: ["16:50", -1] },
    { item: "Generator for the Weitchpec community water system", notes: "60 kW with fuel", priority: "immediate", state: "assigned", neededBy: "18:00", owner: "operations", who: "warren", at: ["10:20", -1] },
    { item: "Fuel for tribal fire crews", notes: "Diesel and gasoline to the Hoopa yard", priority: "priority", state: "accepted", neededBy: "18:00", who: "ellis", at: ["19:30", -1] },
    { item: "Cots and blankets for the Orleans shelter", notes: "60 cots, 120 blankets", priority: "priority", state: "assigned", neededBy: "17:00", quantity: 60, owner: "adams", who: "flores", at: ["14:22"] },
    { item: "Satellite terminals for Weitchpec and Pecwan", notes: "Six terminals with power", priority: "immediate", state: "sourcing", neededBy: "17:00", quantity: 6, who: "warren", at: ["14:12"] },
    { item: "Potable water for the Pecwan refuge area", notes: "Bottled water for 80 people for two days", priority: "immediate", state: "sourcing", neededBy: "17:00", who: "warren", at: ["14:15"] },
    { item: "Generator for the Pecwan refuge area", notes: "20 kW with fuel", priority: "immediate", state: "accepted", neededBy: "18:00", who: "warren", at: ["14:18"] },
    { item: "River evacuation boats on standby for Pecwan", notes: "Two jet boats with operators at the Pecwan landing", priority: "priority", state: "submitted", neededBy: "19:00", who: "hayes", at: ["14:30"] },
    { item: "Cultural resource monitors for dozer lines", notes: "Four monitors, two from each tribe", priority: "priority", state: "assigned", neededBy: "16:00", quantity: 4, owner: "hayes", who: "bennett", at: ["07:50"] },
    { item: "Dialysis transport from Hoopa to Arcata", notes: "Three patients, wheelchair van", priority: "priority", state: "assigned", neededBy: "13:00", owner: "iverson", who: "rowe", at: ["09:00"] },
    { item: "Oxygen concentrators for evacuated elders", notes: "Ten units for the Orleans and Hoopa shelters", priority: "priority", state: "sourcing", neededBy: "18:00", quantity: 10, who: "ellis", at: ["14:35"] },
    { item: "Portable toilets for the base camp", notes: "Twelve units with service", priority: "routine", state: "accepted", neededBy: "20:00", quantity: 12, who: "ellis", at: ["10:00"] },
    { item: "Meals for Orleans shelter residents", notes: "Three meals a day for 60 people", priority: "priority", state: "submitted", neededBy: "18:00", who: "flores", at: ["14:45"] },
    { item: "Mental health counselors for the shelters", notes: "Two counselors for Hoopa and Orleans", priority: "routine", state: "submitted", neededBy: "12:00", days: 1, who: "iverson", at: ["15:00"] },
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
      const move = (toState: string) => api("ellis", when, "POST", `/api/v1/resource-requests/${created.id}/transition`, { toState });
      for (const state of order.slice(1, Math.min(reach, 2) + 1)) await move(state);
      if (reach >= 3) {
        // Assigning across organizations takes the owner's incident authority.
        if (request.owner === "operations") {
          await api("morgan", when, "POST", `/api/v1/resource-requests/${created.id}/assign`, { kind: "position", positionId: operations });
        } else if (request.owner) {
          await api("morgan", when, "POST", `/api/v1/resource-requests/${created.id}/assign`,
            { kind: "incident_participant", incidentId, participantId: participants[request.owner] });
        } else {
          await move("assigned");
        }
      }
      if (reach >= 4) await move("deployed");
    });
  }

  // The checklist: the activation's tasks, mostly done the first night, and the ones command adds since.
  // Planning has no chief yet, so its tasks wait.
  const toParticipant = (key: string) => ({ kind: "incident_participant" as const, incidentId, participantId: participants[key]! });
  const toPosition = (positionId: string) => ({ kind: "position" as const, positionId });
  seedChecklist({ api, later }, "morgan", incidentId, at("21:30", -2), [
    { item: "Assume command and announce on the significant events board", category: "command", due: at("21:30", -2) },
    { item: "Confirm unified command with every jurisdiction the fires touch", category: "command", due: at("22:00", -2) },
    { item: "Set initial incident objectives", category: "command", due: at("23:00", -2) },
    { item: "Establish the operational period", category: "command", due: at("22:00", -2) },
    { item: "Confirm resource status with dispatch for each fire", category: "operations", due: at("06:00", -1) },
    { item: "Open the resource request board", category: "operations", due: at("22:00", -2) },
    { item: "Track each start and its perimeter", category: "planning", due: at("19:00"), inProgress: true },
    { item: "Prepare the next operational period briefing", category: "planning", due: at("14:00") },
    { item: "Draft the initial public statement", category: "public_information", due: at("23:00", -2) },
    { item: "Agree release approval with every agency in command", category: "public_information", due: at("12:00"), inProgress: true },
    { item: "Open the clean air room at K'ima:w", category: "operations", due: at("14:00", -1), added: at("10:50", -1), holder: toParticipant("iverson") },
    { item: "Hand out fitted N95 respirators at the Hoopa shelter", category: "logistics", due: at("18:00", -1), added: at("11:10", -1), holder: toParticipant("iverson") },
    { item: "Survey cultural sites ahead of the Bluff Creek dozer line", category: "cultural_resources", due: at("12:00", -1), added: at("07:55", -1), holder: toParticipant("lowe") },
    { item: "Keep cultural site locations off the shared dozer line maps", category: "cultural_resources", due: at("08:00"), added: at("12:10", -1), holder: toParticipant("lowe"), inProgress: true },
    { item: "Stage livestock trailers at Tish Tang", category: "logistics", due: at("16:00", -1), added: at("08:55", -1), holder: toPosition(logistics), inProgress: true },
    { item: "Confirm Orleans can take Weitchpec evacuees", category: "operations", due: at("13:45"), added: at("13:28"), holder: toParticipant("flores") },
    { item: "Post the evacuation orders on tribal radio and social media", category: "public_information", due: at("14:00"), added: at("13:30"), holder: toPosition(information) },
    { item: "Run a pilot car schedule on SR-96 north of Weitchpec", category: "operations", due: at("18:00"), added: at("14:40"), holder: toParticipant("sato") },
    { item: "Confirm every Weitchpec household is accounted for", category: "operations", due: at("16:00"), added: at("14:32"), holder: toParticipant("hayes") },
    { item: "Brief both tribal councils on the evacuation orders", category: "command", due: at("17:00"), added: at("14:33"), holder: toPosition(command) },
    { item: "Plan resupply of the Pecwan refuge area by river or air", category: "logistics", due: at("18:00"), added: at("14:34"), holder: toParticipant("hayes") },
    { item: "Schedule cultural monitors for tomorrow's dozer work", category: "cultural_resources", due: at("08:00", 1), added: at("14:35"), holder: toParticipant("lowe") },
  ], [
    { who: "bennett", at: at("21:45", -2), position: operations,
      items: ["Confirm resource status with dispatch for each fire", "Open the resource request board"] },
    { who: "morgan", at: at("22:10", -2),
      items: ["Assume command and announce on the significant events board", "Confirm unified command with every jurisdiction the fires touch",
        "Set initial incident objectives", "Establish the operational period"] },
    { who: "rowe", at: at("22:30", -2), position: information, items: ["Draft the initial public statement"] },
    { who: "lowe", at: at("11:40", -1), items: ["Survey cultural sites ahead of the Bluff Creek dozer line"] },
    { who: "iverson", at: at("13:20", -1), items: ["Open the clean air room at K'ima:w"] },
    { who: "iverson", at: at("16:30", -1), items: ["Hand out fitted N95 respirators at the Hoopa shelter"] },
    { who: "flores", at: at("13:48"), items: ["Confirm Orleans can take Weitchpec evacuees"] },
    { who: "rowe", at: at("13:55"), position: information, items: ["Post the evacuation orders on tribal radio and social media"] },
  ]);

  // Humboldt County's liaison notes what the county should fix, on Humboldt's own improvement plan.
  const day = (days: number) => zoned(at("12:00", days)).date;
  const humboldt: ReadonlyArray<readonly [string, string, string, string, string, Date, ("in_progress" | "complete")?]> = [
    ["critical_transportation", "organization", "Name a county contact for SR-96 traffic control when the tribes close the highway", "medium", day(-1), at("17:00", -1), "in_progress"],
    ["operational_communications", "equipment", "Give the county liaison a radio on the tribal fire net", "low", day(0), at("07:20"), "complete"],
    ["public_information_and_warning", "planning", "Agree one evacuation map with both tribes before fire season, so county warnings match tribal orders", "high", day(60), at("14:10")],
  ];
  for (const [capability, capabilityElement, recommendation, priority, dueDate, when, status] of humboldt) {
    later(when, async () => {
      const action = await api<{ id: string }>("ortega", when, "POST", `/api/v1/jurisdictions/${organizations["humboldt-oes"]!}/corrective-actions`, {
        incidentId, capability, capabilityElement, recommendation, priority, dueDate, ownerPerson: people["ortega"]!.id,
      });
      if (status) await api("ortega", when, "POST", `/api/v1/corrective-actions/${action.id}/status`, { status });
    });
  }

  // Lifeline assessments. OP 03's stand as history under OP 04's.
  const assessments: Record<string, string> = {};
  const lifeline = (who: string, hhmm: string, days: number, input: Record<string, unknown>) =>
    later(at(hhmm, days), async () => {
      const key = input.lifeline as string;
      const prior = assessments[key];
      const created = await api<{ id: string }>(who, at(hhmm, days), "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
        definitionVersion: 1, assessedAt: iso(hhmm, days), operationalPeriod: "OP 04", confidence: "confirmed",
        components: [], evidence: [], responsibleOrganizationIds: [], actions: [],
        ...(prior ? { supersedesAssessmentId: prior } : {}), ...input,
      });
      assessments[key] = created.id;
    });
  lifeline("sato", "20:10", -1, {
    lifeline: "transportation", condition: "unstable", operationalPeriod: "OP 03",
    impactStatement: "SR-96 closed between Hoopa and Weitchpec. Bald Hills Road and Bluff Creek Road closed.",
    nextUpdateAt: iso("07:00"),
  });
  lifeline("bennett", "20:30", -1, {
    lifeline: "energy", condition: "stabilizing", operationalPeriod: "OP 03",
    impactStatement: "The line to Weitchpec is de-energized for firefighting. Hoopa has power.",
    nextUpdateAt: iso("07:00"),
  });
  lifeline("bennett", "21:00", -1, {
    lifeline: "communications", condition: "stabilizing", operationalPeriod: "OP 03",
    impactStatement: "Fiber on the SR-96 pole line burned. Cellular carries traffic in Hoopa.",
    nextUpdateAt: iso("07:00"),
  });
  lifeline("kowalski", "13:30", 0, {
    lifeline: "hazardous_materials", condition: "unknown", confidence: "unknown",
    impactStatement: "Propane tanks at burned structures near Deerhorn have not been surveyed.",
    // Due before the scenario clock, so the update reads as overdue.
    nextUpdateAt: iso("14:30"),
  });
  lifeline("hayes", "14:10", 0, {
    lifeline: "safety_security", condition: "unstable",
    impactStatement: "Evacuation orders in effect on both reservations and on fee lands along SR-96. Tribal police are holding the Weitchpec junction.",
    stabilizationObjective: "Every household in the order areas accounted for.",
    nextUpdateAt: iso("16:00"),
    components: [{ key: "evacuation", label: "Evacuation", condition: "unstable", affectedGeography: "Weitchpec and SR-169", causes: ["Spot fire across SR-96"] }],
    responsibleOrganizationIds: [organizations["yurok-oes"], jurisdictionId],
  });
  lifeline("warren", "14:15", 0, {
    lifeline: "water_systems", condition: "stabilizing",
    impactStatement: "Weitchpec community water on generator power. Firefighting draw is lowering the tank.",
    stabilizationObjective: "Keep the Weitchpec system pressurized for residents who stay and for engines.",
    nextUpdateAt: iso("17:00"),
    components: [{ key: "community_water", label: "Community water system", condition: "stabilizing", affectedGeography: "Weitchpec", dependencies: ["Generator fuel"] }],
  });
  lifeline("sato", "14:20", 0, {
    lifeline: "transportation", condition: "unstable",
    impactStatement: "SR-96 closed from Hoopa to Weitchpec and SR-169 closed at Weitchpec. SR-96 north to Orleans is one lane with a pilot car.",
    stabilizationObjective: "Keep one evacuation route open north to Orleans.",
    nextUpdateAt: iso("16:30"),
    components: [
      { key: "highways", label: "Highways", condition: "unstable", affectedGeography: "SR-96 and SR-169", causes: ["Fire on both sides of the road"] },
      { key: "evacuation_route", label: "Evacuation route north", condition: "stabilizing", affectedGeography: "SR-96 to Orleans", dependencies: ["Pilot car and traffic control"] },
    ],
  });
  lifeline("adams", "14:30", 0, {
    lifeline: "food_hydration_shelter", condition: "stabilizing",
    impactStatement: "Five sites hold 229 people: shelters in Hoopa, Willow Creek, Klamath and Orleans, and 58 at the Pecwan temporary refuge area.",
    stabilizationObjective: "Shelter and feed every evacuee; resupply Pecwan until the road opens.",
    nextUpdateAt: iso("18:00"),
    components: [{ key: "refuge", label: "Pecwan temporary refuge area", condition: "unstable", affectedGeography: "Pecwan", dependencies: ["Water, a generator and a satellite link"] }],
  });
  lifeline("iverson", "14:35", 0, {
    lifeline: "health_medical", condition: "unstable",
    impactStatement: "Smoke is at hazardous levels in the Hoopa Valley. K'ima:w Medical Center runs a clean air room; three dialysis patients need transport to Arcata.",
    stabilizationObjective: "Protect people with heart and lung conditions from smoke; keep dialysis on schedule.",
    nextUpdateAt: iso("17:00"),
    components: [{ key: "clinic", label: "Clinic and clean air", condition: "unstable", affectedGeography: "Hoopa", causes: ["Smoke"], dependencies: ["Room air cleaners"] }],
  });
  lifeline("bennett", "14:40", 0, {
    lifeline: "energy", condition: "unstable",
    impactStatement: "Weitchpec and Pecwan are without grid power. The refuge area and the water system run on generators.",
    stabilizationObjective: "Keep generators fueled at the refuge area and the water system.",
    nextUpdateAt: iso("17:00"),
  });
  lifeline("warren", "14:45", 0, {
    lifeline: "communications", condition: "unstable",
    impactStatement: "Weitchpec and Pecwan have no landline or internet since the fiber burned. Radio and one satellite phone reach the refuge area.",
    stabilizationObjective: "A satellite link at Weitchpec and at the refuge area.",
    nextUpdateAt: iso("16:30"),
  });

  // California ESF coordination.
  const esf = (who: string, hhmm: string, input: Record<string, unknown>) =>
    later(at(hhmm), () => api(who, at(hhmm), "POST", `/api/v1/incidents/${incidentId}/esf-assessments`, {
      activation: "activated", capacity: "constrained", assessedAt: iso(hhmm), confidence: "confirmed",
      operationalPeriod: "OP 04", supportingOrganizationIds: [], priorities: [], evidence: [], actions: [], ...input,
    }));
  esf("kowalski", "14:48", {
    identity: { framework: "california", esf: "ca_esf_4", definitionVersion: 1 },
    situation: "Structure protection at Weitchpec and north Hoopa; the Forest Service holds the Bluff Creek front.",
    coordinatorOrganizationId: organizations["cal-fire-huu"],
    supportingOrganizationIds: [organizations["six-rivers-nf"], organizations["bia-pacific"]],
    missions: ["Hold the Deerhorn Fire south of Weitchpec", "Protect structures on Bluff Creek Road", "Keep SR-96 north open for evacuation"],
    relatedLifelines: ["safety_security", "transportation"],
  });
  esf("hayes", "14:12", {
    identity: { framework: "california", esf: "ca_esf_16", definitionVersion: 1 },
    situation: "Each tribe evacuates its own lands under its own orders; the county covers fee lands along SR-96.",
    coordinatorOrganizationId: organizations["yurok-oes"],
    supportingOrganizationIds: [jurisdictionId, organizations["humboldt-oes"]],
    missions: ["Clear Weitchpec north to Orleans", "Hold SR-169 residents at the Pecwan refuge area", "Evacuate the north end of the Hoopa Valley south"],
    relatedLifelines: ["safety_security", "transportation"],
  });
  esf("adams", "14:32", {
    identity: { framework: "california", esf: "ca_esf_6", definitionVersion: 1 },
    capacity: "adequate",
    situation: "Red Cross supports the tribal and school shelters; the Karuk Tribe hosts evacuees in Orleans.",
    coordinatorOrganizationId: organizations["red-cross"],
    supportingOrganizationIds: [organizations["karuk-tribe"]],
    missions: ["Open a second room at the Orleans shelter", "Resupply the Pecwan refuge area"],
    relatedLifelines: ["food_hydration_shelter"],
  });

  // Exercise alerts, each issued by its own government under its own authority.
  const alert = (who: string, hhmm: string, jurisdiction: string, input: { event: string; headline: string; description: string; instruction: string; area: string; response: string; urgency: string; severity: string; certainty: string }, withIncident: boolean) =>
    later(at(hhmm), async () => {
      const draft = await api<{ id: string }>(who, at(hhmm), "POST", `/api/v1/jurisdictions/${jurisdiction}/cap/drafts`, {
        ...(withIncident ? { incidentId } : {}),
        alert: {
          sender: `${who}@exercise.invalid`, status: "Exercise", msgType: "Alert", scope: "Public",
          note: "Exercise content only. Nothing was transmitted.",
          info: [{
            category: ["Fire"], event: input.event, responseType: [input.response],
            urgency: input.urgency, severity: input.severity, certainty: input.certainty,
            headline: input.headline, description: input.description, instruction: input.instruction,
            area: [{ areaDesc: input.area }],
          }],
        },
      });
      await api(who, at(hhmm), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "in_review" });
      return draft;
    });
  alert("hayes", "13:22", organizations["yurok-oes"]!, {
    event: "Evacuation Order", headline: "EXERCISE: Yurok Tribe evacuation order for Weitchpec",
    description: "The Deerhorn Fire has crossed SR-96 below Weitchpec.",
    instruction: "Leave now. Go north on SR-96 to Orleans. Do not drive south toward Hoopa.",
    area: "Weitchpec, Yurok Reservation", response: "Evacuate", urgency: "Immediate", severity: "Extreme", certainty: "Observed",
  }, false);
  alert("hayes", "14:03", organizations["yurok-oes"]!, {
    event: "Shelter in Place", headline: "EXERCISE: SR-169 residents go to the Pecwan temporary refuge area",
    description: "SR-169 is closed at Weitchpec by fire. The road out is cut.",
    instruction: "Go to the Pecwan temporary refuge area and stay there until told the road is open.",
    area: "SR-169 from Weitchpec to Wautec, Yurok Reservation", response: "Shelter", urgency: "Immediate", severity: "Extreme", certainty: "Observed",
  }, false);
  later(at("13:38"), async () => {
    const draft = await api<{ id: string }>("rowe", at("13:38"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/cap/drafts`, {
      incidentId,
      alert: {
        sender: "rowe@exercise.invalid", status: "Exercise", msgType: "Alert", scope: "Public",
        note: "Exercise content only. Nothing was transmitted.",
        info: [{
          category: ["Fire"], event: "Evacuation Order", responseType: ["Evacuate"],
          urgency: "Immediate", severity: "Extreme", certainty: "Observed",
          headline: "EXERCISE: Hoopa Valley Tribe evacuation order for the north end of the Hoopa Valley",
          description: "The Deerhorn Fire is moving south along the Trinity River toward the valley.",
          instruction: "Leave now. Go south through Hoopa toward Willow Creek. The Hoopa shelter is open.",
          area: [{ areaDesc: "North end of the Hoopa Valley, Hoopa Valley Reservation" }],
        }],
      },
    });
    await api("rowe", at("13:39"), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "in_review" });
    await api("morgan", at("13:40"), "POST", `/api/v1/cap/alerts/${draft.id}/review`, { state: "approved" });
  });
  alert("ortega", "13:55", organizations["humboldt-oes"]!, {
    event: "Evacuation Warning", headline: "EXERCISE: Humboldt County evacuation warning along SR-96 north of Weitchpec",
    description: "Fee lands along SR-96 between Weitchpec and Orleans may need to evacuate.",
    instruction: "Be ready to leave. Evacuation traffic is northbound only with a pilot car.",
    area: "SR-96 corridor from Weitchpec to Orleans, fee lands", response: "Prepare", urgency: "Expected", severity: "Severe", certainty: "Likely",
  }, false);

  // The joint release: both tribes and CAL FIRE must approve. Hoopa has approved.
  later(at("14:55"), async () => {
    const release = await api<{ id: string }>("rowe", at("14:55"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
      title: "EXERCISE: Deerhorn Lightning Complex update, day 3 afternoon",
      body: "Exercise draft. The Deerhorn Fire crossed SR-96 below Weitchpec this afternoon. The Yurok Tribe has ordered Weitchpec to evacuate north to Orleans, and SR-169 residents are at the Pecwan temporary refuge area. The Hoopa Valley Tribe has ordered the north end of the Hoopa Valley to evacuate south. Shelters are open in Hoopa, Willow Creek, Klamath and Orleans.",
      requiredAgencies: ["Hoopa Valley Tribe", "Yurok Tribe", "CAL FIRE"],
      incidentId,
    });
    await api("rowe", at("14:56"), "POST", `/api/v1/jic/releases/${release.id}/submit`);
    await api("morgan", at("15:02"), "POST", `/api/v1/jic/releases/${release.id}/decisions`, {
      agency: "Hoopa Valley Tribe", decision: "approve", note: "Approved for the Hoopa Valley Tribe.",
    });
  });

  // Unified command's incident-wide thread.
  let threadId = "";
  later(at("21:35", -2), async () => {
    threadId = (await api<{ id: string }>("morgan", at("21:35", -2), "POST", `/api/v1/jurisdictions/${jurisdictionId}/threads`, {
      kind: "group", title: "Unified command", incidentId, audience: "incident",
    })).id;
  });
  const messages: ReadonlyArray<[string, string, string, number]> = [
    ["hayes", "Yurok OES in unified command. We will issue orders for Yurok lands; Hoopa for Hoopa lands.", "21:40", -2],
    ["kowalski", "CAL FIRE has four engines at Weitchpec and two tenders on the Trinity.", "07:30", -1],
    ["hayes", "Weitchpec order going out now. Evacuees north to Orleans; Karuk Tribe is ready to receive them.", "13:24", 0],
    ["morgan", "Hoopa order for the north valley in ten minutes. Release draft to follow for all three of us.", "13:30", 0],
    ["flores", "Orleans school gym open. Room for 80.", "13:52", 0],
    ["hayes", "Pecwan refuge area is holding 58. We need water and a satellite link there before dark.", "14:26", 0],
  ];
  for (const [who, body, hhmm, days] of messages) {
    later(at(hhmm, days), () => api(who, at(hhmm, days), "POST", `/api/v1/threads/${threadId}/messages`, { body }));
  }

  // Cultural resource information stays with the tribes: a Hoopa board outside
  // the incident, read by the Yurok cultural liaison under a guest grant, and a
  // thread for the two liaisons and the Hoopa director. No site locations are recorded.
  later(at("07:40"), async () => {
    const board = await api<{ id: string }>("morgan", at("07:40"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, {
      templateKey: "activity_log", title: "Cultural resources: Hoopa and Yurok only",
    });
    await api("morgan", at("07:41"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/guests`, {
      personId: people["lowe"]!.id, scopes: [`board:${board.id}:read`], expiresAt: grantExpiry,
    });
    for (const [entry, hhmm] of [
      ["A monitor from each tribe walks every new dozer line before the blade goes in. Site details stay with the Tribal Historic Preservation Officers.", "07:42"],
      ["Two places above Deerhorn Creek are to be avoided by equipment. Locations are held by the preservation officers, not recorded here.", "08:05"],
      ["Fire crews briefed at the 07:00 briefing on the avoidance areas without locations.", "08:30"],
    ] as const) {
      await api("quinn", at(hhmm), "POST", `/api/v1/boards/${board.id}/records`, { entry, notable: true });
    }
    // The admin opens it: a guest's grant is visible to the jurisdiction's administrators.
    const thread = await api<{ id: string }>("morgan", at("08:10"), "POST", `/api/v1/jurisdictions/${jurisdictionId}/threads`, {
      kind: "group", title: "Cultural resources",
      members: [{ kind: "person", id: people["quinn"]!.id }, { kind: "person", id: people["lowe"]!.id }],
    });
    await api("quinn", at("08:12"), "POST", `/api/v1/threads/${thread.id}/messages`, { body: "Monitors are scheduled with the dozer group for 09:00." });
  });

  // The exercise map layers: synthetic, drawn from the basemap's terrain, rivers, roads and
  // tribal lands, never official perimeters or zones.
  later(at("14:58"), async () => {
    const pack = await api<{ pack: { id: string } }>("morgan", at("14:58"), "POST", `/api/v1/incidents/${incidentId}/data-packs`, {
      name: "SYNTHETIC Deerhorn Lightning Complex exercise layers",
      organizationSlug: OWNER.slug,
      description: "Exercise-only synthetic geometry drawn from the basemap's terrain, rivers, roads and tribal lands. Not official fire perimeters or evacuation zones.",
      // Freshness is judged against the real clock and the scenario clock can be a day
      // behind it, so the layers stay current for two days after seeding.
      datasets: [
        { key: "fire_perimeters", name: "SYNTHETIC fire perimeters", kind: "geojson", fieldMapping: MAPPING, coverage: DEERHORN_AREA, staleAfterSeconds: 172800 },
        { key: "spot_fires", name: "SYNTHETIC spot fires", kind: "geojson", fieldMapping: MAPPING, coverage: DEERHORN_AREA, staleAfterSeconds: 172800 },
        { key: "evacuation_areas", name: "SYNTHETIC evacuation areas by issuing government", kind: "geojson", fieldMapping: MAPPING, coverage: DEERHORN_AREA, staleAfterSeconds: 172800 },
      ],
    });
    const datasets = await sql`select id, key from data_pack_datasets where pack_id = ${pack.pack.id}`;
    for (const dataset of datasets) {
      await api("morgan", at("14:59"), "POST", `/api/v1/data-packs/datasets/${dataset.id as string}/load`, {
        records: DEERHORN_LAYERS[dataset.key as keyof typeof DEERHORN_LAYERS],
      });
    }
  });

  // By 15:08 Casey Morgan has read all but the three newest notifications.
  later(at("15:08"), async () => {
    const inbox = await api<{ notifications: { id: string; read_at: string | null; assigned_to_current_actor: boolean }[] }>(
      "morgan", at("15:08"), "GET", "/api/v1/notifications?limit=500");
    const unread = inbox.notifications.filter((item) => item.assigned_to_current_actor && !item.read_at);
    for (const item of unread.slice(3)) await api("morgan", at("15:08"), "POST", `/api/v1/notifications/${item.id}/read`);
  });

  await runInOrder();
  return finish(incidentId);
}

const MAPPING = {
  title: "properties.title", category: "properties.category", status: "properties.status",
  note: "properties.note", sourceId: "properties.id", geometry: "geometry",
};

/** A layer feature whose geometry tools/demo-geometry generated under the same id. */
const feature = (id: keyof typeof DEERHORN_GEOMETRY, title: string, category: string, status: string, note: string) =>
  ({ properties: { id, title, category, status, note }, geometry: DEERHORN_GEOMETRY[id] });

const DEERHORN_LAYERS = {
  fire_perimeters: [
    feature("deerhorn", "SYNTHETIC Deerhorn Fire", "Fire perimeter", "unstable", "3,420 acres, 10% contained. Origin on the Hoopa and Yurok boundary south of Weitchpec."),
    feature("bluff-creek", "SYNTHETIC Bluff Creek Fire", "Fire perimeter", "unstable", "1,860 acres, 0% contained. Merged with the Slate Creek Fire on day 2."),
    feature("pecwan", "SYNTHETIC Pecwan Fire", "Fire perimeter", "stabilizing", "410 acres, 35% contained."),
    feature("bald-hills", "SYNTHETIC Bald Hills Fire", "Fire perimeter", "stable", "95 acres, 80% contained."),
  ],
  spot_fires: [
    feature("spot-sr96", "SYNTHETIC spot fire across SR-96", "Spot fire", "critical", "Reported 12:50 below Weitchpec."),
    feature("spot-school", "SYNTHETIC ember cast at Weitchpec school", "Spot fire", "critical", "Reported 14:52."),
    feature("spot-sr169", "SYNTHETIC spot fire at the SR-169 junction", "Spot fire", "critical", "Closed SR-169 at 13:05."),
  ],
  // Each area is issued by one government for its own land; the issuer is in the title.
  evacuation_areas: [
    feature("yurok-weitchpec", "SYNTHETIC Yurok Tribe order: Weitchpec", "Evacuation order", "evacuating", "Issued 13:25 by the Yurok Tribe. Go north on SR-96 to Orleans."),
    feature("yurok-sr169", "SYNTHETIC Yurok Tribe order: SR-169 to the Pecwan refuge area", "Shelter in place", "evacuating", "Issued 14:05 by the Yurok Tribe. The road out is cut at Weitchpec."),
    feature("hoopa-north", "SYNTHETIC Hoopa Valley Tribe order: north end of the valley", "Evacuation order", "evacuating", "Issued 13:40 by the Hoopa Valley Tribe. Go south through Hoopa."),
    feature("county-sr96", "SYNTHETIC Humboldt County warning: SR-96 north of Weitchpec", "Evacuation warning", "warning", "Issued 13:55 by Humboldt County for fee lands."),
  ],
};
