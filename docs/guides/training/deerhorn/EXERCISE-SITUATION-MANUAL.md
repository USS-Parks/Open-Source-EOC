# Exercise Situation Manual: Deerhorn Lightning Complex

Every person, report, request and figure in this exercise is synthetic. The
places, tribal nations and agencies are real; nothing here describes what
they have done or would do. The package follows the shape of a Homeland
Security Exercise and Evaluation Program (HSEEP) situation manual. It is not
certified or endorsed by FEMA, either tribe or any other authority.

## Exercise overview

| Item | Detail |
|---|---|
| Exercise name | Deerhorn Lightning Complex |
| Type | Functional exercise played at the keyboard in OpenEOC |
| Length | About 2 hours 45 minutes of play, then a 30-minute hotwash |
| Scope | Unified command between two tribal EOCs for the rest of one afternoon operational period and the start of the next |
| Incident in the product | Deerhorn Lightning Complex, owned by Hoopa Valley Tribe OES |
| Hazard | Wildfire: five lightning starts at the Klamath and Trinity confluence |
| Mission area | Response |
| Host | The installed OpenEOC demo, on one computer or a small network |

## Objectives and core capabilities

| Objective | Core capability |
|---|---|
| 1. Within 20 minutes of StartEx, both tribes' leads agree the afternoon's objectives, record them on the Significant Events board, and each government's orders stay under that government's own authority. | Operational Coordination |
| 2. Before dark, the Pecwan temporary refuge area has water, a generator and a satellite link requested, owned and tracked, or the players state why not. | Mass Care Services |
| 3. The joint release carries all three approvals (Hoopa Valley Tribe, Yurok Tribe, CAL FIRE) before anyone describes it as approved, and each government's exercise alert reaches its own local approval with no delivery claim. | Public Information and Warning |
| 4. SR-96 north to Orleans stays the one evacuation route; every closure change is on the Road Closures board and in the Transportation lifeline within 15 minutes. | Critical Transportation |
| 5. No dozer line is cut near Deerhorn Creek without a tribal cultural monitor, and no site location is written anywhere a partner outside the tribes can read it. | Natural and Cultural Resources |
| 6. Lifelines stay current, and the overdue Hazardous Materials assessment is stated as unknown rather than briefed as stable. | Situational Assessment |

## Participants

Every account below signs in with the demo password `north-coast-exercise`.
The exercise director signs in as `jordan.lee@humboldt.example`, who holds a
coordinator seat on this incident and reaches every exercise in the demo.

| Player | Account | Organization | Role in the product |
|---|---|---|---|
| Casey Morgan | `casey.morgan@hoopa.example` | Hoopa Valley Tribe OES | Administrator; Incident Commander |
| R. Bennett | `r.bennett@hoopa.example` | Hoopa Valley Tribe OES | Operations Section Chief |
| J. Ellis | `j.ellis@hoopa.example` | Hoopa Valley Tribe OES | Logistics Section Chief |
| M. Rowe | `m.rowe@hoopa.example` | Hoopa Valley Tribe OES | Public Information Officer |
| T. Quinn | `t.quinn@hoopa.example` | Hoopa Valley Tribe OES | Cultural resources |
| S. Hayes | `s.hayes@yurok.example` | Yurok Tribe OES | Unified Command (coordinator) |
| K. Warren | `k.warren@yurok.example` | Yurok Tribe OES | Yurok field operations |
| D. Lowe | `d.lowe@yurok.example` | Yurok Tribe OES | Yurok cultural resources liaison |
| L. Flores | `l.flores@karuk.example` | Karuk Tribe | Karuk liaison |
| D. Kowalski | `d.kowalski@calfire.example` | CAL FIRE Humboldt-Del Norte Unit | Fire operations liaison |

Simulators may also play the Forest Service, BIA, Humboldt County, Caltrans,
the Red Cross and K'ima:w Medical Center, each of which has a seeded
account (see the facilitator guide). Controllers, evaluators and observers
work as in any HSEEP exercise.

## Rules of play

1. Start every typed entry with `EXERCISE`.
2. Act only under your own account and acting position. A refusal from the
   server is part of the exercise; report it, do not work around it with
   another account.
3. Each tribe issues orders for its own lands. The county issues orders for
   fee lands. Nobody issues an order for another government.
4. Never type a cultural site's location anywhere, including the Cultural
   resources board.
5. Queued, received, accepted and approved are not delivered. Say which state
   a thing is in.
6. Scenario time is compressed. Controllers announce it at each module.

## Assumptions and artificialities

- Nothing leaves the host: no email, SMS, IPAWS or public website.
- The fire perimeters, spot fires and evacuation areas on the map are
  synthetic exercise layers generated from the terrain, not official
  perimeters or zones.
- In this product a joint release's approvals are recorded by the owning
  organization's people. The Yurok Tribe's and CAL FIRE's decisions reach the
  release through Hoopa's Public Information Officer, who records each as
  stated aloud by that agency's player.
- An alert authored by a partner stays in that partner's own jurisdiction;
  Hoopa's players do not see the Yurok Tribe's or the county's alerts.
- Seeded times date from when the demo was set up. Use the controller's
  scenario time.

## Scenario background

