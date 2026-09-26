/**
 * Frozen public API contract (INV-4/INV-9). The versioned surface
 * third parties build against: REST endpoints, the sync WebSocket, webhook
 * event types, and the OGC/GeoJSON Features surfaces. The docs
 * generate from this contract, and a contract test holds the running app to
 * it, so the published surface and the code cannot drift apart.
 */

export const API_VERSION = "v1";

export interface RestEndpoint {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly tag: string;
  readonly summary: string;
  readonly auth: "bearer" | "peer-token" | "feed-token" | "intake-token" | "metrics-token" | "none";
  readonly audience: "operator" | "machine" | "system";
  readonly integration?: "collab" | "facilities" | "meetings" | "tracking";
}

export interface WsChannel {
  readonly path: string;
  readonly summary: string;
}

export interface WebhookEvent {
  readonly name: string;
  readonly summary: string;
}

export interface ApiContract {
  readonly version: string;
  readonly rest: readonly RestEndpoint[];
  readonly websockets: readonly WsChannel[];
  readonly webhooks: readonly WebhookEvent[];
}

const routeKeys = `
DELETE /api/v1/boards/:boardId/records/:recordId
DELETE /api/v1/contact-groups/:groupId
DELETE /api/v1/contacts/:contactId
DELETE /api/v1/equipment-hours/:hoursId
DELETE /api/v1/guests/:grantId
DELETE /api/v1/incidents/:incidentId/dashboard-configs/:key
DELETE /api/v1/incidents/:incidentId/lockdown
DELETE /api/v1/incidents/:incidentId/saved-state/:kind/:key
DELETE /api/v1/jurisdictions/:jurisdictionId/members/:personId
DELETE /api/v1/jurisdictions/:jurisdictionId/resources/kinds/:key
DELETE /api/v1/notification-rules/:ruleId
DELETE /api/v1/peers/:peerId/agreements/:agreementId
DELETE /api/v1/positions/:positionId/assignments/:personId
DELETE /api/v1/reports/:reportId
DELETE /api/v1/volunteer-deployments/:deploymentId
GET /api/v1/aar/:aarId/pdf
GET /api/v1/ack/:token
GET /api/v1/auth/oidc/callback
GET /api/v1/auth/oidc/start
GET /api/v1/boards/:boardId
GET /api/v1/boards/:boardId/import-template
GET /api/v1/boards/:boardId/record-references/:fieldKey
GET /api/v1/boards/:boardId/records/:recordId/detail
GET /api/v1/boards/:boardId/records/:recordId/history
GET /api/v1/boards/:boardId/records/:recordId/workflow
GET /api/v1/boards/:boardId/views/:viewKey
GET /api/v1/boards/:boardId/views/:viewKey/export
GET /api/v1/boards/:boardId/webeoc-mapping
GET /api/v1/cap/alerts/:id
GET /api/v1/corrective-actions/:id
GET /api/v1/dashboard-templates/:key/:version/export
GET /api/v1/dashboards/:dashboardId
GET /api/v1/dashboards/:dashboardId/data
GET /api/v1/dashboards/:dashboardId/stream
GET /api/v1/dashboards/:dashboardId/widgets/:widgetKey/records
GET /api/v1/datasets/:datasetId/items
GET /api/v1/feeds/:feedId/items
GET /api/v1/files/:fileId
GET /api/v1/files/:fileId/content
GET /api/v1/geocode/reverse
GET /api/v1/geocode/search
GET /api/v1/health
GET /api/v1/iap/:iapId
GET /api/v1/iap/:iapId/pdf
GET /api/v1/iap/:iapId/revisions
GET /api/v1/iap/:iapId/revisions/:revision/pdf
GET /api/v1/ics-components/:componentId
GET /api/v1/ics-components/:componentId/pdf
GET /api/v1/ics-components/:componentId/versions
GET /api/v1/import-reports/:reportId
GET /api/v1/incident-templates
GET /api/v1/incident-templates/:key
GET /api/v1/incident-templates/:key/versions
GET /api/v1/incidents/:incidentId
GET /api/v1/incidents/:incidentId/aar/analytics
GET /api/v1/incidents/:incidentId/aar/observations
GET /api/v1/incidents/:incidentId/activity
GET /api/v1/incidents/:incidentId/briefings
GET /api/v1/incidents/:incidentId/catalog
GET /api/v1/incidents/:incidentId/closeout
GET /api/v1/incidents/:incidentId/dashboard-configs
GET /api/v1/incidents/:incidentId/dashboard-configs/:key
GET /api/v1/incidents/:incidentId/dashboard-configs/:key/data
GET /api/v1/incidents/:incidentId/datasets
GET /api/v1/incidents/:incidentId/esf-assessments
GET /api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/history
GET /api/v1/incidents/:incidentId/file-folders
GET /api/v1/incidents/:incidentId/force-account
GET /api/v1/incidents/:incidentId/handoff
GET /api/v1/incidents/:incidentId/iaps
GET /api/v1/incidents/:incidentId/ics-components
GET /api/v1/incidents/:incidentId/ics-forms/:formId
GET /api/v1/incidents/:incidentId/impact
GET /api/v1/incidents/:incidentId/impact/compare
GET /api/v1/incidents/:incidentId/impact/sources/:datasetId/records
GET /api/v1/incidents/:incidentId/lifeline-assessments
GET /api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/history
GET /api/v1/incidents/:incidentId/meetings
GET /api/v1/incidents/:incidentId/operational-area
GET /api/v1/incidents/:incidentId/operational-area/history
GET /api/v1/incidents/:incidentId/operational-relationships
GET /api/v1/incidents/:incidentId/participants
GET /api/v1/incidents/:incidentId/participants/:participantId/preview
GET /api/v1/incidents/:incidentId/plan
GET /api/v1/incidents/:incidentId/resource-requests
GET /api/v1/incidents/:incidentId/saved-state
GET /api/v1/incidents/:incidentId/saved-state/:kind/:key
GET /api/v1/incidents/:incidentId/summary
GET /api/v1/incidents/:incidentId/tasks
GET /api/v1/incidents/:incidentId/threads
GET /api/v1/incidents/:incidentId/volunteers
GET /api/v1/integrations
GET /api/v1/jurisdictions/:jurisdictionId/audit/export
GET /api/v1/jurisdictions/:jurisdictionId/badges
GET /api/v1/jurisdictions/:jurisdictionId/boards
GET /api/v1/jurisdictions/:jurisdictionId/cap/alerts
GET /api/v1/jurisdictions/:jurisdictionId/checkins
GET /api/v1/jurisdictions/:jurisdictionId/chronology
GET /api/v1/jurisdictions/:jurisdictionId/collab
GET /api/v1/jurisdictions/:jurisdictionId/contact-groups
GET /api/v1/jurisdictions/:jurisdictionId/contacts
GET /api/v1/jurisdictions/:jurisdictionId/corrective-actions
GET /api/v1/jurisdictions/:jurisdictionId/damage/assessments
GET /api/v1/jurisdictions/:jurisdictionId/damage/pa-items
GET /api/v1/jurisdictions/:jurisdictionId/dashboards
GET /api/v1/jurisdictions/:jurisdictionId/delivery-holds
GET /api/v1/jurisdictions/:jurisdictionId/export
GET /api/v1/jurisdictions/:jurisdictionId/facilities/board
GET /api/v1/jurisdictions/:jurisdictionId/facilities/have
GET /api/v1/jurisdictions/:jurisdictionId/federation
GET /api/v1/jurisdictions/:jurisdictionId/feeds
GET /api/v1/jurisdictions/:jurisdictionId/files
GET /api/v1/jurisdictions/:jurisdictionId/forms
GET /api/v1/jurisdictions/:jurisdictionId/forms/:key
GET /api/v1/jurisdictions/:jurisdictionId/guests
GET /api/v1/jurisdictions/:jurisdictionId/import-reports
GET /api/v1/jurisdictions/:jurisdictionId/incidents
GET /api/v1/jurisdictions/:jurisdictionId/incidents/overview
GET /api/v1/jurisdictions/:jurisdictionId/ipaws
GET /api/v1/jurisdictions/:jurisdictionId/ipaws/sends
GET /api/v1/jurisdictions/:jurisdictionId/jic/inquiries
GET /api/v1/jurisdictions/:jurisdictionId/jic/public
GET /api/v1/jurisdictions/:jurisdictionId/jic/releases
GET /api/v1/jurisdictions/:jurisdictionId/lifelines
GET /api/v1/jurisdictions/:jurisdictionId/mass-notifications
GET /api/v1/jurisdictions/:jurisdictionId/meetings/config
GET /api/v1/jurisdictions/:jurisdictionId/members
GET /api/v1/jurisdictions/:jurisdictionId/notification-allowlist
GET /api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind
GET /api/v1/jurisdictions/:jurisdictionId/notification-rules
GET /api/v1/jurisdictions/:jurisdictionId/pa-rates
GET /api/v1/jurisdictions/:jurisdictionId/people-import/template
GET /api/v1/jurisdictions/:jurisdictionId/plans
GET /api/v1/jurisdictions/:jurisdictionId/position-assignments
GET /api/v1/jurisdictions/:jurisdictionId/positions
GET /api/v1/jurisdictions/:jurisdictionId/reports
GET /api/v1/jurisdictions/:jurisdictionId/resource-requests
GET /api/v1/jurisdictions/:jurisdictionId/resources
GET /api/v1/jurisdictions/:jurisdictionId/resources/kinds
GET /api/v1/jurisdictions/:jurisdictionId/retention
GET /api/v1/jurisdictions/:jurisdictionId/reunification
GET /api/v1/jurisdictions/:jurisdictionId/search
GET /api/v1/jurisdictions/:jurisdictionId/sitreps
GET /api/v1/jurisdictions/:jurisdictionId/staffing
GET /api/v1/jurisdictions/:jurisdictionId/status-queries
GET /api/v1/jurisdictions/:jurisdictionId/threads
GET /api/v1/jurisdictions/:jurisdictionId/volunteers
GET /api/v1/mass-notifications/:massNotificationId
GET /api/v1/me
GET /api/v1/metrics
GET /api/v1/notifications
GET /api/v1/notifications/stream
GET /api/v1/ogc
GET /api/v1/ogc/collections
GET /api/v1/ogc/collections/:boardId/items
GET /api/v1/ogc/conformance
GET /api/v1/peers/:peerId/pending
GET /api/v1/persons
GET /api/v1/plans/:planId
GET /api/v1/plans/:planId/versions
GET /api/v1/ready
GET /api/v1/reports/:reportId
GET /api/v1/reports/:reportId/output
GET /api/v1/resource-requests/:id
GET /api/v1/resource-requests/:id/costs/export
GET /api/v1/resource-requests/:id/ics-213rr
GET /api/v1/resource-requests/:id/ics-213rr/pdf
GET /api/v1/resources/:resourceId/history
GET /api/v1/sitreps/:sitrepId
GET /api/v1/solution-packages
GET /api/v1/status-queries/:id
GET /api/v1/sync/boards/:boardId
GET /api/v1/templates
GET /api/v1/templates/:key/versions
GET /api/v1/templates/:key/versions/:version
GET /api/v1/threads/:threadId/export
GET /api/v1/threads/:threadId/messages
GET /api/v1/tiles/boards/:boardId/:z/:x/:y.mvt
GET /api/v1/tiles/datasets/:datasetId/:z/:x/:y.mvt
GET /api/v1/tracked-objects/:id
PATCH /api/v1/boards/:boardId/records/:recordId
PATCH /api/v1/corrective-actions/:id
PATCH /api/v1/facilities/:id
PATCH /api/v1/incidents/:incidentId/tasks/:taskId
PATCH /api/v1/jurisdictions/:jurisdictionId/resources/kinds/:key
PATCH /api/v1/notification-rules/:ruleId
PATCH /api/v1/resources/:resourceId
POST /api/v1/ack/:token
POST /api/v1/audit/:eventId/corrections
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/mfa/activate
POST /api/v1/auth/mfa/enroll
POST /api/v1/auth/mfa/verify
POST /api/v1/auth/password
POST /api/v1/auth/resume
POST /api/v1/badges/:badgeId/revoke
POST /api/v1/boards/:boardId/import
POST /api/v1/boards/:boardId/local-fields
POST /api/v1/boards/:boardId/records
POST /api/v1/boards/:boardId/records/:recordId/archive
POST /api/v1/boards/:boardId/records/:recordId/cot
POST /api/v1/boards/:boardId/records/:recordId/edxl
POST /api/v1/boards/:boardId/records/:recordId/restore
POST /api/v1/boards/:boardId/records/:recordId/workflow/approvals
POST /api/v1/boards/:boardId/records/:recordId/workflow/escalations
POST /api/v1/boards/:boardId/records/:recordId/workflow/transitions
POST /api/v1/boards/:boardId/records/:recordId/workflow/withdrawals
POST /api/v1/boards/:boardId/upgrade
POST /api/v1/boards/:boardId/webeoc-import
POST /api/v1/cap/alerts/:id/review
POST /api/v1/checkins/:id/checkout
POST /api/v1/checklist-items/:itemId/complete
POST /api/v1/corrective-actions/:id/status
POST /api/v1/damage/assessments/:id/moderate
POST /api/v1/dashboard-templates
POST /api/v1/data-packs/datasets/:datasetId/load
POST /api/v1/facilities/:id/retire
POST /api/v1/facilities/:id/status
POST /api/v1/federation/receive
POST /api/v1/feeds/:feedId/ingest
POST /api/v1/feeds/:feedId/poll
POST /api/v1/forms/:key/submit
POST /api/v1/forms/records/:recordId/attachments
POST /api/v1/iap/:iapId/approve
POST /api/v1/iap/:iapId/complete
POST /api/v1/iap/:iapId/forms/refresh
POST /api/v1/iap/:iapId/revisions
POST /api/v1/iap/:iapId/submit
POST /api/v1/import-reports/:reportId/sign-off
POST /api/v1/incidents/:incidentId/aar
POST /api/v1/incidents/:incidentId/aar/observations
POST /api/v1/incidents/:incidentId/archive
POST /api/v1/incidents/:incidentId/briefings
POST /api/v1/incidents/:incidentId/catalog/:sourceId/onboard
POST /api/v1/incidents/:incidentId/close
POST /api/v1/incidents/:incidentId/collab/announce
POST /api/v1/incidents/:incidentId/collab/archive
POST /api/v1/incidents/:incidentId/collab/provision
POST /api/v1/incidents/:incidentId/collab/sync
POST /api/v1/incidents/:incidentId/data-packs
POST /api/v1/incidents/:incidentId/equipment-hours
POST /api/v1/incidents/:incidentId/esf-assessments
POST /api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/decisions
POST /api/v1/incidents/:incidentId/force-account/roll-up
POST /api/v1/incidents/:incidentId/iap
POST /api/v1/incidents/:incidentId/ics-components
POST /api/v1/incidents/:incidentId/lifeline-assessments
POST /api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/decisions
POST /api/v1/incidents/:incidentId/lockdown
POST /api/v1/incidents/:incidentId/meetings
POST /api/v1/incidents/:incidentId/operational-relationships
POST /api/v1/incidents/:incidentId/participants
POST /api/v1/incidents/:incidentId/participants/:participantId/revoke
POST /api/v1/incidents/:incidentId/reopen
POST /api/v1/incidents/:incidentId/tasks
POST /api/v1/incidents/:incidentId/tasks/:taskId/complete
POST /api/v1/incidents/:incidentId/unarchive
POST /api/v1/incidents/:incidentId/volunteers
POST /api/v1/jic/approvals/receive
POST /api/v1/jic/inquiries/:inquiryId/answer
POST /api/v1/jic/inquiries/:inquiryId/assign
POST /api/v1/jic/releases/:releaseId/decisions
POST /api/v1/jic/releases/:releaseId/publish
POST /api/v1/jic/releases/:releaseId/submit
POST /api/v1/jurisdictions/:jurisdictionId/badges
POST /api/v1/jurisdictions/:jurisdictionId/boards
POST /api/v1/jurisdictions/:jurisdictionId/briefings/run-due
POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts
POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws
POST /api/v1/jurisdictions/:jurisdictionId/cap/drafts
POST /api/v1/jurisdictions/:jurisdictionId/cap/ingest
POST /api/v1/jurisdictions/:jurisdictionId/checkins
POST /api/v1/jurisdictions/:jurisdictionId/checkins/scan
POST /api/v1/jurisdictions/:jurisdictionId/contact-groups
POST /api/v1/jurisdictions/:jurisdictionId/contacts
POST /api/v1/jurisdictions/:jurisdictionId/contacts/import
POST /api/v1/jurisdictions/:jurisdictionId/corrective-actions
POST /api/v1/jurisdictions/:jurisdictionId/cot/ingest
POST /api/v1/jurisdictions/:jurisdictionId/damage/assessments
POST /api/v1/jurisdictions/:jurisdictionId/damage/baseline
POST /api/v1/jurisdictions/:jurisdictionId/damage/declaration
POST /api/v1/jurisdictions/:jurisdictionId/damage/intake/enable
POST /api/v1/jurisdictions/:jurisdictionId/damage/pa-items
POST /api/v1/jurisdictions/:jurisdictionId/damage/report
POST /api/v1/jurisdictions/:jurisdictionId/damage/summary
POST /api/v1/jurisdictions/:jurisdictionId/dashboards
POST /api/v1/jurisdictions/:jurisdictionId/edxl/import
POST /api/v1/jurisdictions/:jurisdictionId/facilities
POST /api/v1/jurisdictions/:jurisdictionId/feeds
POST /api/v1/jurisdictions/:jurisdictionId/files
POST /api/v1/jurisdictions/:jurisdictionId/forms
POST /api/v1/jurisdictions/:jurisdictionId/forms/import
POST /api/v1/jurisdictions/:jurisdictionId/guests
POST /api/v1/jurisdictions/:jurisdictionId/incidents
POST /api/v1/jurisdictions/:jurisdictionId/ipaws/enable
POST /api/v1/jurisdictions/:jurisdictionId/ipaws/moa
POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/cancel
POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/confirm
POST /api/v1/jurisdictions/:jurisdictionId/ipaws/test
POST /api/v1/jurisdictions/:jurisdictionId/jic/inquiries
POST /api/v1/jurisdictions/:jurisdictionId/jic/releases
POST /api/v1/jurisdictions/:jurisdictionId/libraries
POST /api/v1/jurisdictions/:jurisdictionId/mass-notifications
POST /api/v1/jurisdictions/:jurisdictionId/members/:personId/mfa-reset
POST /api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind/test
POST /api/v1/jurisdictions/:jurisdictionId/notification-rules
POST /api/v1/jurisdictions/:jurisdictionId/notifications/run-scheduled
POST /api/v1/jurisdictions/:jurisdictionId/pa-equipment-rates
POST /api/v1/jurisdictions/:jurisdictionId/peers
POST /api/v1/jurisdictions/:jurisdictionId/people-import
POST /api/v1/jurisdictions/:jurisdictionId/plans
POST /api/v1/jurisdictions/:jurisdictionId/positions
POST /api/v1/jurisdictions/:jurisdictionId/reports
POST /api/v1/jurisdictions/:jurisdictionId/reports/preview
POST /api/v1/jurisdictions/:jurisdictionId/resource-requests
POST /api/v1/jurisdictions/:jurisdictionId/resources
POST /api/v1/jurisdictions/:jurisdictionId/resources/kinds
POST /api/v1/jurisdictions/:jurisdictionId/resources/kinds/import
POST /api/v1/jurisdictions/:jurisdictionId/shifts
POST /api/v1/jurisdictions/:jurisdictionId/sitreps
POST /api/v1/jurisdictions/:jurisdictionId/sms-replies/read
POST /api/v1/jurisdictions/:jurisdictionId/solution-packages
POST /api/v1/jurisdictions/:jurisdictionId/status-queries
POST /api/v1/jurisdictions/:jurisdictionId/threads
POST /api/v1/jurisdictions/:jurisdictionId/tracked-objects
POST /api/v1/jurisdictions/:jurisdictionId/tracked-objects/scan
POST /api/v1/jurisdictions/:jurisdictionId/volunteers
POST /api/v1/mass-notifications/:massNotificationId/acknowledgements
POST /api/v1/notifications/:notificationId/acknowledge
POST /api/v1/notifications/:notificationId/read
POST /api/v1/notifications/:notificationId/resend
POST /api/v1/peers/:peerId/agreements
POST /api/v1/peers/:peerId/exchange/export
POST /api/v1/peers/:peerId/exchange/import
POST /api/v1/peers/:peerId/exchange/receipt
POST /api/v1/peers/:peerId/queue
POST /api/v1/persons
POST /api/v1/plans/:planId/activate
POST /api/v1/plans/:planId/review
POST /api/v1/positions/:positionId/assignments
POST /api/v1/positions/:positionId/reassignments
POST /api/v1/positions/:positionId/sign-in
POST /api/v1/positions/sign-out
POST /api/v1/provision/jurisdictions
POST /api/v1/resource-requests/:id/assign
POST /api/v1/resource-requests/:id/costs
POST /api/v1/resource-requests/:id/escalate
POST /api/v1/resource-requests/:id/transition
POST /api/v1/resource-requests/receive
POST /api/v1/resource-requests/report
POST /api/v1/resources/:resourceId/transition
POST /api/v1/templates
POST /api/v1/templates/import
POST /api/v1/threads/:threadId/messages
POST /api/v1/volunteers/:volunteerId/deployments
PUT /api/v1/boards/:boardId/webeoc-mapping
PUT /api/v1/contact-groups/:groupId
PUT /api/v1/contacts/:contactId
PUT /api/v1/damage/pa-items/:id
PUT /api/v1/iap/:iapId/ics-204
PUT /api/v1/ics-components/:componentId
PUT /api/v1/incident-templates/:key
PUT /api/v1/incidents/:incidentId/dashboard-configs/:key
PUT /api/v1/incidents/:incidentId/operational-area
PUT /api/v1/incidents/:incidentId/saved-state/:kind/:key
PUT /api/v1/jurisdictions/:jurisdictionId/collab/backend
PUT /api/v1/jurisdictions/:jurisdictionId/delivery-holds/:kind
PUT /api/v1/jurisdictions/:jurisdictionId/ipaws/config
PUT /api/v1/jurisdictions/:jurisdictionId/lifelines
PUT /api/v1/jurisdictions/:jurisdictionId/meetings/config
PUT /api/v1/jurisdictions/:jurisdictionId/members/:personId
PUT /api/v1/jurisdictions/:jurisdictionId/members/:personId/disabled
PUT /api/v1/jurisdictions/:jurisdictionId/messaging-settings
PUT /api/v1/jurisdictions/:jurisdictionId/notification-allowlist
PUT /api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind
PUT /api/v1/jurisdictions/:jurisdictionId/pa-labor-rates/:personId
PUT /api/v1/jurisdictions/:jurisdictionId/retention
PUT /api/v1/peers/:peerId/key
PUT /api/v1/peers/:peerId/link
PUT /api/v1/plans/:planId
PUT /api/v1/reports/:reportId
PUT /api/v1/volunteer-deployments/:deploymentId
PUT /api/v1/volunteers/:volunteerId
`
  .trim()
  .split("\n");

