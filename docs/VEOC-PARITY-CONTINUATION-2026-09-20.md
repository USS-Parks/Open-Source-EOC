# California hybrid parity continuation

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
