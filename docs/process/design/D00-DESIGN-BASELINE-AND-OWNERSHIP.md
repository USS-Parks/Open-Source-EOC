# D00 design baseline and ownership map

**Date:** 2026-09-21
**Inspected implementation:** `63fbad8c29b749244600c7d38b685b9bb02329e1`
**Evidence level:** Source-verified baseline. No operator validation was performed for D00.

## 1. Purpose and evidence boundary

This inventory reconciles the current application with the approved Design PSPR, the Master PSPR pairings, the parity matrix, and Basho's local visual references. It establishes what exists, what is partial, what is requested, and which unit owns each change.

The labels used below are strict:

- **Current:** present in source at the inspected SHA.
- **Partial:** a real path exists, but the requested behavior is incomplete.
- **Requested:** specified by the approved roster and not present as a complete current surface.
- **Concept only:** a visual reference with synthetic data, not a captured application screen and not implementation evidence.
- **Operator-validated:** reserved for evidence from representative operators. Nothing in this document has that status.

Source inspection can establish structure and implemented behavior. It cannot establish operator speed, live deployment behavior, or usability at a viewport that was not exercised. D01 owns repeatable baseline journeys and D34 owns the later operator comparison.

## 2. Authority and reference register

| Source | D00 use | Evidence limitation |
|---|---|---|
| `docs/process/archive/MASTER-PSPR-2026-09-21.md`, sections 7.2, 8.1, 8.3, 8.5, and 10.2 | Authoritative engine/presentation split, exact implementation unit, dependencies, and file ownership | Scheduling and ownership source, not proof that a unit has landed |
| `docs/process/archive/VEOC-DESIGN-PSPR-2026-09-20.md`, sections 2 through 9 | Product boundaries, workspace model, component contract, D00 to D35 acceptance, reuse ledger | Approved requirement, not delivered behavior |
| `docs/process/archive/VIRTUAL-EOC-PSPR-2026-09-17.md`, sections 1 and 3 | Universal execution contract and product invariants | Governance source |
| `docs/VEOC-PARITY-MATRIX.md` and `docs/FACET-STATUS.md` | Existing parity claims and open evidence distinctions | Status records must be reconciled to source and receipts before final release claims |
| `web/src/app/**`, `web/src/cop/**`, `web/src/boards/**`, `web/src/dashboards/**`, `web/src/sitreps/**`, `web/src/design/**` | Current screen and component behavior | Source review only; no runtime viewport or assistive-technology exercise in D00 |
| `Reference Screenshots/` in the canonical checkout | Fourteen local files supplied by Basho: three Open Source EOC concepts, four map-style references, three identical WebEOC AAR dashboard copies, two identical WebEOC checklist copies, one WebEOC IAP view, and one Esri-style map/dashboard/lifeline montage | Local user-owned inputs. Never staged. Vendor/reference images are direction, not proof of our implementation |
| `docs/design-previews/2026-09-21/` in the canonical checkout | Light dashboard, dark dashboard, and ESF/Lifeline workspace concepts plus their generation prompts | Local untracked inputs, absent from this lane and never staged. All three images are synthetic design concepts, not delivered UI |
| `docs/process/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` | Product-level reference traits from Esri, WebEOC/Juvare, COBRA, and Microsoft Teams EOC | Research basis, not a pixel specification or current vendor acceptance result |

The three Open Source EOC images under `Reference Screenshots/` visually match the three canonical design concepts inspected under `docs/design-previews/2026-09-21/`. D03 must inventory them as local inputs and build only missing repository-resident compositions as coded gallery pages with mock data labeled as mock.

The settled direction visible across the concepts is a navy command shell, grouped navigation, teal interaction accents, explicit green/yellow/red/gray condition labels, compact information density, persistent incident/period/position/synchronization context, map plus operational work, and FOUO marking. D03 and D04 still own exact composition and token decisions.

## 3. Current application frame and routes

The current shell has one command bar, a 132 px navigation rail, a center surface, and a permanent 340 px boards/notifications dock. The grid is fixed in `web/src/app/layout/AppShell.tsx:33-84`. The 16 rail entries are declared in `web/src/app/screens/Console.tsx:28-45`. The custom hash router preserves browser history and deep links in `web/src/app/router.tsx:46-155`.

