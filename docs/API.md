# Open Source EOC Public API (v1)

This document is generated from the frozen API contract. Every registered
method and path below is held to the Fastify route table by a contract test.
Routes marked with an integration are unregistered unless that name is
present in the comma-separated OPENEOC_INTEGRATIONS setting.
Routes with auth metrics-token answer 404 unless OPENEOC_METRICS_TOKEN is
set, and then require that value as a bearer token.

## REST

### aar

- `GET /api/v1/aar/:aarId/pdf`: Read aar pdf (auth: bearer; audience: operator)
- `GET /api/v1/corrective-actions/:id`: Read corrective actions (auth: bearer; audience: operator)
- `PATCH /api/v1/corrective-actions/:id`: Update corrective actions (auth: bearer; audience: operator)
- `POST /api/v1/corrective-actions/:id/status`: Run corrective actions status (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/aar`: Run incidents aar (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/aar/analytics`: Read incidents aar analytics (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/aar/observations`: Read incidents aar observations (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/aar/observations`: Run incidents aar observations (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/corrective-actions`: Read jurisdictions corrective actions (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/corrective-actions`: Run jurisdictions corrective actions (auth: bearer; audience: operator)

### audit

- `POST /api/v1/audit/:eventId/corrections`: Run audit corrections (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/audit/export`: Read jurisdictions audit export (auth: bearer; audience: operator)

### auth

- `POST /api/v1/auth/login`: Run auth login (auth: none; audience: operator)
- `POST /api/v1/auth/logout`: Run auth logout (auth: bearer; audience: operator)
- `POST /api/v1/auth/mfa/activate`: Run auth mfa activate (auth: none; audience: operator)
- `POST /api/v1/auth/mfa/enroll`: Run auth mfa enroll (auth: none; audience: operator)
- `POST /api/v1/auth/mfa/verify`: Run auth mfa verify (auth: none; audience: operator)
- `GET /api/v1/auth/oidc/callback`: Read auth oidc callback (auth: none; audience: operator)
- `GET /api/v1/auth/oidc/start`: Read auth oidc start (auth: none; audience: operator)
- `POST /api/v1/auth/resume`: Run auth resume (auth: none; audience: operator)
- `DELETE /api/v1/guests/:grantId`: Delete guests (auth: bearer; audience: operator)
- `GET /api/v1/integrations`: Read integrations (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/guests`: Read jurisdictions guests (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/guests`: Run jurisdictions guests (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/members`: Read jurisdictions members (auth: bearer; audience: operator)
- `DELETE /api/v1/jurisdictions/:jurisdictionId/members/:personId`: Delete jurisdictions members (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/members/:personId`: Set jurisdictions members (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/members/:personId/disabled`: Set jurisdictions members disabled (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/members/:personId/mfa-reset`: Run jurisdictions members mfa reset (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/position-assignments`: Read jurisdictions position assignments (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/positions`: Read jurisdictions positions (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/positions`: Run jurisdictions positions (auth: bearer; audience: operator)
- `GET /api/v1/me`: Read me (auth: bearer; audience: operator)
- `GET /api/v1/persons`: Read persons (auth: bearer; audience: operator)
- `POST /api/v1/persons`: Run persons (auth: bearer; audience: operator)
- `POST /api/v1/positions/:positionId/assignments`: Run positions assignments (auth: bearer; audience: operator)
- `DELETE /api/v1/positions/:positionId/assignments/:personId`: Delete positions assignments (auth: bearer; audience: operator)
- `POST /api/v1/positions/:positionId/reassignments`: Run positions reassignments (auth: bearer; audience: operator)
- `POST /api/v1/positions/:positionId/sign-in`: Run positions sign in (auth: bearer; audience: operator)
- `POST /api/v1/positions/sign-out`: Run positions sign out (auth: bearer; audience: operator)
- `POST /api/v1/provision/jurisdictions`: Run provision jurisdictions (auth: bearer; audience: operator)

### badges

- `POST /api/v1/jurisdictions/:jurisdictionId/badges`: Run jurisdictions badges (auth: bearer; audience: operator)

### boards

- `GET /api/v1/boards/:boardId`: Read boards (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/local-fields`: Run boards local fields (auth: bearer; audience: operator)
- `GET /api/v1/boards/:boardId/record-references/:fieldKey`: Read boards record references (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records`: Run boards records (auth: bearer; audience: operator)
- `PATCH /api/v1/boards/:boardId/records/:recordId`: Update boards records (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records/:recordId/cot`: Run boards records cot (auth: bearer; audience: operator)
- `GET /api/v1/boards/:boardId/records/:recordId/detail`: Read boards records detail (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records/:recordId/edxl`: Run boards records edxl (auth: bearer; audience: operator)
- `GET /api/v1/boards/:boardId/records/:recordId/workflow`: Read boards records workflow (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records/:recordId/workflow/approvals`: Run boards records workflow approvals (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records/:recordId/workflow/escalations`: Run boards records workflow escalations (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/records/:recordId/workflow/transitions`: Run boards records workflow transitions (auth: bearer; audience: operator)
- `POST /api/v1/boards/:boardId/upgrade`: Run boards upgrade (auth: bearer; audience: operator)
- `GET /api/v1/boards/:boardId/views/:viewKey`: Read boards views (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/boards`: Read jurisdictions boards (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/boards`: Run jurisdictions boards (auth: bearer; audience: operator)
- `POST /api/v1/templates`: Run templates (auth: bearer; audience: operator)
- `GET /api/v1/templates/:key/versions`: Read templates versions (auth: bearer; audience: operator)
- `GET /api/v1/templates/:key/versions/:version`: Read templates versions (auth: bearer; audience: operator)
- `POST /api/v1/templates/import`: Run templates import (auth: bearer; audience: operator)

### briefings

- `GET /api/v1/incidents/:incidentId/briefings`: Read incidents briefings (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)
- `POST /api/v1/incidents/:incidentId/briefings`: Run incidents briefings (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)
- `POST /api/v1/jurisdictions/:jurisdictionId/briefings/run-due`: Run jurisdictions briefings run due (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)

### cap

- `GET /api/v1/cap/alerts/:id`: Read cap alerts (auth: bearer; audience: operator)
- `POST /api/v1/cap/alerts/:id/review`: Run cap alerts review (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/cap/alerts`: Read jurisdictions cap alerts (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts`: Run jurisdictions cap alerts (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws`: Run jurisdictions cap alerts ipaws (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/drafts`: Run jurisdictions cap drafts (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/ingest`: Run jurisdictions cap ingest (auth: bearer; audience: operator)

### catalog

- `GET /api/v1/incidents/:incidentId/catalog`: Read incidents catalog (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/catalog/:sourceId/onboard`: Run incidents catalog onboard (auth: bearer; audience: operator)

### checkins

- `POST /api/v1/checkins/:id/checkout`: Run checkins checkout (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/checkins`: Run jurisdictions checkins (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/checkins/scan`: Run jurisdictions checkins scan (auth: bearer; audience: operator)

### checklist-items

- `POST /api/v1/checklist-items/:itemId/complete`: Run checklist items complete (auth: bearer; audience: operator)

### chronology

- `GET /api/v1/jurisdictions/:jurisdictionId/chronology`: Read jurisdictions chronology (auth: bearer; audience: operator)

### close

- `POST /api/v1/incidents/:incidentId/close`: Run incidents close (auth: bearer; audience: operator)

### collab

- `POST /api/v1/incidents/:incidentId/collab/announce`: Run incidents collab announce (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)
- `POST /api/v1/incidents/:incidentId/collab/archive`: Run incidents collab archive (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)
- `POST /api/v1/incidents/:incidentId/collab/provision`: Run incidents collab provision (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)
- `POST /api/v1/incidents/:incidentId/collab/sync`: Run incidents collab sync (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)
- `GET /api/v1/jurisdictions/:jurisdictionId/collab`: Read jurisdictions collab (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)
- `PUT /api/v1/jurisdictions/:jurisdictionId/collab/backend`: Set jurisdictions collab backend (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=collab)

### cot

- `POST /api/v1/jurisdictions/:jurisdictionId/cot/ingest`: Run jurisdictions cot ingest (auth: bearer; audience: operator)

### damage

- `POST /api/v1/damage/assessments/:id/moderate`: Run damage assessments moderate (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/damage/assessments`: Read jurisdictions damage assessments (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/assessments`: Run jurisdictions damage assessments (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/baseline`: Run jurisdictions damage baseline (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/declaration`: Run jurisdictions damage declaration (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/intake/enable`: Run jurisdictions damage intake enable (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/report`: Run jurisdictions damage report (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/damage/summary`: Run jurisdictions damage summary (auth: bearer; audience: operator)

### dashboard-templates

- `POST /api/v1/dashboard-templates`: Run dashboard templates (auth: bearer; audience: operator)
- `GET /api/v1/dashboard-templates/:key/:version/export`: Read dashboard templates export (auth: bearer; audience: operator)

### dashboards

- `GET /api/v1/dashboards/:dashboardId`: Read dashboards (auth: bearer; audience: operator)
- `GET /api/v1/dashboards/:dashboardId/data`: Read dashboards data (auth: bearer; audience: operator)
- `GET /api/v1/dashboards/:dashboardId/stream`: Read dashboards stream (auth: bearer; audience: operator)
- `GET /api/v1/dashboards/:dashboardId/widgets/:widgetKey/records`: Read dashboards widgets records (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/dashboard-configs`: Read incidents dashboard configs (auth: bearer; audience: operator)
- `DELETE /api/v1/incidents/:incidentId/dashboard-configs/:key`: Delete incidents dashboard configs (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/dashboard-configs/:key`: Read incidents dashboard configs (auth: bearer; audience: operator)
- `PUT /api/v1/incidents/:incidentId/dashboard-configs/:key`: Set incidents dashboard configs (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/dashboard-configs/:key/data`: Read incidents dashboard configs data (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/dashboards`: Read jurisdictions dashboards (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/dashboards`: Run jurisdictions dashboards (auth: bearer; audience: operator)

### datasets

- `POST /api/v1/data-packs/datasets/:datasetId/load`: Run data packs datasets load (auth: bearer; audience: operator)
- `GET /api/v1/datasets/:datasetId/items`: Read datasets items (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/data-packs`: Run incidents data packs (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/datasets`: Read incidents datasets (auth: bearer; audience: operator)

### edxl

- `POST /api/v1/jurisdictions/:jurisdictionId/edxl/import`: Run jurisdictions edxl import (auth: bearer; audience: operator)

### esf-assessments

- `GET /api/v1/incidents/:incidentId/esf-assessments`: Read incidents esf assessments (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/esf-assessments`: Run incidents esf assessments (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/decisions`: Run incidents esf assessments decisions (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/history`: Read incidents esf assessments history (auth: bearer; audience: operator)

### export

- `GET /api/v1/jurisdictions/:jurisdictionId/export`: Read jurisdictions export (auth: bearer; audience: operator)

### facilities

- `POST /api/v1/facilities/:id/status`: Run facilities status (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)
- `POST /api/v1/jurisdictions/:jurisdictionId/facilities`: Run jurisdictions facilities (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)
- `GET /api/v1/jurisdictions/:jurisdictionId/facilities/board`: Read jurisdictions facilities board (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)
- `GET /api/v1/jurisdictions/:jurisdictionId/facilities/have`: Read jurisdictions facilities have (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)
- `POST /api/v1/jurisdictions/:jurisdictionId/status-queries`: Run jurisdictions status queries (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)
- `GET /api/v1/status-queries/:id`: Read status queries (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=facilities)

### federation

- `POST /api/v1/federation/receive`: Run federation receive (auth: peer-token; audience: machine)

### feeds

- `POST /api/v1/feeds/:feedId/ingest`: Run feeds ingest (auth: feed-token; audience: machine)
- `GET /api/v1/feeds/:feedId/items`: Read feeds items (auth: bearer; audience: operator)
- `POST /api/v1/feeds/:feedId/poll`: Run feeds poll (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/feeds`: Read jurisdictions feeds (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/feeds`: Run jurisdictions feeds (auth: bearer; audience: operator)

### files

- `GET /api/v1/files/:fileId`: Read files (auth: bearer; audience: operator)
- `GET /api/v1/files/:fileId/content`: Read files content (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/files`: Read jurisdictions files (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/files`: Run jurisdictions files (auth: bearer; audience: operator)

### forms

- `POST /api/v1/forms/:key/submit`: Run forms submit (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/forms`: Read jurisdictions forms (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/forms`: Run jurisdictions forms (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/forms/:key`: Read jurisdictions forms (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/forms/import`: Run jurisdictions forms import (auth: bearer; audience: operator)

### health

- `GET /api/v1/health`: Read health (auth: none; audience: system)

### iap

- `GET /api/v1/iap/:iapId`: Read iap (auth: bearer; audience: operator)
- `POST /api/v1/iap/:iapId/approve`: Run iap approve (auth: bearer; audience: operator)
- `POST /api/v1/iap/:iapId/complete`: Run iap complete (auth: bearer; audience: operator)
- `PUT /api/v1/iap/:iapId/ics-204`: Set iap ics 204 (auth: bearer; audience: operator)
- `GET /api/v1/iap/:iapId/pdf`: Read iap pdf (auth: bearer; audience: operator)
- `GET /api/v1/iap/:iapId/revisions`: Read iap revisions (auth: bearer; audience: operator)
- `POST /api/v1/iap/:iapId/revisions`: Run iap revisions (auth: bearer; audience: operator)
- `GET /api/v1/iap/:iapId/revisions/:revision/pdf`: Read iap revisions pdf (auth: bearer; audience: operator)
- `POST /api/v1/iap/:iapId/submit`: Run iap submit (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/iap`: Run incidents iap (auth: bearer; audience: operator)

### iaps

- `GET /api/v1/incidents/:incidentId/iaps`: Read incidents iaps (auth: bearer; audience: operator)

### ics-forms

- `GET /api/v1/incidents/:incidentId/ics-forms/:formId`: Read incidents ics forms (auth: bearer; audience: operator)

### impact

- `GET /api/v1/incidents/:incidentId/impact`: Read incidents impact (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/impact/compare`: Read incidents impact compare (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/impact/sources/:datasetId/records`: Read incidents impact sources records (auth: bearer; audience: operator)

### incidents

- `GET /api/v1/incident-templates`: Read incident templates (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId`: Read incidents (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/operational-area`: Read incidents operational area (auth: bearer; audience: operator)
- `PUT /api/v1/incidents/:incidentId/operational-area`: Set incidents operational area (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/operational-area/history`: Read incidents operational area history (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/operational-relationships`: Read incidents operational relationships (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/operational-relationships`: Run incidents operational relationships (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/incidents`: Read jurisdictions incidents (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/incidents`: Run jurisdictions incidents (auth: bearer; audience: operator)

### ipaws

- `GET /api/v1/jurisdictions/:jurisdictionId/ipaws`: Read jurisdictions ipaws (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/ipaws/config`: Set jurisdictions ipaws config (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/enable`: Run jurisdictions ipaws enable (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/moa`: Run jurisdictions ipaws moa (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/ipaws/sends`: Read jurisdictions ipaws sends (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/cancel`: Run jurisdictions ipaws sends cancel (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/confirm`: Run jurisdictions ipaws sends confirm (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/test`: Run jurisdictions ipaws test (auth: bearer; audience: operator)

### jic

- `POST /api/v1/jic/approvals/receive`: Run jic approvals receive (auth: peer-token; audience: machine)
- `POST /api/v1/jic/inquiries/:inquiryId/answer`: Run jic inquiries answer (auth: bearer; audience: operator)
- `POST /api/v1/jic/inquiries/:inquiryId/assign`: Run jic inquiries assign (auth: bearer; audience: operator)
- `POST /api/v1/jic/releases/:releaseId/decisions`: Run jic releases decisions (auth: bearer; audience: operator)
- `POST /api/v1/jic/releases/:releaseId/publish`: Run jic releases publish (auth: bearer; audience: operator)
- `POST /api/v1/jic/releases/:releaseId/submit`: Run jic releases submit (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/jic/inquiries`: Run jurisdictions jic inquiries (auth: bearer; audience: operator)
- `GET /api/v1/jurisdictions/:jurisdictionId/jic/public`: Read jurisdictions jic public (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/jic/releases`: Run jurisdictions jic releases (auth: bearer; audience: operator)

### libraries

- `POST /api/v1/jurisdictions/:jurisdictionId/libraries`: Run jurisdictions libraries (auth: bearer; audience: operator)

### lifeline-assessments

- `GET /api/v1/incidents/:incidentId/lifeline-assessments`: Read incidents lifeline assessments (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/lifeline-assessments`: Run incidents lifeline assessments (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/decisions`: Run incidents lifeline assessments decisions (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/history`: Read incidents lifeline assessments history (auth: bearer; audience: operator)

### lifelines

- `GET /api/v1/jurisdictions/:jurisdictionId/lifelines`: Read jurisdictions lifelines (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/lifelines`: Set jurisdictions lifelines (auth: bearer; audience: operator)

### meetings

- `GET /api/v1/incidents/:incidentId/meetings`: Read incidents meetings (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)
- `POST /api/v1/incidents/:incidentId/meetings`: Run incidents meetings (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)
- `GET /api/v1/jurisdictions/:jurisdictionId/meetings/config`: Read jurisdictions meetings config (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)
- `PUT /api/v1/jurisdictions/:jurisdictionId/meetings/config`: Set jurisdictions meetings config (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=meetings)

### messaging-settings

- `PUT /api/v1/jurisdictions/:jurisdictionId/messaging-settings`: Set jurisdictions messaging settings (auth: bearer; audience: operator)

### metrics

- `GET /api/v1/metrics`: Read metrics (auth: metrics-token; audience: system)

### notification-allowlist

- `GET /api/v1/jurisdictions/:jurisdictionId/notification-allowlist`: Read jurisdictions notification allowlist (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/notification-allowlist`: Set jurisdictions notification allowlist (auth: bearer; audience: operator)

### notification-rules

- `POST /api/v1/jurisdictions/:jurisdictionId/notification-rules`: Run jurisdictions notification rules (auth: bearer; audience: operator)

### notifications

- `POST /api/v1/jurisdictions/:jurisdictionId/notifications/run-scheduled`: Run jurisdictions notifications run scheduled (auth: bearer; audience: operator)
- `GET /api/v1/notifications`: Read notifications (auth: bearer; audience: operator)
- `POST /api/v1/notifications/:notificationId/acknowledge`: Run notifications acknowledge (auth: bearer; audience: operator)
- `POST /api/v1/notifications/:notificationId/read`: Run notifications read (auth: bearer; audience: operator)
- `GET /api/v1/notifications/stream`: Read notifications stream (auth: bearer; audience: operator)

### ogc

- `GET /api/v1/ogc`: Read ogc (auth: bearer; audience: operator)
- `GET /api/v1/ogc/collections`: Read ogc collections (auth: bearer; audience: operator)
- `GET /api/v1/ogc/collections/:boardId/items`: Read ogc collections items (auth: bearer; audience: operator)
- `GET /api/v1/ogc/conformance`: Read ogc conformance (auth: bearer; audience: operator)

### participants

- `GET /api/v1/incidents/:incidentId/participants`: Read incidents participants (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/participants`: Run incidents participants (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/participants/:participantId/revoke`: Run incidents participants revoke (auth: bearer; audience: operator)

### peers

- `POST /api/v1/jurisdictions/:jurisdictionId/peers`: Run jurisdictions peers (auth: bearer; audience: operator)
- `POST /api/v1/peers/:peerId/agreements`: Run peers agreements (auth: bearer; audience: operator)
- `PUT /api/v1/peers/:peerId/link`: Set peers link (auth: bearer; audience: operator)
- `GET /api/v1/peers/:peerId/pending`: Read peers pending (auth: bearer; audience: operator)
- `POST /api/v1/peers/:peerId/queue`: Run peers queue (auth: bearer; audience: operator)

### ready

- `GET /api/v1/ready`: Read ready (auth: none; audience: system)

### resources

- `GET /api/v1/jurisdictions/:jurisdictionId/resource-requests`: Read jurisdictions resource requests (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/resource-requests`: Run jurisdictions resource requests (auth: bearer; audience: operator)
- `GET /api/v1/resource-requests/:id`: Read resource requests (auth: bearer; audience: operator)
- `POST /api/v1/resource-requests/:id/assign`: Run resource requests assign (auth: bearer; audience: operator)
- `POST /api/v1/resource-requests/:id/costs`: Run resource requests costs (auth: bearer; audience: operator)
- `GET /api/v1/resource-requests/:id/costs/export`: Read resource requests costs export (auth: bearer; audience: operator)
- `POST /api/v1/resource-requests/:id/escalate`: Run resource requests escalate (auth: bearer; audience: operator)
- `POST /api/v1/resource-requests/:id/transition`: Run resource requests transition (auth: bearer; audience: operator)
- `POST /api/v1/resource-requests/receive`: Run resource requests receive (auth: peer-token; audience: machine)
- `POST /api/v1/resource-requests/report`: Run resource requests report (auth: peer-token; audience: machine)

### retention

- `GET /api/v1/jurisdictions/:jurisdictionId/retention`: Read jurisdictions retention (auth: bearer; audience: operator)
- `PUT /api/v1/jurisdictions/:jurisdictionId/retention`: Set jurisdictions retention (auth: bearer; audience: operator)

### reunification

- `GET /api/v1/jurisdictions/:jurisdictionId/reunification`: Read jurisdictions reunification (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=tracking)

### search

- `GET /api/v1/jurisdictions/:jurisdictionId/search`: Read jurisdictions search (auth: bearer; audience: operator)

### shifts

- `POST /api/v1/jurisdictions/:jurisdictionId/shifts`: Run jurisdictions shifts (auth: bearer; audience: operator)

### sitreps

- `GET /api/v1/jurisdictions/:jurisdictionId/sitreps`: Read jurisdictions sitreps (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/sitreps`: Run jurisdictions sitreps (auth: bearer; audience: operator)
- `GET /api/v1/sitreps/:sitrepId`: Read sitreps (auth: bearer; audience: operator)

### staffing

- `GET /api/v1/jurisdictions/:jurisdictionId/staffing`: Read jurisdictions staffing (auth: bearer; audience: operator)

### sync

- `GET /api/v1/sync/boards/:boardId`: Read sync boards (auth: bearer; audience: operator)

### tasks

- `GET /api/v1/incidents/:incidentId/tasks`: Read incidents tasks (auth: bearer; audience: operator)
- `PATCH /api/v1/incidents/:incidentId/tasks/:taskId`: Update incidents tasks (auth: bearer; audience: operator)
- `POST /api/v1/incidents/:incidentId/tasks/:taskId/complete`: Run incidents tasks complete (auth: bearer; audience: operator)

### threads

- `GET /api/v1/jurisdictions/:jurisdictionId/threads`: Read jurisdictions threads (auth: bearer; audience: operator)
- `POST /api/v1/jurisdictions/:jurisdictionId/threads`: Run jurisdictions threads (auth: bearer; audience: operator)
- `GET /api/v1/threads/:threadId/export`: Read threads export (auth: bearer; audience: operator)
- `GET /api/v1/threads/:threadId/messages`: Read threads messages (auth: bearer; audience: operator)
- `POST /api/v1/threads/:threadId/messages`: Run threads messages (auth: bearer; audience: operator)

### tracking

- `POST /api/v1/jurisdictions/:jurisdictionId/tracked-objects`: Run jurisdictions tracked objects (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=tracking)
- `POST /api/v1/jurisdictions/:jurisdictionId/tracked-objects/scan`: Run jurisdictions tracked objects scan (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=tracking)
- `GET /api/v1/tracked-objects/:id`: Read tracked objects (auth: bearer; audience: operator; integration: OPENEOC_INTEGRATIONS=tracking)

### workspace

- `GET /api/v1/incidents/:incidentId/saved-state`: Read incidents saved state (auth: bearer; audience: operator)
- `DELETE /api/v1/incidents/:incidentId/saved-state/:kind/:key`: Delete incidents saved state (auth: bearer; audience: operator)
- `GET /api/v1/incidents/:incidentId/saved-state/:kind/:key`: Read incidents saved state (auth: bearer; audience: operator)
- `PUT /api/v1/incidents/:incidentId/saved-state/:kind/:key`: Set incidents saved state (auth: bearer; audience: operator)

## WebSocket channels

- `/api/v1/sync/boards/:boardId`: CRDT board sync
- `/api/v1/dashboards/:dashboardId/stream`: Live dashboard snapshots
- `/api/v1/notifications/stream`: Notification change signals

## Webhook events

- `record.created`: A board record was created
- `record.updated`: A board record was updated