const methods = new Set<RestEndpoint["method"]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const noAuth = new Set([
  "GET /api/v1/health",
  "GET /api/v1/ready",
  "GET /api/v1/auth/oidc/callback",
  "GET /api/v1/auth/oidc/start",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/mfa/activate",
  "POST /api/v1/auth/mfa/enroll",
  "POST /api/v1/auth/mfa/verify",
  "POST /api/v1/auth/resume",
  "GET /api/v1/ack/:token",
  "POST /api/v1/ack/:token",
]);
const peerAuth = new Set([
  "POST /api/v1/federation/receive",
  "POST /api/v1/jic/approvals/receive",
  "POST /api/v1/resource-requests/receive",
  "POST /api/v1/resource-requests/report",
]);
const feedAuth = new Set(["POST /api/v1/feeds/:feedId/ingest"]);
// Damage self-reports from external intake tools carry the jurisdiction's intake token.
const intakeAuth = new Set(["POST /api/v1/jurisdictions/:jurisdictionId/damage/report"]);
// The scrape token is OPENEOC_METRICS_TOKEN; the route answers 404 while it is unset.
const metricsAuth = new Set(["GET /api/v1/metrics"]);
const systemRoutes = new Set(["GET /api/v1/health", "GET /api/v1/ready", "GET /api/v1/metrics"]);
/**
 * Routes no screen calls, by design. Every other operator route is reachable
 * from a screen, which a web test holds to.
 */
