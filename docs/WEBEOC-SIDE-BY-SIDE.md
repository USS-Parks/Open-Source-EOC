# WebEOC side-by-side evaluation

An evaluation script for an emergency operations center that runs WebEOC and
wants to judge OpenEOC against it. The evaluator runs each task in both
systems, one beside the other, and records what happened. The tasks cover the
three things a WebEOC board shop checks first: boards, notifications and
reporting.

The last two sections record the internal run of this script against OpenEOC
and the gaps that run found. They are not a claim of parity. The
[parity matrix](./VEOC-PARITY-MATRIX.md) holds the current status of each
capability.

## What the WebEOC column rests on

This project has no WebEOC instance, so the WebEOC side of each task rests only
on what two documents say about WebEOC: the
[platform research](./process/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md),
sections 1.2, 3 and 4, and the reference key of the
[parity matrix](./VEOC-PARITY-MATRIX.md). In short, those sources say:

- Everything in WebEOC is a board: a permissioned, form-backed shared table
  with an input view and one or more display views. Administrators build boards
  themselves, historically over editable HTML and JavaScript. The parity matrix
  names DesignStudio as WebEOC's optional board authoring module.
- WebEOC ships a standard board set: Activity Log, Significant Events, Resource
  Request and Task Assignments, Damage Assessment, Shelters, Road Closures,
  Sign In and Out, Schedule, Situation Report, Press Releases, File Library,
  Checklists and After Action Review.
- Users sign in as a position, and the Activity Log and Significant Events
  boards give a who-did-what-when chronology.
- Notifications are triggered by board actions and go out by SMS, push, voice,
  email, Teams, Slack and generic webhooks. Alerting, GIS, analytics and
  cross-agency exchange are sold as paid add-ons.

The sources name no WebEOC menus, screens or report builder, so this script
does not either. Where they are generic, the WebEOC step is generic: do the
task the way your shop does it today and record how.

## Before you start

**Data.** Use synthetic data only. Both systems hold For Official Use Only
information in production; nothing from a live incident belongs in an
evaluation.

**OpenEOC.** Sign in with an account that administers the jurisdiction and is
also an instance administrator; the Templates screen is shown only to such an
account. For email, use an SMTP relay you are allowed to use for the exercise.
For SMS, use the fixture provider, which records each message as "fixture: not
sent" and sends nothing. Do not page real people.

**WebEOC.** Use a training or test instance and an account with board
administration rights.

**Record for every task:** the time taken in each system, the number of steps,
the role that could do it, whether the expected result appeared, and anything
that surprised you.

## Boards

### 1. Create a board from a template

- **Goal.** Stand up a new status board, here a shelter status board with a
  name, a status, a capacity and an occupied count, from a template.
- **WebEOC module.** Boards (WebEOC core); board authoring through
  DesignStudio where licensed.
- **WebEOC side.** Build the same board the way your shop does today, and note
  whether it needed HTML or JavaScript.
- **OpenEOC steps.** Templates, Create template. Enter a Board key and a Board
  title. For each field, fill Field key, Field label and Field type; for the
  status choose `enum` and an Enumeration such as
  `have.facility_operating_status`; tick Required where needed; Add field. On
  the Views tab fill View key and View title, tick the View columns, Add view.
  Publish and create board. To create a whole set of boards from a scenario
  instead, use Incident Setup: choose a Scenario template, give an Incident
  name and Activate.
- **Expected result.** The board opens with its New record button, built from
  version 1 of the template, with no code written.
- **Internal run.** Passed. The board opened at once and the database holds it
  at template version 1. The Boards list did not show the new board until the
  page was reloaded (gap 1). The incident path is proven by
  [incident-activation-browser.test.ts](../server/src/__tests__/incident-activation-browser.test.ts),
  not re-run here.

### 2. Enter records

- **Goal.** Enter four shelters through the board's input form.
- **WebEOC module.** Boards, input view.
- **WebEOC side.** Enter the same four records on the WebEOC board.
- **OpenEOC steps.** On the board, New record. Fill Shelter name, Status,
  Capacity and Occupied, then Save record. Repeat.
