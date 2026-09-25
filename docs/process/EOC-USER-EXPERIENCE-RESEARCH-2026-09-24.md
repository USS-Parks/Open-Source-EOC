# VEOCI, WebEOC, and Esri emergency management: user friction and selective parity

Research date: September 24, 2026  
Purpose: Decide which operational capabilities Open Source EOC should match, and which interaction burdens it should avoid.  
Status: Research and design recommendations. This document does not authorize implementation, alter the approved roster, or establish that our current application passes these recommendations.

## 1. What the evidence says

The strongest opportunity is to make operational work understandable and dependable: submitting a request, finding it again, knowing who owns it, making a routine update, and handing work to the next shift. A large feature catalog does not establish that an occasional EOC operator can do those things under pressure.

The three products have different strengths and different friction patterns:

| Platform | Most useful capabilities to learn from | Friction supported by the sources | Recommended parity stance |
| --- | --- | --- | --- |
| Veoci | Configurable incident workspaces, plans, forms, partner participation, resource custody, communications | Workflow-building effort; confusing conversation organization; dated but repeated mobile complaints about navigation, interruptions, authentication, and lost work | Match adaptable operations and partner participation. Make the default workflow usable before anyone builds a custom one. |
| WebEOC | Structured resource coordination, shared operational records, incident boards, agency interoperability | Historical board fragmentation, laborious updates and shift catchup; deployment-specific request findability concerns; current exchange and identity configuration requirements | Match coordination depth. Put a coherent request lifecycle and role-based work queue in front of the board structure. |
| Esri emergency management solutions | Spatial context, lifelines, impact analysis, linked maps and dashboards, reusable GIS applications | Configuration and sharing dependencies; upgrade maintenance; migration changes in who can use a feature; some confusing incident lifecycle controls | Match the connection between place, impact, and action. Keep GIS administration out of routine operator work. |

These are qualitative findings, not a ranking of defect rates or overall product quality. Public complaints do not establish how frequently a problem occurs.

### Research boundaries

The evidence includes an official disaster after-action report, an academic exercise study, named customer reviews, mobile app reviews, user support threads, and current vendor documentation. The source register below identifies their different evidentiary roles.

No authenticated hands-on evaluation of current Veoci, WebEOC Nexus, or an agency's Esri deployment was performed. There are no independently measured click counts, response-time comparisons, accessibility scores, or success rates in this report. Configuration, local policy, training, licensing, connectivity, and software behavior can each produce a bad experience; the sources do not always isolate the cause.

Esri is evaluated as a collection of applications and services, especially Emergency Management Operations, Emergency Information Manager, dashboards, and related field/analysis tools. An ArcGIS Online restriction must not be generalized to every ArcGIS Enterprise deployment. Likewise, a 2016 WebEOC exercise is not a test of today's Nexus, and an old mobile review is not proof of a defect in the current build.

## 2. Veoci: flexibility is useful, but users should not have to assemble usability

### V1. Configurable does not always mean easy to configure

Capterra's ten-review sample is broadly positive: 4.6 overall and 4.4 for ease of use at retrieval. In March 2019, Jennifer N. described workflow development as sufficiently difficult and time-consuming that she avoided it; Kelly B. linked value to customization effort and available support hours; Brian H. found the conversation cockpit difficult to explain during training. The same sample praises support, adaptable workflows, guest participation, and end-user simplicity. Several reviews disclose vendor referral or incentives. [V01]

**Interpretation:** distinguish the administrator who builds the experience from the responder who consumes it. Positive end-user usability and difficult workflow construction can both be true.

**Avoid:** a blank workflow canvas as the first meaningful product experience; different names and layouts for the same common task in every department; dependence on one staff member who understands the configuration.

**Prefer:** a complete default request, assignment, update, escalation, and closure process. Allow administrators to change local fields and routing while preserving recognizable status meanings. Explain workflow changes in operational language and let administrators preview the resulting operator experience.

