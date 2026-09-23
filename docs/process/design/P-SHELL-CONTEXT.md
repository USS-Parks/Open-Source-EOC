# P-SHELL-CONTEXT contract

Status: implementation ready for the prescribed static and live acceptance gates.

This unit binds the operational shell to authenticated incident context. It does
not add a second authority model, routing engine, record query, or draft store.
Server authorization, incident participation, saved-state CAS, and board views
remain authoritative.

## Context ownership

- `SessionProvider` owns the authenticated person, jurisdiction membership, and
  current signed-in position returned by `/me`.
- `IncidentProvider` owns one selected incident and retains its five-second
  incident-list polling. A jurisdiction change clears the old selection.
- `WorkspaceContextProvider` owns presentation preferences for one
  `person:incident` scope: theme, operational-period choice, and the Map,
  Boards, and Planning shell arrangements.
- The hash route owns shareable navigation context: incident, operational
  period, view/filter, selected record, and bounded return route.
- D08 form drafts remain in their existing scoped store. Incident switching
  neither reads nor deletes those drafts.

## Authority and controls

The incident selector accepts only incidents in the freshly authorized list.
A foreign linked incident is replaced with an available incident and produces a
visible limitation message. The center workspace remounts on incident change,
which clears old surface data, selected-record state, and polling instances.

Operational-period choices come from the selected incident's current area and
immutable area history. Only revisions carrying an operational period are
shown, duplicate period definitions are collapsed, and revisions belonging to
another incident are excluded. `period=unset` represents an explicit **Not
set** selection; a missing period parameter may hydrate once from saved
preferences. Hydration normalizes the URL so subsequent Browser Back and
Forward operations are unambiguous.

The position control lists assignments returned by the authenticated
`assignedToMe=true` seam. Signing in or out uses the existing position session
endpoints and then refetches `/me`. A position is never accepted from the URL,
local storage, or saved presentation state. Server denial remains visible.

## Saved presentation state

The unit reuses SEAM saved-state records:

| Kind | Key | Payload |
| --- | --- | --- |
| `workspace_preferences` | `shell` | theme and period revision or null |
| `workspace_layout` | `map` | compact rail, drawer visibility, drawer width |
| `workspace_layout` | `boards` | compact rail, drawer visibility, drawer width |
| `workspace_layout` | `planning` | compact rail, drawer visibility, drawer width |

Every write uses `schemaVersion: 1` and the last received revision as
`expectedRevision`. Writes are serialized so a slower older save cannot replace
a newer local choice. Loads, saves, and conflict recovery capture the current
scope generation; completions from a prior incident cannot mutate the new
scope.

A 409 blocks later writes and shows two deliberate recovery actions. **Reload
saved settings** discards the session presentation choices and fetches current
state. **Keep this session** first fetches the latest revision and only then
retries the local payload against that revision. It never blindly overwrites.
Actual load/save/error phases drive the shell sync label.

Without a selected incident, theme and layout controls remain usable locally.
Persistence begins only after person and incident scope are both validated.

## Deep links and return behavior

Existing hash paths and detail meanings remain intact. Query values are bounded,
duplicate known keys are rejected, malformed percent encoding produces the
not-found surface, and nested return links are rejected. Incident and period
context is retained when moving between shell destinations.

A board deep link may name a selected record and a same-incident return route.
The context drawer resolves that record only from an additional authorized,
incident-scoped board view. It never performs an unrestricted record fetch.
When the record is absent, the operator sees **Record unavailable in this
view**. The return control restores the validated prior route, including its
filter and extent-compatible query context. Foreign-incident return routes are
not offered.

## Responsive shell behavior

The previously approved frame remains the presentation surface. Controlled
layout values hydrate its compact rail, drawer visibility, and drawer width.
Wide drawers remain docked; overlay and narrow drawers keep the frame's modal
focus, Escape, and restore behavior. Resizing saves only the active Map, Boards,
or Planning arrangement.

## Verification boundary

Focused DOM tests cover malformed and bounded routes, explicit period unset,
Browser Back period restoration, incident switching, stale async suppression,
CAS conflict recovery, authenticated position switching, controlled shell
layout, and incident-scoped record context. The server/client assigned-position
and board-view query seams retain their focused authorization and request tests.

Root acceptance passed on 2026-09-21. All-workspace TypeScript and full-tree
ESLint passed. The affected integration run passed 14 suites; the shell browser
fixture needed period-bearing record links and explicit restoration/modal
interactions. Its corrected run passed all four actual PostgreSQL/Chrome
journeys and all six context regressions. Live evidence covers reload,
second-incident isolation, Back period restoration, position sign-in and denial,
scoped preferences, CAS recovery, selected-record return, both themes and no
external requests. Position sign-out and stale asynchronous responses retain
their focused session/component proofs. Evidence is retained under
deploy/test-runtime/out/lanes/d/logs and browser-shots/shell-context.

## Deferred ownership

Board/table feature expansion remains with P-BOARDS. The desktop adapter remains
D31/85-B. This unit does not implement a new period editor, position assignment
workflow, record authority path, or cross-incident data search.
