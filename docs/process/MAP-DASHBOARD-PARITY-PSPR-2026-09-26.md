# Map and Dashboard Parity PSPR

Plan date: September 26, 2026
Approval state: **APPROVED 2026-09-26.** Basho: "I approve of the plan in
full." His answers to section 10: an original SVG icon set of 40 icons
(decision 1); "I authorize the download of any needed public domain data"
(decisions 2, 3, 4 and 9); the release at plan end is version 1.0, and
versions march on from there (decision 13).
Author of record: Basho Parks.

## 1. Purpose

Open Source EOC exists to be the best of WebEOC, Esri's ArcGIS Solutions for
Emergency Management and Veoci woven into one open product, with better
workflow and continuity than any of them. Basho's review of 0.9.9 found the
map short of that bar: generic dots and crude hatched polygons where Esri
draws typed symbols and clean status areas, no visible hospitals, fire
stations or other critical facilities, no buildings, no tribal lands, and a
layer list mixing every exercise. He also found none of the chart dashboards
WebEOC users know from its Checklist, After Action Review and Incident
Action Plan boards.

This plan brings the Map to parity with the Esri EM Solutions map, the
dashboards to parity with WebEOC's chart dashboards, and fixes the defects
behind what he saw, while keeping what the canonical frames fixed.

