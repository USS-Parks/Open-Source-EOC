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

## Install the app and work offline

The console installs as an app. In Chrome or Edge, choose **Install** in the
address bar or the browser menu; on an iPhone or iPad, choose **Share**, then
**Add to Home Screen**. The app opens in its own window. Installing has been
tested in desktop Chrome only; it has not yet been tested on a phone or
tablet.

After one visit with a connection, the device keeps a copy of the app: the code
for every screen, the bundled California basemap, the map labels and the
facility symbols. Without a connection:

- A signed-in session keeps working. Every screen opens; screens that need live
  data say it is unavailable, and field reports and task completions queue on
  the device as described below.
- Signing in needs the connection, so sign in before you leave coverage. If the
  app is closed or reloaded while offline, it opens again from what it kept on
  the device, marked "No connection · working offline", and signs in for real
  when the server answers; queued work stays on the device. This needs the
  offline copy: **Settings > This computer** shows "Kept on this computer" once
  it is installed, which happens on the first visit with a connection.
- The bundled basemap draws from the device copy. A street, buildings or
  overlay map hosted by your deployment is read from the server as you pan and
  needs the connection.
- Map tiles your deployment serves from the app's own address stay available
  once viewed with a connection, up to 50 MB. The oldest are dropped first, and
  none are added when the device is nearly out of storage.
- Records, boards and messages are never answered from this copy; they come
  from the server or, for queued work, from the device's own queue.

The app asks the browser to keep its storage, including queued work, when the
device runs low on space. The browser decides.

When a new version is published, a notice reads **A new version is ready**.
Choose **Reload** when it suits you; queued work stays on the device through
the reload. **Later** hides the notice until the app next starts.

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

The form definition must already be loaded. Reports can queue after that,
including their photos and audio. A queued file stays on the device until its
report has synchronized, then uploads to the report's record; the status counts
queued files beside queued reports. One file may be at most 10 MB, and the
device holds at most 50 MB of queued files for one incident. Map record
submission uses the connected map-capture path and is disabled while offline.

## Question types

- **Location** takes a latitude and longitude, typed or from **Use current
  location**.
- **Line** and **polygon** questions take points as `latitude longitude`
  pairs separated by semicolons. Type them, or select **Draw on map** and tap
  each point; **Undo point** removes the last one. A line needs two points. A
  polygon needs three different points and must be closed: select **Close
  polygon** to repeat the first point at the end.
- **Barcode** questions take the code typed into the field, or **Scan** takes
  a photo of the code and fills the field. A browser with its own barcode
  reader reads QR codes and common barcodes; where the browser has none, as on
  Windows and Linux desktops, the app's own reader reads QR codes only. When
  no code is read, the screen says so and the typed entry is used.
- **Photo** and **audio** questions take a picture or a recording from the
  device camera, microphone or files. Photos may be PNG, JPEG or GIF; audio may
  be MP3, M4A, AAC, Ogg, WebM or WAV.
- **Signature** questions (an XLSForm `image` question with the appearance
  `signature`) take a signature drawn on a pad with a finger, pen or mouse, or
  your name typed and set in script with **Use my typed name**. **Sign**
  keeps it with the report, and it uploads when the report synchronizes, as a
  photo does.
- **Cascading selects** offer only the choices that fit an earlier answer, such
  as the towns of the chosen county. When the earlier answer changes, a choice it
  no longer allows is flagged and must be chosen again.
- **Repeat groups** collect one entry per item, such as one per crew. Select
  **Add** to start an entry and **Remove** to drop one; each entry is checked on
  its own.

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
