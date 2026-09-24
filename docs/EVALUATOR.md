# Evaluating OpenEOC

This page is for an EOC director or IT lead deciding whether to pilot
OpenEOC. It says what the product is and is not, what has been proven and how
strongly, what is still open, and how to try it.

It is a summary. The evidence is in the unit receipts of the
[V1 ledger](process/V1-LEDGER.md), cited here by their heading in quotation
marks, and the status of each capability is in the
[parity matrix](VEOC-PARITY-MATRIX.md). Where this page and those documents
differ, they are right and this page is out of date.

The current version is `0.9.0`, an evaluation build. It is not version 1.0,
and no release has been tagged.

## What OpenEOC is

- A virtual emergency operations center: boards, incidents, ICS positions and
  forms, a map-led common operating picture, notifications, reports, damage
  assessment, resources, JIC review, an audit chronology, federation between
  jurisdictions, and field forms that work offline.
- A web application served by one Node process with one PostgreSQL and
  PostGIS database. It is packaged for a Linux host with Docker and for a
  Windows computer as a desktop application.
- Open source under Apache-2.0. There are no seat licenses, and read-only
  viewers cost nothing.
- Built on the standards an EOC exchanges: CAP, EDXL, CoT, HAVE and GeoJSON.

## What it is not

- **Not public.** Everything in it is treated as For Official Use Only. Every
  read needs an account in the jurisdiction or a time-limited guest grant for
  a mutual-aid partner. There is no anonymous view, public map or public
  intake form.
