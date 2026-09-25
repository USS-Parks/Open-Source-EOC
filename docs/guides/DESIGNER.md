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

## Reference labels from several fields

A `record_ref` field names its target board and the target fields its label
is made from. In the **Fields** tab, **Target label fields** takes up to four
target field keys, in display order, separated by commas, for example
`unit_id, name, station`; an existing reference field has the same control as
*key* **label fields** when its row is opened. The label joins the values with
" / ". One key is stored as `labelField`, several as `labelFields`. A label
field the reader cannot read is left out of the label; a reader who can read
none of them cannot pick or save the reference.

## Signature fields

A `signature` field takes a signature drawn on a pad with a mouse, pen or
finger, or, for anyone signing without a pointer, the signer's name typed and
set in script on the same pad with **Use my typed name**. The signer also
types who is signing. **Sign** stores the drawn image as a file of the
jurisdiction, as an attachment is, and the field keeps that file with the
signer's name and the time; the record's history keeps who saved it.
**Sign again** replaces a signature before the record is saved. The record
shows the signature's image with who signed and when; a table, a calendar, an
export and the history show "Signed by" the signer and the time. An import
refuses a signature column, since a signature is signed on screen. A local
field may be a signature, which is how a jurisdiction adds, for example, a
section chief's approval to its ICS 213RR board.

## Restrict individual records

The **Record access** tab limits who may read and who may edit each record,
beyond the board's own roles. **Restrict individual records** starts a rule
where the record's creator and the creator's position read and edit; **Remove
record restriction** takes the rule away. Each grant is a checkbox with its
meaning beside it, under **Who may read a record** and **Who may edit a
record**, and any one checked grant is enough:

- **Board members**: every holder of the member role on the board. An incident
  participant from another organization counts as a member.
- **Board viewers** and **Guests**: every holder of that role. They can hold
  read grants only.
- **The record's creator**: the person who created the record.
- **The creator's position**: anyone assigned to the position the record was
  created under.
- **The assigned position**: anyone assigned to the position the record's
  workflow is currently assigned to. It needs workflow routing.

Each list needs at least one grant; the review tab names an empty one. The
template stores the rule as `recordAccess` with `read` and `edit` lists.

Jurisdiction administrators always read and edit every record. The database
applies the rule, so a restricted record is absent from views, exports,
reference choices, record detail, history, the chronology, dashboards and map
layers for anyone it excludes, and so are files attached to it. Keep the
creator or the creator's position in the read list unless writers should lose
sight of what they submit; the tab warns when neither is checked. A person who
cannot read every record of a board cannot open it for offline sync: the board
screen says so, Smart Forms does not queue reports for it, and the continuity
panel keeps any work queued for it on the device without asking for a new
session.

Two paths an administrator configures are not governed by the rule: a
notification rule delivers the record to the destinations it names, and a
sharing agreement sends the board's live edits to the partner instance. Point
neither at a board whose records some people must not see unless every
destination may see them all.

## Local fields

The **Local fields** tab appears when customizing an existing board. It adds a
field to that board at once, without publishing a template version, and lists
the local fields the board already has. A local field key starts with `x_`;
the tab adds the prefix when it is missing. A local field is never required,
cannot be a reference, and has no condition or calculation. Only a
jurisdiction administrator can add one. When a later template version adds a
field with the same key without the prefix, the upgrade replaces the local
field with the template's.

## Template properties beyond the designer screen

View conditions, sort keys and groups are part of the template definition and
are validated when a version is registered or imported. The designer's view
editor offers the `eq`, `neq` and `in` filters and one sort key; add the
properties below to the template JSON of a new version.

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

Operators refine a view for one read with the same conditions, sort keys and
group field under **Filter, sort and group** on the board screen; a refinement
never widens what the reader may see.

## Archive and delete

Board writers who may edit a record can archive it: it leaves the default
views and returns when restored, with references and history unchanged.
Jurisdiction administrators can delete a record. Deletion keeps the row as a
tombstone that no read path returns, records the prior values in the history,
and removes the record from sync documents. Neither needs a template property;
both are in the record detail on the board screen.

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

## Dashboard widgets

A dashboard template lists widgets, each bound to a board template key
(`board`) and computed on the server over the matching board. Besides `tile`,
`status` and `list`, three widgets follow the board's view modes:

- `chart` counts records by `groupBy`; with `"display": "bar"` it is the count
  chart, and `"donut"` draws a ring.
- `kanban` counts records per value of the enumeration `field`: one column per
  value in the field's own order, zero included, then any other stored value,
  then "No value".
- `calendar` lists the next `limit` records (at most 50, 10 by default) whose
  datetime `field` is now or later, soonest first, titled by `labelField`.

```json
{ "kind": "kanban", "key": "work_by_status", "title": "Work by status",
  "board": "synthetic_ops", "field": "status" }
{ "kind": "calendar", "key": "work_due", "title": "Work due",
  "board": "synthetic_ops", "field": "due", "labelField": "summary", "limit": 5 }
```

Kanban and calendar widgets leave archived records out, as the board's own
view does; the older widget kinds still count them. A widget whose fields the
viewer cannot read shows as unavailable. In a saved incident overview, **Create
saved view** or **Configure view** lists every widget: a kanban summary sits
with the charts and a calendar with the activity lists.

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
  Importing creates no board. On **Templates**, **Create a board from a
  published template** takes any published template at its latest version,
  standard or imported, and an optional **Board title**, and **Create board**
  opens the new board.
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
