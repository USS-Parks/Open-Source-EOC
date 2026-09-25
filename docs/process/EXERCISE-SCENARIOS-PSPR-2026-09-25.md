# Exercise Scenarios PSPR

Plan date: September 25, 2026
Approval state: **APPROVED 2026-09-25.** Basho: "Authorized for full STS
with express permissions throughout." His answers to section 10: real tribes
may be named; the USGS imagery and elevation download for Del Norte is
authorized; Hoopa Valley Tribe OES owns the Deerhorn record with Yurok Tribe
OES in unified command; the Karuk Tribe supports the Deerhorn incident.
Author of record: Basho Parks.

## 1. Purpose

Add three exercise scenarios to Open Source EOC, each a working demo of the
platform and the dashboard and each a playable exercise with its own
situation manual. Together with North Coast Storm they cover the North
Coast's major hazards and show the product serving tribal nations, counties
and their partners on one host.

1. **Deerhorn Lightning Complex.** A multi-start lightning wildfire on the
   boundary between the Hoopa Valley Tribe and Yurok lands near Deerhorn
   (41.175669, -123.693213, as given by Basho).
2. **Del Norte Atmospheric Rivers.** A series of atmospheric river storms
   centered near Crescent City, damaging all of Del Norte County and the
   tribal nations within it.
3. **Cascadia Earthquake and Tsunami.** A magnitude 9.0 or greater
   subduction zone earthquake with a near-source tsunami, liquefaction
   around all of Humboldt Bay, landslides along the SR-299 corridor, gas
   leaks and structure fires in several towns, every highway and county road
   virtually impassable, and outside help far away and slow to arrive.

Scenario names are defaults; Basho may rename any of them (decision 2).

## 2. Relationship to the other plans

- `docs/process/OPERATOR-TRUST-PSPR-2026-09-24.md` is the live roster at
  plan date. Its units are landed except RD6, which waits for a Mac, and the
  remaining part of RD12. On approval this plan becomes the live roster for
  its own units; RD6 and the RD12 remainder stay open under the Operator
  Trust plan and nothing here touches them. XS1 updates the authority
  section of the root `CLAUDE.md` to say so.
- `docs/process/VEOCI-AIR-GAP-PSPR-2026-09-25.md`, approved the same day,
  runs beside this plan in another session. It leaves this plan's seeds and
  exercise documents to it (its section 2); this plan leaves that plan's
  files alone, including `server/src/incidents/**`, which its VA6 owns, so
  XS2's templates live under `server/src/demo/` instead.
- `docs/process/FINISH-PSPR-2026-09-22.md` remains the execution contract
  (commit, ledger and landing discipline) where this plan does not
  supersede it.
- North Coast Storm (`server/src/demo/north-coast.ts`) stays the reference
  scenario for the design frames. Its seeded content, its fidelity captures
  and the acceptance scenarios that run on it do not change.
- The training kit in `docs/guides/training/` is the shape the new exercise
  documents follow. The Ridge Wildfire tabletop there is untouched.

## 3. Where things stand at plan date

| Item | State |
|---|---|
| Reference scenario | North Coast Storm: Humboldt County OES and 7 partners, 14 people, written through the HTTP API as each person, placed on a 09:42 scenario clock by `placeOnScenarioClock` |
| Acceptance fixture | `server/src/demo/seed.ts`, SYNTHETIC Ridge Wildfire for the source checkout and the test suite |
| Demo delivery | The Windows `demo` and `host-demo` profiles seed North Coast Storm only (`deploy/windows/desktop.mjs`); one sign-in, `jordan.lee@humboldt.example` |
| Incident templates | `wildfire`, `severe_storm`, `daily_ops`. No earthquake, tsunami or flood template. Boards attach to an incident only at activation; there is no route to add one later. |
| Wildfire template | No Field Reports, Incident Facilities or Damage Assessment board |
| Facility kinds | Incident command post, helibase, helispot, staging area, base, camp, hospital, key facility, camera, weather station |
| Hazard geometry on the map | Exercise data packs (`/api/v1/incidents/:id/data-packs`) carry GeoJSON with a coverage area and freshness |
| Tribal lands on the map | The statewide land ownership overlay includes BIA trust lands |
| Vector basemap, overlays, gazetteer | Statewide |
| Imagery and terrain rasters | North Coast only: region -124.75, 40.3 to -123.3, 41.3. Deerhorn and SR-299 to Willow Creek are inside; Del Norte County north of 41.3 is not. |