### V2. Mobile interruptions can undermine confidence in the entire workflow

The US iOS listing showed 2.6/5 from 30 ratings. Reviews from 2019 through 2025 describe interrupted checklist work, slow navigation, repeated login, app/browser handoffs, and difficulty finding expected editing functions. A 2025 reviewer explicitly preferred the website to the app. Positive reviews also report improvements. These are version- and device-dependent anecdotes, not current-build reproductions. [V02]

On Google Play, a January 2024 reviewer reported crashes when changing tabs and reauthentication after switching away. Older reviewers describe similar interruption problems. The listing was updated September 2, 2026, so those accounts cannot establish whether that release retains the problems. [V03]

**Operational consequence, inferred:** a responder starts treating navigation, answering a call, or switching to a camera as a risk to unfinished work.

**Avoid:** making the operator infer whether work survived from whether a spinner disappeared.

**Prefer:** explicit local-draft and server-saved states; restoration after an interruption; preserved attachments; clear recovery after session expiry. Authentication must remain secure, with unfinished work protected rather than silently discarded.

### V3. A link is not useful if its recipient cannot reach the intended task

An iOS review from July 2025 describes an evacuation-map link ending at a login screen without an apparent registration path. The review does not establish whether Veoci, the publishing agency, or link configuration caused the problem. [V02]

**Avoid:** generic access-denied pages with no explanation of the intended audience or next step.

**Prefer:** invitations that identify the organization, incident, and access required; a direct route back to the intended item after authentication; an administrator preview of what the recipient can access.

For our application this translates to authorized members and mutual-aid guests. It does not authorize anonymous access or a public warning portal.

### V4. What is worth matching

Veoci's documented room model includes role-based participants and guests, forms, tasks, processes, maps, saved views, and plan-template activation. Its resource-management offering describes barcode checkout, custody tracking, and offline logging for later upload. These establish capability claims, not independently tested usability. [V04] [V05]

**Keep the operational ideas:** repeatable activation, a shared incident context, field-to-EOC information flow, controlled partner access, and accountable resource custody.

**Improve the product contract:** joining a room should immediately make the operator's assignment, current incident, and next action clear. A flexible container should not become another place to search.

## 3. WebEOC: preserve coordination depth while reducing board and process fragmentation

### W1. An activity stream is not a shift briefing

The University of Washington's 2018 research on the 2016 Cascadia Rising exercise describes WebEOC navigation, retraining, information-finding, manual consolidation, and cross-board coordination difficulties. Deployments included versions 7.3, 7.6, and 8.1. Participants struggled to turn chronological activity into a current operational picture. This is strong historical workflow evidence, not a current Nexus evaluation. [W01]

**Avoid:** treating a long log as sufficient situational awareness.

**Prefer:** a shift view containing current conditions, material changes since the last briefing, unresolved requests, overdue work, current owners, and decisions awaiting action. Preserve the detailed log behind each item. A summary must link to its source and indicate its reporting period.

Do not force users to choose between losing detail and reading every historical entry.

### W2. Requests that are hard to find can feel indistinguishable from requests that were lost

Buncombe County's Tropical Storm Helene after-action report records difficulty searching entered WebEOC requests and participant accounts of requests disappearing, alongside changing logistics processes and initially missing mission numbers. Crucially, Appendix C-3, printed pages 57-58, says these are interview participants' perceptions and experiences, not verified facts. The report also records the eventual local WebEOC rollout as a success. It does not establish a software data-loss defect or assign the disaster's logistics problems to WebEOC. [W02]

**Avoid:** submission with no durable receipt; filters that silently hide newly submitted work; status changes that remove an item from the submitter's view without explanation.

**Prefer:** a stable request number, time of receipt, current owner, explicit stage, and readable history. Search should find authorized records across open and closed states, with filters visibly explained. If a request moved to another organization, show where it went and whether anyone accepted responsibility.

