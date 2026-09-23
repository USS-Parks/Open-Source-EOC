# VEOC Facet, Requirement, and Invariant Status Register

Reconciled 2026-09-22 through `56d2558` using the source-backed method from
VEOC-79E. This register and the
[parity capability matrix](./VEOC-PARITY-MATRIX.md) now use the same current
status. Historical receipts remain valid for the increment they proved, but an
older `verified` label does not erase a later documented depth, live-system,
scale, operator, or transfer boundary.

Statuses are `verified`, `partial`, `open`, `deferred`, or `risk-accepted`.
`Verified` means the prescribed technical gate passed at the assessed depth.
It does not mean commercial certification, pilot acceptance, or live external
integration. Every `partial` and `open` row names its remaining boundary and
the V1 owner. The design side is reconciled separately in the
[design capability matrix](./process/design/D00-DESIGN-BASELINE-AND-OWNERSHIP.md#10-current-design-to-capability-reconciliation-2026-09-22).

Created by VEOC-00 at baseline `2743fe6f8ac29bedbc4d00175a47d8491777bce4`.

## Facets (research section 3)

| ID | Description | Current evidence | Status | Remaining boundary / owner |
|---|---|---|---|---|
| F1 | Board primitive: versioned schema, input + display views | VEOC-09/10; `b7cb680`; P-BOARDS-1 `48edf63`; P-BOARDS-2 `75464fc` | verified | - |
| F2 | Position login + immutable activity/position logs | VEOC-07/11; `ca0d130` | verified | - |
| F3 | Store-and-forward federation, local replication | VEOC-30 | verified | - |
| F4 | Board-triggered notifications, webhooks, multi-channel | VEOC-14; governed workflow notifications `6c8dddc` | partial | Durable outbox, retries and write-path decoupling: W2.1 |
| F5 | ICS forms, IAP builder, 213RR lifecycle | VEOC-34/35; incident-context IAP `8c96103`; P-IAP `a5b96f9` | verified | - |
| F6 | Any board as a live geospatial layer; field-to-COP loop | VEOC-79B/79C2; P-COP `e20e772`; D29 `d1c5d63` | verified | - |
| F7 | Offline XLSForm-compatible smart forms | VEOC-22; durable field reconciliation `d1c5d63` | partial | Remaining question and capture types: W4.7 |
| F8 | FEMA doctrine as schema: Lifelines, PDA outputs | VEOC-20/23; D13; P-LIFE-1 through P-LIFE-4 | partial | PA categories and shelter-census depth: W3.2 / W3.4 |
| F9 | Pre-disaster baseline data for damage assessment | VEOC-23; 79G impact analysis | partial | Live parcel rolls and replacement-cost coverage: W3.2 / pilot data |
| F10 | Always-on facility status networks + status queries | VEOC-28 | verified | - |
| F11 | Scan-first tracking objects + reunification | VEOC-25 | verified | - |
| F12 | Incident templates instantiating ICS org + checklists | VEOC-12; `ca0d130` | verified | - |
| F13 | Scenario libraries, reference libraries, checklists | VEOC-12; task rules/receipts `ecd5249`; P-TASKS `d867488` | verified | - |
| F14 | Calm-screen map-first SPA discipline | VEOC-05/17; P-SHELL `ef13b0c`, `64e3cf5`; P-COP `e20e772` | verified | Representative-operator acceptance remains D34 |
| F15 | Per-incident auto-provisioned collaboration space | VEOC-32/33; `8c96103` | verified | - |
| F16 | One-click role-based provisioning; ten-minute viewer path | VEOC-08/41 | verified | - |
| F17 | Daily-ops usability against skill decay | Responsive persistent workspaces integrated through M3 | partial | Representative operator comparison: D34 |
| F18 | Sensor and drone live feeds into the COP | VEOC-79C1/C2; P-COP `e20e772` | partial | Scheduled URL polling and live source evidence: W2.2 / live gate |
| F19 | NAPSG/DHS incident symbology shipped | Agreed nine-type licensed subset `389afe1`; P-COP composition | verified | Broader catalog remains intentionally unmapped, not claimed |
| F20 | Native standards interchange | VEOC-26 through VEOC-29 and VEOC-31 | verified | - |

## Requirements (Basho, 2026-09-17)

| ID | Requirement | Current evidence | Status | Remaining boundary / owner |
|---|---|---|---|---|
| R1 | At least 150 concurrent users per instance | VEOC-38 in-process benchmark | partial | Real-hardware socketed run: R1-REAL |
| R2 | IPAWS integration enable-at-will | VEOC-31 model and endpoint | partial | Two-person UI/send and authorized test credentials: W2.7 / W3.5 / Basho |
| R3 | Agency, organization, and volunteer conglomerate COP access | VEOC-79B database/DOM isolation; P-SHELL incident URLs `64e3cf5` | partial | Integrated multi-organization exercise: 79D+D33 |
| R4 | Fluid Command and General Staff work; JIC component | VEOC-12/33A/34; D26 `79019cc` | verified | - |
| R5 | File sharing | VEOC-15; tenant-safe download `451ed16` | verified | - |
| R6 | Private and group messaging | VEOC-15A/32; source-context workspace `b253180` | verified | - |

## Anti-requirements (research section 4)

| ID | Anti-requirement | Guarded by | Status | Remaining boundary / owner |
|---|---|---|---|---|
| AR1 | No per-seat surge pricing structure | INV-1 | verified | - |
| AR2 | No unconstrained board divergence | INV-5 | verified | - |
| AR3 | No admin customization requiring hand-written HTML/JS | INV-6; `b7cb680`, `48edf63`, `75464fc` | verified | - |
| AR4 | No in-place-upgrade dead ends | INV-5 | verified | - |
| AR5 | No proprietary-only interchange, substrate lock-in, or unbundling | INV-4, INV-9 | verified | - |
| AR6 | No session timeouts mid-incident, free-text drift, join-poor dashboards | INV-8 | verified | - |
| AR7 | Full function disconnected, including provisioning | INV-3; `3741100`, `7a52438` | partial | Independent media transfer and second-machine proof: W6.4 |

## Invariants (PSPR section 3)

| ID | Invariant | Status | Evidence boundary / owner |
|---|---|---|---|
| INV-1 | Viewers are structurally free | verified | Structural model; no seat metering |
| INV-2 | Attribution is total | verified | Append-only audit and incident/position attribution |
| INV-3 | Disconnection is the normal case | partial | Prepared-host workflow proven; independent transfer remains W6.4 |
| INV-4 | Standards are native | verified | CAP, EDXL, CoT, HAVE and GeoJSON contracts |
| INV-5 | Boards are versioned schemas | verified | Immutable versions and safe upgrade preflight/application |
| INV-6 | No-code is real | verified | Structured designer and runtime presentation `75464fc` |
| INV-7 | Fail closed | verified | W0.0 closed the remaining approval, dataset and sync fail-open paths |
| INV-8 | Calm under stress | partial | Technical responsive gates passed; operator comparison D34 and real load R1-REAL remain |
| INV-9 | Core is never unbundled | verified | Apache-2.0 core and native interchange |
| INV-10 | The codebase outlives any one maintainer | open | Second maintainer or recorded release waiver: W6.3 / Basho |

## Reconciliation boundary

- The register describes the current tree, not the status at VEOC-43.
- `partial` retains the proven increment while naming the unproven remainder.
- Live readiness, operator acceptance and release disposition remain with the
  V1 roster. This register does not synthesize those results.
