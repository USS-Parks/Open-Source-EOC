# P-SHELL-FRAME operational frame contract

## Scope

This unit implements the responsive application frame defined by D09 while preserving every current route and surface engine. It establishes the shared command bar, grouped navigation, page header, workspace arrangements, context drawer, and notification entry point. Persistent context, saved layout preferences, deep-link state, filter restoration, and browser Back behavior remain in the immediately following P-SHELL-CONTEXT unit.

The visual proportions follow the canonical references in [`canonical-references`](canonical-references/README.md): navy command and navigation regions, restrained typography, teal selection and actions, compact information density, and a 340 px context drawer. The frame uses the original local compass geometry with provenance recorded in [`ASSET-LICENSES.md`](../ASSET-LICENSES.md).

## Reuse contract

- D04 semantic tokens continue to own themes, color semantics, spacing, focus, and typography.
- D05 owns the icon registry. Each destination uses a distinct registered icon; the shell does not introduce another icon system.
- D06 and D08 continue to own shared controls, cards, form behavior, and overlay conventions.
- Existing surface components remain the operational content. The frame adds presentation and navigation around them.
- The existing incident selector, session identity, assigned position, account actions, notifications poll, and theme control remain the sources of displayed context.

## Navigation and routes

The rail exposes the five D02 groups without role-based hiding:

| Group | Destinations |
|---|---|
| Situation | Overview, Map, ESFs & Lifelines, SITREP |
| Operations | Boards, Resources, Tasks, Field Reports, Smart Forms, Tracking |
| Planning | Operational Periods, ICS Forms, IAP, AAR |
| Coordination | Participants, Messages, JIC, Files |
| Data and administration | Incident Setup, Datasets, Feeds, Templates, Settings |

The 16 previously implemented destinations keep their prior hash paths and detail routes. Target destinations without an implemented presentation render an operator-facing unavailable state with a usable return action. They do not display prompt identifiers, component owners, engineering instructions, or invented data. Alerts remain a command-bar notification utility with a route to the existing alert center. Unknown nonempty paths render an explicit not-found state instead of silently opening the map.

Compact navigation retains every accessible destination name. Expanded and narrow navigation retain group headings and the active-page marker. The URL never selects or grants an acting position.

## Frame behavior

The command bar shows product identity, the actual incident selector, the temporary operational-period value `Not set`, the signed-in person's assigned position when present, synchronization freshness, handling marking, notifications, theme control, and sign-out. Synchronization copy derives from the real notifications poll state and last successful response; the frame does not claim a permanent live connection.

The page header names the group, page, incident scope, and synchronization state. Map, Boards, and Planning arrangements share the same record and route model while exposing arrangement-specific layout hooks. This unit keeps arrangement state local and controlled.

The context drawer defaults to 340 px on wide screens, can be resized from 280 to 520 px, and can be dismissed. Its opener regains focus after dismissal. At narrow widths it becomes a sequential full-width panel with a backdrop and explicit close action. Drawer content remains the existing notification/context content; the frame does not invent record authority.

The navigation rail collapses to a 64 px icon rail on wide screens and becomes a labeled sheet on narrow screens. The closed narrow sheet is removed from focus order; opening it moves and contains focus, Escape restores the opener, and choosing a destination closes it and focuses the visible workspace. Overlay drawers below the dock breakpoint likewise contain focus and make covered workspace controls inert, while docked drawers remain nonmodal. A skip link focuses the workspace without changing the hash route. Navigation and drawer controls have accessible names, visible focus, keyboard operation, and touch-sized targets. Map and table overflow stays within their designated workspace scrollers.

## State boundary

This frame intentionally does not persist navigation width, drawer width, drawer visibility, or arrangement choice. P-SHELL-CONTEXT will bind incident, operational period, position, return-to-record, saved layouts, route state, and filter restoration to authenticated revisioned workspace state. Until that unit lands, an operational-period placeholder is descriptive only and no URL parameter implies authority.

## Verification

Focused component coverage verifies all five navigation groups, current-route semantics, compact-mode discoverability, hash-safe skip behavior, drawer resizing/dismissal/focus restoration, honest synchronization labels, account access, and automated accessibility checks. Router coverage verifies current, future, board-design, and unknown-route parsing and hash generation.

The prescribed static gate is the all-workspace TypeScript check and all-tree ESLint. Root owns the signed-in PostgreSQL browser gate for light and dark themes at wide and narrow widths, keyboard navigation, contained primary content, and preserved existing end-to-end assertions.