This is a higher-value objective than visual resemblance to a request board.

### W3. Routine updates should not feel like data entry projects

The single G2 WebEOC review found, dated April 2019, praises consolidated multi-agency information and detachable windows but reports lag and excessive typing, asking for easier selection-based updates. One review is not representative. [W03]

A September 2023 emergency-management Reddit discussion similarly describes cumbersome editing and locally customized boards. Versions are unclear, and vendor-affiliated contributors participate in the thread; their promotional comparisons are not independent evidence. [W04]

**Avoid:** opening a large edit form to acknowledge an assignment or update a simple status.

**Prefer:** concise, contextual actions for routine transitions. Request a reason or confirmation when a transition has material consequences. Preserve timestamps and attribution without requiring users to retype information the system already knows.

Keep detachable views and dense tables available for experienced EOC staff. Simplification should not eliminate efficient multi-monitor work.

### W4. Local customization can create regional coordination work

A 2018 Bay Area UASI memorandum describes a regional WebEOC standardization effort around shared resource, situation, and shelter boards. It demonstrates that common software alone does not guarantee common operational records. [W05]

Current Juvare Exchange documentation requires administrative setup, eligible versions and agreements, incident/board mapping, and compatible hosting regions or enclaves. It also describes limits on incident sharing and warns that shared data cannot be retracted. Those are actual configuration and information-sharing constraints, not proof that interoperability is absent. [W06]

**Avoid:** assuming a record is shared because it appears in a local board; inconsistent definitions of requested, accepted, assigned, and fulfilled; implying that revoking access erases copies already delivered.

**Prefer:** a small common operational record with optional local extensions. Show destination, sharing scope, delivery state, and responsibility separately. Preserve origin identifiers so local and partner records can be reconciled.

### W5. Access and service dependencies must be legible

Current Juvare troubleshooting documentation identifies connectivity, instance URLs, HTTPS certificates, and URL suffixes as possible mobile sign-in issues. Its login-services guidance covers differing identity configurations and an on-premises limitation. Its communications documentation explains that blocked cloud-service connections can affect notifications and the freshness or availability of connected features. [W07] [W08] [W09]

**Avoid:** a generic login failure, an apparently healthy empty inbox, or stale information displayed as current.

**Prefer:** actionable diagnostics: wrong organization, expired session, unreachable service, insufficient permission, or unavailable integration. Show when information last arrived. Do not turn an authentication error into a misleading claim that there are no requests.

### W6. What is worth matching

Today's Nexus offering advertises role-based dashboards, low-code configuration, incident planning and reporting, GIS integrations, mobile/offline forms, notifications, and agency exchange. The board catalog distinguishes included, premium, separately licensed, and industry-specific capabilities. Old complaints do not establish that these current capabilities are missing or unusable. [W10] [W11]

**Keep the operational ideas:** structured coordination, resource request lifecycle, repeatable incident records, role views, agency exchange, and traceable reporting.

**Improve the experience:** one understandable operational model across those capabilities. Do not require users to learn the product's module boundaries to complete a single request.

## 4. Esri: preserve the spatial intelligence while reducing configuration and access surprises

### E1. A collection of useful applications can still feel like several systems

Esri's November 2023 redesign announcement explicitly says customers wanted a more mobile-friendly experience, easier startup, less map/app redundancy, and easier public information delivery. It describes work intended to address those requests. This is vendor-reported feedback and a historical mitigation, not independent proof that every deployment still has those problems. [E01]

The Emergency Management Operations documentation describes linked applications and dashboards, user-type requirements, and release-specific changes to incident filtering, timestamps, and refresh behavior. [E02]

**Avoid:** forcing an operator to know which map, survey, dashboard, application, or layer owns an action.

**Prefer:** task language such as report damage, update shelter status, inspect affected facilities, and assign follow-up. Maintain incident, geographic selection, and relevant filters across the task. Keep the map and table as coordinated views of the same authorized records.

