# Operator Quickstart

This path is for an authorized operator beginning or joining an incident shift.
It focuses on the selected incident and uses existing workflows for updates,
briefings, plans, resources, and continuity.

## 1. Confirm context

1. Sign in with your own account.
2. Select the assigned organization and incident in the command bar.
3. Select the operational period used by your section.
4. Confirm your current position or named incident participation.
5. Check connection and synchronization status before entering work.

If an expected incident or action is absent, stop and ask an administrator to
verify current authority. Do not work in a similarly named incident.

Your own settings are in the account menu at the right of the command bar:
the light or dark theme and **Sign out**. The command bar, or the context
drawer on a narrow screen, holds the operational period and acting position.
The navigation shows only the sections your account can use: Administration
and Federation appear for administrators, and Templates for an instance
administrator who also administers the selected organization.

## 2. Read before writing

Open **Situation / Overview**, **Map**, and **ESFs & Lifelines** as the
assignment requires. Use the Lifelines and ESFs tabs for their distinct facts.
Check:

- source, freshness, coverage, and last-good labels
- incident area and operational-period provenance
- unknown, missing, stale, partial, and conflicting states
- whether a displayed briefing is a current composition or a frozen snapshot

Lifeline condition is an attributed assessment. It does not derive from an
impact count or from ESF activation. Unknown or missing never means stable.

## 3. Work the incident

- Use **Boards** for structured incident records and the Activity Log for
  attributed chronology.
- Use **Tasks** for My Tasks or authorized Team Tasks. Start and complete only
  work permitted by your current assignment; dependencies can block completion.
