# Job Aid: Liaison Officer and System Administrator

Use with the [training kit ground rules](./README.md). Start every entry with
`SYNTHETIC`.

## Account role and acting position

- **Account role: Admin.** The seeded account `demo-admin@example.org`. It
  enrolls an authenticator app at its first sign-in.
- **Acting position: Liaison Officer.** Assign it to yourself on
  **Administration > Positions** if the instructor has not.

## What the position does

Two jobs in one seat. As Liaison Officer you are the contact point for
assisting and cooperating agencies. As system administrator you call the
staff in, keep accounts and positions right, and run the shift change.

## First 15 minutes

1. Set the command bar: the synthetic incident, **OP SYNTHETIC 1**, and
   **Liaison Officer**.
2. Check in on **Operations > Staffing**.
3. **Call the staff in.** On **Coordination > Mass Notification**, enter a
   **Subject** and **Message**, choose **A contact group** and the staff group
   the instructor made, tick **In app** only, choose **Everyone at once** and
   **Send notification**. Read the receipts: each in-app notice shows
   **Delivered**, then each acknowledgement as players acknowledge in the
   notification center.
4. On **Administration > Positions**, confirm every player holds their
   position. When a player reports a refusal, check their role on **People**
   and their assignment here before anything else.

## Every operational period

- **Handle agency contacts.** When a neighbouring county calls, record the
  offer as an Activity Log record under **Operations > Boards** and start a
  **Coordination > Messages** thread to the Logistics Section Chief with the
  details. Add the caller to **Coordination > Contacts** if they will call
  again.
- **Explain what cannot be played.** The seed has one organization, so
  **Participants** cannot admit the neighbouring county and a request cannot
  be escalated to it. Say so and record an observation.
- **Watch the record.** **Situation > Chronology** shows who did what under
  which position.
- **Run the shift change.** On **Administration > Positions**, **Reassign**
  the position to the incoming player. The outgoing player keeps acting until
  they sign out, so have them sign out. The incoming player signs in under
  their own account, selects the position and checks in on **Staffing**.
- **At EndEx**, on **Situation > Chronology**, use **Export CSV** for the
  evaluators. It exports the organization's whole audit trail.

## Screens used

| Screen | Use |
|---|---|
| Coordination > Mass Notification, Contacts | Staff call-in, receipts, directory |
| Administration > People, Positions | Roles, assignments, shift change |
| Coordination > Participants, Messages | Partner access (not playable), threads |
| Operations > Staffing, Boards | Check-in, Activity Log |
| Situation > Chronology | Attributed record and audit export |

## What the product does not do

- Email and SMS need a relay or provider on **Administration > Channels**;
  the demo profile has none, so use **In app** only.
- One organization in the seed: no partner participation, guest play or
  escalation to another tier.
- **Reassign** does not end the outgoing person's session; they must sign
  out.

## Read next

- [Administrator guide](../ADMIN.md): "People, roles, positions, and
  participants", "Positions" and "Contacts and mass notification".
- [Operator quickstart](../OPERATOR-QUICKSTART.md): "Reach contacts and page
  a duty officer" and section 6.
