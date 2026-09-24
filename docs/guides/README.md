# Role Guides

These guides explain the current OpenEOC screens by responsibility. They are
contextual documentation; the application remains the authority for the actions
your current session may perform.

Start every workflow by checking the command bar:

- organization
- incident
- operational period
- position or participation
- connection and synchronization state

A value from another incident, period, person, or organization is not a usable
substitute. Re-select context before acting.

## Choose a guide

| Role or task | Guide |
|---|---|
| Read the current authorized picture | [Viewer quickstart](./VIEWER-QUICKSTART.md) |
| Coordinate incident work | [Operator quickstart](./OPERATOR-QUICKSTART.md) |
| Configure people, incidents, and integrations | [Administrator guide](./ADMIN.md) |
| Capture field reports and assigned completions | [Field user guide](./FIELD-USER.md) |
| Moderate damage reports and prepare declaration support | [Damage assessment](./DAMAGE-ASSESSMENT.md) |
| Track facility and shelter status, hospital beds and shelter capacity | [Facilities and shelters](./FACILITIES.md) |
| Build, run, download and schedule reports over boards | [Reports](./REPORTS.md) |
| Train staff with job aids and a tabletop exercise | [Training kit](./training/README.md) |
| Create or revise board schemas | [Board designer guide](./DESIGNER.md) |
| Move records from WebEOC | [WebEOC migration](./MIGRATION.md) |
| Configure federation | [Federation setup](./FEDERATION-SETUP.md) |

The [synthetic incident demonstration](../DEMO-SCENARIO.md) provides a guided
exercise with current, stale, unknown, missing, and partially complete data. It
labels external integration prerequisites instead of simulating delivery.

## State language used throughout the application

- **Saved locally** or **queued** means the current device retained work. The
  server has not necessarily received it.
- **Synchronizing** means a transfer is in progress.
- **Synced** or an authoritative receipt means the server accepted that exact
  operation.
- **Failed** means the client has no verified acceptance receipt. The server
  may have rejected the operation, or a response may have been lost; retained
  work stays available where the workflow supports recovery.
- **Conflict** means competing versions need an explicit resolution.
- **Stale** means last-good information is retained but is older than expected.
- **Unknown** is a reported condition. **Missing** means no usable authorized
  source currently supports a value.

## Getting help safely

Capture the page name, selected incident and period, visible error text, and
whether the item is queued, failed, or conflicted. Do not include protected
record contents in an unapproved support channel. An administrator can verify
membership, incident participation, position assignment, and source health
without asking you to share credentials.
