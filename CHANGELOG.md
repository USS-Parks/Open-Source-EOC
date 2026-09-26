# Changelog

Notable changes to OpenEOC, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every package in
the repository carries the same version. How to upgrade, and which databases
upgrade in place, is in the [upgrade guide](docs/guides/UPGRADE.md).

## 0.9.9 - 2026-09-25

An evaluation build, not tagged. The Windows setup
`Open-Source-EOC-Setup-0.9.9.exe`, the ZIP of its staged folder, the map
data packet and the macOS disk image are built from the commit that sets
this version and stand beside the `0.9.2` builds. Since 0.9.2 the rest of
the Veoci Integration and Air Gap PSPR landed on `main` (VA6 to VA39), with
the IPAWS-OPEN connector rebuilt to FEMA's Interface Design Guide (IC1 to
IC3) and the follow-ups and corrections the units' reviews found. Each
change is described in its ledger receipt, cited here by its heading's unit;
`RELEASE-DECISION.md` lists what this build holds, what has not been run
and the decisions left to the project lead. Upgrading applies migrations
`0155` to `0168` in place; `0168` numbers every board record for the Esri
view, which touches every record once.

### Added

- Incident templates authored and versioned on screen, and ad hoc tasks on
  the Tasks screen (VA6). Activation notifies chosen contact groups and
  positions, and rules address groups, positions and whoever is on shift
  (VA7). Mass sends can carry response options (VA8).
- A signature field and QR codes for badges and pool resources (VA9); a
  license gate for denied and review licenses (VA10); signed solution
  packages carrying templates, forms, dashboards, reports and rules (VA11),
  with a small EOC starter pack (VA12) and a hotline and shelter
  registration pack (VA29).
- Executable plans that activate an incident, release tasks on schedule and
  remind reviews (VA13), continuity of operations plans with essential
  functions and succession (VA27), and after-action corrective actions
  linked to plans, with due-date reminders (VA30).
- FEMA Public Assistance force account from check-ins, shifts and pool hours
  (VA14), and a volunteer and CERT roster with credentials, deployments and
  hours (VA28).
- Workflow guards and per-state read-only fields (VA15), a declarative
  action catalog on boards (VA25), all-or-any conditions with day and
  case-blind operators and every view option in the designer (VA26), charts
  in reports and create-record dashboard tiles (VA31).
- The incident room: dashboards, threads, contact groups and file folders
  opened from the template (VA16); an import report for every import that
  writes, and a people import (VA17); a rollout playbook and self-paced
  modules (VA18).
- Exchange across the gap: signed peer identity and agreement revocation
  (VA19), exchange of a shared board by signed file (VA20), text messages
  through a phone on the site network and printed call-down sheets (VA21),
  and field work queued offline, boards with record rules synced per record
  and late submissions kept for a closed incident's administrators (VA22).
- ICS forms 201 to 215A as components of the operational period, the IAP
  assembled and approved from them (VA37), and the ICS 213RR from a resource
  request (VA38).
- An OpenAPI document and scoped, revocable service identities (VA32), a
  read-only ArcGIS FeatureServer view of boards and Esri JSON import (VA33),
  an optional device PIN that encrypts offline work on shared devices
  (VA34), region map packets carried in by checked file (VA35), and each
  position's job aid in the console, offline (VA39).
- Procedures with result templates for phones on a host's authority (VA23)
  and the disconnected drill (VA24); the air-gap proof gained a mode that
  runs every optional integration against local stand-ins.

### Changed

- The IPAWS-OPEN connector follows FEMA's IPAWS-OPEN Interface Design Guide
  v4.02. The alert and the SOAP request are both signed with the COG
  certificate (WS-Security, RSA-SHA256, exclusive canonicalization), the
  request carries `logonUser` and `logonCogId` in the IDG's namespace, and
  the alert's `sent` is stamped at the second admin's confirmation. The COG
  credential is now the FEMA certificate and private key as one PEM block,
  checked when saved and before every send. Each send records every
  channel's status and the signed alert as transmitted, and the IPAWS tab
  shows which channels acknowledged and which refused. See
  [IPAWS-ENABLEMENT](docs/IPAWS-ENABLEMENT.md). A PIN stored by an earlier
  build no longer configures IPAWS; enter the certificate.
- Records written through sync, including offline edits replayed on
  reconnect, run their board's actions as a REST write does.
