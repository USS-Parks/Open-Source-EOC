# Design fidelity review

The design fidelity plan (`docs/process/DESIGN-FIDELITY-PSPR-2026-09-24.md`)
is built through DF5. This document is the DF6 gate: the side-by-side images,
a region checklist per canonical frame with every remaining difference and its
reason, what each control in the frames does, and the full serial suite. It
waits on Basho's review; anything Basho names as still different goes back
into DF1 to DF4.

## Side-by-side images

Each image puts the canonical frame on the left and the build's capture of the
same screen on the right, at the frame's 1280 by 800 size (captured at 1586 by
992 and scaled). They come from `pnpm fidelity` on the North Coast Storm
reference scenario at 09:42 local, with the offline street, imagery and
elevation archives configured.

| Frame | Image |
|---|---|
| 01 Incident overview, light | `docs/design/fidelity/overview-light-side-by-side.jpg` |
| 02 Incident overview, dark | `docs/design/fidelity/overview-dark-side-by-side.jpg` |
| 03 ESFs & Lifelines with Energy open, light | `docs/design/fidelity/lifelines-light-side-by-side.jpg` |

## Region checklist

"Matches" means the region has the frame's structure, content kind, controls
and visual language on the scenario's data. Differences that come from the
scenario's own data (names, times, counts) are listed only where they change
what the region shows.

### Frame 01: incident overview, light

| Region | Result | Remaining difference and reason |
|---|---|---|
| Brand block | Matches | The ring with four knobs around a filled core, and "People · Information · Safer communities". |
| Command bar | Matches | Incident, period, position, "Synced HH:MM", bell with 3 and the account chip are live controls. The avatar shows initials, not a photograph (no photographs are stored); the name is the scenario's Jordan Lee, not "J. Carter"; the position chip names the held position, "Planning Section Chief", where the frame abbreviates. |
| Rail | Matches | The frame's twelve sections in its four groups, with Settings, Help and the theme menu at the foot. Every other section is listed when the viewer turns on "Show every section" in Settings, and the section in view is always listed. |
| Page header | Matches | Title, "Incident area · 7 participating organizations · Updated HH:MM", "Create report" and "Briefing view". |
| Counts | Matches | Solid glyphs on tinted tiles as the frame draws them (a red alert, a green shelter, the report page, a green check), thin chevrons; open requests 24 with 6 urgent, active shelters 8 with 312 occupants, field reports 46 with 9 unverified, tasks due 12. |
| Common operating picture | Matches with a data difference | Checklist with More layers, place search, locate, layers, full screen, legend strip, north arrow, miles and kilometres scale, the incident callout, and the frame's terrain look: green land shaded by elevation relief and a blue sea. The seeded incident area is the operational area near the coast, where the frame's illustrated extent reaches far over the ocean; symbols sit at real locations, so some cover place names the frame shows clear; the attribution button stays in the corner for the map's licences. |
| Community Lifelines | Matches | Eight rows with the frame's solid glyphs (shield, fork and knife, cross, bolt, cell tower, road, biohazard, water drop), scope lines, a divider before the condition, and thin chevrons; "Open workspace" with an arrow. |
| Priority work | Matches with a data difference | Solid glyphs by what a request asks for (a road, equipment, supplies), the red alert for urgent and plain dots otherwise, "View all" with an arrow. The three most pressing items are all urgent requests in the scenario, where the frame shows one urgent, one in progress and one not started. |
| Recent activity | Matches with a data difference | The timeline with solid glyphs on tinted tiles. The two newest items (the shelter update and the field report) where the frame shows a shelter update and a road closure. |
| Footer | Matches | "Demonstration · Synthetic data \| FOUO" when the deployment serves the synthetic demonstration dataset, and "FOUO" otherwise. The frame's "Design preview" and "Concept from Design PSPR" are notes on the frame, not product text (decision 4). |

### Frame 02: incident overview, dark

| Region | Result | Remaining difference and reason |
|---|---|---|
| Brand block | Matches | The dark frame's compass needle in a two-tone ring, and "People · Information · Action". Each theme carries its own frame's mark and line. |
| Command bar and rail | Matches | As frame 01, in the dark frame's colors and larger type, with its solid rail glyphs for Overview, Boards, Resources, Operational Periods and Participants. |
| Page header and markings | Matches | FOUO above the actions with "Demonstration · Synthetic data" beside it on the synthetic dataset, as the dark frame places its note. |
| Counts | Matches | The dark frame's glyphs in dark circles: the solid red alert, the outlined shelter, report page and task check. |
| Common operating picture | Matches | NAIP imagery under the title band, dashed cyan boundary, closure lines and points, open and planned shelters, key facilities, the command post with "ICP", cameras, the helibase, the legend panel, the layer list (Roads, Incidents, Facilities, Shelters, Weather, Terrain; weather off as in the frame), zoom, north arrow and miles scale. The card frames the whole seeded area, a little wider than the frame's view; facilities close together at this zoom give way by rank (command post first), so the frame's spread of symbols near Eureka is not all visible until one zooms in. |
| Community Lifelines | Matches | Rows with the dark frame's solid glyphs (the quartered shield, the house, the cross, the bolt, the cell tower, the road, the warning triangle, the water drop), dot, condition and the impact line under it. |
| Priority work and recent activity | Matches with data differences | As frame 01. The frame's recent message is posted in the scenario as the frame shows it, by R. Martinez of Caltrans District 1 at 08:51 in the incident-wide "Road status" thread, and reads in the incident's activity. It is the third item there, after the 09:28 shelter update and the 09:18 field report: the two overview frames show different recent pairs, so the build shows the two newest. |

