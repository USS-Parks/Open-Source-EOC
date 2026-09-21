# Asset licenses and provenance

Status: 2026-09-21. H13 begins this inventory and D05 extends it. D30 may
extend it when it adds export assets.

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
| NAPSG MapLibre facility sprite | `web/public/napsg/sprite.json`, `sprite.png`, `sprite@2x.json`, `sprite@2x.png` | `deploy/basemap/build-napsg-sprite.mjs` deterministically builds both pixel ratios from the manifest-verified originals. Every sprite entry carries NAPSG attribution, CC BY 4.0 license URL, original source URL, and source SHA-256. | Distributed with local license text. |
| Runtime hazard hatches | `web/src/cop/hazards.ts` | Generated in code from project-owned drawing instructions; there is no separate image asset. | Distributed as software under the repository license. |
| D05 application icon family | `web/src/design/icons/` | Original Open Source EOC SVG path geometry. The repository's Apache-2.0 `LICENSE` and `NOTICE` are local license text. | Distributed as software under Apache-2.0. |

## D05 application icons

The D05 navigation, action, and community-lifeline symbols are original project
artwork expressed as local SVG drawing instructions. The canonical design
screenshots informed the compact scale, rounded stroke treatment, and familiar
lifeline concepts; no third-party icon file was copied or redistributed.

These application icons are distinct from the H13 NAPSG facility symbols.
NAPSG sprites retain their own CC BY 4.0 provenance and operational map meaning;
the D05 registry does not replace or relicense them.

## H13 NAPSG facility symbols

Nine original 128 × 128 PNGs are distributed in `web/public/napsg/` with the
complete CC BY 4.0 legal text and `acquisition-manifest.json`. The files are
unmodified copies selected from the NAPSG Foundation v4.1.5 JSON catalog.
The same directory contains deterministic 1x and 2x MapLibre sprite PNG/JSON
pairs built offline by `deploy/basemap/build-napsg-sprite.mjs`.
The source page states that its standardized symbology is available for
commercial use under the Creative Commons Attribution 4.0 International
License. The application attributes the symbols to NAPSG Foundation in the
facility legend and keeps type separate from operational status.

The catalog records `creation_date` as 2020-02-06 09:21:12. This is catalog
metadata, not the download time. The manifest records the controlled local
acquisition at 2026-09-21T21:22:18.5843612Z.

| Evidence | Source or repository path | SHA-256 |
|---|---|---|
| NAPSG v4.1.5 catalog | `https://napsg-web.s3.amazonaws.com/symbology/napsg_symbology_v4.1.5.json` | `2393DA796A96D4E077A23BF9F51B03165F75CE8C2539E8D790F0DD99AAAE8313` |
| NAPSG attribution and commercial-use statement | `https://www.napsgfoundation.org/symbology/` (acquisition snapshot: `deploy/basemap/out/napsg-input/napsg-attribution-source.html`) | `FAAA4F52246F1F4F750297738DEBD4F10FDA3E3EA5E17602923C4F9EDE1C3041` |
| CC BY 4.0 legal text | `web/public/napsg/CC-BY-4.0.txt`, source `https://creativecommons.org/licenses/by/4.0/legalcode.txt` | `9BA9550AD48438D0836DDAB3DA480B3B69FFA0AAC7B7878B5A0039E7AB429411` |
| Acquisition and per-file provenance | `web/public/napsg/acquisition-manifest.json` | Recorded with the distributed files |

| Application type | Distributed file | Original catalog path | SHA-256 |
|---|---|---|---|
| Hospital | `hospitals.png` | `infrastructure/CRTINS_PUBHTH/Hospitals_128x128.png` | `06A512262F74BBFB29AA1FA8B31E07C6E96A45021C8396F21B2CD2EA9ED14CC3` |
| Urgent-care facility | `urgent-care-facilities.png` | `infrastructure/CRTINS_PUBHTH/Urgent-Care-Facilities_128x128.png` | `95720AD846A82EE96D5C134EBF44A5E1DD28635C3D29B747AF899C0DE916CA45` |
| Fire station | `fire-station.png` | `infrastructure/CRTINS_EMRSVC/Fire-Station_128x128.png` | `C6455836513404646D2C28E03A3A0CFE1B2BC99CCA40C72F7C2FFD7C40AA7522` |
| Law enforcement | `law-enforcement-locations.png` | `infrastructure/CRTINS_LAWENF/Law-Enforcement-Locations_128x128.png` | `C3519CD9FF1AF7B824BFCD2E738369835DB44E71F6A674B98F1972BD66B38B05` |
| School | `public-schools.png` | `infrastructure/CRTINS_EDUCAT/School_128x128.png` | `C4722ACE5E9FC51749E26972DC0DBF8F68DB141BE533E7A9DDE51C8EDA3AD0E5` |
| Shelter | `national-shelter-system-facilities.png` | `infrastructure/CRTINS_EMRSVC/Emergency-Shelter_128x128.png` | `554879D21ADB9D0B776489B0C91A76EB1F7B41B13A62CCA2897BEA0637607C70` |
| Local EOC | `local-emergency-operations-center-eoc.png` | `infrastructure/CRTINS_EMRSVC/Local-Emergency-Operation-Centers-EOC_128x128.png` | `F3F59993D29215EBB1B8A6173B92DA9A3C4372D1BD34A556A1AE727807F945AC` |
| Commercial airport | `aircraft-landing-facilities-commercial.png` | `infrastructure/CRTINS_TRNAIR/Airport--Commercial_128x128.png` | `B13E399531F1E8EA6106F29647D2FCF1AB3404DE93312028F8952FF0A77A4B4E` |
| Heliport | `aircraft-landing-facilities-heliport.png` | `infrastructure/CRTINS_TRNAIR/Airport--Heliport_128x128.png` | `2F8DBFFBDB32EB91C2FE1E17C3B2A6CB2C363522AF2FF4368545E2EF89F1C98F` |

The mapping is deliberately exact. Generic OpenMapTiles `clinic`, `townhall`,
`community_centre`, and `airport` values do not prove urgent care, an EOC, or
a commercial airport, so they keep their text labels without receiving those
symbols. HIFLD `NAICS_DESC` is accepted only when it exactly matches a selected
catalog label. Unrecognized types and absent or stale operational status remain
unknown.
