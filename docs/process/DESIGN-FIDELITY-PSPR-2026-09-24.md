# Design Fidelity PSPR: the three canonical frames

**Created:** 2026-09-24
**Author:** Basho Parks
**Status:** APPROVED by Basho on 2026-09-24 for STS execution with commit and
push per unit ("V1 grant: design fidelity" in `docs/process/V1-LEDGER.md`).
**Baseline:** `main` at `3961b31`.

## 1. Goal

The operator console reproduces the three canonical frames in
`docs/design/canonical-references/` without concession:

| Frame | Screen | Theme |
|---|---|---|
| `02-overview-dark.jpg` | Incident overview | Dark |
| `01-overview-light.jpg` | Incident overview | Light |
| `03-lifelines-light.jpg` | ESFs & Lifelines, Energy selected | Light |

The ESFs & Lifelines screen in dark follows the dark overview's language.
Every other screen inherits the shell (command bar, rail, page header, cards,
buttons, type and spacing) the frames define.

**Acceptance.** With the reference scenario loaded, a capture of each screen
at the frames' 1586 by 992 viewport, placed beside its frame, matches region
by region: layout and proportions, type sizes and weights, colors, borders
and radii, icons, spacing and density, and content structure. Every
difference is either fixed or listed for Basho with the reason it cannot be
closed. Basho's side-by-side review is the final acceptance (gate line 18).
The full serial suite stays green.

**Truthfulness, from the canonical references README.** "Use real supported
map data and truthful states; concept labels do not authorize inventing
data, doctrine, participation or command authority." The frames are matched
with real data in a seeded synthetic scenario, not with painted values.

## 2. The gap, region by region

Measured against the final captures of `ec11af5`.

### Shell (all three frames)

- Brand block: logo, wordmark, subtitle line. The build shows "EMERGENCY
  COORDINATION"; the frames show three different subtitles (decision 2).
