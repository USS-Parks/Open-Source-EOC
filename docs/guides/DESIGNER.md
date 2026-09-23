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