## 4. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | How the demo carries the scenarios | One demo database holds all four exercises, as a regional host serving several organizations would. Each scenario has its own owner, cast and scenario clock. North Coast Storm stays the default sign-in and its console reads exactly as it does today. Alternative: choose one scenario when the demo profile is set up. |
| 2 | Scenario names | Deerhorn Lightning Complex; Del Norte Atmospheric Rivers; Cascadia Earthquake and Tsunami. |
| 3 | Command on the Deerhorn incident | The data model gives an incident one owning organization. Hoopa Valley Tribe OES owns the record; Yurok Tribe OES joins in unified command as a partner with the widest grant the model offers and the incident position title "Unified Command". Basho may flip the owner. Co-equal ownership is a product change outside this plan. |
| 4 | Real names | Real governments and agencies are named, as North Coast Storm names Caltrans and Cal OES. Every person is fictional with an `.example` address, no real official's name is used, and every operational fact is synthetic and marked as exercise content. No real evacuation zone identifiers. Cultural resources are recorded without locations. |
| 5 | Hazard geometry | Hand-drawn synthetic polygons and points, loaded as exercise data packs labeled SYNTHETIC and "not official hazard mapping". Official CGS tsunami, liquefaction or landslide maps are not imported. No fire spread, tsunami or shaking model. |
| 6 | Incident templates | Two new standard templates, `earthquake_tsunami` and `flood`, each with Field Reports, Incident Facilities and Damage Assessment boards. `wildfire` gains Field Reports and Incident Facilities. An existing install keeps its stored `wildfire` copy (templates insert on first run only); the receipt says so. |
| 7 | Facility kinds | Existing kinds only. Assembly areas, points of distribution and temporary refuge areas use staging area or key facility with a descriptive name. |
| 8 | Scenario clocks | Each scenario uses the most recent occurrence of its own local time, like North Coast's 09:42, so every time is in the past and at most a day old at seeding. Deerhorn: day 3 of the complex at 15:10. Del Norte: day 7 of the series at 06:40. Cascadia: 10:05 the morning after a 07:48 earthquake. |
| 9 | Basemap north of 41.3 | Extend the imagery and terrain rasters to cover Del Norte County to the Oregon line, from the same public-domain USGS sources. The download needs Basho's authorization (section 10). Alternative: Del Norte shows the vector basemap without imagery. |
| 10 | Exercise documents | Each scenario gets the training kit's three documents: situation manual (for players), facilitator guide (expected actions and evidence, for staff only) and inject cards. Controllers deliver injects by hand. No inject engine. |
| 11 | Casualties | Stated as counts with a confidence (reported, confirmed, unknown) in the health and medical lifeline and the situation report. No narrative detail. |
| 12 | Scenario size | Comparable to North Coast Storm: roughly 6 to 12 shelters, 10 to 15 facilities, 30 to 50 field reports, 20 to 30 resource requests, every lifeline assessed, 2 to 4 ESFs, a coordination thread, exercise CAP records and a joint information release. Cascadia carries more closures and more unknowns. |
| 13 | Deerhorn evacuation routing | Weitchpec and the SR-169 communities evacuate north on SR-96 toward Orleans once SR-96 south is cut; north Hoopa Valley evacuates south to Hoopa and Willow Creek. The Karuk Tribe joins as a partner because Orleans receives evacuees. Basho may drop it. |

## 5. Execution model

One unit at a time, in order, each on current `main`. XS3 owns only basemap
tooling and build output, and XS4, XS5 and XS6 each own their own seed file,
test and exercise documents, so those units may run in fan-out lanes under the
standing grant once XS1 and XS2 have landed. The integrating session lands
lanes one at a time by fast-forward. Commit and push discipline follows
`CLAUDE.md` and `CANON.md`: plain commit messages, the hook-appended footer,
no AI credit, never `--no-verify`, files staged individually.

Every unit ends with:

1. Its gate green (section 8).
2. A receipt appended to `docs/process/V1-LEDGER.md` under the heading
   "Exercise scenarios XSn: <title>" (what changed, defaults taken and
   deviations, verification commands and results, what was not run and why,
   rollback).
3. One focused commit and a push.

## 6. The scenarios

