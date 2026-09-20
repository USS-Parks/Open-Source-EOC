# Basemaps

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
2. **Self-hosted street basemap (deploy-time).** Full OpenStreetMap street-level
   detail for California, hosted by the deployment. This is the ArcGIS-grade
   basemap: streets, buildings, terrain context, place and road labels, under
   the ODbL. The rest of this document covers it. The style is
   `web/src/cop/streetstyle.ts`.

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
deploy/basemap/generate-california.sh
```

This uses [planetiler](https://github.com/onthegomap/planetiler) to download the
California extract from Geofabrik and write `california.pmtiles` in the
OpenMapTiles schema, which the app's street style is written against. Output
lands in `deploy/basemap/out/` (gitignored) unless a directory is given. For a
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

## 3. Build a sprite (optional icons)

Point-of-interest icons are optional; without a sprite the map still renders
every road, boundary, and label. To add icons, build a sprite from an SVG set
with [`spreet`](https://github.com/flother/spreet):

```
spreet ./icons ./sprite
```

Serve `sprite.json` and `sprite.png` under a base URL (e.g. `https://<host>/sprite`).

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

The COP then draws footprints colored by use (residential, commercial,
industrial, civic, religious, agricultural; untyped footprints neutral) from
zoom 13, with a Building use legend, and colors any footprint by the status
of the point record that falls inside it (a damage assessment, a field
report), the way the commercial COPs show impacted structures. Untyped
footprints are common in bulk imports; a later roster prompt adds Overture
Maps building subtypes for coverage.

## Attribution

OpenStreetMap data is ODbL: the map must display "© OpenStreetMap contributors".
The app adds this automatically whenever the PMTiles basemap is active. Gallery
rasters and the DEM carry the attribution you configure, shown while visible.
