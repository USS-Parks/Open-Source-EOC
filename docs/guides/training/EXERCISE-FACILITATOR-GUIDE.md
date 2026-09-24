# Exercise Facilitator Guide: Ridge Wildfire Tabletop

For the lead facilitator, controllers and evaluators. Players receive the
[situation manual](./EXERCISE-SITUATION-MANUAL.md), not this guide. The
package follows the shape of an HSEEP exercise and is not certified or
endorsed by FEMA or any other authority.

## Exercise staff

| Role | Number | Duties |
|---|---|---|
| Lead facilitator | 1 | Runs the clock, announces StartEx, each module and EndEx, leads the hotwash |
| Controller and simulator | 1 or 2 | Delivers injects by voice or printed card, plays every outside caller, logs the time each inject was delivered |
| Evaluator | 1 per 2 or 3 positions | Watches, records evidence and rates objectives; never coaches. Reads the product as `demo-viewer@example.org` and never writes |
| Host operator | 1 (may be the facilitator) | Keeps the host computer, launcher and browser profiles running; restores the golden copy before and after |

## Pre-StartEx checklist

- [ ] The demo profile was restored from the golden copy and started with
      `-Action Start -Profile demo`; `-Action Status -Profile demo` reports
      it ready. See the [instructor outline](./INSTRUCTOR-OUTLINE.md).
- [ ] Every player account signs in. Both admin accounts pass the
      authenticator step.
- [ ] Each player's Acting position list shows their position, including
      Situation Unit Leader.
- [ ] **Coordination > Contacts** has a contact linked to each player account
      and a staff group containing them.
- [ ] **Operations > Smart Forms** loads **SYNTHETIC rapid field report** with
      its Field Reports board.
- [ ] Printed: a situation manual for every player, each position's job aid,
      inject cards for controllers, a rating sheet for each evaluator.
- [ ] Scenario clock and module start times are posted where players see them.
- [ ] Players are briefed on the rules of play and the ground rules in the
      [kit index](./README.md).
- [ ] Everyone knows the stop phrase: "real-world emergency" stops play at
      once.

## Where the evidence is

- **Situation > Chronology**, **All events**: attributed, append-only record
  of milestones, including request submissions and status changes, IAP
  submission and approval, published JIC releases and composed SITREPs.
- **Operations > Resources**, **History** on each request.
- **Planning > IAP**: prepared, submitted and approved by whom and when, and
  the revision history.
- **Situation > ESFs & Lifelines**: each lifeline's assessment history.
- **Coordination > Mass Notification** receipts and **Operations > Staffing**.
- At EndEx, the administrator's **Export CSV** from **Chronology**.

## Expected actions and evidence per inject

### Module 1: Activation and check-in

| Inject | Expected actions | Evidence |
|---|---|---|
| 1.1 | Liaison Officer sends an in-app notice to the staff group, **Everyone at once**. Players acknowledge in the notification center. | Receipts show **Delivered** and an acknowledgement for each contact |
| 1.2 | Each player selects the incident, **OP SYNTHETIC 1** and their acting position, and checks in on **Staffing**. The Situation Unit adds Sign In/Out board records for the IAP. | **On duty** list; **Vacant positions**; Sign In/Out board |
| 1.3 | EOC Director completes "Assume command and announce on the significant events board" after adding a Significant Events record; states objectives and records them on the same board; completes "Set initial incident objectives". | Task completion evidence; Significant Events records; Chronology |
| 1.4 | Situation Unit updates the Energy assessment citing the utility call; restoration stays unknown rather than guessed. | Energy assessment history |

### Module 2: Field reports and resources

| Inject | Expected actions | Evidence |
|---|---|---|
| 2.1 | Field user queues the report and waits for synced. Operations opens it on **Field Reports** and adds a Road Closures record with the location. Situation Unit updates the stale Transportation assessment citing the report. Someone notices the point lies outside the synthetic road source's coverage. | Field report record; Road Closures record and map; Transportation history; elapsed time against objective 2 |
| 2.2 | Operations updates the Shelters record (status compromised, capacity 120, occupancy 85) and submits a generator request for the shelter, or ties the need to the seeded generator request and says so. Logistics triages. | Shelters record; request and its History |
| 2.3 | Operations submits a water tender request; Logistics triages and moves it to sourcing. | Request History |
| 2.4 | Liaison Officer records the offer on the Activity Log and messages the Logistics Section Chief. Players state that partner participation and escalation cannot be played. Logistics names the source in a transition note. | Activity Log record; Messages thread; transition note; an AAR observation |

