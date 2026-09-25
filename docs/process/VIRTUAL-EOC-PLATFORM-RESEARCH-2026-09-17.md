# Virtual EOC Platform Research: Reference System Analysis

**Created:** 2026-09-17
**Author of record:** Basho Parks (research compiled by Claude Code session)
**Purpose:** Source research for `VIRTUAL-EOC-PSPR-2026-09-17.md`. Profiles the five reference systems named in the project charge (Esri EM Operations Solutions, WebEOC, "Juvari", COBRA, Microsoft Teams parity), extracts the superlative facets of each, documents the weaknesses to design against, surveys the open-source building blocks, and determines the implementation language.
**Status:** RESEARCH COMPLETE; feeds the PSPR. No code exists yet.
**Verification note:** Claims below are sourced from vendor documentation, government procurement records, GitHub repositories, and practitioner review excerpts gathered 2026-09-17. Items marked *(inference)* are reasoned conclusions, not directly sourced facts. Several vendor domains were reachable only through search-index excerpts; re-verify any figure before it becomes contractual.

## 0. Naming corrections established by research

1. **"Juvari" does not exist.** It is a misspelling of **Juvare**, the company that owns WebEOC (plus EMResource, EMTrack, Crisis Track, eICS, Juvare Exchange). This document treats the request as covering the full Juvare suite.
2. **COBRA** here means **COBRA by Dynamis, Inc.** (cobrasoftware.com, Fairfax VA), lineage: "Chemical Biological Response Aide" by Defense Group Inc. (first commercial release 2000), acquired by Dynamis in July 2016. It is not the UK Cabinet Office "COBR/COBRA" briefing facility, which is a room, not software.
3. **"Teams parity"** is read as: the Microsoft Teams Emergency Operations Center (TEOC) open-source template plus the collaboration fabric Teams itself supplies (channels, chat, video bridges, file co-authoring, presence, mobile).

## 1. Reference platform profiles

### 1.1 Esri ArcGIS Emergency Management Operations (EMO)

**What it is.** A no-additional-cost ArcGIS Solutions template bundle (released 2023-11-09, quarterly updates) deployed into an agency's ArcGIS Online or Enterprise organization: hosted feature layers with FEMA-shaped schemas, web maps, an Incident Status Dashboard (ArcGIS Dashboards), the Emergency Information Manager (Experience Builder), Survey123 forms for Community Lifelines and public messaging, and an ArcGIS Hub public site. Adjacent solutions: Damage Assessment (FEMA PDA Guidebook-conformant surveys, Field Maps integration), Emergency Shelter Management (added March 2026), Incident Awareness and Assessment (National Guard).

**Stack.** Web apps are JavaScript/TypeScript on the ArcGIS Maps SDK for JavaScript 4.x; Experience Builder's Jimu framework is React + Redux + TypeScript with the Calcite design system. Server core (ArcGIS Server/ArcObjects) is C++ with .NET and Java APIs. Automation is Python (ArcPy, ArcGIS API for Python) and Esri's open-source TypeScript `solution.js`. Forms are XLSForm (the same open spec ODK and Kobo use). Wire format is Esri JSON over the GeoServices REST API; OGC WMS/WFS/OGC API Features are publishable.

**Strong points worth taking.**
- The field-to-dashboard live loop: field submission writes a hosted feature layer, and every map, dashboard, and app bound to that layer updates without middleware.
- Map-centric common operating picture as the default view of an incident, with live hazard feeds (Living Atlas pattern) and NAPSG/DHS incident symbology.
- Offline-capable smart forms (XLSForm conditional logic, calculations, photos) that keep working with no signal.
- FEMA doctrine baked into schemas: Community Lifelines status reporting and PDA-conformant damage surveys whose output rolls directly into declaration paperwork.
- Role-based app bundle provisioned in one click, with editor/viewer groups mirroring EOC roles.

