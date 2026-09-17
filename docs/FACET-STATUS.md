# VEOC Facet, Requirement, and Invariant Status Register

Maintained by roster sessions. Dispositions: `open`, `implemented`, `verified`, `deferred`, `risk-accepted`.
Created by VEOC-00 at baseline `2743fe6f8ac29bedbc4d00175a47d8491777bce4`.

## Facets (research §3)

| ID | Description | Primary session | Status |
|---|---|---:|---|
| F1 | Board primitive: versioned schema, input + display views | VEOC-09, VEOC-10 | implemented |
| F2 | Position login + immutable activity/position logs | VEOC-07, VEOC-11 | implemented |
| F3 | Store-and-forward federation, local replication | VEOC-30 | open |
| F4 | Board-triggered notifications, webhooks, multi-channel | VEOC-14 | implemented |
| F5 | ICS forms, IAP builder, 213RR lifecycle | VEOC-34, VEOC-35 | open |
| F6 | Any board as a live geospatial layer; field-to-COP loop | VEOC-16, VEOC-17 | implemented |
| F7 | Offline XLSForm-compatible smart forms | VEOC-22 | open |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | VEOC-20, VEOC-23 | open |
| F9 | Pre-disaster baseline data for damage assessment | VEOC-23 | open |
| F10 | Always-on facility status networks + status queries | VEOC-28 | open |
| F11 | Scan-first tracking objects + reunification | VEOC-25 | open |
| F12 | Incident templates instantiating ICS org + checklists | VEOC-12 | implemented |
| F13 | Scenario libraries, reference libraries, checklists | VEOC-12 | implemented |
| F14 | Calm-screen map-first SPA discipline | VEOC-05, VEOC-17 | implemented |
| F15 | Per-incident auto-provisioned collaboration space | VEOC-32, VEOC-33 | open |
| F16 | One-click role-based provisioning; ten-minute viewer path | VEOC-08, VEOC-41 | open |
| F17 | Daily-ops usability against skill decay | VEOC-05, VEOC-41 | open |
| F18 | Sensor and drone live feeds into the COP | VEOC-19 | implemented |
| F19 | NAPSG/DHS incident symbology shipped | VEOC-17 | implemented |
| F20 | Native standards interchange | VEOC-26..29, VEOC-31 | open |

## Requirements (Basho, 2026-09-17)

| ID | Requirement | Primary session | Status |
|---|---|---:|---|
| R1 | At least 150 concurrent users per instance | VEOC-38 | open |
| R2 | IPAWS integration enable-at-will | VEOC-31 | open |
| R3 | Agency, organization, and volunteer conglomerate COP access | VEOC-08, VEOC-30 | open |
| R4 | Fluid Command and General Staff work; JIC component | VEOC-12, VEOC-33A, VEOC-34 | open |
| R5 | File sharing | VEOC-15 | implemented |
| R6 | Private and group messaging | VEOC-15A, VEOC-32 | implemented |

## Anti-requirements (research §4)

| ID | Anti-requirement | Guarded by | Status |
|---|---|---|---|
| AR1 | No per-seat surge pricing structure | INV-1 | open |
| AR2 | No unconstrained board divergence | INV-5 | open |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6 | open |
| AR4 | No in-place-upgrade dead ends | INV-5 | open |
| AR5 | No proprietary-only interchange, substrate lock-in, or unbundling | INV-4, INV-9 | open |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | implemented |
| AR7 | Full function disconnected, including provisioning | INV-3 | open |

## Invariants (PSPR §3)

| ID | Invariant | Status |
|---|---|---|
| INV-1 | Viewers are structurally free | open |
| INV-2 | Attribution is total | implemented |
| INV-3 | Disconnection is the normal case | implemented |
| INV-4 | Standards are native | open |
| INV-5 | Boards are versioned schemas | open |
| INV-6 | No-code is real | implemented |
| INV-7 | Fail closed | open |
| INV-8 | Calm under stress | open |
| INV-9 | Core is never unbundled | open |
| INV-10 | The codebase outlives any one maintainer | open |