Login is a session-gated screen without its own route (`web/src/app/App.tsx:36-44`; `web/src/app/screens/Login.tsx:23-50`). An authenticated account without jurisdiction membership receives an explicit empty state instead of the shell (`web/src/app/screens/Console.tsx:74-80`). Board and SITREP detail routes are additional destinations under their parent rail entries.

### 3.1 All 16 current navigation destinations

| # | Destination and route | Source-verified current behavior | Current deficit or state gap | Engine seam | Owning design/presentation disposition |
|---:|---|---|---|---|---|
| 1 | Map, `#/` | Real MapLibre COP with board, feed, and incident-dataset layers; layer controls; search; inspection; measurements; export; bookmarks; point capture into a geo-enabled board | Poll failures can retain old features without a warning; dataset read errors are hidden; no complete small-screen layout; map placement lacks a keyboard/coordinate alternative | Existing COP, boards, feeds, datasets, MapLibre/PMTiles; H11, H12-E/H12-CB, H13, H14 extend engines | `P-COP` implements D11 once; D29 owns field capture presentation |
| 2 | Dashboard, `#/dashboard[/:id[/field/value]]` | Server-computed snapshot, 5-second polling, URL-carried filter/drilldown, incident scope, computed-at timestamp | Later poll failure leaves prior data without a stale warning; no saved layout/view yet; some raw tables bypass shared table semantics | Existing dashboard service; `79G-E1/E2`, `H12-E`, `SEAM`, `81-E` | `P-DASH` implements D12 and the 79G impact widget once |
| 3 | Incidents, `#/incidents` | Incident list, admin template activation, permission-gated close, operational-area editor, participant grants/revocation | Setup, period, positions, invitations, authority relationships, history, and closeout are not one guided activation flow | Existing incident, area, participation, and authorization services | D20 after `P-SHELL`; no second incident engine |
| 4 | Datasets, `#/datasets` | Incident catalog, onboard source, register one-dataset pack, coverage/availability/count status, refresh | No full mapping preview, accepted/rejected count, last-good explanation, or unified error recovery; catalog and ingestion readiness remain separate | Existing data-pack/catalog/dataset services and prior 79C work | D21 after `P-SHELL` and D07; reuse current registry and ingestion seams |
| 5 | Boards, `#/boards`; detail `#/board/:id` | Board index, first configured display view, schema-driven record form, authorized record creation | No saved views, consistent detail drawer, attachments/related records/history workspace, or retained list selection; current list is basic | Existing board template/runtime/services; `81A-E`, `81B-E1/E2` extend contracts and workflow | `P-BOARDS-1` implements D18; `P-BOARDS-2` implements D19 once |
| 6 | SITREP, `#/sitreps`; detail `#/sitrep/:id` | List of archived reports and read-only briefing with lifelines, board totals, significant events, and optional rumor control | No composition workflow, revision controls, source-freshness treatment, or integrated JIC preparation | Existing SITREP and JIC services; future lifeline assessment contract | D26 after `P-SHELL` and `P-LIFE-1`; reuse existing reports |
| 7 | Forms, `#/forms` | Preview of 12 enumerated ICS forms, IAP assembly, assembled form display, PDF download, admin approval | Fragmented from IAP working/published workflow; no consistent long-editor, draft, review, or revision presentation | Existing forms and IAP services; `84-E`, `84A-E` extend engine | `P-IAP` implements D24 across Forms and IAP |
| 8 | IAP, `#/iap` | Working list, five states, counts, completion progress, preparer/approver, submit/approve/complete, PDF | Creation remains in Forms; no unified period canvas, immutable revision selection, or faithful preview workflow | Existing IAP service plus `84-E` and `84A-E` | `P-IAP` implements D24 once |
| 9 | Smart Forms, `#/smartforms` | Imported-form renderer and submission for text, number, selections, dates/times, notes, and calculated-field omission | Image capture explicitly unavailable; import is API-only; queue/synchronization and touch field workflow are not exposed | Existing form runner and board-write seam | D29 after `P-SHELL`; D08 supplies shared form behavior |
| 10 | Resources, `#/resources` | 213RR creation and allowed lifecycle transitions with optional incident scope | Intake, assignment, supplying/receiving organizations, related actions, history, and unambiguous next action are not integrated | Existing resource lifecycle; `81B-E2` adds routing/approval/escalation/notifications | D22 after `P-SHELL`, `81B-E2`, and D07 |
| 11 | Tracking, `#/tracking` | Object registration, custody scans, reunification search by label/tag | No general tracked-object inventory, touch workflow, queued scans, or synchronization state | Existing tracking service and shared dictionaries | D29 after `P-SHELL` |
| 12 | AAR, `#/aar` | Observation capture, PDF composition/download, corrective action creation/list/status | No aggregate analytics/drilldown, accountable due-date/evidence workflow, or consistent filtering | Existing AAR service; `83-E` adds analytics, action ownership, due dates, and PDF fields | `P-AAR` implements D25 once |
| 13 | Feeds, `#/feeds` | Admin create for CAP, GeoJSON, GeoRSS, and CoT; health list; token disclosure; manual poll | No unified source readiness, mapping preview, accepted/rejected counts, last-good state, or bounded recovery flow | Existing feed adapters and ingestion service | D21 after `P-SHELL` and D07 |
| 14 | Messages, `#/messages` | Position-addressed thread creation, thread list, 5-second message polling, posting | Selected thread uses color only; read/delivery/acknowledgement distinctions and record context are absent | Existing messaging service and file attachment seams | D27 after `P-SHELL` |
| 15 | Files, `#/files` | Upload, jurisdiction search, download for file hits | No list-all library, file preview, attachment context, or reliable return to related record | Existing file service and search | D27 after `P-SHELL` |
| 16 | Alerts, `#/alerts` | Read-only polled notification list with new/read text and timestamps | No open, mark-read, filters, acknowledgement, resolution, or external-destination distinction; client already exposes mark-read | Existing notification service; `81B-E2` adds workflow notifications | D28 after `P-SHELL` and `81B-E2` |