- A Windows install trusts package publishers from
  `trusted-template-keys.pem` in its profile folder.
- Case-blind board conditions use PostgreSQL's ICU collation `und-x-icu`,
  which the Windows runtime and Postgres.app carry.
- The Windows host's Caddy log replaces tokens in request addresses and
  deletes token headers.

### Fixed

- An IPAWS-OPEN answer of HTTP 200 that flagged a channel as an error was
  read as accepted. Acceptance now needs every channel status free of
  errors, and any answer the connector does not recognize is a rejection.
- Editing a corrective action without changing its due date moved the date
  a day earlier on a database west of UTC.
- A refused upload could leave its staging file on Windows.
- A workflow transition beside a record write on the same incident could
  deadlock.
- The record pane lost its tab on every refresh of the record.
- A map field's own read level was not applied on the map, the OGC items
  and the vector tiles.

## 0.9.2 - 2026-09-25

An evaluation build, not tagged. The Windows setup
`Open-Source-EOC-Setup-0.9.2.exe` is built from the commit that sets this
version and stands beside the `0.9.1` and `0.9.0` setups. Since 0.9.1 the
Operator Trust PSPR's units landed on `main` (request receipt and
acceptance, my work, shift handoff, durable drafts, information state,
partner invitations and preview, incident close and reopen, upgrade
reports, map to record, connecting to a host, and the open engineering
list), with the reads that slowed under load made flat (ledger receipt
"Readiness RD4 follow-up: reads that slowed as the incident filled"). The
build also carries the Veoci roster's first units and the exercise scenario
kit landed on `main` by 2026-09-25. The setup's SHA-256 is in the receipt
"Version 0.9.2: the Windows setup".

## 0.9.1 - 2026-09-25

An evaluation build, not tagged. The version is set so the Windows setup
built on this date, `Open-Source-EOC-Setup-0.9.1.exe`, stands beside the
earlier `0.9.0` setup, which is kept as the build to go back to. The
`0.9.0` setup rebuilt on 2026-09-24 already held everything below, the three
frames' look and the North Coast Storm demo (ledger receipt "Readiness RD2
part two: the Windows setup"). The `0.9.1` setup adds the Operator Trust
PSPR's work, built from the working tree before those units land; each is
described in its ledger receipt as it lands, and the setup's SHA-256 is in
the receipt "Version 0.9.1: the Windows setup".

### Added

- The network host. Installed for all users, the Windows setup offers **Host
  for the network**: PostgreSQL, the server and Caddy run as Windows
  services, Caddy serves HTTPS with a certificate authority the host creates,
  the sign-in page offers that authority for other devices to trust, a
  firewall rule opens ports 80 and 443 to Caddy, and a scheduled task backs
  the host up daily. The host holds a new operational database or the North
  Coast Storm demonstration. `Test-OpenEOCHost.ps1` checks an installed host;
  uninstalling removes the services, rule, task and trust and keeps the data.
  See the [network host guide](docs/guides/NETWORK-HOST.md).
- The Windows setup's demo is the North Coast Storm exercise the design
  frames show, with a desktop shortcut and an option to open it when setup
  finishes; its synthetic accounts sign in with a password, and every screen
  is marked "Demonstration · Synthetic data". The setup carries the official
  Node and PostgreSQL runtimes with their license texts and the North Coast
  imagery and elevation.
- The console's three dashboards match the canonical frames: solid glyphs,
  the frames' twelve-section rail (every section one setting away), each
  theme's brand mark, the light map's terrain, and the lifelines drawer as
  drawn.
- A board can be created from an already published template on the Templates
  screen, and a new board appears in Boards and in the rule and report pickers
  without a reload.
- Notification rules are listed, paused, changed and removed on the
  Notifications tab.
- The web app installs from the browser and opens without a connection after
  one visit: a service worker keeps the shell, every screen's code and the
  bundled basemap, and a notice offers a new version with Reload. A saved
  session is kept through a lost connection.
- A disaster recovery runbook with recovery targets, a daily scheduled backup
  with retention (`-Action Backup` in the Windows launcher, run by a scheduled
  task), and guidance for copies kept off the computer.
- Reduced motion and higher contrast: animations and transitions stop under
  the reduced-motion preference and the map jumps instead of flying; stronger
  text, border and focus colors under the higher-contrast preference; focus
  stays visible under forced colors. The accessibility guide carries a
  screen-reader test script.
