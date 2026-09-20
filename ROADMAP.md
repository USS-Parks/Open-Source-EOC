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
| D | Field and offline: offline-first client, smart forms, damage assessment, check-in, tracking and reunification | complete | yes |
| E | Interop and federation: CAP, EDXL, facility status networks, CoT/TAK, instance federation, public API, IPAWS connector | complete | partial |
| F | Collaboration and ICS operations: incident spaces, meetings, the JIC, ICS forms and IAP, resource requests, after-action | complete | yes |
| G | Hardening and release: security, load (150+ concurrent users), accessibility, packaging, docs, pilot exercise, 1.0 disposition | partial | n/a |

## Where the bars actually sit

- **B:** boards, the activity log, incidents, file upload, platform search, and
  native messaging (direct and position-addressed threads) are all reachable in
  the console.
- **C:** the map, dashboards, situation reports, and external feed layers are
  live in the app, with drop-a-point field capture and a switchable
  satellite/imagery basemap.
- **D:** complete for the operator: drop-a-point map capture with a photo,
  the field-reports and damage-assessment (PDA) and check-in boards, the XLSForm
  smart-form runner (renders an imported form and submits to a board), and
  object tracking with custody scans and reunification search.
- **E:** the feeds admin screen registers and polls upstreams (CAP, GeoJSON,
  GeoRSS, CoT) and shows freshness. Instance federation and the EDXL/CoT peer
  exchanges are machine-to-machine APIs by design, not operator screens. IPAWS
  live credentialing is gated (external).
- **F:** ICS forms 201-208/211/213-215 build, preview, and export to PDF from the
  Forms screen, assembled into an IAP with approval. The 213RR resource lifecycle
  and after-action (observations, AAR PDF, corrective actions) have their own
  screens. JIC content (press releases, rumor control, talking points) is
  reachable through the Boards runtime. The 204 assignment list is still shallow.
- **G:** security, accessibility, packaging, and docs are substantially done,
  and the 150-distinct-concurrent-user load test now passes as a CI gate (each
  user logs in to its own session and fires a request under its own RLS
  context). The live pilot has not run (gated on Basho). AR7 (disconnected
  provisioning) is deferred.

## Honest one-line status

A tested A-F backend with an operator console covering the map (with photo
field capture and a switchable imagery basemap), dashboards, boards, incidents,
situation reports, ICS forms and the IAP, the 213RR resource lifecycle,
after-action and corrective actions, files and search, feeds administration, and
native messaging, smart forms, and object tracking/reunification. What remains
is not operator screens: the EDXL/CoT/federation exchanges are machine APIs;
IPAWS live credentialing and the live pilot are external and gated on Basho. The
150-concurrent-user load gate passes in CI.

Nothing is deployable before the live pilot runs (VEOC-42), which is Basho's
call; the code-side release gates are met.