### 3.2 Current destinations outside the 16 rail entries

| Destination | Current status | Disposition |
|---|---|---|
| Login | Functional credential form with busy and alert state | Preserve through `P-SHELL` and D31 authentication recovery work |
| Board detail | Real display view and create-record path | Included once in `P-BOARDS-1` / D18 |
| SITREP detail | Real archived briefing view | Included once in D26 |
| Operational-area editor | Real incident boundary, period metadata, history, conflict detection, and MapLibre editing nested in Incidents | Included once in D20; D10 owns cross-page period context |
| Incident participants | Real grant/revoke roster nested in Incidents | Included once in D20 |
| Right dock | Board launcher and latest six non-interactive notification titles | Replaced by `P-SHELL` context drawer/notification access, then D28 behavior |

Unknown hashes silently resolve to Map (`web/src/app/router.tsx:93-95`). This is current behavior, not an approved not-found design.

## 4. Current component and reuse inventory

| Component or pattern | Verified implementation | Reuse decision and owner |
|---|---|---|
| Theme/tokens | Light/dark variables, spacing, typography, radii, shadows, focus and contrast helpers in `web/src/design/tokens.ts` and `base.css` | Extend in D04. Keep existing names working until `KIT-CONTRACT` |
| Button | Shared primary/quiet control with native semantics and 44 px minimum height | Extend in D06; reuse everywhere |
| StatusBadge | Shared text-plus-color status treatment | Extend in D06; condition semantics remain authoritative |
| TextField and EnumSelect | Generated label/control IDs, persistent labels, 44 px controls | Extend in D08; schema-driven forms continue to use them |
| Panel | Shared bordered titled container | Extend in D06; do not create a competing card family |
| BoardTable | Captioned table with scoped headers and row rendering | Replace/extend through D07 as the one operational table system |
| BoardList | Reusable board navigation list | Reuse in D18 or retire only through `KIT-CONTRACT` after imports move |
| NotificationTray | Polite live-region list, currently presentation-only | Move to `P-SHELL`, extend in D28, then contract once |
| AppShell | Command bar, rail, center, permanent right dock | Rework once in `P-SHELL` for D09/D10 and VEOC-81C |
| Loading, ErrorNote, EmptyState, Scroll, SurfaceHeader | Shared app-level state and framing helpers in `web/src/app/screens/parts.tsx` | D06/D09 should promote consistent semantics and actions, then all surfaces reuse them |
| RecordForm | Shared-schema validation, enum controls, attachment states, delegated save/upload | Extend once through D08 and `P-BOARDS-1`; D19 reuses it for preview |
| BoardView | Shared `applyView` projection into `BoardTable` | Preserve as runtime seam; `P-BOARDS-1` adds browsing/detail behavior |
| Designer | Local template draft, schema validation, diff preview, delegated save | Extend once in `P-BOARDS-2`; 81A/B remain the engine |
| Dashboard | Tile, chart, status-grid, list widgets and drill callbacks over a supplied snapshot | `P-DASH` reuses the renderer and D07 table; no second dashboard engine |
| BriefingView | Read-only archived SITREP narrative | D26 extends composition and context without replacing the SITREP service |
| CopMap | MapLibre lifecycle, layers, inspection, tools, search, export, bookmarks and polling | `P-COP` extends once after H11 through H14; no replacement map engine |

