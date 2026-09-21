# D02 navigation and information architecture

**Date:** 2026-09-21
**Design baseline:** `8d144e3444aa5c4196a2ed514e46491f70e6175f`
**Evidence level:** Designed from source and the approved roster. Not implemented or operator-validated.

## 1. Purpose and boundary

This document defines the target application hierarchy for `P-SHELL`, D03, and the paired presentation units. It starts from the five approved navigation groups and retains every current destination.

The current application still uses the flat 16-item rail in `web/src/app/screens/Console.tsx` and the hash routes in `web/src/app/router.tsx`. Target routes and arrangements below are design contracts. A row is not delivered behavior unless it is explicitly marked current.

D02 adds no operational engine and grants no authority. Navigation presets are user-interface preferences. A route, visible link, incident relationship label, or acting-position selection never establishes permission; the server remains authoritative.

## 2. Shell and page hierarchy

The target shell has five stable levels:

1. **Command bar:** product and organization identity; selected incident; operational period; acting position; synchronization state; notification access; account controls.
2. **Grouped navigation:** Situation, Operations, Planning, Coordination, and Data and administration. Groups remain labeled when expanded and have accessible names when collapsed.
3. **Page header:** section name, page title, incident and period scope, freshness or draft state, breadcrumbs where needed, and one primary action.
4. **Workspace:** one dominant Map, Boards, or Planning arrangement. A surface supplies content; the shell supplies placement and responsive behavior.
5. **Context drawer:** selected record, source, owner, related actions, attachments, history, and return path. It is resizable on wide screens and dismissible at every size.

Notification access is a persistent command-bar utility, not a sixth navigation group. Contextual guidance appears beside the current task through the D32 seam. No standalone Help route is planned.

The page hierarchy is:

```text
Application
|-- Situation
|   |-- Overview
|   |-- Map
|   |-- ESFs & Lifelines
|   `-- SITREP
|-- Operations
|   |-- Boards
|   |-- Resources
|   |-- Tasks
|   |-- Field Reports
|   |-- Smart Forms
|   `-- Tracking
|-- Planning
|   |-- Operational Periods
|   |-- ICS Forms
|   |-- IAP
|   `-- AAR
|-- Coordination
|   |-- Participants
|   |-- Messages
|   |-- JIC
|   `-- Files
`-- Data and administration
    |-- Incident Setup
    |-- Datasets
    |-- Feeds
    |-- Templates
    `-- Settings
```

## 3. Route contract

The shell continues to use hash routes so deployed static hosting and existing deep links remain valid. Canonical target locations use `#/<path>`. Record identities belong in the path. Restorable workspace state may use hash-query keys such as `incident`, `period`, `view`, `filter`, and `record` after `P-SHELL` and `SEAM` support them.

Acting position and authority never come from route parameters. A copied link is a request to open context, not a permission grant. The destination must recheck authorization and show a clear unavailable or access-limited state when it cannot open.

Existing paths stay valid. `#/` remains Map, current board and SITREP detail links remain valid, and existing Dashboard drilldown links keep their meaning. Unknown routes must produce a not-found state with links to Map and Overview instead of silently opening Map.

Browser Back restores the prior route, incident-compatible filters, selection, drawer state, and scroll position. A cross-link carries a return location so closing a drawer or detail page returns to the exact originating workspace.

## 4. Navigation map for current destinations