**Weaknesses to design against.**
- No in-place upgrades: redeploying a solution version creates new items and orphans customizations (documented; users report weeks of rework).
- Named-user seat licensing plus metered credits punishes surge staffing, exactly when an EOC adds spontaneous users.
- Dashboard data model lacks server-side joins for live data; Arcade data-expression joins run 25x to 50x slower than view layers; refresh intervals break on joined layers and are unsupported in mobile views.
- Offline auth traps: Survey123 can force re-login while disconnected, stranding field crews.
- App-framework churn: Web AppBuilder dies Q2 2027; Experience Builder custom widgets deprecated in favor of web components by Q1 2027.
- No native CAP, EDXL, or NIEM messaging (confirmed by absence in documentation); no ICS process management (no 213RR ticketing, position logs, or IAP builder). Agencies bolt on WebEOC for that.
- Solution deployment cannot happen in a fully disconnected Enterprise environment, a notable gap for a discipline whose operating assumption is comms failure.

### 1.2 Juvare WebEOC and the Juvare suite

**What it is.** The incumbent crisis information management system (CIMS) in US emergency management since 1998-1999 (ESi lineage, then Intermedix, spun out as Juvare 2018). Vendor claims 4,000+ client organizations, all 50 states, 3,500+ hospitals. Entire states standardize on it (Louisiana all 64 parishes, Washington, Utah, Colorado, Connecticut). Historically self-hosted on Windows/IIS/SQL Server (ASP.NET/C#, high-confidence inference); the current WebEOC Nexus (launched Nov 2023) is SaaS-only, FedRAMP High at the company level, with a rebuilt UI, low-code workflow building, built-in ArcGIS mapping, and the JAI assistant. Pricing is quote-only; procurement records show roughly $430/user/year (150-user county) and five-figure annual county subscriptions, with alerting, GIS, analytics, and cross-agency exchange sold as paid add-ons.

**Core concepts.**
- **Everything is a board.** The status board is a permissioned form-backed shared table with an input view and one or more display views. Event logs, sit-reps, resource requests, shelters, road closures, and sign-in are all instances of one primitive. Admins build boards themselves (WYSIWYG over editable HTML/JS).
- **Position-based login.** Users log in as a position ("Operations Section Chief"), and the Activity Log and Significant Events boards produce a defensible who-did-what-when chronology, cited repeatedly as essential for FEMA reimbursement and legal documentation.
- **Standard board set:** Activity Log, Significant Events, Resource Request/Task Assignments (ICS 213RR statewide processes in Colorado and Washington live here), Damage Assessment, Shelters, Road Closures, Sign In/Out, Schedule, Situation Report, Press Releases, File Library, Checklists, After Action Review.
- **Federation, three generations:** remote board views; dual-commit (synchronous write to two instances, fragile); and **Fusion**, a store-and-forward hub that replicates board data locally at every subscribed instance so each jurisdiction keeps its data when connectivity drops. Nexus-era sharing runs through Juvare Exchange (600+ organizations claimed).
- **Notifications** triggered by board actions across SMS, push, voice, email, Teams, Slack, and generic webhooks.
- **Mapping:** the ArcGIS Extension publishes any board as an ArcGIS Feature Service in near real time.

**Suite modules worth carrying.**
- **EMResource:** an always-on facility status network (hospital diversion, bed availability by type, staffing), event-driven status queries ("all hospitals report bed counts now"), auto-feeds CDC NHSN; its domain is exactly EDXL-HAVE's.
- **EMTrack:** scan-first patient/population tracking (triage-tag barcodes, license scanning) whose records survive agency handoffs, field to transport to hospital to reunification.
- **Crisis Track:** pre-loads jurisdiction parcel inventories with replacement costs before disaster, offline mobile collection including public intake, and outputs FEMA IA/PA declaration paperwork directly, plus ICS 214 capture.
- **eICS:** incident templates that instantiate an ICS org chart with per-position task checklists on activation, auto-generating the HICS form set.

**Weaknesses to design against.**
- Dated, clunky UI, conceded by Juvare's own Nexus marketing; reviewer reports of mid-session logouts and lag.
- **Board sprawl:** unconstrained per-jurisdiction customization fragments regional interoperability. The SF Bay Area UASI spent multi-year grant funding on a Regional WebEOC Standardization Project just to establish common boards across 12 operational areas.
- Admin burden: board building historically requires HTML/JS skill; a training and consulting economy exists around it.
- Perishable skills: occasional users forget the system between activations (Juvare publishes mitigation guidance; the daily-ops answer is right, the UI cost of it is not).
- Core capabilities unbundled as paid add-ons; sole-source lock-in through network effects; PeerSpot mindshare in the category falling (about 10.5% to 4.8% by May 2026, single source, directional).
- Standards support is integration-mediated, not native: CAP via the Rave extension; current native EDXL-DE/RM support unverified.

### 1.3 COBRA (Dynamis)

**What it is.** Cloud-based incident management with CBRNE/HAZMAT decision-support DNA, deployed at national special security events (2017 inauguration, 2014 World Cup COP, per vendor press). COBRA 5 is a ground-up rebuild: React single-page application on Azure, blob storage for files, Key Vault secrets, Entra External ID or on-prem directories, with an on-premise deployment option and historical disconnected "Command Kit" field deployments. FEMA NIMS STEP evaluated it compliant with CAP and EDXL-DE; DHS SAFETY Act designated. Pricing is quote-only; public review volume is thin.

**Strong points worth taking.**
- Map-focused single-page workflows with minimalist color used only to flag what is critical: the calm-screen discipline an EOC under stress actually needs.
- Pre-planned incident scenario libraries and interactive checklists designed for touchscreens in response vehicles.
- CBRNE/HAZMAT reference library and threat checklists as a first-class knowledge module.
- Live sensor and drone feed integration into the COP.
- Multi-level distribution: the same picture shared across local, regional, and headquarters echelons.

**Weaknesses to design against.** Opaque pricing, closed system, small public ecosystem, no public documentation, Azure dependence for the current generation *(largely inference; public evidence is thin)*.

### 1.4 Microsoft TEOC and Teams parity

**What it is.** The Teams Emergency Operations Center template (github.com/OfficeDev/microsoft-teams-emergency-operations-center), MIT-licensed, TypeScript/React on SPFx/TeamsFx, SharePoint lists as the data store, Microsoft Graph for everything else, Azure Maps viewer. v3.4 (March 2025) is the last Microsoft release: **support and feature development paused 2025-03-31**; it is community-maintained now.

**Behaviors worth taking.**
- Incident creation auto-provisions a collaboration space: a Team per incident with General, Announcements, and Assessment channels, membership derived from role assignments (Incident Commander and deputies become owners).
- Role assignments as the driver of access, with default per-incident-type task lists (Planner) instantiated on creation.
- One-click instant meeting (video bridge) from the incident dashboard.
- Incident history with version tracking and PDF export; guest access for mutual aid (capped at 10 per incident).
- The surrounding Teams fabric is the real product: persistent channels, threaded chat with mentions, presence, file co-authoring, full-fidelity mobile, push notifications, enterprise SSO.

**Weaknesses to design against.** Substrate lock-in (M365/SharePoint/Graph; 16 delegated Graph permissions needing Global Admin consent), SharePoint 5,000-item list view threshold under long incidents *(inference from architecture)*, single-tenant design with no real multi-agency story, no offline mode, no CAP/EDXL/NIMS data standards, and the sponsor walked away, which is the fate of any platform welded to someone else's substrate.

**Open-source Teams-parity components** (deploy alongside, do not embed, to keep AGPL at the process boundary):
- Chat/channels: Mattermost (Go/React; MIT compiled binaries, AGPL source; its Playbooks incident feature now requires an Enterprise license from v11, so treat Playbooks as unavailable) or Element/Matrix (Synapse is AGPLv3 since Nov 2023; federation suits mutual aid; government precedent in Bundeswehr and French Tchap).
- Video: Jitsi Meet (Apache-2.0) or LiveKit (Go SFU, Apache-2.0, lower-level).
- Files/co-authoring: Nextcloud (AGPLv3) with Collabora Online (MPL-2.0).
- Identity glue: Keycloak (Apache-2.0).

## 2. The market gap (the core strategic finding)

**No credible, active open-source WebEOC-class platform exists.** Every prior attempt either solved one slice (Ushahidi: public crowdsourcing, AGPL; Crisis Cleanup: relief work orders, Apache-2.0 Vue/TS; open-ews: alert dissemination, MIT Rails; TAK: field situational awareness), died with its maintainer (Sahana Eden survives as the one-developer Eden ASP rewrite on web2py; SAMBRO dead since 2019), or locked itself to a proprietary substrate (TEOC). Resgrid Core (C#, Apache-2.0) is dispatch-oriented, not EOC boards. Nobody has shipped an open, self-hostable "boards + COP map + ICS structure + interop" platform. That is the product.

The two failure modes to design against are therefore named the **Sahana pattern** (single maintainer, legacy framework) and the **TEOC pattern** (substrate lock-in, sponsor abandonment).

## 3. Superlative facets to synthesize (the cherry-pick matrix)

| # | Facet | Source system |
|---|---|---|
| F1 | Permissioned board primitive: form-backed shared table, input view + display views, versioned schemas | WebEOC |
| F2 | Position-based login with immutable position/activity logs (who-did-what-when chronology) | WebEOC |
| F3 | Store-and-forward federation with local replication per jurisdiction (never synchronous dual-commit) | WebEOC Fusion |
| F4 | Board-action-triggered notifications with webhooks, SMS, push, email, chat bridges | WebEOC |
| F5 | ICS forms, IAP assembly, and the 213RR resource request lifecycle (request, triage, task, track, close) | WebEOC / eICS |
| F6 | Live map-centric COP: any board publishable as a live geospatial layer; field edit to COP with no middleware | Esri + WebEOC ArcGIS Extension |
| F7 | Offline-first XLSForm smart forms for field collection | Esri Survey123 / ODK lineage |
| F8 | FEMA doctrine as schema: Community Lifelines status, PDA-conformant damage assessment whose output is the declaration paperwork | Esri + Crisis Track |
| F9 | Pre-disaster baseline data (parcels, replacement costs) accelerating damage assessment | Crisis Track |
| F10 | Always-on facility status networks with event-driven status queries | EMResource |
| F11 | Scan-first tracking objects surviving cross-agency handoffs; reunification workflow | EMTrack |
| F12 | Incident templates instantiating an ICS org chart with per-position activation checklists | eICS / COBRA |
| F13 | Pre-planned scenario libraries, reference libraries (CBRNE/HAZMAT), touchscreen checklists | COBRA |
| F14 | Calm-screen UI: map-first SPA, minimalist color reserved for the critical | COBRA 5 |
| F15 | Per-incident auto-provisioned collaboration space (channels, video bridge, files, tasks) driven by role assignment | TEOC / Teams |
| F16 | One-click role-based app provisioning; short path for view-only users | Esri + WebEOC |
| F17 | Daily-ops usability so skills never go stale between activations | WebEOC doctrine |
| F18 | Sensor and drone live feeds into the COP | COBRA |
| F19 | NAPSG/DHS incident symbology as the shipped symbol set | Esri ecosystem |
| F20 | Native standards interchange: CAP 1.2, EDXL-DE/RM/HAVE, CoT/TAK, GeoJSON/OGC API Features. Every incumbent does this by integration or not at all; doing it natively is the differentiation | gap analysis |

## 4. Anti-requirements (what the incumbents teach us not to build)

1. No per-seat surge pricing model in the architecture: unlimited viewers must be structurally free.
2. No unconstrained board divergence: ship versioned, shareable board schema templates and a regional standard-library mechanism (the Bay Area spent grant money retrofitting exactly this).
3. No admin customization that requires hand-written HTML/JS; no-code schema editing with a versioned escape hatch.
4. No in-place-upgrade dead ends: schema migrations must preserve customization.
5. No proprietary-only interchange; no substrate lock-in (works without any hyperscaler); no unbundling of alerting, mapping, or federation as premium add-ons.
6. No session timeouts mid-incident, no free text where enumerations belong, no join-poor dashboard data model.
7. Full function in a disconnected or degraded-comms environment, including provisioning.

## 5. Open-source building blocks (license-vetted)

| Layer | Choice | License | Note |
|---|---|---|---|
| Database | PostgreSQL + PostGIS | PostgreSQL / GPLv2-as-extension | Single source of truth; extension licensing does not contaminate app code |
| Map rendering | MapLibre GL JS | BSD-3 | v5 line, globe rendering, very active |
| Tile serving | martin | Apache/MIT | Rust, MapLibre project; prefer over low-activity pg_tileserv |
| Offline basemaps | PMTiles | BSD | Edge/air-gap basemap distribution |
| Geo analysis | turf.js | MIT | Client-side spatial ops |
| Form runner | XLSForm-compatible renderer (RJSF / JSONForms / formio.js renderer) | MIT / Apache | Form.io *server* is OSL-3.0: do not embed. NocoDB is fair-code: do not embed. Budibase core GPLv3: do not embed. Grist (Apache-2.0) and Baserow core (MIT) are the only safely embeddable low-code references |
| Real-time sync | Yjs CRDT over WebSocket; Postgres-to-client sync in the ElectricSQL/PowerSync style | MIT / Apache | The offline-first multi-EOC differentiator |
| Notifications | Apprise (BSD-2) fan-out + ntfy (Apache/GPLv2 dual) self-hosted push | | Self-hosted Android push with no FCM dependency |
| Chat/video/files | Mattermost or Matrix; Jitsi; Nextcloud+Collabora | mixed AGPL/Apache | Deploy alongside, integrate by adapter, never embed AGPL |
| CAP tooling | google/cap-library (Java), shu8/cap-editor, wmo-raf/cap-composer as references | Apache/MIT | Mine for schemas and validation logic |
| TAK bridge | Integrate TAK Server (GPL) / OpenTAKServer (GPL-3.0) / FreeTAKServer (EPL-2.0) via CoT gateway | | Speak CoT; do not rebuild TAK |
| IPAWS | IPAWS-OPEN connector module | n/a | Each deploying agency signs its own FEMA MOA; put the project through AOSP testing. There is no open post-to-IPAWS shortcut |

**Platform license determination:** Apache-2.0. Agency IT approval and integrator adoption are the life-or-death constraint for displacing WebEOC, and AGPL costs both. *(Recommendation; Basho decides.)*

## 6. Language determination (the pinnacle-of-code-language question)

**Evidence from the references:** WebEOC legacy is ASP.NET/C# + SQL Server. Esri's entire modern app layer (Experience Builder/Jimu) is React + TypeScript. COBRA 5 is a React SPA. TEOC is TypeScript/React. The center of gravity of every reference UI built in the last five years is **React + TypeScript**; only the two oldest server cores (WebEOC, ArcObjects) are .NET/C++.

**Determination: TypeScript full-stack.** Node backend (Fastify or NestJS), React front end, PostgreSQL/PostGIS, one language across server, browser, and PWA. Grounds:

1. **Real-time and offline-first are the differentiator**, and the CRDT/sync ecosystem (Yjs, Automerge, ElectricSQL/PowerSync class) is TypeScript-first. A Python or Go backend permanently splits sync/validation/model logic across two languages.
2. **Boards are the product**, and JSON-schema form renderers, sandboxed plugin runtimes (isolated-vm, QuickJS, WASM), and every dashboard/mapping library involved are native to the JS/TS ecosystem.
3. **Contributor pool:** TS is the largest open-source contributor population, and the specific people who build for this sector today (Esri integrators, TEOC deployers, Crisis Cleanup contributors) already write TS. Rust has the smallest sector pool; Go's is infra-oriented; Python is second but loses on point 1.
4. **GIS:** MapLibre, deck.gl, turf are JS; PostGIS speaks SQL to anything; martin runs as a sidecar.
5. **Tactical exception:** one Go or Rust single-static-binary **field node** (CoT/TAK bridge, offline edge sync, tile cache) for county IT shops with no container skills, mirroring what ntfy proves about single-binary adoption. Rust is available in-house in this monorepo if the field node lands here.

Runner-up for the record: Python backend + TS front end (FastAPI, GeoAlchemy; CAP/TAK libraries are Python-rich) is the safe second choice and was rejected only on the split-logic ground above.

## 7. Standards commitments

Native, from day one: CAP v1.2 in/out; EDXL-DE envelope, EDXL-RM resource messaging, EDXL-HAVE facility status; Cursor-on-Target (CoT) via TAK gateway; GeoJSON everywhere and OGC API - Features for the GIS world; NIMS/ICS data structures (ICS 201-215, 213RR lifecycle); FEMA Community Lifelines and PDA schemas; NAPSG symbology; IPAWS-OPEN connector under per-agency MOA. Interop is the wedge: the platform must slot between incumbents before it can replace them.

## 8. Primary sources

Consolidated from the four research passes (full URL lists preserved in session research records): doc.arcgis.com solution and release-note pages; esri.com industry blog; Esri Community threads on upgrade and refresh-interval defects; G2/AWS Marketplace review excerpts; juvare.com, docs.juvare.com and confluence.juvare.com board and API documentation; Louisiana GOHSEP, Washington MIL, Colorado DHSEM, Utah DEM state WebEOC programs; Bay Area UASI standardization project records; DHS/CBP WebEOC Privacy Impact Assessment; county procurement records (Doña Ana NM, Escambia FL, North Port FL); cobrasoftware.com and dynamiseurope.eu excerpts; GovConWire/HSToday Dynamis-DGI acquisition coverage; DHS SAVER Incident Management Software Market Survey (Jan 2022); github.com/OfficeDev/microsoft-teams-emergency-operations-center repo, wiki, and releases; sahanafoundation.org; github.com/ushahidi, CrisisCleanup, TAK-Product-Center, FreeTAKTeam, brian7704/OpenTAKServer, open-ews, maplibre, gristlabs, baserow, formio, nocodb, Budibase, caronc/apprise, binwiederhier/ntfy, element-hq, mattermost, jitsi, livekit, nextcloud; fema.gov IPAWS developer pages; napsgfoundation.org symbology library.

## 9. Corrections, September 24, 2026

Added under the Operator Trust PSPR, unit TP0. The sections above stand as
written on September 17; this section qualifies five of their claims, from
the later research in `docs/process/EOC-USER-EXPERIENCE-RESEARCH-2026-09-24.md`
(section 8 there, with its sources E05, E08 to E10 and W09). Reuse a claim
below only with its qualification.

- **Esri upgrades (section 1.1, "No in-place upgrades").** Official ArcGIS
  Solutions guidance documents deploying updated items beside existing ones,
  reapplying configuration and, where needed, migrating data. It does not say
  every customization is destroyed or orphaned. The maintenance burden is
  real; "orphans customizations" as a general description is not supported.
- **Esri missing widgets (section 1.1, app-framework churn).** The Emergency
  Response Guide gained a web tool in June 2025 and Threat Analysis one in
  June 2026, first for ArcGIS Online. Assess their access and deployment
  requirements for a named role instead of repeating that the functions are
  missing.
- **WebEOC hosting (section 1.2, "SaaS-only").** Current Juvare documentation
  covers both client-installed and Juvare-hosted instances. Verify the edition
  and contract in question before calling any deployment SaaS-only.
- **Performance ratios and framework dates (section 1.1).** The later
  research did not substantiate the 25x to 50x Arcade join comparison or the
  stated Web AppBuilder and Experience Builder dates. Do not use them as
  established design evidence.
- **Standards absence (sections 1.1 and 1.2).** Absence from a documentation
  search cannot confirm that a product lacks CAP, EDXL, NIEM or another
  integration. Mark such support unverified unless a current authoritative
  capability statement or a scoped evaluation settles it.