const machineRoutes = new Set([
  // Interchange with other systems: CAP, CoT and EDXL in and out.
  "POST /api/v1/jurisdictions/:jurisdictionId/cap/ingest",
  "POST /api/v1/jurisdictions/:jurisdictionId/cot/ingest",
  "POST /api/v1/jurisdictions/:jurisdictionId/edxl/import",
  "POST /api/v1/boards/:boardId/records/:recordId/cot",
  "POST /api/v1/boards/:boardId/records/:recordId/edxl",
  // Direct CAP authoring for API clients; the screen authors through reviewed drafts.
  "POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts",
  // OGC API Features landing and conformance pages, read by GIS clients.
  "GET /api/v1/ogc",
  "GET /api/v1/ogc/conformance",
  // Live dashboard snapshots for wall displays and other external clients.
  "GET /api/v1/dashboards/:dashboardId/stream",
  // The identity-provider redirect pair: the browser is sent here, not called.
  "GET /api/v1/auth/oidc/start",
  "GET /api/v1/auth/oidc/callback",
  // Manual triggers for jobs the scheduler runs on its own.
  "POST /api/v1/jurisdictions/:jurisdictionId/briefings/run-due",
  "POST /api/v1/jurisdictions/:jurisdictionId/notifications/run-scheduled",
  // The manual federation queue and its read; the sync hub queues shared-board edits itself.
  "POST /api/v1/peers/:peerId/queue",
  "GET /api/v1/peers/:peerId/pending",
  // The mass notification acknowledgement link, opened by a recipient from an email or SMS.
  "GET /api/v1/ack/:token",
  "POST /api/v1/ack/:token",
]);
for (const key of machineRoutes) {
  if (!routeKeys.includes(key)) throw new Error(`machine route is not in the contract: ${key}`);
}

