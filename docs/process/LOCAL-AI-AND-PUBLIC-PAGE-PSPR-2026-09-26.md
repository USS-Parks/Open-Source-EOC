# Local AI and Public Page PSPR

Plan date: September 26, 2026
Approval state: **DRAFT, awaiting Basho's approval.** Nothing in it runs
until he approves it and answers section 10.
Author of record: Basho Parks.

## 1. Purpose

Juvare (JAI and its Intelligence Suite), Esri (the ArcGIS AI assistants and
Survey123's image analysis) and Veoci (VIA) all lead their 2025 and 2026
marketing with AI; Esri, Juvare and Veoci all give the public a way to see
shelter and evacuation status and to report damage. On 2026-09-26 Basho chose
to plan both for Open Source EOC: "Plan it, local model only" and "Allow a
separate public page" (ledger: "Map and dashboard parity amendment 1:
competitive gaps").

This plan adds:

1. **A local AI assistant.** A model running on the EOC's own computer or
   host, with no internet and nothing leaving the building. Every output is a
   draft a person approves. It answers plain-language questions about the
   incident with the records it used, drafts situation reports and briefings,
   suggests damage fields from a field photo, finds themes across After
   Action Reviews, and drafts forms from a description.
2. **A separate public page.** A published, read-only shelter and evacuation
   status page, and a public damage self-report form whose reports land in the
   existing moderated review queue. Both run outside the protected system,
   which stays For Official Use Only.

Research basis: `docs/process/COMPETITIVE-FEATURES-2026-09-26.md` and
`docs/process/LOCAL-AI-AND-PUBLIC-PAGE-RESEARCH-2026-09-26.md`.

## 2. Relationship to the other plans

- `docs/process/MAP-DASHBOARD-PARITY-PSPR-2026-09-26.md` is the live roster and
  ends with the 1.0.0 release. This plan starts after that release and ends
  with 1.1.0, unless Basho chooses to run it beside the map plan (decision 12).
- It changes the Operator Trust plan's decision 9 (AI parked) and the standing
  no-public-facet decision, as Basho chose on 2026-09-26. The protected system
  gains no anonymous read path: the public page is a published export, and
  public reports enter only through the moderated intake.
- `docs/process/FINISH-PSPR-2026-09-22.md` remains the execution contract
  where this plan does not supersede it.

## 3. Where things stand at plan date

| Item | State |
|---|---|
| AI | None. Operator Trust decision 9 parked it. |
| Search | Record search by field filters; no plain-language search. |
| Drafting | SITREP and IAP are assembled from records by hand; ICS forms are stored components (VA37). |
| Damage records | Damage Assessment boards with FEMA categories; photos attach to records. |
| After Action | AAR workspace with improvement items; MP13 adds charts and rollups across incidents. |
| Public side | None by decision until 2026-09-26. A moderated, token-authenticated intake queue exists for external submissions. |
| Air gap | Both air-gap proofs pass; nothing reaches the internet in operation. |

## 4. Decisions, with the default this plan takes

| # | Decision | Default |
|---|---|---|
| 1 | Runtime | llama.cpp's server (MIT) as a sidecar process the desktop launcher or host service starts and supervises, listening on localhost only. Off until an administrator turns it on for the jurisdiction. |
| 2 | Text model | Qwen2.5 7B Instruct, Q4_K_M (Apache-2.0, about 4.7 GB) on a host or a machine with 32 GB of memory; Phi-4-mini-instruct, Q4_K_M (MIT, about 2.5 GB) on a 16 GB laptop, chosen automatically by memory. Llama and Gemma weights are excluded (custom licenses). Default sizes are confirmed by benchmark on real target hardware in AP8. |
| 3 | Vision model | Qwen2.5-VL 7B Instruct (Apache-2.0) on a host; SmolVLM (Apache-2.0) on a laptop. Moondream past the Apache-2.0 2.x line is excluded (BSL 1.1). |
| 4 | Delivery | Models ship in a separate **AI model packet** (like the map data packet: a zip with a manifest, each file's SHA-256, checked on install), not in the base setup, so the base setup stays its current size. |
| 5 | What the AI may read | Only what the asking person may read: every retrieval runs as that person under row-level security, scoped to the selected incident unless the person asks across incidents they can read. |
| 6 | Governance | Draft-only: nothing an AI produces enters a record until a person approves it. A visible label on AI-assisted content (model, version, time, approver). Every invocation audited (input references, output, approver). Record text is treated as untrusted: instructions and retrieved content are kept apart in the prompt, and a prompt-injection test set runs in CI. A model card and a data statement per model. A control mapping in the style of ISO/IEC 42001, as Juvare has done. |
| 7 | Search | PostgreSQL full-text search first (built in, no new dependency). pgvector (PostgreSQL License) with nomic-embed-text (Apache-2.0) only if AP8's evaluation shows keyword retrieval falls short. |
| 8 | Public status page | A static bundle (HTML, a PMTiles map, JSON) that an authorized person publishes, or an administrator schedules, from records explicitly marked publishable and approved: shelters (open or closed, occupancy against capacity, pets, accessibility, last updated), evacuation zones (Order, Warning, Shelter in Place, with an address lookup), road closures and approved public messages. Written to a folder, a network share, or a web host the jurisdiction controls (SFTP or HTTPS upload). No third-party service is required. |
| 9 | Public damage reports | A small separate form app (static, hostable anywhere) with Crisis Track's fields (report type, incident, address, description, damage types, photo, insurance status, optional contact). Submissions reach the existing moderated intake queue by an authenticated push; nothing is visible to the public. Honeypot, timing check and server-side rate limits; no visible or third-party CAPTCHA. Contact details optional. Any public display of locations is snapped to the block; the precise point stays in the protected queue. |
| 10 | Accessibility and language | WCAG 2.2 AA (above the DOJ Title II floor of 2.1 AA). English and Spanish at 1.1; the FCC's 13 Wireless Emergency Alert languages as translation packs for the fixed labels later. |
| 11 | Sizes | Benchmarks in AP8 set the defaults. If a 16 GB laptop cannot answer within about 20 seconds, the assistant is offered on hosts only. |
| 12 | Timing | After 1.0.0, released as 1.1.0. Alternative: run beside the map plan's remaining units in separate lanes. |

## 5. Execution model

As the map plan: one unit at a time in order, lanes under the standing grant
where files are disjoint, fast-forward landings by the integrating session,
receipts in `docs/process/V1-LEDGER.md` under "Local AI and public page APn:
<title>", one focused commit per unit. AP2, AP3 and AP10 change what data can
reach whom and are reviewed by an adversarial auditor agent before landing.

## 6. What parity means here

| Strength taken | From | Done better here |
|---|---|---|
| Plain-language questions and summaries over incident data | Juvare JAI, Veoci VIA | Runs on the EOC's own computer, answers with the records it used, never sees more than the asker can |
| Photo to damage fields | Esri Survey123 image analysis, Juvare Crisis Track AI | Suggestions, not answers; works with no connection in the field queue |
| AAR analysis across incidents | Juvare JAI | Builds on MP13's rule-based rollups; draft themes with their evidence |
| Public shelter and evacuation status | Esri Emergency Shelter Management, Veoci | A published file bundle any web host can serve; no public door into the EOC |
| Public damage self-report | Esri Damage Assessment hub, Juvare Crisis Track | Lands in the moderation queue the EOC already uses |

## 7. Units, in order

| Unit | Work | Proof |
|---|---|---|
| AP0 | Authority: root `CLAUDE.md` names this plan; the Operator Trust decision 9 and the no-public-facet decision are recorded as changed. | Link check |
| AP1 | **The AI sidecar.** Start, supervise and stop the llama.cpp server with the desktop profiles and the host service; the AI model packet (build, verify, install) and its runtime settings; health on the system status screen; off by default. | Launcher tests; the packet verified by SHA-256; both air-gap proofs still pass with the sidecar running |
| AP2 | **Governance core.** The approval gate, provenance labels, audit entries, the per-jurisdiction switch, prompt and content separation, and a prompt-injection test set. | Real-database tests that nothing AI-produced is saved without approval and every call is audited; the injection set passes (reviewed by an auditor) |
| AP3 | **Ask.** A question box on the incident: retrieval by full-text search as the asking person, an answer with the records it used, and a way to open each record. | Retrieval tests proving it returns only readable records; answer tests on the four exercises; auditor review |
| AP4 | **Drafts.** Situation report, briefing and public message drafts from the operational period's records, opened in the existing editors as drafts. | Tests on North Coast Storm and the exercises; drafts cite their records |
| AP5 | **Photo-assisted damage records.** Suggested FEMA category, damage type and severity from an attached photo, shown beside the form for the person to accept or change. | Evaluation on a labeled local sample (section 10); accept-or-change tests |
| AP6 | **AAR themes.** Draft themes across incidents from improvement items, each with its evidence, on the MP13 AAR dashboard. | Tests; themes cite items |
| AP7 | **Form drafting.** An administrator describes a form in plain language and gets a draft form definition to edit in the existing form editor. | Tests that drafts validate against the form schema |
| AP8 | **Evaluation and model cards.** A local evaluation set from the exercises; answer, citation and draft quality scores; speed and memory on a 16 GB laptop and a host; the default sizes set from the results; a model card and data statement per model; the control mapping document. | The evaluation report in `docs/`; defaults recorded |
| AP9 | **Public status bundle.** Mark shelters, zones, closures and messages publishable; publish now or on a schedule; write to a folder, share or host; the static page with the map and address lookup. | Export tests (nothing unmarked or unapproved leaves); an accessibility check at WCAG 2.2 AA; the page served from a plain static host |
| AP10 | **Public damage reports.** The static form app, the authenticated push into the moderated intake, the abuse controls, block-level display. | Intake tests (rate limits, honeypot, oversized or malformed input refused); auditor review |
| AP11 | **Accessibility and Spanish.** axe and keyboard walks on both public pieces; Spanish strings. | Walks in both languages |
| AP12 | **Review package and release.** `LOCAL-AI-AND-PUBLIC-PAGE-REVIEW.md` at the root; parity matrix rows; `pnpm check:gate`; both air-gap proofs; version 1.1.0 in the four formats plus the AI model packet. | Basho's review |

## 8. Verification gates

The map plan's section 8, plus: the prompt-injection set (AP2 onward), the
evaluation report (AP8), and for the public pieces an accessibility check at
WCAG 2.2 AA with no request outside the machine except the publish target.

## 9. Not in this plan

- Any cloud AI service or model API; any model that is not Apache-2.0, MIT or
  similarly permissive; training or fine-tuning models.
- Autonomous agents that act without a person's approval.
- An anonymous read path into the protected system; public accounts; public
  comments.
- Commercial feeds, SMS gateways or translation services.
- Public publishing to a host on Basho's behalf; tagging and releases stay his.

## 10. What only Basho can supply

- Approval of this plan, and any reordering or cutting of units.
- Decision 12: after 1.0 (default) or beside the map plan.
- Decisions 2 to 4 if the defaults do not suit (models, packet delivery).
- Authorization to download the model weights named in decisions 2 and 3 from
  their publishers' pages (a few GB each; no account needed).
- A labeled sample of real damage photos, if one exists, for AP5's
  evaluation; otherwise AP5 uses openly licensed photos and says so.
- Where the jurisdiction would host the public page (decision 8) and
  confirmation of block-level display for public report locations (decision 9).
- Languages beyond English and Spanish (decision 10).

## 11. Completion

Done when the assistant answers, drafts, suggests damage fields and finds AAR
themes on the four exercises with every output a draft and every call
audited; the public status bundle publishes from approved records to a plain
static host and the public damage form feeds the moderated queue; the
evaluation report and model cards are in `docs/`; `pnpm check:gate` and both
air-gap proofs are green; 1.1.0 and the AI model packet are built in
`deploy/` with their SHA-256; and Basho has reviewed it in the installed app.
