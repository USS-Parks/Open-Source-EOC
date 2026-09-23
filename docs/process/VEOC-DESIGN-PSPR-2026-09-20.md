# Open Source EOC Design PSPR

**Initiative:** A unified visual identity and operator experience combining Esri's geographic situational awareness with WebEOC's operational coordination, with a measurable ambition of substantially faster workflows.

**Status:** Approved for execution through Basho's Master PSPR approval on 2026-09-21. Execution order, ownership and landing are governed by `docs/process/MASTER-PSPR-2026-09-21.md`. This document remains the design specification and the binding wording of D00 to D35. The prior publication approval alone did not authorize implementation.

**Scope:** The authenticated California-wide application, including its dashboard, navigation, maps, operational workspaces, forms, icons, branding, reports, and field experience.

**Draft date:** 2026-09-20.

## 1. Governance and relationship to the existing roster

The authoritative repository remains [USS-Parks/Open-Source-EOC](https://github.com/USS-Parks/Open-Source-EOC), with the canonical checkout at `C:\Users\17076\Documents\Open Source EOC`.

The inspected implementation baseline is `996f29c3895690501b491c732094794bae954918`. Execution must reconcile subsequent commits before changing anything.

The settled stack remains React/TypeScript, the existing Node API, PostgreSQL/PostGIS, MapLibre, PMTiles, and the established synchronization infrastructure.

This Design PSPR has **36 focused prompts, D00 through D35**. They decompose design work across the existing implementation roster; they are **not 36 additional backend features automatically appended to it**.

Related authority documents:
- [Canonical PSPR](./VIRTUAL-EOC-PSPR-2026-09-17.md).
- [Current implementation continuation](./VEOC-PARITY-CONTINUATION-2026-09-20.md).
- [Execution ledger](./VEOC-EXECUTION-LEDGER.md).
- [Facet status register](../FACET-STATUS.md).
- Supplied reference screenshots are local user-owned inputs, not published assets. The local path is `Reference Screenshots/`.

The ownership rules are:

- Existing VEOC prompts retain ownership of incident scoping, ingestion, spatial analysis, authorization, federation, and other operational engines.
- Design prompts specify and implement their operator-facing presentation and interaction.
- A shared deliverable receives one implementation and one evidence record, cross-referenced by both rosters.
- New ESF/Lifeline requirements are explicitly identified below rather than hidden inside dashboard styling.
- Existing completed work is reused after checking its actual scope.
- Execution proceeds sequentially through the agreed dependencies. A missing backend capability cannot be concealed by a convincing mockup.
- One focused prompt per commit, with a development-log receipt recording files, evidence, remaining limitations, and commit SHA.
- Use the canonical checkout. No additional worktree is needed for this sequential effort.

Once approved for execution, this document becomes the design authority for the affected VEOC acceptance criteria. Until then, the implementation roster remains controlling and this design roster remains proposed.

## 2. Settled product boundaries

The following are requirements, not design options:

- **Incident-centered operation.** The selected incident and operational period govern operational content.
- **California-wide applicability.** Reference screenshots do not select a deployment jurisdiction.
- **Explicit participation.** Municipalities, tribal nations, counties, agencies, utilities, and other organizations participate when relevant and authorized.
- **Separate authority.** Participation does not imply unified command, subordinate status, or shared ownership.
- **FOUO application.** No anonymous public-facing workspace.
- **Authorized viewing.** Valid authorized viewers and mutual-aid guests receive the intended incident visibility; contribution and approval authority remain distinct.
- **Honest data states.** Unknown, stale, unavailable, not applicable, and zero are different.
- **Persistent attribution.** Operational changes retain person, position, organization, incident, and time.
- **Protected work in progress.** Navigation, authentication recovery, and connectivity changes must not silently lose a draft.
- **Local operation.** Design assets must work without external font, icon, or styling services. Docker is not a prerequisite for the design demo.

## 3. Design direction

The proposed visual direction is **an information-rich command workspace with clear hierarchy, recognizable operational symbols, and restrained structural chrome**.

Richness comes from meaningful distinctions: lifeline conditions, geographic layers, accountable actions, clear typography, and well-organized information.

| Element | Proposed default |
|---|---|
| Application structure | Deep slate/navy navigation and command bar; clearly separated working surfaces |
| Light theme | Warm neutral background, white working surfaces, strong text contrast |
| Dark theme | Layered charcoal/slate surfaces, readable map detail, controlled highlights |
| Interaction accents | Blue/cyan or teal for selection, links, focus, and primary interaction |
| Operational condition | Explicit semantic colors, icons, labels, and explanatory text |
| Typography | Locally available system sans-serif; tabular numerals for operational counts |
| Spacing | Shared 4/8-pixel rhythm, with compact and comfortable density settings |
| Shape | Consistent modest corner radii; rounded badges where they aid recognition |
| Elevation | Borders and restrained shadows to distinguish drawers and overlapping surfaces |
| Motion | Short functional transitions; reduced-motion support; no decorative looping animation |
| Branding | Product identity throughout, with subordinate organization/incident identity |
| Language | Human-readable operational terms; internal identifiers stay out of normal labels |

Approval of this PSPR for execution would refine the older "color only for severity" interpretation: **brand and category accents are permitted, while operational status retains priority and unambiguous meaning.**

Exact palette values are settled through D03 and D04, after comparing the supplied screenshots and accessibility results.

## 4. Workspace architecture

Three arrangements share one application shell and one underlying record model.

| Arrangement | Primary use | Behavior |
|---|---|---|
| **Map** | Geographic awareness, field impacts, infrastructure, incident extent | Dominant map; collapsible layer panel; selection opens a contextual record drawer |
| **Boards** | Requests, assignments, status reporting, lists | Dominant table or board; optional map preview; persistent filters and record details |
| **Planning** | Operational periods, objectives, assignments, IAPs, briefings | Dominant document/workflow canvas; supporting records and progress alongside |

Switching arrangement must preserve the incident, relevant filters, selection, and protected drafts.

The shell contains:

- **Command bar:** incident, operational period, acting position, connectivity/synchronization state, and account controls.
- **Navigation rail:** labeled, collapsible, grouped by operational purpose.
- **Page header:** section identity, title, scope, freshness, and primary action.
- **Workspace:** the active map, dashboard, board, or planning surface.
- **Context drawer:** record detail, related actions, attachments, history, and attribution.
- **Notification access:** available throughout without permanently consuming a large right-hand column.

Suggested navigation groups:

| Group | Destinations |
|---|---|
| Situation | Overview, Map, ESFs & Lifelines, SITREP |
| Operations | Boards, Resources, Tasks, Field Reports, Tracking |
| Planning | Operational Periods, ICS Forms, IAP, AAR |
| Coordination | Participants, Messages, JIC, Files |
| Data and administration | Datasets, Feeds, Templates, authorized settings |

Grouping and role defaults may change during D02. Discoverability and access must remain intact.

## 5. ESF and Community Lifeline design contract

**"ESFs & Lifelines" becomes a first-class section.**

Community Lifelines describe essential service conditions. ESFs organize response support. Their relationship is many-to-many; their status models must remain separate.

FEMA's eight lifelines and its condition semantics provide the baseline. Blue is not an operational condition; gray represents unknown impact, while red, yellow, and green describe disruption and stabilization states. [FEMA Community Lifelines guidance](https://emilms.fema.gov/is_2901/groups/39.html)

California and federal ESFs must be separately identified and versioned. The California framework includes functions through ESF 18 and records the merger of ESF 16 into ESF 13. The product must preserve those distinctions and their crosswalk. [Cal OES ESF framework](https://www.caloes.ca.gov/office-of-the-director/operations/planning-preparedness-prevention/planning-preparedness/california-emergency-plan-emergency-support-functions/)

Each lifeline overview card should expose:

- Recognizable icon and readable name.
- Current assessed condition.
- Short impact statement.
- Affected components and geographic extent.
- Reporting organization and assessment time.
- Freshness and assessment confidence or evidence qualification.
- Stabilization outlook and unresolved actions.
- A direct path to its detailed workspace.

Each detailed lifeline workspace should support:

- Component and subcomponent assessments.
- Affected facilities and populations, with source and estimation method.
- Root causes, dependencies, and cascading effects.
- Stabilization objectives, actions, responsible organizations, and estimated completion.
- Linked resource requests and assignments.
- Assessment history and operational-period comparison.
- Conflicting reports and an attributed assessment decision.

Each ESF workspace should expose:

- California/federal identity and applicable local configuration.
- Incident activation state.
- Coordinator, supporting organizations, and contacts.
- Staffing and capacity information.
- Missions, requests, priorities, and outstanding decisions.
- Related lifelines and stabilization actions.
- Operational-period handoff and activity history.

**No automatic rule may equate geographic exposure with service failure, or ESF activation with a red lifeline.**

## 6. Component and interaction requirements

| Component | Required behavior |
|---|---|
| Navigation sidebar | Collapsible; labels available; active location clear; no essential action hidden behind unexplained icons |
| Context sidebar | Resizable and dismissible; sensible minimum/maximum width; restores focus when closed |
| KPI card | Label, value, scope, freshness, condition where applicable, and useful drilldown |
| Record card | Clear identity, owner, status, next action, and related context |
| Table | Adjustable columns, pinned identifiers, sorting, filtering, saved views, visible units and time zones |
| Input field | Persistent label, clear requirement, appropriate control, useful help, adjacent validation |
| Form window | Consistent layout, grouped fields, preserved draft, visible save/submission state |
| Drawer | Contextual inspection and bounded editing without losing the underlying workspace |
| Modal | Reserved for short decisions or actions requiring focused interruption |
| Long editor | Dedicated workspace for IAPs, substantial assessments, and other extended composition |
| Filter bar | Visible active filters, clear scope, individual removal, reset, and shareable state where appropriate |
| Notification | Clear urgency, incident, source, time, and destination; acknowledgement distinct from reading |
| Empty/error state | Explain what is absent or failed and provide the next useful action |
| Chart | Readable labels, meaningful units, accessible alternative, and reconciliation to supporting data |
| Activity history | Attributed changes, operational context, timestamps, and preserved approved revisions |

Bulk actions must state their scope. Searching, sorting, or refreshing a table must not silently change which records an action affects.

## 7. Verification gates

Verification remains proportionate.

### Design gate

A prompt's deliverable must show the intended behavior, relevant edge states, source/reference alignment, and connection to an existing or explicitly assigned implementation.

### Visual gate

Compare affected screens with the supplied references in light and dark themes. Verify hierarchy, information density, color semantics, icon consistency, and usable space. Do not require pixel-for-pixel reproduction.

### Interaction gate

Exercise the changed operator path once with representative data. Add focused regression coverage only where behavior warrants it.

### Data and authority gate

Use the real application/database path for incident isolation, contribution authority, persistence, approval, and synchronization claims. A mockup can close a design artifact; it cannot close operational integration.

### Accessibility gate

Target WCAG 2.2 AA for redesigned surfaces, including keyboard operation, visible focus, accessible naming, contrast, and alternatives to color. Use larger touch targets for field controls as a product choice. [W3C WCAG guidance](https://www.w3.org/TR/wcag/)

### Publication gate

Run one required pre-push check appropriate to the change. Documentation-only prompts receive documentation checks. Repeat broader checks only after a concrete failure or material change.

### Evidence rule

Every receipt distinguishes **designed**, **implemented**, **integrated**, and **operator-validated**. Missing vendor access or pilot evidence remains explicit.

## 8. Sequential prompt roster

### Milestone A: Reviewable design specification

#### D00: Establish the design baseline and ownership map

**Objective:** Reconcile the current application, supplied screenshots, parity matrix, and approved requirements.

**Deliverable:** A screen/component inventory identifying existing behavior, design deficiencies, backend dependencies, reference sources, and owning VEOC prompt. Record dated practitioner feedback separately from verified product behavior.

**Acceptance:** Every current destination and requested design capability has an owner and disposition. No existing implementation is duplicated or silently removed.

#### D01: Define operator journeys and workflow benchmarks

**Objective:** Translate the "2x better" ambition into specific tasks.

**Deliverable:** Baseline scripts for field reporting, lifeline assessment, resource coordination, board customization, IAP preparation, and shift briefing. Record completion time, interactions, duplicate entry, assistance, and errors.

**Acceptance:** Each comparison has the same task, data, permissions, and stopping condition. Unsupported vendor baselines are labeled unavailable.

#### D02: Specify navigation and information architecture

**Objective:** Organize the application around operator tasks.

**Deliverable:** Navigation map, section names, page hierarchy, role defaults, cross-links, and the three workspace arrangements.

**Acceptance:** Each benchmark journey has an explicit route. Authorized functions remain discoverable even when not pinned to a role's default navigation.

#### D03: Produce representative visual and interactive compositions

**Objective:** Settle the visual direction before widespread implementation.

**Deliverable:** Light/dark compositions for Overview, Map, ESFs/Lifelines, a dense board, a resource form drawer, and IAP Planning. Include narrow-screen examples and realistic information density.

**Acceptance:** The compositions demonstrate colors, icons, sidebars, cards, tables, fields, and branding as one system. Mock data is labeled. Open aesthetic decisions are presented together for review.

**Milestone A exit:** A coherent, reviewable design package with explicit implementation dependencies.

### Milestone B: Shared visual system and workspace foundation

#### D04: Implement semantic design tokens and branding

**Objective:** Establish one visual vocabulary.

**Deliverable:** Tokens for surfaces, typography, spacing, borders, elevation, focus, brand accents, chart categories, and operational conditions. Define product, organization, and incident identity placement.

**Acceptance:** Representative components render consistently in both themes. Branding cannot alter operational color meaning or imply command authority.

#### D05: Implement the icon system

**Objective:** Create recognizable navigation and action symbols.

**Deliverable:** A consistent SVG icon family, size/stroke rules, accessible names, active/disabled states, and a documented registry. Reuse recognized operational symbols with recorded source/license information.

**Acceptance:** Icons remain legible at their intended sizes, work offline, and have consistent meaning across pages. Custom branding does not distort doctrinal symbols.

#### D06: Implement cards, badges, and shared controls

**Objective:** Give different information types appropriate presentation.

**Deliverable:** KPI, condition, record, action, and summary cards; buttons, tabs, badges, menus, tooltips, progress indicators, and loading/empty/error states.

**Acceptance:** Each card type has a defined purpose and interaction. Unknown and zero differ visibly. Primary actions are identifiable without relying solely on color.

#### D07: Implement the operational table system

**Objective:** Support dense information without sacrificing readability.

**Deliverable:** Adjustable/pinned columns, sorting, filters, selection, saved views, pagination or justified virtualization, and compact/comfortable density.

**Acceptance:** A representative large board remains usable with long names and missing values. Selection and bulk-action scope remain correct after filtering and refresh.

#### D08: Implement forms, drawers, and dialog behavior

**Objective:** Make data entry consistent and recoverable.

**Deliverable:** Field types, grouped sections, conditional controls, inline validation, error summary, draft behavior, unsaved-work handling, and keyboard/focus conventions.

**Acceptance:** An operator can correct errors and resume a draft without re-entering completed information. Failed submission never appears successful.

#### D09: Implement the responsive application shell

**Objective:** Replace rigid space allocation with adaptable workspaces.

**Deliverable:** Collapsible navigation, resizable context drawer, page headers, notification access, and responsive Map/Boards/Planning arrangements.

**Acceptance:** Demonstrate wide desktop, standard laptop, tablet, and phone layouts. Essential content and actions remain accessible; tables/maps may use deliberate contained scrolling.

#### D10: Implement persistent context and workspace preferences

**Objective:** Preserve orientation across pages.

**Deliverable:** Incident/period/position controls, return-to-record behavior, saved layouts, deep links, filter restoration, and clear synchronization indicators.

**Acceptance:** Switching incident clears incompatible content without discarding protected drafts or presenting stale records as current. Browser Back behaves predictably. Depends on the corresponding VEOC incident-scoping work.

**Milestone B exit:** A branded, responsive application foundation with reusable components.

### Milestone C: Situational awareness and ESF/Lifeline operations

#### D11: Redesign the COP workspace

**Objective:** Make map layers, feature inspection, and actions coherent.

**Deliverable:** Searchable layer groups, clear legends, source/freshness/coverage information, feature selection, record drawers, map tools, and field-capture entry.

**Acceptance:** An operator can locate a feature, inspect its provenance, act on it, and return to the map without losing extent. Geographic reference layers remain distinct from incident operational records.

#### D12: Redesign the linked dashboard workspace

**Objective:** Connect indicators to operational evidence.

**Deliverable:** Dashboard selection, layouts, filters, card/chart drilldowns, optional map linkage, and saved views.

**Acceptance:** Indicators and their supporting records agree. Incident-area and viewport totals are clearly distinguished. Reuse VEOC-81 and existing filter/drilldown work.

#### D13: Define and implement the ESF/Lifeline assessment contract

**Objective:** Replace minimal category/status/note records with the required operational structure.

**Deliverable:** Versioned definitions; separate ESF activation/capacity and lifeline condition; components, impact statements, sources, assessment time, responsible organizations, stabilization actions, and history relationships.

**Acceptance:** Existing entries migrate without losing attribution. Conflicting assessments remain visible. California/federal mappings are explicit. This is new functional work, coordinated with VEOC-79G rather than disguised as styling.

#### D14: Implement the Lifelines overview

**Objective:** Provide an immediately understandable incident condition picture.

**Deliverable:** Eight lifeline cards with recognizable icons, meaningful color, component summaries, impacts, freshness, and stabilization outlook.

**Acceptance:** Every lifeline appears, including unknown ones. Cards provide accessible drilldowns. Stale reports cannot silently look like current green conditions.

#### D15: Implement the Lifeline detail and assessment workflow

**Objective:** Turn a condition card into an actionable workspace.

**Deliverable:** Component assessments, affected geography, evidence, stabilization objectives, actions, owners, estimates, and assessment history.

**Acceptance:** An authorized operator updates an assessment, explains the condition, links an action, and observes the attributed result in the overview and briefing.

#### D16: Implement the ESF coordination workspace

**Objective:** Show incident-specific response organization and workload.

**Deliverable:** Configurable applicable functions, coordinators/supporting organizations, activation, staffing/capacity, missions, requests, and period handoffs.

**Acceptance:** Unactivated and activated functions are distinguishable. Assignment follows actual incident authority. No organization or function is automatically activated by geography.

#### D17: Connect ESFs, Lifelines, maps, and actions

**Objective:** Make relationships operationally useful.

**Deliverable:** Bidirectional links among disrupted components, responsible ESFs/organizations, facilities, resource requests, tasks, and planning objectives.

**Acceptance:** Starting from a disrupted lifeline, an operator can identify affected assets, accountable actions, and stabilization progress. Multiple contributors are supported without implying a single command structure.

**Milestone C exit:** A usable geographic and operational condition workspace with dedicated ESF/Lifeline coordination.

### Milestone D: Consistent operational workspaces

#### D18: Redesign board browsing and record operations

**Objective:** Make boards readable and records actionable.

**Deliverable:** Board discovery, saved views, consistent record detail, attachments, related records, and attributed history.

**Acceptance:** A record can be found, inspected, edited where authorized, and revisited without losing filters or selection.

#### D19: Design the board authoring and workflow configuration experience

**Objective:** Make administrative customization understandable.

**Deliverable:** Field/layout editing, conditional behavior, preview, version publishing, position-based routing, approval configuration, and migration feedback.

**Acceptance:** An administrator builds and revises a representative operational board without HTML/JS. Reuse VEOC-81A/B; this prompt does not create a second board engine.

#### D20: Redesign incident activation and participation

**Objective:** Make scope and authority explicit during activation.

**Deliverable:** Incident setup, operational area, periods, participating organizations, positions, invitations/grants, revision history, and closeout navigation.

**Acceptance:** Single-organization and selected multi-organization cases are understandable. The interface distinguishes host, owner, participant, and command relationships.

#### D21: Redesign datasets and feed administration

**Objective:** Make source readiness understandable to operators.

**Deliverable:** Source catalog, mapping previews, coverage, update controls, freshness, accepted/rejected counts, error recovery, and last-good data display.

**Acceptance:** A user can determine whether a source is usable for the incident and explain what is missing. Registry presence never masquerades as successful ingestion.

#### D22: Redesign resource coordination

**Objective:** Expose the request-to-disposition workflow.

**Deliverable:** Request intake, priorities, assignments, lifecycle progress, receiving/supplying organizations, related incidents/actions, and history.

**Acceptance:** An authorized request moves through its supported lifecycle without duplicate entry, lost ownership, or ambiguous next action.

#### D23: Redesign Tasks, Lists, and Templates

**Objective:** Make assigned work and overdue actions easy to manage.

**Deliverable:** My Tasks/team views, categories, due dates, dependencies, templates, completion evidence, and analytics.

**Acceptance:** An operator can identify their next action, complete it, and see the reconciled result after a supported offline interval. Reuse VEOC-82.

#### D24: Redesign ICS Forms and IAP Planning

**Objective:** Support extended planning without fragmented navigation.

**Deliverable:** Operational-period organization, form navigation, working/published states, progress, ICS-204 assignment editing, review, approval, and preview.

**Acceptance:** The selected incident and period remain explicit throughout. Approved revisions are immutable; exports match the chosen revision. Reuse VEOC-84/84A.

#### D25: Redesign AAR and improvement planning

**Objective:** Connect analysis to accountable follow-through.

**Deliverable:** Observation entry, priority/capability analytics, filters, corrective actions, owners, due dates, evidence, and progress views.

**Acceptance:** Every aggregate drills to its records. An observation can become an accountable improvement action with retained provenance. Reuse VEOC-83.

#### D26: Redesign SITREP, briefings, and JIC preparation

**Objective:** Produce coherent operational narratives from existing information.

**Deliverable:** Briefing composition, lifeline/ESF summaries, significant events, source freshness, talking points, rumor tracking, and controlled preparation workflows.

**Acceptance:** Briefings identify their incident, period, source time, and revision. Frozen reports remain stable. FOUO scope does not silently introduce anonymous publication.

#### D27: Unify communication and file context

**Objective:** Keep discussions and supporting documents attached to operational work.

**Deliverable:** Consistent message/thread panels, recipient context, file previews, attachments, search, and links back to records.

**Acceptance:** Operators can retrieve the relevant discussion and document from an operational record. Read/unread, delivery, and acknowledgement are distinct where supported.

#### D28: Redesign alerts and notification handling

**Objective:** Make urgency and required action clear.

**Deliverable:** Notification inbox, filters, alert detail, acknowledgement, drafting/review states, and explicit sending destinations.

**Acceptance:** Reading a notification cannot be mistaken for acknowledging or resolving it. External alert actions remain distinguishable from local drafts and exercises.

#### D29: Redesign field reporting and tracking

**Objective:** Provide a practical touch-oriented field experience.

**Deliverable:** Focused capture forms, map placement, attachments, supported scan/custody actions, queued submissions, and clear synchronization state.

**Acceptance:** A supported field report and tracking handoff can be completed with retained attribution. Offline capability is demonstrated only for implemented paths; sensitive data is not exposed through convenience features.

**Milestone D exit:** Existing operational surfaces share the same visual language and predictable interaction rules.

### Milestone E: Continuity, delivery, and measured acceptance

#### D30: Apply branding to exported products

**Objective:** Keep briefings, reports, and maps consistent with the application.

**Deliverable:** Shared export typography, identity placement, incident/period/time information, legends, provenance, pagination, and approved handling markings.

**Acceptance:** Exports remain legible in print and grayscale. Prescribed ICS fields/layouts remain intact. Decorative branding cannot obscure operational content.

#### D31: Complete offline, conflict, and session-recovery presentation

**Objective:** Make degraded operation understandable.

**Deliverable:** Consistent offline/stale/queued/failed/conflict states, reconnect progress, recoverable drafts, and authentication recovery.

**Acceptance:** An operator can tell what is saved locally, received by the server, rejected, or awaiting resolution. Reuse VEOC-85 and existing synchronization behavior.

#### D32: Update operator guidance and the demonstration scenario

**Objective:** Make the redesigned application learnable.

**Deliverable:** Updated quickstart, role-oriented guidance, contextual help, and a realistic synthetic incident demonstrating the main workflows.

**Acceptance:** Documentation uses current names and screens. Sample data is explicitly labeled and shows unknown, stale, and partially complete conditions as well as successful ones.

#### D33: Perform the integrated visual and accessibility review

**Objective:** Catch inconsistencies introduced across surfaces.

**Deliverable:** One bounded review of representative screens, themes, viewport sizes, keyboard paths, long content, error states, and rendering behavior.

**Acceptance:** No blocking usability/accessibility defects remain in the reviewed paths. Findings are assigned and resolved proportionately; passing component evidence is reused.

#### D34: Run the operator workflow comparison

**Objective:** Measure the improvement promised by the design.

**Deliverable:** Repeat D01's tasks with representative operators and equivalent conditions; record task times, navigation, duplicate entry, errors, and assistance.

**Acceptance:** Publish task-by-task results and limitations. Claim "2x faster" only where the measured completion time is at most half the comparable baseline without a worse error outcome. Missing vendor access prevents that comparative claim, not fabrication of a result.

#### D35: Reconcile design completion and release disposition

**Objective:** Close the design initiative honestly.

**Deliverable:** Completed design-to-capability matrix, remaining issues, final reference captures, asset/license inventory, updated operator documentation, and proposed release disposition.

**Acceptance:** Designed, implemented, integrated, and operator-validated statuses agree with evidence. No design milestone is represented as whole-product parity. Release remains Basho's decision.

## 9. Dependencies and reuse ledger

| Existing seam | Treatment | Design ownership |
|---|---|---|
| Theme tokens and component gallery | Extend | D04 through D08 |
| Console, router, incident context | Extend | D09 through D10 |
| MapLibre COP and layer controls | Extend | D11 |
| Dashboard widgets and filter/drilldown implementation | Extend | D12 |
| Lifeline/ESF dictionaries, boards, SITREP services | Extend with explicit new assessment requirements | D13 through D17 |
| Board runtime/designer and workflow services | Reuse and extend | D18 through D19 |
| Participation and operational-area services | Reuse | D20 |
| Dataset registry, ingestion, feed adapters | Reuse completed VEOC work | D21 |
| Resource lifecycle and checklist services | Reuse | D22 through D23 |
| ICS forms, IAP, AAR, JIC | Reuse and improve surfaces | D24 through D26 |
| Messages, files, alerts | Reuse | D27 through D28 |
| Field forms, tracking, synchronization | Reuse | D29/D31 |
| PDF/map export infrastructure | Extend | D30 |
| Supplied screenshots and parity evidence | Organize into traceable design references | D00/D03/D33 through D35 |

**New bounded work:** the icon/brand specification, integrated design reference package, and the missing ESF/Lifeline assessment and coordination capabilities.

No replacement design framework, parallel application, or duplicate operational engine is proposed.

## 10. Overrides, parked scope, and blockers

**Configurable:** organization identity, saved layouts, density, default views, applicable ESFs, role shortcuts, source configuration, and locally defined labels with preserved mappings.

**Protected:** condition semantics, attribution, incident scope, authority, source provenance, approved revision history, and accessible interaction.

**Parked unless separately requested:** a product rename, public portal, AI assistant, native mobile rewrite, new video-conferencing platform, or reproduction of every separately licensed vendor module.

**Potential external blockers:** licensed comparison environments, representative operator participation, source licenses, and real deployment/pilot evidence. These block their specific acceptance claims rather than unrelated design work.

## 11. Completion definition

The design initiative is complete when:

- Every in-scope page uses the approved visual system.
- Custom icons and branding are consistent across application and exports.
- Sidebars, cards, tables, columns, fields, drawers, and dialogs behave predictably.
- Map, Boards, and Planning arrangements preserve operational context.
- ESFs and Lifelines have a complete dedicated workspace.
- Data condition, freshness, ownership, and authority remain understandable.
- The affected workflows work against the real application.
- Accessibility and field usability meet the agreed gates.
- Workflow improvement is measured and reported honestly.
- The design roster and implementation roster point to the same evidence.

**Execution was approved through the Master PSPR on 2026-09-21.**
**The Master PSPR governs scheduling and preserves the Milestone A review gate.**
