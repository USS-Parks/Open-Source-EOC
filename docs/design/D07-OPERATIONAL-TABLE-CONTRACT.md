# D07 Operational Table Contract

Status: implementation contract for the shared operational table. The canonical references are `01-overview-light.jpg` (Priority work), `03-lifelines-light.jpg` (Related ESF coordination), and the navy dark treatment in `02-overview-dark.jpg`.

## Public component

`OperationalTable<Row>` is controlled. A caller supplies the current page of rows, stable record IDs, column definitions, query and presentation state, page facts, dataset identity, load state, selection, and callbacks. The component never fetches data and never assumes the current page is the whole server result.

`OperationalTableViewState` contains:

- compact or comfortable density;
- ordered column IDs, pixel widths, and start/end pinning;
- one sort descriptor and string filters keyed by column ID;
- zero-based page and bounded page size.

Column definitions provide a stable ID, header, value reader, optional renderer, sort/filter capabilities, width bounds, alignment, and explicit missing-value text. Long text wraps. Null, undefined, and empty-string values render `Not provided` unless the column supplies another label.

The caller owns query execution. Sort, filter, and page-size changes reset page to zero. The gallery adapter executes those operations against its in-memory fixture; production surfaces may execute them on the server. `totalRows` is explicit and may be null. A null total displays `N loaded; total unknown`, never a false total inferred from the current page.

## Selection and bulk actions

Eligible IDs are exactly the unique IDs in the current ready page. The component intersects controlled selection with those IDs after a successful refresh. It clears selection when `datasetKey` changes. While a new query or dataset is loading, stale rows are not reconciled as if they belonged to the new result and all selection and bulk controls are disabled.

The header checkbox selects the current page only. Copy says `selected on this page`. A bulk handler receives a stable sorted copy of the reconciled current-page IDs. Hidden, deleted, stale, off-page, and previously filtered IDs cannot reach the handler.

## Column interaction and keyboard behavior

Headers retain stable React keys during sort, pin, move, and resize updates. Sort uses a button and native `aria-sort`. The D06 `Menu` exposes pin start, pin end, unpin, move left, and move right actions.

Each resize handle is a focusable vertical separator with numeric bounds. Left and right arrows change width by 8 pixels; Shift changes it by 24 pixels; Home and End apply the minimum and maximum. Pointer drag uses the same bounds. Resizing does not remount the handle or discard focus.

Pinned columns use computed sticky offsets. The selection column stays pinned at the start, so start-pinned data begins after it. The table scrolls inside its own region rather than widening the page.

## Saved views and SEAM

`useOperationalTableViews` is the controller for saved compositions. Its visible scope is the tuple:

`personId + incidentId + tableId + tableSchema`

Any scope change immediately returns an empty loading snapshot and invalidates pending load/save/delete completions. This prevents a previous account or incident from appearing during the next load. The server still provides the authoritative person and incident RLS boundary.

The injected `TableViewPersistence` matches the four typed `ApiClient` table-view methods. There is no localStorage copy and no direct fetch path. Keys use `tableId:viewId`, the SEAM character grammar, and the 128-character combined limit. The payload stores table identity, schema identity, label, and presentation/query state. It excludes selection and transient page.

SEAM list responses may contain other table IDs. The controller filters each page by exact key prefix, payload table ID, and table schema, and continues through `nextCursor` until the server ends pagination. A repeated cursor fails explicitly.

Writes use the saved revision as `expectedRevision`. A conflict preserves the last saved view and the caller's current draft, then reports an explicit reload-before-save state. Failed saves never replace the prior saved revision. Applying a view starts on page zero.

## States and visual treatment

Loading, empty, and failed states use the D06 feedback components. A failed or loading table disables record actions. The table reuses D06 buttons and menus, design tokens, focus treatment, and light/dark themes. Dark mode uses the existing navy surfaces and restrained operational status colors.

The review gallery is presentation-only and injects an in-memory persistence adapter. The real persistence acceptance test runs the same four `ApiClient` methods through Fastify's integration transport and the real PostgreSQL SEAM, proving person and incident isolation plus CAS conflict behavior.

## Compatibility boundary

D07 introduces new `table*` design modules and does not change existing design components or adopt the table in consumer surfaces. Future list surfaces compose the controlled component with their own server query adapter. No second table persistence or counting mechanism is introduced.

## Acceptance evidence

Root reviewed the full unit and passed workspace TypeScript, tree ESLint,
table/saved-view/accessibility and real PostgreSQL SEAM tests, 24/24 including
the replayed H14 suite. Replayed icons passed 12/12, desktop 10/10 and D08 21/21.
The overlapping-ID dataset-switch regression prevents an old selection from
surviving a changed dataset while the controlled clear is pending.

Four actual browser captures passed keyboard resize/focus, exact filtered
bulk IDs, long and missing values, both themes and bounded page width, with
zero page errors or external requests. Root viewed wide light and dark.
The error state intentionally has no row scroll surface; the fixture checks
page containment there. Evidence in the canonical checkout:
`deploy/test-runtime/out/d07-review/result.json`, `browser-state-repair.log`
and `shots`, plus `out/lanes/b/logs/D07-root-integration.log`.
Fresh independent review: SHIP. Gallery ESF rows are a related subset using
California titles; P-LIFE-3 owns the complete inventory of all 18 California ESFs.