### Module 3: Situation report and public information

| Inject | Expected actions | Evidence |
|---|---|---|
| 3.1 | Situation Unit uses **Compose and freeze**; the director briefs from it and reads unknown and stale states aloud. | Frozen briefing archive; composed SITREP in Chronology |
| 3.2 | PIO opens **JIC** on the frozen SITREP, logs and assigns the inquiry, drafts the release naming `County OES`, saves and submits. The director opens **JIC** on the same SITREP, selects **Review** under **Waiting for review**, records **Approve for County OES**, publishes to the public information feed and answers the inquiry from that panel. The PIO's panel does not show the director's decision; expect a player to notice and record it. | Public information feed entry; inquiry shows answered; published release in Chronology |
| 3.3 | PIO composes a local alert with **Record type** Exercise, saves, and submits it for local review; the director approves it. Nobody claims it was sent. | Alert record reads approved locally; alert review events under **All events** |

### Module 4: Second operational period

| Inject | Expected actions | Evidence |
|---|---|---|
| 4.1 | Director records **OP SYNTHETIC 2** on **Operational Periods** with a reason, announces it, and completes "Establish the operational period". Every player switches the command bar. | Period revision history; command bars |
| 4.2 | Logistics moves the generator request to sourcing, uses **Assign and advance** to the Logistics Section Chief, advances it to deployed, records a 1,850.00 cost and uses **Export costs (CSV)**. | Request History; cost list; the CSV file |
| 4.3 | Planning checks the Sign In/Out and Resource Requests boards, assembles the draft IAP for **OP SYNTHETIC 2**, adds an ICS-204 assignment supervised by the Operations Section Chief, saves and submits. The director approves; the PDF is downloaded. Players name the missing objectives and safety message. | IAP detail: prepared, submitted and approved by and at; PDF |
| 4.4 | Liaison Officer uses **Reassign** to give Operations Section Chief to the field user player. The outgoing chief briefs open requests, queued work and unknowns, then signs out. The incoming chief signs in, selects the position and checks in. | Positions tab; Staffing; the next Operations entry in Chronology carries the incoming name |

## Rating the objectives

Use the HSEEP performance ratings for each objective:

- **P, performed without challenges.** The targets were met, and nothing
  hurt the outcome or created risk.
- **S, performed with some challenges.** The targets were met, but some
  actions were less efficient or effective than they should have been.
- **M, performed with major challenges.** The targets were met only in part,
  or were met with actions that hurt the outcome or created risk.
- **U, unable to be performed.** The targets were not met.

Rate what the players did, not the product. When the product blocked a task,
rate how the players handled it (stated the gap, worked around it openly,
recorded it) and list the product gap separately.

| Objective | Core capability | Rating | Evidence | Notes |
|---|---|---|---|---|
| 1 | Operational Coordination | | | |
| 2 | Situational Assessment | | | |
| 3 | Logistics and Supply Chain Management | | | |
| 4 | Critical Transportation | | | |
| 5 | Public Information and Warning | | | |
| 6 | Planning | | | |

## Hotwash (30 minutes)

1. The lead facilitator restates the objectives (2 minutes).
2. Each position names one strength and one area for improvement
   (15 minutes).
3. Evaluators give first impressions without ratings (5 minutes).
4. The controller reads back the product gaps players named (5 minutes).
5. Collect written feedback (3 minutes).

## After-action steps on Planning > AAR

1. Sign in with a member or admin account, select the synthetic incident and
   open **Planning > AAR**. Choose the operational period.
2. For each finding, under **Record an observation**, choose the **Core
   capability**, **Capability element** and **Finding type** (strength or area
   for improvement), write the **Observation** and **Recommendation**, then
   **Record observation**.
3. For each area for improvement that needs work, select **Create action from
   this observation**. Set priority, owner, due date and the corrective
   action, then **Create corrective action**.
4. Track progress with the action's status and **Save progress**. Use **Load
   latest revision** first if someone else may have changed it.
5. Under **Compile exact PDF snapshot**, fill **Incident overview** and
   **Objectives** (the six objectives with their ratings), then **Compile and
   download PDF**.
6. Keep product gaps as their own observations, with a recommendation for the
   product, so they are not confused with player performance.
