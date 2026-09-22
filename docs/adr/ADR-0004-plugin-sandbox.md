# ADR-0004: Implemented extension and deployment architecture

Status: accepted, 2026-09-22 (V1 W0.3)

Supersedes the original ADR-0004 QuickJS plugin-sandbox decision and
[ADR-0007](./ADR-0007-deploy-targets.md). Neither earlier architecture was
implemented. This restatement records the seams that actually shipped.

## Decision

### Extension model

Open Source EOC does not execute jurisdiction-authored JavaScript or ship a
plugin runtime. Board customization is declarative:

- versioned field schemas;
- input, list and detail layouts;
- bounded conditions and calculations;
- saved views;
- workflow states, assignments, approvals, due rules and escalation;
- immutable template publication and upgrade preflight.

The server remains authoritative for validation, authorization, workflow
execution and migration. There is no QuickJS or other embedded code-execution
dependency. Any future executable plugin surface requires a new threat model
and ADR; it is not implied by the existing designer.

### Deployment model

Two paths exist:

1. **Windows desktop:** the stronger and better-proven path. A per-user
   installer stages the application around a local Node/PostgreSQL/PostGIS
   runtime, local static host and PMTiles assets. Cold setup, RLS runtime,
   offline reconciliation and persistent restart are proven on one prepared
   Windows host. Independent media transfer and second-machine setup remain
   unproven.
2. **Docker Compose server:** PostGIS and the API run in containers with a
   persistent blob volume. The current reference path does not yet ship the web
   application, TLS termination or first-administrator bootstrap.

No martin sidecar, bare-metal Linux installer or complete air-gap bundle was
built. Basemaps and buildings use PMTiles; bounded operational data currently
uses the application API and GeoJSON/OGC paths. The V1 roster owns the supported
HTTPS install, operational vector tiles, upgrade/recovery path and independent
transfer proof.

## Grounds

The declarative model satisfies the actual no-code board requirement without
introducing an untrusted-code execution surface. The two deployment paths are
the ones with source, tests and receipts. Recording them prevents an accepted
but unbuilt design from being mistaken for current architecture.

## Consequences

- Arbitrary plugin code is outside the product contract.
- The Windows path is usable only with its documented prerequisites.
- Docker is a server path, not yet a turnkey product install.
- Version 1.0 remains explicitly single-node unless a later ADR records a
  shared-store decision and implementation.
- Missing deployment behavior stays in the V1 roster; this ADR does not claim
  it as delivered.

## Reversal cost

Adding a plugin runtime or replacing either deployment path requires a new ADR,
security boundary and migration plan. The declarative contracts and stored
board definitions remain reusable.