### E2. Existing lifecycle controls can be too hard to discover

A user asked how to reset Emergency Management Operations for another incident without losing previous data. Esri's accepted answer explains that multiple incidents are supported and that Active Incident and other status fields control what appears; a new deployment for each event is unnecessary. The migrated page did not expose a dependable posting date during retrieval. This is evidence of discoverability friction, not a missing archive capability. [E03]

**Avoid:** making incident closure feel like deleting data or rebuilding an application.

**Prefer:** an explicit end-of-incident workflow explaining which items remain active, what becomes historical, and how to reopen or find prior records. Show the active incident prominently and make cross-incident searches deliberate.

### E3. Sharing the application does not necessarily share its dependencies

In an emergency-management Notices and Evacuations support thread, the author believed everything was public but could not view the map while signed out. Their resolution involved checking individual items' sharing and using a private browser or clearing cached state to confirm visibility. The retrieved migrated page did not expose a reliable posting date. This is a resolved configuration experience, not a demonstrated platform outage. [E04]

**Avoid:** letting a publisher see a working map that the intended recipient cannot use, with no explanation of the difference.

**Prefer:** a recipient-view preview and a dependency check that identifies the particular restricted dataset or attachment. For Open Source EOC, apply this to approved roles and guests; public publishing remains separate scope.

### E4. Upgrade maintenance is part of usability

Official ArcGIS Solutions upgrade guidance describes deploying updated items alongside existing ones, reapplying configurations, and, where needed, migrating data and updating dependencies. It does not say existing customizations are automatically destroyed. [E05]

A concrete June 2026 example is Esri's Emergency Management Operations infographic guidance: a changed data source can trigger a deprecation message and requires reconfiguration of the relevant application/widget. This concerns a particular infographic dependency, not the failure of the entire solution. [E06]

**Avoid:** a product where every upgrade turns the local administrator into a migration project manager.

**Prefer:** configuration that survives supported upgrades, explicit compatibility boundaries, and a reviewable migration path when preservation is impossible. Provide a usable default so organizations are not forced into extensive customization merely to operate.

### E5. Replacement functionality does not guarantee equivalent operator access

A long-running Esri Community discussion documents missing Emergency Response Guide and Threat Analysis functionality during the move from Web AppBuilder to Experience Builder, followed by replacement-tool announcements. Users then discuss permission difficulties and access implications for former Viewer users. The old missing-widget complaint must be interpreted against subsequent releases. [E07]

The ERG web tool was announced June 4, 2025 for ArcGIS Online and Enterprise. Threat Analysis was announced June 5, 2026, initially for ArcGIS Online, with Enterprise support described as forthcoming in that announcement. Therefore, neither should be described simply as an absent current capability. [E08] [E09]

Current ArcGIS Online custom-web-tool documentation requires a qualifying user type, role, and Run web tools privilege; notebook-based tools consume credits. These are specific Online requirements, not universal claims about every Esri analysis workflow. [E10]

**Avoid:** claiming parity because the administrator can run a replacement tool.

**Prefer:** define parity for a named operational role. Can the intended responder reach the function, supply understandable inputs, obtain the result, and preserve or share it within their authorized role? Separate viewing results from running analyses and administering them.

Specialist hazard analysis is conditional scope for our product. It needs authoritative methods and qualified operational ownership; this research does not authorize recreating safety-critical calculations.

### E6. Completed analysis and visible, durable results are different states

The current Threat Analysis setup guidance describes delayed appearance until a layer refresh, differences between temporary and appended outputs, and a known issue with limiting inputs to map selections. These are documented constraints of this particular tool, not general defects across Esri maps. [E11]

**Avoid:** a completed action with no obvious result, causing a user to run it again or assume the wrong features were processed.

**Prefer:** make inputs reviewable, show progress, identify exactly what was created, and distinguish temporary results from saved operational records. A result should explain where it can be found even if the map has not yet refreshed.

