# Basemap generation and proof toolchain

The common operating picture has two self-hosted basemaps, both offline-capable
with no third-party tile provider:

1. **Bundled vector basemap (ships in the app).** Natural Earth 10m plus US
   Census county outlines, clipped to California and tiled to PMTiles with
   tippecanoe, with a label glyph stack. It renders as real vector tiles
   (labeled highways, towns, county lines, water) light and dark, offline, out
   of the box. It is public domain and about 1.4 MB. Regenerate it with
   `build-bundled-basemap.sh` (needs tippecanoe and the `fontnik` npm package);
   the output lands in `web/public/basemap/basemap.pmtiles` and
   `web/public/fonts`. The style is `web/src/cop/bundledbasemap.ts`.
   The map's find box looks up county names in `web/src/cop/county-bounds.ts`,
   generated from `web/public/basemap/ca_counties.geojson`. After changing
   that file, run `node tools/basemap/build-county-bounds.mjs` (Node only);
   a unit test fails until the two match.
2. **Self-hosted street basemap (deploy-time).** Full OpenStreetMap street-level
   detail for California, hosted by the deployment. This is the ArcGIS-grade
   basemap: streets, buildings, terrain context, place and road labels, under
   the ODbL. The rest of this document covers it. The style is
   `web/src/cop/streetstyle.ts`.

For an area other than California, [region map packets](../../docs/guides/REGION-MAP-PACKS.md)
build the street map, buildings and address search index for that area and
carry them to an EOC with no internet, checked by SHA-256.

## Why the street tiles are not built in CI

Generating statewide OpenStreetMap tiles downloads a roughly 1 GB extract and
writes a multi-GB archive. That exceeds a constrained CI sandbox's network and
disk, so street-tile generation is a build-machine job run out of band. The app
code that renders the tiles is unit-tested in CI; the street tiles themselves
are a deploy artifact, not committed to the repository. (The bundled vector
basemap above IS committed, since it is small.)

This section produces the street basemap for California and explains how to wire
it into the app.

## 1. Generate the tiles

On a machine with Java 21+, about 10 GB of free disk, and network access:

```
tools/basemap/generate-california.sh
```

