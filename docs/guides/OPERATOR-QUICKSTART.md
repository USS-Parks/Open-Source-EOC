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
