/**
 * Frozen public API contract (VEOC-31, INV-4/INV-9). The versioned surface
 * third parties build against: REST endpoints, the sync WebSocket, webhook
 * event types, and the OGC/GeoJSON Features surfaces from VEOC-16. The docs
 * generate from this contract, and a contract test holds the running app to
 * it, so the published surface and the code cannot drift apart.
 */

export const API_VERSION = "v1";

export interface RestEndpoint {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly tag: string;
  readonly summary: string;
  readonly auth: "bearer" | "peer-token" | "feed-token" | "intake-token" | "none";
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

const rest: RestEndpoint[] = [
  { method: "POST", path: "/api/v1/auth/login", tag: "auth", summary: "Exchange credentials for tokens", auth: "none" },
  { method: "POST", path: "/api/v1/auth/resume", tag: "auth", summary: "Renew a session from a resume token", auth: "none" },
  { method: "GET", path: "/api/v1/me", tag: "auth", summary: "The current principal", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/boards", tag: "boards", summary: "Create a board from a template", auth: "bearer" },
  { method: "GET", path: "/api/v1/boards/:boardId", tag: "boards", summary: "The effective board", auth: "bearer" },
  { method: "POST", path: "/api/v1/boards/:boardId/records", tag: "boards", summary: "Create a record", auth: "bearer" },
  { method: "PATCH", path: "/api/v1/boards/:boardId/records/:recordId", tag: "boards", summary: "Update a record", auth: "bearer" },
  { method: "GET", path: "/api/v1/boards/:boardId/views/:viewKey", tag: "boards", summary: "Records through a view", auth: "bearer" },
  { method: "GET", path: "/api/v1/ogc", tag: "geo", summary: "OGC API - Features landing", auth: "bearer" },
  { method: "GET", path: "/api/v1/ogc/conformance", tag: "geo", summary: "Conformance classes", auth: "bearer" },
  { method: "GET", path: "/api/v1/ogc/collections", tag: "geo", summary: "Feature collections", auth: "bearer" },
  { method: "GET", path: "/api/v1/ogc/collections/:boardId/items", tag: "geo", summary: "Features as GeoJSON", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/cap/alerts", tag: "cap", summary: "Author a CAP 1.2 alert", auth: "bearer" },
  { method: "GET", path: "/api/v1/jurisdictions/:jurisdictionId/cap/alerts", tag: "cap", summary: "List readable CAP alert records and local review state", auth: "bearer" },
  { method: "GET", path: "/api/v1/cap/alerts/:id", tag: "cap", summary: "Read one CAP alert record", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/cap/drafts", tag: "cap", summary: "Store an unsent local CAP draft or exercise", auth: "bearer" },
  { method: "POST", path: "/api/v1/cap/alerts/:id/review", tag: "cap", summary: "Append a local CAP review state", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/cap/ingest", tag: "cap", summary: "Ingest external CAP XML", auth: "bearer" },
  { method: "GET", path: "/api/v1/notifications", tag: "notifications", summary: "List visible notification and delivery records", auth: "bearer" },
  { method: "POST", path: "/api/v1/notifications/:notificationId/read", tag: "notifications", summary: "Mark an assigned notification read", auth: "bearer" },
  { method: "POST", path: "/api/v1/notifications/:notificationId/acknowledge", tag: "notifications", summary: "Acknowledge an assigned notification with attribution", auth: "bearer" },
  { method: "POST", path: "/api/v1/boards/:boardId/records/:recordId/edxl", tag: "interop", summary: "Emit a 213RR as EDXL", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/edxl/import", tag: "interop", summary: "Import an EDXL envelope", auth: "bearer" },
  { method: "GET", path: "/api/v1/jurisdictions/:jurisdictionId/facilities/have", tag: "interop", summary: "Export facility status as EDXL-HAVE", auth: "bearer" },
  { method: "POST", path: "/api/v1/federation/receive", tag: "federation", summary: "Receive a peer's forwarded updates", auth: "peer-token" },
  { method: "POST", path: "/api/v1/feeds/:feedId/ingest", tag: "feeds", summary: "Push into a feed", auth: "feed-token" },
  { method: "GET", path: "/api/v1/jurisdictions/:jurisdictionId/ipaws", tag: "ipaws", summary: "IPAWS enablement status", auth: "bearer" },
  { method: "PUT", path: "/api/v1/jurisdictions/:jurisdictionId/ipaws/config", tag: "ipaws", summary: "Configure the IPAWS-OPEN COG", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/ipaws/moa", tag: "ipaws", summary: "Acknowledge the documented MOA", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/ipaws/enable", tag: "ipaws", summary: "Enable or disable IPAWS transmission", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/ipaws/test", tag: "ipaws", summary: "Run an IPAWS test-environment handshake", auth: "bearer" },
  { method: "POST", path: "/api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws", tag: "ipaws", summary: "Transmit a CAP alert to IPAWS", auth: "bearer" },
];

const websockets: WsChannel[] = [
  { path: "/api/v1/sync/boards/:boardId", summary: "CRDT board sync" },
  { path: "/api/v1/dashboards/:dashboardId/stream", summary: "Live dashboard snapshots" },
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
    `This document is generated from the frozen API contract. Every REST`,
    `endpoint below is held to the running server by a contract test.`,
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
    for (const e of byTag.get(tag)!) {
      lines.push(`- \`${e.method} ${e.path}\` — ${e.summary} (auth: ${e.auth})`);
    }
    lines.push(``);
  }
  lines.push(`## WebSocket channels`, ``);
  for (const w of contract.websockets) lines.push(`- \`${w.path}\` — ${w.summary}`);
  lines.push(``, `## Webhook events`, ``);
  for (const h of contract.webhooks) lines.push(`- \`${h.name}\` — ${h.summary}`);
  lines.push(``);
  return lines.join("\n");
}
