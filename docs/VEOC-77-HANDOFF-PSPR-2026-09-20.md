# VEOC-77 Handoff: Plan / Sequential Prompt Roster for the next session

**Prepared:** 2026-09-20, end of the VEOC-77 desktop session.
**For:** the next executing model (Opus 4.8), on Basho's desktop.
**Authority:** this roster extends `VIRTUAL-EOC-PSPR-2026-09-17.md` under its
universal execution contract and `CLAUDE.md`. Basho approved the VEOC-77
roster and its two amendments in-session; the prompts below are the approved
remainder plus their execution order. Nothing here pre-authorizes a commit,
push, branch, install, or new data source: read the approval state per prompt.

## 0. Read first

1. `CLAUDE.md` (binding). Commit footer `Copyright Basho Parks - 2026`, no
   AI trailers, no branches or worktrees, commit and push each need Basho's
   distinct approval unless he grants session-wide express consent (he did
   for VEOC-77; ask again this session).
2. The tail of `docs/VEOC-EXECUTION-LEDGER.md`: receipts VEOC-76, 76a, 77.
3. `deploy/basemap/README.md`: the basemap stack as it now stands.
4. Basho's standing direction from this session, verbatim in spirit: he
   makes scope, sourcing, and tooling decisions, not the model. Put each such
   decision to him with options before acting. He removed a Docker fallback
   the model added unasked. Do not repeat that.

## 1. Where the map stands (all on `origin/main`, CI green through 3083dc3)

| Capability | State | Proof |
|---|---|---|
| Operator tools (VEOC-76): labels, find, measure distance and area, bookmarks, home, compass, fullscreen, geolocate, export | shipped | unit tests, CI E2E |
| Real street basemap from self-built California OpenStreetMap tiles | shipped, proven in Chrome | `deploy/basemap/out/shots/street-*.png` |
| Street style context: landcover, landuse, rail, airfields, water names, peaks, critical-facility labels | shipped | style-spec validation test |
| Basemap gallery: USGS imagery, topo, hydrography overlay (runtime settings) | shipped, proven | `gallery-*.png`, `overlay-hydro-*.png` |
| Terrain: hillshade toggle and 3D over Terrarium DEM (runtime setting) | shipped, proven | `terrain-*.png` |
| Every basemap layer switchable by group | shipped, proven | `groups-no-buildings-no-roads.png` |
| Buildings by use and by record status (prompt 9) | code shipped and unit-tested; **archive build running, render unproven** | see section 2 |

Local artifacts (gitignored): `deploy/basemap/out/california.pmtiles`
(734 MB), `deploy/basemap/out/buildings.pmtiles` (in progress at handoff,
log `deploy/basemap/out/buildings-build.log`), a served copy at
`web/public/basemap/california.pmtiles`, and the screenshot set in
`deploy/basemap/out/shots/`.

## 2. Environment on this desktop

- Node 24, pnpm 10.33. No PostgreSQL: server tests and the browser E2E run
  only in CI (every push). Locally run `pnpm -r exec tsc --noEmit`,
  `npx eslint .`, `node scripts/license-scan.mjs`, `node scripts/check-links.mjs`,
  `rtk proxy npx vitest run web/src` (the `rtk` wrapper hides vitest output;
  `rtk proxy` shows it).
- Java: Temurin 21 at `C:\Users\17076\tools\jdk-21\bin` (not on PATH; prefix
  it). Planetiler 0.9.0 jar and the California extract are in
  `deploy/basemap/out/`.
- GDAL 3.12.1 at `C:\Program Files\GDAL` (installed this session on Basho's
  choice; not on PATH; `ogr2ogr.exe` there). Chosen converter for shapefiles
  and ArcGIS services in the overlay pipeline.
- Chrome at the default path. Headless proof pattern: `playwright-core` from
  `server/node_modules`, `executablePath` to Chrome, args
  `--use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader
  --ignore-gpu-blocklist`. The dev server: `pnpm --dir web exec vite --port
  5173` (`.claude/launch.json` name `web-dev`). The testbed page:
  `http://localhost:5173/cop-demo/index.html?OPENEOC_*=...&theme=dark&bundled=1`
  (any `OPENEOC_*` query parameter becomes runtime config; `window.__map` is
  the map). A script in the session scratchpad drove the captures; recreate
  it from the description in the VEOC-77 receipt if needed.
