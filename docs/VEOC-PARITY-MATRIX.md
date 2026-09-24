# Open-Source-EOC parity capability matrix

Source-backed inventory of the assessed capabilities (VEOC-79E), reconciled
again on 2026-09-23 through `57b0287` against the receipts in the
[V1 ledger](./process/V1-LEDGER.md), which are cited by their heading. The
internal run of the [WebEOC side-by-side evaluation](./WEBEOC-SIDE-BY-SIDE.md)
is cited as "the side-by-side run". Each row ties
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
| F1 | Versioned board schema, input + display views | WebEOC-core / WebEOC-DS | Admin defines a board; operators enter and view records | Board schema + runtime (VEOC-09/10); declarative layouts and upgrade preflight (`b7cb680`); operational record workspace (`48edf63`); structured designer, preview, immutable publication and safe apply (`75464fc`). Receipts "V1 W4.1 part one: board engine depth" and "V1 W4.1 part two: board screen controls" add record-level access, archive, restore and tombstone delete, per-record change history, CSV and Excel import and export, relative-date and set operators, multi-key sort and grouped views, each on real PostgreSQL and in Chrome; "V1 W4.2: views beyond the list" adds kanban, calendar and chart modes; "V1 W4.12: REST record writes through the sync log" puts console writes on the live sync log. The side-by-side run publishes a template on the Templates screen, which creates its board, then enters, edits, groups, exports and reads the history of its records. Not claimed: the designer cannot save conditions, sorts or groups into a template's own views, and outside incident activation no screen creates a board from a template that is already published | verified | - |
| F2 | Position login + immutable activity/position logs | WebEOC-core | Sign into a position; every action is attributed and logged | Positions, sign-in, append-only audit (VEOC-07/11); incident-position attribution extended (`ca0d130`); "V1 W3.1: audit chronology" gives the chronology a filterable, paged, exportable screen with attributed corrections, and "V1 W3.0: administration" audits guest grants and position assignment | verified | - |
| F3 | Store-and-forward federation, local replication | WebEOC-core | Agencies share boards across a federation boundary | Federation service and sharing agreements (VEOC-30). "V1 W2.1: outbound delivery queue" delivers the outbox to a linked peer through a partition; "V1 W3.6: federation and peers" adds the screen; "V1 W3.11: engine gaps the screens exposed" queues shared-board sync edits automatically with no echo; "V1 W4.12: REST record writes through the sync log" forwards console writes of records with no incident. Remaining, as those receipts state: incident-tagged record edits and deletes are not federated, and records that predate an agreement are not backfilled. The W3.11 receipt carries this bound to the final reconciliation | partial | 86+D35 |
| F4 | Board-triggered notifications, webhooks, multi-channel | WebEOC-core | A record change fires a notification/webhook | Notify + webhook delivery (VEOC-14) and governed workflow notifications (`6c8dddc`). "V1 W2.1: outbound delivery queue" moves every external send out of the write path into a durable outbox with retry, dead letter and circuit breaking, run by the scheduler in both deploy paths ("V1 W2.2: scheduler"); "V1 W2.7: threat-model controls" adds the allowlist and per-rule rate caps; "V1 W4.0 part one: email and SMS channels" adds SMTP email and SMS; "V1 W3.12: screens for the remaining operator routes" authors rules on screen; "V1 W4.0 part two: contacts and mass notification" adds contacts, groups, mass notification with delivery receipts and call-down escalation. Channels: in-app, webhook, push (ntfy), email and SMS. The side-by-side run fires an email and an SMS from a record change. Not claimed: a voice channel; Teams or Slack as a rule channel (the webhook body is not a chat message format); a live SMTP relay or SMS provider, which waits on the Finish PSPR's section 7 item 6; inbound SMS acknowledgement; listing, changing or removing a rule once created, which no route offers | verified | - |
| F5 | ICS forms, IAP builder, 213RR lifecycle | WebEOC-core | Build ICS forms and the operational-period IAP; run resource requests | Forms/IAP/resource lifecycle (VEOC-34/35); IAP now incident-context driven (`8c96103`); "V1 W3.8: JIC and resources completion" wires costs, cost export and mutual-aid escalation; "V1 W4.8: resources" adds NIMS resource typing, a pool with demobilization and a cost rollup | verified | VEOC-84/84A |
| F6 | Any board as a live geospatial layer; field-to-COP loop | Esri-EMO / WebEOC-Maps | Drop a record on the map; it appears as a COP layer | VEOC-79B1/B2 deliver incident-tagged field capture, scoped reads/counts and partner isolation; VEOC-79C2 connects persisted datasets to COP layers; P-COP and D29 provide PostgreSQL/Chrome map inspection and field-capture evidence (`e20e772`, `d1c5d63`) | verified | - |
| F7 | Offline XLSForm-compatible smart forms | Esri-EMO (Field Maps/Survey123) | Fill a form offline; sync later | Smart forms + XLSForm subset (VEOC-22) and durable field reconciliation (`d1c5d63`). "V1 W4.7: field depth" adds line and polygon capture, barcode, photo and audio questions, cascading selects and repeats in the runner, the XLSForm importer and the field screen, with photo and audio queued offline and uploaded after the record synchronizes, proven on real PostgreSQL and in Chrome online and offline. Not claimed: `range`, `or_other` and `repeat_count`, which the importer refuses by row; live-video barcode scanning; in-page audio recording; a continuous GPS trace; repeats as child records | verified | - |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | Esri-EMO | Report lifeline status; produce PDA/declaration outputs | VEOC-20/23 provide eight Lifelines, immutable SITREPs, approved-assessment aggregation and declaration support. D13 and P-LIFE-1 through P-LIFE-4 add attributed assessments, independent ESF state, conflicts, actions, history and operational relationships. "V1 W3.2: damage assessment" gives intake moderation, loss summary, thresholds and the declaration summary a screen; "V1 W4.11: Public Assistance and shelter census" adds the PA inventory by FEMA categories A to G, the per-capita indicator from PA cost, and a shelter census from facilities reports in the declaration summary, proven on real PostgreSQL and in Chrome. Not claimed: the census where the facilities integration is off (the summary says it is not available); the edition of the PA guide cited for the categories, which the W4.11 receipt leaves for Basho to confirm; deleting PA items; stale marking in the census | verified | - |
| F9 | Pre-disaster baseline data for damage assessment | Esri-EMO | Compare damage against a pre-event baseline | VEOC-23 proves imported jurisdiction baselines, approved assessments, loss totals and declaration output. Spatial exposure and statewide building-type coverage do not populate damage replacement-cost baselines. "V1 W3.12: screens for the remaining operator routes" puts the parcel baseline import from CSV or JSON on the Damage Assessment screen. Remaining, per "V1 W3.2: damage assessment": live parcel-roll ingestion and statewide replacement-cost coverage need data acquisition, and baselines do not feed the declaration summary | partial | pilot data acquisition |
| F10 | Always-on facility status networks + status queries | Juvare-other (EMResource) | Query facility status networks | Facility status + queries (VEOC-28); "V1 W3.4: facilities and shelters" adds the registry, status board, HAVE view and map; "V1 W3.13: screens for the optional integrations" adds status requests. Facilities is an optional integration ("V1 W6.6: gated-module disposition") | verified | - |
| F11 | Scan-first tracking objects + reunification | Juvare-other (EMTrack) | Scan a tag; track custody; reunify | Tracking + reunification (VEOC-25); "V1 W3.13: screens for the optional integrations" adds the custody chain. Tracking is an optional integration ("V1 W6.6: gated-module disposition") | verified | - |
| F12 | Incident templates instantiating ICS org + checklists | WebEOC-core | Activate an incident from a template with positions and checklists | Incident templates + checklists (VEOC-12); participation + authority added (`ca0d130`) | verified | - |
| F13 | Scenario/reference libraries, checklists | WebEOC-core | Attach scenario/reference libraries and run checklists | Libraries + checklists (VEOC-12), declarative due/category rules and attributed completion receipts (`ecd5249`), and assigned/offline task presentation (`d867488`). "V1 W3.12: screens for the remaining operator routes" puts Add a library, the incident's checklists and libraries, and Mark complete on the Incident Setup screen, with checklist completion walked in Chrome. Not claimed: CBRNE or HAZMAT reference content, which does not ship; libraries are an attach-and-read mechanism, and checklist completion shows only on the signed-in position's items | verified | - |
| F14 | Calm-screen map-first SPA discipline | Esri-EMO | A map-first console that stays legible under stress | Map-first shell (VEOC-05/17), responsive operational frame (`ef13b0c`), persistent context (`64e3cf5`) and operational map workspace (`e20e772`) passed wide/narrow, light/dark and keyboard Chrome gates. Representative-operator acceptance remains D34, not a technical parity claim | verified | D34 acceptance |
| F15 | Per-incident auto-provisioned collaboration space | WebEOC-core | Activating an incident provisions its workspace | Collab provisioning (VEOC-32/33); incident context now drives the workspace (`8c96103`); "V1 W3.13: screens for the optional integrations" puts channel setup, announcements, meeting bridges and briefings on screen. Collaboration and meetings are optional integrations ("V1 W6.6: gated-module disposition") | verified | - |
| F16 | One-click role-based provisioning; ten-minute viewer path | WebEOC-core | Provision a jurisdiction and admin in one action | One-action provisioning (VEOC-08/41); "V1 W3.0: administration" puts provisioning, people, roles, positions and guest access on the Administration screen; "V1 W2.6: secure by default" adds the `bootstrap` command | verified | - |
| F17 | Daily-ops usability against skill decay | WebEOC-core | Routine daily-ops use keeps skills fresh | Responsive, persistent daily-ops workspaces and all planned Master PSPR surfaces are technically integrated through M3. No representative operator has established skill-retention or comparative workflow results | partial | D34 |
| F18 | Sensor and drone live feeds into the COP | Esri-EMO | External hazard/position feeds appear as COP layers | CAP/GeoRSS/CoT/GeoJSON feeds retain staleness and failure reporting. VEOC-79C1/C2 deliver durable mapped items, tolerant refresh tallies and last-good preservation; P-COP provides layer/inspection presentation. "V1 W2.2: scheduler" polls feeds on the leader with no manual call, in both deploy paths. Live outbound source evidence remains open | partial | live source gate |
| F19 | NAPSG/DHS incident symbology shipped | Esri-EMO | Incident symbols render from a NAPSG set | Approved nine-type subset, original assets, local CC BY 4.0 license, reproducible sprites and independent status frames (`389afe1`) pass MapLibre light/dark legend, inspection and attribution proof and final P-COP composition. Broad clinic/airport/EOC labels remain explicitly unmapped | verified | - |
| F20 | Native standards interchange | WebEOC-core / Esri-EMO | Import/export CAP, EDXL, CoT, GeoJSON natively | CAP/EDXL/CoT/HAVE/GeoJSON models and endpoints (VEOC-26..29/31) | verified | - |