Its research basis is `docs/process/ESRI-EM-MAP-RESEARCH-2026-09-26.md`
(Esri's templates decoded to exact layers, palettes and scale ranges; the
licensing of every source for offline use; WebEOC's dashboards and mapping;
Veoci's Esri integration) and the reference shots in `Reference Screenshots/`.

## 2. Relationship to the other plans

- `docs/process/VEOCI-AIR-GAP-PSPR-2026-09-25.md` is complete. Its
  receipts, the air-gap proofs and the 0.9.9 builds stand. On approval this
  plan becomes the live roster; MP0 updates the authority section of the root
  `CLAUDE.md` to say so.
- `docs/process/EXERCISE-SCENARIOS-PSPR-2026-09-25.md` is landed. Its
  decision 5 (hand-drawn synthetic hazard geometry) and its non-goal "new
  facility kinds or map symbols" are superseded here for map presentation
  only: the scenarios stay synthetic, exercise-labeled and not official
  hazard mapping, and MP9 raises the fidelity of their geometry. Its decision
  1 said North Coast Storm stays the default sign-in; the console today opens
  the alphabetically first exercise instead, which MP0 corrects.
- `docs/process/FINISH-PSPR-2026-09-22.md` remains the execution contract
  (commit, ledger and landing discipline) where this plan does not supersede
  it.
- The canonical frames stay authoritative. North Coast Storm's Overview and
  ESFs & Lifelines captures must not move away from the frames; the Overview
  COP card keeps its own legend and symbols. This plan changes the full Map
  screen, the reference layers under every map, and the dashboards.
- `docs/VEOC-PARITY-MATRIX.md` gains or updates rows (F19, G-BUILDINGS,
  G-DASH, G-REPORT, and new rows for critical facilities, tribal lands,
  hazard cartography and chart dashboards) in MP16.

## 3. Where things stand at plan date

A side-by-side run of 0.9.2 and 0.9.9 found no regression between them: only
one commit touched `web/src/cop` in that range, and it moved the feature
link. Everything below is equally true of 0.9.2.

| Item | State | Cause |
|---|---|---|
| Buildings | Overture footprints (13.5 million, colored by use) draw on the street map from z13 | The imagery layer sits above them (`streetstyle.ts`), and the dark theme opens on imagery (`CopMap.tsx`), so they vanish in dark or with imagery chosen |
| Critical facilities | NAPSG icons for OSM hospitals, fire stations, police, schools draw from about z14 | The map opens at z9 to z10.5; unnamed points are filtered out; nothing maps to an EOC; 128 px PNGs scaled to a quarter look soft |
| Incident facilities, shelters, closures on Del Norte and Deerhorn | Never reach their own map | The map's item request carries no incident, so a participant from another organization gets HTTP 403 on the incident's boards |
| Boards owned by another organization | Draw as generic dots | The console gives them an empty template key, so incident cartography never applies |
| Tribal lands | Not drawn | The basemap carries Yurok, Hoopa Valley and Blue Lake Rancheria boundaries, but the only boundary layer filters on `admin_level` and drops them (a console warning says so); the land ownership overlay shows faint unnamed tribal parcels, off by default |
| Scenario hazard geometry | 4 to 8 hand-typed corners, generic status hatch at 0.75 opacity with a 3 px line; hazard points are plain circles | Seed data in `server/src/demo/{cascadia,deerhorn,del-norte}.ts` drawn by the generic board style |
| Layer list | Lists every exercise's boards | The console removes only boards it knows are out of scope; boards of other organizations always pass |
| Default incident | The alphabetically first exercise (Cascadia) | The list is ordered by name and the first open incident wins |
| Device PIN notice | A banner above the map and a card in the Context panel, even in the synthetic demo | VA34; takes about 66 px from the map |
| Charts | One donut ("Shelters by status" on the EOC Status dashboard), report donuts and bars, board count bars | AAR, IAP and Tasks show number tiles only; Dashboards, AAR and Reports sit behind "Show every section" |
| Reference overlays | State, county and federal roads; public land ownership; flood zones and parcels as datasets | No critical facility layer, no tribal layer, no risk or vulnerability layer, no USNG grid |

## 4. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | Facility and hazard icons | **An original Open Source EOC icon suite of 40 icons** (Basho), authored as SVG in the repository under Apache-2.0 and built into multi-resolution sprites, so icons are crisp at 100, 125 and 200 percent scaling. It follows Esri's EM convention: operational symbols are white pictograms on a colored disc keyed by status or family, reference facilities are pictograms on a rounded square keyed by lifeline, and the incident command post keeps the ICS split square. The 40: **critical facilities (24)** hospital, urgent care, fire station, EMS station, law enforcement, emergency operations center, school, college, nursing home, dialysis center, pharmacy, power plant, electric substation, water treatment, wastewater treatment, communications tower, airport, heliport, port, dam, bridge, correctional facility, government building, hazardous materials site; **incident facilities (7)** incident command post, staging area, incident base, camp, helibase, point of distribution, shelter; **hazards and field (9)** wildfire, structure fire, landslide, flooding, gas or hazmat release, earthquake, tsunami, road block, damage report. The suite replaces the nine NAPSG symbols on the Map screen; the Overview COP card keeps the frames' symbols. |
| 2 | Critical facility data | A statewide California facility layer built from U.S. public-domain originals: USGS National Structures Dataset (hospitals, fire and EMS stations, law enforcement, schools, colleges, prisons, government buildings), CMS (nursing homes, dialysis), FCC antenna structures, EIA power plants, EPA FRS wastewater and hazardous waste, FAA airports and heliports, USACE National Inventory of Dams, FHWA National Bridge Inventory, FEMA state EOCs, merged with the basemap's OSM points (ODbL). HIFLD Open is gone; Esri-hosted copies are not used. Each source's license is verified and recorded before it is packed. |
| 3 | Buildings | Keep the shipped Overture footprints. Draw them above imagery as outline plus translucent fill from z14, with two themes: **by use** (USA Structures occupancy classes: residential, commercial, industrial, government, education, assembly, agriculture, utility, unclassified) and **by role** (private, public, critical infrastructure, the last joined from the facility layer). The reference shots color buildings by class, which goes further than Esri's EM templates. Alternative: add FEMA USA Structures (public domain) for occupancy where Overture has none; a separate download. |
| 4 | Tribal lands | Draw the basemap's tribal boundaries at once (no download), labeled, on by default. Add an overlay of Census TIGER American Indian and Alaska Native areas (public domain) with Esri's seven-class palette, and BIA Land Area Representations with BIA's no-legal-inference disclaimer. |
| 5 | Palettes | One palette table in `shared/`, keyed by coded values, feeds the map style, the legend, form pick lists and every chart, so a slice, a legend patch and a map symbol for the same value always match. It uses Esri's shipped values for evacuation levels, damage degree (FEMA: Affected, Minor, Major, Destroyed in purple, Inaccessible), Public Assistance categories A to G, shelter status and incident type families, and keeps the product's lifeline vocabulary (Stable, Stabilizing, Disrupted, Unknown) on FEMA's green, yellow, red and grey. |
| 6 | Hazard and status polygons | Esri's convention replaces the generic hatch: 50 percent fill with a same-hue outline, hollow thick outline for impact areas, hatch only for road disruption areas. Each data-pack kind (fire perimeter, evacuation order and warning, flood extent, inundation, liquefaction, outage area, damage area) gets its own style and legend entry. |
| 7 | Scenario geometry | Redraw the three exercise scenarios' hazard polygons with realistic detail (following coastline, rivers, ridges and roads from the shipped basemap; tens to hundreds of vertices), give hazard points typed kinds so they draw as icons, and give their facility records types. Everything stays labeled SYNTHETIC. North Coast Storm's content does not change. |
| 8 | Live hazard feeds | Presets and Esri-equivalent symbology for NWS warnings (the NWS hazard colors), NIFC WFIGS perimeters and incidents, USGS earthquakes and ShakeMap, and NOAA stream gauges, over the existing feed engine, showing the last snapshot and its age when offline. Tests use recorded fixtures; no live service is contacted without Basho's separate authorization. Esri's feed copies are not used. |
| 9 | Risk and grid layers | A USNG grid computed locally (100 m to 100 km by zoom); FEMA National Risk Index and CDC SVI for California tracts and counties with Esri's palettes and the tract and county zoom pair. The existing flood zone datasets keep their path. |
| 10 | Chart dashboards | A shared chart kit (donut with center total and a legend of counts, percentages and VIEW drill-downs; horizontal and vertical bars; status tiles; progress bars; status chips), in SVG with no new dependency, each chart with a data-table equivalent for screen readers. A **Dashboard tab** on Tasks (checklists), IAP, Resources, AAR, Shelters and Damage Assessment, as WebEOC puts one on its boards. Clicking a slice, bar or tile filters the list below it. |
| 11 | Finding the dashboards | The rail keeps the frames' twelve sections. The dashboards live as tabs inside the screens users already open. The demo profiles turn on "Show every section" so an evaluator finds AAR, Reports and Dashboards. |
| 12 | Map opening state | The map opens on the selected incident at a zoom where its facilities and closures read; critical facilities cluster below z12 and show icons from z12 and names from z14; the legend lists only what is visible at the current zoom (Esri's rule); the layer list shows only the selected incident's layers, grouped. |
| 13 | Release | At plan end the four install formats are built as **version 1.0.0** (Basho), and versions march on from there. |

## 5. Execution model

One unit at a time in order, each on current `main`, except where section 7
marks units as lane-parallel: the map track (MP2 to MP10) and the dashboard
track (MP11 to MP13) own disjoint files and may run in fan-out lanes under
the standing grant once MP0 and MP1 have landed. The integrating session
lands lanes one at a time by fast-forward. MP1 changes an authorization path
and is reviewed by an adversarial auditor agent before it lands, as VA32 and
VA33 were.

Commit and push discipline follows `CLAUDE.md` and `CANON.md`: plain commit
messages, the hook-appended footer, no AI credit, never `--no-verify`, files
staged individually.

Every unit ends with:

1. Its gate green (section 8).
2. A receipt appended to `docs/process/V1-LEDGER.md` under the heading
   "Map and dashboard parity MPn: <title>" (what changed, defaults taken and
   deviations, verification commands and results, what was not run and why,
   rollback).
3. One focused commit and a push.

## 6. What parity means here

Each unit names where its idea comes from and what Open Source EOC does
better.

| Strength taken | From | Done better here |
|---|---|---|
| Typed, status-colored operational symbols; 50 percent status polygons; domain-labeled legend showing only what is visible | Esri EMO, Damage Assessment, Know Your Zone | Offline, one palette shared by map, forms and charts, no license per seat |
| Critical infrastructure grouped by the eight Community Lifelines | Esri IAA "Foundational Infrastructure" | Shipped statewide in the setup, no portal to configure |
| Tribal areas (AIANNH classes, BIA LAR) | Esri Living Atlas | On by default near a tribal incident; labeled |
| Chart dashboards on the boards people already use | WebEOC Checklist, AAR, IAP and Requests/Tasks | Charts drill into the same screen's list; dark and light; work with no connection |
| Map views of records and hazard feeds | Veoci (customer ArcGIS services) and WebEOC Maps (ArcGIS) | No ArcGIS subscription; board records, feeds and reference layers on one map |

## 7. Units, in order

| Unit | Work | Proof |
|---|---|---|
| MP0 | **Demo that opens and reads right.** Land the pending one-click demo sign-in (the demo shortcut starts minimized and signs in as the exercise director; signing out stays signed out in that tab). No device PIN banner or card in a synthetic demo. The first sign-in opens North Coast Storm; after that the console reopens the incident the person last chose. Root `CLAUDE.md` authority section names this plan. | `pnpm check:static`; the Login and session tests; `pnpm test:desktop`; a browser walk of the installed demo at 1586 by 992 and 1534 by 790 with no sign-in step and no PIN notice |
| MP1 | **Map defects.** (a) The map's item and tile requests carry the selected incident, and the server resolves the board through the incident read shape, so a participant sees the incident's own boards (auditor review). (b) Incident boards return their template key, so cartography applies across organizations. (c) The layer list keeps only the selected incident's layers. (d) Building layers draw above imagery. (e) The basemap's tribal boundaries draw as a labeled line, and the boundary filter stops warning. (f) Facility labels start at z14 and unnamed fire stations keep their icon. | Real-database authorization tests (participant allowed on the incident's boards, stranger still refused, no board of another incident leaks); `pnpm test:ci`; browser walk of all four exercises showing Del Norte's EOC, hospital, shelters and closures, footprints over imagery in Eureka, tribal lines near Deerhorn |
| MP2 | **Palette table.** `shared/` palettes per decision 5, consumed by the map style, legend, form pick lists and the existing dashboard widgets. | Unit tests that every coded value has a color in both themes; North Coast fidelity captures unchanged |
| MP3 | **Icon suite.** The 40 original SVG icons listed in decision 1 (24 critical facilities, 7 incident facilities, 9 hazards and field); sprites at 1x, 1.25x and 2x; legend and inspector use the same SVGs. | Sprite build test; icons crisp in captures at 125 percent scaling; license scan |
| MP4 | **Critical facilities layer** (after the download is authorized). `tools/basemap` packs the statewide facility layer per decision 2 with type, name, source, lifeline and sector; the map clusters it below z12 and draws icons from z12; the inspector shows Esri's critical infrastructure fields. | Tool tests; counts by type for Humboldt and Del Norte recorded; captures in Eureka and Crescent City at z12 and z15 |
| MP5 | **Buildings.** The by-use and by-role themes per decision 3, drawn above imagery from z14, with a legend and the class in the inspector. | Style tests; rendered counts in Eureka and Crescent City in both themes and with imagery |
| MP6 | **Boundaries and grid** (TIGER and BIA after authorization). Tribal overlay per decision 4; counties and places from TIGER; the USNG grid. | Tool tests; captures near Deerhorn, Klamath and Blue Lake with names |
| MP7 | **Incident and hazard cartography.** Kind-aware styles per decision 6 for data-pack datasets and boards: evacuation levels, fire perimeters, flood extents, inundation, liquefaction, outage and damage areas, closures with casings and direction arrows, detours, road blocks, damage points by FEMA degree; typed hazard icons from MP3. | Style unit tests; captures of all four exercises at both viewports; North Coast's Overview capture unchanged |
| MP8 | **Legend and layer list.** The Map screen's legend lists only layers visible at the current zoom, grouped, with domain labels and class patches. The layer list groups Incident, Hazards, Critical facilities by lifeline, Buildings, Boundaries, Risk and reference, and Basemap (exclusive), greys out layers outside their zoom range, and keeps opacity and zoom-to. The COP card legend on the Overview stays as the frames show it. | Component tests; axe; captures |
| MP9 | **Scenario geometry.** Per decision 7, in the three exercise seed files. | Seed tests (every feature inside its claimed county, SYNTHETIC labels, valid rings); captures of each scenario's map |
| MP10 | **Risk layers and live feed presets.** NRI and SVI per decision 9 (after authorization); feed presets and symbology per decision 8, tested on recorded fixtures. | Tool and style tests; a feed walk offline showing the snapshot age |
| MP11 | **Chart kit.** Per decision 10, built on the existing `Donut` and `BarChart` in `web/src/dashboards`. | Component tests in both themes; axe; keyboard walk; data-table equivalents |
| MP12 | **Checklist, task and IAP dashboards.** Tasks gets WebEOC's Checklist dashboard: lists by status, tasks by status, pace (past due against on time), tasks by category, and the status chips. IAP gets status tiles, a status block and a progress bar per plan row. Resources gets the Requests/Tasks tiles (active, completed, overdue, total cost) and a request status chart. | Browser walks with seeded data at both viewports; drill-down from each chart to the filtered list |
| MP13 | **AAR, shelter and damage dashboards.** AAR: priority, status and improvement plan donuts with totals and VIEW links; core capability horizontal bars; capability element vertical bars. Shelters: occupancy against capacity and occupancy history. Damage Assessment: counts by FEMA degree and by Public Assistance category. Demo data for these goes into the three exercise scenarios, not North Coast Storm. | As MP12 |
| MP14 | **Finding everything.** Per decision 11: the demo profiles turn on "Show every section"; each Dashboard tab is reachable from its screen. | Browser walk from a fresh demo sign-in to every dashboard without the Settings dialog |
| MP15 | **Map opening state.** Per decision 12: framing on open, clustering thresholds, legend-by-visibility wired across the Map screen and the Overview's full-map link. | Captures at both viewports for all four exercises |
| MP16 | **Review package and release.** `MAP-DASHBOARD-PARITY-REVIEW.md` at the repository root with each screen beside its reference (Esri template or WebEOC shot); parity matrix rows updated; `pnpm check:gate`; both air-gap proofs; the version set to 1.0.0 and the four formats built (decision 13), each with its SHA-256, in `deploy/`. Basho's review is the acceptance. | Link check; the gate; the proofs; Basho's review |

## 8. Verification gates

Cheapest first, per CANON section 2:

1. `pnpm check:static` (typecheck, lint, license scan, link check).
2. `pnpm test:desktop` when anything under `deploy/` changed.
3. The unit's own tests, then `pnpm test:ci`.
4. For a map or dashboard unit: its browser walk at 1586 by 992 and 1534 by
   790, both themes, no page errors, no request outside the machine, and the
   North Coast Storm fidelity captures no further from the frames.
5. At plan end (MP16): `pnpm check:gate` (serial), both air-gap proofs, the
   four formats rebuilt.

A passing gate is a stopping point. No reassurance runs beyond the gate
unless something changed or failed (CANON section 13).

## 9. Not in this plan

- Esri basemaps, Living Atlas feeds or any Esri-hosted copy of data (Esri's
  license forbids offline redistribution); Regrid or any commercial parcels.
- An ArcGIS Online or Enterprise connection, a feature service export like
  WebEOC's ArcGIS extension, or 3D scenes.
- Demographic infographics from Esri Business Analyst.
- Official hazard mapping or hazard modeling of any kind.
- Changes to North Coast Storm's content, the canonical frames or the
  twelve-section rail.
- Contact with any tribe, agency, vendor or other outside party; any
  account, key or registration.
- Public publishing, tagging, Linux or Docker deployment.

## 10. What only Basho can supply

- Approval of this plan, and any reordering, cutting or renaming of units.
- Decision 1: the original icon suite, or extending NAPSG instead.
- Authorization to download the public-domain source data named in
  decisions 2, 4 and 9 (USGS National Structures Dataset, CMS, FCC, EIA, EPA
  FRS, FAA, USACE NID, FHWA NBI and FEMA facility data for California; Census
  TIGER AIANNH, counties and places; BIA Land Area Representations; FEMA
  National Risk Index; CDC SVI). No account or key is needed for any of
  them. Each unit records the expected size before downloading and raises any
  single source over 1 GB first.
- Decision 3's alternative (FEMA USA Structures) if wanted.
- The release version at plan end (decision 13).
- Visual and functional acceptance in the rebuilt install.

## 11. Completion

Done when: all four exercises' maps show their own facilities, closures and
typed hazards in the palette of decision 5; critical facilities, buildings by
use and role, and tribal lands draw offline across California; the legend
and layer list follow section 7; Tasks, IAP, Resources, AAR, Shelters and
Damage Assessment each have a working Dashboard tab with drill-down; the demo
opens with one click on North Coast Storm with no sign-in and no PIN notice;
North Coast Storm's fidelity captures are no further from the frames;
`pnpm check:gate` and both air-gap proofs are green; the four formats are
rebuilt in `deploy/` with their SHA-256; `MAP-DASHBOARD-PARITY-REVIEW.md` is at
the repository root; and Basho has reviewed it in the installed app.
