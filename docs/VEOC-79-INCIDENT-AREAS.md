# Incident operational areas

Open Incidents and choose Operational area on the relevant incident. An area
can remain undefined while response begins. Draw at least three points and
close the boundary, or import a GeoJSON Polygon or MultiPolygon (raw geometry
or one Feature, at most 1 MB and 10,000 coordinates). Imported holes and
disconnected polygons are preserved. Boundaries may cross administrative lines.

Enter an operational-period name and start/end together, or leave all three
blank. Input times use the displayed local timezone and are stored as UTC.
Enter a reason and save a revision. Each revision preserves geometry, period,
author, active position when present, and timestamp. History is read-only.
Viewing history does not replace the unsaved current draft.

Concurrent edits return a conflict and retain the draft. Reload the current
revision to discard the draft and work from the latest saved state. Closed
incidents retain history and reject revisions. Invalid or self-intersecting
geometry is rejected by the server and database.

GET/PUT /api/v1/incidents/:incidentId/operational-area reads or revises the
current snapshot. PUT requires expectedRevision, geometry (or null),
operationalPeriod (or null), and reason. GET on /operational-area/history
returns up to 50 revisions, newest first; beforeRevision pages older entries.
Revision zero means no saved area. Attribution comes from the authenticated
session, never from caller-supplied author fields.

At VEOC-79, owning-organization members can read and administrators can revise.
Explicit partner participation is VEOC-79A; shared workspace incident selection
is VEOC-79B. Geography does not enroll an organization or grant permissions.
Area editing currently requires a server connection; disconnected reconciliation
remains part of the later operational continuity gate.
