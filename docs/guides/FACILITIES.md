# Facilities and Shelters

The Facilities screen is the jurisdiction's facility status network: a
registry of hospitals, shelters and other facilities, a status board that
shows how current each facility's report is, hospital bed availability in the
EDXL-HAVE shape, shelter capacity and occupancy, and the facilities on a map.
Open it from **Operations > Facilities**. Members and administrators register
facilities and report status; viewers read the same screen without the forms.

## An optional integration

Facilities is an optional integration. The server registers its routes only
when the `OPENEOC_INTEGRATIONS` setting includes `facilities`, for example
`OPENEOC_INTEGRATIONS=facilities` or `OPENEOC_INTEGRATIONS=collab,facilities`.
The setting is read when the server starts, so restart it after a change. An
administrator can confirm which integrations are on under **Administration**.

When the integration is off, the console shows no Facilities entry, and a saved
link to the screen opens the page-not-found view.

## Register a facility

Under **Registry**, enter:

- **Facility name**.
- **Facility type**: hospital, long-term care facility, dialysis center,
  shelter, point of distribution, EMS agency, 911 center (PSAP) or other
  facility. These are the facility kinds of the status network dictionary.
- **Contact**, optional: who answers for the facility.
- **Report expected every (minutes)**: the reporting window. A facility with no
  report inside its window turns stale. The default is 60 minutes.
- **Longitude** and **Latitude**, optional: both or neither, in decimal
  degrees. A position places the facility on the map.

The registry table lists every facility with its contact, position and
reporting window. The server offers no edit or removal, so check the entry
before registering it. A new facility reads **No report yet** until its first
status report.

## Read the status board

The **Status board** lists every facility with its type, operating status, EMS
traffic, the time of its latest report and its freshness:

- **Current**: the latest report is inside the facility's reporting window.
- **Stale**: the latest report is older than the window. The facility may
  still be operating as reported; ask it to report again.
- **No report yet**: the facility has never reported.

The server decides freshness against each facility's own window, so an hourly
hospital and a shelter that reports every two hours can read differently for
reports of the same age. **Refresh** reads the board again.

## Report status

Under **Report status**, choose the facility and set:

- **Operating status**: normal, compromised, evacuating or closed, the EDXL-HAVE
  facility status values.
- **EMS traffic**: accepting, conditional, on divert, or not reported.
- **Bed availability** for hospitals and other facilities: for each bed type,
  the number available now and the staffed baseline. Leave a row blank to
  leave that bed type out of the report.
- **Shelter spaces** for shelters: the open spaces and the capacity. The
  server stores them as the EDXL-HAVE "other" bed type.
- **Note**, optional.

A report becomes the facility's current status and answers any open status
request for that facility.

## Ask facilities to report

Under **Status requests**, write the request and choose whom to ask: every
facility, or every facility of one type. **Send status request** tells you how
many facilities were asked. Each request sent from the screen then shows how
many have reported, or **All reported**, and names the facilities still
outstanding. A facility answers with its next status report, from the screen
or the API. **Refresh**, or any report, reads the answers again. Members and
administrators send requests.

## Hospital bed availability (HAVE)

Each hospital shows its operating status, freshness, EMS traffic, the time of
its latest report and a table of the bed counts from that report. **Download
EDXL-HAVE** saves the hospitals' current picture as an EDXL-HAVE 2.0 XML file
for partners that consume the standard. The file carries each hospital's
status, EMS traffic, bed counts, report time and a stale flag. It does not
carry contacts or positions.

## Shelters

The **Shelters** table shows each shelter's status, capacity, occupied spaces
and open spaces from its latest report, with the report time and freshness.
Occupied is capacity minus open spaces. A shelter that has not reported spaces
reads **Not reported**.

## Facilities on the map

Facilities with a position appear on the map inside the screen. Hospitals and
shelters draw their NAPSG facility symbol; other facility types draw a plain
marker. The frame color follows the operating status: normal is green,
compromised is the warning color, evacuating and closed share the critical
color, and a facility with no report is unknown. Select a facility, or find it
by name with **Find on map**, to read its type, status and whether its report
is current. The NAPSG symbols are used under CC BY 4.0 and credited on the
map.

## Limits

- Registry entries cannot be edited or removed from the screen or the API.
- The server keeps no list of status requests, so the screen follows only the
  requests sent from it until the page is left.
- The screen shows the latest report for each facility; the server keeps the
  earlier reports.