### Frame 03: ESFs & Lifelines with Energy open, light

| Region | Result | Remaining difference and reason |
|---|---|---|
| Shell | Differs in one place | The rail follows the overview frames' width and type, where this frame's rail is narrower. The brand block keeps the light frames' ring and line: this frame draws a third mark, a compass star with "California", and the three frames cannot all be matched by one light theme. |
| Header actions | Matches | "Compare periods" and "New assessment". |
| Tabs | Matches | Community Lifelines, ESF coordination, Dependencies, Assessment history, each its own route. |
| Filters | Matches | "Incident area", "Current period" and "All conditions". |
| Lifeline cards | Matches | Tinted by condition, the frame's line glyphs (the true biohazard mark, the cell tower, two water drops), each name on one line, pill, impact line, source and assessed time; Energy selected. Source names are the scenario's organizations ("Cal OES" where the frame writes "CA OES – Law Enforcement"). |
| Related ESF coordination | Matches | Function, activation, coordinator and open missions, Energy's function first; the coordinator column names the coordinating liaison, "Utility liaison" and "Transport liaison", with its organization on hover. The jurisdiction's standing lifeline status, which the frame does not show, sits under Assessment history. |
| Drawer | Matches | Icon, condition, "Assessed 09:35 PDT · Utility liaison", the impact, affected components by name with their icons (the geography on hover), the stabilization objective, the next update, "Linked actions (2)" with a page for the generator request and a magnifier for the inspection, statuses and chevrons that open the linked requests, "Update assessment" with a pencil and "View history". The owners read "Logistics Section Chief" (the frame abbreviates it "Logistics") and "Utility liaison". The assessment details, the outlook and the recorded relationships sit under View history. |

## What each control does

Every control drawn in the frames acts on the live engine; none is decorative.

| Where | Control | What it does |
|---|---|---|
| Command bar | Incident, period, position chips | Select the incident, the operational period and the acting position for the whole console. |
| Command bar | Bell | Opens the notifications; the count is the unread assigned items. |
| Command bar | Account chip | Theme, session and sign-out. |
| Rail foot | Settings, Help, theme | Settings dialog (theme, compact navigation, Administration), the guides, and the theme menu. |
| Overview | Count cards | Open Resources, the Shelters board, Field Reports and Tasks. |
| Overview | Create report | Composes and freezes a SITREP for the incident and period, then opens it. |
| Overview | Briefing view | The same overview, read-only and full screen, left with Escape. |
| Map card, dark | Legend, layer list, zoom, north arrow | Layer checkboxes show and hide the closures, the incident boundary, facilities, shelters, weather stations and the shaded terrain; the layers button folds the list; zoom and north act on the map. |
| Map card, light | Checklist, More layers, search, locate, layers, full screen | The checklist and More layers switch the same layers plus imagery and every other map board; search flies to a gazetteer place; locate flies to the device's position; layers folds the checklist; full screen takes the card full screen. |
| Map card | Records | A click opens the record's details in a popup. |
| Lifelines (overview) | Rows and "Open workspace" | Open that lifeline in the workspace, or the workspace. |
| Priority work and recent activity | Rows and "View all" | Open the request, the tasks or the chronology. |
| Lifelines workspace | Compare periods | Adds each lifeline's condition in the previous period and whether it worsened or improved. |
| Lifelines workspace | New assessment | Records a new assessment for any lifeline, superseding its standing one. |
| Lifelines workspace | Filters | Narrow the cards by reported geography and condition; the period filter shows the reports that stood in an earlier period. |
| Lifelines workspace | Cards | Open the lifeline's drawer. |
| Drawer | Linked actions | Open the linked resource request, for any organization on the incident. |
| Drawer | Update assessment, View history | Record a revised assessment (with objective and next update), or read the history and record a decision on conflicting reports. |
| Related ESF coordination | Function names | Open that function's ESF workspace. |

## Gate

`pnpm check:gate` passed on 2026-09-24 at commit `023beaa`: static checks
(tsc, eslint, the license scan over 303 packages, the link check), the
advisory gate (no high or critical advisories), the desktop tests (27), and
the serial Vitest run with one worker (278 files and 1,577 tests, then the
load test, 1 file and 4 tests), with nothing skipped. The receipt is "Design
fidelity DF6: gate" in `docs/process/V1-LEDGER.md`.

## Open for Basho

- Review the side-by-side images and this checklist, and name anything that
  still differs.
- Decided and carried out: Basho approved the partner sharing plan
  (`docs/process/PARTNER-SHARING-PSPR-2026-09-24.md`). Every organization on
  an incident now reads its requests, positions and incident-wide threads; a
  partner liaison links county requests and names owners from the incident's
  positions; the Caltrans liaison's message is its own. The receipts are
  "Partner sharing PS1" to "Partner sharing PS5" in `docs/process/V1-LEDGER.md`,
  and the frame 03 image is refreshed.
- GitHub Actions jobs for these commits did not start: the account reports
  failed payments or a spending limit, which needs attention in GitHub
  billing.
- The plan file was held open by Word during execution, so the function
  requirement was recorded in the ledger instead of the plan.