const tagAliases: Readonly<Record<string, string>> = {
  "ack": "mass-notifications",
  "archive": "incidents",
  "contact-groups": "contacts",
  "corrective-actions": "aar",
  "dashboard-configs": "dashboards",
  "equipment-hours": "damage",
  "file-folders": "files",
  "force-account": "damage",
  "data-packs": "datasets",
  "guests": "auth",
  "ics-components": "ics-forms",
  "import-reports": "imports",
  "incident-templates": "incidents",
  "integrations": "auth",
  "lockdown": "incidents",
  "me": "auth",
  "members": "auth",
  "operational-area": "incidents",
  "operational-relationships": "incidents",
  "pa-equipment-rates": "damage",
  "pa-labor-rates": "damage",
  "pa-rates": "damage",
  "people-import": "imports",
  "plan": "plans",
  "persons": "auth",
  "position-assignments": "auth",
  "positions": "auth",
  "provision": "auth",
  "resource-requests": "resources",
  "saved-state": "workspace",
  "sms-replies": "mass-notifications",
  "status-queries": "facilities",
  "templates": "boards",
  "tracked-objects": "tracking",
  "unarchive": "incidents",
  "volunteer-deployments": "volunteers",
};

function routeTag(path: string): string {
  const segments = path.split("/").slice(3);
  const scoped = segments[0] === "jurisdictions" || segments[0] === "incidents";
  const resource = scoped ? (segments[2] ?? segments[0] ?? "meta") : (segments[0] ?? "meta");
  return tagAliases[resource] ?? resource;
}

