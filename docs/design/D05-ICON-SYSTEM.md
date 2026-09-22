# D05 - Operational icon system

## Decision

D05 adds one original, local SVG family for application navigation, common actions, and the eight
community lifelines. The family follows the approved G-A direction: compact geometry, navy and teal
presentation, rounded strokes, and silhouettes that remain recognizable at small sizes.

The production registry remains under `web/src/design/icons/`. The synthetic icon review lives in
`web/design-review/IconGallery.tsx`, outside the application TypeScript tree; downstream surfaces can
adopt the production family deliberately without shipping the review surface.

## Public contract

- `Icon` accepts a registered `name` and an optional size of 16, 20, 24, 32, 40, or 48 pixels.
- A meaningful standalone icon requires `label`. It renders `role="img"`, an SVG title, and an
  accessible name.
- An icon next to visible text, or inside an already-labelled control, requires `decorative`. It is
  removed from the accessibility tree with `aria-hidden="true"`.
- `LifelineIcon` accepts a `LifelineKey` and applies the same accessibility contract.
- `destinationIconByKey` maps all 16 current D02 destinations and every planned navigation target
  to a distinct registered symbol.
- The SVG uses `currentColor`; a parent theme or surface controls color.
- `selected` increases stroke emphasis and exposes a data state for styling. `disabled` reduces
  presentation emphasis. Neither changes the registered symbol or its accessible name.

The accessibility props form a TypeScript discriminated union, so a caller must choose between a
meaningful label and decorative use. A runtime guard also rejects blank meaningful labels.

## Lifeline vocabulary

The registry contains exactly these eight keys and silhouettes:

| Key | Silhouette |
| --- | --- |
| `safety_security` | Shield with check |
| `food_hydration_shelter` | Shelter/house |
| `health_medical` | Medical cross |
| `energy` | Transmission tower |
| `communications` | Radio mast and waves |
| `transportation` | Roadway |
| `hazardous_materials` | Three-lobed biohazard mark |
| `water_systems` | Water drops |

These shapes match the visual concepts in the canonical lifeline reference without copying an
external icon file. Their line treatment is coherent with the compact navigation family.

Every registered name has distinct drawing geometry. Related functions retain one family stroke
and construction grid while adding a purpose cue: Smart Forms uses a branching workflow, Board
Customization uses adjustment sliders, Create Report uses a plus, and Field Reports uses a location
marker. The shelter lifeline retains the canonical house silhouette with a water-drop cue, keeping
it distinct from Overview.

## Operational status boundary

An icon identifies a destination or lifeline. It does not encode an operational status. Stable,
watch, critical, and unknown remain labelled status values beside the icon. Selection and disabled
state are also interaction properties, not operational assessments. This avoids inferring condition
from color, exposure, selection, or availability.

## Provenance and map-symbol boundary

All D05 path geometry is original Open Source EOC artwork, distributed under the repository's
Apache-2.0 license. The retained canonical photographs inform scale, weight, and recognizable
concepts; the icon paths are not traced or copied from external icon files.

The visual authority remains the [canonical reference set](canonical-references/README.md):
`01-overview-light.jpg`, `02-overview-dark.jpg`, and `03-lifelines-light.jpg`. The isolated gallery
reviews the implementation against that authority; it does not replace or supersede the references.

The H13 NAPSG operational map-symbol registry remains separate. NAPSG sprites have their own source,
license, operational meaning, and map-rendering contract. UI navigation and lifeline icons must not
replace those map symbols.

## Review fixture

Open `/docs/design/D05-gallery.html` through the existing D03 Vite review server. The fixture shows
all navigation icons, all eight lifelines, light and dark themes, meaningful and decorative
accessibility modes, and independent selected, disabled, and status examples.

The machine-specific browser script was retired during the V1 consolidation.
Its completed evidence remains in the execution ledger. Future review should
use the current HTML entry and a new bounded script in the ignored runtime.

## Verification

The focused Vitest suite validates registry completeness, intended sizes, project provenance,
accessible naming, decorative behavior, independent interaction states, lifeline mapping, distinct
geometry for every named icon and destination, both themes with axe-core, separate status markup,
and all navigation, action, and lifeline symbols rendered at the smallest intended sizes. Workspace
TypeScript and all-tree ESLint remain the static gates.