### E7. What is worth matching

Esri's emergency-information tutorial demonstrates connecting an impact area to population and infrastructure information. Its value is the operational question answered, not merely displaying many layers. [E12]

**Keep the operational ideas:** geographic context, linked lifeline status, affected-facility inspection, field observations, meaningful layer legends, and map/list/dashboard coordination.

**Improve the experience:** show provenance, observation time, coverage limitations, and the next operational action. Unknown coverage must not look like zero impact. A selected facility should lead to its current status and responsible person without losing the geographic context.

## 5. What feels unnerving, translated into design requirements

The following questions are our synthesis, not quotations or a psychological study of users.

| Operator's uncertainty | Harmful pattern to avoid | Desired behavior |
| --- | --- | --- |
| Did my work actually save? | A spinner or disappearing form is the only feedback | Distinguish draft, saved locally, received by server, and failed; preserve the record through interruptions |
| Did anyone receive my request? | Submission looks like acceptance | Separate receipt, routing, acknowledgment, and ownership |
| Where did it go? | Hidden filters, silent archiving, incident-context changes | Stable identifiers, visible filters, history, and explainable state changes |
| Is this information current? | Old data retains a healthy-looking color | Observation time, last received time, stale/unknown states, source attribution |
| Am I updating the right incident? | Context buried in navigation | Persistent incident, operational period, and role context |
| Will this partner see what I see? | Parent item shared, dependent items restricted | Recipient preview, explicit scope, access diagnostics |
| Can I safely answer this phone call? | Switching away risks losing a form | Recoverable drafts and resumable tasks |
| What changed while I was off shift? | A long activity stream substitutes for a briefing | Material changes, unresolved actions, current owners, links to detailed evidence |
| Am I allowed to use this function? | A feature appears but fails only after inputs are entered | Clear role availability and prerequisites before work begins |

Color, spacing, and attractive cards matter, but they cannot compensate for unclear state or missing operational accountability.

## 6. Recommended capability priorities

These priorities are research recommendations for a future scope decision, not a new execution roster or a claim about gaps in our implementation.

| Priority | Capability worth matching | Interaction requirements to preserve |
| --- | --- | --- |
| Essential | Request and mission lifecycle | Durable receipt, stable ID, owner, priority, stage, reason for delay, history, clear handoff |
| Essential | Role-based work queue | My assignments, unowned work, overdue work, quick routine updates, useful team view |
| Essential | Current operational picture | Linked map/list/lifelines, freshness and coverage, clear incident context |
| Essential | Shift handoff | What changed, unresolved work, decisions needed, source-linked detail |
| Essential | Field reporting | Recoverable drafts, explicit connectivity and delivery state, usable attachments and location correction |
| Essential | Controlled partner participation | Individual accountability, scoped access, understandable invitations, recipient preview |
| Valuable | Repeatable activation and templates | Useful defaults, previews, versioned changes, preserve local configuration where supported |
| Valuable | Resource inventory and custody | Availability, assignment, checkout/return, location, condition, accountable updates |
| Valuable | Forms, situation reports, incident planning | Reuse existing facts, preserve structured data, review before publication, traceable exports |
| Valuable | Interagency exchange | Common status meanings, provenance, destination and delivery visibility, reconcile partner identifiers |
| Valuable | Configurable local fields and views | Extend the common model without fragmenting basic task semantics |
| Conditional | Advanced spatial/hazard analysis | Named users, authoritative methods, understandable prerequisites, reviewable and durable outputs |
| Conditional | Public information publishing | Separate audience and approval design; not authorized by this research |
| Conditional | AI summaries and assistance | Source-linked drafts and human review; do not make basic navigation depend on AI |

Daily preparedness, exercises, and routine resource work should use the same core interactions as activations where appropriate. That is a design recommendation to reduce relearning, not proof that every department needs every feature.

