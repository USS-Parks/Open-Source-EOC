# Board Designer Guide

Boards are versioned operational schemas with structured fields, input layouts,
and display views. Use the designer for local operational needs without adding
custom HTML or JavaScript.

## Start with the operational purpose

Write down the decision the board supports, who records it, who reads it, and
which values are sensitive. Reuse a standard template when it already models
the work. A new board is appropriate when the record lifecycle or accountable
owner is meaningfully different.

## Define fields

- Give every field a stable key and plain-language label.
- Prefer enumerations when doctrine defines the allowed values.
- Mark required data only when the operator can know it at capture time.
- Use geometry only for real locations or extents.
- Set read and write levels deliberately. An admin-only field stays masked from
  members and incident participants even when they may read the record.
- Prefix local template extensions with `x_` so upgrades can preserve and
  reconcile them.

Conditional and calculated fields use the shared form rules. Preview the exact
conditions and verify that hidden inputs do not silently submit stale values.

## Build input and display views

Group input fields in the order operators obtain the information. Keep the
primary list compact and include the fields needed to distinguish records.
Filters and sort rules are part of the view; they do not replace record or
field authorization.

Test long names, missing values, narrow screens, and keyboard operation. A
missing column value should remain visibly missing rather than becoming a
synthetic default.

## Template properties beyond the designer screen

The properties below are part of the template definition and are validated
when a version is registered or imported. Until the designer screen offers
controls for them, add them to the template JSON of a new version.

### Reference labels from several fields

A `record_ref` field names its target board with `targetBoardKey` and the
label operators see with `labelField`. To compose the label from more than one
target field, list up to four keys in `labelFields`, in display order, for
example `["unit_id", "name", "station"]`. The label joins the values with
" / ". A label field the reader cannot read is left out of the label; a
reader who can read none of them cannot pick or save the reference.

### View conditions, sorts and groups

- `filter` keeps its `eq`, `neq` and `in` rules. `where` adds conditions with
  more operators, all of which must hold: `not_in`, `contains` and
  `starts_with` (text and enumerations, ignoring case), `gt`, `gte`, `lt`,
  `lte` and `between` for numbers, `before`, `after` and `between` for
  datetimes, and `is_empty` and `is_not_empty`. A datetime value is an ISO
  timestamp with an offset or a relative time: `now`, or `now` plus or minus a
  whole number of minutes, hours or days, such as `now-7d`.
- `sorts` lists up to four sort keys, most significant first, and replaces
  `sort`. Numbers sort by value and datetimes by instant; an empty value sorts
  first in ascending order.
- `groupBy` names one field. Rows arrive ordered by it, and the first page of
  the view carries the record count of each group over every matching record.
  A group field cannot be a geometry or calculated field.

Operators can refine a view for one read with the same conditions, sort keys
and group field; a refinement never widens what the reader may see.

### Restrict individual records

`recordAccess` limits who may read and who may edit each record, beyond the
board's own roles. It has a `read` list and an `edit` list of grants, and any
one grant is enough:

- `{ "kind": "role", "roles": ["member", "viewer", "guest"] }`: every holder
  of a listed board role. An incident participant from another organization
  counts as a member. Only `member` may appear in an edit grant.
- `{ "kind": "creator" }`: the person who created the record.
- `{ "kind": "creator_position" }`: anyone assigned to the position the
  record was created under.
- `{ "kind": "assigned_position" }`: anyone assigned to the position the
  record's workflow is currently assigned to. The board needs a workflow.

Jurisdiction administrators always read and edit every record. The database
applies the rule, so a restricted record is absent from views, exports,
reference choices, record detail, history, the chronology, dashboards and map
layers for anyone it excludes, and so are files attached to it. Include
`creator` or `creator_position` in the read list unless writers should lose
sight of what they submit. A caller who cannot read every record of a board
cannot open it for offline sync; they use its views.

Two paths an administrator configures are not governed by the rule: a
notification rule delivers the record to the destinations it names, and a
sharing agreement sends the board's live edits to the partner instance. Point
neither at a board whose records some people must not see unless every
destination may see them all.

### Archive and delete

Board writers who may edit a record can archive it: it leaves the default
views and returns when restored, with references and history unchanged.
Jurisdiction administrators can delete a record. Deletion keeps the row as a
tombstone that no read path returns, records the prior values in the history,
and removes the record from sync documents. Neither needs a template property.

## Preview and publish a revision

1. Review the structural diff from the current version.
2. Preview create, list, detail, filter, and map behavior with synthetic data.
3. Confirm field permissions with admin, member, and viewer accounts.
4. Publish a new version. Existing records remain; history is not rewritten.
5. If another designer published first, reload the current revision and
   reconcile the changes. Do not overwrite a revision conflict blindly.

Signed template packages can distribute an approved board definition to other
instances. Trust of the signing key and local import authority are still
required; package exchange does not share operational records.

## Import definitions

The designer's **Import** tab takes definitions from files. Open it from
**Templates**, through **Create template** or **Customize**; it needs an
instance administrator who also administers the selected jurisdiction.

- **Board template file**: a template's JSON definition, published under its
  key when its `version` is the next one for that key, or a signed template
  package (`"format": "openeoc-templates-v1"`). A package is accepted only
  when the server trusts its publisher key, and versions the instance already
  holds are skipped. The server trusts the public keys in the PEM file that
  `OPENEOC_TRUSTED_TEMPLATE_KEYS` names; with it unset, every signed package
  is refused.
- **Form file**: an XLSForm workbook (`.xlsx`) or form definition JSON. A
  workbook is stored under a key made from its file name, in lower case with
  every other character turned into an underscore, as version 1:
  `Road Closure.xlsx` becomes `road_closure`. JSON carries its own key and
  version. Forms belong to the selected jurisdiction.
- **Dashboard template file**: the JSON definition that
  `GET /api/v1/dashboard-templates/:key/:version/export` returns.

JSON is checked before it is sent, and a malformed file is reported with the
fields at fault. A refusal from the server, such as a version that already
exists or an unreadable workbook, is shown in the server's words. Each import
is listed under **Imported**. An import adds a version and changes no existing
board.

For the timed walkthrough, see
[the designer usability script](../process/DESIGNER-USABILITY-SCRIPT.md).
