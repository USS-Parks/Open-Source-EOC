# D06 shared cards, badges, controls, and feedback

**Prompt:** D06

**Status:** Implemented in the additive design seam; verification evidence is recorded below.

**Binding visual references:** [light overview](../../design/canonical-references/01-overview-light.jpg), [dark overview](../../design/canonical-references/02-overview-dark.jpg), and [light Lifelines workspace](../../design/canonical-references/03-lifelines-light.jpg). These images govern component shape, density, surface treatment, selection, and placement.

**Scope:** Reusable presentation components only. No route, workflow, persistence, authority, or operational engine is introduced.

## 1. Reuse contract

D06 keeps `components.tsx`, `layout.tsx`, and every existing export unchanged through KIT-CONTRACT. The new modules consume the existing `Theme` provider and D04 CSS variables. They do not create a second theme, status model, or action engine.

| Module | Public contract | Reuse and ownership |
|---|---|---|
| `cards.tsx` | `KpiCard`, `ConditionCard`, `RecordCard`, `ActionCard`, `SummaryCard` | Composition-only containers; callers retain data, permissions, and actions |
| `feedback.tsx` | `ConditionBadge`, `CountBadge`, `LoadingState`, `EmptyState`, `ErrorState` | Uses D04 condition meaning and existing live-region conventions |
| `controls.tsx` | `ActionButton`, `Tabs`, `Menu`, `Tooltip`, `ProgressIndicator` | Native buttons and ARIA patterns; no workflow or navigation state |
| `kit.css` | Scoped `.eoc-kit-*` styles | Uses D04 tokens and inherits the approved navy correction at integration |
| `web/design-review/kit-gallery.tsx` | `KitReview`, `mountKitReview` | Synthetic review surface; not an application route or part of the application TypeScript tree |

All cards accept normal DOM attributes so downstream table, form, shell, and drawer owners can label and compose them without wrapping or forking the component.

## 2. Card purposes and interactions

| Card | Purpose | Interaction |
|---|---|---|
| KPI | One decision-relevant measure with optional leading slot, context, and open action | Optional explicit text action; reported zero and missing data have separate discriminants |
| Condition | One assessed operational condition with optional D05 leading slot, domain label, summary, source, and time metadata | Optional review action; soft tint, text, and marker travel together; selected state adds a 3 px teal outline |
| Record | A compact record preview with labeled fields | One explicit open action; selected state is structural as well as colored |
| Action | A task requiring a choice | Explicit primary and optional secondary buttons; the primary uses text, weight, order, and border in addition to color |
| Summary | A small labeled aggregation | Read-only values with optional footer; no implied drill-down |

The optional KPI leading slot is ready for D05 icons without defining an icon registry here. The review reproduces the references’ horizontal four-KPI strip and the Lifelines reference’s eight-card grid beside a detail panel. Grid placement and drawer ownership remain with consuming surfaces.

## 3. Badges and data precision

`ConditionBadge` renders every D04 operational/data state with text, a marker, and treatment. `CountBadge` is neutral and distinguishes numeric zero from unknown:

- `0 zero` means the source reported a quantity of zero.
- `? unknown` means no supported quantity is known.
- neither treatment implies normal, success, completion, or safety.

`KpiCard` uses a discriminated value contract. A numeric `0` passed through the known-value branch is normalized to the zero treatment so it cannot accidentally look like ordinary positive data.

## 4. Control behavior

- `ActionButton` supports primary, secondary, quiet, danger, disabled, and busy behavior. Busy buttons are disabled, retain an accessible name, and expose `aria-busy`.
- `Tabs` is controlled. One tab is in the Tab order; Arrow Left/Right, Home, and End move focus and selection while skipping disabled tabs. The caller supplies a stable ID shared with panels.
- `Menu` opens from click, Enter, Space, or Arrow Down/Up; focuses the first/last enabled item; skips disabled items; traverses with arrows/Home/End; closes when focus or pointer leaves; and returns focus to its trigger after selection or Escape.
- `Tooltip` appears on hover or keyboard focus, preserves any existing `aria-describedby` relationship, dismisses with Escape, contains text only, and does not carry required information unavailable elsewhere.
- `ProgressIndicator` supports determinate and indeterminate work. Invalid numeric bounds throw. Indeterminate work omits `aria-valuenow`; only `value === max` marks completion.

## 5. Feedback behavior

- Loading uses `role=status`, polite announcement, `aria-busy`, and a reduced-motion-compatible placeholder.
- Empty is neutral, names the active scope/filter, and may provide one explicit next action.
- Error uses `role=alert`, states what failed and what remains true, and may provide one retry action.

These states remain distinct. An empty result never renders as an error, and a failed load never renders as an empty result.

## 6. Canonical-reference conformance

The review surface follows the exact reference grammar rather than replacing it:

- light mode uses white and soft-gray compact panels, navy grouped context, and teal actions;
- dark mode inherits D04’s corrected navy canvas and layered navy surfaces rather than charcoal;
- KPI cards form one horizontal strip at wide width and wrap to two then one column;
- condition cards support a four-by-two wide grid, soft condition tints, source/time metadata, and selected teal outline;
- detail content composes beside the condition grid and stacks below it at narrow width;
- long titles and descriptions wrap without hiding state, ownership, or actions.

P-SHELL and each operational surface must use the canonical images directly when arranging these components. Passing this gallery does not prove those later surfaces match the references.

## 7. Review entry

Open [D06-gallery.html](D06-gallery.html) through the existing local Vite review server:

```text
http://127.0.0.1:5175/docs/process/design/D06-gallery.html
```

The machine-specific browser script was retired during the V1 consolidation.
The verification table below and the execution ledger retain its completed
evidence. A future review should use the current HTML entry and a new bounded
script in the ignored runtime.

## 8. Verification evidence

| Gate | Result |
|---|---|
| All-workspace TypeScript | Passed after bounded exact-optional repair, exit 0 |
| All-tree ESLint | Passed after removing one unused type import, exit 0 |
| Focused behavior and light/dark axe tests | Passed after keyboard-event repair: 2 files, 17 tests |
| Browser review, light/dark and wide/narrow | Root fixture passed four captures at 1440/390 px, keyboard controls, focus, containment and explicit states; zero page errors or external requests. Evidence: deploy/test-runtime/out/d06-review/result.json and shots |

## 9. Boundaries

The gallery uses synthetic records and no network or application API. D05 owns icon assets and semantics. D07 owns table behavior and density preferences. D08 owns forms and validation. P-SHELL owns operational placement and navigation. Permissions, workflow transitions, record selection, persistence, and primary-action authorization remain with their existing engines and downstream presentation units.
