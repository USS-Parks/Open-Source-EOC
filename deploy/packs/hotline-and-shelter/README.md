# Hotline and shelter registration pack

A public hotline and inquiry log and an evacuee shelter registration board, as
a [solution package](../../README.md#signing-solution-packages), with the
views, reports, escalation rules, dashboard and activation that make them
usable on the first day. Staff enter every call and every registration; there
is no public form. The pack names no hazard and no place. `package.json` is
the unsigned source; sign it with your own publisher key before an instance
will take it.

## What it holds

| Part | Contents |
|---|---|
| Board template **Hotline and Inquiry Log** | One record per call, email, text or walk-in question from the public: when and how it came in, the caller and their contact, the community or area, the topic, the question or report, the answer given, a referral, the status (answered, follow up, escalated, closed) and who follows up by when. Views: **Needs follow-up**, **All inquiries**, **By topic** and **Rumors** |
| Board template **Shelter Registrations** | One record per household: arrival, shelter and bed or area, the head of household and the other members with ages, how many people and children, contact and home area, medical, functional and access needs, the referral for care, pets, consent to tell family, reunification, and status with departure. Views: **In shelter** (grouped by shelter), **Needs**, **Reunification** and **All registrations** |
| Incident template **Evacuation and sheltering (any hazard)** | The eight ICS Command and General Staff positions, a **Hotline Supervisor** and a **Mass Care Coordinator**; eight boards; 21 checklist items, four of them due 30 to 120 minutes after activation; four reports; two rules; the overview dashboard; three message threads; two file folders |
| Report templates | **Hotline follow-up** (calls to follow up or escalated, soonest due first), **Hotline topics** (every call by topic), **Shelter roster** (households in each shelter, with people, children and pets totalled) and **Shelter needs** (each household's needs and referral, by shelter), all run on demand |
| Rule templates | A hotline call logged as escalated, or changed to escalated, reaches the Operations Section Chief in the app and by email |
| Dashboard template **Hotline and shelter overview** | Calls needing follow-up, calls escalated to Operations, calls by topic, households in shelters, households by shelter, households looking for someone, and the shelters board |

Media calls belong in the JIC's **Media inquiries**, not the hotline log.

## Privacy

- **Registrations are read by members only.** Members of the jurisdiction,
  its administrators and the people taking part in the incident read shelter
  registrations; the jurisdiction's viewers and guests read none. The rule is
  the board template's record access, enforced by the database for every
  read of the records and of their audit entries and attached files.
- **Personal details stay out of messages.** The caller, their contact, the
  question and the answer, and a household's names, contact, home, needs,
  referral, consent, the people they are looking for and where they went are
  marked for members. A notification spells out only fields every reader of
  the board may see, so an escalation names the area, topic and status, never
  the caller or what they said. A viewer's report leaves the marked fields
  out.
- **Needs, not diagnoses.** The product holds no patient-level data. The
  needs section records what the shelter must provide, in the five CMIST
  areas (communication, maintaining health, independence, support and safety,
  transportation) with a line of detail, and where the household was
  referred for care. It has no place for a diagnosis, condition, medication
  or health history; do not write one in the detail or the notes.
- **Consent before disclosure.** The Hotline Supervisor's checklist has
  call-takers confirm that someone is at a shelter only when the registration
  says the household agrees. Otherwise the caller is logged as looking for
  them, and the shelter works the **Reunification** view.
- **No schedules and no files.** The reports run on demand, as the person
  running them. A scheduled report runs as its owner and stores its file,
  which the registrations' record rule does not cover, so none is scheduled.
  Keep registrations on the board rather than in uploaded or exported files.

## What activation opens

Activating **Evacuation and sheltering (any hazard)** on an instance that has
imported the pack opens, with no other setup:

- the ten positions, making the Hotline Supervisor and Mass Care Coordinator
  if the jurisdiction lacks them, and each position's checklist;
- the activity log, significant events, situation report, resource requests,
  shelters, road closures, hotline log and shelter registrations boards,
  titled with the incident's name;
- the four reports, on this incident's boards;
- the two escalation rules, on this incident's hotline log;
- the **Hotline and shelter overview** dashboard, titled with the incident's
  name;
- three message threads on **Messages**: **EOC coordination**, read by
  everyone on the incident; **Hotline answers**, for the Public Information
  Officer and the Hotline Supervisor, where the answers call-takers may give
  are posted; and **Shelter operations**, for the Mass Care Coordinator and
  the Operations and Logistics Section Chiefs;
- two folders on **Files**: **Public messages** and **Hotline answers**.

## Import it

1. Make a publisher key once, off the network if you can:
   `node server/dist/main.js new-package-key --private publisher.key.pem --public publisher.pub.pem`
2. Sign the pack:
   `node server/dist/main.js sign-package --key publisher.key.pem --in deploy/packs/hotline-and-shelter/package.json --out hotline-and-shelter.signed.json`
3. Put `publisher.pub.pem` in the PEM bundle that `OPENEOC_TRUSTED_TEMPLATE_KEYS`
   names, and restart the server.
4. As an instance administrator who administers the jurisdiction, open
   **Templates**, **Create template**, the **Import** tab, and choose the
   signed file under **Signed solution package**.

Importing again changes nothing already there. The pack stands alone and
sits beside the [small EOC starter pack](../small-eoc-starter/README.md).

## Using the boards elsewhere

- **In another activation.** On **Incident Setup**, edit an incident
  template, such as the starter pack's activation, and tick
  **Hotline and Inquiry Log** and **Shelter Registrations** among its boards.
  The reports, rules and dashboard come only with this pack's activation.
- **Outside an incident.** On **Templates**, **Create a board from a
  published template** opens either board for the jurisdiction, for a
  standing hotline or a shelter opened before an incident is.

## Why it is built this way

- **Status is a field, not a workflow.** Reports, dashboards and
  notification rules read fields; a workflow's state is none of them.
- **The shelter is named in text.** A reference to the shelters board would
  show as an id in reports and cannot be filled outside an incident. Use the
  name as it is on the shelters board.
- **No Smart Forms form.** A form files its record without the incident and
  cannot answer a yes or no field, so calls and registrations are entered on
  the boards.

## Adapting it

Edit the incident template on **Incident Setup**: positions, boards and
checklists change on screen, and the reports, rules, dashboard, threads and
folders are kept through the edit. To change a board, report, rule or
dashboard template, edit `package.json`, raise the version of what changed,
and sign and import it again.
