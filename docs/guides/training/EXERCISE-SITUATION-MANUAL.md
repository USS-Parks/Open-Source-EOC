# Exercise Situation Manual: Ridge Wildfire Tabletop

Every name, place, report and request in this exercise is synthetic. The
package follows the shape of a Homeland Security Exercise and Evaluation
Program (HSEEP) situation manual. It is not certified or endorsed by FEMA or
any other authority.

## Exercise overview

| Item | Detail |
|---|---|
| Exercise name | Ridge Wildfire Tabletop |
| Type | Tabletop exercise played at the keyboard in OpenEOC |
| Length | About 2 hours 45 minutes of play, then a 30-minute hotwash |
| Scope | One EOC activation over two compressed operational periods |
| Incident in the product | SYNTHETIC Ridge Wildfire Exercise, Synthetic Demo County OES |
| Hazard | Wildfire with power loss along a shelter corridor |
| Mission area | Response |
| Host | The demo profile of the Windows desktop launcher, on one computer |

## Objectives and core capabilities

| Objective | Core capability |
|---|---|
| 1. Within 15 minutes of StartEx, every player is checked in under their own account and position, command is announced on the Significant Events board, and the activation notice is acknowledged. | Operational Coordination |
| 2. Within 20 minutes of a field report, the closure is on the Road Closures board and the affected lifeline has an attributed assessment; the frozen SITREP keeps unknown and stale states visible. | Situational Assessment |
| 3. Every resource need is submitted and tracked through the ICS-213RR lifecycle, and the cost of deployed generators is recorded and exported. | Logistics and Supply Chain Management |
| 4. The road closure is recorded with its location and reopening estimate and is reflected in the Transportation lifeline and the plan. | Critical Transportation |
| 5. A media inquiry is answered only with a release approved for County OES, and an Exercise CAP record reaches local approval with no delivery claim. | Public Information and Warning |
| 6. An IAP for the second operational period, with at least one ICS-204 assignment, is assembled, submitted and approved, and the shift change keeps attribution intact. | Planning |

## Participants

- **Players** hold the eight exercise positions in the job aids and act in
  OpenEOC as they would in a real activation.
- **Controllers** run the clock, deliver injects and answer player questions
  about the scenario.
- **Simulators** play everyone outside the EOC: the utility, shelter staff,
  the neighbouring county and the media. In a small class the controllers
  simulate.
- **Evaluators** watch, collect evidence and rate each objective. They do not
  coach.
- **Observers** watch without speaking to players during play.

## Rules of play

1. Start every typed entry with `SYNTHETIC`.
2. Act only under your own account and acting position. A refusal from the
   server is part of the exercise; report it, do not work around it with
   another account.
3. When OpenEOC cannot do what your position needs, say so aloud, work around
   it in the open, and make sure it is recorded as an observation.
4. Queued, received, accepted and approved are not delivered. Say which state
   a thing is in.
5. Scenario time is compressed. Controllers announce the scenario time at
   each module.

## Assumptions and artificialities

- Nothing leaves the host computer: no email, SMS, IPAWS, collaboration
  channel or public website. The demo profile listens on `127.0.0.1` only.
- The seed has one organization. Outside agencies exist only as the
  simulators' voices; they cannot join the incident in the product.
- Seeded times date from when the demo profile was set up, so seeded
  assessment ages may not match the scenario clock. Use the controller's
  scenario time.

## Scenario background

A wildfire on the synthetic ridge grew overnight. The seed shows the picture
at StartEx:

- Energy is unstable: ridge distribution is interrupted and generator support
  is pending.
- Communications is unknown; field coverage has not been verified.
- Transportation carries a stale estimate from the day before.
- The other lifelines have no assessment. Missing is not stable.
- SYNTHETIC Route 12 is closed. The synthetic road source covers only part of
  the incident area.
- A request for three synthetic portable generators is accepted. Nothing has
  been ordered.
- A local exercise CAP record exists. It was never transmitted.

## Module 1: Activation and check-in (+0:00)