Every place below is a real place; every event is synthetic. Coordinates in
the seed are checked by test against the county each item claims (XS4 to
XS6).

### 6.1 Deerhorn Lightning Complex

| Item | Baseline |
|---|---|
| Hazard | Dry lightning ignites five fires in one evening. The Deerhorn Fire starts at 41.175669, -123.693213 on the line between the Hoopa Valley Reservation and Yurok lands, just south of Weitchpec; two of the starts have merged by day 3. Red flag warning in effect. |
| Incident | Deerhorn Lightning Complex, kind exercise, `wildfire` template |
| Owner and command | Hoopa Valley Tribe OES, with Yurok Tribe OES in unified command (decision 3) |
| Participants | Yurok Tribe OES, Karuk Tribe, CAL FIRE Humboldt-Del Norte Unit, Six Rivers National Forest, Bureau of Indian Affairs Pacific Region, Humboldt County OES, Caltrans District 1, American Red Cross, K'ima:w Medical Center |
| Clock | Day 3 at 15:10, the afternoon burn period |
| Geography | The Klamath and Trinity confluence at Weitchpec; SR-96 from Hoopa to Weitchpec and north toward Orleans; SR-169 from Weitchpec to Pecwan and Wautec, one road in and out; Bald Hills Road; the north end of the Hoopa Valley |
| Console at the clock | Evacuation orders and warnings issued separately by each tribe for its own lands and by Humboldt County for fee lands, each an exercise CAP record under its own issuer; SR-169 communities cut off at the Weitchpec end, sheltering at a temporary refuge area; SR-96 south of Weitchpec and Bald Hills Road closed; shelters in Hoopa, Willow Creek and Orleans plus a large animal site; command post, helibase, staging and camp; smoke over the valley with K'ima:w Medical Center running a clean air room; the line to Weitchpec de-energized and the SR-96 fiber burned; field reports from both tribes' crews; requests for engines, water tenders, buses for elders, N95s and room air cleaners, satellite terminals and cultural resource monitors to accompany dozer lines; a joint information release awaiting approval from both tribes and CAL FIRE |
| Hazard layers | SYNTHETIC fire perimeters by start, spot fires, and evacuation order and warning areas by issuing government |
| What it shows | Two sovereign nations on one incident: separate orders, a joint release, a partner seeing only what it is granted, cultural resource information visible only to the tribes through the existing restricted board access, and a single-access community |

### 6.2 Del Norte Atmospheric Rivers

| Item | Baseline |
|---|---|
| Hazard | Three atmospheric rivers in eight days. The third arrives on saturated ground with king tides and high surf. |
| Incident | Del Norte Atmospheric Rivers, kind exercise, `flood` template |
| Owner | Del Norte County OES |
| Participants | Tolowa Dee-ni' Nation, Elk Valley Rancheria, Resighini Rancheria, Yurok Tribe OES, City of Crescent City, Crescent City Harbor District, Caltrans District 1, Cal OES, American Red Cross, CA Dept. of Public Health, State Water Resources Control Board, Sutter Coast Hospital |
| Clock | Day 7 of the series at 06:40, during the third storm |
| Geography | All of Del Norte County: Crescent City and the harbor; Smith River and Fort Dick; Gasquet and Hiouchi on US-199; Klamath, Requa and Klamath Glen on the lower Klamath; Last Chance Grade on US-101 |
| Console at the clock | US-101 closed at Last Chance Grade and US-199 closed in the Smith River canyon, so the county has no road out; Smith River and lower Klamath flooding with Klamath Glen and Resighini lands under water; a boil water notice in Crescent City after flood turbidity; outages county-wide with the hospital and Pelican Bay State Prison on generators; the county's fiber route cut and cellular service degraded; surge damage in the harbor; shelters run by the tribes alongside Red Cross shelters at the fairgrounds; damage assessment records from the first two storms; lifeline history across the series, each storm's assessments superseded by the next; requests for air transport of dialysis patients, bulk water, fuel by sea or air, generators, slide removal equipment, sandbags and satellite links |
| Hazard layers | SYNTHETIC flood extents on the Smith and lower Klamath, slide points and outage areas |
| What it shows | A long incident: many operational periods, superseded assessments that read as history, damage assessment, a county cut off by road with every resupply by air or sea, and tribal governments running their own shelters and reporting their own lifelines |

### 6.3 Cascadia Earthquake and Tsunami

