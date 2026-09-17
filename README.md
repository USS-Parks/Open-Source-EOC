# Open Source EOC

An open-source virtual Emergency Operations Center platform: status boards,
a live common operating picture, ICS workflow, offline field operation, and
native emergency-data standards (CAP, EDXL, CoT, GeoJSON), built to match
the user-facing strength of the commercial incumbents without their lock-in.

## Status

Pre-alpha. Executing Phase A (foundation and governance) of the build roster.
Nothing here is deployable yet.

## Governance and authority

- `CLAUDE.md` - working canon for this repository (binding).
- `docs/VIRTUAL-EOC-PSPR-2026-09-17.md` - the canonical build roster.
- `docs/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` - research basis.
- `docs/VEOC-EXECUTION-LEDGER.md` - session receipts.
- `docs/FACET-STATUS.md` - live status of every facet and invariant.

License: Apache-2.0 (decision recorded 2026-09-17; LICENSE file lands with
the governance documents in roster session VEOC-02).

## Workspace layout

- `server/` - Node backend (TypeScript).
- `web/` - React front end (TypeScript).
- `shared/` - schemas and types shared by server and web.
- `field-node/` - optional Rust single-binary field gateway (placeholder).
- `deploy/` - deployment configurations.

## Development

Requires Node 22+ and pnpm 10+.

    pnpm install
    pnpm check
