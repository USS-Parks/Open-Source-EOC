# Changelog

Notable changes to OpenEOC, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every package in
the repository carries the same version. How to upgrade, and which databases
upgrade in place, is in the [upgrade guide](docs/guides/UPGRADE.md).

## Unreleased

Changes on `main` after the 0.9.0 entry was written. The packages still carry
`0.9.0`. The Windows setup `Open-Source-EOC-Setup-0.9.0.exe` (SHA-256
`dafddeb50fcdfdf9a85519d24a88e21ae1c87420357ad22d86927802b112a153`) was
staged from `5875c2f`. It includes the side-by-side gap closures, the
installable web app, the style consolidation, the security policy, the
disaster recovery runbook and the installer fixes below. It predates the
fixes from the integrated exercise, the visual and accessibility review,
reduced motion and higher contrast, the write path change and the remaining
interface findings. The setup is rebuilt from the release commit when the
release is made.

### Added

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
  with retention on both deployment paths (a systemd timer on the Docker host,
  `-Action Backup` in the Windows launcher), and guidance for copies kept off
  the host.
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
