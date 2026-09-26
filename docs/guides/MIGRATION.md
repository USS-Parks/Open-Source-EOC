# WebEOC migration

OpenEOC can take the records of a WebEOC board from the CSV file WebEOC
exports for that board and write them into a board here. Only records move.
WebEOC processes, views, links and menus are not migrated; build what you need
here (see the [Board designer guide](./DESIGNER.md)).

The screen is **Administration > Records > WebEOC migration**, so it is open to
administrators.

## Before you start

- Create the target board first, with a field for each WebEOC value you want
  to keep. One export goes into one board.
- Export the WebEOC board as CSV and save the file as UTF-8. The importer reads
  every file as UTF-8, so a file saved in another encoding garbles letters
  outside plain ASCII. The first row must hold the column headings.
- Find out which time zone the WebEOC server wrote its dates in.

## The import template

After choosing the **Target board**, select **Download import template**. The
CSV has a column for each field a file can fill, headed by the field's key,
which this screen and a board's own **Import** both match. Under the heading
of each choice field it lists the values that field accepts: the product's
dictionary values (such as `normal`, `warning`, `critical` and `unknown` for a
severity) or the field's own list. Every other cell is blank. Replace the
listed values with your records, one row each, before you check the file; a
row left from the list is checked like any other.

## Map, check and import

1. Open **Administration**, then the **Records** tab, and go to **WebEOC
   migration**.
2. Choose the **Target board**. When the board has a saved mapping, the screen
   says when it was last saved and loads the mapping and its time zone.
3. Choose the **WebEOC server time zone**. It starts as the saved zone, or as
   this browser's zone when none is saved.
4. Choose the file under **WebEOC CSV export**. The file is checked at once.
   A check writes nothing.
5. Review **Board fields and their WebEOC columns**. Each board field shows the
   column that fills it, or **Not imported**. Required fields are marked
   (required). Calculated fields are not listed and are never imported. Until
   a mapping is saved, a field is matched to a column whose heading equals the
   field's key or label, ignoring case, spaces and punctuation. Correct any
   column that is wrong.
6. Select **Check file** after any change. **Import** stays off until the file
   has been checked with the mapping and time zone now on screen, and until
   that check found at least one row to create.
7. Select **Save mapping** to keep the mapping and time zone for this board.
   The next file for the board starts from them. Each save is recorded in the
   audit trail.
8. Read the **Check result**: rows read, how many will be created, how many
   were already imported and how many are rejected, with the reason for each
   rejected row. Use **Show** to list one outcome. The screen lists the first
   200 rows; the rejection report holds every rejected row.
9. Select **Import** (it names the number of records). The valid rows are
   written together. Rejected rows and rows already imported are left out.
   The **Import result** replaces the check result.

Each imported record goes through the ordinary record write: it gets a
creation entry in the audit trail and a change history, it synchronizes like
any other record, and it appears in live views and dashboards. The import
sends no notifications for the records it writes.

## Fix rejected rows and import again

1. Select **Download rejection report**. It saves `webeoc-rejections.csv`: a
   **Rejected row** column with the row's number in the original file (the
   heading row is row 1), a **Rejection reason** column, then the row's
   original cells under the original headings.
2. Correct the cells in a spreadsheet and save the file as CSV in UTF-8. Text
   that a spreadsheet would run as a formula starts with an apostrophe in the
   report; the importer removes that apostrophe when the file comes back.
3. Choose the corrected file, check it and import it. The two added columns
   are not imported. A row whose `dataid` was imported in the meantime is
   skipped.

## The import report and its sign-off

Every import that writes keeps a report under **Administration > Records >
Import reports**: the WebEOC migration, a people import (see the
[Administrator guide](./ADMIN.md)), a parcel baseline import, a form import
and a signed solution package import. A check writes no report. The list
shows, newest first, what each import went into, the file, who ran it and
when, and how many rows it read, created, updated, skipped and refused.

Open a report to see the file column it used for each field and every row
with its outcome and, for a refused or skipped row, the reason. An
administrator of the jurisdiction who has checked the import selects **Sign
off this report**, with an optional note. The sign-off records who and when,
happens once, and is recorded in the audit trail. Only administrators of the
jurisdiction read the reports.