- A security policy, a release and support statement, the second-maintainer
  requirement and an evaluator's page.
- A screen whose code fails to load shows an error with "Reload page" and
  leaves the rest of the console working.

### Changed

- Rule emails, texts and in-app notices use the board title, the record's
  first text field, and field and value labels.
- Stored choice values show as labels in board lists, group counts and
  reports on screen, in PDF and in Excel. Exports keep the stored codes.
- Activating an incident titles each board with the incident name and the
  template title. Boards activated earlier keep their titles.
- Resources shows labels for request state, priority and next action.
- Inline styles moved into the design kit's classes. Polling keeps data on
  screen during a refresh, pauses while the page is hidden and backs off
  after failures.
- The Windows setup asks whether to install for the current user or for all
  users; per user remains the default and installs where it did before.
- The Windows installer takes its version from the root package, stops when
  an archive it was asked to include is missing, ships the icons the service
  worker needs and the address search gazetteer, and leaves test sources out.
- Focus rings on the command bar and rail, input and select borders and the
  dark theme's strong border color now hold 3:1 contrast.
- On a phone or tablet the context drawer is a modal dialog, and opening or
  closing it there no longer changes the saved desktop layout. Loading notes
  are announced to screen readers.

### Fixed

- A mutual-aid partner could not post a field impact from the map.
- Another incident's boards appeared in the dock, the board list and the map
  layers; the incident selector did not follow a new activation; the map's
  record panel stayed blank when its form failed to load.
- The board designer showed the old version after publish and apply.
- Plain buttons showed half faded after a theme switch in the dark theme;
  report tables cut their last heading on a phone; the map's search icons
  dropped over the results list.
- The automated walk of the two-organization exercise waited on a map zoom
  that could frame too little, and passed an option vitest does not accept.

### Removed

- The Linux and Docker deployment path: the Compose stack, `install.sh`,
  `upgrade.sh`, `backup.sh`, `restore.sh` and `schedule-backup.sh`. Open
  Source EOC runs on Windows and macOS machines
  ([ADR-0010](docs/adr/ADR-0010-windows-and-macos.md)).

### Security

- IPAWS send confirmation, resource request escalation, collaboration calls
  and feed polls no longer wait on the network inside a database
  transaction. A confirmed IPAWS request is never sent twice; one that fails
  in transit is recorded as rejected, and a new send must be requested. A
  second escalation of the same request within a minute is refused.
- Creating, changing and removing a notification rule is recorded in the
  audit trail.
- A live guest board connection is closed when the guest's grant is revoked
  or the incident is locked.

## 0.9.0 - 2026-09-23

The evaluation build. It is not tagged; `1.0.0` is set when the first release
is tagged.

### Added

- An Administration screen: people and roles, disabling sign-in and resetting
  two-step sign-in, positions and holders, guest access with an end time,
  retention periods, audit export, jurisdiction export, email and SMS
  channels, the webhook allowlist and notification rules, and which optional
  integrations are on. No administrative task after the first administrator
  needs `psql` or `curl`.
- Two-step sign-in with an authenticator app and single-use recovery codes,
  required for administrators.
- A Chronology screen over the audit trail with a significant events view,
  filters, attributed corrections and export.
- Audit export as CSV and as signed JSON pages, optional forwarding to syslog,
  and per-jurisdiction retention periods enforced by an hourly purge that
  never touches the audit trail or incident records.
- Jurisdiction export as one `tar.gz` archive holding the operational record
  and the bytes of every stored file.
- An in-process scheduler, with one leader per database, that runs
  notification rules, briefings, feed polls, outbound deliveries, call-downs,
  scheduled reports, the retention purge and syslog forwarding in both the
  Docker and the Windows desktop deployments.
- An outbound delivery queue for webhooks, push, email, SMS and federation,
  with retries, dead letters and a circuit per destination. No write waits on
  the network.
- Email through an SMTP relay and SMS through an HTTP provider or a test
  fixture; a contacts directory with groups and CSV import; mass notification
  with per-contact receipts, acknowledgement links and call-down in order.
- An IPAWS screen: configuration, the MOA acknowledgement, enable, and send
  requests that a second administrator confirms.
- Operator screens for damage assessment with Public Assistance items by FEMA
  category A to G and a shelter census; staffing with check-in, badges, the
  ICS-211 and shifts; federation partners and board sharing; JIC release
  review, publishing and media inquiries; resource costs and escalation;
  field reports; and the optional collaboration, meeting, facilities and
  tracking integrations.