- Command bar: the frames show one row with an incident selector ("North
  Coast Storm · Exercise" with a chevron), an operational period chip with a
  calendar icon ("OP 03 · 0600-1800 PDT"), a position selector with a people
  icon ("Planning Section"), "Synced 09:42" with a green dot, the bell with a
  count, and the avatar with the person's name and role and a chevron. The
  build shows labelled form controls ("Incident", "Operational period Not
  set", "Acting position No acting position"), a search field, "Live", a
  FOUO badge and "Admin".
- Rail: section headings, item size and spacing, icons, the active item
  (filled teal-navy with a teal left bar in dark, a filled light pill in
  light), and Settings, Help and Theme at the foot. The build adds a
  "Compact navigation" button at the top and items the frames do not show
  (decision 3).
- Page header: title ("Incident overview"), a subtitle line ("Incident area ·
  7 participating organizations · Updated 09:42 PDT"), the FOUO badge above
  the actions in dark, and the actions "Create report" (teal, with icon) and
  "Briefing view" (outlined, with icon). The build shows "SITUATION /
  Overview", the incident name, "Not set · Live" and "Open context".

### Incident overview (frames 1 and 2)

- KPI row: four cards, each with a tinted circular icon, a label, a large
  number, a colored qualifier and a chevron: Open requests 24 (6 urgent),
  Active shelters 8 (312 occupants), Field reports 46 (9 unverified), Tasks
  due 12 (this operational period). The build has no KPI row.
- Common operating picture card: the map inside a titled card, with the
  incident boundary as a dashed cyan line, road closures as red lines with
  closure-point symbols, shelters open and planned, key facilities, the
  incident command post as a star, cameras, weather stations and a
  helibase; a legend panel; a layers panel with checkboxes (Roads,
  Incidents, Facilities, Shelters, Weather, Terrain); zoom controls; a north
  arrow; a scale bar in miles (and kilometers in light); in light, a
  location search, locate and fullscreen buttons. Basemap: satellite imagery
  in dark, shaded terrain in light (decision 1). The build's overview has no
  map; its Map screen is a separate page.
- Community Lifelines card: eight rows with icon, name, status dot and
  label, and a one-line description; in light a "Open workspace" link and
  row chevrons. The build shows "No matching board in this jurisdiction."
- Priority work card: a table (request or task, status with icon, owner,
  due), urgent in red, in-progress in amber; "View all".
- Recent activity card: a timeline of events with icon, time, title, text
  and author with organization; "View all".
- The build instead shows a "No saved incident overview" empty state and a
  legacy "EOC Status" dashboard.

### ESFs & Lifelines (frame 3)

- Header actions: "Compare periods" (outlined, chart icon) and "New
  assessment" (teal, plus icon). Tabs: Community Lifelines, ESF coordination,
  Dependencies, Assessment history. Filters: Incident area, Current period,
  All conditions.
- Cards: a 4 by 2 grid of condition-tinted cards (green, amber, red, gray)
  with a large outline icon, the name, a status pill (Stable, Stabilizing,
  Disrupted, Unknown), a headline, then Source (organization) and Assessed
  (time), each with an icon. The selected card has a teal outline.
- Detail drawer: icon, name, "Community Lifeline", status pill, "Assessed
  09:35 PDT · Utility liaison", the narrative, Affected components with
  icons, Stabilization objective, Next update, Linked actions with count and
  status chips, and the "Update assessment" (teal) and "View history"
  (outlined) buttons at the foot.
- Related ESF coordination: a table (Function, Activation, Coordinator, Open
  missions) under a "California framework" label.
- The build shows untinted cards with duplicated "Unknown" and "No current
  assessment" pills, titles broken mid-word ("Communicatio / ns") when the
  drawer is open, "FEMA framework · definition v1", an "ESF coordination"
  button in place of tabs, no filters, a drawer with Overview, Update
  assessment and History tabs and a history list, and no coordination table.
  The status label "unstable" shows where the frame says "Disrupted".

## 3. Units

Run one at a time in the canonical checkout: they all touch the shell and the
design kit, so parallel lanes would collide.

| Unit | What | Acceptance |
|---|---|---|
| DF0 | Reference scenario and comparison harness. A seed that builds "North Coast Storm · Exercise" through the real API: the Humboldt Bay incident area, operational period OP 03 0600-1800 PDT, seven participating organizations, 24 resource requests (6 urgent), 8 open shelters with 312 occupants, 46 field reports (9 unverified), 12 tasks due this period, lifeline assessments with the frames' statuses, sources, times and text, the road closures, shelters, facilities, command post, cameras, weather stations and helibase at the frames' places, the priority work items and the recent activity. A browser harness captures each screen at 1586 by 992 in both themes and writes a side-by-side image with the frame. | The three side-by-side images exist and are reproducible from one command. |
| DF1 | Shell. Brand block, command bar, rail and page header as section 2 lists, in both themes, from the design kit. Existing controls keep their function: the incident, period and position selectors become the frames' chips; address search moves where decision 3 places it. | Shell regions match the frames side by side; keyboard, axe and reduced motion as before. |
| DF2 | Incident overview composition as the default overview: KPI row, COP card, Community Lifelines card, Priority work card, Recent activity card, Create report and Briefing view, wired to the real engines. Briefing view is a read-only full-screen presentation of the same overview. Truthful empty and unknown states use the frames' visual language. | Frames 1 and 2 match side by side with the scenario loaded. |
| DF3 | COP cartography in the card and on the Map screen: boundary, closure lines and points, the symbol set, legend, layer toggles, scale, north arrow, controls, and the basemap per decision 1. | The map regions of frames 1 and 2 match side by side. |
| DF4 | ESFs & Lifelines workspace per frame 3: header actions, tabs, filters, tinted cards, drawer, coordination table, the "Disrupted" label, and the model fields the drawer shows that the engine lacks (next update time; stabilization objective as its own field if the outlook is not it), with a migration and real-database tests. The mid-word title break is fixed. | Frame 3 matches side by side; dark follows frame 2's language. |
| DF5 | Every other screen re-checked against the shell and card language after DF1 to DF4 (Map, Boards, Resources, Incident Setup, Reports, Mass Notification, Administration, Smart Forms and the rest), with the D33 review walk re-run. | No screen breaks the frames' shell or card language; the D33 walk is green. |
| DF6 | Fidelity gate: the side-by-side images, a region checklist per frame with every remaining difference and its reason, the full serial suite, then Basho's review. | Basho accepts, or names what still differs; that goes back into DF1 to DF4. |

## 4. Decisions, answered by Basho on 2026-09-24

1. **Basemap imagery and terrain: download authorized for the North Coast.**
   Frame 2 shows satellite imagery and frame 1 shaded terrain; the tree has
   neither. Public-domain imagery (USDA NAIP through the USGS National Map)
   and elevation for hillshade (USGS 3DEP) for the North Coast are fetched and
   packed into offline PMTiles archives.
2. **Brand subtitle: "PEOPLE · INFORMATION · SAFER COMMUNITIES"**, as in the
   light overview frame, in both themes.
3. **Destinations the frames do not show: keep all, styled exactly as the
   frames' items, in their groups; the rail scrolls.**
4. **Frame annotations.** "DESIGN PREVIEW · SYNTHETIC DATA" and "Concept from
   Design PSPR · 21 Sep 2026" are notes on the frames, not product: not
   shipped. The FOUO marking stays.

## 5. Execution

On approval: STS, one unit at a time, each with a receipt in
`docs/process/V1-LEDGER.md`, commit and push per unit under the standing
grant, side-by-side images attached to each receipt, the full serial gate at
DF6. External actions (the imagery download) only as decision 1 allows.