Observed competing patterns that later units must converge include Dashboard's private card/raw-table styling, MapSurface's private select styling, and many inline form/grid styles. D00 does not refactor them.

## 5. State, accessibility, and responsive deficit register

These are source findings. Items described as likely viewport effects are explicitly inferred and require later runtime proof.

| ID | Source finding | Consequence | Owner |
|---|---|---|---|
| ST-01 | Shell always renders a hard-coded `live` badge (`web/src/app/layout/AppShell.tsx:42-50`) | Connectivity and synchronization can be misstated | D10, D31, `P-SHELL`, 85-B |
| ST-02 | `useAsync` retains prior data after refresh failure; Dashboard, Alerts, COP, dock, and several lists suppress or omit later errors | Old data can look current without an explicit stale/error qualification | D06, D10, D21, D28, D31, affected presentation unit |
| ST-03 | No global offline, queued, failed, conflict, or reconnect presentation exists under `web/src/app` | Operators cannot distinguish local save from server receipt | D31 after 85-B |
| ST-04 | Current domain states cover several unknown/stale/unavailable cases, but not-applicable and zero treatment is inconsistent by surface | Similar values can carry different meanings | D04, D06, D07 and each presentation owner |
| ST-05 | Busy controls often disable correctly, but container-level busy state and successful async announcements are inconsistent | Screen-reader users may miss progress or completion | D06 and D08 |
| ST-06 | No cross-surface protected-draft or unsaved-navigation contract is visible | Navigation or session change can risk unfinished work | D08, D10, D31 |
| AX-01 | Skip link remains off-screen while focused and its `href="#main"` shares the hash used by the router (`AppShell.tsx:34-36,89-96`; `router.tsx:46-95`) | It is not visibly discoverable and activation resolves the route to Map | `P-SHELL` / D09 |
| AX-02 | Shared loading text has no `role="status"` or live region (`web/src/app/screens/parts.tsx:5-7`) | Loading changes are not announced reliably | D06 |
| AX-03 | Map record placement and area drawing depend on map clicks; no coordinate-entry or keyboard alternative is exposed | Keyboard-only operation is incomplete | `P-COP` / D11 and D20 |
| AX-04 | Mounted MapLibre canvas has no explicit role/name in `CopMap` | Map purpose is not exposed at the component boundary | `P-COP` / D11 |
| AX-05 | Selected message thread is indicated by background color without selected/current state | Selection is not programmatically exposed | D27 |
| AX-06 | Dashboard's private list table lacks the caption/header-scope pattern already present in `BoardTable` | Table navigation semantics diverge | D07 and `P-DASH` |
| RS-01 | App shell uses fixed `132px 1fr 340px` columns and a non-wrapping command bar with no breakpoint (`AppShell.tsx:33-84`) | Narrow clipping/overflow is likely; runtime confirmation remains for D09 | `P-SHELL` / D09 |
| RS-02 | COP uses fixed `220px 1fr`; Messages uses `300px 1fr`; IAP and multi-column forms use fixed grids | Phone/tablet compression or overflow is likely; not runtime-tested here | D09 plus owning surface unit |
| RS-03 | Board and Dashboard raw tables lack a deliberate horizontal-scroll wrapper | Long names and dense columns can overflow | D07, `P-BOARDS-1`, `P-DASH` |

