# Accessibility

OpenEOC aims at WCAG 2.1 AA in both themes. This guide says what the console
supports for keyboard, screen reader, zoom, motion and contrast users, what it
does not yet do, and how to run the manual screen-reader check.

## What the console supports

### Keyboard

- Every control is reached with Tab and Shift+Tab in reading order. Nothing
  holds focus.
- **Skip to workspace** is the first stop on every console page. It moves
  focus past the command bar and the section rail to the page.
- Every stop shows a focus ring of at least 3:1 against what surrounds it,
  including on the navy command bar and rail.
- On a phone, **All sections** opens the rail and **Open context** opens the
  context drawer. Each holds focus inside until you close it; Escape closes it
  and returns focus to the control that opened it.
- On a wide screen the context drawer's edge takes focus: the left and right
  arrow keys resize it, and Home and End set its narrowest and widest.
- Tab sets, such as the board views and the Administration sections, take one
  stop; the left and right arrow keys, Home and End move between tabs.
- On the map, the zoom, compass, fullscreen and attribution controls are
  buttons. When the map itself has focus, the arrow keys pan it and the plus
  and minus keys zoom.

### Screen readers

- The console has one banner (the command bar), a navigation region named
  **Sections**, one main region, and the context drawer, which is a
  complementary region on a wide screen and a dialog on a phone.
- Each page has a level-one heading with the page name, and the sign-in and
  two-step screens have one too.
- Every control has a name. Buttons that repeat a word on each row, such as
  **Open** in the board list, name their row.
- Errors are announced as alerts, and saved-state notices as status messages.
  The update notice, **A new version is ready**, is a status region named
  **App update**.
- Data tables have column headers, the operational tables have captions, and
  their filter cells name their column.

### Zoom and small screens

The console reflows without sideways page scrolling at 720 pixels wide, which
is a 1440 screen at 200 percent zoom, and on a 390 pixel phone. Wide tables
scroll inside their own panel.

### Reduced motion

With the operating system's reduced-motion setting on, animations and
transitions stop: the map's camera jumps to a place instead of flying, the
phone section rail opens without sliding, and colors change at once. The
small busy spinner on a button still turns, more slowly, so work in progress
stays visible.

### Contrast

- Text meets 4.5:1 and controls, borders of text fields and focus rings meet
  3:1 in both themes. Status is never shown by color alone: every state has a
  label and a marker.
- With the operating system's higher-contrast setting on
  (`prefers-contrast: more`), both themes strengthen text, muted text, borders
  and the focus color, and the standard focus ring widens from 2 to 3 pixels. The
  console follows the setting as it changes, without a reload.
- With a Windows contrast theme (forced colors), the system's colors replace
  the theme's; focus rings and the selected section and tab stay visible,
  including on the map's controls.

## Known limits

- **The map canvas is visual.** Its features are not read out from the
  picture. Reach them through the map's other controls: **Find on map** takes
  a record title, a county or a latitude and longitude and lists matches as
  buttons; **Map layers** lists every layer with its switch and opacity; and
  choosing a feature opens the **Selected map feature** panel, which reads out
  the feature's details. The command bar's **Search addresses and places**
  moves the map to an address.
- Loading notes, such as "Loading reports…", are shown but not announced.
- The view switches on Chronology and Tasks and the two tab sets of the board
  designer are tab sets without tab panels, so a screen reader does not announce
  the region they control.
- The manual screen-reader pass below has not been run yet. Until it is
  recorded, screen-reader support is measured by automated checks only.

## Manual screen-reader check

Automated checks prove names, roles and contrast; they do not prove that a
person using a screen reader can finish the work. This check does.

### Setup

Run each task with each of these pairings, on the current release candidate,
with the synthetic demonstration data loaded:

| Screen reader | Browser | Device |
|---|---|---|
| NVDA, current release | Chrome or Firefox, current | Windows |
| VoiceOver | Safari | macOS |
| VoiceOver | Safari | iPhone or iPad |

Use a test administrator account enrolled in two-step sign-in, with an
authenticator app on a second device. Turn the screen reader's speech viewer
or captions on so announcements can be copied. Do not use a mouse or touch
exploration on a desktop; on iOS use swipe navigation and the rotor.

### Tasks

For each task, start from the step named and stop when the result named is
heard.

1. **Sign in.** From the sign-in page, enter the email and password, then the
   authenticator code. Done when the console's page heading is announced.
2. **Choose an incident.** Move to the **Selected incident** list in the
   command bar and choose the demonstration incident. Done when the new
   incident's name is announced in the page header's scope line.
3. **Open a board and read a record.** From **Sections**, open **Boards**,
   open a board, and select a record with its checkbox. Done when the record's
   fields and its attribution are read from **Selected record**.
4. **Add a record.** On the same board, choose **New record**, fill the
   required fields, and save. Done when the new record is announced in the
   board list, or the form's error summary names each field to fix.
5. **Read a notification.** Open the notifications button in the command bar,
   then **Open center**, and open the newest notification. Done when its title,
   state and text are read.
6. **File a field report.** From **Sections**, open **Smart Forms**, fill the
   capture form and queue it. Done when the synchronized receipt is announced.
7. **Check the map through the find box and inspector.** From **Sections**,
   open **Map**, type a record title into **Find on map**, press Enter and
   choose the match. Done when **Selected map feature** reads the feature's
   details.

### What to record

For each task and each pairing:

- **Completed:** yes, yes with help, or no.
- **Time:** from the first key press to the result.
- **Announcements:** anything announced wrongly (wrong name, wrong role, wrong
  state, read twice) and anything not announced at all, with the screen and
  control, copied from the speech viewer where you can.
- **Severity:** blocking (the task cannot be finished), major (finished only
  with help or a workaround), or minor.

### Where to record it

Add one receipt to [the V1 ledger](../process/V1-LEDGER.md) headed
"V1 A11Y-T1: screen-reader pass", with one table per pairing: the task, the
result, the time and the announcement problems. Name the release candidate,
the screen reader, browser and operating system versions, and who ran it.
Blocking and major problems become findings for the next unit that owns the
screen.
