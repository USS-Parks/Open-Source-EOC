# California hybrid parity continuation

**Current execution authority:** the focused roster amendment at the end of
this document supersedes the earlier sequence and any conflicting completion
claims. Earlier sections are retained as plan history.

**Proposed design companion:** the [Design PSPR](./VEOC-DESIGN-PSPR-2026-09-20.md)
contains 36 focused design prompts and five reviewable milestones. It maps
operator-facing work to the existing implementation owners and specifies the
ESF/Lifeline workspace. The document is a published draft; execution approval
and dependency reconciliation remain separate from publication.

## Authority and scope

Basho authorized the entire remaining roadmap on 2026-09-20 and clarified
California-wide, plug-and-play operation for any jurisdiction. This addendum
extends the canonical PSPR and VEOC-77 handoff; it preserves their history.
Work stays in this canonical checkout on main, one focused prompt per commit.
The stack, license policy, tenant isolation, immutable audit and calm-screen
invariants remain binding. No production alert or deployment is authorized by
an implementation test. Real pilot evidence and external credentials cannot
be synthesized.

## Verification before completion

Each prompt needs positive and negative behavior tests, typecheck, lint,
license/link gates, appropriate browser proof, an append-only receipt and
verified publication. CI runs database-backed tests; local browser tests of
real tile archives remain separate. Compare the eight distinct supplied
reference images with the operator screens in both themes. Record geographic
coverage, data provenance, licenses and unavailable layers explicitly.

## Sequence

Scope correction from Basho, 2026-09-20: close the already implemented handoff
8 evidence, then execute VEOC-79 through VEOC-79D before further visual
extensions. Resume handoff 10 through 15, then VEOC-80 onward. The incident
foundation is a dependency for operational parity, not a jurisdiction demo.

| Prompt | Focused objective | Acceptance gate |
|---|---|---|
| VEOC-79 | Incident operational-area model and lifecycle | Create, revise and audit incident area geometry independently of administrative boundaries; simultaneous incidents retain distinct areas and operational periods; invalid geometry rejected |
| VEOC-79A | Multi-organization incident participation and authority | Only incident-relevant organizations join through explicit authorized participation; single-organization and varied multi-organization cases work, including a case with no tribal participant; person, home organization and incident position remain attributable; API and database deny uninvolved organizations, unrelated incidents and revoked/expired grants |
| VEOC-79B | Shared incident context throughout the operator workspace | Selected incident drives COP, boards, feeds, dashboards, resources, tasks and planning context; authorized contributions from all participants appear together; switching incidents cannot retain the previous incident's records, cached content or subscriptions |
| VEOC-79C | Activation-time organization and data onboarding | Add a new participating entity and its configured datasets without a code change or application redeploy; preserve source ownership, field mapping, freshness and coverage; missing data never blocks incident activation or appears as zero impact |
| VEOC-79D | Integrated cross-boundary incident exercise | Browser plus real database proof: activate, expand area, onboard partners, post field impacts, request/assign resources across organizations, reconcile COP/KPIs, publish a joint operational-period IAP, revoke access and close; second concurrent incident stays isolated; offline reconnect and federation preserve attribution |
| VEOC-80 | Anonymous public-information map with explicitly published records | Approved public records and JIC releases visible without login; protected fields/boards never exposed; revocation and lockdown negative tests |
| VEOC-81 | Linked operational dashboard workspace | Saved layout/filter state, map-linked KPIs and drilldowns; browser totals reconcile to underlying records and URL state |
| VEOC-82 | Dedicated checklist Tasks/Lists/Templates workspace | Assignment, due/status/category filters and analytics; offline completion reconciles; keyboard and browser workflow proof |
| VEOC-83 | AAR dashboard and accountable improvement plans | Priority/status/capability analytics and action owner/due dates; totals reconcile, filters work, PDF retains operational fields |
| VEOC-84 | IAP workspace filters and navigation | Working/published organization, operational-period and role filters, visible progress and workflow; five-state browser proof |
| VEOC-84A | Editable ICS-204 assignments and immutable approved revisions | Author/revise assignments with resources, supervisor and tactics; freeze and PDF export; prior approved revision remains unchanged |
| VEOC-85 | Disconnected provisioning and offline operational continuity | Cold air-gapped setup, jurisdiction/incident activation and reconnect conflict recovery; otherwise record the exact remaining AR7 blocker |
| VEOC-86 | Live readiness and release disposition | Named real California pilot, evaluator AAR, required independent deployment proofs and maintainers; authorized IPAWS test credentials if claiming live IPAWS; explicit release decision |

