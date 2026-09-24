# Integrated visual and accessibility review

This is the one bounded review of representative screens that the design
roster's D33 prompt asks for: catch the inconsistencies introduced across
surfaces, and leave no blocking usability or accessibility defect in the
reviewed paths. It ran on 2026-09-24 against the tree after the cross-boundary
exercise landed. Basho remains the judge of visual quality; this review
records what it measured and what it changed.

The review runs as one browser walk,
`server/src/__tests__/d33-review-browser.test.ts`, on the real build, a real
PostgreSQL database and the installed Chrome. Run it with the lane or gate
environment and `pnpm exec vitest run server/src/__tests__/d33-review-browser.test.ts`.
It writes every screenshot, named `review-<view>-<theme>-<width>.png`, and a
record of every check, `review-results.json`, to the folder in
`OPENEOC_SHOT_DIR`. The screenshots were compared by eye with the three
canonical references in [canonical-references](canonical-references/README.md).

## The review set

**Screens.** Each is opened in the light and dark themes at 1440 and 390
pixels wide.

| View | What is on screen |
|---|---|
| Sign-in with two-step verification | The sign-in form, enrollment with the setup key and link, the recovery codes, and the code step of a later sign-in |
| Console shell and navigation | The command bar, the grouped rail, the page header and the context drawer, on every view below |
| Map | The common operating picture with the impact indicators, the layer list and the map tools |
| Overview | The legacy EOC status dashboard with the closed-roads tile and the active closures table |
| Board list | Every board in scope, with a very long board name |
| Board | A board of 500 records whose newest has a long title and a long unbroken reference |
| Record detail | That record in the context drawer, with its attribution and history |
| Record form | The new-record drawer of the same board |
| Resources | Request intake and a request with a long item name |
| Incident Setup | Activation, libraries, the incident list and the jurisdiction master view |
| Reports | The empty list of saved reports |
| Mass Notification | The compose form holding a long message with a long link |
| Smart Forms | The field capture runner for a published form |
| Administration | People, with the roles and two-step status table |
| Update notice | The notice for a waiting build, over the console of a member |

The selected incident has a name of 87 characters, which the command bar,
page header and map status line carry on every view.

**Checks on every view.** axe runs from the installed `axe-core` in the page
(no network) and the walk requires no serious or critical violation; moderate
results are kept in the results file. At 390 the page must not scroll
sideways. No animation or transition may still be running under a
reduced-motion preference.

**Keyboard paths.** In the light theme at 1440 the walk starts at the skip
link and presses Tab until focus leaves the page. It requires that each view's
named controls come up, that every visible enabled control in the workspace
(or in the open dialog) is reached, that no control holds focus, and that
every stop shows a focus ring of at least 3:1 against what surrounds it. The
update notice is walked the same way over a member's console.

**Zoom.** Each view is also opened 720 pixels wide, the width of a 1440 screen
at 200 percent zoom, and must not scroll sideways.

**Long content.** The long incident name, the long board name, the long record
title and reference, 500 rows, and the long notification text.

**Error states.** The resource request list refused by the server (403), the
Reports list with the network off, the empty Reports list, a slow Reports load
held open, and the map's record form failing to load (500).

**Rendering.** The command bar, the rail, and the page header's position and
height are measured on every view and must not move between routes. The page
header's width follows the context drawer, which each layout opens or closes
by its saved preference.

**Preferences.** The map's camera must arrive at once under a reduced-motion
preference and animate without one. Under a higher-contrast preference the
shell and two views are walked by keyboard in both themes and every ring must
hold 3:1; under forced colors every stop must still show a ring.

## Evidence reused

These checks already passed and were not repeated: axe over the component,
form, table and icon galleries in both themes (`web/design-review/__tests__/`);
the token contrast test (`web/src/design/__tests__/contrast.test.ts`); the
shell's skip link, phone navigation trap, drawer dialog trap and keyboard
resizer (`server/src/__tests__/app-e2e.test.ts`); and the installable app and
its update hand-off (`server/src/__tests__/pwa-browser.test.ts`).

## Result

The walk passes: 70 reviewed screens with no serious or critical axe result,
no sideways scroll at 390 or 720, 18 keyboard walks with every named control
and workspace stop reached, every ring at 3:1 or better and no trap, and a
shell that holds still across the twelve console views. No blocking defect was
found. Every major finding in the reviewed paths is fixed. The minor findings
are fixed where cheap and assigned otherwise.

## Findings

Severity: blocking stops a task; major makes a task fail for some people or
breaks a WCAG 2.1 AA criterion; minor is friction or inconsistency.

