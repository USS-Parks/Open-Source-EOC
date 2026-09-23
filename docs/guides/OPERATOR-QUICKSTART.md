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
  fulfilled are distinct states. Do not infer delivery from submission.
- Use **Smart Forms** for supported field reports. Select the attached incident
  board and read the queue receipt after submission.
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
  Approval and publication are separate server actions.
- A local CAP exercise record or alert draft is not evidence of IPAWS delivery.
  Check the dedicated submission status and external acknowledgement only when
  that integration is configured.

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

For a safe practice run, use the
[synthetic incident demonstration](../DEMO-SCENARIO.md).