| Current destination | Current route | Target group and label | Canonical route | Target disposition and owner |
|---|---|---|---|---|
| Map | `#/` | Situation / Map | `#/` | Retain path; `P-COP` supplies the workspace |
| Dashboard | `#/dashboard[/:id[/field/value]]` | Situation / Overview | Existing Dashboard paths | Rename the navigation label; `P-DASH` keeps drilldowns and saved views |
| Incidents | `#/incidents` | Data and administration / Incident Setup | `#/incidents` | D20 presents activation, scope, relationships, periods, and closeout |
| Datasets | `#/datasets` | Data and administration / Datasets | `#/datasets` | D21 retains the current registry and readiness engine |
| Boards | `#/boards`; `#/board/:id` | Operations / Boards | Existing Board paths | `P-BOARDS-1` supplies list, detail, and drawer behavior |
| SITREP | `#/sitreps`; `#/sitrep/:id` | Situation / SITREP | Existing SITREP paths | D26 adds composition while preserving archived detail links |
| Forms | `#/forms` | Planning / ICS Forms | `#/forms` | `P-IAP` integrates forms with period planning |
| IAP | `#/iap` | Planning / IAP | `#/iap` | `P-IAP` supplies the unified planning canvas |
| Smart Forms | `#/smartforms` | Operations / Smart Forms | `#/smartforms` | D29 supplies the field workflow and honest sync states |
| Resources | `#/resources` | Operations / Resources | `#/resources` | D22 retains the resource lifecycle and adds coordinated disposition |
| Tracking | `#/tracking` | Operations / Tracking | `#/tracking` | D29 retains tracking and adds field inventory and queued scans |
| AAR | `#/aar` | Planning / AAR | `#/aar` | `P-AAR` adds analytics and corrective-action workflow |
| Feeds | `#/feeds` | Data and administration / Feeds | `#/feeds` | D21 retains adapter and ingestion seams |
| Messages | `#/messages` | Coordination / Messages | `#/messages` | D27 adds operational context without replacing messaging |
| Files | `#/files` | Coordination / Files | `#/files` | D27 adds library, preview, attachment context, and return links |
| Alerts | `#/alerts` | Command bar / Notifications | `#/alerts` | D28 turns the current list into the notification center |

All 16 current destinations therefore retain a named path. Moving a destination into a group or utility does not remove it.

## 5. New target destinations

| Destination | Canonical target route | Parent or detail hierarchy | Implementation owner |
|---|---|---|---|
| ESFs & Lifelines | `#/lifelines` | Lifeline detail `#/lifeline/:id`; ESF detail `#/esf/:id` | D13 engine; `P-LIFE-1` through `P-LIFE-4` presentation |
| Tasks | `#/tasks` | Selection opens a task drawer and preserves the filtered list | 82-E engine; `P-TASKS` / D23 presentation |
| Field Reports | `#/field-reports` | Stable operator route backed by the configured Field Reports board | Existing board/form engine; D29 presentation |
| Operational Periods | `#/periods` | Period selection supplies context to Forms, IAP, SITREP, and briefings | D20 setup/history; `P-SHELL` context; `P-IAP` planning |
| Participants | `#/participants` | Incident-scoped roster with links to organization, position, and grant context | Existing participation engine; D20 presentation |
| JIC | `#/jic` | Preparation, review, approved release, related files and messages | Existing JIC service; D26 presentation |
| Templates | `#/templates` | Task/list templates; board customization remains inside its board | 82-E engine; `P-TASKS` / D23 presentation |
| Settings | `#/settings` | Only settings the signed-in account is authorized to view or change | `P-SHELL` placement over existing authorized controls |
| Board customization | `#/board/:id/design` | Child of Board detail, with preview and publish states | `P-BOARDS-2` / D19 over 81A and 81B |

Overview uses the existing Dashboard route family rather than introducing a second dashboard destination. Field Reports uses a stable task-facing route while continuing to store and render records through the existing board engine.

## 6. Role defaults and discoverability

Role defaults choose a suggested landing page and pinned destinations. They do not hide authorized destinations, alter server policy, imply incident command, or follow a user into an incident where the context is invalid.

On first use, the shell may suggest a preset from the current acting-position family. The operator can accept, reorder, pin, unpin, or replace it. `SEAM` stores the resulting preference by user and incident. A direct link always wins over a landing preference.

| Context or acting-position family | Suggested start | Suggested pins |
|---|---|---|
| No acting position or general participant | Map | Overview, Map, Messages, Files |
| Command or General Staff | Overview | Overview, Map, ESFs & Lifelines, SITREP, Operational Periods |
| Operations Section | Map | Map, Boards, Tasks, Field Reports, Tracking |
| Planning Section | Operational Periods | Overview, ESFs & Lifelines, SITREP, Operational Periods, ICS Forms, IAP, AAR |
| Logistics Section | Resources | Resources, Boards, Tasks, Files |
| Public Information or JIC | JIC | Overview, SITREP, JIC, Messages, Files |
| Authorized incident or data administrator | Incident Setup | Incident Setup, Participants, Datasets, Feeds, Templates, Settings |

The complete grouped directory remains available from the expanded rail and a labeled All sections control. Search results and contextual links may expose any authorized destination even when it is not pinned. A compact rail shows icons plus accessible names and reveals labels on expansion; essential destinations are never icon-only.

