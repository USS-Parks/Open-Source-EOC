# Open-Source-EOC parity capability matrix

Source-backed inventory of the assessed capabilities (VEOC-79E), reconciled
again on 2026-09-22 through `56d2558`. Each row ties
a canonical obligation or an assessed gap to the reference product it mirrors,
the primary source for that reference, the operator behavior expected, the
local implementation and its evidence, a current status, and the roster prompt
that owns it.

This matrix reconciles [FACET-STATUS.md](./FACET-STATUS.md): its `verified`
labels recorded earlier implementation gates, not demonstrated commercial-
product parity. Where local behavior is a completed increment but not full
parity, the status here is `partial` with the owning prompt named. Historical
receipts in [VEOC-EXECUTION-LEDGER.md](./process/VEOC-EXECUTION-LEDGER.md) are not
rewritten; overbroad status claims are corrected here, not erased there.

## Scope, exclusions, and rules

- **Public access is an intentional exclusion.** The platform is For Official
  Use Only; there is no anonymous or public-facing facet. Access is binary:
  members and authorized mutual-aid guests view their authorized incident and
  dashboard with role-based field restrictions; everyone else is denied.
  VEOC-80 database and browser evidence is integrated (`dac0667`).
- **Every included gap has an owner** (a roster prompt). A claim with no
  supporting evidence is recorded as `unknown`, not asserted.
- **A `verified` status** means a CI-green implementation gate was met and the
  behavior is not known to fall short of the referenced product at the depth
  assessed. It is not a commercial-parity certification; live-pilot and
  disconnected-provisioning gates remain with VEOC-85/86.

## Reference product key

| Key | Reference | Primary source |
|---|---|---|
| WebEOC-core | Juvare WebEOC (Nexus) core: boards, incidents, sharing, activity log | https://docs.juvare.com/webeoc-onnexa/ |
| WebEOC-inc | WebEOC incident model and incident-scoped board data | https://docs.juvare.com/webeoc-onnexa/help/incidents/about-incidents.htm |
| WebEOC-Maps | WebEOC Maps add-on (optional module) | https://docs.juvare.com/webeoc-onnexa/ |
| WebEOC-DS | WebEOC DesignStudio board authoring (optional module) | https://docs.juvare.com/webeoc-onnexa/ |
| Juvare-other | Separate Juvare products (e.g. eICS, EMResource, EMTrack), not WebEOC core | https://www.juvare.com/ |
| Esri-EMO | Esri Emergency Management Operations solution | https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-emergency-management-operations.htm |

Distinguishing the reference matters: capabilities that are separate Juvare
products or optional WebEOC modules are not part of WebEOC core and are marked
accordingly, so parity against "WebEOC" is not overstated.

## Facets (F1-F20)

