# D03 composition review package

**Date:** 2026-09-21
**Design baseline:** `6376016c620155f91fb8278503e371aff78e442b`
**Evidence level:** Designed and source-checked. Browser review and G-A approval remain open.

## 1. Package boundary

D03 assembles the reviewable visual direction before product presentation work begins. It does not change application routes, runtime surfaces, tokens, permissions, data, or operational engines.

The package has three parts:

- Supplied Overview and ESF/Lifeline concept images, inventoried below as synthetic design references.
- Missing compositions implemented in the isolated `CompositionReview` export in `web/design-review/gallery.tsx`.
- `docs/process/design/D03-gallery.html`, a separate Vite entry that mounts the review export without changing `App.tsx`, `main.tsx`, or the operational application.

Every record in the coded gallery is synthetic. Controls are interactive review props only and perform no application or network write. Generic inline map symbols and icons are proposals, not NAPSG symbols.

## 2. Supplied reference inventory

The 14 files under the canonical checkout's user-owned `Reference Screenshots/` directory were visually inspected and remain unmodified and untracked.

| File | Visual content | D03 use |
|---|---|---|
| `ChatGPT Image Sep 21, 2026, 06_10_07 AM.png` | Open Source EOC light Overview, 1586 by 992 | Complete supplied light Overview composition |
| `ChatGPT Image Sep 21, 2026, 06_10_22 AM.png` | Open Source EOC dark Overview, 1586 by 992 | Complete supplied dark Overview composition |
| `ChatGPT Image Sep 21, 2026, 06_10_27 AM.png` | Open Source EOC light ESFs & Lifelines workspace, 1586 by 992 | Light Lifeline direction and content model |
| `image-1789936697975.jpg` | Dense dark urban map with point and road overlays | Map density and subdued basemap reference only |
| `image-1789936706501.jpg` | Dark regional road network with categorical line colors | Network legibility reference only; category color is not Lifeline condition |
| `image-1789936710218.jpg` | Dark parcel/building exposure map with categorical areas | Dense impact-layer reference only; exposure is not service failure |
| `image-1789936716164.jpg` | High-contrast dark municipal map | Fine-scale infrastructure legibility reference only |
| `image-1789936719929.png` | WebEOC AAR dashboard | Dense dashboard and drilldown reference |
| `image-1789936727547.png` | Exact duplicate of the WebEOC AAR dashboard | Duplicate inventory item, no separate design decision |
| `image-1789936732127.webp` | WebEOC checklist/list dashboard | Tasks, lists, templates, filters, and compact status reference |
| `image-1789936736615.webp` | Exact duplicate of the WebEOC checklist/list dashboard | Duplicate inventory item, no separate design decision |
| `image-1789936758219.png` | Exact duplicate of the WebEOC AAR dashboard | Duplicate inventory item, no separate design decision |
| `image-1789936773465.webp` | WebEOC IAP working list | Planning density, progress, assignment, and approval reference |
| `image-1789936785718.png` | Esri-style map, facilities, public information, and Lifeline montage | Composition traits only, not product or operator evidence |

The three PNGs under `docs/design-previews/2026-09-21/` are exact hash duplicates of the first three Open Source EOC reference images:

| Preview file | Matching reference SHA-256 |
|---|---|
| `dashboard-light-concept.png` | `73AA5B276C06A3188906C9A16FB511E6CE1FFC4688B17C41685E71CAFB821EE1` |
| `dashboard-dark-concept.png` | `56D4110FB049A2288A6687185FB4CA75AE805B8A2D97A7D378FEFE8D2E75DA86` |
| `esf-lifeline-workspace-concept.png` | `E0FBEFB273738BFDCFB2D28A74A7C68B3909ABA2E553A79A752BCAD641758C70` |

Their `generation-prompts.md` is provenance for the synthetic concepts, not application acceptance evidence.

## 3. Screen coverage