Existing strengths to preserve include semantic shell landmarks, `aria-current` on rail buttons, text accompanying status color, named form controls, visible focus styling in `base.css`, alert roles for many failures, Dashboard chart text alternatives, and the global incident context that remounts the center on incident change (`web/src/app/incident/context.tsx:14-99`; `Console.tsx:124-137`).

## 6. Initial design-to-capability ownership matrix

This is the D00 starting matrix. Engine units own data, authority, persistence, and operational contracts. Design/presentation units own the operator-facing implementation. A row with a concept or a partial current screen remains open until its prescribed unit and evidence gate pass. The current receipt reconciliation is in section 10.

| Prompt | Requested capability | Baseline disposition | Engine owner or reused seam | Exact Master implementation unit |
|---|---|---|---|---|
| D00 | Baseline, inventory, references, ownership | This document | None | `D00` |
| D01 | Six repeatable workflow baselines and measures | Requested; no timings or operator proof in D00 | Current interfaces as measured subjects | `D01` |
| D02 | Navigation map, hierarchy, role defaults, cross-links, Map/Boards/Planning arrangements | Requested; current rail is flat and ungrouped | Router and authorization discovery | `D02` |
| D03 | Light/dark wide/narrow compositions for six representative surfaces | Partial concept-only inputs exist; not delivered UI | Coded design gallery only | `D03`, then G-A review |
| D04 | Semantic tokens and identity placement | Partial token set exists | Existing theme/token seam | `D04` |
| D05 | Local accessible SVG icon family and registry | Requested | H13 shares asset/license inventory | `D05` |
| D06 | KPI, condition, record, action, summary cards and shared states | Partial primitives exist | Existing component kit | `D06` |
| D07 | One operational table with columns, filters, views, density and correct selection | Requested; basic `BoardTable` only | `SEAM` for saved views | `D07` |
| D08 | Consistent forms, drawers, dialogs, validation and recoverable drafts | Partial form controls exist | Board/form schemas and services | `D08` |
| D09 | Responsive shell, context drawer, headers, notification access and arrangements | Requested; fixed shell exists | `SEAM`; VEOC-81C structure | `P-SHELL` |
| D10 | Incident/period/position context, deep links, saved layouts and sync state | Partial incident context/hash deep links; other context requested | `SEAM` plus incident-scoping work | `P-SHELL` |
| D11 | Coherent COP layers, provenance, inspection, drawers, tools and field entry | Partial current Map/CopMap | H11, H12-E/H12-CB, H13, H14 | `P-COP` |
| D12 | Linked dashboards, filters, drilldowns, map linkage and saved views | Partial current Dashboard | `79G-E1/E2`, `H12-E`, `SEAM`, `81-E` | `P-DASH` |
| D13 | Versioned ESF/Lifeline assessment and activation contract | Requested new functional work; current SITREP lifeline summaries are not this engine | `79G-E2` and `81B-E1` prerequisites | `D13` |
| D14 | Eight-card Lifelines overview | Concept only; no current route/surface | D13 | `P-LIFE-1` |
| D15 | Lifeline detail and assessment workflow | Concept fragment only; no current workflow | D13 and `81B-E2` | `P-LIFE-2` |
| D16 | Incident-specific ESF coordination workspace | Concept fragment only; no current workspace | D13 and `81B-E2` | `P-LIFE-3` |
| D17 | Bidirectional ESF, Lifeline, map, facility, request, task, objective links | Requested | D13, `81B-E2`, 82-E, COP | `P-LIFE-4` |
| D18 | Board discovery, saved views, details, attachments, relationships and history | Partial current Boards | `81A-E`; D07/D08 | `P-BOARDS-1` |
| D19 | Board authoring, preview, versioning, routing, approvals and migration feedback | Partial current local designer | `81A-E`, `81B-E1/E2` | `P-BOARDS-2` |
| D20 | Incident activation, area, periods, organizations, positions, grants, history, closeout | Partial current Incidents and embedded panels | Existing incident/participation/area engines | `D20` |
| D21 | Dataset/feed readiness, mapping, coverage, counts, freshness and recovery | Partial current Datasets and Feeds | Existing registry, ingestion, feed adapters | `D21` |
| D22 | Resource request-to-disposition coordination | Partial current Resources | Existing lifecycle plus `81B-E2` | `D22` |
| D23 | Tasks, Lists, Templates, due work and offline reconciliation | Requested; no current Tasks destination | `82-E`; D07 | `P-TASKS` |
| D24 | Operational-period ICS Forms and IAP planning, review and revisions | Partial current Forms/IAP | `84-E`, `84A-E` | `P-IAP` |
| D25 | AAR analytics and accountable improvement actions | Partial current AAR | `83-E`; D07 | `P-AAR` |
| D26 | SITREP, briefing and JIC preparation | Partial read-only SITREP | Existing SITREP/JIC plus `P-LIFE-1` | `D26` |
| D27 | Messages and files attached to operational context | Partial separate Messages/Files | Existing messaging/files/search | `D27` |
| D28 | Notification inbox, acknowledgement, drafting/review and destinations | Partial read-only Alerts and dock | Existing notify plus `81B-E2` | `D28` |
| D29 | Touch field capture, tracking, attachments, queued submissions and sync | Partial Smart Forms, Tracking, map capture | Existing forms/tracking; offline claims wait for implemented path | `D29` |
| D30 | Branded, legible, provenance-rich exports | Partial current PDFs/map export | `83-E`, `84A-E`, D04, D05 | `D30` |
| D31 | Offline, stale, queued, failed, conflict, reconnect and session recovery states | Requested; static `live` is not evidence | `85-B`, sync/offline engines, `P-SHELL` | `D31`, then `85-PROOF` |
| D32 | Updated guidance and realistic synthetic demonstration scenario | Requested | Delivered Phase 2 surfaces and D31; existing demo seam | `D32` |
| D33 | One integrated visual/accessibility review | Requested future acceptance | Implemented presentation surfaces | `79D+D33` |
| D34 | Equivalent operator workflow comparison | Requested and Basho-gated; no operator result exists | D01 baseline and representative operators | `D34` |
| D35 | Final design/evidence reconciliation and release disposition | Requested future closeout | All receipts and matrices | `86+D35` |

