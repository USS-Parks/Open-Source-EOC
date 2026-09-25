# Reports

A report is a saved table built from one board: the columns to show, the
records to include, up to two groupings, counts and totals, and the sort
order. Open it from **Planning > Reports**. Every member of the jurisdiction
can open and run a saved report and download it. Members and administrators
build reports. The person who built a report, while still a member, and any
administrator can change or delete it.

## What a report shows the person running it

A report holds no data of its own. Each run reads the board as the person
running it, through the same rules as the board screen:

- A record that person cannot read, because of the board's record access
  rules, is not in the report, and its values are not in any count or total.
- A column, grouping or total over a field that person cannot read is left out.
  The report names the fields it left out: on screen above the rows, and in a
  PDF under the title.
- Archived records are left out unless the report asks to include them.

Two people can run the same report and get different rows. Neither sees
anything the board would not show them.

## Build a report

1. Select **New report**, enter a name and choose the board.
2. Tick the **Columns** to show. The builder starts with the board's first
   four fields.
3. When an incident is selected and it uses the board, tick **Only records of
   the incident** to limit the report to that incident's records.
4. Open **Filter, sort and group** to add conditions, sort keys and the first
   grouping, then select **Apply**. The conditions are the ones the board
   screen uses: text contains or starts with, equals, one of, greater or less
   than, between, before or after a time (including relative times such as 24
   hours ago), and empty or not empty. Every condition must hold.
5. Choose a second grouping under **Then group by**, if needed.
6. Under **Totals**, add a sum, average, minimum or maximum of a number field.
   Every group and all records always get a count of records.
7. Check the **Preview**. It runs as you and shows the first 25 rows; its group
   counts and totals cover every matching record.
8. Select **Save report**.

A report reads at most 50,000 records. A report that would read more is
refused; add conditions to narrow it.

## Run and download

Open a report from **Saved reports**:

- **Run** shows the first 100 rows on screen, then a table of counts and totals
  per group and for all records.
- **Download PDF** lays the rows out on landscape US Letter pages, with the
  title, the board and the column headings repeated on every page, a heading
  for each group and a total line after each group and at the end. The PDF uses
  the standard Helvetica font; characters outside Western European text print
  as a question mark.
- **Download Excel** and **Download CSV** give the rows as one plain table,
  grouping fields first. Below it, after a blank row, a second table gives the
  count and totals for each group and for all records. In CSV, text that a
  spreadsheet would run as a formula starts with an apostrophe.

## Schedule a report

The owner or an administrator can schedule a report under **Schedule** on the
open report:

- **Every day at a time**, in a named time zone such as `America/Los_Angeles`.
  The run follows the local clock across daylight saving changes.
- **Every so many minutes**, from 15 minutes to one week.

Each run produces the chosen format and sends it:

- by email, as an attachment, to each address entered and to the first email
  address of each chosen contact. Email goes through the jurisdiction's SMTP
  relay, which an administrator configures under **Administration >
  Channels**. A contact with no email address is skipped and the run notes it.
- to **Files**, when **Store each run in Files** is ticked. The file is stored
  in the jurisdiction's files, where every member can read it.

A scheduled run reads the board as the report's owner, not as the person who
set the schedule. Everyone who receives the email or opens the stored file sees
what the owner can read. Choose recipients and storage with that in mind.

The owner must still be a member or administrator of the jurisdiction for the
schedule to run. When the owner leaves or becomes a viewer, the schedule stops
until an administrator rebuilds the report under another owner.

Each scheduled run is listed under **Recent scheduled runs** with its time,
record count and outcome: delivered (the file was stored), emails queued,
partly delivered, or failed. A run is also recorded in the chronology. Emails
go through the delivery queue with the report attached, one per address, so
a relay that cannot be reached is retried until the email window under
Administration, Channels, closes (72 hours unless changed); each email's
delivery, and a resend if it expired, is under Notifications. The server
checks for due reports every minute
(`OPENEOC_SCHEDULER_REPORTS_MS`), so a run can start up to a minute after its
time.