A user with multiple relationships sees one preset at a time, based on the explicitly selected acting position. Host, owner, participant, administrator, and viewer are relationship or access context, not automatic preset names and not command authority.

## 7. Incident relationship and authority context

The selected incident control shows the incident name and owning jurisdiction. The page header or context drawer shows relationship fields supplied by the incident engine:

- **Host:** the organization providing the incident workspace.
- **Owner:** the organization accountable for the incident or selected record.
- **Participant:** a named organization or person with incident-specific participation.
- **Command relationship:** the recorded single, unified, or other command arrangement when the incident engine supplies it.

These labels remain separate. Participation does not imply ownership, host status, subordination, or unified command. A relationship badge is descriptive and never substitutes for an authorization check.

When no acting position is selected, the command bar says `No acting position` rather than inferring one from role, page, organization, or navigation preset. Viewer, contributor, approver, and administrative actions remain explicit at the action point.

## 8. Required cross-links

Cross-links use the same engines and carry incident, period, source, and return context where compatible.

| Origin | Required destination and preserved context |
|---|---|
| Overview KPI or list item | Filtered Map, Board, Resources, Tasks, or Lifeline destination with the KPI scope and computed-at time visible |
| Map feature | Context drawer, then owning Board record, Field Report, Lifeline, Dataset source, or Feed source without losing map extent and layers |
| Lifeline assessment | Affected Map extent, related ESFs, actions, resource requests, Tasks, and the current SITREP source entry |
| ESF workspace | Related Lifelines, missions, Resources, Tasks, Participants, Messages, and period handoff |
| Board record | Map preview when geographic, related records, Tasks, Files, attributed history, and authorized Customize action |
| Resource request | Related incident objective, assignment or Task, supplying and receiving organizations, Files, and history |
| Task | Source Board record or request, operational-period objective, assignee, Files, and map context when present |
| Field Report | Map location, board-backed record, attachments, related Tasks or requests, and sync state |
| Operational Period | ICS Forms, IAP, SITREP, assignments, objectives, and published briefing for that same period |
| IAP | Constituent forms, assignments, Resources, approval history, published revision, and period briefing |
| SITREP | Source Lifelines, Boards, significant events, JIC preparation, and archived period context |
| Participants | Organization, incident position, time-bounded grant, related Messages, and incident history |
| JIC | Source SITREP, approved facts, Files, Messages, notification draft, and publication state |
| Dataset or Feed | Map layer, coverage, provenance, accepted/rejected counts, last-good state, and recovery action |
| Notification | Exact incident record or workflow state that generated it, with reading separate from acknowledgement or resolution |

A cross-link must not copy data into a parallel record merely to navigate. The destination reads the authoritative source and displays provenance.

## 9. Workspace arrangements

### 9.1 Map arrangement

The map is the dominant canvas. A collapsible left layer panel contains layers, legend, filters, saved views, and source state. Selecting a feature opens the shared context drawer on the right. Search, measurement, export, bookmark, and field-entry tools stay attached to the map rather than becoming global navigation items.

On a narrow screen, the map remains full width. Layers and record detail open as mutually exclusive sheets; closing either returns focus to its trigger and preserves extent, zoom, visible layers, filters, and selection. A non-map coordinate or list path remains available for actions that cannot depend on pointer placement.

### 9.2 Boards arrangement

The table, list, or board view is the dominant workspace. The page header holds board identity, incident scope, saved view, freshness, and primary create action. Filters remain visible. Selecting a record opens the shared context drawer; an optional map preview uses the record's authoritative geometry.

On a narrow screen, list and record detail become sequential full-screen states. Back returns to the same saved view, filter, sort, selection, and scroll position. Customization opens `#/board/:id/design` only for an authorized account and never replaces the runtime record view.

### 9.3 Planning arrangement

The document or workflow canvas is dominant. A period/outline panel supplies operational periods, forms, sections, and revision choice. The context drawer shows completeness, approvals, source records, validation, history, and related actions. ICS Forms and IAP share period context and use `#/iap` as the benchmark preparation workspace.

On a narrow screen, outline, editor, and review are sequential states with a persistent draft indicator. Navigation between them does not submit, approve, or publish. The operator must see whether a revision is working, in review, approved, completed, frozen, or published.

