# Open Source EOC

Open Source EOC is a local-first emergency operations platform with operational
boards, a map-led common operating picture, ICS workflows, offline field work,
and native CAP, EDXL, CoT, HAVE and GeoJSON interchange.

## Status

Version `0.9.0`, an evaluation build. No release has been tagged. The Finish
PSPR's waves W1 to W7 have been executed as far as they can go without
Basho's inputs: every engineering unit has landed with a receipt in the
[V1 ledger](./docs/process/V1-LEDGER.md), and the remaining blockers and the
release decision are in [RELEASE-DECISION.md](./RELEASE-DECISION.md).

Proven on the project's own machines with synthetic data: boards, notifications
and reports run through the WebEOC side-by-side script; an incident shared by
two organizations across two instances; two-step sign-in, the two-person IPAWS
send against a local stand-in, administration without the command line, and
a 150-connection two-hour run on a development workstation. The
[evaluator's page](./docs/EVALUATOR.md) states each claim with its evidence
level.

Still open, and not in the project's hands:

- the Windows setup is built with the map archives but has not been installed
  from media on a second, disconnected computer;
- the shared host for Windows and the macOS workstation and host are
  scheduled in [the readiness plan](./docs/process/READINESS-PSPR-2026-09-24.md);
- live IPAWS, real-hardware 150-user load, representative-operator comparison,
  the manual screen-reader pass, a second maintainer and a pilot jurisdiction.

This is an installable evaluation build, not a version 1.0 release and not a
commercial-parity certification. The known limits of the build are in
[CHANGELOG.md](./CHANGELOG.md).

## Governance and current truth

- `docs/process/FINISH-PSPR-2026-09-22.md` is the current approved execution
  roster and the only live one.
- `docs/process/archive/` holds the rosters it supersedes, including the
  completed technical roster and the acceptance work that carries forward.
- `docs/process/V1-LEDGER.md` contains unit receipts and evidence for the
  current roster. `docs/process/VEOC-EXECUTION-LEDGER.md` is frozen and holds
  the receipts that preceded it.
- `docs/VEOC-PARITY-MATRIX.md` and `docs/FACET-STATUS.md` contain current
  capability status and explicit remaining boundaries, reconciled to the
  receipts on 2026-09-24.
- `RELEASE-DECISION.md` gives the state of each gate in the Finish PSPR's
  section 6, the remaining blockers and the one release decision for Basho.
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

OIDC sign-in is optional too. Its two routes, `GET /api/v1/auth/oidc/start`
and `GET /api/v1/auth/oidc/callback`, register only when
`OPENEOC_OIDC_ISSUER` is set; `OPENEOC_OIDC_CLIENT_ID`,
`OPENEOC_OIDC_CLIENT_SECRET` and `OPENEOC_OIDC_REDIRECT_URI` name the client.
The identity provider owns the second factor for those accounts; see
[two-step sign-in](./docs/guides/ADMIN.md#two-step-sign-in-mfa).

## Workspace layout

- `server/` - Node and Fastify backend in TypeScript.
- `web/` - React operator application in TypeScript.
- `shared/` - contracts and types shared by server and web.
- `deploy/` - Windows desktop, installer and local-data deployment tooling.
- `docs/` - operator guides, architecture, evidence and governed plans.
- `tools/` - map archive, gazetteer and map symbol build tools.
- `scripts/` - repository checks: links, licenses, advisories, the bundle
  budget, the pre-commit gate and the load harnesses.

## Development

Requires Node 22+ and pnpm 10+.

    pnpm install --frozen-lockfile
    pnpm check

The serial milestone gate is:

    pnpm check:gate

Database-backed tests use the project-local test runtime documented in
`deploy/test-runtime/README.md`.

## Deployment

Open Source EOC runs on Windows and macOS machines; there is no Linux or
Docker deployment ([ADR-0010](./docs/adr/ADR-0010-windows-and-macos.md)).
`deploy/README.md` says what is built for each platform and how it is
operated, and `docs/WINDOWS-DESKTOP.md` covers the Windows launcher. Read
their prerequisites and limitations before treating either as operational
deployment guidance.
