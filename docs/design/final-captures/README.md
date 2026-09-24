# Final reference captures

Eleven screenshots of the console as it stood at the release decision, kept
as the reference captures the design reconciliation asks for. They are
evidence of what the build shows, not Basho's acceptance of it; the
[canonical references](../canonical-references/README.md) remain the visual
authority.

## Where they come from

- **Build:** the lane run of the remaining interface findings, the build that
  landed as `8c0081b`.
- **Walk:** `server/src/__tests__/d33-review-browser.test.ts`, the review walk
  on the real build and PostgreSQL, run in Chrome on 2026-09-24. It signs in,
  opens each view in light and dark at 1440 and 390 wide, and runs the
  automated accessibility checks on every screen. The full set, about 70
  images, is in the lane's ignored `browser-shots` directory; this is a
  curated eleven.
- **Data:** synthetic. The incident, boards, records and accounts are the
  walk's own fixtures, not operational data.

## What each shows

| File | Theme and width | What it shows |
|---|---|---|
| `review-overview-light-1440.png` | Light, 1440 | Overview: the command bar with incident, address search, period and acting position; the grouped navigation rail; the saved-dashboard empty state; the EOC Status tiles with the closed-roads count labelled "Watch" |
| `review-overview-dark-1440.png` | Dark, 1440 | The same Overview in the dark theme |
| `review-map-light-1440.png` | Light, 1440 | Map: the impact indicators waiting for the viewport, the layer panel with opacity sliders, the bundled California basemap with the USNG and MGRS readout and its attribution, and the context drawer with local work and the incident's boards |
| `review-map-dark-390.png` | Dark, 390 | The map on a phone width: compact command bar, the impact strip scrolling sideways inside its panel, the map controls |
| `review-board-light-1440.png` | Light, 1440 | Board detail on a 500-record board: filter, sort and group; CSV and Excel export and import; List, Kanban, Calendar and Chart; the operational table with a long record at the top |
| `review-record-dark-1440.png` | Dark, 1440 | The same board with a record selected: record detail, change history tab, attribution, history, and edit, archive, delete and files actions |
| `review-resources-light-1440.png` | Light, 1440 | Resources: request intake with resource kind, and a submitted request showing its labels, receiving organization and next action |
| `review-incident-setup-dark-1440.png` | Dark, 1440 | Incident Setup: activate from a scenario template, add a library, and the incident list with its actions |
| `review-reports-light-1440.png` | Light, 1440 | Reports with no saved reports yet |
| `review-mass-notification-dark-1440.png` | Dark, 1440 | Mass Notification: compose with email and SMS to a contact group, everyone at once |
| `review-sign-in-dark-390.png` | Dark, 390 | Sign-in on a phone width |

## What they still show that is open

These are Basho's review items, recorded in
[the D33 review](../D33-REVIEW.md) and the release decision:

- two primary button styles side by side: near-black in light and light grey
  in dark ("Submit request", "New report", "Send notification", "Sign in")
  beside teal ("New record", "Create saved view", "Edit record"), finding 15;
- "Unavailable" for an empty optional field in the board table, finding 18;
- no product mark on the sign-in screen, finding 25;
- the record detail shows the stored value "open" rather than its label,
  which the side-by-side gap closure left for change history and record
  detail.