- Use **Resources** for the 213RR lifecycle. Submitted, triaged, assigned, and
  fulfilled are distinct states. Do not infer delivery from submission. Costs
  and escalation are described under
  [Record costs and escalate a request](#record-costs-and-escalate-a-request).
- Use **Smart Forms** for supported field reports. Select the attached incident
  board and read the queue receipt after submission.
- Use **Operations / Field Reports** to read the reports as they arrive. It
  shows the Field Reports board attached to the selected incident, or, when
  the incident has none or no incident is selected, the organization's Field
  Reports boards, with a **Field Reports board** selector when there is more
  than one. Reports from Smart
  Forms, field capture and offline sync all land there. Select a report to
  open its record under **Boards**; **Capture a field report** opens Smart
  Forms. When no board made from the Field Reports template exists, the screen
  says so; ask an administrator to create one.
- Use the **Lifelines** and **ESFs** tabs in **ESFs & Lifelines** to record
  attributable assessments, evidence, actions, organizations, and history.
  Resolve conflicting current reports only through the attributed decision
  workflow.

### Read and correct the chronology

**Situation / Chronology** lists the attributed, append-only record of actions
for the selected incident, or for the whole organization when no incident is
selected. Each entry shows its time, a plain event name, who recorded it and
under which position, a short detail and its event number. The oldest entries
come first; **Load more records** reads the next page.

- **Significant events**, the default view, keeps operational milestones:
  incident activation and closure, incident area and period revisions,
  resource request submission, status changes and escalations, IPAWS alert
  sends, IAP submission, approval and completion, published JIC releases,
  composed SITREPs, facility status reports, and corrections. **All events**
  shows every entry the server lets you read, including routine board and form
  activity. Entries on the Significant Events board are board records; read
  them in **Boards** or under **All events**.
- **Event type**, **From** and **To** narrow either view on the server.
- To correct an entry, choose **Add correction**, state what was wrong and
  what is right, and choose **Record correction**. The original entry does not
  change. The correction is a new entry, attributed to you and your acting
  position, that names the event it corrects.
- A jurisdiction admin also sees **Export CSV** and **Export signed JSON**.
  Both export the organization's whole audit trail, not the filtered view. The
  signed file is a JSON array of signed pages in order; verify each page as
  described in [Export the audit trail](ADMIN.md#export-the-audit-trail).

### Record costs and escalate a request

Select **History** on a request in **Resources**. The costs and mutual aid
panel sits below the request history.

- **Reimbursement costs**: enter the category, the amount in dollars, a
  description and the date the cost was incurred, then choose **Record cost**.
  **Export costs (CSV)** downloads every cost recorded on the request with a
  total row, for reimbursement documentation. Read-only access can export but
  not record.
- **Escalate to another tier**: when the request cannot be filled locally,
  enter the higher tier's peer name, its address and the peer token that tier
  issued when it registered your organization, then choose
  **Escalate request**. The server delivers the request at once. When the tier
  cannot be reached or refuses the token, the panel shows
  "escalation delivery failed" and nothing is recorded. The token is sent once
  and not stored. The panel does not offer escalation for a closed or
  cancelled request.
- The receiving tier works the escalated request as its own. Its status
  reports arrive over the token your organization issued it and appear in the
  request history as "*peer* reported *state*". A reported state that the
  lifecycle allows also moves the request. The receive and report exchanges
  run between the two servers and have no screen. See
  [Resource escalation across tiers](FEDERATION-SETUP.md#resource-escalation-across-tiers).

### Move a board record through its workflow

A board designer can give a board a workflow: named states, the transitions
between them, approval rules, due rules and escalations. Select a record and
read the **Workflow** section of the record context.

- **State** is the record's current workflow state. A final state has no
  further transitions.
- The transition buttons are the transitions that leave the current state.
  When a transition assigns work, choose the position or incident participant
  first. The server decides whether you may run it and shows its reason when
  it refuses.
- A transition with approval rules does not move the record at once. The
  section shows it as awaiting approval, with each rule, its approver and the
  approvals counted so far. An approver selects **Approve** for the rule. The
  person who requested a transition cannot approve it unless the rule allows
  it. The record moves when every rule has its count.
- **Due** shows the time set by the transition's due rule. **Overdue** means
  that time has passed. **Due time missing** means the rule reads a record
  field that is empty.
- **Escalations** lists each escalation of the transition that produced the
  current state, with its schedule. An organization administrator or incident
  coordinator selects **Escalate** once an occurrence is due. Each occurrence
  is recorded once.
- **Workflow history** lists every request, approval, completed transition and
  escalation with the time, the person, their position, the states and the
  recorded assignment, due time or schedule. History is append-only and has no
  edit controls.

## 4. Plan and brief

- Prepare IAP content against the selected incident and a real incident-area
  operational period. Working, in approval, approved, and complete are distinct
  states; export the selected immutable revision.
- Use **Situation / SITREP** to compose from the selected incident. Review source warnings and
  period provenance before treating it as a shift briefing.
- Prepare JIC language as a draft, then save and submit the exact saved content.
  Approval and publication are separate server actions, described under
  [Review, publish and answer from the JIC panel](#review-publish-and-answer-from-the-jic-panel).
- A local CAP exercise record or alert draft is not evidence of IPAWS delivery.
  Check the dedicated submission status and external acknowledgement only when
  that integration is configured.

### Review, publish and answer from the JIC panel

Open **JIC** under Coordination, then a frozen SITREP. The JIC draft panel
beside the briefing carries one release through review and publication.

1. Name the reviewing agencies, save the draft, and submit the saved content.
   A release that names no reviewing agency cannot be approved.
2. Under **Review and publication**, record your own agency's decision with
   **Approve for** or **Reject for** that agency, with an optional note. Each
   person records one decision per release. An agency registered as a
   federation peer decides from its own instance over its peer token, and the
   panel refuses it here. The release is approved when every named agency
   approves and rejected when any agency rejects.
3. An approved release shows **Publish release**. Choose the public
   information feed, the incident collaboration channels, or both. The status
   line names the outlets that accepted it. The panel does not send CAP alerts.
4. **Waiting for review** lists the incident's submitted releases that still
   wait on a decision you can record, whoever drafted them and wherever, with
   the agencies still awaited. Select **Review** to open one: agencies already
   decided show as already approved or rejected, and you decide for the
   others as in step 2. An approved release can then be published from there
   as in step 3. Select **Refresh list** to read the queue again.
5. **Public information feed** lists the ten most recent releases the
   organization has published.
6. Under **Media inquiries**, log the outlet, subject and question, assign the
   inquiry to a position, and answer it with the release reviewed in the panel
   once that release is approved or published. The list also shows the
   incident's unanswered inquiries logged in other sessions. An answer always
   cites approved language. Answering closes the inquiry; there is no separate
   close step.

Leaving the SITREP clears the panel. The server keeps every release, decision
and inquiry, and **Chronology** under **All events** records them.

## 5. Work through a connection loss

The current disconnected presentation supports two bounded operational paths:

1. A loaded Smart Form can queue report fields in a person-, incident-, and
   board-scoped durable queue. Attachments and map capture require a connection.
2. An assigned task completion can queue locally. Task creation, assignment,
   metadata edits, and team-task administration require the server.

Read the displayed phase. Queued means local. Synced means the server returned
an exact receipt. Failed means the client lacks verified acceptance; rejection
and a lost response are both possible. Failed, conflict, or authentication-
required states retain the supported queue for recovery. Reconnect and
reconcile before reporting the work as received or complete.

## 6. Hand off the shift

1. Reconcile supported queues and identify anything still pending.
2. Review resource, task, assessment, IAP, SITREP, and JIC state with the
   incoming operator.
3. Name every unknown, stale, conflict, and external dependency.
4. End your position session. The incoming operator signs in under their own
   identity and position.

### Staffing: check in, badges and shifts

**Operations / Staffing** shows who is checked in to which position across the
organization. Times are local, 24-hour.

- **Check-in and on duty.** Choose the **Position** and choose **Check in**.
  Without a badge code you check yourself in; a jurisdiction admin can choose
  another **Person**. To check in a badge holder, type the code printed on the
  badge into **Badge code, optional**; spaces are ignored. On a browser that
  can read QR codes, **Scan badge QR code** takes a photo and fills the code in.
  **On duty** lists open check-ins, earliest first, with **Check out** on each
  and **Load more check-ins** when there are more. **Vacant positions** lists
  every position with no one checked in.
- **ICS-211 check-in list.** The open check-ins as the ICS-211 form: name,
  incident assignment, check-in date and time, and how the person checked in.
  **Print ICS-211** prints only the form. If the form says it is a partial
  list, load the remaining check-ins first. People who have checked out are not
  listed.
- **Badges.** A jurisdiction admin chooses a person and the position printed on
  the badge, then **Issue badge**. The badge code appears once: print it with
  **Print badge** before leaving the page. The code is printed as text, not as
  a QR image. Issuing a new badge does not cancel an earlier one, and this
  screen has no way to revoke a badge, so report a lost badge to an admin.
- **Shifts.** **Upcoming shifts** lists scheduled coverage until each shift
  ends. To schedule one, choose the position, optionally who is assigned, and
  the start and end, then **Schedule shift**. The server refuses a shift that
  overlaps another for the same position or person.

For a safe practice run, use the
[synthetic incident demonstration](../DEMO-SCENARIO.md).