- **Expected result.** Each record appears in the list as soon as it is saved,
  and the saved record opens in the context panel.
- **Internal run.** Passed. Four records were entered through the form and each
  appeared in the list.

### 3. Edit a record

- **Goal.** Correct one shelter's occupied count.
- **WebEOC module.** Boards, input view.
- **WebEOC side.** Edit the same record.
- **OpenEOC steps.** Tick the record's row, Edit record, change Occupied, Save
  changes.
- **Expected result.** The new value shows in the list and is stored.
- **Internal run.** Passed. Arcata Community Center went from 40 to 60 and the
  stored record reads 60.

### 4. Filter, sort and group a view

- **Goal.** Show only shelters with a capacity of at least 80, ordered by
  status and then by capacity from largest, grouped by status.
- **WebEOC module.** Boards, display views.
- **WebEOC side.** Produce the same view, and note whether it needed a new
  display view built by an administrator.
- **OpenEOC steps.** Filter, sort and group. Add condition: Condition 1 field
  Capacity, operator "is at least", value 80. Add sort key twice: Sort 1 field
  Status, Sort 2 field Capacity with direction Descending. Group by Status.
  Apply. Clear returns the full view.
- **Expected result.** The server applies the refinement, the Group counts
  panel shows the count per status, and the table follows the sort.
- **Internal run.** Passed. Group counts read "compromised 1" and "normal 2";
  the rows read Fortuna Veterans Hall, Eureka High School, Arcata Community
  Center. More operators, archived records and paging with the refinement are
  proven by
  [board-records-browser.test.ts](../server/src/__tests__/board-records-browser.test.ts).

### 5. Kanban or calendar view

- **Goal.** See the shelters as cards by status, and dated records on a
  calendar.
- **WebEOC module.** Boards, display views.
- **WebEOC side.** Produce the same, and note how.
- **OpenEOC steps.** Show records as: Kanban. For a calendar, the board needs a
  date and time field: Show records as: Calendar, with Next month and Today to
  move. Chart draws the counts as bars.
- **Expected result.** One kanban column per status value in the enumeration's
  order, each with its count. On a calendar, each record sits on its day in the
  viewer's time zone.
- **Internal run.** Passed for kanban: the normal column counted 3 and the
  compromised column 1. Dragging a card between columns, the calendar, the
  chart and the kanban and calendar dashboard widgets are proven by
  [board-views-browser.test.ts](../server/src/__tests__/board-views-browser.test.ts),
  not re-run here.

### 6. Import and export CSV and Excel

- **Goal.** Take the board's records out as CSV and Excel, and bring a
  spreadsheet in.
- **WebEOC module.** Boards.
- **WebEOC side.** Export and import the same way your shop does today.
- **OpenEOC steps.** On the board, Export CSV and Export Excel download the
  current view. Import records opens a drawer: choose the Spreadsheet file,
  match each heading under Field for column, Check file, read the Row errors,
  then Import.
- **Expected result.** The downloads, named after the view (here `all.csv` and
  `all.xlsx`), hold the view's records. The import writes nothing until the
  file checks clean, then writes every row.
- **Internal run.** Passed for export: the CSV header read
  `id,name,status,capacity,occupied` over 4 records and the workbook held 4
  rows. Import with the mapping step, the per-row error list and the
  all-or-nothing commit is proven by
  [board-records-browser.test.ts](../server/src/__tests__/board-records-browser.test.ts),
  not re-run here.

### 7. Move a WebEOC board's records in

- **Goal.** Bring records exported from a WebEOC board into the new board.
- **WebEOC module.** Boards.
- **WebEOC side.** Export the board's records as the CSV file the OpenEOC
  importer reads; the [migration guide](./guides/MIGRATION.md) lists the
  columns it uses.
