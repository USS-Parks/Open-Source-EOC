# Open-Source-EOC parity capability matrix

Source-backed inventory of the assessed capabilities (VEOC-79E). Each row ties
a canonical obligation or an assessed gap to the reference product it mirrors,
the primary source for that reference, the operator behavior expected, the
local implementation and its evidence, a current status, and the roster prompt
that owns it.

This matrix reconciles [FACET-STATUS.md](./FACET-STATUS.md): its `verified`
labels recorded earlier implementation gates, not demonstrated commercial-
product parity. Where local behavior is a completed increment but not full
parity, the status here is `partial` with the owning prompt named. Historical
receipts in [VEOC-EXECUTION-LEDGER.md](./VEOC-EXECUTION-LEDGER.md) are not
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
| F1 | Versioned board schema, input + display views | WebEOC-core / WebEOC-DS | Admin defines a board; operators enter and view records | Board schema + runtime (VEOC-09/10); declarative layouts, conditions, calculations, incident record references and locked upgrade preflight integrated (`b7cb680`). Runtime layouts and designer presentation remain open | partial | VEOC-81A / P-BOARDS-1 / P-BOARDS-2 |
| F2 | Position login + immutable activity/position logs | WebEOC-core | Sign into a position; every action is attributed and logged | Positions, sign-in, append-only audit (VEOC-07/11); incident-position attribution extended (`ca0d130`) | verified | - |
| F3 | Store-and-forward federation, local replication | WebEOC-core | Agencies share boards across a federation boundary | Federation service and sharing agreements (VEOC-30) | verified | - |
| F4 | Board-triggered notifications, webhooks, multi-channel | WebEOC-core | A record change fires a notification/webhook | Notify + webhook delivery (VEOC-14); synchronous webhook robustness is an open backend weakness (audit §4) | partial | VEOC-81B |
| F5 | ICS forms, IAP builder, 213RR lifecycle | WebEOC-core | Build ICS forms and the operational-period IAP; run resource requests | Forms/IAP/resource lifecycle (VEOC-34/35); IAP now incident-context driven (`8c96103`) | verified | VEOC-84/84A |
| F6 | Any board as a live geospatial layer; field-to-COP loop | Esri-EMO / WebEOC-Maps | Drop a record on the map; it appears as a COP layer | VEOC-79B1/B2 deliver incident-tagged field capture, scoped reads/counts and partner isolation; VEOC-79C2 connects persisted datasets to shared COP layers and inspection. Incident-tagged capture and dataset map wiring still lack dedicated browser integration proof | partial | VEOC-79B1/79C2 |
| F7 | Offline XLSForm-compatible smart forms | Esri-EMO (Field Maps/Survey123) | Fill a form offline; sync later | Smart forms + XLSForm subset (VEOC-22); ~12 of ~25 question types, no line/polygon/barcode/media capture (audit §4) | partial | VEOC-79F |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | Esri-EMO | Report lifeline status; produce PDA/declaration outputs | Lifelines + damage/declaration (VEOC-20/23); FEMA IA/PA category depth and shelter census open | partial | VEOC-79G |
| F9 | Pre-disaster baseline data for damage assessment | Esri-EMO | Compare damage against a pre-event baseline | Baseline data path (VEOC-23); statewide catalog/coverage not yet delivered | partial | VEOC-79F |
| F10 | Always-on facility status networks + status queries | Juvare-other (EMResource) | Query facility status networks | Facility status + queries (VEOC-28) | verified | - |
| F11 | Scan-first tracking objects + reunification | Juvare-other (EMTrack) | Scan a tag; track custody; reunify | Tracking + reunification (VEOC-25) | verified | - |
| F12 | Incident templates instantiating ICS org + checklists | WebEOC-core | Activate an incident from a template with positions and checklists | Incident templates + checklists (VEOC-12); participation + authority added (`ca0d130`) | verified | - |
| F13 | Scenario/reference libraries, checklists | WebEOC-core | Attach scenario/reference libraries and run checklists | Libraries + checklists (VEOC-12); due-date/assignee/past-due depth open | partial | VEOC-82 |
| F14 | Calm-screen map-first SPA discipline | Esri-EMO | A map-first console that stays legible under stress | Map-first shell (VEOC-05/17); shell adaptability/responsive layout open | partial | VEOC-81C |
| F15 | Per-incident auto-provisioned collaboration space | WebEOC-core | Activating an incident provisions its workspace | Collab provisioning (VEOC-32/33); incident context now drives the workspace (`8c96103`) | verified | - |
| F16 | One-click role-based provisioning; ten-minute viewer path | WebEOC-core | Provision a jurisdiction and admin in one action | One-action provisioning (VEOC-08/41) | verified | - |
| F17 | Daily-ops usability against skill decay | WebEOC-core | Routine daily-ops use keeps skills fresh | Daily-ops surfaces (VEOC-05/41); workspace usability depth open | partial | VEOC-81C |
| F18 | Sensor and drone live feeds into the COP | Esri-EMO | External hazard/position feeds appear as COP layers | CAP/GeoRSS/CoT/GeoJSON feeds retain staleness and failure reporting. VEOC-79C1/C2 deliver durable mapped items, tolerant refresh tallies, last-good preservation and COP layers/inspection. Dataset source-URL polling, live outbound evidence and dedicated legend/symbology remain open | partial | VEOC-79C1/C2 |
| F19 | NAPSG/DHS incident symbology shipped | Esri-EMO | Incident symbols render from a NAPSG set | Local asset/license inventory integrated (`61233fc`); only a sprite configuration seam exists. NAPSG files, identifier mapping and local license/attribution evidence are absent; rendering acceptance is blocked on supplied assets or separate outbound approval | open | Handoff 13 |
| F20 | Native standards interchange | WebEOC-core / Esri-EMO | Import/export CAP, EDXL, CoT, GeoJSON natively | CAP/EDXL/CoT/HAVE/GeoJSON models and endpoints (VEOC-26..29/31) | verified | - |

