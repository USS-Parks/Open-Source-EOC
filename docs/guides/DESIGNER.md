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

For the timed walkthrough, see
[the designer usability script](../process/DESIGNER-USABILITY-SCRIPT.md).