Scenario time 0600. County OES activates the EOC.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 1.1 | +0:00 | Controller | Liaison Officer | Call the EOC staff in with an in-app mass notification to the staff group. |
| 1.2 | +0:05 | Controller | All players | Report to the EOC: check in and take your position. |
| 1.3 | +0:10 | Controller | EOC Director | Assume command, announce it and state the initial objectives. |
| 1.4 | +0:20 | SYNTHETIC Ridge Electric (simulator) | Situation Unit | "The outage now covers 1,400 customers on the ridge. We cannot give a restoration time." |

Discussion questions:

1. Who confirms that every position is staffed, and how do you know an
   acknowledgement is real?
2. Where do the initial objectives live, given the IAP has no field for them?
3. What does the Energy assessment say now, and on whose evidence?

## Module 2: Field reports and resources (+0:40)

Scenario time 1000.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 2.1 | +0:40 | Controller | Field user | You find SYNTHETIC Ridge Road blocked by downed trees at mile 6, latitude 40.71, longitude -123.82. No vehicle can pass. Report it. |
| 2.2 | +0:50 | SYNTHETIC shelter manager (simulator) | Operations Section Chief | "SYNTHETIC Ridge Community Shelter is on battery lights. 85 of 120 spaces are occupied. We need a generator within four hours." |
| 2.3 | +1:00 | SYNTHETIC shelter manager (simulator) | Operations Section Chief | "Water pressure is gone. We need a potable water tender." |
| 2.4 | +1:10 | SYNTHETIC Harbor County OES (simulator) | Liaison Officer | "We can send two water tenders in three hours under mutual aid." |

Discussion questions:

1. How long did the blocked road take to reach the Road Closures board, the
   map and the Transportation assessment?
2. Which request is only received, which accepted, and who owns each?
3. The offer from Harbor County cannot be recorded as a partner assignment in
   this product. How did you record it, and what did you lose?

## Module 3: Situation report and public information (+1:25)

Scenario time 1400.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 3.1 | +1:25 | EOC Director | Planning Section Chief, Situation Unit | Freeze a SITREP for the 1500 briefing. |
| 3.2 | +1:35 | SYNTHETIC Valley Courier (simulator) | Public Information Officer | "Is Ridge Road closed, and does the shelter have power?" Answer only with language County OES has approved. |
| 3.3 | +1:50 | EOC Director | Public Information Officer | Prepare an evacuation warning for the ridge as an Exercise CAP record and take it to local approval. |

Discussion questions:

1. Which unknown or stale states appear in the frozen SITREP, and did anyone
   brief them as stable?
2. Who approved the release, and where is that decision recorded?
3. What would have to be configured before this alert could reach the public,
   and who authorizes that?

## Module 4: Second operational period (+2:10)

Scenario time 1800. The first operational period ends.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 4.1 | +2:10 | Controller | EOC Director | Record OP SYNTHETIC 2 for the next 12 hours. |
| 4.2 | +2:15 | SYNTHETIC generator vendor (simulator) | Logistics Section Chief | "Your three portable generators are on site. Rental is 1,850 dollars for the first day." |
| 4.3 | +2:20 | EOC Director | Planning Section Chief | Build the IAP for OP SYNTHETIC 2 with an assignment for shelter power and water. |
| 4.4 | +2:35 | Controller | Liaison Officer, Operations Section Chief, Field user | Shift change: the field user player takes over as Operations Section Chief. |

Discussion questions:

1. Did anyone keep working in OP SYNTHETIC 1 after OP SYNTHETIC 2 was
   recorded? How would you know?
2. What does the approved IAP not contain, and where did that information go
   instead?
3. After the shift change, whose name is on the next action taken as
   Operations Section Chief?

## EndEx and hotwash (+2:45)

Controllers announce EndEx. Players stop entering data. The hotwash follows
immediately: each player names one strength and one area for improvement for
their position, and the evaluators add theirs. Observations go on
**Planning > AAR** as described in the
[facilitator guide](./EXERCISE-FACILITATOR-GUIDE.md).