function routeSummary(method: RestEndpoint["method"], path: string): string {
  const verbs: Readonly<Record<RestEndpoint["method"], string>> = {
    GET: "Read",
    POST: "Run",
    PUT: "Set",
    PATCH: "Update",
    DELETE: "Delete",
  };
  const subject = path
    .split("/")
    .slice(3)
    .filter((segment) => !segment.startsWith(":"))
    .join(" ")
    .replaceAll("-", " ");
  return `${verbs[method]} ${subject}`;
}

function routeIntegration(path: string): RestEndpoint["integration"] {
  if (path.includes("/collab")) return "collab";
  if (path.includes("/facilities") || path.includes("/status-queries")) return "facilities";
  if (path.includes("/meetings") || path.includes("/briefings")) return "meetings";
  if (path.includes("/tracked-objects") || path.includes("/reunification")) return "tracking";
  return undefined;
}

const rest: RestEndpoint[] = routeKeys.map((key) => {
  const separator = key.indexOf(" ");
  const method = key.slice(0, separator) as RestEndpoint["method"];
  const path = key.slice(separator + 1);
  if (!methods.has(method)) throw new Error(`unsupported API method in contract: ${key}`);
  const auth = noAuth.has(key)
    ? "none"
    : peerAuth.has(key)
      ? "peer-token"
      : feedAuth.has(key)
        ? "feed-token"
        : metricsAuth.has(key)
          ? "metrics-token"
          : intakeAuth.has(key)
            ? "intake-token"
            : "bearer";
  const audience = systemRoutes.has(key)
    ? "system"
    : auth === "peer-token" || auth === "feed-token" || auth === "intake-token" || machineRoutes.has(key)
      ? "machine"
      : "operator";
  const integration = routeIntegration(path);
  return {
    method,
    path,
    tag: routeTag(path),
    summary: routeSummary(method, path),
    auth,
    audience,
    ...(integration ? { integration } : {}),
  };
});