- The global Claude Code autoformat hook rewrites `.ts/.tsx/.js` files with a
  home-directory prettier (no semicolons, single quotes) after every Edit or
  Write. This repo uses semicolons and double quotes. Do not Edit or Write
  those files directly: write new files to the scratchpad with a `.txt`
  suffix and copy them in, and patch existing files with an exact-match
  Python replace script (unique old string, atomic rename). Verify with
  `grep -c "from '"` equal to 0.

## 3. Verified data sources (endpoints answered, fields inspected, 2026-09-20)

| Layer | Source | Notes |
|---|---|---|
| State highways | Caltrans `https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/SHN_Lines/FeatureServer/0` | Route, County, District, RouteType; 2000 per page |
| Federal roads: USFS | `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer/0` | jurisdiction, primary_maintainer, oper_maint_level, county |
| Federal roads: BLM | `https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/BLM_Natl_GTLF_Public_Motorized_Roads/FeatureServer/3` | layer index is 3 |
| Federal roads: NPS | `https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Roads_Geographic/FeatureServer` | |
| County roads | Humboldt County shapefile `https://humboldtgov.org/DocumentCenter/View/566` (metadata View/565) | fields include `juris`, `FUNCCLASS`, `STREETNAME`; planning-use disclaimer |
| Parcels | Humboldt County shapefile `https://humboldtgov.org/DocumentCenter/View/562` (12 MB; metadata View/561) | APN only, no use codes |
| Land ownership | CAL FIRE public view `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/Public_Land_Ownership_view/FeatureServer/0` | 57,404 polygons; `Own_Level` in City, County, Federal, Non Profit, Special District, State, Tribal; `Own_Agency`, `Own_Group` |
| Flood zones | FEMA NFHL `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | polygon; `FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`; query by bbox, 2000 per page |
| Facility icons | NAPSG catalog `https://napsg-web.s3.amazonaws.com/symbology/napsg_symbology_v4.1.5.json`, PNGs under `.../symbology/data/PNG9/<path>` | 1,192 icons, 13 packs; CC BY 4.0 per napsgfoundation.org; attribution required |

Not usable, do not retry: NAPSG's GitHub repository (Distribution Statement
C, all rights reserved); FHWA HPMS public-release services (dead links);
BIA NTTFI (PDF only); CAL FIRE statewide parcels view (vendor-derived IDs,
no license text); Del Norte County has no public parcel service found.
Caltrans publishes no road-ownership GIS. Tribal roads: **skipped by Basho's
decision** for now; do not derive them from land ownership.

## 4. Roster remainder, in execution order

Each prompt: one commit, plain-language subject and body, footer, gates green
(local set above; CI on push), one line in the next ledger receipt. Ask Basho
for commit and push authorization at session start; if refused, stage and
propose per prompt.

### Prompt 9b: prove the buildings archive and finish prompt 9

- Confirm `deploy/basemap/out/buildings.pmtiles` exists and the log ended
  without an exception. If the build failed, rerun with the JDK on PATH:
  `java -Xmx4g -jar planetiler-0.9.0.jar generate-custom
  --schema=../buildings-schema.yml --output=buildings.pmtiles --force` from
  `deploy/basemap/out`.
- Copy it to `web/public/basemap/buildings.pmtiles` and add that path to
  `.gitignore` next to the california archive line.
- Testbed proof: `OPENEOC_BUILDINGS_PMTILES_URL=http://localhost:5173/basemap/buildings.pmtiles`
  plus the street PMTiles URL, Eureka at z15 light and dark. Expect typed
  footprints colored by use, untyped neutral, the Building use legend, and
  the Buildings group toggle hiding both fills. If the archive's `class`
  values do not match `BUILDING_USE_TAGS` as expected, adjust the tag lists
  in `web/src/cop/layers.ts`, never the schema semantics.
- Status join proof needs records: run the E2E-style seed (CI only) or add a
  step to the browser E2E that drops a damage-assessment point on a building
  and asserts the feature state. Skip locally if no PostgreSQL.
- Acceptance: screenshots delivered to Basho; receipt line; commit.

### Prompt 8: jurisdiction and ownership overlays (roads by owner, land ownership)

