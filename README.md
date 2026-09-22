# Open Source EOC

Open Source EOC is a local-first emergency operations platform with operational
boards, a map-led common operating picture, ICS workflows, offline field work,
and native CAP, EDXL, CoT, HAVE and GeoJSON interchange.

## Status

Pre-1.0 development. The Master PSPR is technically complete through its M4
gate. A prepared Windows host can run the packaged desktop path, and the Docker
path can run the API and PostGIS services. Neither path is yet a turnkey county
deployment:

- the Windows proof used a prepared host and local map archives; independent
  media transfer and second-machine setup have not been proven;
- the Docker path does not yet ship a web service, TLS termination or
  first-administrator bootstrap;
- live IPAWS, real-hardware 150-user load, representative-operator comparison,
  manual screen-reader evidence and a pilot remain open;
- observability, scheduled work, durable outbound delivery, MFA, retention,
  route-to-screen coverage and release operations are owned by the V1 PSPR.

This is an installable evaluation build, not a version 1.0 release and not a
commercial-parity certification.

## Governance and current truth

- `docs/V1-PSPR-2026-09-22.md` is the current approved execution roster.
- `docs/MASTER-PSPR-2026-09-21.md` records the completed technical roster and
  the acceptance work that carries forward.
- `docs/VEOC-EXECUTION-LEDGER.md` contains prompt receipts and evidence.
- `docs/VEOC-PARITY-MATRIX.md` and `docs/FACET-STATUS.md` contain current
  capability status and explicit remaining boundaries.
- `docs/design/canonical-references/` is the visual authority.

License: Apache-2.0. See `LICENSE`.

## Workspace layout

- `server/` - Node and Fastify backend in TypeScript.
- `web/` - React operator application in TypeScript.
- `shared/` - contracts and types shared by server and web.
- `deploy/` - Docker, Windows desktop and local-data deployment tooling.
- `docs/` - operator guides, architecture, evidence and governed plans.

## Development

Requires Node 22+ and pnpm 10+.

    pnpm install --frozen-lockfile
    pnpm check

The serial milestone gate is:

    pnpm check:gate

Database-backed tests use the project-local test runtime documented in
`deploy/test-runtime/README.md`.

## Deployment

Use `docs/WINDOWS-DESKTOP.md` for the prepared Windows path and
`deploy/README.md` for the Docker server path. Read their prerequisites and
limitations before treating either as operational deployment guidance.