### 9.4 Shared state rules

Arrangement switching preserves the selected incident, compatible period, filters, saved view, selection, return path, and protected draft. Draft contents do not belong in the URL. D08 owns draft controls, D10 and `P-SHELL` own navigation protection, `SEAM` owns layout preferences, and D31 owns recovery and synchronization states.

Switching incident clears incompatible records only after any protected draft is saved, recoverably retained, or explicitly discarded. The shell lists affected drafts and never presents records from the prior incident as current. Closing a drawer restores focus. Browser Back never acts as an implicit save, submit, approve, acknowledge, or publish action.

## 10. Navigation states and accessibility contract

The grouped rail has three deliberate presentations:

- **Expanded:** group names and destination labels are visible. Groups use headings and do not require disclosure controls merely to reach a destination.
- **Compact:** destination icons retain accessible names, active state, and a labeled expansion control. Group boundaries remain perceivable.
- **Narrow:** one labeled navigation sheet overlays the workspace. Closing it restores focus to the opener and does not reset the workspace.

The shell applies these interaction rules:

1. The current destination uses `aria-current="page"` and a visible treatment that does not rely on color alone.
2. Expansion controls expose expanded state and name the group they control.
3. Keyboard order follows command bar, navigation, page header, workspace, then context drawer.
4. A visible skip link targets the workspace without mutating the hash route.
5. Opening a drawer moves focus to its heading or first useful control; closing it restores focus to the originating record.
6. Route loading, stale data, unavailable data, access limits, empty results, and zero results are distinct states with text.
7. Hidden-by-preference destinations remain in All sections; permission-limited actions explain the required access when disclosure is safe.
8. Notification count and synchronization condition include readable labels and never depend on badge color alone.
9. Pointer hover is supplementary. Every navigation and cross-link action works from keyboard and touch.
10. Map-only actions provide an equivalent list, search, coordinate, or form path owned by the relevant surface unit.

D03 shows expanded, compact, and narrow navigation states. `P-SHELL` implements their mechanics and verifies focus, names, current state, and usable workspace width.

Deep links retain a readable page title at every level.
Group collapse state is a layout preference only and never changes access.

## 11. Explicit D01 benchmark routes

| Journey | Current route | Target route and sequence | Availability after target owner lands |
|---|---|---|---|
| BR-01 Field reporting | `#/` then `#/board/:id` | `#/` for Add point, then `#/field-reports` for confirmation | Existing engine; stable Field Reports route in D29 |
| BR-02 Lifeline assessment | No current route | `#/lifelines` then `#/lifeline/energy`; save links to the current SITREP | D13 and `P-LIFE-1` through `P-LIFE-4` |
| BR-03 Resource coordination | `#/resources` | `#/resources`; selected request remains addressable in the drawer or detail state | D22 over the current resource engine |
| BR-04 Board customization | No mounted current route | `#/boards`, `#/board/:id`, then `#/board/:id/design`; publish returns to the same board | `P-BOARDS-2` over 81A and 81B |
| BR-05 IAP preparation | `#/forms` then `#/iap` | `#/iap` with period, form preview, assembly, review, and submission in one Planning arrangement | `P-IAP` over 84-E and 84A-E |
| BR-06 Shift briefing | `#/sitreps` then `#/sitrep/:id` | Same route sequence with preserved period and return context | D26 over the existing SITREP engine |

Each benchmark now has an explicit target route. The two currently unavailable journeys remain unavailable until their named engine and presentation units land; D02 does not change their implementation status.

## 12. P-SHELL and D03 handoff

`P-SHELL` implements the command bar, grouped rail, page header, context drawer, notification access, compatibility routes, not-found state, return-to-record behavior, and the responsive arrangement frame. Each paired presentation unit supplies its surface once. No shell component may create a second Map, Board, dashboard, form, incident, message, file, notification, resource, or SITREP engine.

D03 compositions should use the exact five group names, command-bar contexts, page hierarchy, route labels, and three arrangements in this document. The wide and narrow examples must show protected draft state, freshness or synchronization state, clear selection, labeled collapsed navigation, and host/owner/participant context where relevant.

D02 is complete at the designed level only. Runtime route behavior, responsive layout, accessibility, permission enforcement, persistence, and operator performance remain for their named implementation and evidence gates.