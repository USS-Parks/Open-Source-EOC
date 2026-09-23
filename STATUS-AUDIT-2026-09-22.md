# Status audit against the original PSPR

Audited 2026-09-22 on `main` at `7b69b67` with 64 uncommitted working-tree
changes. Authority read: `docs/process/archive/VIRTUAL-EOC-PSPR-2026-09-17.md`
(VEOC-00 through VEOC-43, 46 prompts).

## 1. Completion

### Original roster: 46 of 46 prompts executed

Every prompt VEOC-00 through VEOC-43, including VEOC-15A and VEOC-33A, has a
receipt in `docs/process/VEOC-EXECUTION-LEDGER.md`. Execution did not stop
there: the ledger carries roughly 65 further sessions (VEOC-44 through
VEOC-85, the D-series design sessions, M1 through M4, and V1 W0/W1), which is
itself the first finding. The original roster was declared closed and then
reopened repeatedly because VEOC-43's acceptance was never actually met.

### Facet register: 30 of 43 rows verified, 70 percent

Source: `docs/FACET-STATUS.md`, reconciled today against receipts.

| Register | Verified | Partial | Open |
|---|---:|---:|---:|
| Facets F1-F20 | 14 | 6 | 0 |
| Requirements R1-R6 | 3 | 3 | 0 |
| Anti-requirements AR1-AR7 | 6 | 1 | 0 |
| Invariants INV-1..10 | 7 | 2 | 1 |

Still short: F4 notifications (no durable outbox), F7 form depth, F8/F9 PA
categories and parcel baselines, F17/INV-8 operator acceptance, F18 live feed
polling, R1 real-hardware load, R2 IPAWS two-person send, R3 multi-agency
exercise, AR7/INV-3 second-machine air-gap proof, INV-10 second maintainer.

### Against v1: 15 of 66 units, 23 percent by count

Source: `docs/process/archive/V1-PSPR-2026-09-22.md`, the live plan at the time
of the audit and since superseded. W0 is complete
(6 units) and W1 is complete through W1.8 (9 units). W1.9, W1.10, and all of
W2 through W7 are open.

Weighted by the plan's own sizing, the finished units are about 17 percent of
the work. The plan estimates 95 agent-days total; roughly 85 remain.

The honest headline: the original roster is 100 percent executed, the
capability register behind it is 70 percent verified, and the distance to a
shippable 1.0 is about 83 percent unwalked.

## 2. Bloat

Ranked by what costs the most to carry.

### 2.1 Built engines with no operator screen

The API contract declares 226 routes across 196 distinct paths. The web
client references about 90 of them. Roughly half the server has no surface an
operator can reach. This is the W3 backlog and it is the largest single block
of code paying rent without producing value: `jic` 532 lines, `damage` 455,
`staffing` 353, `facilities` 327, `tracking` 303, `federation` 241, plus the
unwired workflow and resource routes inside modules that do have screens.

### 2.2 Process documentation outweighs the thing it governs

`docs/process/` is 964 KB and 9,764 lines across 17 planning documents. The
execution ledger alone is 398 KB and 5,149 lines. Five overlapping rosters are
live at once: the original PSPR, the parity continuation, the design PSPR, the
Master PSPR, and the V1 PSPR, each partly superseding the last. Two more
audits sit untracked at the repository root
(`PARITY-AUDIT-2026-09-20.md`, `SESSION-HANDOFF-2026-09-20.md`), along with an
untracked `docs/design-previews/` and 7.8 MB of untracked reference
screenshots.

### 2.3 Test volume above source volume in the server

`server/` carries 23,472 lines of test against 20,576 lines of source, 97 test
files to 105 source files. `web/` is the inverse at 9,118 against 26,156. The
server ratio is a symptom of per-session acceptance suites accumulating rather
than consolidating.

### 2.4 Shipped but switched off

1,954 lines register no routes by default after W1.3 and W1.4: `collab` 810,
`meetings` 514, `facilities` 327, `tracking` 303. Gating was the right call
over deletion, but the code, its tests, and its threat-model rows are all
still carried.

### 2.5 Small named leftovers, already scheduled

- Two navigation destinations render an unavailable panel
  (`web/src/app/screens/Console.tsx` 646 and 666). Owner W1.9.
- 240 inline style objects across 21 web files, 60 of them in `CopMap.tsx`.
  Owner W5.1.
- `xlsx@0.18.5`, abandoned upstream with two open advisories, parsing
  operator-uploaded workbooks. Owner W1.10.

### 2.6 Not bloat, absence

Three directories the plan assumes do not exist: `server/src/scheduler`,
`server/src/telemetry`, `server/src/retention`. Fastify still runs with
`logger: false`. Nothing scheduled fires in a real deployment.

## 3. Tree state

W1.8 is receipted in the ledger but not committed. The staged baseline
migration, the 101 deleted migration files, and four modified documents are
sitting in the working tree. That landing should close before the next unit
starts.
