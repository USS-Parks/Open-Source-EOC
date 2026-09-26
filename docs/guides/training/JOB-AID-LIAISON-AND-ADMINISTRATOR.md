# Job Aid: Liaison Officer and System Administrator

In an exercise, follow the [training kit ground rules](./README.md) and mark
every entry as the exercise's rules of play say. A screen named here that is
not on the rail appears when you tick **Show every section** under
**Settings**.

## Account role and acting position

- **Account role: Admin.** It enrolls an authenticator app at its first
  sign-in.
- **Acting position: Liaison Officer.** Assign it to yourself on
  **Administration > Positions** if no one has.

## What the position does

Two jobs in one seat. As Liaison Officer you are the contact point for
assisting and cooperating agencies. As system administrator you prepare the
instance, call the staff in, keep accounts, positions and channels right, and
run the shift change.

## Before an incident

- **Import a signed package** (an instance administrator). On **Data and
  administration > Templates**, **Import** tab, choose the file under
  **Signed solution package**, such as the small EOC starter pack. The result
  names what was created and what was already here.
- **Keep the plans.** On **Incident Setup**, **Plans**: **New plan** (or
  **Start from the continuity template**), then **Save plan**. When a plan
  shows **Review due**, read it and **Mark reviewed**.

## First 15 minutes

1. In the command bar choose the incident under **Selected incident**, the
   current period under **Operational period** and **Liaison Officer** under
   **Acting position**.
2. Check in on **Operations > Staffing**.
3. **Call the staff in.** On **Coordination > Mass Notification**, enter a
   **Subject** and **Message**, tick the staff group under **Contact
   groups** (or their positions), choose the **Channels**, **Mode** **Everyone
   at once**, and **Send notification**. Put answers under **Answers to ask
   for**, one per line, to count who is available. **Show receipts** shows
   each delivery and acknowledgement.
4. On **Administration > Positions**, confirm every player holds their
   position. When a player reports a refusal, check their role on **People**
   and their assignment here before anything else.

## Every operational period

- **Handle agency contacts.** Record an offer as an Activity Log record under
  **Operations > Boards** and start a **Coordination > Messages** thread to
  the Logistics Section Chief. Add the caller on **Coordination > Contacts**
  if they will call again. **Add participant** on **Coordination >
  Participants** gives a partner agency's person access to this incident.
- **Call down on paper when phones cannot reach the server.** In a send's
  receipts, **Print call-down sheet**, call or radio down it, then under
  **Enter from the call-down sheet** tick **Reached** for each person, with
  the time and answer, and **Enter acknowledgements**.
- **Resend what could not go out.** A message with no route waits for its
  channel's window (**When a message cannot go out** on **Administration >
  Channels**), then reads **Expired, not sent**. Open it in the notification
  center and **Resend**. With an SMS gateway on **Channels**, text replies
  count as answers; **Read replies now** reads them at once.
- **Exchange with a partner by file.** On **Data and administration >
  Federation**, the partner's card, **Exchange by file**: **Export waiting
  updates** and carry the file across; import theirs with **Import batch
  file**, then **Export receipt** and carry it back. Import their receipt
  with **Import receipt**. Importing a file twice changes nothing.
- **Run the shift change.** On **Administration > Positions**, **Reassign**
  the position to the incoming player. The outgoing player keeps acting until
  they sign out, so have them sign out.
- **At the end**, on **Situation > Chronology**, use **Export CSV** for the
  evaluators. It exports the organization's whole audit trail.

## Screens used

| Screen | Use |
|---|---|
| Coordination > Mass Notification, Contacts | Call-in, receipts, call-down sheets, directory |
| Administration > People, Positions, Channels | Roles, assignments, shift change, delivery windows, SMS gateway |
| Coordination > Participants, Messages | Partner access, threads |
| Data and administration > Templates, Federation | Signed packages, exchange by file |
| Incident Setup | Plans, activation, late submissions |
| Situation > Chronology | Attributed record and audit export |

## What the product does not do

- Email and SMS need a relay, a provider or an SMS gateway on
  **Administration > Channels**; without one, use **In app** and the
  call-down sheet. There is no voice call-down.
- **Reassign** does not end the outgoing person's session; they must sign
  out.
- A batch file is signed, not encrypted; carry it as the board's contents
  deserve. Incident records do not travel by file.

## Read next

- [Administrator guide](../ADMIN.md): "Positions", "Contacts and mass
  notification", "When a message cannot go out" and "Prepare an incident".
- [Federation setup](../FEDERATION-SETUP.md): "Exchange by file".