This uses [planetiler](https://github.com/onthegomap/planetiler) to download the
California extract from Geofabrik and write `california.pmtiles` in the
OpenMapTiles schema, which the app's street style is written against. Output
lands in `tools/basemap/out/` (gitignored) unless a directory is given. For a
different area, change `--area` in the script (a Geofabrik region path such as
`us/oregon`), or point planetiler at a local `.osm.pbf` with `--osm-path`.

## 2. Labels (optional: your own glyph stack)

Labels render out of the box: the street style uses the glyph stack the app
already ships (Liberation Sans, SIL OFL, under `web/public/fonts`). Nothing to
build or host.

To use another face, build a glyph (font) stack served as PBF ranges from an
open-licensed font (for example Noto Sans, SIL OFL) with a glyph builder such
as [`build-glyphs`](https://github.com/gmac/build-glyphs) or
[`font-maker`](https://github.com/maplibre/font-maker):

```
npx build-glyphs NotoSans-Regular.ttf ./fonts/"Noto Sans Regular"
```

Serve it so that `{fontstack}/{range}.pbf` resolves, e.g.
`https://<host>/fonts/{fontstack}/{range}.pbf`, and set both
`OPENEOC_BASEMAP_GLYPHS_URL` and `OPENEOC_BASEMAP_FONT` (the stack name, here
`Noto Sans Regular`) in step 5.

## 3. Build the licensed NAPSG facility sprite

The repository ships the approved H13 facility originals, CC BY 4.0 text, and
acquisition manifest under `web/public/napsg/`. Rebuild the MapLibre 1x and 2x
sprite pairs offline with Node only:

```
node tools/basemap/build-napsg-sprite.mjs
```

The builder verifies every original against the acquisition manifest, accepts
only the inspected non-interlaced RGBA PNG format, and atomically writes
`sprite.json`, `sprite.png`, `sprite@2x.json`, and `sprite@2x.png`. Each JSON
entry retains the source URL and SHA-256 plus NAPSG and CC BY 4.0 attribution.
Optional arguments select another input and output directory:

```
node tools/basemap/build-napsg-sprite.mjs ./approved-napsg-input ./sprite-output
```

The COP also registers the individual local PNGs at runtime so bundled and
external styles use the same licensed icons without replacing their own sprite.

## 4. Host the artifacts

Serve `california.pmtiles`, the glyph directory, and any sprite over HTTP with
**range requests enabled** (PMTiles reads byte ranges). Any static host works:
S3 or a CDN with range support, or nginx with `Accept-Ranges: bytes` (the
default for static files). No tile server process is required.

## 5. Wire it into the app

Set the runtime config before the app loads (for example, inject
`window.OPENEOC` from the serving host, no rebuild needed):

```html
<script>
  window.OPENEOC = {
    OPENEOC_BASEMAP_PMTILES_URL: "https://<host>/california.pmtiles",
    // optional, only with your own glyph stack (step 2):
    OPENEOC_BASEMAP_GLYPHS_URL: "https://<host>/fonts/{fontstack}/{range}.pbf",
    OPENEOC_BASEMAP_FONT: "Noto Sans Regular",
    // optional:
    OPENEOC_BASEMAP_SPRITE_URL: "https://<host>/sprite"
  };
</script>
```

When `OPENEOC_BASEMAP_PMTILES_URL` is set, the app builds a themed street style
over the PMTiles (`buildStreetStyle` in `web/src/cop/streetstyle.ts`) and the
COP renders a full street map, light and dark, with the operational layers on
top. Leave it unset and the app uses the bundled offline basemap. A full
external style URL (`OPENEOC_BASEMAP_STYLE_URL`) still takes precedence over
both.

## 6. Basemap gallery: imagery, topo, hydrography

Beside the vector map the COP can offer raster basemaps and overlays. Each is
a runtime setting with an attribution shown while it is visible; leave any
unset and it is simply not offered. The USGS National Map services are US
government work (public domain) and need no key:

```html
<script>
  window.OPENEOC = {
    OPENEOC_IMAGERY_TILE_URL:
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    OPENEOC_IMAGERY_ATTRIBUTION: "Imagery: USGS The National Map",
    OPENEOC_TOPO_TILE_URL:
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    OPENEOC_TOPO_ATTRIBUTION: "Topo: USGS The National Map",
    OPENEOC_HYDRO_TILE_URL:
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}",
    OPENEOC_HYDRO_ATTRIBUTION: "Hydrography: USGS The National Map"
  };
</script>
```

An air-gapped install points these at a self-hosted mirror instead (any XYZ
tile directory or a tile server over a PMTiles raster archive).

## 7. Terrain: hillshade and 3D

With a raster DEM tile set configured, the COP gains a Hillshade overlay and
MapLibre's 3D terrain control. The AWS Open Data elevation tiles (Terrarium
encoding; SRTM, USGS 3DEP, and other public sources) work directly:

```html
<script>
  window.OPENEOC = {
    OPENEOC_TERRAIN_TILE_URL: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    OPENEOC_TERRAIN_ENCODING: "terrarium",
    OPENEOC_TERRAIN_ATTRIBUTION: "Terrain: Mapzen/AWS Open Data elevation tiles"
  };
</script>
```

For an air-gapped install, mirror the DEM tiles for your area of operations
into a PMTiles raster archive (the `pmtiles` CLI converts a tile directory or
MBTiles) and serve it the same way as the street tiles; set the encoding to
match the source (`terrarium` or `mapbox`).

### North Coast imagery and elevation archives

`build-north-coast-rasters.mjs` builds the two offline raster archives the
North Coast exercise scenarios use, with no tile server:

| Archive | Source | Tiles |
|---|---|---|
| `north-coast-imagery.pmtiles` | USDA NAIP imagery through the USGS National Map `USGSImageryOnly` tile service, public domain | JPEG, z8 to z14 over the region, z15 over the Humboldt Bay area |
| `north-coast-terrain.pmtiles` | USGS 3DEP elevation through the `3DEPElevation` image service, public domain | Terrarium PNG, z8 to z13 over the region |

The Humboldt Bay area runs from Trinidad to Fortuna
(`-124.42, 40.48, -123.78, 41.16`); the region around it
(`-124.75, 40.3, -123.3, 42.05`) covers what a map framed on that area shows
and reaches north through Del Norte County to the Oregon line and east past
Willow Creek and Weitchpec, for the Del Norte and Deerhorn exercises. Built
over that region the imagery archive is about 246 MB and the elevation
archive about 244 MB.
Tiles are cached under `tools/basemap/out/north-coast-cache`, so a rerun only
fetches what is missing; the imagery service has no tiles over open ocean,
and those are skipped.

```bash
node tools/basemap/build-north-coast-rasters.mjs
```

The archives are written to `web/public/basemap/` and are not tracked. Point
the runtime settings at them with a `pmtiles://` URL and no tile template, so
the map reads each archive's zoom range and bounds from its header:

```html
<script>
  window.OPENEOC = {
    OPENEOC_IMAGERY_TILE_URL: "pmtiles:///basemap/north-coast-imagery.pmtiles",
    OPENEOC_IMAGERY_ATTRIBUTION: "Imagery: USDA NAIP via USGS The National Map",
    OPENEOC_TERRAIN_TILE_URL: "pmtiles:///basemap/north-coast-terrain.pmtiles",
    OPENEOC_TERRAIN_ATTRIBUTION: "Elevation: USGS 3DEP"
  };
</script>
```

The Windows launcher sets these whenever the archives are present. With imagery configured, the dark theme opens the map on it; both
themes open with the terrain shaded.

## 8. Buildings by use and status

`generate-california.sh` also writes `buildings.pmtiles` from
`buildings-schema.yml`: every OpenStreetMap building footprint with its
`building` tag as `class` and its `osm_id`. Host it beside the street tiles
and set:

```html
<script>
  window.OPENEOC = { OPENEOC_BUILDINGS_PMTILES_URL: "https://<host>/buildings.pmtiles" };
</script>
```

H14 can enrich that archive from an already acquired Overture buildings
GeoParquet without adding a second footprint layer. `build-overture-buildings.ps1`
first makes a state-clipped lookup from exact root OpenStreetMap way lineage,
excludes ambiguous IDs, then rebuilds the same OSM geometry. A current typed
OSM `building` value always wins; only a current `building=yes` way receives
`overture_use`, `overture_subtype`, `overture_id`, and `overture_release`.
Relations and unmatched ways remain unchanged. The candidate is written under
`out/h14/`; the script never replaces the served archive.

The build requires the local Overture GeoParquet, its offline DuckDB spatial
extension directory, the same California OSM PBF and Planetiler JAR used by the
base archive, Python with DuckDB, and JDK 21. Pass those paths explicitly:

```powershell
./tools/basemap/build-overture-buildings.ps1 `
  -OverturePath <overture-buildings.geoparquet> `
  -OsmPath <us_california.osm.pbf> `
  -PlanetilerJar <planetiler-0.9.0.jar> `
  -PythonPath <python-with-duckdb.exe> `
  -JavaHome <jdk-21> `
  -DuckDbExtensions <duckdb-extensions> `
  -OutputDirectory <candidate-output-directory>
```

Review `lookup-manifest.json` and `build-manifest.json`, then publish the
candidate archive through the deployment's normal artifact process. Configure
the release beside the URL so the map displays accurate Overture attribution:

```html
<script>
  window.OPENEOC = {
    OPENEOC_BUILDINGS_PMTILES_URL: "https://<host>/buildings.pmtiles",
    OPENEOC_BUILDINGS_OVERTURE_RELEASE: "2026-08-19.0"
  };
</script>
```

The Windows desktop launcher reads the release only from
`web/public/basemap/buildings-overture.json` after verifying the installed
archive's byte count and SHA-256 with a bounded-memory stream. Install this
sidecar beside `buildings.pmtiles`:

```json
{
  "release": "2026-08-19.0",
  "archive_sha256": "<sha256 of the installed buildings.pmtiles>",
  "archive_bytes": 343283882
}
```

A plain OSM archive needs no sidecar and makes no Overture attribution claim.
If a sidecar is malformed or no longer matches the archive, the launcher logs
a diagnostic, omits the release claim, and continues serving the archive.

The COP then draws footprints colored by use (residential, commercial,
industrial, civic, religious, agricultural; untyped footprints neutral) from
zoom 13, with a Building use legend, and colors any footprint by the status
of the point record that falls inside it (a damage assessment, a field
report), the way the commercial COPs show impacted structures. Untyped
footprints remain neutral when no verified exact-way enrichment exists or the
source subtype is outside the documented crosswalk.

### Verify the local buildings archive

With the street and building archives in `web/public/basemap/`, run
`pnpm --dir web exec vite --host 127.0.0.1 --port 5173 --strictPort`, then
`node tools/basemap/prove-buildings.mjs` from the repository root. The proof
uses the existing server Playwright dependency and installed Chrome; set
`OPENEOC_CHROMIUM` to an executable path if Chrome is elsewhere. An optional
first argument selects another local testbed URL.

The proof renders Eureka at zoom 15 in both themes, checks typed and untyped
footprints, promoted OSM IDs, attribution, the Building use legend, and the
Buildings group toggled off and back on. Both archives must return HTTP 206;
external requests and browser/map errors fail the run. Four PNGs and
`evidence.json` land in `tools/basemap/out/proof-9b/` (gitignored).
This verifies archive rendering, not the live record-to-building status join.
That integration still requires board records from a running backend.

To check a candidate Overture archive before it replaces the shipped one, run
`node tools/basemap/prove-overture-buildings.mjs` with `OPENEOC_H14_ARCHIVE`
naming the candidate PMTiles, `OPENEOC_CHROMIUM` and `OPENEOC_SHOT_DIR` set;
it serves the candidate through its own Vite testbed and writes its evidence
under the shot directory.

## 9. California road jurisdiction and public land overlays

Run `node tools/basemap/build-overlays.mjs` (or `overlays.sh`) on the build
machine with Node, Java 21, GDAL and the existing Planetiler JAR available.
Set `OPENEOC_JAVA`, `OPENEOC_OGR2OGR`, `OPENEOC_OGRINFO` and
`OPENEOC_PLANETILER_JAR` when those tools are not on PATH. The default build
covers California; `OPENEOC_OVERLAY_BBOX=west,south,east,north` restricts it
to a chosen build extent. This reference archive does not define an incident
operational area. Output stays under `tools/basemap/out/`. ZIP source
inspection also uses the operating system tar command; GDAL reads archives
directly without extraction. Builds fetch current data by default. To resume
an interrupted build using its validated source cache, set
`OPENEOC_OVERLAY_RESUME=1`; the manifest retains per-source validation times.

Host `overlays.pmtiles` with byte ranges and its adjacent
`overlays-manifest.json`. Configure:

```js
window.OPENEOC = {
  OPENEOC_OVERLAYS_PMTILES_URL: "/basemap/overlays.pmtiles",
  OPENEOC_MAP_BOUNDS: "-124.5,32.5,-114.1,42.01"
};
```

The manifest URL is derived from the archive URL; override it with
`OPENEOC_OVERLAYS_MANIFEST_URL`. Each overlay control shows its source
coverage, with unavailable layers disabled. Without a manifest, coverage
is explicitly unverified. Overlay feature clicks inspect source attributes.
Map bounds configure the current fallback view; Home returns to that extent.
They are not incident scope or access control. Incident-selected operational
areas and shared participant records have separate acceptance gates in the
continuation roster. The map remains available before operational records exist.
These overlays also mount on a configured external basemap style.

State highways and the USFS, BLM and NPS road layers use source agency,
jurisdiction or maintainer fields. They do not establish legal ownership.
CAL FIRE public-land polygons retain all seven published ownership levels;
unmapped land is not classified as private. This archive has no dedicated
tribal-road adapter; that data gap does not exclude tribal nations or their
authorized contributions from incident operations.

The manifest retains service copyright text and source URLs. Generated data
is a local deployment artifact, outside the software license. Review the
[CAL FIRE conditions of use](https://www.fire.ca.gov/conditions-of-use) and
its named input sources before redistributing a compiled data pack; its
general public-domain statement does not grant rights to third-party inputs.

The default county-road adapter covers Humboldt only. Other California
jurisdictions use `OPENEOC_COUNTY_ROADS_CONFIG`, a JSON array of county source
definitions with name, path, sourceUrl, attribution, jurisdictionField,
countyValues, fields and a fieldMap with id, roadName and roadClass source
field names. The builder validates named fields, selects explicit
county-jurisdiction values, reprojects and clips to California and the build
extent. The manifest records exactly which counties contributed data.
The geographic build envelope is statewide; county source availability is
reported separately. This does not establish multi-organization incident
workflow parity. Do not treat a missing layer as zero roads or zero risk.

With the Vite testbed running, `node tools/basemap/prove-overlays.mjs`
checks both themes over California, Humboldt and San Diego, plus a Nevada
interior exclusion check, including real
archive range responses, source coverage, independent toggles and no external
requests. Its PNGs and JSON receipt land in `out/proof-8/`.
`node tools/basemap/prove-overlay-modes.mjs` additionally verifies external
style mounting and late coverage disabling previously selected empty layers.
It expects a real regional archive and manifest at
`out/proof-8-san-diego-pack/` with empty NPS and county layers. Its minimal
external style is a UI test fixture, not a visual-parity reference.

## 10. Offline address search gazetteer

The command bar's address search reads a gazetteer file on the server, built
from the street basemap archive of step 1. Build it on the same machine, with
Node only (no network, no other tools):

```
node tools/basemap/build-gazetteer.mjs tools/basemap/out/california.pmtiles
```

Options:

- `--out <file>` writes elsewhere; the default is
  `tools/basemap/out/gazetteer.tsv` (gitignored). The file is written beside
  the target and renamed into place, so a failed build never leaves half a file.
- `--addresses <file>` merges county address points (below).
- `--zoom <z>` reads another zoom level; the default is the archive's highest,
  14 for the planetiler output, which holds every house number.

The archive must be the OpenMapTiles-schema street basemap. The bundled
Natural Earth basemap has no streets and gives an almost empty gazetteer.

For California the build reads 212,094 tiles in about 30 seconds and writes
about 144 MB: 7,636 places, 511,673 named streets, 308,390 points of interest
and 3,230,662 house numbers. It prints these counts as JSON when it finishes.

What the file holds:

- **Places**: cities, towns, villages, hamlets, suburbs, neighbourhoods,
  islands and other named places from the `place` layer (not states or
  countries).
- **Streets**: every named road, path and ferry from `transportation_name`,
  with a road known only by its route number (such as `101`) under that
  number. Pieces of one street within about 2 km of each other are one entry.
- **Points of interest**: named features from the `poi`, `aerodrome_label`
  and `mountain_peak` layers.
- **House numbers**: from the `housenumber` layer, each attached to the nearest
  named street (not a path, track or ferry) within about 120 m in the same
  tile. A number with no such street is dropped; statewide that is 41,646
  numbers, about 1.3 percent.

Each street and point of interest names the nearest town. That is the nearest
settlement point, not the city whose limits hold the address.

Not included: unit numbers, ZIP codes, reverse lookup (coordinates to an
address), and anything unnamed. House number coverage is what OpenStreetMap
holds, which is far from complete in rural counties. When a searched number is
missing, the search still offers the street.

### County address points

`--addresses` takes either a CSV with a header row naming `number`, `street`,
`city` (optional), `lon` and `lat` in any order, or a GeoJSON file of points
with `number`, `street` and `city` properties. Coordinates are WGS84 longitude
and latitude; reproject a county export (often State Plane) before the build.
A point joins the OpenStreetMap street of the same name within about 2 km, and
a county number replaces the OpenStreetMap one for the same house. A point on
a street OpenStreetMap does not have starts a new street entry. Rows without a
number, a street or valid coordinates are skipped and counted.

No county address point file ships with the repository, so the merge is
tested with fixtures only. Check the first real county file against the
printed counts before publishing it.

### Serve it

Copy the file to the API server and set `OPENEOC_GAZETTEER_PATH` to its path
(see the [configuration reference](../../deploy/README.md#configuration-reference)).
The server reads it once at startup, which for California takes about 3
seconds and adds about 230 MB of memory (the file itself plus its word index).
Restart the server after replacing the file. Without the variable, or with an
unreadable file, the server logs a warning, keeps running, and the search box
tells operators that address search is unavailable. A loaded gazetteer
answers a typical search in 3 ms or less and a short prefix such as `san fr`
in about 15 ms.

The gazetteer is a derived OpenStreetMap database under the ODbL, like the
street tiles: keep it a deployment artifact and keep the OpenStreetMap
attribution with any copy you distribute.

## 11. California critical facilities

`build-facilities.mjs` builds the statewide critical facilities layer with
Node only (no Java, no GDAL): `facilities.pmtiles` and
`facilities-manifest.json`. It needs the street basemap of step 1, whose
OpenStreetMap points fill the types no federal source covers.

```
node tools/basemap/build-facilities.mjs [outDir] --cache <folder outside the repository>
```

The output lands in `tools/basemap/out/` unless a directory is given; copy
both files to `web/public/basemap/` (they are not tracked). Downloads go to
the cache folder (default `<outDir>/facilities-cache`, or
`OPENEOC_FACILITIES_CACHE`), each with a receipt naming its URL, retrieval
time, byte size and SHA-256. A rerun reuses every cached file that still
matches its receipt, so an interrupted build resumes where it stopped;
`--refresh` fetches everything again. No
download needs an account or a key, and the builder refuses any single file
over 1 GB. The source URLs, several of which name a release (the CMS monthly
files, the FAA 28-day cycle, the EIA and NBI years), are in the `SOURCES`
list and `readSources`; update them there for a newer release.

| Types | Source | License |
|---|---|---|
| Hospitals, ambulance services, fire and EMS stations, police, prisons, schools, colleges, town halls, courthouses, State Capitol | USGS National Structures Dataset, through The National Map structures service | Public domain |
| State EOC | FEMA State Emergency Operations Centers | Public domain |
| Nursing homes; dialysis facilities | CMS Provider Data Catalog, placed along Census TIGER/Line address ranges (CMS gives dialysis addresses only and rounds nursing home longitudes) | Public domain |
| Power plants | EIA-860 | Public domain |
| Wastewater (POTW), drinking water treatment plants, RCRA hazardous waste handlers | EPA Facility Registry Service | Public domain |
| Communications towers | FCC Antenna Structure Registration | Public domain |
| Airports, heliports | FAA NASR | Public domain |
| Dams | USACE National Inventory of Dams | Public domain |
| Bridges | FHWA National Bridge Inventory | Public domain |
| Ports | BTS principal ports | Public domain |
| Pharmacies, urgent care, and places the federal layers miss | OpenStreetMap points in the street basemap | ODbL |

HIFLD Open is gone and Esri-hosted copies are not used. Substations have no
usable source and are left out; the manifest says so, with each type's
coverage and gaps, the counts per type and source, and the counts for
Humboldt and Del Norte counties.

Every facility carries `type` (one of 24), its FEMA Community `lifeline`,
CISA `sector`, `name`, `subtype`, `source`, `source_id`, and where the
source has them `address`, `city`, `county`, `phone`, `operator`, `capacity`
and `capacity_unit`. A facility of the same type from another source within
150 m, or within 1 km with the same name, is a duplicate: federal records
are kept whole and the OpenStreetMap point that repeats one is dropped.
Records of one federal source never merge with each other.

The archive has two layers: `facilities` (every point, zooms 12 to 14) and
`facility_clusters` (zooms 6 to 11: a grid of 8 cells per tile side, each
cluster with its `count`, dominant `lifeline` and a count per lifeline), so
the map can show density before icons. Tiles are gzip-compressed MVT.

The Windows launcher sets `OPENEOC_FACILITIES_PMTILES_URL` when
`basemap/facilities.pmtiles` is installed, from a map data packet or the
setup's public files, and `OPENEOC_FACILITIES_MANIFEST_URL` when the
manifest is beside it. The setup's optional basemaps and the map data packet
carry both files.

The federal records are public domain; the OpenStreetMap records are ODbL,
so the archive is a derivative database of OpenStreetMap and keeps the
OpenStreetMap attribution. The layer is reference data, not an
authoritative inventory. `build-facilities.test.mjs` covers the source
readers, duplicates, clusters and the archive on small fixtures.

## 12. California boundaries, tribal lands and risk layers

`build-reference-layers.mjs` builds two archives with Node only, tiling with
the `geojson-vt` and `vt-pbf` packages MapLibre already carries:
`boundaries.pmtiles` with `boundaries-manifest.json`, and `risk.pmtiles` with
`risk-manifest.json`.

```
node tools/basemap/build-reference-layers.mjs [outDir] --cache <folder outside the repository>
```

Output, cache and receipts work as in section 11 (cache default
`<outDir>/reference-cache`, or `OPENEOC_REFERENCE_CACHE`; `--refresh` fetches
again; no file over 1 GB). Copy the four files to `web/public/basemap/`. The
largest download is the Risk Index tract table, 635 MB.

| Data | Source | License |
|---|---|---|
| Tribal areas (`aiannh`) | Census TIGER/Line 2025 American Indian, Alaska Native and Native Hawaiian Areas | Public domain |
| Trust and restricted land (`bia_lar`) | BIA AIAN Land Area Representations, from BIA's own map service | Public domain; BIA's no-legal-inference disclaimer, recorded in full in the manifest |
| Counties, places, tracts | Census 2025 Cartographic Boundary Files, 1:500,000 (TIGER/Line clipped to the shoreline) | Public domain |
| `nri_tracts`, `nri_counties` | FEMA National Risk Index v1.20 tables, from OpenFEMA | FEMA's terms: the non-endorsement statement travels in the archive attribution and the manifest |
| `svi_tracts`, `svi_counties` | CDC/ATSDR SVI 2022, United States database | CDC: no constraints or limitations |

Esri-hosted copies are not used. Tribal polygons are kept whole where at
least 5 percent of their area lies in a California county, so a reservation
across the state line keeps its full extent; parts wholly outside are left
out. The `aiannh` layer carries the Census class code (`classfp`) and Esri's
class (`class`: federal reservation or off-reservation trust land, joint-use,
state, ANVSA, Hawaiian home land, OTSA, TDSA, SDTSA) with its label. Places
carry `kind` (city, town or cdp). The `labels` layer has one point inside
each area of every boundary layer, with its layer, id, name, class or kind,
and area in square kilometers.

The risk layers keep FEMA's and CDC's field names: `RISK_SCORE`,
`RISK_RATNG`, `EAL_RATNG`, `SOVI_RATNG`, `RESL_RATNG` and the hazard ratings
`ERQK_RISKR`, `TSUN_RISKR`, `WFIR_RISKR`, `IFLD_RISKR` (inland flooding,
riverine before v1.20), `CFLD_RISKR`, `LNDS_RISKR`, `WNTW_RISKR`,
`HWAV_RISKR`; and `RPL_THEMES` with `RPL_THEME1` to `RPL_THEME4` (CDC's -999
left out). Tables join to Census geometry by GEOID; the manifest counts what
did not join.

Zooms: boundary layers z4 to z12 (places from z6); risk counties z4 to z8 and
tracts z8 to z12, both in the z8 tiles so a style can switch near z8.5 as
Esri does. Each zoom is simplified to under half a pixel, so one geometry
serves as the detailed and generalized pair. The manifests list the layers,
counts, joins, the tribal areas and places in Humboldt and Del Norte, and the
two counties' ratings.

The Windows launcher sets `OPENEOC_BOUNDARIES_PMTILES_URL`,
`OPENEOC_BOUNDARIES_MANIFEST_URL`, `OPENEOC_RISK_PMTILES_URL` and
`OPENEOC_RISK_MANIFEST_URL` when the files are installed, as for facilities.
`build-reference-layers.test.mjs` covers the polygon readers, the California
clip, the classes, the joins and the archive on small fixtures.

## Attribution

OpenStreetMap data is ODbL: the map must display "© OpenStreetMap contributors".
The app adds this automatically whenever the PMTiles basemap is active. Gallery
rasters and the DEM carry the attribution you configure, shown while visible.