### 6.1 Requested navigation surfaces absent from the current rail

The approved direction includes Overview, ESFs & Lifelines, Tasks, Field Reports, Operational Periods, Participants, JIC, Templates, and authorized Settings as discoverable destinations or shell actions. None is a standalone current rail destination at the inspected SHA. Their owners are:

| Requested destination | Owner |
|---|---|
| Overview | D02 information architecture; `P-DASH` for dashboard content; `P-SHELL` for route and placement |
| ESFs & Lifelines | D13 engine; `P-LIFE-1` through `P-LIFE-4` presentation |
| Tasks | 82-E engine; `P-TASKS` / D23 presentation |
| Templates | 82-E engine; `P-TASKS` / D23 presentation |
| Field Reports | Existing board/form capture reused; D29 presentation |
| Operational Periods | D20 incident setup/history plus `P-SHELL` context and `P-IAP` / D24 planning presentation |
| Participants | Existing participant engine; D20 presentation |
| JIC | Existing JIC service; D26 presentation |
| Settings | D02 decides discoverability; `P-SHELL` owns shell placement; settings remain limited to authorized controls |

Help is D32 contextual guidance and demonstration-artifact scope. No standalone Help route is planned unless later authorized.

## 7. Ownership rules that prevent duplicate implementation

1. D00 through D08 form the shared design foundation. They do not create a second operational engine.
2. `P-SHELL` is the only implementation of D09, D10, and VEOC-81C presentation. It owns the shell files while active.
3. `P-COP`, `P-DASH`, `P-BOARDS-1`, `P-BOARDS-2`, `P-TASKS`, `P-IAP`, `P-AAR`, and `P-LIFE-1` through `P-LIFE-4` each implement their surface once after the paired engine lands.
4. D20, D21, D22, D26, D27, D28, and D29 extend existing engines because no open parity prompt owns a replacement engine.
5. D13 is the one new ESF/Lifeline functional contract. Geographic exposure never implies service failure, and ESF activation never sets Lifeline condition.
6. D30 extends current export infrastructure. D31 presents 85-B continuity states. D32 updates guidance and the existing demo seam.
7. D33, D34, and D35 assess and reconcile evidence. They do not retroactively convert concepts, mock data, source inspection, or scripted journeys into operator validation.
8. `KIT-CONTRACT` removes unused old kit exports only after every presentation unit lands. No earlier unit builds a competing component family.

