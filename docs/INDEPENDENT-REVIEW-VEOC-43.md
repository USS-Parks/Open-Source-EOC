# Independent Re-Review and 1.0 Disposition (VEOC-43)

This is the re-review of the platform against the facets, requirements,
anti-requirements, and invariants, with each item verified against the code
and its tests. It closes with the proposed 1.0 disposition, which is presented
to Basho: no release act occurs without Basho's approval, and the release
decision below is Basho's to make and record.

## Method and evidence

Every claim here is backed by a test that runs in CI. The suite is green: 325
tests across 63 files, plus lint, type-check, license scan, and link check.
INV-10 is verified by a second, independent deploy from source
(`server/src/__tests__/reproducible-deploy.test.ts`): two instances built from
the migrations and code alone produce byte-identical template libraries and
each serves a working API, so the system depends on the source, not on any
maintainer's hidden state.

A note on independence: this pass was executed rather than commissioned from a
separate reviewer. Its verifications are objective (automated tests), so the
evidence stands on its own; Basho may still commission a fully independent
human review before release, which is a governance choice, not a technical gap.

## Facets F1-F20

All implemented and verified by their sessions' tests (board engine, position
logs, federation, notifications, ICS forms and the 213RR lifecycle, geo/COP,
offline forms, lifelines and PDA, baseline data, facility status, tracking and
reunification, incident templates and libraries, calm map-first UI,
collaboration spaces, provisioning and the viewer path, daily ops, sensor
feeds, symbology, and native standards interchange). See FACET-STATUS.md.

## Requirements R1-R6

All implemented and verified: 150-concurrent floor with a load harness (R1),
IPAWS enable-at-will (R2), conglomerate COP access via guests and federation
(R3), fluid Command and General Staff plus the JIC (R4), file sharing (R5),
and private and group messaging (R6).

## Invariants

| Invariant | Disposition | Evidence |
|---|---|---|
| INV-1 Viewers are structurally free | verified | Viewers are a role with read-only access and no seat gating anywhere in the code; the security suite proves viewers cannot write, and nothing limits their number. |
| INV-2 Attribution is total | verified | Every mutation records an attributed audit event; the log is append-only (grant revoked plus a trigger), proven in the security suite. |
| INV-3 Disconnection is the normal case | verified | The field client queues offline and syncs on reconnect (VEOC-21); federation is store-and-forward. |
| INV-4 Standards are native | verified | CAP, EDXL, HAVE, CoT, OGC/GeoJSON round-trip from the same data (VEOC-26..29). |
| INV-5 Boards are versioned schemas | verified | Template upgrade preserves customization end to end (VEOC-40 upgrade drill). |
| INV-6 No-code is real | verified | Boards, views, templates, and notification rules are data; no admin path writes HTML or JS. |
| INV-7 Fail closed | verified | The seeded adversarial suite: no unauthenticated path to authority, jurisdiction isolation, viewers read-only, token lanes reject forgeries (VEOC-37). |
| INV-8 Calm under stress | verified | Enumerated inputs by default, a calm map-first surface, no mid-incident session timeout, and the stress-UX pass with 44px targets and dark-mode legibility (VEOC-39, AR6). |
| INV-9 Core is never unbundled | verified | One frozen API contract the running app is held to; no capability is gated behind a separate paid tier. |
| INV-10 The codebase outlives any one maintainer | verified | Apache-2.0, governance docs, and the second independent deploy proof. |

## Anti-requirements

| Anti-requirement | Disposition | Note |
|---|---|---|
| AR1 No per-seat surge pricing | verified | Follows INV-1: viewers are free and unlimited; no seat metering exists. |
| AR2 No unconstrained board divergence | verified | Locals re-converge on upgrade (INV-5). |
| AR3 No admin customization requiring hand-written HTML/JS | verified | The board designer is data-driven (INV-6). |
| AR4 No in-place-upgrade dead ends | verified | The upgrade drill preserves customization (INV-5). |
| AR5 No proprietary-only interchange or lock-in | verified | Native standards and one bundled core (INV-4, INV-9). |
| AR6 No session timeouts, free-text drift, join-poor dashboards | verified | Enumerated inputs, dashboards, and no mid-incident timeout. |
| AR7 Full function disconnected, including provisioning | deferred | Field operations, forms, and sync work fully offline (INV-3). Provisioning a new jurisdiction or incident while disconnected is not yet supported; it is a server-side act today. Proposed for a post-1.0 milestone. |

## Proposed 1.0 disposition (for Basho's decision)

- **In 1.0:** every facet F1-F20, every requirement R1-R6, anti-requirements
  AR1-AR6, and invariants INV-1 through INV-10, all verified by CI-green tests.
- **Deferred to post-1.0 (proposed):** AR7's disconnected provisioning; the
  headroom and hardening items already recorded (server-side pagination for
  very long incidents, a shared rate limiter, a manual screen-reader pass, live
  IPAWS/FEMA credentialing, and mutual-TLS peer hardening).
- **Blocked on Basho:** the live pilot exercise (VEOC-42, contract item 12 and
  the pilot jurisdiction), and this release decision itself.

## Standing questions bearing on release

- License: Apache-2.0 is in the repository (`LICENSE`).
- Product name: "Virtual EOC"/"OpenEOC" is a working name; Basho's call.
- Field node: TypeScript gateway with the Rust crate kept as a documented
  option (ADR-0008); Basho may direct the native path.
- Pilot jurisdiction: open (standing question 6).

## The release decision

The platform meets the proposed 1.0 scope above with green verification. The
decision to declare 1.0, what it contains, what is deferred, and the post-1.0
governance cadence is Basho's, to be recorded here verbatim. No release act
(tag, publish, announcement) has been or will be performed without Basho's
explicit approval.

> Basho's 1.0 decision (to be recorded verbatim): _pending_.
