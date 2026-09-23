# Threat Model (baseline, VEOC-04)

Living document. Every externally reachable surface planned in phases B-F is
enumerated here before it is built; the session that builds a surface updates
this file and adds the adversarial tests its row demands. Fail-closed (INV-7)
and total attribution (INV-2) are the standing mitigations everywhere.

## Assets

- **A1 Incident operational data:** boards, logs, sitreps, resource requests.
- **A2 Personal data:** tracking objects (patients, evacuees) carry
  HIPAA-adjacent details; damage assessments carry household details.
- **A3 Audit integrity:** the append-only chronology is the legal record;
  its falsification is worse than its disclosure.
- **A4 Alerting authority:** the CAP/IPAWS path can page the public;
  misuse is a public-safety event, not a data event.
- **A5 Federation identity keys** and sharing agreements.
- **A6 Availability during activation:** the system is needed most when
  infrastructure is worst.

## Attacker classes

- **T1** Anonymous internet actor (scanning, abuse of public intake).
- **T2** Authenticated low-privilege user or mutual-aid guest exceeding scope.
- **T3** Compromised or hostile federation peer.
- **T4** Malicious plugin or board-template author.
- **T5** Insider with position access attempting to rewrite history.
- **T6** Supply chain (dependency or basemap/feed poisoning).

## Trust boundaries and surfaces

| # | Surface (session) | Faces | Primary risks | Standing requirements |
|---|---|---|---|---|
| B1 | REST `/api/v1` + WebSocket (VEOC-07..) | T1, T2 | authn bypass, tenant confusion, enumeration | server-derived principal; RLS second wall (ADR-0005); rate limits; deny-by-default routes |
| B2 | Public damage-report intake (VEOC-23) | T1 | spam, poisoning of assessed data, PII phishing | isolated intake store; moderation gate before it touches A1; rate limits; no account creation path |
| B3 | Federation ingest/egress (VEOC-27, VEOC-30) | T3 | forged payloads, scope creep, replay, poisoned records | signature verification before parse (ADR-0006); per-record agreement scope check; monotonic sequence per peer; peer data always attributed, never merged anonymously |
| B4 | Collaboration adapters (conditional: `OPENEOC_INTEGRATIONS=collab`) | T2, T6 | token theft, membership drift, injection via chat content | routes and membership sync absent by default; adapter tokens scoped and stored server-side; membership reconciled from position assignments, one direction; chat content treated as untrusted text everywhere |
| B5 | Plugin sandbox | T4 | not applicable | no plugin runtime ships and no jurisdiction-authored code executes; board customization is declarative ([ADR-0004](./adr/ADR-0004-plugin-sandbox.md)). An executable plugin surface would need a new ADR and a new row here |
| B6 | Feed and sensor ingestion (VEOC-19, VEOC-26) | T1, T6 | spoofed feeds, malformed CAP/CoT parser attacks, staleness masking | feeds are read-only layers with provenance; schema-validated parse with fuzz tests; staleness always displayed |
| B7 | Outbound webhooks + notification channels (VEOC-14) | T2 | SSRF via webhook URLs, notification bombing, relay or provider credential exposure | per-jurisdiction destination allowlist, empty by default so nothing external is reachable, checked when a rule is created and again by the worker before each send; a host admitted by a `*.suffix` entry must resolve to public addresses, and a private, loopback or link-local target needs an exact-origin entry; http only for an exact loopback origin; redirects are not followed; HMAC signing; per-rule rate cap (default 60 per 10 minutes, at most 600 per window) with suppressed deliveries counted on a notification admins can see; email and SMS leave only through the relay and provider an admin configures for the jurisdiction, with the relay password or provider token envelope-encrypted and never returned; an HTTP SMS provider URL is held to the allowlist when configured and before each send; the SMTP relay is an admin-set host outside the allowlist, and a relay sign-in is refused without STARTTLS or TLS; recipients are people, not destinations, so addresses and numbers are not allowlisted, and each recipient counts against the rule's cap |
| B8 | Standards read surfaces: OGC Features, GeoJSON, HAVE export (VEOC-16, VEOC-28) | T1, T2 | permission leaks through the second representation | same authorization path as REST, tested for parity on every layer |
| B9 | IPAWS-OPEN connector (VEOC-31) | T2, T5 | unauthorized public alert issuance | disabled by default; separate enable authority; two-person rule on every send to the real endpoint, including the test handshake: one admin requests, a different admin confirms within 15 minutes, both recorded in the audit and the second-person check also held by a database constraint; full audit; test-environment fixtures only until an agency MOA exists |
| B10 | File library (VEOC-15) | T1, T2 | malware distribution, content-type confusion, storage exhaustion | content-addressed immutable storage; type allowlist; size quotas; no server-side rendering of uploads |
| B11 | Auth/identity (VEOC-07, VEOC-08) | T1, T2, T5 | credential stuffing, session fixation, position self-assignment | OIDC or local with rate-limited login; position assignment is an authorized act; mid-incident re-auth preserves state without widening it |
| B12 | Audit substrate (VEOC-11) | T5 | history rewrite, deletion, backdating | append-only at API and database (no UPDATE/DELETE grants on audit tables); server-side timestamps; corrections are new entries |
| B13 | Jitsi meeting bridge (conditional: `OPENEOC_INTEGRATIONS=meetings`) | T2, T6 | meeting-token theft, room guessing, unauthorized moderator access | routes absent by default; room names are random; JWT secrets stay in server-side envelopes; incident membership and role determine join authority |
| B14 | Object tracking and reunification (conditional: `OPENEOC_INTEGRATIONS=tracking`) | T2, T5 | disclosure of restricted person data, custody-event forgery, cross-jurisdiction search | routes absent by default; jurisdiction scope enforced server-side; restricted attributes require elevated membership; custody changes are attributed and audited |
| B15 | Facility status and HAVE exchange (conditional: `OPENEOC_INTEGRATIONS=facilities`) | T2, T6 | disclosure of HIPAA-adjacent capacity data, false status reports, stale availability | routes absent by default; jurisdiction scope enforced server-side; reports carry source and time; stale status remains explicit; exports use the authorized read path |

## Standing adversarial test policy

Each session that opens a surface ships negative tests named for its row
(B1-B15) and they run in `pnpm check` forever. VEOC-37 re-verifies the whole
table adversarially before release.

## Out of scope (baseline)

Physical EOC security, OS hardening of the host, and denial-of-service by
carrier outage are deployment concerns documented at VEOC-40, not product
threat rows.
