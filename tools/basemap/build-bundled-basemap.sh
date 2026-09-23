#!/usr/bin/env bash
# Regenerate the bundled offline vector basemap from the toolchain.
#
# Produces web/public/basemap/basemap.pmtiles and the label glyph stack under
# web/public/fonts, from Natural Earth 10m (public domain) clipped to
# California, plus the CA county outlines already in web/public/basemap. This is
# the low-detail offline default that ships in the app; for street-level detail
# a deployment hosts full OpenStreetMap tiles (see generate-california.sh).
#
# Requirements:
#   - tippecanoe (https://github.com/felt/tippecanoe): git clone && make && make install
#   - node with the 'fontnik' package available (npm i fontnik)
#   - a TrueType font for labels (defaults to Liberation Sans, SIL OFL)
#
# Usage (from the repository root):
#   tools/basemap/build-bundled-basemap.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUB="${ROOT}/web/public"
WORK="$(mktemp -d)"
RAW="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
FONT="${FONT_TTF:-/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf}"
FONT_STACK="Liberation Sans Regular"
# California bounding box (lon/lat).
BBOX="-124.6,32.4,-114.0,42.2"

echo "Fetching Natural Earth 10m layers..."
for f in ne_10m_land ne_10m_lakes_north_america ne_10m_rivers_north_america \
         ne_10m_urban_areas ne_10m_roads ne_10m_populated_places; do
  curl -fsSL "${RAW}/${f}.geojson" -o "${WORK}/${f}.geojson"
done

echo "Tiling to PMTiles with tippecanoe (clipped to California)..."
tippecanoe -o "${PUB}/basemap/basemap.pmtiles" -f \
  --clip-bounding-box="${BBOX}" \
  -Z0 -z10 --drop-densest-as-needed --extend-zooms-if-still-dropping --no-tile-size-limit \
  -L land:"${WORK}/ne_10m_land.geojson" \
  -L water:"${WORK}/ne_10m_lakes_north_america.geojson" \
  -L rivers:"${WORK}/ne_10m_rivers_north_america.geojson" \
  -L urban:"${WORK}/ne_10m_urban_areas.geojson" \
  -L roads:"${WORK}/ne_10m_roads.geojson" \
  -L counties:"${PUB}/basemap/ca_counties.geojson" \
  -L places:"${WORK}/ne_10m_populated_places.geojson"

echo "Generating label glyphs from ${FONT}..."
FONT_TTF="${FONT}" FONT_STACK="${FONT_STACK}" OUT="${PUB}/fonts" \
  node "${ROOT}/tools/basemap/build-glyphs.mjs"

rm -rf "${WORK}"
echo "Done: web/public/basemap/basemap.pmtiles and web/public/fonts/${FONT_STACK}"