## Requirements (R1-R6)

| ID | Capability | Reference | Operator behavior | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|---|
| R1 | >= 150 concurrent users per instance | WebEOC-core | 150 concurrent operators without degradation | In-process benchmark (VEOC-38). "V1 W2.4: WebSocket discipline" delivers every update to 149 live readers under 100 ms beside a stalled reader; "V1 W2 milestone gate" records a two-hour synthetic activation with 150 sockets, 71,106 edits and 0 errors, heap flat. Both ran on this workstation; the real-hardware socketed run is not recorded | partial | R1-REAL |
| R2 | IPAWS integration, enable-at-will | WebEOC-core | Enable IPAWS alerting when authorized | IPAWS model/endpoint (VEOC-31). "V1 W2.7: threat-model controls" makes every send a two-person request the database refuses to let one admin confirm; "V1 W3.5: IPAWS enablement and send" adds configuration, the MOA acknowledgement, the enable toggle and the two-person send on screen, walked against a loopback fixture; "V1 W2.10: MFA" requires TOTP of every local admin account, and only admins can enable IPAWS. Remaining: no live send until IPAWS-OPEN test credentials and the MOA arrive | partial | Basho credentials and MOA |
| R3 | Agency/organization/volunteer conglomerate COP access | WebEOC-inc | Multiple organizations share one incident's COP | Named participation, authority and guest access join incident-tagged records. PostgreSQL proves partner contribution/reads and outsider, revoked-grant and second-incident isolation; persistent incident URL state is integrated (`64e3cf5`). The final integrated multi-organization exercise remains open | partial | 79D+D33 |
| R4 | Fluid Command and General Staff; JIC component | WebEOC-core | Staff hand off positions; JIC publishes | ICS staff + JIC (VEOC-12/33A/34); "V1 W3.8: JIC and resources completion" and "V1 W3.11: engine gaps the screens exposed" wire release review, publication, inquiries and a second approver's queue; "V1 W3.3: staffing" adds check-in, badges, shifts and the ICS-211 | verified | - |
| R5 | File sharing | WebEOC-core | Upload and download files per jurisdiction | Content-addressed files (VEOC-15); tenant check + safe download hardened (`451ed16`); "V1 W2.6: secure by default" streams uploads with a size limit and a per-jurisdiction quota | verified | - |
| R6 | Private and group messaging | WebEOC-core | Direct and group messages | Messaging (VEOC-15A/32); "V1 W3.12: screens for the remaining operator routes" adds thread export and message settings | verified | - |

