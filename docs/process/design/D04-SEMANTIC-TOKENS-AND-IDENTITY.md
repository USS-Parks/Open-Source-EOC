# D04 semantic tokens and identity placement

**Prompt:** D04
**Status:** Implemented in the design seam; static and browser evidence is recorded below.
**Decision source:** G-A approved the D03 recommended defaults without overrides.
**Scope:** Shared design tokens, semantic CSS, focused design tests, and a review-only gallery. This does not redesign the operational application shell.

## 1. Settled visual vocabulary

The shared vocabulary uses a navy product anchor, teal selection and interaction, compact information density, layered neutral surfaces, and text-paired operational conditions. Brand and categorical chart accents have no operational meaning. Red, amber, green, and gray remain reserved for conditions whose labels and markers carry the same meaning without color.

The compass shown in the review gallery is a local typographic placeholder for the approved direction. D05 owns final local asset paths and icon rules. It is not an operational or doctrinal symbol.

## 2. Token contract

| Area | Shared contract | Use |
|---|---|---|
| Surfaces | canvas, surface, raised, sunken, overlay | Workspace depth without using status color |
| Type | existing type scale plus weights and line heights | Compact, readable hierarchy with 12 px minimum supporting text in the review |
| Spacing | existing spacing scale retained | Existing consumers continue unchanged |
| Borders | neutral border, strong border, hairline/emphasis/selected widths | Structure, focus adjacency, and selected edges |
| Elevation | existing light/dark shadow scales retained | Raised panels and overlays |
| Focus | existing theme focus colors and one 2 px `:focus-visible` ring | Keyboard location independent of selection color |
| Identity | navy, readable navy text, teal interaction, bright teal signal, tint | Product and organization orientation only |
| Density | compact, comfortable, and touch dimensions | Dense tables remain distinct from 44 px field controls |
| Charts | six theme-specific categorical colors | Labeled series; never condition or severity |
| Conditions | normal, watch, critical, unknown, stale, unavailable, not applicable, zero | Text, marker, treatment, foreground, and background travel together |

The implementation extends [tokens.ts](../../../web/src/design/tokens.ts) and keeps every prior export and `ThemeTokens` field. [base.css](../../../web/src/design/base.css) consumes the new CSS variables without changing current component APIs.

## 3. Operational and data-state meaning

| State | Marker | Treatment | Meaning |
|---|---:|---|---|
| Normal | circle | solid green | An assessed operational condition is normal |
| Watch | triangle | solid amber | An assessed condition needs attention |
| Critical | diamond | solid red | An assessed condition is critical |
| Unknown | question | outline gray | No supported condition is known |
| Stale | clock | striped amber | A known value exceeded its freshness expectation |
| Unavailable | dash | dashed neutral | The source or value cannot currently be obtained |
| Not applicable | slash | dashed neutral | The value does not apply to this record or scope |
| Zero | numeral zero | neutral numeric | A reported quantity is zero; it does not imply a favorable condition |

A state must never be shown by color alone. Product teal and chart categories must never substitute for these states. Surfaces that cannot determine which missing-data state applies use `unknown` rather than silently showing zero.

## 4. Identity hierarchy

The review establishes three placements:

1. Product identity starts the command bar with the compass direction and “Open Source EOC.”
2. Organization identity appears as a subordinate line. Custom organization identity identifies the host and does not claim incident command.
3. Incident and operational-period identity appears in the context area, separate from product branding.

FOUO or other handling markings remain persistent shell context under P-SHELL and policy owners; they are not branding. D30 applies the same hierarchy to exported products without changing prescribed ICS layouts.

## 5. Compatibility and ownership

- Existing imports of `themes`, `spacing`, `fontStack`, `radii`, `typeScale`, `shadows`, `toCssVariables`, and contrast helpers remain valid.
- Existing theme fields and status colors remain available. New consumers should choose operational-state tokens for explicit condition and missing-data meaning.
- D06 owns reusable cards, badges, and controls that consume these tokens.
- D07 owns table behavior and user-selectable density.
- D08 owns form behavior and validation presentation.
- P-SHELL owns production identity placement and navigation structure.
- D05 and H13 own local icon/asset provenance and doctrinal symbols.

## 6. Review surface

The additive [TokenReview](../../../web/design-review/gallery.tsx) export leaves the D03 `CompositionReview` and original component gallery intact. It displays:

- product, organization, incident, and operational-period hierarchy;
- neutral surface and brand swatches;
- all eight operational/data states with labels and markers;
- a labeled categorical chart whose colors carry no status words;
- compact and comfortable synthetic records;
- representative typography, controls, and keyboard focus.

Open the dedicated [D04 gallery entry](D04-gallery.html) through the already-running local Vite review server:

```text
http://127.0.0.1:5175/docs/process/design/D04-gallery.html
```

The machine-specific browser script was retired during the V1 consolidation.
The verification table below and the execution ledger retain its completed
evidence. A future review should use the current HTML entry and a new bounded
script in the ignored runtime.

## 7. Verification evidence

| Gate | Result |
|---|---|
| TypeScript | Passed: all-workspace `tsc --noEmit`, exit 0 |
| ESLint | Passed: all-tree `pnpm exec eslint .`, exit 0 |
| Design contrast and accessibility tests | Passed: 3 files, 75 tests |
| Browser review, light/dark and wide/narrow | Passed root-run fixture: four captures at 1440 x 900 and 390 x 844, keyboard order, visible focus, 12 px review text, no horizontal overflow, page errors or external requests |

Browser captures are review evidence for the token gallery, not proof that P-SHELL has implemented this hierarchy in the operational application.

Actual output and captures are in `deploy/test-runtime/out/d04-review/browser.log`,
`result.json` and `shots/`. Root visually inspected wide light and narrow dark.

## 8. Boundaries

### Canonical-reference correction, 2026-09-21

Basho reaffirmed the [three exact canonical photos](../../design/canonical-references/README.md).
Photo 2 requires blue-navy dark surfaces. The initial charcoal values are
superseded by canvas `#0b1b2b`, surface `#142738`, raised `#193044`, sunken
`#091624` and overlay `#20374b`; operational and brand meanings stay intact.
All-workspace TypeScript, all-tree ESLint and 64 contrast cases passed. The
bounded browser fixture passed four theme/viewport captures and its existing
keyboard, focus, text and containment checks; root inspected wide dark.
Evidence: `deploy/test-runtime/out/d04-navy-correction/`.

No external font, image, package, network service, application route, or command-authority behavior was added. The gallery uses synthetic labels and records. Chart values are demonstration data. Final compass artwork, operational symbols, production shell placement, component migrations, export branding, and human operator validation remain with their named downstream prompts.
