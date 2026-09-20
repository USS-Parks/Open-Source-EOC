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
| B | Core primitives: identity and positions, boards, immutable audit, incidents, real-time sync, notifications, files, search, native messaging | complete | partial |
| C | Geospatial COP: geo-enabled boards, the map, dashboards, live feeds, situation reporting | complete | mostly |
| D | Field and offline: offline-first client, smart forms, damage assessment, check-in, tracking and reunification | complete | not built |
| E | Interop and federation: CAP, EDXL, facility status networks, CoT/TAK, instance federation, public API, IPAWS connector | complete | none |
| F | Collaboration and ICS operations: incident spaces, meetings, the JIC, ICS forms and IAP, resource requests, after-action | complete | none |
| G | Hardening and release: security, load (150+ concurrent users), accessibility, packaging, docs, pilot exercise, 1.0 disposition | partial | n/a |

## Where the bars actually sit

- **B:** boards, the activity log, and incidents are reachable in the console.
  Files, search, and native messaging exist server-side with no UI yet.
- **C:** the map, dashboards, situation reports, and external feed layers are
  live in the app. There is no draw-on-map or pin-drop.
- **D:** offline sync semantics are built and tested. No field-capture UI:
  no pin-drop, no photo capture, no smart-form runner in the app.
- **E:** standards in and out and instance federation work server-side. No
  operator UI. IPAWS is a scaffold, not live-credentialed.
- **F:** ICS forms 201-208, 211, 213-215 build and export to PDF through the
  API, assembled into an IAP with an approval step. There is no Forms or IAP
  screen in the console, and the 204 assignment list is shallow.
- **G:** security, accessibility, packaging, and docs are substantially done.
  The load test measures operation throughput, not 150 concurrent
  authenticated users. The live pilot has not run (gated on Basho). AR7
  (disconnected provisioning) is deferred.

## Honest one-line status

A tested A-F backend with a working but partial operator console, hardening
mostly in place, release gates open. Not "1.0"; a 1.0 backend candidate with
a half-built front end.

Nothing is deployable before Phase G closes on its real terms: the 150+
concurrent-user load test met, and the live pilot run.