## Requirements (R1-R6)

| ID | Capability | Reference | Operator behavior | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|---|
| R1 | >= 150 concurrent users per instance | WebEOC-core | 150 concurrent operators without degradation | In-process benchmark only (VEOC-38); real-hardware socketed run not recorded (audit §4) | partial | VEOC-86 |
| R2 | IPAWS integration, enable-at-will | WebEOC-core | Enable IPAWS alerting when authorized | IPAWS model/endpoint (VEOC-31); live IPAWS needs authorized test credentials | partial | VEOC-86 |
| R3 | Agency/organization/volunteer conglomerate COP access | WebEOC-inc | Multiple organizations share one incident's COP | Named participation, authority and guest access now join incident-tagged records. Real-database tests prove partner contribution/reads and outsider, revoked-grant and second-incident isolation; database and DOM tests reconcile dashboard totals. Incident URL state and the full multi-organization browser scenario remain to be proven | partial | VEOC-79B1/B2 |
| R4 | Fluid Command and General Staff; JIC component | WebEOC-core | Staff hand off positions; JIC publishes | ICS staff + JIC (VEOC-12/33A/34) | verified | - |
| R5 | File sharing | WebEOC-core | Upload and download files per jurisdiction | Content-addressed files (VEOC-15); tenant check + safe download hardened (`451ed16`) | verified | - |
| R6 | Private and group messaging | WebEOC-core | Direct and group messages | Messaging (VEOC-15A/32) | verified | - |

## Anti-requirements (AR1-AR7)

| ID | Anti-requirement | Guard | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|
| AR1 | No per-seat surge pricing | INV-1 | Viewers structurally free; no seat metering | verified | - |
| AR2 | No unconstrained board divergence | INV-5 | Versioned board schemas with migration | verified | - |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6 | Declarative authoring engine and immutable template-version APIs integrated (`b7cb680`); no-code designer and runtime presentation remain open | partial | VEOC-81A / P-BOARDS-1 / P-BOARDS-2 |
| AR4 | No in-place-upgrade dead ends | INV-5 | Versioned schema upgrades preserve records | verified | - |
| AR5 | No proprietary-only interchange or substrate lock-in | INV-4, INV-9 | Native standards + jurisdiction export; Apache-2.0 | verified | - |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | Session continuity, controlled fields, server-computed dashboards | verified | - |
| AR7 | Full function disconnected, including provisioning | INV-3 | Offline queue exists; cold air-gapped provisioning not proven | deferred | VEOC-85 |

## Assessed gaps beyond the canonical set (audit and amendment)