| ID | Capability | Reference | Operator behavior | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|---|
| F1 | Versioned board schema, input + display views | WebEOC-core / WebEOC-DS | Admin defines a board; operators enter and view records | Board schema + runtime (VEOC-09/10); declarative layouts and upgrade preflight (`b7cb680`); operational record workspace (`48edf63`); structured designer, preview, immutable publication and safe apply (`75464fc`) | verified | - |
| F2 | Position login + immutable activity/position logs | WebEOC-core | Sign into a position; every action is attributed and logged | Positions, sign-in, append-only audit (VEOC-07/11); incident-position attribution extended (`ca0d130`) | verified | - |
| F3 | Store-and-forward federation, local replication | WebEOC-core | Agencies share boards across a federation boundary | Federation service and sharing agreements (VEOC-30) | verified | - |
| F4 | Board-triggered notifications, webhooks, multi-channel | WebEOC-core | A record change fires a notification/webhook | Notify + webhook delivery (VEOC-14) and governed workflow notifications (`6c8dddc`). Webhook delivery is still awaited in the write path, with no durable outbox or retry worker | partial | W2.1 |
| F5 | ICS forms, IAP builder, 213RR lifecycle | WebEOC-core | Build ICS forms and the operational-period IAP; run resource requests | Forms/IAP/resource lifecycle (VEOC-34/35); IAP now incident-context driven (`8c96103`) | verified | VEOC-84/84A |
| F6 | Any board as a live geospatial layer; field-to-COP loop | Esri-EMO / WebEOC-Maps | Drop a record on the map; it appears as a COP layer | VEOC-79B1/B2 deliver incident-tagged field capture, scoped reads/counts and partner isolation; VEOC-79C2 connects persisted datasets to COP layers; P-COP and D29 provide PostgreSQL/Chrome map inspection and field-capture evidence (`e20e772`, `d1c5d63`) | verified | - |
| F7 | Offline XLSForm-compatible smart forms | Esri-EMO (Field Maps/Survey123) | Fill a form offline; sync later | Smart forms + XLSForm subset (VEOC-22) and durable field reconciliation (`d1c5d63`); about 12 of about 25 question types, with no line/polygon/barcode/photo/audio/repeat depth | partial | W4.7 |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | Esri-EMO | Report lifeline status; produce PDA/declaration outputs | VEOC-20/23 provide eight Lifelines, immutable SITREPs, approved-assessment aggregation and declaration support. D13 and P-LIFE-1 through P-LIFE-4 add attributed assessments, independent ESF state, conflicts, actions, history and operational relationships. FEMA PA categories A-G and shelter-census depth remain open | partial | W3.2 / W3.4 |
| F9 | Pre-disaster baseline data for damage assessment | Esri-EMO | Compare damage against a pre-event baseline | VEOC-23 proves imported jurisdiction baselines, approved assessments, loss totals and declaration output. Spatial exposure and statewide building-type coverage do not populate damage replacement-cost baselines. Live parcel-roll ingestion and statewide cost coverage remain open | partial | W3.2 / pilot data acquisition |
| F10 | Always-on facility status networks + status queries | Juvare-other (EMResource) | Query facility status networks | Facility status + queries (VEOC-28) | verified | - |
| F11 | Scan-first tracking objects + reunification | Juvare-other (EMTrack) | Scan a tag; track custody; reunify | Tracking + reunification (VEOC-25) | verified | - |
| F12 | Incident templates instantiating ICS org + checklists | WebEOC-core | Activate an incident from a template with positions and checklists | Incident templates + checklists (VEOC-12); participation + authority added (`ca0d130`) | verified | - |
| F13 | Scenario/reference libraries, checklists | WebEOC-core | Attach scenario/reference libraries and run checklists | Libraries + checklists (VEOC-12), declarative due/category rules and attributed completion receipts (`ecd5249`), and assigned/offline task presentation (`d867488`) | verified | - |
| F14 | Calm-screen map-first SPA discipline | Esri-EMO | A map-first console that stays legible under stress | Map-first shell (VEOC-05/17), responsive operational frame (`ef13b0c`), persistent context (`64e3cf5`) and operational map workspace (`e20e772`) passed wide/narrow, light/dark and keyboard Chrome gates. Representative-operator acceptance remains D34, not a technical parity claim | verified | D34 acceptance |
| F15 | Per-incident auto-provisioned collaboration space | WebEOC-core | Activating an incident provisions its workspace | Collab provisioning (VEOC-32/33); incident context now drives the workspace (`8c96103`) | verified | - |
| F16 | One-click role-based provisioning; ten-minute viewer path | WebEOC-core | Provision a jurisdiction and admin in one action | One-action provisioning (VEOC-08/41) | verified | - |
| F17 | Daily-ops usability against skill decay | WebEOC-core | Routine daily-ops use keeps skills fresh | Responsive, persistent daily-ops workspaces and all planned Master PSPR surfaces are technically integrated through M3. No representative operator has established skill-retention or comparative workflow results | partial | D34 |
| F18 | Sensor and drone live feeds into the COP | Esri-EMO | External hazard/position feeds appear as COP layers | CAP/GeoRSS/CoT/GeoJSON feeds retain staleness and failure reporting. VEOC-79C1/C2 deliver durable mapped items, tolerant refresh tallies and last-good preservation; P-COP provides layer/inspection presentation. Scheduled source-URL polling and live outbound evidence remain open | partial | W2.2 / live source gate |
| F19 | NAPSG/DHS incident symbology shipped | Esri-EMO | Incident symbols render from a NAPSG set | Approved nine-type subset, original assets, local CC BY 4.0 license, reproducible sprites and independent status frames (`389afe1`) pass MapLibre light/dark legend, inspection and attribution proof and final P-COP composition. Broad clinic/airport/EOC labels remain explicitly unmapped | verified | - |
| F20 | Native standards interchange | WebEOC-core / Esri-EMO | Import/export CAP, EDXL, CoT, GeoJSON natively | CAP/EDXL/CoT/HAVE/GeoJSON models and endpoints (VEOC-26..29/31) | verified | - |

