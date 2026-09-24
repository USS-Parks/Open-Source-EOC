# Job Aid: Field User

Use with the [training kit ground rules](./README.md). Start every entry with
`SYNTHETIC`.

## Account role and acting position

- **Account role: Member.** A viewer cannot queue a report.
- **Acting position: none required.** Reports carry your name. Select a
  position only if the administrator assigned you one; **My Tasks** then
  shows its tasks.

## What the position does

Reports what you see in the field, accurately and with a location, and makes
sure each report actually reached the server. In the exercise you play the
crews, shelter staff and residents the controller describes.

## First 15 minutes

1. Set the command bar: the synthetic incident and **OP SYNTHETIC 1**.
2. Check in on **Operations > Staffing**.
3. On **Operations > Smart Forms**, choose **SYNTHETIC rapid field report**
   and its attached Field Reports board while you are online. The form must be
   loaded before you can rely on it offline.
4. Check the connection and synchronization state in the command bar.

## Every report

1. Answer the questions. The seeded form asks for a **Summary**, a
   **Category** (Hazard, Damage, Resource or Other) and a **Location**. Type
   the latitude and longitude the controller gives you rather than using
   **Use current location**.
2. Select **Queue field report**. The report is stored on the device first.
3. Read the status until it says synced. Queued is local only; failed means
   acceptance is not verified; a conflict needs review by an operator. Do not
   re-enter a failed or conflicted report under another account.
4. Tell the controller what you sent. Operations reads it on **Field
   Reports**.

Forms built with other question types (line, polygon, barcode, photo, audio,
cascading selects, repeat groups) work as the field user guide describes.
Photos and audio can queue offline; map capture needs a connection.

## Every operational period

- Complete assigned tasks on **Operations > Tasks**, **My Tasks**. Only a
  completion can queue offline; reconcile before calling it done.
- At shift change, finish synchronization, report anything still queued or
  conflicted, and sign out.

## Screens used

| Screen | Use |
|---|---|
| Operations > Smart Forms | Queue field reports |
| Operations > Field Reports | Confirm your report arrived |
| Operations > Tasks | Assigned completions |
| Situation > Map | Where your reports and closures sit |

## What the product does not do

- A queued report is not received. Only synced is.
- Task creation, assignment and edits need a connection; only completion
  queues offline.
- The demo profile runs on one computer at `127.0.0.1`, so the field is
  simulated at the host computer.

## Read next

- [Field user guide](../FIELD-USER.md): all of it, including "Question
  types".
