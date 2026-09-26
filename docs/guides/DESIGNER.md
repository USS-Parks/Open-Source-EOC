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

## Guard a transition and lock fields in a state

On the **Routing** tab, each workflow state has **Read-only while** the state,
a checkbox per field. A field checked there cannot change while a record is in
that state: the edit form shows it disabled with "Read-only while the record
is" the state, the server refuses a changed value with the same reason, and a
change arriving through offline sync becomes a conflict the record's history
keeps. Creating a record sets its fields whatever the initial state locks.
Jurisdiction administrators are held to it too; to change a locked field, take
a transition back to a state that leaves it open.

Each transition has **Guard this transition with conditions on the record**.
A guard is conditions on the record's fields, written as a board view's
conditions are, and **The transition needs** every condition or any of them
to hold. **Said when the guard refuses** replaces the plain list of unmet
conditions with your own words. The record detail shows a guarded transition
the record does not meet as unavailable, with "Not yet:" and the reason, and
the server refuses it with the same reason. A transition that waits for
approvals is checked again when its last approval would complete it, and
refused then if the record no longer meets the guard; the approval is not
recorded. A condition still being typed is left out of the guard until its
value is complete, and the designer says so. The template stores these as
`readOnlyFields` on a state and `guard` (`match`, `conditions`, `message`) on
a transition.

## Add actions to a board

The **Actions** tab gives a board things it does by itself. **Add action**
starts one; each has a key, a label, **runs when** (a record is created, a
field changes, or the record enters a workflow state), optional **Run only
when conditions on the record hold**, written as a guard's conditions are,
and one step it **does**:

- **Set a field** to a value: text, a number, yes or no, one of an
  enumeration's values, or for a date and time, when the action runs or an
  hour or a day after.
- **Create a linked record on another board**: a board of the same incident,
  chosen by its template, with **reference back to this record** naming its
  reference field to this board, and **Copy a field into the new record** for
  each field copied across. The record must be part of an incident, and the
  incident must use exactly one board made from that template.
- **Request a workflow transition**, as pressing its button would. A
  transition that needs approvals waits for them.
- **Send a notice in the app** to the record's creator or to the holders of a
  position. Email, SMS and push stay with notification rules, which fire on
  an action's writes as on anyone's.

An action runs as the person whose change set it off, with that person's
authority and no more: a field they may not write, a record they may not
edit, a field their record's state keeps read-only and a transition whose
guard the record does not meet are refused, and a field they may not read is
not copied. A refused step changes nothing and leaves the person's own change
in place. An action's write can set off other actions, on this board or the
one it wrote to; that chain stops an action that already ran in it, and any
action more than five deep. The record's **Change history** names the action
on each write it made and records every run, done, refused or stopped, with
the reason. Edits that arrive through sync set actions off as edits on screen
do, as the person who made them, including an offline edit when its device
reconnects, once however often the device sends it. Form submissions,
imports and records received from a federation peer do not. The template
stores these as `actions`, each
with `key`, `label`, `trigger`, an optional `condition` (`match`,
`conditions`) and `step`.

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
cannot read every record of a board syncs it per record: the device is sent no
records from it, and each record the person sends offline is written through
the rule on its own, so an edit the rule refuses is a conflict. Opened
jurisdiction-wide rather than on an incident, such a board is not synchronized
at all.

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

## Conditions: all or any, groups, days and text

A view's conditions, a transition's guard and an action's conditions are
written with the same controls. Each condition is a field, an operator that
fits the field's type, and a value. **Add condition** adds one; the set's
first choice says whether **Every condition to hold** or **Any condition to
hold**. **Add group** adds a group of conditions with its own every-or-any
choice, so a set can say "due today, or high priority and overdue". A group
holds conditions only; groups do not nest further. A set holds up to 16
conditions and groups, and a group up to 16 conditions. A condition still
being typed is left out until its value is complete, and the designer says
so.

The operators, by the type of field:

- Text: contains, starts with, is, is (ignoring case), is not, is one of, is
  not one of, is empty, is not empty. Contains, starts with and the
  ignoring-case comparison ignore upper and lower case.
- Enumerations: the same, without the ignoring-case comparison.
- Numbers: is, is not, greater than, at least, less than, at most, between,
  is empty, is not empty.
- Dates and times: after, before, on, between, within the last N days,
  within the next N days, is empty, is not empty.
- Yes-or-no fields: is, is empty, is not empty; other fields: is empty, is
  not empty.

A date and time value is one of:

- a time: now, a preset such as 24 hours ago, or a specific time;
- a day: today, a number of days from today (negative for earlier days), or
  a specific date. Before a day means before it starts; after a day means
  after it ends; on a day and between days take the whole day.

