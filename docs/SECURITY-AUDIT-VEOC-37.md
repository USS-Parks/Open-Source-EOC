# Security Audit and Adversarial Pass (VEOC-37)

Date: 2026-09-18. Scope: the full server surface at commit `fa41ca3`, reviewed
against the PSPR invariants, with emphasis on INV-7 (fail closed) and the
authorization matrix. Every finding below is either fixed in this session or
risk-accepted in writing. A seeded adversarial suite
(`server/src/__tests__/security.test.ts`) encodes these checks and runs in CI
from now on.

## Method

The review walked each authority-bearing route and its service guard, the
token-authenticated lanes (federation, JIC approvals, resource escalation,
public damage intake), the audit trail's immutability, secret storage, and the
dependency and license posture. Findings were reproduced as failing tests
first, fixed, and then the tests were kept as regression guards.

## Findings

### F-1 (fixed): viewer role could perform write actions in Phase-F modules

- **Severity:** medium (authorization).
- **What:** the collaboration, meetings, JIC, resource-request, IAP, and AAR
  services guarded their write actions with a membership-only check
  (`requireMember`), which admits the read-only `viewer` role. The established
  contract elsewhere (for example CAP authoring) is `requireWriter`
  (admin or member). A viewer could therefore submit resource requests, draft
  and act on press releases, open meeting bridges, assemble IAPs, and record
  AAR observations and corrective actions.
- **Fix:** write paths in those six services now call a `requireWriter` guard;
  pure reads keep `requireMember`. Peer-token lanes are unaffected (they run
  under the receiving jurisdiction's registrar). Verified by the
  "viewers are read-only" cases in the seeded suite.

## Verified controls (no change required)

- **No unauthenticated path reaches authority.** Every authority route runs the
  server-side `authenticate` pre-handler, which derives the principal from the
  bearer token alone and rejects a missing token with 401. The suite asserts
  this across representative endpoints.
- **Jurisdiction isolation.** An admin of one jurisdiction is refused (403) on
  another jurisdiction's boards, IPAWS config, resource requests, corrective
  actions, and JIC releases. Row-Level Security is the second wall behind the
  service guards.
- **Token lanes fail closed.** Federation receive, JIC peer approvals, and
  resource escalation receive all reject an unknown token with 401; public
  damage intake requires an intake token.
- **Audit immutability.** `app_runtime` holds only `select, insert` on
  `audit_events`; `update`/`delete` are revoked and a trigger raises on either.
  The suite confirms both are refused from the runtime role.
- **Secrets handling.** IPAWS credentials, the collaboration bot token, and the
  Jitsi JWT secret are stored only as AES-256-GCM envelopes; status endpoints
  return fingerprints, never the raw secret. The suite confirms the raw values
  never appear in status responses.
- **Login backoff.** Five consecutive failures for an email lock further
  attempts (429), throttling credential guessing.

## Dependency and license posture

- Runtime dependencies are pinned by a committed lockfile and installed in CI
  with `--frozen-lockfile`.
- `scripts/license-scan.mjs` runs in CI and fails on any AGPL, SSPL, OSL,
  fair-code, or unlicensed package. It currently passes over 300 packages.
- The Phase-F work added no runtime dependency: the PDF writer, the JWT signer,
  the CSV export, and the collaboration and IPAWS connectors are all written in
  house against permissively licensed primitives, and AGPL systems
  (Mattermost) are integrated only across a process boundary (contract item 11).
- A network-based vulnerability audit (`pnpm audit`) is a release-time step run
  where outbound access is available; it is out of scope for the air-gapped CI
  gate, which enforces the lockfile and license scan instead.

## Risk acceptances

- **RA-1: in-process rate limiters.** Login backoff and public-intake throttle
  are per-process. Accepted until VEOC-38 introduces a shared limiter for
  horizontal scaling; single-instance deployments are fully covered today.
- **RA-2: no network vulnerability scan in CI.** Accepted because CI is
  air-gapped by design; the lockfile plus license scan hold the supply-chain
  line, and `pnpm audit` runs at release time.
