# Self-hosted street basemap (California)

The common operating picture ships with an offline fallback basemap (Natural
Earth plus US county boundaries), which is deliberately low detail. For
street-level detail, terrain context, and place labels, a deployment hosts its
own OpenStreetMap-derived vector tiles as a PMTiles archive. This keeps the map
self-hosted, offline-capable, and license-clean (OpenStreetMap data under the
ODbL), with no third-party tile provider, API key, or usage terms.

This directory produces that basemap for California and explains how to wire it
into the app.

## Why this is not built in CI

Generating statewide tiles downloads a roughly 1 GB OpenStreetMap extract and
writes a multi-GB archive. That exceeds a constrained CI sandbox's network and
disk, so tile generation is a build-machine job run out of band. The app code
that renders the tiles (`web/src/cop/streetstyle.ts`) is unit-tested in CI; the
tiles themselves are a deploy artifact, not committed to the repository.

## 1. Generate the tiles

On a machine with Java 21+, about 10 GB of free disk, and network access:

```
deploy/basemap/generate-california.sh ./basemap-out
```

This uses [planetiler](https://github.com/onthegomap/planetiler) to download the
California extract from Geofabrik and write `california.pmtiles` in the
OpenMapTiles schema, which the app's street style is written against. For a
different area, change `--area` in the script (any Geofabrik region name), or
point planetiler at a local `.osm.pbf` with `--osm-path`.

## 2. Build a glyph stack (labels)

Labels need a self-hosted glyph (font) stack served as PBF ranges. Use an
open-licensed font (for example Noto Sans, under the SIL Open Font License) and
a glyph builder such as [`build-glyphs`](https://github.com/gmac/build-glyphs)
or [`font-maker`](https://github.com/maplibre/font-maker):

```
npx build-glyphs NotoSans-Regular.ttf ./fonts/"Noto Sans Regular"
```

Serve the result so that `{fontstack}/{range}.pbf` resolves, e.g.
`https://<host>/fonts/{fontstack}/{range}.pbf`. The style requests the
`Noto Sans Regular` stack; match the directory name to that.

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
    OPENEOC_BASEMAP_GLYPHS_URL: "https://<host>/fonts/{fontstack}/{range}.pbf",
    // optional:
    OPENEOC_BASEMAP_SPRITE_URL: "https://<host>/sprite"
  };
</script>
```

When `OPENEOC_BASEMAP_PMTILES_URL` and `OPENEOC_BASEMAP_GLYPHS_URL` are set, the
app builds a themed street style over the PMTiles (`buildStreetStyle` in
`web/src/cop/streetstyle.ts`) and the COP renders a full street map, light and
dark, with the operational layers on top. Leave them unset and the app uses the
bundled offline basemap. A full external style URL
(`OPENEOC_BASEMAP_STYLE_URL`) still takes precedence over both.

## Attribution

OpenStreetMap data is ODbL: the map must display "© OpenStreetMap contributors".
The app adds this automatically whenever the PMTiles basemap is active.
