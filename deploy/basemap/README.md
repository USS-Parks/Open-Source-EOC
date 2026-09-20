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

On a machine with Java 21+ or Docker, about 10 GB of free disk, and network
access:

```
deploy/basemap/generate-california.sh
```

This uses [planetiler](https://github.com/onthegomap/planetiler) to download the
California extract from Geofabrik and write `california.pmtiles` in the
OpenMapTiles schema, which the app's street style is written against. With no
Java on the machine the script runs the same planetiler release in its Docker
image. Output lands in `deploy/basemap/out/` (gitignored) unless a directory is
given. For a different area, change `--area` in the script (any Geofabrik
region name), or point planetiler at a local `.osm.pbf` with `--osm-path`.

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

## Attribution

OpenStreetMap data is ODbL: the map must display "© OpenStreetMap contributors".
The app adds this automatically whenever the PMTiles basemap is active.
