# ADR-0007: Deploy targets are compose-first with a single-node installer

Status: superseded, 2026-09-22, by
[ADR-0004](./ADR-0004-plugin-sandbox.md), which records the deployment paths
that were actually built.

## Decision

Three supported paths, in priority order (implemented at VEOC-40):

1. **Docker compose reference:** server, Postgres+PostGIS, martin tile
   sidecar, optional collaboration containers; the canonical deployment.
2. **Single-node installer:** one script for a bare Linux host (county IT
   without container skills), using the same components as systemd units.
3. **Air-gap bundle:** the compose path with all images, npm store, and
   PMTiles basemaps packaged offline; install and provision with zero
   outbound network (INV-3).

Not supported as first-class: Kubernetes manifests (community territory;
nothing may depend on them), and any hyperscaler-managed service (AR5).

## Alternatives considered

- **Kubernetes-first:** operationally wrong for the audience; a county EOC
  is one box in a closet, not a cluster.
- **SaaS-first:** recreates the incumbent lock-in and violates INV-3.

## Grounds

The research's adoption finding: ntfy-class single-binary simplicity is a
real adoption force in county IT. Compose is the maintainable center;
the installer covers the rest.

## Reversal cost

Low; deployment packaging sits outside product code by construction.