- Pipeline: `deploy/basemap/overlays.sh` fetching the section 3 sources into
  GeoJSON with `ogr2ogr` (ArcGIS services paginated with
  `resultOffset`, shapefiles read directly, reprojected to EPSG:4326), then
  tippecanoe or planetiler into `overlays.pmtiles` with layers
  `roads_state`, `roads_usfs`, `roads_blm`, `roads_nps`, `roads_county`
  (from Humboldt `juris`), `land_ownership` (CAL FIRE `Own_Level`,
  `Own_Group`). Tippecanoe is not installed here; planetiler custom schemas
  accept GeoJSON sources, so prefer planetiler.
- App: `OPENEOC_OVERLAYS_PMTILES_URL`; one toggleable group per road owner
  (Federal split by agency, State, County) with a distinct muted line color
  per owner and a legend; the ownership fill with its seven levels; all
  under the "Overlays" section beside Hydrography and Hillshade. Colors stay
  muted so status reads first (INV-8). Attribution per source on the source.
- Tests: style validity with overlays; group table covers every new layer;
  config test for the new URL.
- Ask Basho before adding any county beyond Humboldt.

### Prompt 10: parcels overlay

- Humboldt parcels from section 3 through the same pipeline into
  `overlays.pmtiles` as layer `parcels` (APN kept), drawn as thin outlines
  from z14 with APN in the click popup, toggleable. No use coloring: the
  county publishes none.

### Prompt 11: hatched hazard areas and FEMA flood zones

- Polygon board layers (evacuation zones, closures, flood, fire perimeters)
  gain a fill-pattern by status. MapLibre needs a sprite for `fill-pattern`:
  generate diagonal-hatch PNGs per status color at build time
  (`deploy/basemap/build-sprite.mjs`, no new dependency; write the PNGs and a
  `sprite.json` by hand) into `web/public/sprite/`, and declare `sprite` on
  every style. Keep the solid fill at low opacity underneath.
- FEMA flood zones through the overlay pipeline for the operations bbox
  (query layer 28 by bbox, paginated), layer `flood_zones`, hatched by
  `FLD_ZONE` family (A/AE/AO high risk, X shaded moderate), toggleable.

### Prompt 12: map-view driven KPIs

- The dashboard gains tiles that count within the current COP extent:
  impacted buildings (footprints with a status feature state), records by
  status in view, shelters open in view. Wire through the existing
  `onMap` hook and a shared extent store; recompute on `moveend`. Reuse the
  KPI tile component already in `web/src/dashboards`.

### Prompt 13: NAPSG facility icons

- `deploy/basemap/build-napsg-sprite.mjs`: download the catalog JSON and the
  PNGs for a chosen subset (critical facilities: hospital, clinic, fire
  station, police, school, shelter, EOC, airport, helipad; plus the incident
  and lifeline packs Basho names), build `sprite.json` and `sprite.png` at 1x
  and 2x, and write the CC BY 4.0 attribution into the sprite metadata and
  the attribution control. Replace the text-only `facility-label` with an
  icon plus label symbol layer. Ask Basho which packs to include before
  downloading; record the license in the ledger.

### Prompt 14: Overture building subtypes (Basho: "OSM now, Overture later")

- New source, new license (ODbL plus CDLA-Permissive 2.0), new tool (DuckDB
  with the spatial extension to read Overture Parquet from S3). Put the tool
  install and the license to Basho first. Output: replace or enrich the
  `class` of untyped footprints in `buildings.pmtiles`.

### Prompt 15: close-out

- VEOC-78 receipt covering prompts 8 to 14 (or as far as reached), the
  screenshot set, and a `ROADMAP.md` update. Note the `.claude/launch.json`
  and `.vitest/` untracked files in the working tree: leave them, or ask
  Basho whether to ignore them.

## 5. Gates and receipts, restated

- Before every commit: tsc, eslint, license scan, link check, web unit
  suite; CI carries the server suite and both browser E2Es.
- Never `--no-verify`. Never `git add .`. Stage files individually.
- Receipts are append-only; corrections are new entries.
- Report red as red. Report a skipped gate as skipped.

## 6. Open questions for Basho (ask at session start)

1. Commit and push authorization for the session.
2. Counties beyond Humboldt for roads and parcels (Del Norte needs a data
   request to the county).
3. NAPSG packs to include in the sprite.
4. Whether to install DuckDB for the Overture prompt now or later.
