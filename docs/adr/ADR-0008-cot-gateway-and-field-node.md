# ADR-0008: CoT/TAK gateway, and the field-node language decision

Status: Accepted (confirmed by the V1 W1.0 standing default, 2026-09-22)
Date: 2026-09-18
Context: VEOC-29

## Context

The platform needs a Cursor-on-Target (CoT) bridge so ATAK devices and TAK
servers interoperate with the common operating picture: inbound tracks
render on the COP, and VEOC geo records appear in TAK. The roster (VEOC-29)
raises an explicit decision: implement the gateway as a Rust single binary
in `field-node/`, or as part of the existing TypeScript stack.

## Options

### A. Rust single-binary field node (`field-node/`)
- A standalone binary that speaks CoT (TCP/UDP/multicast, TLS) and relays
  to the platform API.
- Pros: one small deployable with no runtime; strong fit for a resource-
  constrained field gateway or high-rate UDP multicast; memory safety.
- Cons: a second toolchain, build, and release artifact; duplicates the CoT
  model that already exists in TypeScript; more surface for a small team to
  maintain (against INV-10, the codebase outliving one maintainer); the
  work is I/O-bound XML relay where Rust's performance edge rarely pays for
  the added complexity at the scale in scope (≤150 concurrent users, R1).

### B. TypeScript gateway in the existing stack (chosen)
- CoT parsing, mapping, and emit live in `shared` (isomorphic, already
  used offline by the field client), and the relay endpoints live in the
  server alongside the feed framework that already ingests CoT as COP
  layers (VEOC-19).
- Pros: one language and one toolchain (the PSPR's pinnacle-language
  decision); reuses the CoT model, the feed layers, and the geo board
  records; nothing new to deploy; fully reversible.
- Cons: not a single self-contained field binary; a very high-rate UDP
  multicast bridge would eventually want a native relay.

## Decision

Implement the CoT/TAK gateway in TypeScript (option B). V1 W1.0 removes the
placeholder `field-node/` crate and its Rust CI job because they contain no
gateway implementation and impose a second toolchain on every build. The
single-binary path remains open: a future native relay can consume the same
CoT model and API without changing the gateway's semantics.

This decision is reversible: adopting the Rust field node later does not
undo the TypeScript gateway, which stays the reference implementation.

## Rationale

The gateway is I/O-bound XML translation at modest scale, the CoT model is
already TypeScript, and a single-language stack is the project's stated
posture. The performance case for Rust does not yet exist; the complexity
cost is immediate. Choosing B now, with A documented as a reversal path,
buys interoperability today without carrying an empty second toolchain.

## Note

The original roster asked that this decision be put to Basho. The V1 PSPR
later established deletion as the standing default, and Basho authorized full
STS for that plan on 2026-09-22. A later native requirement can reverse the
language choice without changing the gateway semantics.

## Consequences

- CoT model and mapping: `shared/src/cot/`. Relay endpoints: `server/src/cot/`.
- The placeholder Rust crate and CI job are absent. Reintroducing a native
  relay requires a concrete deployment need and a new implementation commit.