- **OpenEOC steps.** Administration, Records, WebEOC migration. Choose the
  Target board, the WebEOC server time zone and the WebEOC CSV export. Read the
  check result, adjust a column under Board fields and their WebEOC columns if
  needed, Save mapping, then Import. Download rejection report returns the rows
  left out.
- **Expected result.** A dry run first, with every row marked will be created,
  already imported or rejected, and nothing written. The import writes the
  valid rows and keeps WebEOC's bookkeeping columns on each record's creation
  entry in the audit trail.
- **Internal run.** Passed. A two-row export read "2 rows read: 1 will be
  created, 0 already imported, 1 rejected."; the import read "Imported 1
  record. 1 row rejected, 0 already imported.", and the creation entry kept
  `dataid` 201 and the position name. The rejection report and a repeat import
  that skips rows already imported are proven by
  [webeoc-import-browser.test.ts](../server/src/__tests__/webeoc-import-browser.test.ts),
  not re-run here.

### 8. Record history

- **Goal.** See who changed a record, when, and what the values were before and
  after.
- **WebEOC module.** Boards; the position-based activity chronology.
- **WebEOC side.** Find the same record's change history.
- **OpenEOC steps.** Tick the record's row, then the Change history tab in the
  context panel.
- **Expected result.** One entry per change, with the person, the time and
  each field before and after.
- **Internal run.** Passed. Arcata Community Center showed two entries:
  Created, with each field from empty, and Updated, with Occupied 40 → 60, both
  by Admin. Screenshots `side-by-side-boards-light-1440.png` and
  `side-by-side-boards-dark-1440.png`.

### 9. Permissions

- **Goal.** Limit who may read and change a board's fields and records.
- **WebEOC module.** Boards (permissioned tables).
- **WebEOC side.** Set the same limits and note how.
- **OpenEOC steps.** On the board, Customize board. Each field has Readable by
  and Writable by. The Record access tab, Restrict individual records, sets
  read and edit grants by role, creator, creator position or workflow-assigned
  position.
  Publish and apply the next version.
- **Expected result.** A member sees only the records the grant admits, in
  lists, references, history and exports.
- **Internal run.** Not repeated. Proven by
  [board-records-browser.test.ts](../server/src/__tests__/board-records-browser.test.ts),
  "restricts records and composes reference labels from the designer", and the
  receipt "V1 W4.1 part one: board engine depth" in the
  [V1 ledger](./process/V1-LEDGER.md).

## Notifications

### 10. Configure email and SMS

- **Goal.** Connect an email relay and an SMS provider and prove each with a
  test message.
- **WebEOC module.** Notifications (alerting, sold as an add-on).
- **WebEOC side.** Configure the same channels, or record who does it for the
  shop.
- **OpenEOC steps.** Administration, Channels. Fill Relay host, Relay port,
  Connection security and From address, then Save email settings; fill Test
  email recipient and Send test email. Under SMS choose the SMS provider, Save
  SMS settings, fill Test phone number and Send test SMS.
- **Expected result.** The screen shows what the relay answered, and the SMS
  test is recorded, not sent, by the fixture provider.
- **Internal run.** Passed, against a relay on 127.0.0.1: "Test message to
  duty@example.org delivered: 250 2.0.0 Ok: queued as" and "recorded by the
  fixture provider (fixture: not sent)".

### 11. A notification rule on a record change

- **Goal.** When a shelter's status changes to closed, email the shelter desk
  and text the duty phone.
- **WebEOC module.** Notifications triggered by board actions.
- **WebEOC side.** Build the same trigger.
- **OpenEOC steps.** Administration, Notifications, Add a notification rule.
  Board: the shelter board. When: A record is updated. Condition: A field
  changes to a value, Field key `status`, Value `closed`. Channel kind: Email,
  with the addresses. Add channel, Channel kind: SMS, with the numbers. Create
  rule. Then close a shelter on the board through Edit record.
- **Expected result.** The change queues one email and one SMS, which the
  delivery worker sends.