## Anti-requirements (AR1-AR7)

| ID | Anti-requirement | Guard | Local implementation / evidence | Status | Owner |
|---|---|---|---|---|---|
| AR1 | No per-seat surge pricing | INV-1 | Viewers structurally free; no seat metering | verified | - |
| AR2 | No unconstrained board divergence | INV-5 | Versioned board schemas with migration | verified | - |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6 | Declarative authoring engine, runtime layouts, structured designer, preview, immutable template publication and safe board apply are integrated (`b7cb680`, `48edf63`, `75464fc`); "V1 W4.1 part two: board screen controls" adds the Record access and Local fields tabs | verified | - |
| AR4 | No in-place-upgrade dead ends | INV-5 | Versioned schema upgrades preserve records | verified | - |
| AR5 | No proprietary-only interchange or substrate lock-in | INV-4, INV-9 | Native standards + jurisdiction export; Apache-2.0 | verified | - |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | Session continuity, controlled fields, server-computed dashboards | verified | - |
| AR7 | Full function disconnected, including provisioning | INV-3 | Native Windows cold setup, local map, runtime RLS, profile isolation, durable work recovery and persistent restart are proven on this prepared machine (`3741100`, `7a52438`). "V1 W6.4: installer rebuild" builds the offline `0.9.0` setup (1,351,643,919 bytes, SHA-256 `dafddeb50fcdfdf9a85519d24a88e21ae1c87420357ad22d86927802b112a153`) carrying Node.js, PostgreSQL with PostGIS, the California street, Overture building and overlay archives and the address search gazetteer, and writes the second-machine transfer check. That setup has not yet been carried on media to a disconnected second computer | partial | Basho: second-machine transfer check |

