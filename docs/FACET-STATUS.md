# VEOC Facet, Requirement, and Invariant Status Register

Maintained by roster sessions. Dispositions: `open`, `implemented`, `verified`, `deferred`, `risk-accepted`.
Created by VEOC-00 at baseline `2743fe6f8ac29bedbc4d00175a47d8491777bce4`.

VEOC-43 re-review (2026-09-18): every facet, requirement, anti-requirement,
and invariant is `verified` against CI-green tests, except AR7 (disconnected
provisioning) which is `deferred` to post-1.0. Evidence and the proposed 1.0
disposition are in [INDEPENDENT-REVIEW-VEOC-43.md](./INDEPENDENT-REVIEW-VEOC-43.md).
The 1.0 release decision is Basho's and is not yet recorded.

## Facets (research §3)

| ID | Description | Primary session | Status |
|---|---|---:|---|
| F1 | Board primitive: versioned schema, input + display views | VEOC-09, VEOC-10 | verified |
| F2 | Position login + immutable activity/position logs | VEOC-07, VEOC-11 | verified |
| F3 | Store-and-forward federation, local replication | VEOC-30 | verified |
| F4 | Board-triggered notifications, webhooks, multi-channel | VEOC-14 | verified |
| F5 | ICS forms, IAP builder, 213RR lifecycle | VEOC-34, VEOC-35 | verified |
| F6 | Any board as a live geospatial layer; field-to-COP loop | VEOC-16, VEOC-17 | verified |
| F7 | Offline XLSForm-compatible smart forms | VEOC-22 | verified |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | VEOC-20, VEOC-23 | verified |
| F9 | Pre-disaster baseline data for damage assessment | VEOC-23 | verified |
| F10 | Always-on facility status networks + status queries | VEOC-28 | verified |
| F11 | Scan-first tracking objects + reunification | VEOC-25 | verified |
| F12 | Incident templates instantiating ICS org + checklists | VEOC-12 | verified |
| F13 | Scenario libraries, reference libraries, checklists | VEOC-12 | verified |
| F14 | Calm-screen map-first SPA discipline | VEOC-05, VEOC-17 | verified |
| F15 | Per-incident auto-provisioned collaboration space | VEOC-32, VEOC-33 | verified |
| F16 | One-click role-based provisioning; ten-minute viewer path | VEOC-08, VEOC-41 | verified |
| F17 | Daily-ops usability against skill decay | VEOC-05, VEOC-41 | verified |
| F18 | Sensor and drone live feeds into the COP | VEOC-19 | verified |
| F19 | NAPSG/DHS incident symbology shipped | VEOC-17 | verified |
| F20 | Native standards interchange | VEOC-26..29, VEOC-31 | verified |

## Requirements (Basho, 2026-09-17)

| ID | Requirement | Primary session | Status |
|---|---|---:|---|
| R1 | At least 150 concurrent users per instance | VEOC-38 | verified |
| R2 | IPAWS integration enable-at-will | VEOC-31 | verified |
| R3 | Agency, organization, and volunteer conglomerate COP access | VEOC-08, VEOC-30 | verified |
| R4 | Fluid Command and General Staff work; JIC component | VEOC-12, VEOC-33A, VEOC-34 | verified |
| R5 | File sharing | VEOC-15 | verified |
| R6 | Private and group messaging | VEOC-15A, VEOC-32 | verified |

## Anti-requirements (research §4)

| ID | Anti-requirement | Guarded by | Status |
|---|---|---|---|
| AR1 | No per-seat surge pricing structure | INV-1 | verified |
| AR2 | No unconstrained board divergence | INV-5 | verified |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6 | verified |
| AR4 | No in-place-upgrade dead ends | INV-5 | verified |
| AR5 | No proprietary-only interchange, substrate lock-in, or unbundling | INV-4, INV-9 | verified |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | verified |
| AR7 | Full function disconnected, including provisioning | INV-3 | deferred |

## Invariants (PSPR §3)

| ID | Invariant | Status |
|---|---|---|
| INV-1 | Viewers are structurally free | verified |
| INV-2 | Attribution is total | verified |
| INV-3 | Disconnection is the normal case | verified |
| INV-4 | Standards are native | verified |
| INV-5 | Boards are versioned schemas | verified |
| INV-6 | No-code is real | verified |
| INV-7 | Fail closed | verified |
| INV-8 | Calm under stress | verified |
| INV-9 | Core is never unbundled | verified |
| INV-10 | The codebase outlives any one maintainer | verified |
