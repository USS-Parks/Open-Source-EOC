# Roadmap

The authoritative sequence is the build roster
(`docs/VIRTUAL-EOC-PSPR-2026-09-17.md`). Live status per capability is
`docs/FACET-STATUS.md`, with per-prompt receipts in
`docs/VEOC-EXECUTION-LEDGER.md`. This file is the readable summary.

It tracks three separate bars, because "the code exists" is not "an operator
can use it," and neither is "it can be released":

- **Backend:** built, tested, CI-green.
- **Operator UI:** a person can actually do it from the web console.
- **Release gate:** the Phase G bar (real load, live pilot) is met.

| Phase | Scope | Backend | Operator UI |
|---|---|---|---|
| A | Foundation and governance: scaffold, license, data dictionary, architecture decisions, design system, CI gates | complete | n/a |
| B | Core primitives: identity and positions, boards, immutable audit, incidents, real-time sync, notifications, files, search, native messaging | complete | yes |
| C | Geospatial COP: geo-enabled boards, the map, dashboards, live feeds, situation reporting | complete | yes |
| D | Field and offline: offline-first client, smart forms, damage assessment, check-in, tracking and reunification | complete | partial |
| E | Interop and federation: CAP, EDXL, facility status networks, CoT/TAK, instance federation, public API, IPAWS connector | complete | none |
| F | Collaboration and ICS operations: incident spaces, meetings, the JIC, ICS forms and IAP, resource requests, after-action | complete | partial |
| G | Hardening and release: security, load (150+ concurrent users), accessibility, packaging, docs, pilot exercise, 1.0 disposition | partial | n/a |

## Where the bars actually sit

- **B:** boards, the activity log, incidents, file upload, platform search, and
  native messaging (direct and position-addressed threads) are all reachable in
  the console.
- **C:** the map, dashboards, situation reports, and external feed layers are
  live in the app, with drop-a-point field capture and a switchable
  satellite/imagery basemap.
- **D:** offline sync semantics are built and tested, and the map has
  drop-a-point capture. Still missing: photo capture, the smart-form runner,
  and the damage-assessment and check-in screens.
- **E:** standards in and out and instance federation work server-side. No
  operator UI. IPAWS is a scaffold, not live-credentialed.
- **F:** ICS forms 201-208, 211, 213-215 build, preview, and export to PDF from
  the Forms screen, assembled into an IAP with an approval step. Resource
  requests, the JIC, and after-action have no dedicated screen yet, and the 204
  assignment list is shallow.
- **G:** security, accessibility, packaging, and docs are substantially done,
  and the 150-distinct-concurrent-user load test now passes as a CI gate (each
  user logs in to its own session and fires a request under its own RLS
  context). The live pilot has not run (gated on Basho). AR7 (disconnected
  provisioning) is deferred.

## Honest one-line status

A tested A-F backend with an operator console that now covers the map and
drop-a-point field capture, dashboards, boards, incidents, situation reports,
ICS forms and the IAP, and files and search. Still missing: operator UI for
interop/IPAWS, and parts of the field (photo, damage assessment, check-in) and
collaboration (JIC) phases. The 150-concurrent-user load gate now passes in
CI; the live pilot remains (gated on Basho). Not "1.0" yet.

Nothing is deployable before Phase G closes on its real terms: the 150+
concurrent-user load test met, and the live pilot run.
