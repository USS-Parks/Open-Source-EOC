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
- the Docker path's one-command HTTPS install (`deploy/install.sh`) is
  validated offline only; its first run on a Linux host has not been made;
- live IPAWS, real-hardware 150-user load, representative-operator comparison,
  manual screen-reader evidence and a pilot remain open;
- observability, scheduled work, durable outbound delivery, MFA, retention,
  route-to-screen coverage and release operations are owned by the V1 PSPR.

This is an installable evaluation build, not a version 1.0 release and not a
commercial-parity certification.

## Governance and current truth

- `docs/process/FINISH-PSPR-2026-09-22.md` is the current approved execution
  roster and the only live one.
- `docs/process/archive/` holds the rosters it supersedes, including the
  completed technical roster and the acceptance work that carries forward.
- `docs/process/V1-LEDGER.md` contains unit receipts and evidence for the
  current roster. `docs/process/VEOC-EXECUTION-LEDGER.md` is frozen and holds
  the receipts that preceded it.
- `docs/VEOC-PARITY-MATRIX.md` and `docs/FACET-STATUS.md` contain current
  capability status and explicit remaining boundaries.
- `docs/design/canonical-references/` is the visual authority.
- `docs/EVALUATOR.md` states scope, limits and evidence for a pilot decision.

License: Apache-2.0. See `LICENSE`.

## Optional integrations

Four modules register no routes and show no screens unless the server's
`OPENEOC_INTEGRATIONS` setting names them, comma-separated, for example
`OPENEOC_INTEGRATIONS=facilities,tracking`. The setting is read at start.

| Value | What it turns on |
|---|---|
| `collab` | Incident channels in an external collaboration backend, with membership kept in step with position assignments |
| `meetings` | Incident meetings through a Jitsi bridge, and scheduled briefings |
| `tracking` | Scan-first tracked objects, custody events and reunification |
| `facilities` | Facility status networks, status queries, HAVE exchange and the shelter census in damage assessment |

`tracking` and `facilities` are not reviewed for patient-level data in this
release. See [ADR-0009](./docs/adr/ADR-0009-optional-integrations.md).

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