const websockets: WsChannel[] = [
  { path: "/api/v1/sync/boards/:boardId", summary: "CRDT board sync" },
  { path: "/api/v1/dashboards/:dashboardId/stream", summary: "Live dashboard snapshots" },
  { path: "/api/v1/notifications/stream", summary: "Notification change signals" },
];

const webhooks: WebhookEvent[] = [
  { name: "record.created", summary: "A board record was created" },
  { name: "record.updated", summary: "A board record was updated" },
];

export const API_CONTRACT: ApiContract = { version: API_VERSION, rest, websockets, webhooks };

/** Generate human-readable API docs (Markdown) from the contract. */
export function generateApiDocs(contract: ApiContract = API_CONTRACT): string {
  const lines: string[] = [
    `# Open Source EOC Public API (${contract.version})`,
    ``,
    `This document is generated from the frozen API contract. Every registered`,
    `method and path below is held to the Fastify route table by a contract test.`,
    `Routes marked with an integration are unregistered unless that name is`,
    `present in the comma-separated OPENEOC_INTEGRATIONS setting.`,
    `Routes with auth metrics-token answer 404 unless OPENEOC_METRICS_TOKEN is`,
    `set, and then require that value as a bearer token.`,
    `The OIDC sign-in routes, GET /api/v1/auth/oidc/start and`,
    `GET /api/v1/auth/oidc/callback, register only when OPENEOC_OIDC_ISSUER is set.`,
    ``,
    `## REST`,
    ``,
  ];
  const byTag = new Map<string, RestEndpoint[]>();
  for (const e of contract.rest) {
    if (!byTag.has(e.tag)) byTag.set(e.tag, []);
    byTag.get(e.tag)!.push(e);
  }
  for (const tag of [...byTag.keys()].sort()) {
    lines.push(`### ${tag}`, ``);
    const endpoints = [...byTag.get(tag)!].sort((a, b) =>
      `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
    );
    for (const e of endpoints) {
      const integration = e.integration ? `; integration: OPENEOC_INTEGRATIONS=${e.integration}` : "";
      lines.push(
        `- \`${e.method} ${e.path}\`: ${e.summary} (auth: ${e.auth}; audience: ${e.audience}${integration})`,
      );
    }
    lines.push(``);
  }
  lines.push(`## WebSocket channels`, ``);
  for (const w of contract.websockets) lines.push(`- \`${w.path}\`: ${w.summary}`);
  lines.push(``, `## Webhook events`, ``);
  for (const h of contract.webhooks) lines.push(`- \`${h.name}\`: ${h.summary}`);
  lines.push(``);
  return lines.join("\n");
}
