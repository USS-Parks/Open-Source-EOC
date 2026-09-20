#!/usr/bin/env bash
# Generate a self-hosted California street basemap as PMTiles (VEOC-74).
#
# This runs on a build machine with network access and disk, NOT inside a
# constrained CI sandbox: it downloads a ~1 GB OpenStreetMap extract and writes
# a multi-GB tile archive. Output is OpenMapTiles-schema vector tiles that the
# app renders through web/src/cop/streetstyle.ts.
#
# Requirements:
#   - Java 21+ (planetiler is a single JAR; it downloads the OSM extract itself)
#   - ~10 GB free disk and ~4 GB RAM for a state-sized build
#
# Usage:
#   deploy/basemap/generate-california.sh [output_dir]
#
# The default output directory, deploy/basemap/out, is gitignored: the tiles
# are a deploy artifact, never a committed file.
#
# The result, california.pmtiles, is served over HTTP with range requests and
# wired into the app via the OPENEOC_BASEMAP_* settings (see README.md).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-${HERE}/out}"
PLANETILER_VERSION="0.9.0"
PLANETILER_JAR="planetiler-${PLANETILER_VERSION}.jar"
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"

mkdir -p "${OUT_DIR}"
cd "${OUT_DIR}"

if ! command -v java >/dev/null 2>&1; then
  echo "error: Java 21+ is required (planetiler is a Java tool)." >&2
  exit 1
fi

if [ ! -f "${PLANETILER_JAR}" ]; then
  echo "Downloading planetiler ${PLANETILER_VERSION}..."
  curl -fSL "${PLANETILER_URL}" -o "${PLANETILER_JAR}"
fi

# --download fetches the California extract from Geofabrik; --area names it
# by its Geofabrik path ("california" alone is ambiguous in Geofabrik's index).
# The OpenMapTiles profile is planetiler's default schema, which our style
# (streetstyle.ts) is written against.
echo "Building california.pmtiles (this takes several minutes)..."
java -Xmx4g -jar "${PLANETILER_JAR}" \
  --download \
  --area=us/california \
  --output=california.pmtiles \
  --force

# Second archive: building footprints classed by their OpenStreetMap building
# tag and keyed by osm_id (buildings-schema.yml), for the COP's building-use
# delineation and per-building status coloring. Reuses the extract just
# downloaded. Skip with OPENEOC_SKIP_BUILDINGS=1.
if [ "${OPENEOC_SKIP_BUILDINGS:-0}" != "1" ]; then
  echo "Building buildings.pmtiles..."
  java -Xmx4g -jar "${PLANETILER_JAR}" generate-custom \
    --schema="${HERE}/buildings-schema.yml" \
    --output=buildings.pmtiles \
    --force
fi

echo
echo "Done: ${OUT_DIR}/california.pmtiles"
echo "      ${OUT_DIR}/buildings.pmtiles (unless skipped)"
echo "Next: build a glyph stack and (optionally) a sprite, host all three over"
echo "HTTP with range requests, and set the OPENEOC_BASEMAP_* settings."
echo "See deploy/basemap/README.md."
