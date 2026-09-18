# Accessibility and Stress-UX Audit (VEOC-39)

Scope: Section 508 / WCAG 2.1 AA across the web surface, plus the stress-UX
pass (ten-minute viewer path, glove/touchscreen operation, low-bandwidth
rendering, night-shift dark-mode legibility). Findings are fixed in this
session or ticketed with rationale. The automated portions run in CI.

## WCAG 2.1 AA: how each principle is held

- **Perceivable.** Every theme's text and status colors meet the AA contrast
  ratios (4.5:1 text, 3:1 non-text and focus indicator), proven mathematically
  for both light and dark themes in `web/src/design/__tests__/contrast.test.ts`
  including a seeded low-contrast failure to prove the checker bites. Non-text
  status is never color-only: status badges carry text labels alongside color.
- **Operable.** Keyboard order follows document order with no positive
  `tabindex`, a "Skip to content" link leads the tab sequence, and focus is
  receivable on controls, asserted in `a11y.test.tsx`. Interactive controls now
  meet a 44px touch target (see stress-UX below).
- **Understandable.** Labels are programmatically associated with their controls
  (`htmlFor`/`id`), enumerated inputs are the default so users pick rather than
  type (INV-8), and headings are structured (one `h2`, section `h3`s), asserted
  on the operational briefing view.
- **Robust.** Axe (axe-core) runs over the component gallery and over a real
  operational screen (the briefing view) in both themes with zero violations
  (`a11y.test.tsx`, `operational-a11y.test.tsx`). Color-contrast is excluded
  from the axe run only because jsdom has no layout engine; contrast is proven
  separately and more strictly by the token test.

## Automated audit record

| Check | Where | Result |
|---|---|---|
| Axe, component gallery, light + dark | `a11y.test.tsx` | 0 violations |
| Axe, briefing view, light + dark | `operational-a11y.test.tsx` | 0 violations |
| Keyboard order, skip link, focus | `a11y.test.tsx` | pass |
| Label/control association | `a11y.test.tsx` | pass |
| Token contrast AA, both themes | `contrast.test.ts` | pass (with seeded-defect proof) |
| 44px touch targets | `operational-a11y.test.tsx` | pass |

## Stress-UX pass

- **Ten-minute viewer path.** The viewer path is a read-only route: open the
  common operating picture, read lifeline status and the briefing, with no
  login-to-content friction beyond authentication and no free-text entry
  required. The scripted walkthrough is part of the VEOC-41 quickstart and demo
  scenario; the components on that path (briefing view, status badges, map)
  render without interaction and pass the axe and structure checks here. Timed
  naive-user validation is executed against the demo dataset in VEOC-41/42.
- **Glove and touchscreen (finding, fixed).** Interactive controls (buttons,
  text fields, selects) were about 28px tall, comfortable for a mouse but small
  for a gloved finger on a ruggedized tablet. Fixed: all three now carry a 44px
  minimum touch target, asserted in `operational-a11y.test.tsx`. 44px is the
  WCAG 2.5.5 (AAA) target and well past the 2.5.8 (AA) minimum, chosen for PPE
  operation.
- **Low-bandwidth rendering.** The map basemap is served from local PMTiles
  with no external tile calls (the air-gap path, VEOC-40), and the UI ships no
  heavy media; screens are text and enumerated controls. The COP worker-URL fix
  (VEOC-17) keeps the map from failing on constrained renderers.
- **Night-shift dark mode.** The dark theme is a first-class theme, not an
  inversion; its contrast ratios meet AA in the same token test as light, so
  legibility holds on a darkened EOC floor at 3 a.m.

## Findings

- **A11Y-1 (fixed):** interactive controls below a comfortable gloved touch
  target. Fixed to a 44px minimum on buttons, text fields, and selects.

## Ticketed with rationale (not blocking AA)

- **A11Y-T1:** a full manual screen-reader pass (NVDA/VoiceOver) on every
  operational screen with live data is a human-in-the-loop step scheduled with
  the VEOC-41 documentation walkthrough; the automated axe and structure checks
  cover the programmatic criteria in the meantime.
- **A11Y-T2:** reduced-motion and prefers-contrast media-query handling is minor
  today because the UI has little motion; it rides the VEOC-41 polish pass.
