# Open Source EOC Public API (v1)

This document is generated from the frozen API contract. Every REST
endpoint below is held to the running server by a contract test.

## REST

### auth

- `POST /api/v1/auth/login` — Exchange credentials for tokens (auth: none)
- `POST /api/v1/auth/resume` — Renew a session from a resume token (auth: none)
- `GET /api/v1/me` — The current principal (auth: bearer)

### boards

- `POST /api/v1/jurisdictions/:jurisdictionId/boards` — Create a board from a template (auth: bearer)
- `GET /api/v1/boards/:boardId` — The effective board (auth: bearer)
- `POST /api/v1/boards/:boardId/records` — Create a record (auth: bearer)
- `PATCH /api/v1/boards/:boardId/records/:recordId` — Update a record (auth: bearer)
- `GET /api/v1/boards/:boardId/views/:viewKey` — Records through a view (auth: bearer)

### cap

- `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts` — Author a CAP 1.2 alert (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/ingest` — Ingest external CAP XML (auth: bearer)

### federation

- `POST /api/v1/federation/receive` — Receive a peer's forwarded updates (auth: peer-token)

### feeds

- `POST /api/v1/feeds/:feedId/ingest` — Push into a feed (auth: feed-token)

### geo

- `GET /api/v1/ogc` — OGC API - Features landing (auth: bearer)
- `GET /api/v1/ogc/conformance` — Conformance classes (auth: bearer)
- `GET /api/v1/ogc/collections` — Feature collections (auth: bearer)
- `GET /api/v1/ogc/collections/:boardId/items` — Features as GeoJSON (auth: bearer)

### interop

- `POST /api/v1/boards/:boardId/records/:recordId/edxl` — Emit a 213RR as EDXL (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/edxl/import` — Import an EDXL envelope (auth: bearer)
- `GET /api/v1/jurisdictions/:jurisdictionId/facilities/have` — Export facility status as EDXL-HAVE (auth: bearer)

### ipaws

- `GET /api/v1/jurisdictions/:jurisdictionId/ipaws` — IPAWS enablement status (auth: bearer)
- `PUT /api/v1/jurisdictions/:jurisdictionId/ipaws/config` — Configure the IPAWS-OPEN COG (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/moa` — Acknowledge the documented MOA (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/enable` — Enable or disable IPAWS transmission (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/test` — Run an IPAWS test-environment handshake (auth: bearer)
- `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws` — Transmit a CAP alert to IPAWS (auth: bearer)

## WebSocket channels

- `/api/v1/sync/boards/:boardId` — CRDT board sync
- `/api/v1/dashboards/:dashboardId/stream` — Live dashboard snapshots

## Webhook events

- `record.created` — A board record was created
- `record.updated` — A board record was updated
