# Synthetic Incident Demonstration

This scenario is a guided tour of the current application. Every organization,
incident, location, assessment, message, and request in the seeded dataset is
synthetic. Do not treat it as live operational information.

The seed creates **SYNTHETIC Ridge Wildfire Exercise** for **Synthetic Demo
County OES**. It includes an incident area and operational period, incomplete
tasks assigned through an operations position, a field form targeting an
attached Field Reports board, mixed-freshness Lifeline and ESF assessments, a
partial-coverage exercise dataset, a triaged resource request, a local CAP
exercise record, a JIC draft, and an AAR observation. Unknown, stale, and
partial states are intentional.

## Accounts and preparation

Load the demo dataset through the deployment's documented demo-data command,
then sign in with one of these local exercise accounts:

| Role | Account | Use |
|---|---|---|
| Administrator | `demo-admin@example.org` | Configuration and owner-authorized actions |
| Operator | `demo-operator@example.org` | Routine incident work |
| Viewer | `demo-viewer@example.org` | Read-only briefing path |

The seeded password is `correct-horse-battery`. Change or remove these accounts
before using an instance for real operations. Select **SYNTHETIC Ridge Wildfire
Exercise** and **OP SYNTHETIC 1** whenever the shell asks for incident context.

## Core walkthrough

1. Open **Situation / Overview** as the viewer. Confirm the incident name,
   period, and organization remain visible while moving between pages. (F14)
2. Open **Situation / ESFs & Lifelines**, then the **Lifelines** tab. Energy is
   a recent unstable assessment, Communications is explicitly unknown and
   incomplete, Transportation is intentionally stale, and the other Lifelines
   have no assessment. Do not interpret missing or unknown as stable. (F8)
3. In **ESFs & Lifelines**, choose the **ESFs** tab. Compare current, stale,
   and unknown entries. Lifeline condition and ESF activation/capacity are
   separate facts. (F8)
4. Open **Situation / Map**. Inspect the selected incident area and available
   layers, source, freshness, and coverage. The synthetic road source covers
   only part of the incident area, so the impact panel remains partial and does
   not present its count as an incident-wide total. (F6, F19)
5. Open **Operations / Boards**, then the Activity Log. The seeded entries are
   labeled `SYNTHETIC` and remain attributed to the local exercise actor. (F1,
   F2)
6. Sign in as the named operator, select **Operations Section Chief** in the
   position control, and open **Operations / Tasks**. A task assigned through
   that position is in progress; other work remains open. Filters and totals
   describe the selected incident only. (F12)
7. Open **Operations / Resources**. Inspect the triaged request for synthetic
   portable generators. Its note explicitly says no resource was ordered or
   delivered. (F5)
8. Open **Planning / IAP**. Use the selected incident and operational period to
   prepare or inspect working content. Approval and completion are explicit
   transitions; a working plan is not a published plan. (F5)
9. Open **Situation / SITREP**. Compose only from the selected incident.
   Unknown, stale, conflict, and missing-source labels must remain visible in
   the result. (F8)
10. In the right-dock **Notifications** section, select **Open center** to open
    Alerts. Inspect the `Exercise` CAP record. It is a locally stored exercise
    artifact; this walkthrough does not configure or call IPAWS and makes no
    delivery claim. (F20)
11. Open **Coordination / JIC**. The seeded release is a draft. Saving,
    submitting, approving, and publishing are distinct states; this exercise
    does not publish externally. (F20)
12. Open **Planning / AAR** and inspect the synthetic observation.
    Record any exercise finding as attributed follow-up work. (F16)

## Continuity walkthrough

Field and task continuity are intentionally bounded to the implemented paths.

1. As the named operator, open **Operations / Smart Forms** while online. Choose
   **SYNTHETIC rapid field report** and its attached Field Reports board. Enter
   a Summary, choose the Hazard category, add a geopoint, and queue it. (F7)
2. If connectivity drops after the form is loaded, report fields can remain in
   the durable, person-and-incident-scoped queue. Attachments and map capture
   require a connection. A queued report is not yet a server receipt.
3. Reconnect and use **Sync queued**. Confirm the screen distinguishes queued,
   synchronizing, synced, failed, and conflict states. (F7)
4. In **My Tasks**, complete an assigned task while disconnected. Only task
   completion is queued offline; task creation, assignment, metadata edits,
   and team-task administration require the server. Reconcile and confirm the
   authoritative receipt before treating the task as complete. (F12)

## Optional integration lab

These facets need separately configured services, credentials, peers, devices,
or reference data. They are not proven by the local seed and must not be
presented as completed during the core walkthrough.

| Facet | Separate evidence required |
|---|---|
| F3 federation | A configured trusted peer and partition/reconnect exercise |
| F4 notifications/webhooks | A configured adapter and observed receiver |
| F9 damage baseline | An imported exercise baseline and approved assessments |
| F10 facility network | A configured source with freshness and coverage |
| F11 tracking/reunification | Exercise tags and authorized restricted-data roles |
| F13 reference libraries | Locally approved scenario/reference content |
| F15 collaboration | A configured collaboration or meeting adapter |
| F17 daily operations | A separately activated planned-event workflow |
| F18 sensor/drone feeds | A configured exercise feed and observed ingestion |

F20 standards exchange beyond the stored CAP exercise record likewise requires
the relevant EDXL, HAVE, CoT/TAK, or alert transport to be configured and
observed. The absence of an adapter is a visible prerequisite, never simulated
delivery.

## Facet index

The walkthrough directly exercises the current local paths for F1, F2, F5,
F6, F7, F8, F12, F14, F16, F19, and part of F20. The optional lab records the
external prerequisites for F3, F4, F9, F10, F11, F13, F15, F17, and F18. No
facet is treated as successful without the evidence described above.