| # | Severity | Where | Finding | Disposition |
|---|---|---|---|---|
| 1 | Major | Command bar and rail, both themes | The focus ring was the theme's focus blue on navy, 2.0:1 | Fixed: controls there take the signal teal ring, 7.7:1. The walk's ring check failed on these 33 stops before |
| 2 | Major | Map, impact indicators | The strip scrolls sideways on a narrow screen with no keyboard access (axe serious) | Fixed: the strip is a named, focusable group. Walk axe |
| 3 | Major | Board and record detail | The view tabs named a tab panel that did not exist (axe serious) | Fixed: the view's tools and records are its tab panel. Walk axe |
| 4 | Major | Text fields and selects on most screens | Their border was the divider color, 1.5:1 in light and 1.6:1 in dark, under the 3:1 a control boundary needs | Fixed: fields and selects take the strong border; the dark strong border moves from #6b7785 to #7a8694 so it holds 3:1 on raised and overlay surfaces (it measured 2.99 and 2.67). `contrast.test.ts` "control boundary" fails on the old token. A visible change for Basho's review |
| 5 | Major | Enrollment, dark theme | The setup link kept the browser's blue, 1.62:1 (axe serious) | Fixed: a link no screen styles takes the theme's action color. The walk enrolls in the dark theme and failed before |
| 6 | Major | Any screen with the network off | Lists showed the browser's "Failed to fetch" | Fixed: "No connection to the server. Check the network connection and try again." `client.test.ts` and the walk |
| 7 | Major | Dock, board list, map layers and map point board choice | With one incident selected, another incident's boards were listed (from the cross-boundary exercise) | Fixed: the board list carries each board's incidents, and the shell shows the jurisdiction's boards and the selected incident's. `incident-context.test.tsx` and the walk |
| 8 | Major | Incident Setup | Activating an incident did not switch the selector to it (from the cross-boundary exercise) | Fixed: the selector takes the new incident once the server lists it, and activation stays busy until the console has switched. `incident-context.test.tsx`, `incidents-surface.test.tsx` and the walk |
| 9 | Major | Map, new map record | The record panel stayed blank when its form failed to load (from the cross-boundary exercise) | Fixed: it names the board and the reason. `map-surface.test.tsx` and the walk |
| 10 | Major | Map controls under forced colors | MapLibre draws focus as a shadow, which forced colors remove, so zoom, rotate, fullscreen and attribution showed no focus | Fixed: a Highlight outline under forced colors. The walk failed before |
| 11 | Minor | Sign-in and two-step screens | No main landmark and no level-one heading (axe moderate) | Fixed: the frame is the main landmark and the panel title is the heading |
| 12 | Minor | Board list | Every row's button was named "Open" | Fixed: each names its board. The walk reaches "Open" with the long board name |
| 13 | Minor | Operational tables (master view, Administration) | Filter-row header cells of unfilterable columns were empty (axe moderate) | Fixed: each says there is no filter for its column |
| 14 | Minor | Overview, closed-roads tile | The badge showed the server key "warn" | Fixed: "Watch", the operational state label. `dashboard.test.tsx` |
| 15 | Major, visual | Buttons across screens | Two primary styles side by side: near-black in light and light grey in dark on Sign in, Activate, Submit request, New report, Add to pool and Send notification; teal on New record, Create saved view, Save record and Reload. The canonical references use teal. This carries the dark primary question the style consolidation left open | Assigned to Basho. Both styles meet AA; the choice is visual |
| 16 | Minor | Dock, board list, map layers, record drawer title | Incident boards are titled with template keys, such as "...: road_closures" and "...: resource_request" | Fixed: activation titles each board with the incident's name and the board template's title, such as "...: Road Closures". Boards activated earlier keep their stored titles. `incidents.test.ts` |
| 17 | Minor | Resources | Priority, state and next action show keys ("routine", "submitted", "triaged"); the board list shows "layer" | Fixed: they show the dictionary's labels ("Routine", "Submitted", "Triaged") and the board list shows "Layer". `resources-surface.test.tsx` and `boards-index.test.tsx` |
| 18 | Minor | Board table | An empty optional field reads "Unavailable", the state for a missing source | Assigned to Basho: which empty-cell wording the tables use |
| 19 | Minor, outside the set | Chronology, Tasks, board designer (two tab sets) | Tabs name panels that do not exist, the defect fixed in finding 3 | Fixed the same way: the switched region of each tab set is its tab panel. `chronology-surface.test.tsx`, `tasks-surface.test.tsx` and `designer.test.tsx` |
| 20 | Minor | Context drawer on a phone | The drawer is an aside given the dialog role (axe moderate) | Fixed: the drawer is a div, a modal dialog on a phone or tablet and a complementary landmark when docked, and its title row is no longer a header element, so it is not exposed as a banner inside the dialog. `shell-frame.test.tsx` runs axe on the open phone drawer |
| 21 | Minor | Board list at 390 | The Open column runs past the edge; the table scrolls inside the workspace, not the page | Assigned to Basho: which columns a phone keeps |
| 22 | Minor | Context drawer | Closing the drawer on a phone saves "closed" as that layout's desktop preference | Fixed: only the docked drawer's state is saved; opening or closing it on a phone or tablet leaves the saved preference alone. `shell-frame.test.tsx` |
| 23 | Minor | Loading notes | Text such as "Loading reports…" shows but is not announced | Fixed: the shared loading note is a polite status. `load-boundary.test.tsx`; the existing tests that find a status still pass |
| 24 | Minor | Smart Forms runner | Empty required fields show "required" in the error color before any input | Assigned to Basho |
| 25 | Minor | Sign-in | The sign-in and two-step screens carry no product identity, unlike the console | Assigned to Basho |
| 26 | None | Record form, dark theme | While the form loads its reference options, the disabled Save button dims to 2.0:1 | No action: WCAG exempts inactive controls. The walk reviews the form once Save is enabled |

## What the higher-contrast and reduced-motion work adds

The review's preference checks exercise work built with it: under
`prefers-contrast: more` the theme strengthens text, muted text, borders and
the focus color and widens the ring to 3 pixels; under `forced-colors: active`
focus and selection stay visible; and under `prefers-reduced-motion: reduce`
every animation and transition stops and the map's camera jumps. The
[accessibility guide](../guides/ACCESSIBILITY.md) describes them for operators
and holds the manual screen-reader script.