## WebEOC bookkeeping columns

A WebEOC export carries bookkeeping columns beside the board's own fields:
`dataid`, `prevdataid`, `entrydate`, `username`, `positionname` and
`subscribername`. The importer finds them by heading, ignoring case. Their
values are kept on each record's creation entry in the audit trail, under
`source` together with `system` set to `webeoc`, so who entered a record in
WebEOC, from which position and when stays on file. **Download audit CSV** on
the same tab includes them in the `payload` column of each
`board.record.created` entry (see
[Export the audit trail](./ADMIN.md#export-the-audit-trail)). The audit trail
names the person who ran the import as the one who created the record here.

These columns fill a board field only when one is mapped to it. The importer
does not link rows by `prevdataid`: every row that passes becomes its own
record.

## Importing the same export twice

- A row with a `dataid` imports once per board. The board remembers each
  `dataid` it imported, and a later check or import lists a row with that
  `dataid` as **Already imported** and writes nothing for it. A later, longer
  export of the same WebEOC board therefore adds only its new rows. A value
  changed in WebEOC after its row was imported is not updated here.
- A row whose `dataid` appears on an earlier row of the same file is rejected,
  unless that `dataid` was already imported, when both rows are skipped.
- A row without a `dataid`, and every row of a file with no `dataid` column,
  imports every time: importing it twice creates its record twice. The check
  result warns when the file has no `dataid` column.
- A rejected row is not remembered, so it imports once it is corrected.

## How values are read

- **Text** is kept as written. A value longer than the field allows (4,000
  characters unless the field sets its own limit) is rejected.
- **Numbers** are plain numbers such as `12` or `3.5`, without thousands
  separators or currency signs.
- **True or false** fields take `true`, `yes`, `1`, `false`, `no` or `0`, in
  any case.
- **Choices** must match one of the field's options. Case, spaces, underscores
  and hyphens are ignored, so `Out of service` matches `out_of_service`. A
  value that matches no option, or more than one, is rejected and the reason
  lists the options.
- **Locations** take a GeoJSON geometry written in the cell, such as
  `{"type":"Point","coordinates":[-123.9,41.5]}`.
- An empty cell leaves the field empty. A required field left empty, or with
  no column mapped to it, rejects the row.

### Dates and times

| Form | Examples | Read as |
|---|---|---|
| ISO 8601 with an offset or `Z` | `2026-09-20T14:00:00-07:00`, `2026-09-20T21:00:00Z` | Kept as written |
| Year first, local | `2026-09-20 14:05:00.000`, `2026-09-20T14:05`, `2026-09-20` | In the WebEOC server time zone |
| Month first, local | `9/20/2026 2:05 PM`, `09/20/2026 14:05:30`, `9/20/2026` | In the WebEOC server time zone |

A date without a time is read as midnight. The year has four digits. A
month-first date is always read month first: `20/09/2026` is rejected and
`05/09/2026` is May 9, so convert day-first dates before importing. A local
time that does not exist, because the clocks moved forward that night, is read
one hour off.

## Limits

- A file holds at most 10,000 rows, not counting blank rows, and at most 10 MB.
  A larger file is refused whole and nothing is written; split it.
- The screen lists the first 200 row outcomes. The counts and the rejection
  report cover every row.

## What the importer does not do

- **No value translation.** There is no lookup table from WebEOC values to
  values here: `High` does not become `critical`. Change such values in the
  file before you check it.
- **No latitude and longitude to location.** Separate latitude and longitude
  columns are not combined into a location. Map them to number or text fields,
  or write a GeoJSON geometry into one column before importing.
- **Jurisdiction-wide only.** An imported record belongs to the board for the
  whole jurisdiction and is not tagged with any incident.
- **No person or record references.** Person, record reference and attachment
  fields hold identifiers of people, records and files here, and the importer
  does not look up WebEOC user names, linked entries or attachments. Leave
  those fields **Not imported**; a mapped column of WebEOC values rejects every
  row that fills it. The WebEOC `username` and `positionname` stay in the audit
  trail.