Within the last or next N days is a rolling window of N times 24 hours
ending or starting now, so it depends on no time zone. A day depends on
one: when a set names a day, **Days counted in time zone** appears, set to
the author's own browser time zone, the zone the product reads dates in
elsewhere. A saved view, guard or action keeps its zone, so every reader,
the server and an offline device count the same days; a set with no zone
counts days in UTC. An operator's refinement on the board screen counts
days in the operator's own zone.

The template stores a set as `match` (`all` or `any`), `conditions` (on a
view, `where`) and `timeZone`; a group is an entry with its own `match`,
`conditions` and optional `timeZone`. The operators are `eq`, `neq`, `in`,
`not_in`, `contains`, `starts_with`, `eq_ignore_case`, `gt`, `gte`, `lt`,
`lte`, `between`, `before`, `after`, `on`, `within_last`, `within_next`,
`is_empty` and `is_not_empty`. A time value is an ISO timestamp with an
offset, `now`, or `now` plus or minus whole minutes, hours or days, such as
`now-7d`; a day value is `today`, `today` plus or minus whole days, such as
`today-3d`, or a date that exists, such as `2026-09-30`; `within_last` and
`within_next` take a whole number of days from 1 to 3650. A stored list
without `match` holds when all of it does, as it always has. This is a
fixed set of operators, not an expression language (ADR-0004).

Smart Forms keep the XLSForm expression subset; it now also reads
`contains()` and `starts-with()`, which compare case as ODK does. It does
not read `today()`: a form is checked on the device and again on the
server, and the two would have to agree on the day.

## View options

Every option of a view is set on the **Views** tab. **Add view** takes a
key, a title and its columns. Opening a view shows:

- its title and its columns, each moved up or down to set their order;
- **Conditions for view**, written as above;
- **Sort**, up to four sort keys, most significant first, each ascending or
  descending. Numbers sort by value and datetimes by instant; an empty value
  sorts first in ascending order. With none, the newest records come first;
- **Group by**, one field. Rows arrive ordered by it, and the first page of
  the view carries the record count of each group over every matching
  record. A group field cannot be a geometry or calculated field;
- the older filter rules (`filter`: equals, does not equal, is one of),
  which hold as well as the conditions.

The template stores these as `title`, `columns`, `where`, `match`,
`timeZone`, `sorts` (which replaces the older single `sort`), `groupBy` and
`filter`; each is validated when a version is registered or imported.

Operators refine a view for one read under **Filter, sort and group** on the
board screen, with conditions that must all hold or any one of them, sort
keys and a group field. The refinement holds as well as the view's own
conditions, so it never widens what the reader may see.

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

Under **Create-record tiles** in the same editor, choose one of the incident's
boards, a label if the default "New board record" does not suit, and preset
values for its text, number, yes or no and choice fields, then select **Add
create-record tile**. The tile sits with the statistics. Its button opens the
board's own form over the dashboard, filled with the presets, which the person
can change, and saves the record to the incident without leaving the
dashboard. Someone who can read the board but not add to it sees the button
disabled and the reason; the server refuses their record either way.

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
- **Signed solution package**: one file (`"format": "openeoc-package-v2"`)
  carrying board, incident, dashboard, report and rule templates and forms,
  signed by a publisher whose key the server trusts, as for a template
  package. A report template names its board template by key and carries its
  columns, conditions, groups, totals, sorts and when it runs; a rule template
  names its board template, event and condition, and reaches positions by key
  and contact groups by name. Neither carries addresses or recipients, which
  are each jurisdiction's own. Forms join the selected jurisdiction; the rest
  join the instance. The import runs as one step, and nothing already here is
  replaced:
  - a template or form version this instance holds with the same content is
    counted as already here;
  - the same key and version with other content, or a part naming a board
    template neither the package nor this instance has, refuses the whole
    package, and nothing is imported;
  - an incident template this instance already has under that key, edited
    here since, is kept as it is; edit it to take the package's.

  The result names what was created, what was already here and what was
  kept. A package changed after signing, or signed by a key the server does
  not trust, is refused with the reason. A package dropped on **Board
  template file** is imported the same way. Publishers make and sign
  packages with two server commands; see
  [Signing solution packages](../../deploy/README.md#signing-solution-packages).

JSON is checked before it is sent, and a malformed file is reported with the
fields at fault. A refusal from the server, such as a version that already
exists or an unreadable workbook, is shown in the server's words. Each import
is listed under **Imported**. An import adds a version and changes no existing
board.

For the timed walkthrough, see
[the designer usability script](../process/DESIGNER-USABILITY-SCRIPT.md).
