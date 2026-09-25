# Instructor Outline

This outline runs the training kit as a half-day or full-day class on the
synthetic demonstration incident. Read the [kit index](./README.md) and the
[facilitator guide](./EXERCISE-FACILITATOR-GUIDE.md) first.

## Audience and class size

- EOC staff who will hold one of the eight exercise positions. Players should
  already know basic ICS and EOC structure; the class teaches OpenEOC, not
  ICS.
- One exercise cell is eight players at one host computer, one per position,
  plus a controller and at least one evaluator. With fewer players, one
  person holds two positions that share a section, such as Planning Section
  Chief and Situation Unit.
- The acceptance profile binds to `127.0.0.1`, so a cell cannot be spread across
  computers. For a larger class, run one host computer per cell, each
  restored from the same golden copy. Cells do not see each other's data.
- On one host, give each player a separate browser profile, or sign out
  before handing over the keyboard. Every action must carry the right name.

## Half-day agenda (4 hours)

| Start | Length | Block | Content |
|---|---|---|---|
| 0:00 | 15 min | Welcome | Kit ground rules, synthetic data only, the server enforces roles |
| 0:15 | 30 min | Guided tour | The instructor drives the core walkthrough of the [synthetic incident demonstration](../../DEMO-SCENARIO.md) on a projector |
| 0:45 | 25 min | Job aids | Each player reads their job aid, signs in, sets the command bar and finds every screen it lists |
| 1:10 | 10 min | Break | |
| 1:20 | 2 hours | Exercise | Modules 1 to 3 of the [situation manual](./EXERCISE-SITUATION-MANUAL.md), ending after inject 3.3 |
| 3:20 | 25 min | Hotwash | As in the facilitator guide |
| 3:45 | 15 min | Wrap | Written feedback; where to read further |

The half day leaves out module 4. Record objective 6 as not exercised rather
than rating it.

## Full-day agenda (7 hours 45 minutes with lunch)

| Start | Length | Block | Content |
|---|---|---|---|
| 0:00 | 20 min | Welcome | Kit ground rules and the limits that shape the exercise |
| 0:20 | 40 min | Guided tour | Core walkthrough of the synthetic incident demonstration |
| 1:00 | 30 min | Continuity | The demonstration's continuity walkthrough: a queued Smart Forms report and an offline task completion, reconciled to a receipt |
| 1:30 | 15 min | Break | |
| 1:45 | 60 min | Position practice | Each player works the "First 15 minutes" and "Every operational period" parts of their job aid, with the instructor circulating |
| 2:45 | 45 min | Lunch | The host operator restores the golden copy so the exercise starts clean |
| 3:30 | 2 h 45 min | Exercise | All four modules |
| 6:15 | 10 min | Break | |
| 6:25 | 30 min | Hotwash | As in the facilitator guide |
| 6:55 | 35 min | After-action | The class records observations and corrective actions on **Planning > AAR** and compiles the PDF |
| 7:30 | 15 min | Wrap | Written feedback; where to read further |

## Setup checklist

Do this the day before, on the host computer, from the repository root. The
launcher commands are described in
[Windows desktop setup](../../WINDOWS-DESKTOP.md).

1. Build and create the acceptance profile, whose seed is this exercise's.
   In PowerShell, set `$env:OPENEOC_ENABLE_ACCEPTANCE_PROFILE = '1'` first;
   every launcher command below needs it. Then
   `.\deploy\windows\Open-Source-EOC.ps1 -Action Build`,
   `-Action Setup -Profile acceptance` and `-Action Start -Profile acceptance`.
2. Sign in as `demo-admin@example.org` with the password
   [Windows desktop setup](../../WINDOWS-DESKTOP.md) gives. The acceptance
   profile requires two-step sign-in of its administrators, as production
   does (the demo profile, whose North Coast accounts are synthetic, is the
   one that signs administrators in with a password alone). Enroll the
   instructor's authenticator app and keep the recovery codes with the class
   materials.
3. On **Administration > People**, create one admin account for the EOC
   Director and five member accounts: Planning Section Chief, Situation Unit,
   Logistics Section Chief, Public Information Officer and field user. Use
   `example.org` addresses and first passwords of at least 12 characters.
   Operations uses the seeded `demo-operator@example.org`; evaluators use
   `demo-viewer@example.org`.
4. On **Administration > Positions**, add a position named Situation Unit
   Leader. Assign Incident Commander to the director, Liaison Officer to
   `demo-admin@example.org`, and each other position to its player. The
   seeded operator already holds Operations Section Chief.
5. Sign in once as the director account and enroll its authenticator on the
   instructor's device.
6. On **Coordination > Contacts**, add a contact for each player linked to
   their account, and a group of all of them named `SYNTHETIC EOC staff`.
7. Sign in as each account. Check that the Acting position list shows the
   right position, then sign out.
8. Print a situation manual for every player, each job aid, the
   [inject cards](./EXERCISE-INJECT-CARDS.md) and rating sheets.
9. Stop the profile with `-Action Stop -Profile acceptance`. Copy the whole
   profile directory, `deploy\windows\out\profiles\acceptance`, to a golden
   copy outside the repository.
10. Start the profile again and confirm it with `-Action Status -Profile acceptance`.

## Reset between classes

OpenEOC has no reset inside the product. Records, history and the audit trail
are append-only by design. Reset by restoring the golden copy:

1. Stop the profile: `-Action Stop -Profile acceptance`.
2. Move the used acceptance profile directory out of the profiles folder. Keep it
   until the class's after-action report is final.
3. Copy the golden copy into its place under the same directory name.
4. Start the profile and check it with `-Action Status -Profile acceptance`.

Restore only under the Windows account that made the copy; its secrets
directory is private to that account.

The seed writes its times relative to the moment of setup, and a restored
copy keeps them. On a later day, **OP SYNTHETIC 1** may already have ended and
the seeded assessments will read older than the scenario says. Either let the
controller announce the scenario time and carry on, or build a new golden
copy: stop the profile, move its directory out, run
`-Action Setup -Profile acceptance` again and repeat the setup checklist. A new
setup needs new authenticator enrollment. After an interface change in the
checkout, run `-Action Build` first; Start refuses a stale build.

## Materials

- The [kit index](./README.md) and the eight job aids, one set per position.
- The [situation manual](./EXERCISE-SITUATION-MANUAL.md) for every player.
- The [facilitator guide](./EXERCISE-FACILITATOR-GUIDE.md) for staff, and
  the [inject cards](./EXERCISE-INJECT-CARDS.md), cut from the situation
  manual's module tables.
- A projector for the guided tour, a visible clock for the scenario time, and
  the instructor's authenticator device.
