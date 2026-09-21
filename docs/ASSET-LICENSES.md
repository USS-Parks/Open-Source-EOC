# Asset licenses and provenance

Status: 2026-09-21. H13 begins this inventory. D05 and D30 may extend it when
they add icons or export assets.

This file distinguishes assets that are actually distributed by this repository
from deployment-supplied assets and references recorded in project planning.
The repository's Apache-2.0 `LICENSE` covers the Open Source EOC software; it
does not establish the license of a separately sourced map, font, or symbol.

## Evidence labels

- **Local license text** means the applicable license terms are present in the
  repository beside, or explicitly covering, the distributed asset.
- **Project-recorded** means a checked-in build file or project handoff states
  the source or license, but the upstream asset license is not vendored here.
- **Deployment-supplied** means the repository provides configuration or a build
  seam while the deployment owns the source files and their redistribution
  review.
- **Absent** means no asset or usable license evidence is distributed.

## Distributed and configured assets

| Asset or seam | Repository location | Recorded provenance and license evidence | Distribution state |
|---|---|---|---|
| Open Source EOC software | `LICENSE`, `NOTICE` | Apache License 2.0 and project notice are present as local license text. | Distributed. This does not license third-party assets. |
| Bundled California basemap | `web/public/basemap/` | `deploy/basemap/build-bundled-basemap.sh` records Natural Earth 10m and California county boundaries; `deploy/basemap/README.md` identifies Natural Earth and US Census inputs as public domain. No separate upstream license text is vendored. | Distributed; provenance and public-domain status are project-recorded. |
| Liberation Sans glyph PBFs | `web/public/fonts/Liberation Sans Regular/` | The build script and basemap README identify Liberation Sans and state SIL OFL. The source TTF and an OFL text are not present. | Distributed derivative glyphs; license is project-recorded, without local upstream license text. |
| Self-hosted OpenStreetMap street and building tiles | `deploy/basemap/generate-california.sh`, `deploy/basemap/buildings-schema.yml` | The deployment guide records OpenStreetMap ODbL attribution and requires the map to display `© OpenStreetMap contributors`. The generated statewide archives are not tracked. | Deployment-supplied. |
| Optional MapLibre sprite | `web/src/cop/streetstyle.ts`, `deploy/basemap/README.md` | A runtime sprite base URL and generic `spreet` instructions exist. No sprite image, metadata, source icon set, or icon license is tracked. | Configuration seam only. |
| Runtime hazard hatches | `web/src/cop/hazards.ts` | Generated in code from project-owned drawing instructions; there is no separate image asset. | Distributed as software under the repository license. |

## H13 NAPSG facility symbols

The agreed facility subset is hospital, clinic, fire station, police, school,
shelter, emergency operations center, airport, and helipad. Correct rendering
requires the actual selected symbols, an asset-identifier mapping for those
types, and license and attribution evidence for the supplied files.

The local inventory found none of the following:

- NAPSG PNG or SVG symbol files;
- a NAPSG catalog JSON file;
- MapLibre `sprite.json`, `sprite.png`, or their 2x variants built from NAPSG;
- a symbol-to-facility-type manifest;
- NAPSG license text or an attribution file;
- the previously proposed `deploy/basemap/build-napsg-sprite.mjs`.

The checked-in `docs/VEOC-77-HANDOFF-PSPR-2026-09-20.md` records, from its
2026-09-20 inspection, the catalog URL
`https://napsg-web.s3.amazonaws.com/symbology/napsg_symbology_v4.1.5.json` and
PNG base path `https://napsg-web.s3.amazonaws.com/symbology/data/PNG9/`. It also
records “CC BY 4.0 per napsgfoundation.org; attribution required.” That is a
project-recorded observation, not locally vendored license evidence. H13 made
no network request and did not download either location.

The current street style remains a text-only facility label. It reads the real
OpenMapTiles `poi.subclass` field for its explicit facility filter; it does not
use `icon-image` or claim those labels are NAPSG symbols. The catalog's HIFLD
critical-facilities entry maps its category from `properties.NAICS_DESC`, but
no local source sample or inspected value vocabulary establishes a safe mapping
from those values to the agreed symbol subset. Operational record status stays
on the existing explicit status mapping, where absent or unrecognized values
remain `unknown`.

H13's symbol, legend, and inspection acceptance gate is therefore blocked. A
generic icon replacement would not satisfy it. The gate can resume after the
selected assets, exact identifier mapping, upstream license text, required
attribution, and a provenance manifest are supplied locally or a separate
outbound acquisition is approved.