| ID | Capability | Reference | Local status / evidence | Status | Owner |
|---|---|---|---|---|---|
| G-INCSCOPE | Incident-scoped operational records (boards/feeds/resources/tasks) | WebEOC-inc | The 79B receipt records closure for scoped board writes/reads/counts, dashboards/live stream, COP, resources, tasks and IAP, with real-database and DOM evidence. Preserve that receipt; the original compact browser scenario and incident URLs are not established by those tests. URL state belongs to 81C/81 and connected proof to 79D | partial | VEOC-79B1/B2 |
| G-INGEST | Durable normalized dataset ingestion to the COP | Esri-EMO | VEOC-79C1/C2 deliver incident-RLS persistence, tolerant refresh counts, last-good preservation, GeoJSON items and available/stale COP layers with shared inspection. No dedicated MapSurface integration test was added; source-URL polling and dedicated legend/symbology remain follow-ups | partial | VEOC-79C1/C2 |
| G-CATALOG | California operational data catalog + refresh controls | Esri-EMO | Coverage-aware catalog (boundaries/closures/parcels/hazards/facilities/population/shelters) onboards through the data-pack path with owner/license/coverage/mapping/cadence, listed per incident and added from the operator UI (`f34cd69`); named gaps: FEMA NFHL flood (Handoff 11, see G-FLOOD), an open statewide shelter feed, and live outbound polling (gated, no external calls this session) | partial | VEOC-79F |
| G-IMPACT | Incident-area impact analysis (affected structures/parcels/population) | Esri-EMO | 79G-E1/E2 provide source-backed spatial queries, authorized API, paged source drilldown, current-baseline area-revision deltas and field-masked reported Lifeline links. Real PostGIS proves scope, unknowns and revocation; live ACS and P-DASH presentation remain | partial | P-DASH |
| G-PARCELS | Configurable parcel overlays | Esri-EMO | Handoff 10 reuses the catalog and dataset-COP path. A real-database scenario proves Humboldt coverage versus San Diego noncoverage, onboarding, APN mapping and polygon delivery on the COP items endpoint. Shared popup/outline rendering is reused, not separately browser-proven. Feature limits, whole-county vector tiles, other county sources and live outbound fetching remain gaps | partial | Handoff 10 |
| G-FLOOD | Hazard hatching + FEMA flood zone overlays | Esri-EMO | Operational status hatches and distinct local NFHL reference layers, area-paged retrieval, coverage/freshness/attribution and toggles passed real PostGIS and light/dark browser proof (`eb876ec`). Synthetic fixtures only; live NFHL acquisition remains gated and catalog availability remains false | partial | Handoff 11 / external NFHL source approval |
| G-KPIMAP | Map-extent KPIs | Esri-EMO | Dashboard runtime filter + drilldown shipped (`7cf8791`); typed map-ready/moveend bounds callback integrated (`6cb0500`); viewport queries and KPI presentation remain open | partial | Handoff 12 / H12-E / P-COP |
| G-BUILDINGS | Enriched building subtypes (Overture) | Esri-EMO | Building archive exists; Overture enrichment open | open | Handoff 14 |
| G-BOARDROUTE | Configurable board workflow routing | WebEOC-DS | Declarative transition/approval/due/escalation schema and authority-checked assignment resolver integrated (`9cfc8f7`); execution, history, notifications and no-code configuration remain open | partial | VEOC-81B-E2 / P-BOARDS-2 |
| G-SHELL | Adaptable, responsive operator shell | Esri-EMO | Personal incident-scoped persistence with RLS, revisions and bounded payloads integrated (`c339761`); responsive shell and consuming controls remain open | partial | VEOC-81C / P-SHELL |
| G-DASH | Composable saved dashboards + map/chart/list drilldown | Esri-EMO | Runtime filter + drilldown + URL state (`7cf8791`); saved/composable layouts open | partial | VEOC-81 |
| G-MFA | MFA and SAML for IPAWS-authority accounts | WebEOC-core | Password + optional OIDC only (audit §3.6); no MFA/SAML | open | Basho (IdP decision) |
| G-TILES | Vector-tile path for operational layers past 1,000 features | Esri-EMO | OGC features capped at 1,000; no tile server | open | VEOC-79F |

## Reconciliation notes

- FACET-STATUS.md marks F1, F4, F6, F7, F8, F9, F13, F14, F17, F18, F19 and
  R1, R2, R3, AR3 as `verified`; this matrix qualifies them to `partial` or
  `open` where the referenced product's depth is not met, and names the owning
  prompt. The `verified` implementation receipts remain valid for the increment
  they covered.
- No row claims a capability the code does not support; unproven depth is left
  `open` or `partial`, never asserted as parity.
- Live readiness (R1 real-hardware, R2 live IPAWS, AR7 disconnected, and the
  named pilot) is reconciled and decided at VEOC-85/86, not here.
