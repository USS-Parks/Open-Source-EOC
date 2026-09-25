# Damage Assessment

The Damage Assessment screen supports a preliminary damage assessment for the
selected jurisdiction. Open it from **Operations > Damage Assessment**. Members
and administrators moderate reports and record field assessments; viewers read
the same screen without the controls that change it.

## What counts

Two kinds of record reach the screen:

- **Public reports** arrive through the public intake and wait in the
  **Intake queue**. They count only after a moderator accepts them.
- **Field assessments** are recorded by a member or administrator. They are
  authoritative and count as soon as they are saved.

The loss summary, the declaration indicators, the download and the map read
only accepted reports and field assessments. A report in the queue or a
rejected report never moves those numbers.

Public Assistance line items are a third kind of record, kept on the
**Public Assistance** tab. Submitted and reviewed items count toward the PA
totals, the per-capita indicators and the download; drafts do not.

## Moderate the intake queue

Each queued report shows the address, the degree the reporter chose, the
structure, the estimated loss, the reporter contact when one was given, and
when it arrived.

- **Accept** counts the report as reported.
- **Reject** keeps it out of every total.

A decision is final; a moderated report cannot be reopened. The screen has no
"needs more information" state. When a report is incomplete, use the reporter
contact to follow up before deciding. When a report names the wrong degree,
reject it and record a field assessment with the verified degree.

The **Accepted** and **Rejected** tabs, beside the queue under **Reports and
Public Assistance**, list moderated reports and field assessments. Each list shows the newest records first; **Load more records**
reads the next page from the server. **Refresh** reads the queue again when new
public reports may have arrived.

## Record a field assessment

Enter the address, degree of damage, structure type, occupancy, insurance and
estimated loss. Longitude and latitude are optional and place the structure on
the map. The degrees follow the FEMA Preliminary Damage Assessment Guide:

| Degree | Meaning |
|---|---|
| Destroyed | Total loss, or not economically feasible to repair |
| Major damage | Significant structural damage that needs extensive repair |
| Minor damage | Uninhabitable now, but repairable in a short time |
| Affected | Minimal damage; habitable without repair |
| Inaccessible | Could not be reached to assess |

## Loss summary and declaration indicators

Every figure here is entered by the operator; the screen holds no population
data and no published indicator values. Enter the county population. The
county PA per-capita indicator starts at $4.60 and the IA residence threshold
at 25; replace them with the figures that apply to the declaration request.
The state population and the statewide PA per-capita indicator are optional
and have no default; enter both to add the statewide indicator, or leave both
empty. FEMA publishes the per-capita indicators each fiscal year. The screen
remembers these inputs on this browser only.

The summary shows counted structures by degree, the total estimated loss and
the loss on structures recorded as uninsured. Each indicator states the
measured value, the threshold, whether the threshold is met, and the basis of
the number:

- **Public Assistance county per-capita indicator**: the per-capita amount
  divided by the county population.
- **Public Assistance statewide per-capita indicator**, when the statewide
  figures are entered: the same amount divided by the state population.
- **Individual Assistance residences**: destroyed plus major damage.

The per-capita amount is the counted Public Assistance cost, categories A to
G, once any submitted or reviewed line item exists. Until then it is the
estimated loss of counted structures, and the basis says "Structure loss, not
Public Assistance cost". Either way the figure is an early signal; FEMA
validates the figures and makes the determination.

## Public Assistance

The **Public Assistance** tab under **Reports and Public Assistance** holds the
PA damage inventory. Each line item names the applicant (a public entity or an
eligible private nonprofit), the FEMA work category, the site, the work, the
estimated cost, insurance, percent complete and a status. The categories
follow the FEMA Public Assistance Program and Policy Guide:

| Category | Work |
|---|---|
| A | Debris removal |
| B | Emergency protective measures |
| C | Roads and bridges |
| D | Water control facilities |
| E | Buildings and equipment |
| F | Utilities |
| G | Parks, recreational and other facilities |

The status is **Draft**, **Submitted** or **Reviewed**. A new item starts as
Submitted. Drafts are listed but do not count; set a draft to Submitted when
its estimate is ready.

The tab shows the counted cost in each category and the total, the per-capita
indicators with their basis, and the line items newest first with **Load more
records** for the next page. Members and administrators record an item with
**Record line item** and change one with **Edit** on its row, then **Save
changes**; an edit replaces every field of the item. Longitude and latitude are
optional. Viewers read the tab without the form. A line item can be linked to
an incident of the jurisdiction through the API (`incidentId`); the screen does
not show or change that link, and an edit keeps it. Line items are records:
there is no delete and the retention purge does not remove them.

