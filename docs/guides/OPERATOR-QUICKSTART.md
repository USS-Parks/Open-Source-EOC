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
The **Standing lifeline status** panel at the foot of **ESFs & Lifelines** is
the jurisdiction's status outside any incident; members and administrators
record it there with **Record status**, and a SITREP composed without an
incident uses it.

### Read the map

- **Map layers** lists each board and feed under **Operational layers** with
  a checkbox and an **Opacity** slider. The slider fades every part of that one
  layer (areas, lines, points, symbols and labels) so the basemap or another
  layer shows through. It changes only your map view, not the data, and resets
  when the map reloads.
- A layer with more records than one page is drawn from map tiles cut by the
  server. Below street zoom, nearby points are grouped into white circles; the
  number in a circle is its record count. Select a circle to zoom toward it.
  Status colors, facility symbols and record selection work as on a smaller
  layer. **Find on map** and **Zoom to extent** cover only the first page of
  such a layer; search the board itself for the rest.
- The readout in the top-left corner of the map shows the latitude, longitude
  and zoom of the pointer, or of the map center after a move. Its second line
  gives the same position as a USNG and an MGRS grid reference to 1 m, for
  example `USNG 10T DL 48923 71130 · MGRS 10TDL4892371130`. North of 84°N and
  south of 80°S it reads "outside UTM coverage".
- Under **Impact in view**, once the incident area has more than one
  revision, **Compare with area revision** shows each count at an earlier
  revision against the current one, in the same view. Both revisions use the
  datasets loaded now; it is not a snapshot of what was loaded then.

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
- In **Incident Setup**, **Operational area** on an incident opens its setup,
  which lists its checklists and libraries. **Mark complete** appears on the
  checklist items of the position you are signed into; the server refuses
  anyone else.
- In **Messages**, **Export thread** downloads the selected thread as text,
  one line per message with its time and sender.

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

### Import, export, archive and record history

The board screen does not yet have controls for these; they are available
through the board routes listed in the [API reference](../API.md).

- **Export** a view as CSV or Excel with
  `GET /api/v1/boards/{board}/views/{view}/export?format=csv` or
  `format=xlsx`. The file holds the record id and the view's columns you may
  read, under the view's filters and any conditions, sort or `archived`
  option you add. In CSV, text that a spreadsheet would run as a formula
  starts with a single quote. One export holds at most 50,000 records.
- **Import** a CSV or Excel file with `POST /api/v1/boards/{board}/import`,
  as a form upload with the file last. Each column heading maps to the field
  with that key or label, ignoring case; an optional `mapping` form field
  maps headings to field keys explicitly, and `null` skips a heading. The `id`
  column is always skipped: an import creates new records. Run it first with
  `?dryRun=true`: nothing is written and the response lists every row error
  by row number, counting the heading row as 1. Without `dryRun`, every row
  is written or, when any row fails, none is. An import sends no
  notifications. The file limit is 10 MB and 10,000 rows.
- **Archive** a record to take it out of the default views, and **restore**
  it to bring it back. Add `archived=include` or `archived=only` to a view to
  see archived records.
- **Delete** is for jurisdiction administrators. The record disappears from
  every view, map and export, and from sync documents; its history remains.
- **History** of a record, oldest first, is at
  `GET /api/v1/boards/{board}/records/{record}/history`: who, in which
  position, when, and each field changed with its value before and after. An
  update recorded before this history existed shows no earlier value.

### Reach contacts and page a duty officer

**Coordination / Contacts** is the jurisdiction's directory of people to
reach: name, organization, title, email addresses, phone numbers in E.164 form
(with the country code, such as `+17075550100`), notes, and an optional link to
an account or a position. Every member of the jurisdiction reads it.
Administrators add, change and delete contacts, import them from a CSV file,
and keep **Groups**: named lists of contacts in call-down order. An inactive
contact stays in the directory but is skipped by every send.

**Coordination / Mass Notification** sends one message to a group or to chosen
contacts. Members and administrators send; viewers follow the sends.

1. Enter a **Subject** and a **Message**.
2. Under **Send to**, choose **A contact group** or **Chosen contacts**. Chosen
   contacts are notified in the order you tick them.
3. Tick the **Channels**: Email, SMS and In app. In-app notices reach contacts
   linked to an account or position. A contact without an address for a
   channel is skipped on that channel, and the receipts say so.
4. Choose the **Mode**. **Everyone at once** notifies every contact now.
   **Call-down, one contact at a time** notifies the first contact, and when
   that contact has not acknowledged within **Minutes to wait for each
   acknowledgement**, the next one. It stops when **Acknowledgements that end
   the call-down** have come in, or after the last contact's wait.
5. Select **Send notification**. The receipts open.

The receipts list each contact in order: when it was notified or **Not
called**, whether and how it acknowledged, and for each channel **Queued**,
**Retrying**, **Sent** or **Failed** with the relay's or provider's answer or
the error, or **Delivered** for an in-app notice. They refresh while open, and
**Refresh receipts** refreshes them at once. The list of sends shows each
send's state: **Sent** for a broadcast, **Calling down**, **Acknowledged**, or
**Call-down ended without an acknowledgement**.

Email and SMS carry an acknowledgement link for that one recipient. Opening it
shows an **Acknowledge** button; the acknowledgement is recorded when the
recipient selects it. A contact linked to your account acknowledges an in-app
notice in the notification center as usual, which acknowledges the send too.
A call-down moves to the next contact at once when the current contact
acknowledges and more acknowledgements are needed.

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
- In **AAR**, **Load latest revision** on a corrective action reads that one
  action again from the server, so a save does not overwrite a newer change.

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