## Reuse ledger and staged milestones

Reuse board schemas/runtime, incident checklists, dashboard widgets, position
identity, jurisdiction RLS, JIC publishing, IAP workflow, PDF rendering and the
existing offline queue. Extend those seams before introducing new stores.
New work is the public projection boundary, jurisdiction data-pack contract,
and missing operational editing/analytics surfaces. No parallel product fork.

Milestones are independently usable: California geographic reference layers
(handoff), shared multi-organization incident operations (79-79D),
public/linked situational awareness (80-81),
complete planning and improvement workflows (82-84A), disconnected continuity
(85), and live accepted release (86). County data availability, private
credentials, real participants and release authority remain external inputs.

Completion requires functional operator evidence and source-faithful visuals,
not only backend existence or screenshot similarity. Missing live evidence
keeps the corresponding capability open.

## Incident-centered parity correction, 2026-09-20

Basho clarified that product parity is not jurisdiction-specific. California
is the supported geographic envelope. The incident and its evolving operational
area organize response, including incidents spanning administrative boundaries.
San Diego and all other locations in the supplied screenshots are references,
not required deployments, hard-coded scopes or acceptance pilots.

A large municipality, tribal nation, small local government, mutual-aid agency,
utility or other participating entity must be able to join an incident when
needed. Preserve each entity's identity, authority and protected records. A
tribal nation is not modeled as a subordinate county. Geography never grants
access automatically. Explicit incident participation and sharing agreements
determine what each person and position can view, contribute, approve or export.

Separate five concepts in implementation: administrative tenant/data ownership;
participating organization; incident identity and operational period; incident
area geometry; and authorization scope. A sponsoring tenant is an ownership
detail, not a limit on the incident footprint or participating organizations.
Deployment-wide map bounds and static archives are reference configuration;
they cannot substitute for incident area selection or activation-time imports.

The hybrid acceptance target combines Esri's incident mapping, impact analysis,
community lifelines, field information, briefings and public information with
WebEOC's position-aware incident boards, resource coordination, configurable
workflows, checklists, IAPs, activity history and cross-organization sharing.
These capabilities must use the same incident context and underlying records.