## Assessed gaps beyond the canonical set (audit and amendment)

| ID | Capability | Reference | Local status / evidence | Status | Owner |
|---|---|---|---|---|---|
| G-INCSCOPE | Incident-scoped operational records (boards/feeds/resources/tasks) | WebEOC-inc | The 79B receipt closes scoped board writes/reads/counts, dashboards/live stream, COP, resources, tasks and IAP with database and DOM evidence. P-SHELL adds bounded incident URLs, selected-record resolution, invalidation and Back behavior (`64e3cf5`); W0.0 closes the long scoped-context browser gate | verified | - |
| G-INGEST | Durable normalized dataset ingestion to the COP | Esri-EMO | VEOC-79C1/C2 deliver incident-RLS persistence, tolerant refresh counts, last-good preservation, GeoJSON items and available/stale COP layers; P-COP adds MapSurface inspection (`e20e772`). "V1 W2.2: scheduler" runs feed polls on the leader in both deploy paths. Live outbound evidence remains open | partial | live source gate |
| G-CATALOG | California operational data catalog + refresh controls | Esri-EMO | Coverage-aware catalog (boundaries/closures/parcels/hazards/facilities/population/shelters) onboards through the data-pack path with owner/license/coverage/mapping/cadence, listed per incident and added from the operator UI (`f34cd69`); "V1 W2.2: scheduler" runs scheduled polling. Named gaps are live FEMA NFHL, an open statewide shelter feed, live ACS and live outbound fetching | partial | external data gates |
| G-IMPACT | Incident-area impact analysis (affected structures/parcels/population) | Esri-EMO | 79G-E1/E2 provide authorized PostGIS totals, revision deltas, masked Lifeline reports and paged contributions. P-DASH presents source geometry and distinguishes missing, unknown, stale and measured zero in light/dark wide/narrow Chrome proof. No live ACS population baseline was acquired | verified for loaded sources | external ACS baseline |
| G-PARCELS | Configurable parcel overlays | Esri-EMO | Handoff 10 reuses the catalog and dataset-COP path. A real-database scenario proves Humboldt coverage versus San Diego noncoverage, onboarding, APN mapping and polygon delivery; P-COP supplies shared popup/outline browser proof. "V1 W4.5: operational vector tiles" leaves parcel datasets on paged GeoJSON and defers parcel tiles. Whole-county parcel vector tiles, other county sources and live outbound fetching remain gaps | partial | external parcel sources / 86+D35 |
| G-FLOOD | Hazard hatching + FEMA flood zone overlays | Esri-EMO | Operational hatching and distinct A/AE/AO/shaded-X layers retain coverage, freshness and attribution. Paged retrieval and toggles pass PostGIS and light/dark MapLibre proof (`eb876ec`), composed in P-COP. Fixtures are synthetic; live NFHL acquisition remains unproven and catalog availability remains false | partial | external NFHL source |
| G-KPIMAP | Map-extent KPIs | Esri-EMO | Bounds callback, uncapped viewport intersections and P-COP KPI strip (`b4c14bf`) are integrated. PostgreSQL proves 1,001-record reconciliation beyond the client cap; Chrome proves movement, scope, revision/bbox-preserving drilldown and unknown/stale/unavailable/zero states. Light/dark wide/narrow captures retained | verified | - |
| G-BUILDINGS | Enriched building subtypes (Overture) | Esri-EMO | H14 installs 13,526,876 PMTiles features and exact OSM-way lineage enrichment from Overture 2026-08-19.0: 24,546 untyped features enriched, 728 known types retained, no duplicate footprints. MapLibre proves identity, status precedence, attribution and byte ranges in both themes; P-COP supplies final inspection. Unmapped/null classifications stay explicit | verified for exact-way enrichment | - |
| G-BOARDROUTE | Configurable board workflow routing | WebEOC-DS | Declarative transactional execution, pinned definitions, current-authority approvals, due/escalation, immutable history and local notifications (`6c8dddc`) are configured and previewed through the structured no-code designer (`75464fc`); "V1 W3.7: workflow runtime in the record detail" runs transitions, approvals, due times, escalations and history from the record | verified | - |
| G-SHELL | Adaptable, responsive operator shell | Esri-EMO | Responsive frame, compact navigation, modal/focus boundaries and wide/narrow theme gates (`ef13b0c`) join incident-scoped persistent context, layouts, deep links and stale-response invalidation (`64e3cf5`) | verified | - |
| G-DASH | Composable saved dashboards + map/chart/list drilldown | Esri-EMO | Saved compositions, filter inheritance, scoped paged drilldowns and PostgreSQL-backed source geometry (`6aa5c09`) are presented in the operational dashboard workspace with light/dark and 1440/900/390 Chrome evidence (`7ce5da6`); "V1 W4.2: views beyond the list" adds kanban and calendar widgets | verified | - |
| G-MFA | MFA and SAML for IPAWS-authority accounts | WebEOC-core | "V1 W2.10: MFA" adds TOTP sign-in with single-use recovery codes, required for jurisdiction and instance admins, which covers every account that can enable IPAWS; enrollment, replay refusal and recovery are walked in Chrome. OIDC sign-in leaves the second factor to the identity provider. SAML is not built: the roster's default is TOTP with no SAML until Basho names an identity provider that needs it | partial | Basho IdP decision |
| G-TILES | Vector-tile path for operational layers past 1,000 features | Esri-EMO | "V1 W4.5: operational vector tiles" serves board and dataset layers as `ST_AsMVT` tiles under row-level security with field visibility, clusters points below zoom 12, and switches a board to tiles past one client page and a dataset past 50,000 features; PostgreSQL proves 5,000 points with an admin-only field absent from a member's tile, and Chrome proves all 5,000 records reach the map through authenticated tiles. Not claimed: flood and parcel datasets, which stay on paged GeoJSON; Find on map, Zoom to extent and building status coloring over more than a tile layer's first page; nested values in tile features | verified | - |