| Item | Baseline |
|---|---|
| Hazard | A magnitude 9.1 Cascadia subduction zone earthquake offshore. The first tsunami wave reaches Humboldt Bay about 15 minutes after the shaking. Liquefaction around the whole bay; landslides along SR-299 and the other corridors; gas leaks and structure fires in several towns. |
| Incident | Cascadia Earthquake and Tsunami, kind exercise, `earthquake_tsunami` template |
| Owner | Humboldt County OES, with a cast separate from North Coast Storm's |
| Participants | City of Eureka, City of Arcata, Wiyot Tribe, Blue Lake Rancheria, Bear River Band of the Rohnerville Rancheria, Hoopa Valley Tribe, Yurok Tribe OES, Caltrans District 1, Cal OES, CAL FIRE Humboldt-Del Norte Unit, US Coast Guard Sector Humboldt Bay, American Red Cross, CA Dept. of Public Health, CA Energy Commission |
| Clock | 10:05 the morning after, about 26 hours after the shaking |
| Geography | Humboldt Bay (Eureka, Arcata, the Samoa Peninsula, Manila, King Salmon, Fields Landing); the Eel River valley (Fortuna, Loleta, Ferndale); McKinleyville and the airport; SR-299 from Arcata through Blue Lake to Willow Creek; SR-96 to Hoopa |
| Console at the clock | Every highway and most county roads closed: US-101 north, south and on the Eureka-Arcata corridor, SR-255 at the Samoa Bridge, SR-299 at slides near Lord Ellis and Berry summits, SR-36 and SR-211 at Fernbridge. The Samoa Peninsula, Willow Creek, Hoopa and Weitchpec are cut off. Tsunami damage along the bay and liquefaction under the waterfront and fill. Structure fires in Eureka, Arcata and Fortuna from gas leaks, with hydrant pressure lost when the regional water transmission main failed. Hospitals damaged or on generators; casualties by confidence (decision 11). The communications lifeline mostly unknown, with status arriving by amateur radio and satellite only. The McKinleyville airport inspected and open as the air bridge and staging area; Blue Lake Rancheria's microgrid keeping its shelter powered. Shelters and assembly areas on high ground. Requests to the state with no arrival expected for 72 to 96 hours, and local pool resources assigned in the meantime. |
| Hazard layers | SYNTHETIC observed tsunami inundation, liquefaction areas, landslide points, fire and gas leak points, bridge damage |
| What it shows | Information state at scale (unknown and stale never shown as healthy or zero), long-wait outside requests beside local resources, damage assessment volume, and a region running on its own resources |

## 7. Units, in order