## Force account

With an incident selected, **Force account** costs the jurisdiction's own
labor and equipment on it, for Public Assistance. Administrators and members
see it; viewers and guests do not, since it shows wage rates.

- **Labor** is one row per person per day, from each closed check-in on the
  incident and each past shift on the incident assigned to someone that none
  of their check-ins overlaps. A check-in still open is left out until it
  closes. Days are cut at midnight in the browser's time zone, which the
  panel names. Each day's hours are split into regular and overtime at the
  person's overtime threshold (8 hours unless set otherwise). The summary
  keeps them apart and decides nothing about eligibility: under the Public
  Assistance Program and Policy Guide, straight time of budgeted staff on
  emergency work (Categories A and B) is not eligible.
- **Labor rates** are set by an administrator per person: job title, hourly
  rate, an optional overtime rate, fringe benefits as a percent (and an
  optional overtime fringe percent) and the overtime threshold. A person with
  hours and no rate is listed under **Set a rate for**, and their rows cost
  nothing until one is set.
- **Equipment rate schedule.** An administrator imports FEMA's Schedule of
  Equipment Rates, or local rates, from a CSV file with the schedule's Cost
  Code, Equipment, Specifications, Capacity or Size, HP, Notes, Unit and rate
  columns (Manufacturer is read when present), and names the edition, such
  as "FEMA 2025". A code already imported is replaced. FEMA publishes the
  2025 schedule as a PDF (for declarations on or after July 1, 2025) and
  earlier schedules as CSV; copy the 2025 table into a spreadsheet and save
  it as CSV with those headings. The product ships with no rates.
- **Record equipment hours** logs a use: the pool resource (or none), the
  rate code, the operator, the date and the hours (or miles, for a rate by
  the mile). A use recorded in error is removed with **Remove**; the audit
  keeps it.
- **Download labor summary** and **Download equipment summary** save CSV
  files in the layout of FEMA's Force Account Labor Summary Record and Force
  Account Equipment Summary Record, each ending on the panel's total.
- **Roll into line item** makes a Public Assistance line item's estimated
  cost the force account total and keeps the summary it came from; the
  counted totals on the **Public Assistance** tab follow. It is refused while
  anyone with hours or any code used has no rate, and a line item of another
  incident is refused.

## Shelter census

When the server runs the facilities integration, the declaration summary
carries a shelter census read from **Operations > Facilities**: the latest
report from each registered shelter, with capacity, occupied and open spaces
per shelter and in total, and the time of each report. A shelter that has not
reported is listed as having no report yet. When the integration is off the
summary says that the shelter census is not available; it never shows numbers
in its place.

## Download the declaration summary

Enter the incident name and select **Download declaration summary**. The
server builds a Markdown document from the counted records: residences by
degree of damage, the destroyed or major count that is the IA basis, total and
uninsured loss, the counted Public Assistance cost by category with the total,
the basis of the per-capita figures, the operator-entered populations and
indicators with the per-capita impact against each, the shelter census, and
whether each threshold is met. The file is named
`declaration-support-YYYY-MM-DD.md`.

## The map

The map on the screen shows accepted reports and field assessments that carry
a position, colored by degree:

- Destroyed and major damage use the critical color.
- Minor damage uses the warning color.
- Affected uses the normal color.
- Inaccessible uses the unknown color.

Destroyed and major damage share a color because the map uses the same five
status colors as the rest of the console; select a point or use **Find on map**
to read its degree. Records without a position are counted in the status line
above the map. The map shows the newest 500 counted records. **Home** and
**Zoom to extent** in the map tools frame the reports.

## Public report intake

Administrators see **Public report intake**. **Issue intake token** creates the
token a public reporting form or 311 system uses to send reports to
`POST /api/v1/jurisdictions/{jurisdiction}/damage/report` with the token in the
`x-intake-token` header. The token is shown once. Issuing a new token replaces
the previous one, and reports sent with the old token are refused. The server
accepts at most 30 public reports per jurisdiction per minute.

## Limits

- Moderation is accept or reject only; there is no "needs more information"
  state and no way to change the degree on a public report.
- Pre-disaster baseline import (assessor parcel rolls) is available through the
  API to administrators, not on this screen, and baselines do not yet feed the
  loss summary.
- Public Assistance line items cannot be deleted. The line item form does not
  link an item to an incident; rolling a force account into an item links it
  to that incident.
- The force account does not cost materials, rented equipment or contract
  work (FEMA's other summary records), and labor comes only from check-ins
  and shifts on the incident.
- The shelter census reads the latest report of each shelter as it stands; it
  does not mark a stale report. Check freshness on the Facilities screen.