- **Not more than one server process.** Version 1 is declared single node: one
  API process against one database. Running several behind a load balancer is
  not supported. See
  [One application node](../deploy/README.md#one-application-node).
- **Not a native mobile app.** Phones and tablets use the web app in the
  browser. The field screens keep working offline and send queued work when
  the connection returns; see the [field user guide](guides/FIELD-USER.md).
  The web app installs to a home screen and starts without a connection
  ("V1 W4.10: progressive web app"); it was proven in desktop Chrome, not yet
  on a phone.
- **Not certified or accredited.** The jurisdiction that runs it is
  responsible for its own authority to operate. See
  [Releases and support](../GOVERNANCE.md#releases-and-support).
- **Not a certified WebEOC replacement.** A `verified` row in the parity matrix
  means a technical gate passed at the depth assessed, not commercial parity.
- **Not everything on by default.** Collaboration channels, meetings, tracking
  and facilities are optional integrations, off unless the server's
  `OPENEOC_INTEGRATIONS` setting names them. Tracking and facilities are not
  reviewed for patient-level data. See
  [Optional integrations](../README.md#optional-integrations) and
  [ADR-0009](adr/ADR-0009-optional-integrations.md).

## What has been proven

Each receipt states its evidence level:

- **unit** and **integration**: automated tests of the code and of modules
  working together;
- **real-database**: tests against a real PostgreSQL and PostGIS server, not a
  stand-in;
- **browser**: a scripted Chrome walk through the real screens;
- **document**: a written procedure or decision that was not run.

All of it was produced by the project on its own machines with synthetic data.
None of it comes from a live deployment, a pilot, or operators outside the
project.

| Area | What was shown | Evidence level | Receipt |
|---|---|---|---|
| Boards, notifications and reporting against WebEOC | A 17-task side-by-side script run through the real screens on real PostgreSQL: build a board, enter and edit records, filter and group, export, import WebEOC records, record history, email and SMS rules, contacts and mass notification, and saved reports as PDF and Excel on a schedule | real-database, browser, document | "V1 W4 gate: parity reconciliation and the WebEOC side-by-side" and the [side-by-side script](WEBEOC-SIDE-BY-SIDE.md) |
| Moving records from WebEOC | An importer for WebEOC's CSV board export, with a dry run and a rejection report. Records only, not processes | unit, integration, real-database, browser, document | "V1 W4.4: WebEOC migration" |
| Email and SMS | Email through a local test relay; SMS through a fixture provider that records each message and sends nothing; contacts, groups, delivery receipts and call-down | unit, real-database, browser, document | "V1 W4.0 part one: email and SMS channels" and "V1 W4.0 part two: contacts and mass notification" |
| Sign-in | Two-step sign-in with an authenticator app, required for every administrator | unit, real-database, browser | "V1 W2.10: MFA" |
| IPAWS | Configuration, the MOA acknowledgement, the enable switch, and a send that a second administrator must confirm, walked against a local stand-in for IPAWS-OPEN | unit, integration, browser, real-database | "V1 W2.7: threat-model controls" and "V1 W3.5: IPAWS enablement and send" |
| Administration | People, roles, positions, guest access, retention periods and audit export on screen, without the command line | unit, real-database, browser, document | "V1 W3.0: administration" |
| Audit trail | An append-only chronology with filters, corrections and export; retention purges that never touch the audit trail | unit, integration, real-database, browser, document | "V1 W2.9: retention and export" and "V1 W3.1: audit chronology" |
| Load | A two-hour synthetic activation with 150 connected users: 71,106 edits, 0 errors, memory flat. On a development workstation, not deployment hardware | a measured run on real PostgreSQL | "V1 W2 milestone gate" |
| Upgrade and restore | A backup forced before every upgrade; a restore drill of 13,831 rows in about 3 seconds on the test database. No real upgrade has been run on either deployment path | unit, real-database, document | "V1 W6.1: versioning and upgrade" |
| Docker install | The install script tested against stand-ins for Docker and the download tool. No image built, no certificate issued, no run on a Linux host | unit, document | "V1 W6.0: one-command server install" |
| Windows desktop | Cold setup, the local map, row-level security at runtime, offline work recovery and restart, on the one prepared machine where it was built | a prepared-machine run | Parity matrix row AR7 |
| Field forms | Offline forms with line and polygon capture, photo, audio and barcode questions, cascading selects and repeats | unit, integration, real-database, browser, document | "V1 W4.7: field depth" |

## What remains open

### Inputs the project cannot supply itself

- **Live IPAWS.** No alert has gone to IPAWS-OPEN. That needs IPAWS-OPEN test
  credentials and a signed Memorandum of Agreement with FEMA. See
  [IPAWS enablement](IPAWS-ENABLEMENT.md).
- **150 users on real hardware.** The load run above used a development
  workstation. A run on deployment hardware, on the release candidate, is not
  recorded.
- **Representative operators.** No EOC staff from outside the project have
  compared their current workflow with OpenEOC.
- **A pilot jurisdiction.** None is named, and OpenEOC has not supported a
  real activation anywhere.
- **Install on a second machine.** The Windows path is proven only on the
  prepared machine where it was built. Moving it to another computer on
  removable media and setting it up there is not proven. The Docker install
  has not run on a Linux host.
- **Screen reader.** The manual pass with NVDA and VoiceOver has not been run.
- **A second maintainer.** The project has one maintainer. See
  [Second maintainer](../GOVERNANCE.md#second-maintainer).

### Limits in the product today

- The internal side-by-side run recorded
  [the gaps it found](WEBEOC-SIDE-BY-SIDE.md#gaps-the-run-found). Five have
  since been closed: the board list after a new board is created, creating a
  board from a published template, managing a notification rule, the wording
  of rule messages, and status labels. Still open: the channels (no voice;
  Teams and Slack only as a generic webhook). That document keeps their current state, and the
  [limits carried from the receipts](WEBEOC-SIDE-BY-SIDE.md#boundaries-carried-from-the-receipts).
- Edits and deletes of incident records are not sent to federation partners
  (parity row F3).
- There is no SAML sign-in. OIDC sign-in is available; SAML waits on an
  identity provider that needs it (row G-MFA).
- Live external data is not connected: FEMA flood zones, a statewide shelter
  feed, census population, parcels for other counties and live sensor feeds.
  The partial rows of the parity matrix name each source.
- The integrated exercise with several organizations in one incident has not
  been run (row R3).

The [changelog](../CHANGELOG.md) lists the known limits of each build.

## How to try it

Use synthetic data only. The [demonstration scenario](DEMO-SCENARIO.md)
describes the synthetic county, incident and exercise accounts.

- **On Windows, with demo data.** Follow
  [Windows desktop setup](WINDOWS-DESKTOP.md) to build from a source checkout,
  then run `Setup` and `Start` with `-Profile demo`. The demo profile seeds the
  synthetic incident and listens on `127.0.0.1` only. It needs the local
  toolchain the guide lists, including PostgreSQL with PostGIS. No installer is
  published yet.
- **On a Linux server with Docker.** Follow
  [the deployment guide](../deploy/README.md). `install.sh` is built to end at
  an HTTPS sign-in page for your first administrator. It has been tested only
  against stand-ins, so report what a real run does. This path has no demo
  data: it starts with the first jurisdiction and its administrator. Without
  map archives, the map shows the bundled California basemap and address
  search is unavailable.
- **As an exercise.** The [training kit](guides/training/README.md) has a
  tabletop exercise on the synthetic incident, a job aid for each position and
  an instructor outline.
- **Against WebEOC.** If your EOC runs WebEOC, run the
  [side-by-side script](WEBEOC-SIDE-BY-SIDE.md) in both systems and record the
  results.

## Reporting problems

- Bugs, gaps and questions: open an issue on the project's GitHub repository.
  Give the version from `GET /api/v1/health`, the deployment path and the
  steps, using synthetic data only.
- Security vulnerabilities: do not open a public issue. Follow the
  [security policy](../SECURITY.md).
- Support is community support through GitHub issues; there is no paid
  support. See [Releases and support](../GOVERNANCE.md#releases-and-support).
