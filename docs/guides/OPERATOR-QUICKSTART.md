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
- Use **Resources** for the 213RR lifecycle. Received, accepted, assigned, in
  progress and fulfilled are distinct stages: receipt is not acceptance, and
  whoever accepts a request owns it until it is assigned. Each request shows
  its number, owner and next action; **Find a request** searches by number or
  words across open and ended requests. Do not infer delivery from submission. Costs
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
- **Incident Setup** also carries the **Jurisdiction master view**: each
  incident's status, open resource requests and tasks, board records,
  participating organizations and operational period. An archived incident is
  left out of the command bar's incident choices; choose **Archived only**
  under **Archived incidents** to find it. **Guest access locked** means guest
  grants cannot read that incident; members are unaffected.
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

Select **Open** on a request in **Resources**. The costs and mutual aid
panel sits below the request history. **Print ICS 213RR** gives the
request's Resource Request Message as a PDF as it stands now: the order,
who accepted it, the supplier and every step since receipt, and its costs
(costs show only to the owning organization).

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

### Type resources, keep the pool and demobilize

**Resources** also holds the organization's resource pool, a cost rollup and
the NIMS resource typing catalog. In NIMS typing, Type 1 is the most capable.

- **Request intake**: choose a **Resource kind** and, where the kind has type
  levels, a **Resource type**. The type is the least capable one that fills the
  request; **Any type** takes every type of the kind. A request with no kind
  cannot take a pool resource.
- **Resource pool**: enter the **Resource name**, choose its kind and its one
  type, then choose **Add to pool**. Each resource is available, assigned, out
  of service or demobilized. Choose the **Next status** and **Update status**.
  To assign, pick the request: only requests in sourcing, assigned or deployed
  whose kind matches and whose type the resource meets or betters are offered.
  The server refuses assignment to a request on a closed incident; a resource
  can still leave it. To demobilize, record the **Return condition** and tick
  the demobilization checks made. Demobilization is final. Read-only access
  sees the pool but cannot change it. Every move is in the audit log.
- **Find and label pool resources**: **Find a resource** takes words from a
  resource's name or kind, or its label code, the eight characters each row
  shows. **Scan a resource label** reads a printed label's QR code from a
  photo and finds its resource. **Show labels for** *n* **resources** lays out
  a label for each listed resource that is not demobilized, with its name,
  kind and type, label code and a QR code; **Print labels** prints them alone,
  two across. A label's QR code is a link to its resource in the pool: a phone
  that scans it opens the console, and after signing in, the pool with that
  resource found. The link uses the address the console was open at when the
  labels were printed, so print them from the address phones use. The screen
  warns when the console is open at the computer's own address, which no phone
  can reach.
- **Cost rollup**: the costs recorded on the requests in scope, per request and
  per kind, with the total. Record and export costs from the request's
  history, as above.
- **Resource typing catalog**: **Show the *n* kinds** lists every kind, its type
  levels and its source. The starter kinds are a small subset, not RTLT titles.
  An administrator adds a local kind with a name, a discipline and a number of
  type levels, and imports the FEMA Resource Typing Library Tool (RTLT) export
  as a CSV with a name, an RTLT ID and a type level per row, and a note saying
  where the file came from. A file with any bad row imports nothing and the
  first 20 errors are shown; a new import replaces the previous one.

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
- A transition with a guard needs the record to meet conditions first, such
  as an amount filled in. Until it does, its button is unavailable and
  "Not yet:" says what is missing; edit the record and it becomes available.
- A state may make some fields read-only. The edit form shows them disabled,
  with "Read-only while the record is" the state.
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

### Filter, sort and group a board view

Open **Filter, sort and group** above a board's table. The changes apply to
the open view when you choose **Apply**, are read on the server, and carry to
**Load more records** and to exports. **Clear** returns to the view as its
designer defined it. A refinement never shows records or fields your account
cannot read.

- **Conditions**: choose a field, an operator and a value; every condition
  must hold. Text and enumerations offer contains, starts with, is, is not, is
  one of and is not one of; numbers offer comparisons and is between; dates
  offer is after, is before and is between, each against a time such as
  "24 hours ago" or a specific time. Every listed field also offers is empty
  and is not empty; references, people and attachments offer only those two,
  and geometry is not listed. A condition with no value is refused with its
  number.
- **Sort**: add up to four sort keys, most significant first, each ascending
  or descending.
- **Group by**: rows arrive in order of the chosen field, and the counts above
  the table give the records in each group over the whole view, not only the
  loaded page.
- **Archived records**: leave archived records out (the default), include
  them, or list only them. An archived record carries an "Archived" tag in the
  first column.

Column filters and header sorts in the table still work on the loaded rows.

### Show a board as kanban, calendar or chart

