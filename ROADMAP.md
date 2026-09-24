# Roadmap

## Current program

The [Finish PSPR](./docs/process/FINISH-PSPR-2026-09-22.md) is the approved
execution authority and the only live roster. It turns the current evaluation
build into a county-deployable release. The rosters it supersedes, including
the Master PSPR and the V1 PSPR whose unit identifiers it keeps, are in
[`docs/process/archive/`](./docs/process/archive/).

Waves W1 to W6 of the Finish PSPR are complete. W7 has run as far as it can
without Basho's inputs: the integrated exercise and the visual and
accessibility review, the M5 gate, reduced motion and higher contrast, the
recorded absences of the operator comparison and the real-hardware run, and
the reconciliation that presents the release decision in
[RELEASE-DECISION.md](./RELEASE-DECISION.md). That establishes a substantial,
tested application. It does not establish a live pilot, commercial parity,
representative-operator acceptance or release readiness.
Current capability truth is in the
[parity matrix](./docs/VEOC-PARITY-MATRIX.md), the
[facet register](./docs/FACET-STATUS.md), the
[V1 ledger](./docs/process/V1-LEDGER.md), and the frozen
[execution ledger](./docs/process/VEOC-EXECUTION-LEDGER.md) behind it.

## Current deployment boundary

- A prepared Windows host has completed cold setup, local map use, runtime RLS,
  offline work reconciliation and persistent restart. The `0.9.0` setup is
  built with the California street, building and overlay archives and the
  address search gazetteer.
- Installing that setup from media on a second, disconnected computer has not
  been done.
- Open Source EOC runs on Windows and macOS machines only
  ([ADR-0010](./docs/adr/ADR-0010-windows-and-macos.md)); the Docker path was
  removed on 2026-09-24. The shared Windows host and the macOS workstation and
  host are scheduled in
  [the readiness plan](./docs/process/READINESS-PSPR-2026-09-24.md).
- The architecture is declared single-node for v1. Several runtime limiters,
  caches and live hubs are process-local.
- Live IPAWS, live external data acquisition, real-hardware 150-user load and
  a pilot remain evidence gates.

The product is therefore installable for evaluation. It is not yet the
version 1.0 release a county can install and operate unassisted.

## V1 sequence

| Wave | Purpose | Current status |
|---|---|---|
| W0 | Close the Master roster and reconcile repository truth | Complete; gate passed 2026-09-22 |
| W1 | Remove or relocate non-product and obsolete delivery surface | Complete; gate passed 2026-09-23 |
| W2 | Harden one real activation: queues, scheduling, scale, security, observability and retention | Complete; "V1 W2 milestone gate". W2.12, taking network calls out of every write transaction, was added during execution and landed on 2026-09-24 |
| W3 | Put an operator screen in front of delivered engines | Complete; "V1 W3 milestone gate" |
| W4 | Add parity depth where engines or data are genuinely missing | Complete; "V1 W4 milestone gate" |
| W5 | Reduce initial client weight and consolidate presentation | Complete; code splitting, style consolidation, asset delivery and the remaining interface findings are receipted |
| W6 | Build the supported install, upgrade, recovery and adoption path | Complete to the external boundary; the first real Linux install, upgrade and scheduled backup, and the second-machine install, are Basho's |
| W7 | Run integrated, accessibility, operator, hardware and release acceptance | Executed to Basho's inputs; "V1 M5 milestone gate" green after a walk fix; the screen-reader pass, operators and real hardware are external; the release decision is presented |

W1 lands before W2 and W3. The engine and presentation waves may fan out only
as section 8 of the Finish PSPR permits. W7 does not convert missing external
inputs into proof.

## What is already delivered

- Incident-scoped boards, audit, files, messaging, tasks, resources, IAP,
  Lifeline/ESF assessment, briefings, JIC review and after-action workflows.
- A responsive, persistent operator shell with operational board, map,
  dashboard, field, dataset, feed and alert screens, and an Administration
  screen, so no administrative task after the first administrator needs the
  command line. Every operator route has a screen.
- Native CAP, EDXL, CoT, HAVE and GeoJSON contracts; federation and
  store-and-forward.
- A durable outbound delivery queue and an in-process scheduler; structured
  logs and metrics; retention and signed audit export; two-step sign-in; the
  two-person IPAWS send and webhook allowlists; no network call inside a write
  transaction.
- Email and SMS, contacts and mass notification; board depth with record
  rules, history, import and export, and kanban, calendar and chart views;
  saved reports with PDF and Excel on a schedule; a WebEOC records importer.
- Local PMTiles basemaps, operational overlays and vector tiles, the agreed
  NAPSG subset, exact-lineage Overture enrichment, offline address search and
  loaded-source impact analysis.
- NIMS resource typing, incident archival, the jurisdiction's incident view
  and per-incident lockdown.
- An installable web app with an offline shell; reduced motion and higher
  contrast.
- Upgrade with a forced backup, a disaster recovery runbook with scheduled
  backups, the `0.9.0` Windows setup,
  a training kit, a security policy and a changelog.

## What blocks version 1.0

The binding list is section 6 of the Finish PSPR, and
[RELEASE-DECISION.md](./RELEASE-DECISION.md) gives each line's state. What
remains:

1. external inputs: real deployment hardware for the 150-user run, a second
   computer for the setup transfer, a Linux host for the first real install,
   upgrade and scheduled backup, IPAWS-OPEN credentials and the MOA,
   representative operators, the NVDA and VoiceOver pass, a second maintainer
   or a written waiver, and a pilot jurisdiction;
2. Basho's decisions, each with a default in force: cross-organization
   resource request ownership, the lockdown default, the version on the health
   route, the visual review findings, SAML and the product name;
3. license notices for the runtimes and map archives in the Windows setup,
   needed before any setup is published;
4. Basho's aesthetic and functional acceptance of the release candidate.

## Release rule

Code, operator workflow and release evidence are separate bars. A technical
receipt closes only the behavior it tested. Version 1.0 requires every gate in
section 6 of the Finish PSPR to pass or an explicit written waiver, followed by
Basho's release decision.