| Unit | Work | Proof |
|---|---|---|
| XS1 | **Scenario kit.** Move the seeding machinery out of `north-coast.ts` into `server/src/demo/scenario-kit.ts`: the zoned clock, sign-in and API calls as a person, the time-ordered plan, the scenario windows, organizations and people created or reused by slug, and `placeOnScenarioClock` generalized to any scenario run and safe to run once per scenario in one database. North Coast Storm is re-expressed on the kit with identical output. Root `CLAUDE.md` authority section updated (section 2). | Every test that seeds North Coast Storm passes unchanged; fidelity captures at 1586 by 992 unchanged against the frames; `pnpm check:static`; `pnpm test:ci`. |
| XS2 | **Templates.** The `earthquake_tsunami` and `flood` standard templates with positions, boards and per-position checklists fitted to each hazard; Field Reports and Incident Facilities added to `wildfire`; the acceptance fixture in `seed.ts`, which attaches its own Field Reports board to a wildfire incident, left with exactly one such board (decision 6). | Template tests for the new keys; `demo.test.ts`, `exercise.test.ts` and the wildfire activation tests green; an activation of each new template yields its boards and checklists; `pnpm test:ci`. |
| XS3 | **Basemap coverage.** Extend `build-north-coast-rasters.mjs` so the region reaches the Oregon line (about 42.0 north) and still covers SR-299 to Willow Creek; rebuild both archives; record the new sizes and SHA-256 values and the setup's size change. Runs only after Basho authorizes the download (section 10); if he chooses the alternative in decision 9, this unit records that and makes no change. | `pmtiles-writer.test.mjs` and the cartography tests green; a browser check that Crescent City, Deerhorn and Willow Creek render imagery and hillshade offline with no outside request. |
| XS4 | **Deerhorn Lightning Complex.** `server/src/demo/deerhorn.ts` on the kit, content per section 6.1, hazard layers as a SYNTHETIC data pack; the three exercise documents under `docs/guides/training/deerhorn/`. | A real-database seed test (counts, every scenario time in the past, every point inside its claimed county by `ca_counties.geojson`, CAP records under each issuer, the restricted cultural resource record invisible to non-tribal partners); a browser walk as the owner's lead at 1586 by 992 and 1534 by 790 through the overview, map with hazard layers, lifelines, requests and field reports, with no page errors and no outside requests; captures kept for XS8. |
| XS5 | **Del Norte Atmospheric Rivers.** `server/src/demo/del-norte.ts`, content per section 6.2; documents under `docs/guides/training/del-norte/`. | As XS4, plus lifeline history across the series and damage assessment records present. |
| XS6 | **Cascadia Earthquake and Tsunami.** `server/src/demo/cascadia.ts`, content per section 6.3; documents under `docs/guides/training/cascadia/`. | As XS4, plus unknown and stale lifelines never counted as healthy, and state requests shown with no arrival time. |
| XS7 | **Demo delivery.** The `demo` and `host-demo` profiles seed all four scenarios (decision 1); `bootstrap.json`, `TRY-IT-ON-WINDOWS.md`, `docs/DEMO-SCENARIO.md` and the training kit README name each scenario and its sign-in; the host and air-gap proof scripts still pass. Record the first-run seed time; if all four take more than two minutes, raise it with Basho before continuing. | A combined-seed test: North Coast Storm's console as Jordan Lee reads the same with all four seeded as alone (incident list aside); `pnpm test:desktop`; `pnpm check:gate`; the setup rebuilt and copied to `deploy/` with its SHA-256. |
| XS8 | **Review package.** `EXERCISE-SCENARIOS-REVIEW.md` at the repository root: each scenario's captures at both viewports, its sign-ins, where its documents are, the defaults taken, and the open questions. Basho's review is the acceptance. | Link check; Basho's review. |

## 8. Verification gates

Cheapest first, per CANON section 2:

1. `pnpm check:static` (typecheck, lint, license scan, link check).
2. `pnpm test:desktop` when anything under `deploy/windows` changed.
3. The unit's own tests, then `pnpm test:ci`.
4. For a scenario unit: its browser walk at 1586 by 992 and 1534 by 790, no
   page errors, no request outside the machine.
5. At plan end (XS7): `pnpm check:gate` (serial), the setup rebuilt and
   copied to `deploy/` with its SHA-256.

A passing gate is a stopping point. No reassurance runs beyond the gate
unless something changed or failed (CANON section 13). The known Windows
worker crash (`0xC0000409`) keeps its precedent: one isolated retry of the
crashed file, stated plainly in the receipt.

## 9. Not in this plan

- An inject engine or timed injects; controllers deliver injects by hand.
- Official hazard data (CGS tsunami, liquefaction or landslide maps) and any
  hazard modeling.
- Co-equal ownership of one incident by two organizations.
- New facility kinds or map symbols.
- Changes to North Coast Storm's content or to the Ridge Wildfire tabletop.
- Any contact with a tribe, agency or other outside party.
- Public publishing, Linux or Docker deployment, tagging a release.

## 10. What only Basho can supply

- Approval of this plan, and any reordering or renaming.
- Confirmation that naming these tribal governments and agencies in a
  synthetic exercise in this private repository is acceptable as decision 4
  describes, or direction to fictionalize any of them.
- Authorization for XS3's download of public-domain imagery and elevation
  tiles from the USGS National Map (no account or key), or the choice of the
  vector-only alternative.
- The owner of the Deerhorn record (decision 3) if not Hoopa Valley Tribe
  OES, and whether the Karuk Tribe stays in (decision 13).
- Visual and functional acceptance of each scenario in the rebuilt demo.

## 11. Completion

Done when: all three scenarios seed through the API into the demo database
beside North Coast Storm, whose console is unchanged; each passes its seed
test and its browser walk at both viewports; each has a situation manual,
facilitator guide and inject cards; the Del Norte imagery question is
settled one way or the other; `pnpm check:gate` is green; the rebuilt setup
is in `deploy/` with its SHA-256; `EXERCISE-SCENARIOS-REVIEW.md` is at the
repository root; and Basho has reviewed the scenarios in the installed demo.