**Show records as** above a board's records switches between **List**,
**Kanban**, **Calendar** and **Chart**. Every mode reads the open view under
its current refinement, so a condition or the archived option applies to all
four. The mode, its field and the calendar's month or week belong to the
screen: a reload or another board starts again in **List**.

- **Kanban**: choose an enumeration field under **Columns from**. Columns
  follow the field's own order, and each count covers every matching record,
  not only the loaded cards. A card shows the view's first column and two more.
  Drag a card to another column, or use its **Move ... to** list, to change
  that field; the change is an ordinary record update, so the server's edit
  rules apply and a refusal is shown in its words with the card left in place.
  A reader sees the columns without moving anything. When the field mirrors
  the board's workflow states, cards do not move here: use a transition in the
  record's **Workflow** section.
- **Calendar**: choose a date and time field under **Dates from**. Records sit
  on the day their value falls on in your timezone. **Month** and **Week**
  change the span; **Previous**, **Today** and **Next** page through it, and
  each page asks the server only for that range.
- **Chart**: choose a field under **Count by**. Bars give the number of
  matching records for each value, counted on the server; **Show as a table**
  gives the same numbers with each value's share.

Select a card or a calendar entry to open the record, as from the table.

### Archive, delete and read a record's history

Select a record to open it in the record context.

- **Archive record** takes the record out of the default views; its
  references and history stay. It is offered to writers the record's edit
  rule admits. List archived records as above, select one, and choose
  **Restore record** to bring it back.
- **Delete record** is offered to jurisdiction administrators. A confirmation
  states that the deletion is recorded in the record's history with the values
  it held and cannot be undone from the screen. The record then disappears
  from every view, map, export and offline copy.
- **Change history** lists the record's changes oldest first: what happened,
  when, who and in which position, and each field changed with its value
  before and after. **Load more history** reads the next page. An update
  recorded before this history existed shows no earlier value. When the
  board has actions, a change a board action made reads "by action" and its
  name, and each action's run says what set it off and what it did, or why
  it was refused or stopped. An action runs as you, so it can do only what
  you may do.

### Export and import board records

- **Export CSV** and **Export Excel** download the open view under its current
  refinement: the record id and the columns you may read, at most 50,000
  records. In CSV, text that a spreadsheet would run as a formula starts with
  a single quote; an import removes it again.
- **Import records** is offered to writers. Choose a CSV or Excel file with a
  heading row. The server proposes a board field for each heading that matches
  a field key or label, ignoring case; change any under **Map columns to
  fields**, or choose **Do not import**. The `id` column is never imported:
  an import creates new records.
- The file is checked as soon as it is chosen, and again with **Check file**
  after a mapping change. The check writes nothing and lists every row error
  by row number, counting the heading row as 1. To fix errors, correct the
  file and choose it again; the mapping is kept.
- **Import** is available only after a check of the current file and mapping
  finds no errors. It writes every row or, if any row fails, none, and sends
  no notifications. The file limit is 10 MB and 10,000 rows.

### Reach contacts and page a duty officer

**Coordination / Contacts** is the jurisdiction's directory of people to
reach: name, organization, title, email addresses, phone numbers in E.164 form
(with the country code, such as `+17075550100`), notes, and an optional link to
an account or a position. Every member of the jurisdiction reads it.
Administrators add, change and delete contacts, import them from a CSV file,
and keep **Groups**: named lists of contacts in call-down order. An inactive
contact stays in the directory but is skipped by every send.

**Coordination / Mass Notification** sends one message to contact groups,
chosen contacts, positions and whoever is on call. Members and administrators
send; viewers follow the sends.

1. Enter a **Subject** and a **Message**. To ask a question, write up to six
   **Answers to ask for**, one per line, such as "Available" and "Not
   available". The acknowledgement link then shows one button per answer,
   and the answer chosen is the acknowledgement; a recipient may open the
   link again to change it. The email and text list the answers.