## Requirements (R1-R6)

| ID | Capability | Reference | Operator behavior | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|---|
| R1 | >= 150 concurrent users per instance | WebEOC-core | 150 concurrent operators without degradation | In-process benchmark only (VEOC-38); real-hardware socketed run is not recorded | partial | R1-REAL |
| R2 | IPAWS integration, enable-at-will | WebEOC-core | Enable IPAWS alerting when authorized | IPAWS model/endpoint (VEOC-31); operator enablement and two-person send are not wired, and live IPAWS needs authorized test credentials | partial | W2.7 / W3.5 / Basho credentials |
| R3 | Agency/organization/volunteer conglomerate COP access | WebEOC-inc | Multiple organizations share one incident's COP | Named participation, authority and guest access join incident-tagged records. PostgreSQL proves partner contribution/reads and outsider, revoked-grant and second-incident isolation; persistent incident URL state is integrated (`64e3cf5`). The final integrated multi-organization exercise remains open | partial | 79D+D33 |
| R4 | Fluid Command and General Staff; JIC component | WebEOC-core | Staff hand off positions; JIC publishes | ICS staff + JIC (VEOC-12/33A/34) | verified | - |
| R5 | File sharing | WebEOC-core | Upload and download files per jurisdiction | Content-addressed files (VEOC-15); tenant check + safe download hardened (`451ed16`) | verified | - |
| R6 | Private and group messaging | WebEOC-core | Direct and group messages | Messaging (VEOC-15A/32) | verified | - |

## Anti-requirements (AR1-AR7)

| ID | Anti-requirement | Guard | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|
| AR1 | No per-seat surge pricing | INV-1 | Viewers structurally free; no seat metering | verified | - |
| AR2 | No unconstrained board divergence | INV-5 | Versioned board schemas with migration | verified | - |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6 | Declarative authoring engine, runtime layouts, structured designer, preview, immutable template publication and safe board apply are integrated (`b7cb680`, `48edf63`, `75464fc`) | verified | - |
| AR4 | No in-place-upgrade dead ends | INV-5 | Versioned schema upgrades preserve records | verified | - |
| AR5 | No proprietary-only interchange or substrate lock-in | INV-4, INV-9 | Native standards + jurisdiction export; Apache-2.0 | verified | - |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | Session continuity, controlled fields, server-computed dashboards | verified | - |
| AR7 | Full function disconnected, including provisioning | INV-3 | Native Windows cold setup, local map, runtime RLS, profile isolation, durable work recovery and persistent restart are proven on this prepared machine (`3741100`, `7a52438`). Independent media transfer and second-machine provisioning remain absent | partial | W6.4 |

## Assessed gaps beyond the canonical set (audit and amendment)

