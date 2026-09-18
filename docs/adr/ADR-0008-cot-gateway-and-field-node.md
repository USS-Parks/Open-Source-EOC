# ADR-0008: CoT/TAK gateway, and the field-node language decision

Status: Accepted (provisional — flagged for Basho's confirmation)
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

Implement the CoT/TAK gateway in TypeScript (option B). Keep the
`field-node/` Rust crate as a documented, still-compiled placeholder
(CI runs `cargo check`/`clippy` on it) so the single-binary path remains
open for a future deployment that needs it — a native relay can consume
the same CoT model and API without changing the gateway's semantics.

This decision is reversible: adopting the Rust field node later does not
undo the TypeScript gateway, which stays the reference implementation.

## Rationale

The gateway is I/O-bound XML translation at modest scale, the CoT model is
already TypeScript, and a single-language stack is the project's stated
posture. The performance case for Rust does not yet exist; the complexity
cost is immediate. Choosing B now, with A documented and the crate kept
alive, buys interoperability today without foreclosing the native path.

## Note

The roster asked that this decision be put to Basho. He was away under the
standing full-execution authorization, so this ADR records the reversible
default and its rationale for his review; he can direct the Rust path and
the gateway semantics carry over unchanged.

## Consequences

- CoT model and mapping: `shared/src/cot/`. Relay endpoints: `server/src/cot/`.
- `field-node/` remains a placeholder under CI; ADR revisited if a native
  relay is adopted.
