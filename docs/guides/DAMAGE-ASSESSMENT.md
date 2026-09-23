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

The **Accepted** and **Rejected** tabs list moderated reports and field
assessments. Each list shows the newest records first; **Load more records**
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

Enter the county population. The PA per-capita indicator starts at $4.60 and
the IA residence threshold at 25; replace them with the figures that apply to
the declaration request. FEMA publishes the per-capita indicator each fiscal
year. The screen remembers these three inputs on this browser only.

The summary shows counted structures by degree, the total estimated loss and
the loss on structures recorded as uninsured. Each indicator states the
measured value, the threshold, whether the threshold is met, and the basis of
the number:

- **Public Assistance per-capita indicator**: the estimated loss of counted
  structures divided by the population.
- **Individual Assistance residences**: destroyed plus major damage.

The per-capita figure is an early signal. Public Assistance cost estimates by
work category (A to G) are not recorded on this screen, so the figure is not
the Public Assistance cost that FEMA validates. FEMA makes the determination.

## Download the declaration summary

Enter the incident name and select **Download declaration summary**. The
server builds a Markdown document from the counted records: residences by
degree of damage, the destroyed or major count that is the IA basis, total and
uninsured loss, the population, the per-capita impact against the indicator,
and whether each threshold is met. The file is named
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
- Public Assistance categories A to G and shelter census are not recorded here.