Official references checked on 2026-09-20:
- [Esri Emergency Management Operations workflows](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-emergency-management-operations.htm).
- [WebEOC incident model](https://docs.juvare.com/webeoc-onnexa/help/incidents/about-incidents.htm).
- [WebEOC incident creation and sharing](https://docs.juvare.com/webeoc-onnexa/board-list/board-incident-creator.htm).

Observed gaps, not completed capabilities: incident activation currently uses
one jurisdiction for its positions, boards and libraries
(server/src/incidents/service.ts). The incident schema has no operational-area
geometry or participant-organization relation (0005_incidents.sql). MapSurface
accepts jurisdiction and collections but no selected incident. Guest grants
are jurisdiction-scoped; existing federation shares boards through agreements.
These are reuse seams, not evidence of integrated incident-wide parity. Later
migrations and every affected authorization path must be audited at VEOC-79A.

The earlier two-jurisdiction data-pack acceptance criterion is superseded.
Use single-organization and selectively shared multi-organization scenarios,
including one with no tribal participant, plus a separate concurrent incident
for the functional gate. No organization type is mandatory in an incident. A named real operator/evaluator remains a final release input,
not a prerequisite for defining this product or continuing implementation.
No baseline, screenshot, unit test or data-pack build closes this exercise.

Further clarification from Basho: jurisdictions need not be unified in every
response. Participation is selected per incident and may consist of one entity.
No tribal nation, county, city or agency is automatically involved because its
type appears in a test scenario or because an incident is in California.
Multiple entities may coordinate selected information while retaining separate
command structures; participation does not imply unified command.


## Verification clarification, 2026-09-20

Basho directs proportionate testing and steady roster execution. Use focused
checks for each change and one required pre-push gate. Repeat only for a
concrete failure or material correction. Do not expand verification on vague
suspicion or repeatedly re-prove passing behavior.

## Focused roster amendment, 2026-09-20

### Authority, baseline and boundaries

Basho requested this amendment after the code-to-vendor assessment exposed
unfinished acceptance criteria and capabilities without implementation steps.
This request authorizes planning edits only. It does not restart STS, override
a stop instruction, authorize publication, or authorize external engagement.
Execute only under applicable explicit execution authority. Keep one focused
prompt per commit in the canonical checkout; no new branch or worktree.

Baseline: `16ce9117ff0c4b866f9d72a15702a38b1776ff63` on main. VEOC-79B and
79C receipts describe real delivered increments, but do not close their full
original acceptance criteria. Restore the outstanding obligations below;
retain their commits and receipts unchanged. The authorized-guest correction
in `16ce911` is reusable VEOC-80 evidence, not a reason to implement it again.
Any existing VEOC-79D exercise work is retained as preliminary evidence.

The settled stack remains TypeScript, React, PostgreSQL/PostGIS, MapLibre,
PMTiles and the existing sync/federation services. California is the geographic
envelope; incident identity, operational area, source ownership, participation
and command authority remain distinct. No organization type is mandatory and
participation never implies unified command. Authorized viewers, including
valid mutual-aid guests, may view the incident and dashboard; write/approval
authority remains explicit. No anonymous public facet is in scope. This
supersedes the old VEOC-80 public-map row and public-projection milestone.

### Verification gates before execution

- Use focused evidence for the changed behavior and one required pre-push
  gate. Reuse current receipts when the relevant behavior has not changed.
  Repeat only after a concrete failure, correction or changed dependency.
- For incident scoping, access, ingestion, federation and persistence, use
  the real application and PostgreSQL/PostGIS path where mocks cannot prove
  the claim. One compact scenario may cover several related acceptance rows.
- For visual work, use the supplied reference screenshots in both themes and
  exercise the affected controls. Pixel similarity alone does not prove a
  working tool. Do not rerun the entire screenshot gallery for unrelated work.
- Documentation-only prompts need roster consistency and link/diff checks,
  not the application test suite. Record exact evidence and remaining limits.
- A prompt is complete only when its stated gate passes and its receipt is
  recorded. A narrowed implementation receipt cannot silently narrow its gate.
  Label partial implementation, unavailable data and missing live proof openly.
- Missing credentials, licensed source access or pilot participants remain
  explicit blockers on their affected claims. Do not synthesize live proof or
  let one unavailable source block unrelated incident activation.

### Ordered implementation roster

This is the execution order, including deliberately nonnumeric dependency
placement. Stable existing IDs are retained. Ten focused prompts are added to
the fifteen previously remaining: **25 open steps at this amendment baseline**.
The count is a planning count, not a parity percentage or a release claim.

| Order | Prompt | Focused objective | Concrete acceptance gate |
|---|---|---|---|
| 1 | VEOC-79E | Establish the source-backed capability inventory | Create `docs/VEOC-PARITY-MATRIX.md` with stable capability IDs, vendor product/module/version or documentation date, primary-source links, operator behavior, local implementation/evidence, status and owning prompt. Cover all assessed gaps and canonical F1-F20/R1-R6/AR1-AR7 obligations; distinguish WebEOC core, optional Maps/DesignStudio and separate Juvare products. Every included gap has an owner; unsupported claims remain unknown. Public access is an intentional exclusion. Correct overbroad current status claims without erasing historical receipts. |
| 2 | VEOC-79B1 | Implement incident association and server-side scope | Extend existing operational records and queries for boards, feed assignments, resources/tasks and dashboard aggregates with explicit incident scope. Distinguish reusable reference data from incident-owned records; do not assign legacy data silently to the selected incident. Real database/API evidence shows two concurrent incidents remain distinct and permitted participants contribute to the same incident without changing source ownership; outsiders and revoked grants fail. |
| 3 | VEOC-79B2 | Complete incident scope throughout the workspace | Wire B1 through COP, boards, feeds, resources, tasks, planning and dashboards, including writes, counts, URLs and active subscriptions/queues. Switching incident or losing access clears stale views and cannot submit to the old incident. A compact browser scenario reconciles displayed records and totals across two incidents and authorized partner contributions. This closes the outstanding 79B gate. |
| 4 | VEOC-79C1 | Persist normalized dataset items | Extend the existing data-pack load path with durable mapped records, source IDs, geometry, incident association and provenance. Repeated loads are idempotent; update/deletion semantics and invalid-batch behavior are explicit and attributable. Reload from the database proves persistence, duplicate prevention, isolation and honest missing/error status. |
| 5 | VEOC-79C2 | Connect onboarded datasets to operational use | Connect C1 items to COP layers, record inspection, refresh and aggregate queries. An operator registers and loads a participating organization's configured dataset without a code change, sees its real features and source/freshness, and observes an update in both records and totals. A failed refresh preserves identifiable last-good data and marks it stale/unavailable. Counts distinguish received, accepted and rejected items. This completes the ingestion obligation formerly deferred to 79D. |
| 6 | VEOC-79F | Deliver the California operational data catalog and refresh controls | Provide a configurable catalog for boundaries, roads/closures, parcels/buildings, hazards, shelters, critical facilities, population baselines and lifeline status. Each source records owner, license, actual geographic coverage, field mapping, refresh method/cadence and failure state. Reuse feed adapters and data packs for refresh/import controls. Demonstrate activation at different California locations without code edits; available sources load and uncovered areas remain explicitly unknown. No Humboldt-only source is labeled statewide; unavailable sources remain named gaps in the matrix. |
| 7 | Handoff 10 | Deliver configurable parcel overlays | Reuse the overlay pipeline and catalog; retain APN/source attribution, selectable outlines and popups. Demonstrate a configured available source and an uncovered area. Parcel coverage follows the incident area and actual source availability, not a hard-coded county claim. |
| 8 | Handoff 11 | Deliver hazard hatching and flood overlays | Render operational hazard polygons by status and available FEMA flood zones by documented category with legend, attribution and toggles. Area-based retrieval handles pagination and unknown coverage; static flood hazard and current incident status remain distinct. |
| 9 | VEOC-79G | Implement incident-area impact analysis | Use PostGIS and cataloged inputs to calculate affected structures/parcels, infrastructure/facilities, shelters/closures and population estimates for the current area revision. State spatial predicate, denominator, population estimation method, source vintage/coverage and overlap deduplication. Join incident reports to lifeline status without inferring operational failure from exposure alone. Expanding/shrinking an area produces explainable changes; totals drill to contributing records or source aggregates; absent coverage is unknown, not zero. |
| 10 | Handoff 12 | Deliver map-extent KPIs | Reuse G's query semantics and B1 scope for affected buildings, records by status and open shelters within the viewport. Clearly label incident-area versus viewport totals; map movement updates counts without changing the incident boundary. Counts reconcile to underlying records, not only rendered or capped client features. |
| 11 | Handoff 13 | Deliver facility and incident symbology | Implement the agreed NAPSG facility subset using the existing sprite pipeline with attribution and verified licenses. Symbols, legends and inspection identify actual feature type/status in both themes; undocumented pack/license assumptions stay open. |
| 12 | Handoff 14 | Enrich building subtypes | Extend the existing building pipeline with Overture where source/tool/license prerequisites are met. Preserve provenance, stable identity and operational status joins; avoid duplicate footprints and false certainty for unmapped classifications. Record coverage and any remaining external prerequisite. |
| 13 | Handoff 15 | Close the geographic reference milestone | Record delivered coverage, the reference screenshot evidence and remaining data gaps in the ledger and roadmap. This closes the geographic milestone only, not overall parity or release readiness. |
| 14 | VEOC-80 | Complete FOUO authorized-viewing behavior | Reuse the authorized-guest correction in 16ce911. Confirm members and valid mutual-aid guests can view the authorized incident/dashboard; anonymous users, unrelated incidents and expired/revoked grants are denied. Complete any remaining UI/API inconsistency; do not rebuild an anonymous projection or weaken write authority. |
| 15 | VEOC-81A | Complete no-code board authoring and views | Extend existing versioned board schemas/designer with input, list and detail layouts, conditional fields, validated calculations and incident-scoped related-record lookups. An administrator creates, publishes, reopens and revises a usable board without HTML/JS. Server validation agrees with the UI; version upgrades preserve existing records and local customizations. |
| 16 | VEOC-81B | Implement configurable board workflow routing | Extend existing position identity, resource lifecycle and notifications with declarative transitions, assignments, approval rules and escalation/due rules. Demonstrate a request routed between authorized positions with a notification and immutable history; unauthorized transitions fail and retries do not duplicate actions. Cross-organization routing uses explicit incident authority and does not invent unified command. |
| 17 | VEOC-81C | Make the operator workspace adaptable and coherent | Extend the current shell with collapsible/resizable panels, legible navigation and saved workspace preferences scoped appropriately to the user/incident. COP, boards and dashboards remain usable at wide desktop, narrow desktop/tablet and field widths. Verify keyboard focus, essential touch controls and light/dark reference fidelity; no fixed dock makes the map or primary action unusable. |
| 18 | VEOC-81 | Complete the linked operational dashboard workspace | Add operator-selectable/composable saved dashboards with category/date/operational-period filters and map/chart/list drilldowns. Use B1/G queries and handoff 12 rather than a second counting engine. Selections update related views and URL state; totals reconcile to contributing records and stale/missing inputs remain visible. Switching incident clears incompatible filters and data. |
| 19 | VEOC-82 | Complete checklist Tasks/Lists/Templates | Deliver assignment, due/status/category filters and analytics through the shared incident and workflow seams. Demonstrate template activation, assigned task completion and offline reconciliation without duplicate completion or lost attribution. |
| 20 | VEOC-83 | Complete AAR and accountable improvement plans | Deliver priority/status/capability analytics, action owners and due dates. Incident/period filters and totals reconcile to records; PDF retains operational fields and action follow-through. |
| 21 | VEOC-84 | Complete IAP navigation and filters | Deliver working/published views, organization/period/role filters and progress using the same selected incident. Demonstrate the existing five-state workflow with authorized handoffs and no mixing of concurrent incidents. |
| 22 | VEOC-84A | Complete editable ICS-204 assignments | Author and revise resources, supervisor and tactics; freeze approved revisions and export them faithfully. Prior approved revisions remain unchanged and cross-organization assignments retain named authority. |
| 23 | VEOC-85 | Complete disconnected provisioning and continuity | Prove cold setup from locally available dependencies/assets, activation and the agreed offline field/operational workflow, then reconnect with conflicts and attribution intact. Reuse the approved native/project-local runtime; Docker is not a prerequisite. Document degraded behavior and exact AR7 blockers rather than treating skipped provisioning as complete. |
| 24 | VEOC-79D | Run the integrated incident exercise after implementation | Use the application and real database to activate, expand area, onboard selected partners, load data, post field impacts, request/assign resources, reconcile COP/KPIs, publish an operational-period IAP, revoke access and close. Exercise a single-organization case and a separate concurrent incident; no tribal participation or unified command is assumed. Reconnect/federation retain attribution. Reuse focused receipts for component behavior; this exercise proves the connected workflow and does not absorb unfinished implementation. |
| 25 | VEOC-86 | Reconcile parity evidence and decide release readiness | Reconcile every included matrix row to implementation and operator evidence, with no unowned gaps or unexplained verified labels. Obtain the authorized real California pilot/evaluator AAR, independent deployment proofs and maintainers; require IPAWS credentials only for a live IPAWS claim. Present remaining blockers and an explicit release decision to Basho. Missing live evidence or an incomplete included capability prevents an absolute-parity claim. |

### Restored obligations and dependency correction

79B's shared selector is a completed increment; incident data scoping remains
open under 79B1/B2. 79C's registry/mapping contract is a completed increment;
durable ingestion and operational display remain open under 79C1/C2. Neither
history is rewritten as a failure, and neither is counted as full parity.

79D moves after 85 because its acceptance already requires connected planning,
data, analytics, offline and federation behavior. This amendment explicitly
supersedes the earlier instruction to finish 79D before handoff 10. Its existing
tests may be reused; they do not close missing dependency behavior. Focused
defects discovered there return to their owning prompt with a linked corrective
receipt, rather than silently shrinking the exercise.

79E establishes traceability for the already approved scope, not authority to
add every vendor product. Preserve the canonical broader-suite requirements;
distinguish them from Esri EMO and WebEOC core and modules. Any newly discovered
included capability without an adequate owner requires a recorded amendment,
not a hidden expansion of 79D or 86. Exclusions need scope authority, not an
executor's unilateral decision to improve a completion percentage.

### Reuse ledger

| Kind | Existing seam | Work assigned |
|---|---|---|
| Reuse | Area revisions, participation/identity, authorized guest access | 79B1/B2 and 80 preserve the working foundation |
| Extend | Boards/resources/feeds and their SQL/RLS/query paths | 79B1/B2 add explicit incident ownership and associations |
| Extend | Data-pack registry/mapping, existing feed adapters and overlay pipeline | 79C1/C2/F add persistence, delivery, refresh and coverage |
| Extract | Repeated spatial filtering and dashboard count semantics | 79G and handoff 12 expose shared queries for 81 |
| Implement at an existing seam | PostGIS, impact records and lifeline schemas | 79G adds traceable incident-area analysis |
| Extend | Versioned board designer/runtime, positions and notifications | 81A/B add authoring and routing without a second board engine |
| Extend | Console shell, dashboard widgets, IAP/AAR/checklists and offline queue | 81C/81 through 85 complete connected operator workflows |
| New bounded artifact | Source-backed capability and evidence matrix | 79E establishes the missing comparison register |

### Milestones, defaults and completion

- Incident data foundation: 79E, 79B1/B2, 79C1/C2 and 79F.
- Spatial decision support: handoff 10/11, 79G, handoff 12 through 15.
- Authorized configurable workspace: 80, 81A/B/C and 81.
- Planning and continuity: 82 through 85, including 84A.
- Connected acceptance and release disposition: 79D, then 86.

Default to existing open-source components and configured source adapters;
source selection, cadence, mappings, view layouts and explicit participant
roles are override points. An unavailable local dataset must not prevent a
jurisdiction from activating an incident. Coverage quality is independently
reported and cannot be equated with zero impact or software completeness.

External accounts, paid services, new source-license commitments, public
deployment/alerts and pilot recruitment are not authorized by this amendment.
The public-facing facet is excluded by Basho's FOUO direction. Vendor visual
references do not dictate a deployment location. No release or absolute-parity
claim follows merely from finishing numbered prompts or passing unit tests.
Completion requires the included capability matrix, operator scenarios and
release evidence to agree; remaining gaps must be explicit in the disposition.

Parallel execution note, 2026-09-21: Basho approved
`docs/MASTER-PSPR-2026-09-21.md`. For the lanes it defines, it supersedes "no
new branch or worktree". Acceptance gates and dependency order are unchanged.