## Reconciliation notes

- The W4 gate rows F1, F4, F7, F8, F13 and G-TILES are `verified` on the
  receipts cited in each row, with what is not claimed stated in the row.
- F3 moves from `verified` to `partial`: the receipts "V1 W3.11: engine gaps
  the screens exposed" and "V1 W4.12: REST record writes through the sync log"
  state that incident-tagged record edits and deletes are not federated.
- F9, F17, F18, R1, R2, R3, AR7 and G-MFA remain partial at the exact
  source-data, operator, live-system, scale, independent-transfer or
  identity-provider boundary stated in their receipts.
- No row is dedicated to incident archival, the cross-incident master view,
  incident lockdown or the installable web app, which are being built as this
  reconciliation is written. F12, G-INCSCOPE and AR7, the nearest rows, are
  left as they stood.
- No row claims a capability the code does not support; unproven depth is left
  `open` or `partial`, never asserted as parity.
- Live readiness (R1 real hardware, R2 live IPAWS, AR7 independent transfer,
  named external datasets and the pilot) remains in the V1 roster and is not
  converted into proof by this documentation reconciliation.
- AR7 stays `partial` after "V1 W6.4: installer rebuild": the setup exists and
  its contents match its stage manifest, but it has not been installed from
  media on a disconnected second computer. That check is Basho's external
  action, written in the installer README; the row moves on its record.
