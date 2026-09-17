# ADR-0006: Federation trust is signed peer identity with scoped agreements

Status: accepted, 2026-09-17 (VEOC-04)

## Decision

- Each instance holds a long-lived Ed25519 identity keypair; peering is a
  mutual, human-approved exchange of public keys plus a written sharing
  agreement record (which boards, which direction, which retention).
- Every federated payload is signed by the origin instance and verified
  before ingestion; transport is TLS, but trust derives from the signature,
  not the channel.
- Delivery is store-and-forward with per-peer durable queues (the WebEOC
  Fusion lesson, F3): partitions delay delivery, never lose it, and each
  side retains its own data.
- A peer's data lands attributed to that peer and scope-checked against
  the agreement on every record, fail-closed (INV-7). Agreement revocation
  stops flow immediately in both directions.

## Alternatives considered

- **mTLS-only trust:** couples trust to certificate plumbing county IT
  struggles with, and conflates channel with authority.
- **Central broker (Juvare Exchange model):** reintroduces the vendor
  choke point this project exists to remove (AR5).
- **Matrix-style open federation:** wrong default for CJIS/HIPAA-adjacent
  operational data; EOC federation is explicit and bilateral.

## Reversal cost

Moderate: the agreement model is data, the signature scheme is a sealed
module. Changing either after VEOC-30 requires a coordinated peer upgrade.