Dry lightning crossed the Klamath and Trinity confluence two evenings ago and
started five fires. The Deerhorn Fire began at 41.175669, -123.693213, on
the line between the Hoopa Valley Reservation and Yurok lands just south of
Weitchpec. Hoopa Valley Tribe OES activated its EOC and the Yurok Tribe
joined it in unified command the same night.

At StartEx, 15:10 on the third day, under a red flag warning:

- The Deerhorn Fire has spotted across SR-96 below Weitchpec. The Yurok Tribe
  ordered Weitchpec to evacuate north to Orleans at 13:25.
- SR-169 is closed at Weitchpec. Its residents are at the Pecwan temporary
  refuge area: 58 people with one day of water.
- The Hoopa Valley Tribe ordered the north end of the Hoopa Valley to
  evacuate south at 13:40. Humboldt County warned fee lands along SR-96.
- Shelters in Hoopa, Willow Creek, Klamath and Orleans and the refuge area
  hold 229 people. The Karuk Tribe is receiving evacuees in Orleans.
- Weitchpec and Pecwan have no grid power, landline or internet.
- Smoke is hazardous in the Hoopa Valley; K'ima:w Medical Center runs a clean
  air room.
- The joint release is drafted and approved by the Hoopa Valley Tribe only.
- The Hazardous Materials assessment was due at 14:30 and is overdue.

## Module 1: The cut road (+0:00)

Scenario time 15:10.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 1.1 | +0:00 | Controller | Unified Command | "The Pecwan refuge area holds 58, four of them elders on oxygen. Water for one day, generator fuel until midnight." |
| 1.2 | +0:10 | K. Warren (field) | Operations Section Chief | "Spot fire 200 yards from the Weitchpec water tank. Wind northeast, 15 gusting 25." |
| 1.3 | +0:20 | CAL FIRE (simulator) | Operations Section Chief | "Air attack can drop on the SR-169 junction at 16:00 if the road is clear of evacuation traffic by 15:50." |
| 1.4 | +0:30 | Satellite vendor (simulator) | Logistics Section Chief | "We can deliver six terminals to Orleans by 17:00. We cannot reach Weitchpec or Pecwan." |

Discussion questions:

1. Who owns each Pecwan need, and where does a player see that ownership?
2. How did unified command decide who clears the SR-169 junction for the air
   drop, and where is that decision recorded?
3. With terminals stranded at Orleans, what is the plan for the last miles?

## Module 2: Three governments, one message (+0:45)

Scenario time 16:30.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 2.1 | +0:45 | Regional newspaper (simulator) | Public Information Officer | "Is Weitchpec burning? Are people trapped at Pecwan?" |
| 2.2 | +0:55 | S. Hayes | Public Information Officer | "The Yurok Tribe approves the joint release with one change: call Pecwan a temporary refuge area, not a shelter." |
| 2.3 | +1:05 | D. Kowalski | Public Information Officer | "CAL FIRE approves the release as amended." |
| 2.4 | +1:15 | Humboldt County (simulator) | Unified Command | "The county is upgrading its SR-96 fee-land warning to an order at 17:00." |

Discussion questions:

1. When was the release actually approved by all three, and who recorded the
   Yurok Tribe's and CAL FIRE's decisions?
2. Which government's alert covers which people, and could a resident near
   the reservation line tell which order applies to them?
3. What did you tell the newspaper before the release was approved?

## Module 3: Monitors and smoke (+1:30)

Scenario time 17:30.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 3.1 | +1:30 | CAL FIRE dozer boss (simulator) | Operations Section Chief | "The dozer is ready to cut contingency line on the ridge east of Deerhorn in 30 minutes." |
| 3.2 | +1:35 | D. Lowe | T. Quinn | "I can have a Yurok monitor at the ridge in 45 minutes." |
| 3.3 | +1:45 | K'ima:w Medical Center (simulator) | Unified Command | "Two more patients with breathing trouble. The clean air room is full." |
| 3.4 | +2:00 | Controller | Unified Command | "River level allows jet boats at the Pecwan landing until 19:40." |

Discussion questions:

1. Did the dozer wait for the monitor? Where is that recorded, and who can
   read it?
2. Where did the new medical need go, and who owns it?
3. Is a river evacuation of the refuge area a decision for unified command,
   the Yurok Tribe alone, or someone else?

## Module 4: The night operational period (+2:15)

Scenario time 18:40.

| Inject | Time | From | To | Inject |
|---|---|---|---|---|
| 4.1 | +2:15 | Controller | Incident Commander | Record OP 05 from 19:00 to 07:00. |
| 4.2 | +2:20 | Incident Commander | Operations Section Chief | Build the IAP for OP 05 with assignments for the refuge area and for structure protection at Weitchpec. |
| 4.3 | +2:35 | Controller | K. Warren and a relief player | Shift change: a relief player takes over Yurok field operations. |

Discussion questions:

1. What did the incoming Yurok field lead learn from the product, and what
   only from the outgoing lead?
2. Which requests are still received but not accepted?
3. What changes in the IAP if the refuge area is evacuated by river overnight?

## EndEx and hotwash (+2:45)

Controllers announce EndEx. Players stop entering data. Each player names one
strength and one area for improvement; the evaluators add theirs.
Observations go on **Planning > AAR** as described in the
[facilitator guide](./EXERCISE-FACILITATOR-GUIDE.md).
