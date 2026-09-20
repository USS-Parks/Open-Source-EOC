#!/usr/bin/env bash
# Build California jurisdiction overlays into a deploy-time PMTiles archive.
# Requires Node 24, GDAL/PROJ, Java 21, tar for ZIP listing, and Planetiler 0.9.0.
# Optional environment:
#   OPENEOC_OVERLAY_BBOX=west,south,east,north (within California)
#   OPENEOC_COUNTY_ROADS_CONFIG=/path/to/county-sources.json
#   OPENEOC_OVERLAY_RESUME=1 to reuse validated source inputs after interruption
#   OPENEOC_JAVA, OPENEOC_OGR2OGR, OPENEOC_OGRINFO, OPENEOC_PLANETILER_JAR
# Default county source is Humboldt only. The manifest states its coverage.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${here}/build-overlays.mjs" "${1:-${here}/out}"