### Patterns we should explicitly decline to imitate

- A large board or application catalog as the default homepage for every role.
- A separate navigation journey and vocabulary for each form, map, chat, and task.
- Extensive local customization as a prerequisite for a coherent basic workflow.
- Whole-record forms for simple acknowledgments and status updates.
- Successful submission that says nothing about delivery or responsibility.
- Empty maps or tables that conceal permission errors, stale feeds, or active filters.
- Chronological logs presented as sufficient shift handoff.
- Mobile experiences that require users to protect drafts by avoiding normal phone behavior.
- Feature migrations that quietly change which operational roles can use the function.
- Sharing interfaces that imply stronger withdrawal or confidentiality guarantees than delivery permits.

These are anti-patterns inferred from the evidence. This list does not assert that each product exhibits every pattern.

## 7. Finite future acceptance scenarios

If these recommendations are approved for implementation, agree on the intended role and workflow first, then use the relevant scenario as a bounded acceptance gate. No scenarios were executed during this research. Once the agreed gate passes, do not add reassurance testing without a material change or observed problem.

1. **Occasional operator returns:** Given a provisioned role and an active incident, the operator finds their assigned work, recognizes the incident, and performs a routine update without an administrator explaining product-specific navigation.
2. **Request survives interruption:** A partially completed request survives an ordinary phone interruption or session expiry. On reconnection, the system distinguishes local draft from received request and exposes any unresolved conflict.
3. **Request crosses a handoff:** The originator can find the same request after routing or reassignment and identify who owns the next action. Receipt and acceptance remain distinguishable.
4. **Shift change:** An incoming operator can identify unresolved priorities and material changes, then open the underlying records. Historical detail remains available without being the only briefing.
5. **Partner follows a link:** A correctly invited guest reaches the intended authorized record after login. Missing access identifies a remediable cause without exposing restricted information.
6. **Map and records agree:** Selecting an authorized item connects its map, list, and detail views. Missing coverage, stale input, no matching records, and access failure have distinct explanations.
7. **Incident closes:** Closing an incident preserves retrievable records and leaves the next incident's context unambiguous. Reopening or correcting historical information follows the agreed rules.
8. **Configuration moves forward:** A supported update preserves the agreed local configuration and records, or provides an explicit migration with a recovery path. The required operational roles retain the intended capabilities.

Set any time, click-count, or completion-rate targets with representative users. The sources here do not establish universal numerical benchmarks.

## 8. Corrections to carry into future parity decisions

The September 17 platform research remains a historical research artifact. This report does not silently rewrite it. The following claims should be qualified before being reused:

- **Esri upgrades:** parallel deployment and manual migration are documented. Automatic destruction or orphaning of every customization is not the correct general description. [E05]
- **Esri missing widgets:** ERG and Threat Analysis now have web-tool replacements. Assess their access and deployment requirements instead of repeating the original missing-feature claim. [E08] [E09] [E10]
- **WebEOC hosting:** current family documentation discusses both client-installed and Juvare-hosted instances. A blanket SaaS-only characterization is unsafe; verify the particular edition and contract. [W09]
- **Unverified performance ratios and framework dates:** this research did not substantiate the previous report's 25-50x comparison or its specific future framework-change assertions. Do not use them as established design evidence.
- **Standards absence:** absence from a documentation search cannot confirm that a product lacks CAP, EDXL, NIEM, or another integration. Mark support unverified unless a current authoritative capability statement or scoped evaluation establishes it.

Our canonical navy/teal, map-led visual references remain the design authority. Competitor friction informs behavior and priorities; it does not authorize a new visual direction. The approved Finish PSPR remains the execution authority.

## 9. Evidence register

All links were consulted during this research on September 24, 2026 local time. Dates below describe the cited material when available, not search-engine crawl dates. Review samples are small and self-selected. Treat multiple comments within one page as one source collection, not independent surveys.