| ID | Capability | Reference | Local status / evidence | Status | Owner |
|---|---|---|---|---|---|
| G-INCSCOPE | Incident-scoped operational records (boards/feeds/resources/tasks) | WebEOC-inc | The 79B receipt closes scoped board writes/reads/counts, dashboards/live stream, COP, resources, tasks and IAP with database and DOM evidence. P-SHELL adds bounded incident URLs, selected-record resolution, invalidation and Back behavior (`64e3cf5`); W0.0 closes the long scoped-context browser gate | verified | - |
| G-INGEST | Durable normalized dataset ingestion to the COP | Esri-EMO | VEOC-79C1/C2 deliver incident-RLS persistence, tolerant refresh counts, last-good preservation, GeoJSON items and available/stale COP layers; P-COP adds MapSurface inspection (`e20e772`). Scheduled source-URL polling and live outbound evidence remain open | partial | W2.2 / live source gate |
| G-CATALOG | California operational data catalog + refresh controls | Esri-EMO | Coverage-aware catalog (boundaries/closures/parcels/hazards/facilities/population/shelters) onboards through the data-pack path with owner/license/coverage/mapping/cadence, listed per incident and added from the operator UI (`f34cd69`); named gaps are live FEMA NFHL, an open statewide shelter feed, live ACS and scheduled outbound polling | partial | W2.2 / external data gates |
| G-IMPACT | Incident-area impact analysis (affected structures/parcels/population) | Esri-EMO | 79G-E1/E2 provide authorized PostGIS totals, revision deltas, masked Lifeline reports and paged contributions. P-DASH presents source geometry and distinguishes missing, unknown, stale and measured zero in light/dark wide/narrow Chrome proof. No live ACS population baseline was acquired | verified for loaded sources | external ACS baseline |
| G-PARCELS | Configurable parcel overlays | Esri-EMO | Handoff 10 reuses the catalog and dataset-COP path. A real-database scenario proves Humboldt coverage versus San Diego noncoverage, onboarding, APN mapping and polygon delivery; P-COP supplies shared popup/outline browser proof. Whole-county vector tiles, other county sources and live outbound fetching remain gaps | partial | W4.5 / external parcel sources |
| G-FLOOD | Hazard hatching + FEMA flood zone overlays | Esri-EMO | Operational hatching and distinct A/AE/AO/shaded-X layers retain coverage, freshness and attribution. Paged retrieval and toggles pass PostGIS and light/dark MapLibre proof (`eb876ec`), composed in P-COP. Fixtures are synthetic; live NFHL acquisition remains unproven and catalog availability remains false | partial | external NFHL source |
| G-KPIMAP | Map-extent KPIs | Esri-EMO | Bounds callback, uncapped viewport intersections and P-COP KPI strip (`b4c14bf`) are integrated. PostgreSQL proves 1,001-record reconciliation beyond the client cap; Chrome proves movement, scope, revision/bbox-preserving drilldown and unknown/stale/unavailable/zero states. Light/dark wide/narrow captures retained | verified | - |
| G-BUILDINGS | Enriched building subtypes (Overture) | Esri-EMO | H14 installs 13,526,876 PMTiles features and exact OSM-way lineage enrichment from Overture 2026-08-19.0: 24,546 untyped features enriched, 728 known types retained, no duplicate footprints. MapLibre proves identity, status precedence, attribution and byte ranges in both themes; P-COP supplies final inspection. Unmapped/null classifications stay explicit | verified for exact-way enrichment | - |
| G-BOARDROUTE | Configurable board workflow routing | WebEOC-DS | Declarative transactional execution, pinned definitions, current-authority approvals, due/escalation, immutable history and local notifications (`6c8dddc`) are configured and previewed through the structured no-code designer (`75464fc`) | verified | - |
| G-SHELL | Adaptable, responsive operator shell | Esri-EMO | Responsive frame, compact navigation, modal/focus boundaries and wide/narrow theme gates (`ef13b0c`) join incident-scoped persistent context, layouts, deep links and stale-response invalidation (`64e3cf5`) | verified | - |
| G-DASH | Composable saved dashboards + map/chart/list drilldown | Esri-EMO | Saved compositions, filter inheritance, scoped paged drilldowns and PostgreSQL-backed source geometry (`6aa5c09`) are presented in the operational dashboard workspace with light/dark and 1440/900/390 Chrome evidence (`7ce5da6`) | verified | - |
| G-MFA | MFA and SAML for IPAWS-authority accounts | WebEOC-core | Password + optional OIDC only; no MFA/SAML | open | W2.10 / Basho IdP decision |
| G-TILES | Vector-tile path for operational layers past 1,000 features | Esri-EMO | Basemap/building PMTiles and uncapped server count/drilldown queries are proven, including 1,001 records. Operational board/data-pack rendering still uses bounded OGC/GeoJSON paths. Counts beyond the cap do not prove vector-tile rendering | open | W4.5 |

## Reconciliation notes

- F1, F6, F13, F14, AR3, G-INCSCOPE, G-BOARDROUTE, G-SHELL and G-DASH now
  reflect their delivered runtime and presentation receipts. F4, F7, F8, F9,
  F17, F18, R1, R2, R3 and AR7 remain partial at the exact durable-delivery,
  source-data, operator, live-system, scale or independent-transfer boundary
  stated in their receipts.
- No row claims a capability the code does not support; unproven depth is left
  `open` or `partial`, never asserted as parity.
- Live readiness (R1 real hardware, R2 live IPAWS, AR7 independent transfer,
  named external datasets and the pilot) remains in the V1 roster and is not
  converted into proof by this documentation reconciliation.
