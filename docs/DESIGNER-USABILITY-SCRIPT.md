# Designer Usability Script: the ten-minute shelter board

Purpose: the scripted walkthrough behind VEOC-10's acceptance ("an
administrator builds a working shelter board from nothing in under ten
minutes without code"). Run it with a naive administrator at VEOC-39's
timed audit; the automated version lives in
`web/src/boards/__tests__/designer.test.tsx`.

## Setup

Signed in as a jurisdiction admin, designer open on a blank board. Start a
timer at step 1.

## Steps

1. Name the board: key `camp_shelters`, title `Camp Shelters`. (target: 1 min)
2. Add field `name` / "Shelter name", type text, required. (2 min)
3. Add field `status` / "Status", type enum, enumeration
   `have.facility_operating_status`, required. Note for the observer: the
   status values come from the EDXL-HAVE standard; the admin picks them,
   never types them. (4 min)
4. Add field `capacity` / "Capacity", type number. (5 min)
5. Add field `occupancy` / "Occupancy", type number. (6 min)
6. Add view `all` / "All shelters" with columns name, status, capacity,
   occupancy. (8 min)
7. Review the change summary, save as version 1. (9 min)
8. Open the board, enter one record through the input view, and see it on
   the display view. (10 min)

## Pass criteria

- Timer under ten minutes at step 8.
- At no point did the administrator see or type HTML, JavaScript, or any
  markup.
- The saved template validates and the record round-trips.

## Observations log

Kept per run at VEOC-39; note every hesitation over five seconds and every
mis-click, each one is a design defect, not a user failure.