| Required screen | Light | Dark | Narrow | Package treatment |
|---|---|---|---|---|
| Overview | Supplied concept | Supplied concept | Coded narrow operator composition | Reuse the complete wide concepts and their hierarchy without rebuilding them |
| Map | Coded proposal | Coded proposal | Coded map-first stack | New review composition with inline synthetic map artwork |
| ESFs & Lifelines | Supplied concept plus coded shared structure | Coded proposal | Coded single-column cards and detail | Add only the missing dark and narrow treatments |
| Dense board | Coded proposal | Coded proposal | Coded scrollable table with sequential detail | New review composition over the existing `BoardTable` primitive |
| Resource form drawer | Coded proposal | Coded proposal | Coded full-width form state | New review composition over existing fields, enum, button, and badge primitives |
| IAP Planning | Coded proposal | Coded proposal | Coded sequential outline, editor, and review context | New review composition informed by the supplied IAP reference |

The responsive review entry is container-driven. The `Preview 390 px` control shows the same state that a 390 CSS-pixel viewport receives. It does not claim device or assistive-technology validation.

## 4. Settled composition direction

The package applies these choices consistently:

- Navy command and navigation structure with cyan or teal selection independent of operational condition.
- Compact, useful information density with visible sources, times, owners, next actions, and return context.
- Green Stable, yellow Stabilizing, red Disrupted, and gray Unknown conditions paired with text and markers.
- Neutral ESF activation chips. Active ESF never means a disrupted Lifeline.
- Geographic exposure, selected features, and map categories never set Lifeline condition.
- Current, stale, unavailable, and zero are labeled as different states.
- Map, Board, and Planning arrangements retain one dominant workspace plus bounded context.
- Narrow layouts sequence navigation, workspace, and detail instead of compressing three columns into unusable widths.
- Protected draft, working revision, review, approval, completion, and publication remain separate states.
- Full D02 group discoverability replaces the old concept footer Help shortcut. Guidance remains contextual through D32.

## 5. Composition details and dependencies

| Composition | Demonstrated behavior | Implementation dependencies |
|---|---|---|
| Map | Layers, source state, selected report, related work, coordinate alternative, preserved context | `P-SHELL`, `P-COP`, D29, D31 |
| ESFs & Lifelines | Eight conditions, selected Energy detail, evidence, linked actions, neutral ESF activation, exposure disclaimer | D13, `P-LIFE-1` through `P-LIFE-4` |
| Dense board | Saved-view context, filters, dense table, freshness, zero and unavailable values, record detail | D07, `P-BOARDS-1`, `SEAM` |
| Resource drawer | Protected draft, labeled controls, enumerated priority, supporting context, review before submit | D08, D22, 81B-E2 |
| IAP Planning | Period outline, working editor, source state, readiness, approval chain, revision history | `P-SHELL`, `P-IAP`, 84-E, 84A-E, D31 |

The review-only `ConditionBadge`, `StateText`, shell mock, context drawer, filter bars, and inline artwork are prototype extensions. D04 through D08 decide their reusable token and component contracts. They are not a second production kit.

## 6. G-A batch defaults and override points

The review package recommends one concrete default set. G-A may accept it as a batch and record only explicit overrides:

| Area | Recommended default | Override point |
|---|---|---|
| Identity and color | Compass product mark as shown, subordinate organization identity, navy shell, teal selection, and text-paired semantic conditions | D04 settles exact color values; D05 settles the final local licensed product-mark and icon file paths |
| Density and navigation | Compact operational density, 218 px expanded rail, 64 px compact icon rail with accessible names, and full labeled navigation sheet at narrow width | A comfortable density remains a user preference; group visibility never changes authority |
| Map treatment | Muted light streets/terrain and desaturated dark streets/terrain with incident overlays prioritized | H13 and H14 provide the approved asset and license path; operator basemap choice remains available |
| Context and record detail | 340 px starting drawer, resizable within sensible limits, full-width sequential detail at narrow width, and full-page editing only for long forms or extensive history | D08 and `P-SHELL` settle exact width limits and focus behavior |
| Operational cards and planning | Restrained condition tint, text and marker on every condition, Board detail in the drawer, and a horizontal labeled Planning step list at narrow width | D04 through D08 settle reusable contrast, table, form, and step-list contracts |

FOUO and other handling markings remain persistent when incident policy metadata requires them. Their presence is a settled product boundary, not an aesthetic option. D03 shows FOUO in the operator shell.

## 7. Local review entry

From lane `d`, start only the local Vite server:

```powershell
pnpm --filter @openeoc/web exec vite .. --config ../docs/process/design/D03-vite.config.mjs --host 127.0.0.1 --port 5175 --strictPort
```

Open:

```text
http://127.0.0.1:5175/docs/process/design/D03-gallery.html
```

Use the Screen selector, theme control, and `Preview 390 px` control. The narrow All sections button opens the complete D02 navigation sheet. The review page needs no database and makes no external request.

The machine-specific browser script was retired during the V1 consolidation.
Its completed wide and narrow evidence remains in the execution ledger and the
recorded runtime evidence paths below. Any future visual review should exercise
the current HTML entry with a new bounded script in the ignored runtime rather
than restoring the stale tracked harness.

## 8. G-A review script

Review the package in one bounded pass. The order keeps structural decisions ahead of surface polish:

1. Open both supplied Overview concepts and the coded 390 px Overview; confirm they preserve one hierarchy across themes and widths.
2. Open the coded Map in light and dark and confirm map detail remains subordinate to operational selection and condition.
3. Open ESFs & Lifelines in dark and at 390 px and compare its content hierarchy with the supplied light concept.
4. Confirm Lifeline condition, ESF activation, selection, and geographic exposure remain visually and semantically separate.
5. Open the dense Board and confirm filters, table, freshness, status, ownership, and next action can be scanned together.
6. Open the Resource drawer and use the fields with keyboard only; confirm draft and review states are explicit.
7. Open IAP Planning and confirm working, review, approved, completed, frozen, and published cannot be confused.
8. Open All sections at narrow width and confirm all five D02 groups remain discoverable without a Help route.
9. Compare current, stale, unavailable, unknown, and zero examples across the compositions.
10. Review the synthetic-data and review-only markings before judging any operational claim.
11. Resolve the aesthetic choices in section 6 as one decision set.
12. Record acceptance, required revision, or deferral for each package area below.

| Package area | G-A decision to record |
|---|---|
| Overview light and dark | Accept supplied concepts, revise, or defer |
| Map light, dark, and narrow | Accept direction, revise, or defer |
| ESFs & Lifelines light reference, dark, and narrow | Accept direction, revise, or defer |
| Dense Board light, dark, and narrow | Accept direction, revise, or defer |
| Resource drawer light, dark, and narrow | Accept direction, revise, or defer |
| IAP Planning light, dark, and narrow | Accept direction, revise, or defer |
| Shell, density, and identity choices | Record the selected options from section 6 |

A request for revision keeps D03 at designed status. Acceptance at G-A authorizes the downstream design foundation in the Master PSPR; it does not by itself claim implementation.

Capture the accepted option and any required revision in the G-A receipt.

## 9. Evidence and limits

### Actual checks on 2026-09-21

| Gate | Result |
|---|---|
| Typecheck | `pnpm -r exec tsc --noEmit` passed, exit 0 |
| Lint | `pnpm exec eslint .` passed, exit 0 |
| Existing gallery tests | Two files and eight tests passed, exit 0 |
| Wide browser phase | Ten captures across five coded screens in light and dark completed; compact and expanded navigation checks passed before an unrelated narrow selector mismatch stopped that run |
| Corrected narrow browser phase | Eight captures at 390 by 844 passed, exit 0; navigation, Board list/detail containment, keyboard Resource controls, and page/shell overflow checks passed with `pageErrors: []` and `externalRequests: []` |
| Targeted Lifelines containment | After visual review found nested workspace clipping, one corrected dark Lifelines capture passed, exit 0; workspace width and scroll width were both 390 px, all eight cards remained between 12 and 378 px, every condition label remained inside the viewport, and page errors and external requests were empty |

The corrected narrow result is retained at canonical ignored runtime path `deploy/test-runtime/out/d03-review/result-narrow-corrected.json`. It records `phase: "narrow"` and does not represent a standalone full run. The Lifelines replacement capture and geometry result are retained as `deploy/test-runtime/out/d03-review/shots/narrow-dark-lifelines-corrected.png` and `deploy/test-runtime/out/d03-review/result-lifelines-corrected.json`. Combined with the retained ten wide captures and compact-navigation result, this evidence covers the fixture's expected compositions without repeating passed work.

These checks establish the review package at designed status. G-A remains Basho's aesthetic decision gate.

This package does not prove implemented application routes, live authority, persistence, incident isolation, offline behavior, responsive production surfaces, assistive-technology support, operator performance, vendor parity, or practitioner acceptance. The synthetic concepts and coded proposals are never presented as delivered UI.