## 8. Practitioner feedback record

No dated practitioner feedback was supplied or observed during D00. The local screenshots are design/reference inputs and are not practitioner testimony. Source findings and scout observations above are verified against code and are not labeled as user research.

Future practitioner feedback must be recorded with date, participant role or declared perspective, task/context, exact observation, and whether it was reproduced in the application. D01 may record scripted baseline measures when no operator is available, but must label them scripted and must not invent human timings. D34 owns representative-operator comparison.

## 9. D00 acceptance reconciliation

- All 16 current rail destinations are inventoried, including their route, actual behavior, principal deficits, engine seam, and one presentation disposition.
- Login, board detail, SITREP detail, operational-area editing, incident participation, and the current right dock are accounted for.
- Every approved design prompt D00 through D35 has one owner and baseline disposition.
- Every requested future destination named by the approved navigation direction has an owner.
- Existing components are assigned to extension, reuse, or later contraction. No replacement application, map, board, dashboard, form, incident, resource, messaging, file, notification, or export engine is proposed.
- Synthetic concepts and vendor/reference screenshots are kept separate from delivered UI and operator evidence.
- Missing runtime, accessibility, responsive, live-system, and practitioner proof remains explicit for its later gate.

## 10. Current design-to-capability reconciliation, 2026-09-22

Current through `56d2558`. The original ownership baseline above remains
historical evidence; this table records what later receipts actually delivered
and preserves the boundary each receipt stated.

Status meanings:

- `verified`: the prompt's prescribed technical gate passed.
- `partial`: a usable increment passed, but the row's named proof remains.
- `open`: the prompt has not run.

Technical verification is not Basho's aesthetic acceptance, representative
operator validation, live external-system evidence, or release disposition.