- **Internal run.** Passed. Closing McKinleyville Library queued two
  deliveries and the worker delivered both. The email's subject read
  "shelter_status: record.updated" and the SMS read "shelter_status updated:
  McKinleyville Library"; the SMS is listed under Channels as a fixture
  message. Gaps 3 and 4 come from this task. A signed webhook rule, and a URL
  refused by the allowlist, are proven by
  [notification-rules-browser.test.ts](../server/src/__tests__/notification-rules-browser.test.ts).

### 12. Contacts and a group

- **Goal.** Keep a contact directory and a call-down group.
- **WebEOC module.** Notifications.
- **WebEOC side.** Build the same group in whatever the shop uses today.
- **OpenEOC steps.** Contacts, Add contact: Name, Email addresses, Phone
  numbers, Save contact. New group: Group name; for each member, in call-down
  order, choose the contact under Add a contact and press Add to group; Save
  group.
- **Expected result.** The group lists its members in order.
- **Internal run.** Passed. Two contacts and the group Shelter managers were
  saved.

### 13. Mass notification with delivery receipts

- **Goal.** Message the whole group by email and SMS and see what reached
  whom.
- **WebEOC module.** Notifications (alerting).
- **WebEOC side.** Send the same message and find its delivery record.
- **OpenEOC steps.** Mass Notification. Fill Subject and Message, choose the
  Contact group, keep Email and SMS ticked and Mode Everyone at once, Send
  notification. Refresh receipts.
- **Expected result.** One receipt per contact, with each channel's address,
  state and the relay's or provider's answer, and the acknowledgement state.
- **Internal run.** Passed. Four deliveries were sent. Each receipt showed the
  relay's "250 2.0.0 Ok: queued as" reply, "fixture: not sent" for SMS and "Not
  acknowledged"; the send read "Sent · 0 of 2 acknowledged". Screenshots
  `side-by-side-notifications-light-1440.png` and
  `side-by-side-notifications-dark-1440.png`.

### 14. Escalation to the next contact

- **Goal.** Page one duty officer at a time and move on when nobody
  acknowledges.
- **WebEOC module.** Notifications (alerting).
- **WebEOC side.** Run the same call-down.
- **OpenEOC steps.** Mass Notification with Mode Call-down, one contact at a
  time, Minutes to wait for each acknowledgement and Acknowledgements that end
  the call-down. The recipient acknowledges from the link in the email.
- **Expected result.** The next contact is called after the wait, and the
  call-down stops at the acknowledgement.
- **Internal run.** Not repeated. Proven by
  [mass-notification-browser.test.ts](../server/src/__tests__/mass-notification-browser.test.ts):
  with the clock eleven minutes ahead the job calls the second contact, who
  acknowledges from the email's link on a 390 px page, and the third is never
  called.

## Reporting

### 15. A saved report with grouping and totals

- **Goal.** Shelter capacity by status, with the count, capacity and occupancy
  per status and overall, saved for reuse.
- **WebEOC module.** Reporting. The sources describe no WebEOC report builder;
  they name analytics as a paid add-on and a Situation Report board in the
  standard set.
- **WebEOC side.** Produce the same report the way your shop does today.
- **OpenEOC steps.** Reports, New report. Report name; Board; untick the
  columns not wanted. Filter, sort and group: Group by Status, Apply. Add
  total, twice, and set Total 2 field to Occupied. Read the preview, then Save
  report and Run.
- **Expected result.** A count and sums per group and overall, over every
  record the person running it may read.
- **Internal run.** Passed. The totals read: closed 1, 50, 0; compromised 1,
  80, 75; normal 3, 410, 192; All records 5, 540, 267.

### 16. PDF and Excel output

- **Goal.** Hand the report on as a PDF and as a workbook.
- **WebEOC module.** Reporting.
- **WebEOC side.** Produce the same files.
- **OpenEOC steps.** On the saved report, Download PDF and Download Excel;
  Download CSV is also offered.
- **Expected result.** A paged PDF with the groups and totals, and a workbook
  with the rows and totals.
- **Internal run.** Passed. The PDF is PDF 1.4 and carries "All records: 5
  records; Capacity sum 540; Occupied sum 267"; the workbook holds the records
  and the All records row.

