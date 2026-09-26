# Field User Guide

The field workflow is designed for a phone or ruggedized tablet. It keeps
supported report fields and assigned task completions durable through a network
interruption, while distinguishing local queue state from server receipt.

## Before leaving connectivity

1. Sign in and select the assigned incident and position.
2. On a device other people use, set a device PIN, as
   [Keep work on a shared device](#keep-work-on-a-shared-device) describes.
   Without one, the device keeps your work unprotected.
3. Open **Smart Forms** and load the assigned form and incident board.
4. Open **My Tasks** and confirm the work assigned to your current position or
   incident participation.
5. Check the command-bar connection state. Cache preparation must finish before
   you rely on a disconnected path.

## Install the app and work offline

The console installs as an app from the browser; there is no app store app.
A phone or tablet must first trust your host's certificate authority, which
an administrator sets up once per device, as the network host guide
describes under [Phones and tablets](NETWORK-HOST.md#phones-and-tablets).
Then, with a connection:

1. On a computer, in Chrome or Edge, choose **Install** in the address bar or
   the browser menu.
2. On an iPhone or iPad, in Safari, choose **Share**, then **Add to Home
   Screen**, then **Add**. Open the app from the Home Screen and sign in
   inside it: it keeps its own sign-in, apart from Safari.
3. On Android, in Chrome, open the menu and choose **Install app** or **Add to
   Home screen**, then **Install**.
4. Sign in, choose your incident and position, and open **Settings > This
   computer**. Wait until **Offline copy** reads "Kept on this computer". If
   **Kept when storage runs low** reads No, choose **Keep this computer's
   copy**. On a shared device, set a device PIN there too.

The app opens in its own window. Installing has been tested in desktop
Chrome; the phone and tablet steps have not yet been walked on a device.

After one visit with a connection, the device keeps a copy of the app: the code
for every screen, the bundled California basemap, the map labels and the
facility symbols. Without a connection:

- A signed-in session keeps working. Every screen opens; screens that need live
  data say it is unavailable, and field reports and task completions queue on
  the device as described below.
- Signing in needs the connection, so sign in before you leave coverage. If the
  app is closed or reloaded while offline, it opens again from what it kept on
  the device, marked "No connection · working offline", and signs in for real
  when the server answers; queued work stays on the device. With a device PIN
  it asks for the PIN first. This needs the offline copy: **Settings > This
  computer** shows "Kept on this computer" once it is installed, which happens
  on the first visit with a connection.
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
the reload, and with a device PIN the app asks for it again. **Later** hides
the notice until the app next starts.

## Keep work on a shared device

What the app keeps on the device for working offline (queued field reports
and their photos and audio, queued messages, new tasks and task completions,
drafts, the board forms and incident list kept for working offline, and your
signed-in session) is kept one of two ways.

- **Without a device PIN**, as it always has been: **unprotected**. Anyone
  who uses the device, or has its storage, can read your drafts and queued
  work, and a restart opens the console as you, from your saved session. This
  is why a device that other people use should have a PIN for each person
  who works on it. The console says so: after you sign in, a notice above
  the screen reads "This device keeps your work unprotected", with **Set
  device PIN** and **Not now**, and the side panel's **This device** card
  says the same. **Not now** hides both until you next sign in. **Settings >
  This computer** always has **Set device PIN**.
- **With a device PIN**, encrypted. Choose **Set device PIN** in the notice,
  the card or Settings, enter a PIN of at least six digits or characters
  twice, and choose **Set device PIN** again. What the device already kept for
  you moves under the PIN, and the unprotected copy is deleted. The card then
  reads **Kept under your device PIN**. No one else's PIN, password or session
  opens it, and the PIN never leaves the device. A longer PIN is harder to
  guess from a copy of the device's storage. Do not let the browser save it.

Under a device PIN:

- **When the app starts**, and after 15 minutes without a touch, click or
  key, it asks for the PIN before it shows anything it kept. **Lock now** on
  the card locks it at once, for example before you hand the device over.
- **Wrong PINs.** Two wrong PINs in a row cost nothing more. From the third,
  each one makes the screen wait before the next try: 30 seconds, then a
  minute, then two, doubling each time. Closing or reloading the app does not
  end the wait. The tenth wrong PIN in a row erases everything the device
  keeps for that person, **including work not yet sent**; the screen counts
  the tries left.
- **Why unsent work is erased too.** Erasing it means that someone who keeps
  guessing, or an owner who forgot the PIN, loses reports that never reached
  the server. Keeping it sealed instead would leave the work, and its key
  wrapped under the PIN, on a device that may be lost, where it can be
  guessed at away from the app, and a six-digit PIN does not hold out long
  against that. The waits make ten wrong tries take about an hour, which no
  one reaches by mistake. Send what you can before you hand a device over.
- **Forgot the PIN?** Choose **Sign in with a password instead** and sign in.
  The PIN screen then also offers **Forgot the PIN? Erase this device's
  copy**, which erases what the device keeps for you, unsent work included,
  and goes on without a PIN.
- **Another person** on the same device signs you out (account menu, **Sign
  out**) and signs in with their own account. They never get your key. Your
  work stays on the device, sealed; signing in with your password alone does
  not open it: the app asks for your PIN, or offers to erase it. Without a
  PIN, your work stays in the unprotected copy as before, and the next person
  sees only their own work on screen, but the copy itself is readable by
  anyone with the device.

Not encrypted either way, because they hold no incident records: the app's own
files and map tiles in the offline copy, the device's list of whose PINs it
holds (each person's name, the salt and the wrapped key, and the wrong-PIN
count), and viewer preferences such as the theme, map units, map bookmarks and
the figures typed into the damage screen's declaration thresholds.

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
device holds at most 50 MB of queued files for one incident.

A board whose record rules keep some of its records from you still takes your
reports offline. When they synchronize, each record is applied through those
rules on its own: your own records are written, and a change to a record the
rules keep from you is a conflict, never applied. The device is sent no one
else's records from such a board.

## Place a point on the map offline

On **Map**, **Add point** on one of the selected incident's boards opens the
board's form with the point you placed. The form opens without a connection
once the map has shown that board with one. With a connection, **Save record**
writes the point at once. With none, the point is kept on the device with
your other queued reports: the screen reads "Saved on this device at 10:42;
it is sent when the connection returns.", and the continuity panel counts it
until **Reconnect and reconcile** delivers it. A point on a board outside the
selected incident needs the connection.

## Send a message offline

In **Messages**, a message to one of the selected incident's threads is kept
on the device when there is no connection and shows in the conversation as
**Queued on this device**. It is sent, once, when the connection returns, or
by **Reconnect and reconcile**. A message the server refuses, for example to a
thread you can no longer post in, stays with the reason until you choose
**Discard this message**.

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

A completion for a task assigned to your current authority can queue
offline, and an administrator's **New task** is kept on the device when there
is no connection, listed under **New tasks kept on this device**, and added
when it returns. Assignment changes, prerequisites of existing tasks, due dates
and other metadata edits require a server connection. A queued completion
remains pending until **Reconcile queued work** returns the authoritative
receipt.

## When the incident closed while you were offline

Work that reaches an incident after an administrator closed it is not lost and
not added to the closed incident. The server keeps it as a late submission for
the incident's administrators, who accept or refuse it. The continuity panel
counts it under **Late submissions**, and the screen that sent it says so.

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
On a shared device, sign out of the app too: under a device PIN, what it
keeps for you stays sealed and opens again only when you sign in there with
your password and PIN; without one, it stays unprotected on the device.
