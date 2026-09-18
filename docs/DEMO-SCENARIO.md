# Demo Scenario and Scripted Exercise (VEOC-41)

A functional exercise a stranger can run against the demo dataset
(`server/src/demo/seed.ts`, loaded on a demo instance) using only the guides
in `docs/guides/`. It walks the platform end to end, and every facet F1 through
F20 appears. The facet coverage is checked in CI
(`server/src/__tests__/demo.test.ts`) so this script cannot silently drop a
facet.

## Setup

Deploy per [../deploy/README.md](../deploy/README.md) and load the demo
dataset. Sign in as `demo-admin@example.org`. The exercise runs about 45
minutes.

## Scripted injects

1. **Activation.** Activate "Demo Wildfire" from the wildfire scenario
   template. The ICS org chart, the board set, per-position checklists, and the
   scenario libraries arrive in one action. (F12 incident templates; F13
   scenario/reference libraries.)
2. **Provisioning and the viewer path.** Provision an operator and a viewer;
   time the viewer reaching the common operating picture from a cold start.
   (F16 one-click role-based provisioning and the ten-minute viewer path.)
3. **Log the first actions.** On the activity log board, record command
   establishment and the evacuation decision. (F1 board primitive; F2
   position login and immutable activity logs.)
4. **Read the calm screen.** Open the map-first COP and confirm the display
   stays calm and legible. (F14 calm, map-first SPA discipline; F19 NAPSG/DHS
   incident symbology.)
5. **Lifelines and the sitrep.** Set community lifeline conditions and compose
   a situation report; read it on the briefing view. (F8 FEMA doctrine as
   schema: lifelines and PDA.)
6. **Board to map.** Add a road-closure record with a location and watch it
   appear as a COP layer. (F6 any board as a live geospatial layer.)
7. **Field forms offline.** On a field device, fill an XLSForm-compatible smart
   form offline, then sync it. (F7 offline smart forms.)
8. **Damage assessment.** File a preliminary damage assessment against the
   pre-disaster baseline. (F9 pre-disaster baseline for damage assessment.)
9. **Facilities.** Query hospital and shelter status across the always-on
   facility network. (F10 always-on facility status networks.)
10. **Tracking and reunification.** Scan an evacuee into the tracking board and
    reunify a family. (F11 scan-first tracking and reunification.)
11. **Sensor feed.** Point a sensor/drone feed at the COP and watch tracks land
    live. (F18 sensor and drone live feeds into the COP.)
12. **Notifications.** Set a board rule that fans a threshold breach out to the
    tray and a webhook. (F4 board-triggered notifications and webhooks.)
13. **Resources, field to state.** Submit a 213RR, triage it, and escalate it
    to the state tier; watch the state fill it and report back. (F5 ICS forms
    and the 213RR lifecycle.)
14. **The IAP.** Assemble the operational-period Incident Action Plan from live
    data and export the PDF. (F5 IAP builder.)
15. **Public information.** Draft a press release, route it through multi-agency
    approval, and publish it to the public feed and CAP; log a media inquiry and
    answer it with the approved language. (F20 native standards interchange:
    CAP; JIC.)
16. **Standards interchange.** Emit a 213RR as EDXL, export facility status as
    EDXL-HAVE, and bridge a track to CoT/TAK. (F20 native standards
    interchange: EDXL, HAVE, CoT.)
17. **Collaboration space.** Confirm the incident's collaboration channels and
    a one-click meeting bridge for the operations section. (F15 per-incident
    auto-provisioned collaboration space.)
18. **Federation.** Share a board with a neighboring instance and watch it
    converge after a simulated partition. (F3 store-and-forward federation and
    local replication.)
19. **Daily ops.** Flip the same machinery into a daily-ops planned event to
    keep skills fresh between incidents. (F17 daily-ops usability against skill
    decay.)
20. **After action.** Capture observations during the incident, then compose
    the HSEEP AAR from those observations plus the chronology, and track a
    corrective action that outlives the incident. (F16 usability again for the
    naive AAR author; and the AAR module.)

## Facet coverage checklist

| Facet | Inject |
|---|---|
| F1 board primitive | 3 |
| F2 position login + immutable logs | 3 |
| F3 store-and-forward federation | 18 |
| F4 board-triggered notifications | 12 |
| F5 ICS forms, IAP, 213RR | 13, 14 |
| F6 any board as a geospatial layer | 6 |
| F7 offline smart forms | 7 |
| F8 FEMA doctrine as schema (lifelines/PDA) | 5 |
| F9 pre-disaster baseline | 8 |
| F10 always-on facility status | 9 |
| F11 scan-first tracking + reunification | 10 |
| F12 incident templates | 1 |
| F13 scenario/reference libraries | 1 |
| F14 calm, map-first SPA | 4 |
| F15 per-incident collaboration space | 17 |
| F16 one-click provisioning; ten-minute viewer | 2, 20 |
| F17 daily-ops usability | 19 |
| F18 sensor and drone feeds | 11 |
| F19 NAPSG/DHS symbology | 4 |
| F20 native standards interchange | 15, 16 |
