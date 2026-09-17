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
| B4 | Collaboration adapters (VEOC-32, VEOC-33) | T2, T6 | token theft, membership drift, injection via chat content | adapter tokens scoped and stored server-side; membership reconciled from position assignments, one direction; chat content treated as untrusted text everywhere |
| B5 | Plugin sandbox (VEOC-10, ADR-0004) | T4 | sandbox escape, capability abuse, resource exhaustion | capability-only API; CPU/memory quotas; no network from sandbox; template packages signed (VEOC-09) |
| B6 | Feed and sensor ingestion (VEOC-19, VEOC-26) | T1, T6 | spoofed feeds, malformed CAP/CoT parser attacks, staleness masking | feeds are read-only layers with provenance; schema-validated parse with fuzz tests; staleness always displayed |
| B7 | Outbound webhooks + notification channels (VEOC-14) | T2 | SSRF via webhook URLs, notification bombing | webhook URL allowlist per jurisdiction; HMAC signing; per-rule rate caps |
| B8 | Standards read surfaces: OGC Features, GeoJSON, HAVE export (VEOC-16, VEOC-28) | T1, T2 | permission leaks through the second representation | same authorization path as REST, tested for parity on every layer |
| B9 | IPAWS-OPEN connector (VEOC-31) | T2, T5 | unauthorized public alert issuance | disabled by default; separate enable authority; two-person rule on live alert send; full audit; test-environment fixtures only until an agency MOA exists |
| B10 | File library (VEOC-15) | T1, T2 | malware distribution, content-type confusion, storage exhaustion | content-addressed immutable storage; type allowlist; size quotas; no server-side rendering of uploads |
| B11 | Auth/identity (VEOC-07, VEOC-08) | T1, T2, T5 | credential stuffing, session fixation, position self-assignment | OIDC or local with rate-limited login; position assignment is an authorized act; mid-incident re-auth preserves state without widening it |
| B12 | Audit substrate (VEOC-11) | T5 | history rewrite, deletion, backdating | append-only at API and database (no UPDATE/DELETE grants on audit tables); server-side timestamps; corrections are new entries |

## Standing adversarial test policy

Each session that opens a surface ships negative tests named for its row
(B1-B12) and they run in `pnpm check` forever. VEOC-37 re-verifies the whole
table adversarially before release.

## Out of scope (baseline)

Physical EOC security, OS hardening of the host, and denial-of-service by
carrier outage are deployment concerns documented at VEOC-40, not product
threat rows.