### 17. A schedule

- **Goal.** Email the report as a PDF every morning.
- **WebEOC module.** Reporting.
- **WebEOC side.** Schedule the same, or record how the shop gets it today.
- **OpenEOC steps.** On the saved report: Runs, Every day at a time; Time of
  day; Time zone; Email addresses, or tick contacts; Save schedule.
- **Expected result.** The report states its next run, and a due run emails the
  file.
- **Internal run.** Passed for the schedule: "PDF daily at 07:00
  (America/Los_Angeles). Next run" with the schedule stored. A due run that
  emails the PDF, stores the file and shows Delivered is proven by
  [reports-browser.test.ts](../server/src/__tests__/reports-browser.test.ts),
  not re-run here. Screenshots `side-by-side-reports-light-1440.png`,
  `side-by-side-reports-dark-1440.png` and `side-by-side-reports-dark-390.png`.

## The internal run

On 2026-09-23 the tasks above ran in order as one walk,
[webeoc-side-by-side-browser.test.ts](../server/src/__tests__/webeoc-side-by-side-browser.test.ts),
through the real screens in Chrome against real PostgreSQL, with an SMTP relay
on 127.0.0.1 and the fixture SMS provider. Tasks 9 and 14 and the parts of
other tasks marked as proven elsewhere were not repeated; their walks and
receipts are named in each task.

- Command: `pnpm exec vitest run
  server/src/__tests__/webeoc-side-by-side-browser.test.ts` with the test
  database settings of the other browser walks.
- Result: 1 file and 1 test passed, 0 failed. The page raised no errors and no
  request left the machine.
- Screenshots: light and dark at 1440 at the end of each module and dark at 390
  on Reports, written to the directory named by `OPENEOC_SHOT_DIR`. They are
  not committed.

## Gaps the run found

1. A board created on the Templates screen opens at once, but the Boards list
   read "No boards in this jurisdiction yet." until the page was reloaded. The
   rule and report board pickers read the same list.
2. Outside incident activation, no screen creates a board from a template that
   is already published, whether a standard one or one brought in on the
   designer's Import tab, which adds a version and creates no board. No route
   lists the published board templates.
3. A notification rule cannot be listed, changed, paused or removed once
   created: the Notifications tab shows no rules, and the only rule route
   creates one.
4. A rule's messages read as system text: the email subject was
   "shelter_status: record.updated" and the SMS "shelter_status updated:
   McKinleyville Library", naming the template key and the event rather than
   the board title and what changed. The notification panel shows the same
   title.
5. Of the channels the sources list for WebEOC, voice has no OpenEOC channel,
   and Teams and Slack are reachable only as a generic webhook whose body is
   not a chat message; that path was not exercised.
6. In the dark theme, the plain buttons on Mass Notification, Reports and the
   record context panel (Send notification, Refresh receipts, Show receipts,
   Save schedule, Remove schedule, Files for this record) render as grey
   blocks with low-contrast labels.
7. At 390 wide, the report's row table cuts its last column heading at the
   panel edge ("Occupied" reads "OCCUPIE"); the page itself does not scroll
   sideways.
8. Status values show as stored ("normal", "compromised") in the list, the
   group counts and the report, where the kanban uses readable labels.

## Boundaries carried from the receipts

These were not found by the run; the receipts in the
[V1 ledger](./process/V1-LEDGER.md) state them and they bear on a WebEOC
comparison.

- The designer cannot save conditions, sorts or groups into a template's own
  views; operators apply them per read ("V1 W4.1 part two: board screen
  controls").
- The WebEOC importer moves records only, with no value translation, no
  location from latitude and longitude, no incident tagging and no update of a
  row already imported ("V1 W4.4: WebEOC migration").
- A call-down cannot be acknowledged by an SMS reply ("V1 W4.0 part two:
  contacts and mass notification").
- A report has no chart output, and a failed scheduled send is not retried
  ("V1 W4.3: reporting").
