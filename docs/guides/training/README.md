# Training Kit

This kit trains EOC staff on OpenEOC. It has one job aid per exercise
position, a tabletop exercise played at the keyboard on the synthetic
demonstration incident, and an instructor outline for a half-day or full-day
class. It has no video.

## Contents

| Document | Use |
|---|---|
| [Exercise situation manual](./EXERCISE-SITUATION-MANUAL.md) | Scenario, objectives, modules and injects, handed to every player |
| [Exercise facilitator guide](./EXERCISE-FACILITATOR-GUIDE.md) | Staff roles, pre-StartEx checklist, expected actions and evidence per inject, ratings, hotwash and after-action steps |
| [Instructor outline](./INSTRUCTOR-OUTLINE.md) | Half-day and full-day agendas, setup checklist, reset between classes |

## Job aids

Each job aid fits on one or two pages: the account role and acting position,
what the position does in OpenEOC, the first 15 minutes, the work of every
operational period, the screens used, what the product does not do, and the
guide sections to read.

| Position | Account role | Acting position | Job aid |
|---|---|---|---|
| EOC Director | Admin | Incident Commander | [EOC Director](./JOB-AID-EOC-DIRECTOR.md) |
| Planning Section Chief | Member | Planning Section Chief | [Planning Section Chief](./JOB-AID-PLANNING-SECTION-CHIEF.md) |
| Situation Unit | Member | Situation Unit Leader | [Situation Unit](./JOB-AID-SITUATION-UNIT.md) |
| Operations Section Chief | Member | Operations Section Chief | [Operations Section Chief](./JOB-AID-OPERATIONS-SECTION-CHIEF.md) |
| Logistics Section Chief | Member | Logistics Section Chief | [Logistics Section Chief](./JOB-AID-LOGISTICS-SECTION-CHIEF.md) |
| Public Information Officer | Member | Public Information Officer | [Public Information Officer](./JOB-AID-PUBLIC-INFORMATION-OFFICER.md) |
| Liaison Officer and system administrator | Admin | Liaison Officer | [Liaison and administrator](./JOB-AID-LIAISON-AND-ADMINISTRATOR.md) |
| Field user | Member | None required | [Field user](./JOB-AID-FIELD-USER.md) |

The standard position set has no EOC Director and no Situation Unit Leader.
The director acts as Incident Commander, which carries the command checklist.
The instructor adds a Situation Unit Leader position before class. The
director holds the admin role because the server lets only an administrator
approve an IAP and record a new operational period.

## Ground rules

1. **Synthetic data only.** Run the kit on the demo profile of the Windows
   desktop launcher (`-Action Setup -Profile demo`, described in
   [Windows desktop setup](../../WINDOWS-DESKTOP.md)). Never enter real
   incident, person or contact information, and never exercise on a
   production profile.
2. **Mark every entry.** Start every typed entry with `SYNTHETIC`: board
   records, notes, messages, releases, alert text, cost descriptions and
   observations.
3. **Record gaps as observations.** When the product cannot do what the
   position needs, say so, work around it in the open, and record an area for
   improvement on **Planning > AAR**. Do not pretend a capability exists.
4. **The server enforces roles.** A missing button or a refusal means the
   account or acting position lacks that authority. Do not borrow another
   player's account; ask the administrator to check the assignment.
5. **Check the command bar before acting.** Selected incident, Operational
   period and Acting position must match your assignment.
6. **Queued is not received.** Only a server receipt counts as delivered,
   submitted or complete.

## Limits that shape the exercise

- The demo profile binds to `127.0.0.1`, so players work at the host
  computer. Each player signs in under their own account.
- The demonstration seed creates one organization. Partner participation,
  escalation to another tier and review by another instance cannot be played.
- The IAP has no screen field for objectives (ICS-202) or the ICS-208 safety
  message.
- An incident has one current operational period. Recording a new one
  replaces the current one.
- **Tasks** cannot add a task. Tasks come from the incident template's
  checklists.
- A JIC draft that was saved but not submitted is not listed on any screen.
- The IAP's ICS-211 reads the Sign In/Out board, and its ICS-201 and ICS-215
  resource lines read the Resource Requests board. Requests made on
  **Resources** do not appear there. The ICS-205 needs a radio communications
  board, which the Wildfire incident does not have.

## Related guides

- [Synthetic incident demonstration](../../DEMO-SCENARIO.md): the seeded
  incident and the three seeded accounts.
- [Operator quickstart](../OPERATOR-QUICKSTART.md),
  [Field user guide](../FIELD-USER.md),
  [Viewer quickstart](../VIEWER-QUICKSTART.md),
  [Administrator guide](../ADMIN.md) and [Reports](../REPORTS.md).
