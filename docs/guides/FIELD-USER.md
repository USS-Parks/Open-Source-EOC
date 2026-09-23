# Field User Guide

The field workflow is designed for a phone or ruggedized tablet. It keeps
supported report fields and assigned task completions durable through a network
interruption, while distinguishing local queue state from server receipt.

## Before leaving connectivity

1. Sign in and select the assigned incident and position.
2. Open **Smart Forms** and load the assigned form and incident board.
3. Open **My Tasks** and confirm the work assigned to your current position or
   incident participation.
4. Check the command-bar connection state. Cache preparation must finish before
   you rely on a disconnected path.

## Queue a field report

1. In **Smart Forms**, choose your organization's form and the attached incident
   board.
2. Complete the visible questions. Required and conditional fields are checked
   before the report can queue.
3. Select **Queue field report**. The report is stored for the current person,
   incident, and board before synchronization begins.
4. Read the status: queued means local only; synchronizing means a transfer is
   running; synced means the server acknowledged it; failed means acceptance is
   not verified and conflict needs an explicit review.

The form definition must already be loaded. Report fields can queue after that.
Attachments require a connection, and map record submission uses the connected
map-capture path. The interface disables those actions while offline rather
than implying they were stored.

## Complete an assigned task

Only a completion for a task assigned to your current authority can queue
offline. Task creation, assignment, prerequisites, due dates, and other metadata
edits require a server connection. A queued completion remains pending until
**Reconcile queued work** returns the authoritative receipt.

If a prerequisite is incomplete, the task remains blocked. If the server
rejects the completion or requests authentication, the queue is retained; sign
in again and reconcile rather than repeating the work under another account.

## Track a patient, evacuee or asset

**Tracking** appears when the server runs the `tracking` integration. It needs
a connection; nothing is queued offline.

- **Register** issues a tag, or attaches an existing one, to a patient,
  evacuee, companion animal or asset under a field-safe label.
- **Scan handoff** records each custody change against the tag: the custody
  state, the station, agency and location, and a note.
- **Find & reunify** lists recent objects and searches by label, or by tag
  with a leading `#`. **Custody chain** opens the object's handoffs, oldest
  first, with the time, station, agency, location and note of each; **Show
  later events** reads the next page. Health and identity details are never
  shown on this screen.

## Handle a conflict

Do not erase or recreate a conflicted item. The application retains exact
conflict information for the current person and incident so an authorized
operator can review it. Record any needed clarification in the authoritative
workflow after connectivity returns.

## Shift change

Finish synchronization where possible, report every remaining queued or
conflicted item, then sign out of the position. The incoming responder should
use their own account and position session so attribution remains accurate.