2. Tick whom to reach, in any mix: **Contact groups**; **Contacts**, notified
   in the order you tick them; **Positions: whoever holds each now**; and
   **On call: whoever is on shift in each now**. A position reaches its own
   contact card, such as a desk phone, and each person who holds it, through
   that person's contact card when the directory has one. On call reaches the
   person on shift in the position (Staffing's shifts); when no one is on
   shift, it reaches the position's holders instead, and the receipts say
   so. Everyone is reached once, however many of your choices name them.
3. Choose the **Mode**. **Everyone at once** notifies everyone now.
   **Call-down, one contact at a time** notifies the first contact, and when
   that contact has not acknowledged within **Minutes to wait for each
   acknowledgement**, the next one. It stops when **Acknowledgements that end
   the call-down** have come in, or after the last contact's wait.
4. Tick the **Channels**: Email, SMS and In app. In-app notices reach
   contacts linked to an account or position, and people reached through a
   position or shift. A contact without an address for a channel is skipped
   on that channel, and the receipts say so; a holder with no contact card is
   reached in the app only.
5. For everyone at once with both SMS and email, you may tick **If someone
   does not acknowledge, try their next device**, choose the **Order** (SMS
   first, then email, or the reverse) and the **Minutes to wait before the
   next device**. The first device goes now; the second waits that long and
   goes only to people who have not acknowledged. In-app notices go at once.
6. Select **Send notification**. The receipts open. A send that would reach
   no one is refused with the reason.

The receipts say what the send was addressed to (a position or shift that
reached no one is marked so), count each answer when the send asked a
question, with how many have not answered yet, and list each person in order: how the send
found them (their group, the position they hold, their shift), when they were
notified or **Not called**, whether and how they acknowledged, and for each
channel **Queued**, **Retrying**, **Sent** or **Failed** with the relay's or
provider's answer or the error, or **Delivered** for an in-app notice. A
fallback waiting its turn reads **Falls back if not acknowledged** with the
time it goes, and one withdrawn by an acknowledgement reads **Not needed:
acknowledged before the fallback**. They refresh while open, and **Refresh
receipts** refreshes them at once. The list of sends shows each send's state:
**Sent** for a broadcast, **Calling down**, **Acknowledged**, or **Call-down
ended without an acknowledgement**.

**Notify when an incident activates.** Under **Incident Setup**, **Activate an
incident** has **Notify people when it activates**. Tick it, then tick the
groups, positions and on-call positions to reach, the channels (in the app is
ticked by default, since a person on shift may have no contact card) and any
fallback, and optionally write the message; without one, the notice says the
incident is activated and asks people to check in. The notice is sent with
the activation, as one step: a notice that would reach no one stops the
activation with the reason. The notice appears under Mass Notification as
**Activated:** and the incident's name, its in-app notices open the incident,
and the incident's chronology records it.

Email and SMS carry an acknowledgement link for that one recipient. Opening it
shows an **Acknowledge** button; the acknowledgement is recorded when the
recipient selects it. A contact linked to your account acknowledges an in-app
notice in the notification center as usual, which acknowledges the send too.
A call-down moves to the next contact at once when the current contact
acknowledges and more acknowledgements are needed.

**When phones cannot reach the server.** If the jurisdiction's SMS channel is
a gateway on the site network (a phone with a SIM; see the administrator
guide), a text also says how to answer by reply, such as "Reply 1 for
Available or 2 for Not available". Replies are read from the phone within
half a minute. The receipts show each person who answered **by text reply**
and each text they sent, marked when it was not one of the answers.

**Call down on paper.** When texts and email cannot go out or cannot be
answered, open the send's receipts and select **Print call-down sheet**. The
sheet lists the message, the answers to ask for, and each person in order with
their number and blank columns for the time reached, the answer and who
called. Reach each person by voice or radio, then under **Enter from the
call-down sheet** tick **Reached** for each, type the time (empty means now),
choose their answer, and select **Enter acknowledgements**. They show on the
receipts as acknowledged **from the call-down sheet**. Log the radio and
runner traffic meanwhile on a **Radio and Runner Log** board: time,
direction, by radio, runner or landline, from, to, the message, the runner,
and whether receipt was confirmed; its **Awaiting receipt** view lists what
was sent and not yet confirmed.

## 4. Plan and brief

- Prepare IAP content against the selected incident and a real incident-area
  operational period. Working, in approval, approved, and complete are distinct
  states; export the selected immutable revision.
- Fill in the period's ICS forms one at a time under
  [Write the period's ICS forms](#write-the-periods-ics-forms).
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

### Write the period's ICS forms

Open **ICS Forms** under Planning and select the operational period. **ICS
forms for this period** lists each form the period holds, with its version,
whether it is a draft or ready, and who saved it last.

1. Choose a form in **Form to start** and select **Start form**. The form
   opens as a draft, filled in where the incident's records hold the answer:
   positions and their holders for the 201, 203, 205A and 207, the radio
   channels board for the 205, check-ins for the 211, the activity log for
   the 214, and the period's 202 objectives for a later 201 or 209. A period
   holds one of most forms; if it already has the one chosen, the button
   opens it instead. The 204, 213 and 214 can be several to a period, so
   they ask for a name: the division or group, the message subject, or the
   person and position. A 213RR starts from one of the incident's resource
   requests, chosen under **Resource request**, and is named by its number;
   its blocks come from the request's record, and **Take the request's
   current record** brings in what has happened to the request since.
2. Fill the form in block by block; the numbers follow the NIMS ICS Forms
   Booklet (FEMA 502-2, September 2010). A table takes **Add row** and
   **Remove**.
3. **Save as draft** or **Save and mark ready**. Each save is a new version
   and makes you its preparer, under the position you are acting in. A save
   over a version someone else saved first is refused with the current
   version's number; open the form again and reapply the change.
4. **Versions** lists every saved version. **Print** gives any version as a
   PDF; **Load into the editor** brings an earlier version back to save as
   the next one. Printing uses the saved version, not unsaved changes.

A reader of the incident can open and print the forms but not save them. A
partner organization's contributor on the incident can write them under
their incident grant, and each start and save is in the owner's chronology.

#### Assemble the IAP from the period's forms

Under **Assemble the IAP from these forms**, tick the ready forms the plan
holds. The 202, 203, 204s, 205, 205A, 206, 207 and 208 are ticked by
default; the 215 and 215A worksheets, and any other form, go in only when
ticked. A form still in draft cannot be ticked. **Assemble IAP** makes a
draft plan holding each form at its current version, then **Review it in the
IAP workspace** opens it.

In the IAP workspace the plan is submitted and approved as a whole, and
**Forms in this plan** lists each form with the version the plan holds. When
a form in the plan is saved and marked ready again:

- a draft plan takes the new version in place;
- an approved plan stays as approved, and its next revision starts as a
  draft holding the new version, waiting for approval;
- a plan in approval keeps the forms it was submitted with; approve it, then
  select **Start revision N with the changed forms**.

A form saved as a draft goes into no plan until it is marked ready. If you
cannot revise the plan (a partner who did not prepare it, say), the change
shows as waiting, and someone who can revise it takes it with the same
button. The plan's PDF opens with its contents, each form and version, and
says who approved it and when. A plan assembled from forms takes its 204s
from the period's ICS 204 forms, so the ICS-204 assignment editor does not
appear for it.

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
   board-scoped durable queue. Photos and audio queue with the report and
   upload after it synchronizes. Map record capture requires a connection.
2. An assigned task completion can queue locally. Task creation, assignment,
   metadata edits, and team-task administration require the server.

Read the displayed phase. Queued means local. Synced means the server returned
an exact receipt. Failed means the client lacks verified acceptance; rejection
and a lost response are both possible. Failed, conflict, or authentication-
required states retain the supported queue for recovery. Reconnect and
reconcile before reporting the work as received or complete.

A board whose record rules restrict some of its records is not available for
offline sync to anyone the rules restrict. Its board screen says so, and Smart
Forms does not queue reports for it; enter them on the board screen while
connected. Work already queued for such a board stays on the device, the
continuity panel shows **Offline sync unavailable**, and the other queued work
is still delivered.

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
  badge into **Badge code, optional**; spaces are ignored. **Scan badge QR
  code** reads the badge's QR code from a photo and fills the code in; a
  scanner that types what it reads into the field works as typing does.
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
  **Print badge** before leaving the page. The badge carries the code twice,
  as a QR code and as text in groups of four, and prints alone on the page.
  Issuing a new badge does not cancel an earlier one. **Issued badges** lists
  every badge, and **Revoke badge for** *name* stops a lost badge's code from
  checking anyone in.
- **Shifts.** **Upcoming shifts** lists scheduled coverage until each shift
  ends. To schedule one, choose the position, optionally who is assigned, and
  the start and end, then **Schedule shift**. The server refuses a shift that
  overlaps another for the same position or person.

For a safe practice run, use the
[synthetic incident demonstration](../DEMO-SCENARIO.md).

## 7. Find an address or place

The **Search addresses and places** box in the command bar finds a street
address, a street, a city or town, or a named place such as a courthouse, an
airport or a peak. It works without an internet connection.

- Type at least two characters. An exact address comes first, then the
  closest name matches. Each result says what it is (**Address**, **Street**,
  **Place** or **Point of interest**); streets, addresses and points of
  interest also name the nearest town, which is not always the city the
  address is in. Among equally good matches, the one nearer your
  jurisdiction's map area comes first.
- Abbreviations work either way (`st` and `street`, `mt` and `mount`, `n` and
  `north`), and a partly typed word matches: `mount sh` finds Mount Shasta.
- Move through the results with the arrow keys and press **Enter**, or select
  one. The map opens if another screen is showing, centers on the result and
  marks it. The mark stays until you choose another result or leave the map.
- **Escape** closes the list; a second **Escape** clears the box.
- House numbers come from OpenStreetMap and are not complete. When a number
  is missing, the street is listed instead, so you can find the block.
- "Offline address search is unavailable on this server" means the deployment
  has no address search file configured; tell the administrator. Typed
  coordinates still work in **Find on map**.
