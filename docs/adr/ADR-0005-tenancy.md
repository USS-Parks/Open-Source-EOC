# ADR-0005: Tenancy is one database with enforced jurisdiction scoping

Status: accepted, 2026-09-17 (VEOC-04)

## Decision

- One PostgreSQL database per instance; every tenant-owned row carries a
  `jurisdiction_id`.
- PostgreSQL row-level security enforces jurisdiction scoping at the
  database layer, in addition to (never instead of) service-layer checks:
  two independent walls, both fail-closed (INV-7).
- Cross-jurisdiction visibility is an explicit grant (mutual-aid guest
  access, shared boards), materialized as scoped policies, never a default.
- Multi-instance separation (a county running its own server) is the
  federation layer's job (VEOC-30), not tenancy's.

## Alternatives considered

- **Database-per-tenant:** strongest isolation but multiplies migration,
  backup, and upgrade cost per jurisdiction: the wrong trade for county IT
  self-hosting (AR7, INV-10).
- **Schema-per-tenant:** middle ground, but PostgREST-style schema
  explosion complicates RLS, pooling, and the sync layer for little gain
  at the 150-user scale contract (R1).

## Reversal cost

High once data exists; mitigated by `jurisdiction_id` being on every row
from birth, which is the hard prerequisite for any later split.
