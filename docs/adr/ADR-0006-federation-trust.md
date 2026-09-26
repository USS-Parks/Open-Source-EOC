# ADR-0006: Federation trust is signed peer identity with scoped agreements

Status: accepted, 2026-09-17 (VEOC-04)

Status note, 2026-09-25 (Veoci and air gap VA5): the decision was only
partly built: peers authenticated with a token, payloads were not signed, and
no route revoked an agreement.

Status note, 2026-09-25 (Veoci and air gap VA19): built for federated board
batches. Each instance holds one Ed25519 key pair, its private key
envelope-encrypted under `OPENEOC_SECRET_KEY`. Administrators exchange public
keys and compare fingerprints, and each records the other's on its peer.
Every batch is signed by the sending instance and verified under the recorded
key before anything in it is applied; the peer token still admits the request
before its body is read. `DELETE /api/v1/peers/:peerId/agreements/:agreementId`
revokes an agreement and drops what was waiting for it, so the revoking
instance neither sends nor accepts the board from then on. The partner is not
told: its pushes are refused with 403 until its administrator revokes its own
side. Resource escalation and JIC approval deliveries are not signed.
[Federation setup](../guides/FEDERATION-SETUP.md) describes the exchange.

Status note, 2026-09-25 (Veoci and air gap VA20): batches also travel by file
between instances with no network path, verified the same way before any is
applied, with a receipt signed by the receiver marking them delivered.

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
