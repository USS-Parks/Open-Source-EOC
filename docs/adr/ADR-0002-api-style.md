# ADR-0002: API style is versioned REST plus WebSocket

Status: accepted, 2026-09-17 (VEOC-04)

## Decision

- REST under `/api/v1` for request/response operations, zod-validated both
  directions, JSON wire format, GeoJSON for geometry.
- One WebSocket endpoint for real-time: sync documents (ADR-0003), live
  queries, and notification delivery, with typed message envelopes.
- Outbound webhooks with HMAC signatures for integration consumers.
- Standards surfaces (OGC API - Features, CAP, EDXL) are additional
  read/write representations over the same services, never forks.

## Alternatives considered

- **GraphQL:** flexible reads but poor fit for standards surfaces, offline
  sync, and the audit posture; adds a schema layer contributors must learn.
- **gRPC:** strong contracts but hostile to browsers and to county IT
  debugging with curl; the field already speaks REST/JSON.

## Grounds

Interop is the wedge (research section 7): external systems must be able to
consume this platform with nothing but HTTP and JSON. Curl-debuggability is
a real operational property during an incident.

## Reversal cost

Low for additions (new representations mount beside REST). High for
replacing REST itself once agencies integrate; the contract freeze at
VEOC-31 makes v1 permanent, so breaking changes require `/api/v2`.