### Veoci sources

- **[V01] [Capterra Veoci reviews](https://www.capterra.com/p/150183/Veoci/reviews/).** Named customer reviews, primarily 2019; ten-review snapshot. Both positive and negative experiences, with incentive disclosures. Historical qualitative evidence.
- **[V02] [Veoci US iOS reviews](https://apps.apple.com/us/app/veoci/id594925365?platform=ipad&see-all=reviews).** Mobile users; cited complaints span 2019-2025. Device, deployment, and app version not consistently identifiable. Rating is a retrieval snapshot, not a measure of enterprise-wide satisfaction.
- **[V03] [Veoci Google Play listing and reviews](https://play.google.com/store/apps/details?hl=en&id=com.greywallsoftware.veoci).** Android user accounts plus vendor listing/release metadata. Cited interruption account January 11, 2024; listed update September 2, 2026.
- **[V04] [Veoci rooms API documentation](https://veoci.com/api/docs/v1/rooms/index.html).** Official capability documentation for rooms, participants, saved views, and plan activation. No usability validation.
- **[V05] [Veoci resource and asset management](https://veoci.com/emergency-management/resource-asset-management).** Vendor capability description. Offline and custody claims require scenario-specific validation before procurement or implementation parity claims.

### WebEOC sources

- **[W01] [Scholl and colleagues, Cascadia Rising research, ISCRAM Asia Pacific 2018](https://faculty.washington.edu/jscholl/cr16/Scholl_et_al_2018b.pdf).** Academic analysis of the 2016 exercise; WebEOC discussion around PDF page 10. Historical deployed-version evidence, not a Nexus test.
- **[W02] [Buncombe County, Tropical Storm Helene after-action report](https://www.buncombenc.gov/DocumentCenter/View/4231/After-Action-Report---Tropical-Storm-Helene-2024).** Official report concerning the 2024 disaster with 2025 debriefing input. Appendix C-3, printed pages 57-58 and 60. Participant perceptions explicitly distinguished from verified facts.
- **[W03] [G2 WebEOC reviews](https://www.g2.com/products/webeoc/reviews).** One accessible named review, April 11, 2019. Insufficient sample for representative product scoring.
- **[W04] [Emergency-management practitioner discussion of WebEOC](https://www.reddit.com/r/EmergencyManagement/comments/16uixa4/im_a_tech_guy_seeing_webeoc_for_the_first_time/).** September 2023 discussion. Anonymous experiences and vendor participation; deployment versions unknown.
- **[W05] [Bay Area UASI WebEOC standardization update](https://www.bauasi.org/sites/default/files/resources/110818%20Approval%20Authority%20November%20Agenda%20Item%2010%20WebEOC%20Standardization%20Project%20Update.pdf).** Official regional program memorandum, November 8, 2018. Evidence of coordination work, not a present-day product defect.
- **[W06] [Getting started with Juvare Exchange](https://docs.juvare.com/webeoc-onnexa/help/juvare-exchange/get-started-with-jx.htm).** Official setup and sharing constraints. Scope depends on supported version, hosting environment, and agreement.
- **[W07] [Juvare mobile troubleshooting](https://docs.juvare.com/webeoc-onnexu/troubleshoot.htm).** Official troubleshooting, updated February 27, 2026. Documents possible causes, not incidence rates.
- **[W08] [Juvare Login Services account activation and login](https://docs.juvare.com/webeoc-onnexa/common/juvare-login-services/account-activation-login.htm).** Official guidance, updated March 9, 2026. Deployment-specific identity behavior.
- **[W09] [WebEOC and Juvare SaaS communication overview](https://docs.juvare.com/webeoc-onnexa/help/server-configuration/webeoc-and-juvare-saas-communication-overview.htm).** Official instance/service dependencies. Useful for understanding degraded operation and avoiding blanket hosting assumptions.
- **[W10] [WebEOC Nexus](https://www.juvare.com/products/webeoc-nexus/).** Current vendor offering. Feature claims are not proof of operational ease or inclusion in a particular subscription.
- **[W11] [WebEOC board catalog](https://docs.juvare.com/webeoc-onnexu/board-list/board-list.htm).** Official categories for included, premium, additional, and industry boards. Check entitlement for any specific deployment.

### Esri sources

- **[E01] [A reimagined Emergency Management Operations solution](https://www.esri.com/en-us/industries/blog/articles/new-emergency-management-operations-solution).** Vendor account of customer feedback and redesign, November 9, 2023.
- **[E02] [Introduction to Emergency Management Operations](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-management-operations.htm).** Official composition, requirements, and release notes. A latest-path URL is not itself proof of the newest available release.
- **[E03] [Reset Emergency Management Operations while retaining data](https://community.esri.com/en/discussion/1667724/best-practice-to-reset-emergency-management-operations-solution-but-retain-data).** User question and accepted staff answer. Posting date not reliably exposed in the retrieved migrated page.
- **[E04] [Notices and Evacuations map visibility](https://community.esri.com/en/discussion/1721035/why-cant-i-see-my-notices-and-evacuations-map-in-esri-site-information-for-emergency-management).** User question and self-reported resolution. Posting date not reliably exposed in the retrieved page.
- **[E05] [Upgrading an ArcGIS Solution](https://doc.arcgis.com/en/arcgis-solutions/latest/get-started/upgrading-an-arcgis-solution.htm).** Official lifecycle guidance. Supports maintenance-burden findings without implying automatic destruction.
- **[E06] [Emergency Management Operations 2026 infographic variables](https://community.esri.com/t5/arcgis-solutions-documents/emergency-management-operations-solutions-2026/ta-p/1712162).** Esri technical guidance for the June 2026 data-source change. One specific dependency.
- **[E07] [ERG and Threat Analysis migration discussion](https://community.esri.com/en/discussion/1342858/emergency-response-guide-and-threat-analysis-widget-for-experience-builder).** Multi-year user/staff thread with historical gaps and later replacement announcements. Read later replies before repeating early complaints.
- **[E08] [Introducing the Emergency Response Guide web tool](https://www.esri.com/arcgis-blog/products/arcgis-solutions/announcements/emergency-response-guide-web-tool-blog).** Official announcement, June 4, 2025.
- **[E09] [Add Threat Analysis to maps and apps](https://www.esri.com/arcgis-blog/products/arcgis-solutions/announcements/add-threat-analysis-to-your-maps-and-apps).** Official announcement, June 5, 2026. Initial Online scope; Enterprise work described as forthcoming at publication.
- **[E10] [Use custom web tools in ArcGIS Online](https://doc.arcgis.com/en/arcgis-online/analyze/custom-web-tools-mv.htm).** Current official user-type, role, privilege, credit, and result-persistence guidance. Do not generalize to every Enterprise workflow.
- **[E11] [Threat Analysis web tool configuration](https://community.esri.com/en/discussion/1706503/threat-analysis-web-tool).** Esri product-engineering guidance, including result-refresh and selection limitations. Current retrieved documentation, not observed failures in our application.
- **[E12] [Manage and communicate emergency information](https://learn.arcgis.com/en/projects/manage-and-communicate-emergency-information/).** Official guided workflow for spatial impact information. Demonstrates intended capability rather than independent usability.

## 10. What remains unknown

Public sources do not establish present-day comparative performance, accessibility, training time, mobile reliability rates, or total administrative effort under equivalent conditions. They also cannot identify which complaints would disappear with better agency configuration. Those are bounded questions for a future authorized evaluation, not reasons to expand this research indefinitely.

The actionable conclusion is to prioritize coherent operational tasks, durable work, visible responsibility, and explainable information state. Preserve the competitors' coordination and spatial capabilities while making those tasks understandable to the people who must perform them.