| Prompt | Requested capability | Current evidence | Status | Remaining receipt boundary / V1 owner |
|---|---|---|---|---|
| D00 | Baseline, inventory, references and ownership | D00 inventory and accepted ownership map | verified | Current truth is maintained in this section |
| D01 | Six repeatable workflow baselines and measures | Scripted baselines and measures recorded | verified | No representative operator timing; D34 |
| D02 | Navigation hierarchy, role defaults and arrangements | Navigation contract `73bcd67` | verified | - |
| D03 | Light/dark and wide/narrow representative compositions | Reviewed composition package `e834975` | verified | Composition evidence, not product acceptance |
| D04 | Semantic tokens and identity placement | Token system `38d20f2`; browser acceptance receipt | verified | - |
| D05 | Local accessible SVG icon family and registry | Icon registry `a0d0051`; distinct-symbol correction `bb329d3` | verified | NAPSG breadth is separately bounded at F19 |
| D06 | Shared operational cards, controls and states | Shared kit `474296c` | verified | - |
| D07 | Operational tables, filters, views, density and selection | Scoped tables and saved views `263c30a` | verified | - |
| D08 | Forms, drawers, dialogs, validation and recoverable drafts | Recoverable forms and overlays `03e42ad` | verified | - |
| D09 | Responsive shell, context drawer, headers and notification access | P-SHELL-FRAME `ef13b0c` | verified | Operator comparison remains D34 |
| D10 | Incident, period and position context, deep links and saved layouts | P-SHELL-CONTEXT `64e3cf5` | verified | - |
| D11 | Coherent COP layers, provenance, inspection, tools and field entry | P-COP `e20e772`; KPI integration `b4c14bf`; D29 `d1c5d63` | verified | Operational vector-tile scale remains W4.5 |
| D12 | Linked dashboards, filters, drilldowns, map linkage and saved views | Dashboard engine `6aa5c09`; P-DASH `7ce5da6` | verified | - |
| D13 | Versioned ESF/Lifeline assessment and activation contract | Attributed assessment engine `8f0a565` | verified | - |
| D14 | Eight-card Lifelines overview | P-LIFE-1 `440b59e` | verified | - |
| D15 | Lifeline detail, assessment updates and history | P-LIFE-2 `ade3448` | verified | - |
| D16 | Incident-specific ESF coordination workspace | California/federal ESF workspaces `bd55856` | verified | - |
| D17 | Bidirectional operational assessment relationships | P-LIFE-4 `edc7b32` | verified | - |
| D18 | Board discovery, views, detail, attachments and history | P-BOARDS-1 `48edf63` | verified | - |
| D19 | Board authoring, preview, versioning, routing and migration feedback | P-BOARDS-2 `75464fc` | verified | User aesthetic acceptance remains separate |
| D20 | Incident activation, area, periods, organizations, grants and closeout | Integrated incident workspace `32249fc` | verified | - |
| D21 | Dataset/feed readiness, mapping, coverage, freshness and recovery | Dataset/feed administration `77817f8` | verified | Live scheduled sources remain W2.2 |
| D22 | Resource request-to-disposition coordination | Resource workspace `fadaa30` | verified | - |
| D23 | Tasks, templates, due work and offline reconciliation | Task engine `ecd5249`; P-TASKS `d867488` | verified | - |
| D24 | Operational-period ICS Forms and IAP planning/revisions | P-IAP `a5b96f9` | verified | - |
| D25 | AAR analytics and accountable improvement actions | P-AAR `32b2e4e` | verified | - |
| D26 | SITREP, briefing and controlled JIC preparation | Frozen briefings/JIC `79019cc` | verified | External publication remains separately authorized |
| D27 | Messages and files attached to operational context | Context workspace `b253180` | verified | - |
| D28 | Notification inbox, acknowledgement, review and destinations | Alerts/review workspace `95cb3f1` | verified | External channel reach remains W4.0 |
| D29 | Touch field capture, tracking, queued submission and sync | Field/tracking workspaces `d1c5d63` | verified | Remaining form types remain W4.7 |
| D30 | Branded, legible, provenance-rich exports | PDF provenance `0d3bf3b`; branded map export `2b40aee` | verified | - |
| D31 | Offline, stale, queued, failed, conflict, reconnect and session recovery | Durable Console recovery `7a52438` | verified | Independent transfer remains W6.4 |
| D32 | Guidance and realistic synthetic demonstration scenario | Usable exercise and guides `7eba769` | verified | Synthetic scenario is not operator testimony |
| D33 | Integrated visual and accessibility review | Not run | open | 79D+D33, then A11Y-T1 |
| D34 | Equivalent operator workflow comparison | No representative operators or result | open | Basho input and D34 |
| D35 | Final design/evidence reconciliation and release disposition | Not run | open | 86+D35 after all prior gates |

### 10.1 Agreement with the capability registers

- Delivered P-SHELL, P-DASH, P-BOARDS-1/2, P-TASKS and P-COP receipts are no
  longer shown as future work.
- The technical design chain is complete through D32. D33, D34 and D35 remain
  open exactly where the Master PSPR and V1 PSPR place them.
- Live data, real-hardware load, independent transfer, operator comparison,
  manual screen-reader evidence and user acceptance remain separate gates.