- Board depth: record-level read and edit rules enforced by the database,
  archive and restore, administrator delete, change history per record, CSV
  and Excel import and export, more filter operators, multi-key sort,
  grouping, and Kanban, calendar and chart views with matching dashboard
  widgets.
- A report builder over boards with PDF, Excel and CSV output and scheduled
  email delivery.
- A WebEOC records importer for WebEOC's CSV board export, with a dry run, a
  rejection report and skipping of rows already imported.
- Map tiles built by the database for boards and datasets past the feature
  limit, and a USNG and MGRS readout.
- Offline address and place search from a gazetteer built from the basemap.
- A NIMS resource typing catalog with RTLT CSV import, a resource pool with
  demobilization, and cost totals.
- Incident archival, a jurisdiction view of all its incidents, and an opt-in
  per-incident lockdown of guest access.
- Smart form questions for lines, polygons, barcodes, photos, audio,
  cascading choices and repeats, with photos and audio queued offline.
- Structured JSON logs with request ids and slow request warnings, and a
  Prometheus metrics endpoint behind a token.
- Live notification updates over a WebSocket in place of polling.
- A one-command HTTPS install for Docker with Caddy, checked map archives and
  the first administrator; the `bootstrap` and `rotate-secret-key` server
  commands.
- `deploy/upgrade.sh`, which backs up before it upgrades and has no way to
  skip the backup; a backup by the Windows desktop launcher before a newer
  build migrates an existing database; the server's version in
  `GET /api/v1/health`; and this changelog.
- A training kit: job aids for eight positions, a tabletop exercise on the
  synthetic incident and an instructor outline.

### Changed

- The pre-release migration history is consolidated into one baseline file.
  A database built before 2026-09-22 cannot be upgraded in place; see the
  upgrade guide.
- Every list endpoint pages by cursor, 100 items by default and at most 500,
  and returns `nextCursor`.
- Files upload as streamed `multipart/form-data` with a per-file size limit
  and a per-jurisdiction quota, in place of base64 JSON.
- Records written through the REST API go through the sync log, so open
  boards and federation partners see edits made in the console.
- Board sync documents are released when idle and rebuilt from snapshots.
- Collaboration, meetings, tracking and facilities are optional integrations,
  off unless named in `OPENEOC_INTEGRATIONS`.
- The Windows desktop host sends cache validators for the map archives and a
  year-long cache for the hashed application files; county search on the map
  reads a table in the bundle.
- Every package carries version `0.9.0`.

### Security

- The server refuses to start when its database role could bypass row-level
  security, unless a development override is set.
- Webhook and push destinations must be on the jurisdiction's allowlist, each
  rule has a rate cap, and redirects are not followed.
- Every IPAWS send needs a second administrator's confirmation, enforced in
  the database.
- Login backoff, the flood limiter and the identity cache are bounded in
  size; a trusted proxy is named explicitly; sign-out and role changes reach
  the cache at once.
- WebSockets must authenticate within ten seconds and are limited in frame
  size and queued bytes, with a heartbeat.
- Stored credentials are encrypted with a server key that can be rotated.
- Record-level rules cover attached files too; a viewer can no longer record
  an audit correction; signed template packages are accepted only from
  configured publisher keys.
- Logs redact tokens, passwords and secrets and never record a webhook's full
  address.
- Backups are written readable only by the account that made them, and a
  restore refuses an incomplete dump and replays a complete one in a single
  transaction.

### Known limits

- One API process per database. The limiters, the identity cache and live
  board sync are held in that process.
- Edits and deletes of incident records are not sent to federation partners,
  and records that existed before a board was shared are not sent.
- No live IPAWS send until IPAWS-OPEN credentials and the MOA are in place.
  No SAML sign-in.
- The Docker install has been run only against stand-ins for Docker; no image
  has been built on a Linux host and no certificate issued.
- The 150-user run on real hardware is not yet recorded; the two-hour
  synthetic activation ran on a development workstation.
- Tracking and facilities are not reviewed for patient-level data.
- A board created on the Templates screen appears elsewhere only after a
  reload; notification rules cannot be listed, changed or removed; there is
  no voice channel; some lists show stored status codes instead of labels.
- The Windows setup program does not stop a running profile before it
  replaces the application files; stop profiles first.
