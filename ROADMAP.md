# Roadmap

## Current program

The [V1 PSPR](./docs/V1-PSPR-2026-09-22.md) is the approved execution
authority. It begins after technical completion of the
[Master PSPR](./docs/MASTER-PSPR-2026-09-21.md) and turns the current
evaluation build into a county-deployable release.

The Master roster is complete through Phase 3 and M4. That establishes a
substantial, tested application. It does not establish a live pilot,
commercial parity, representative-operator acceptance or release readiness.
Current capability truth is in the
[parity matrix](./docs/VEOC-PARITY-MATRIX.md), the
[facet register](./docs/FACET-STATUS.md), and the
[execution ledger](./docs/VEOC-EXECUTION-LEDGER.md).

## Current deployment boundary

- A prepared Windows host has completed cold setup, local map use, runtime RLS,
  offline work reconciliation and persistent restart.
- Independent media transfer and deployment on a second machine are absent.
- Docker Compose runs PostGIS and the API, but the documented path does not yet
  include the web application, TLS or first-administrator bootstrap.
- The architecture is explicitly single-node until V1 records a different
  decision. Several runtime limiters, caches and live hubs are process-local.
- Live IPAWS, live external data acquisition, real-hardware 150-user load and
  a pilot remain evidence gates.

The product is therefore installable for evaluation on a prepared host. It is
not yet the version 1.0 release a county can install and operate unassisted.

## V1 sequence

| Wave | Purpose | Current status |
|---|---|---|
| W0 | Close the Master roster and reconcile repository truth | Complete; gate passed 2026-09-22 |
| W1 | Remove or relocate non-product and obsolete delivery surface | In progress; W1.0-W1.3 complete, W1.4 next |
| W2 | Harden one real activation: queues, scheduling, scale, security, observability and retention | Not started |
| W3 | Put an operator screen in front of delivered engines | Not started |
| W4 | Add parity depth where engines or data are genuinely missing | Not started |
| W5 | Reduce initial client weight and consolidate presentation | Not started |
| W6 | Build the supported install, upgrade, recovery and adoption path | Not started |
| W7 | Run integrated, accessibility, operator, hardware and release acceptance | Not started |

W1 lands before W2 and W3. The engine and presentation waves may fan out only
as the V1 PSPR permits. W7 does not convert missing external inputs into proof.

## What is already delivered

- Incident-scoped boards, audit, files, messaging, tasks, resources, IAP,
  Lifeline/ESF assessment, briefings, JIC review and after-action workflows.
- A responsive, persistent operator shell with operational board, map,
  dashboard, field, dataset, feed, alert and administration-adjacent surfaces.
- Native CAP, EDXL, CoT, HAVE and GeoJSON contracts; federation and
  store-and-forward foundations.
- Local PMTiles basemaps, operational overlays, the agreed NAPSG subset,
  exact-lineage Overture enrichment and loaded-source impact analysis.
- A Windows desktop package and continuity proof on one prepared machine.

## What blocks version 1.0

The binding list is V1 PSPR section 8. The largest groups are:

1. durable outbound delivery, a scheduler and long-activation resource bounds;
2. structured logs, metrics, retention, recovery and upgrade operations;
3. secure deployment defaults, MFA, two-person IPAWS authority and webhook
   controls;
4. operator reachability for engines that still require curl or have no route;
5. email/SMS reach, board/reporting depth and operational vector tiles;
6. one-command HTTPS deployment and independent Windows transfer proof;
7. real-hardware load, manual accessibility, representative operators, a pilot
   and the final release disposition.

## Release rule

Code, operator workflow and release evidence are separate bars. A technical
receipt closes only the behavior it tested. Version 1.0 requires every V1 gate
to pass or an explicit written waiver, followed by Basho's release decision.
