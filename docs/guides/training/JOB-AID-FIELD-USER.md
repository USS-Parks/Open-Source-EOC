# Job Aid: Field User

In an exercise, follow the [training kit ground rules](./README.md) and mark
every entry as the exercise's rules of play say. A screen named here that is
not on the rail appears when you tick **Show every section** under
**Settings**.

## Account role and acting position

- **Account role: Member.** A viewer cannot queue a report.
- **Acting position: none required.** Reports carry your name. Select a
  position only if an administrator assigned you one; **My Tasks** then
  shows its tasks.

## What the position does

Reports what you see in the field, accurately and with a location, and makes
sure each report actually reached the server. Your work is kept on the device
while there is no connection and sent when it returns.

## First 15 minutes

1. Set the command bar: the incident under **Selected incident** and the
   current period under **Operational period**.
2. Check in on **Operations > Staffing**.
3. While you are online, open **Operations > Smart Forms**, choose your
   form and its incident board, and show the incident's boards on **Map**.
   A form or board must be loaded once before you can rely on it offline.
4. Check the connection and synchronization state in the command bar and
   the continuity panel.

## Every report

1. Answer the questions. A location takes a latitude and longitude, typed or
   from **Use current location**.
2. Select **Queue field report**. The report is stored on the device first.
3. Read the status until it says synced. Queued is local only; failed means
   acceptance is not verified; a conflict needs review by an operator. Do not
   re-enter a failed or conflicted report under another account.
4. Tell your supervisor what you sent. Operations reads it on **Field
   Reports**.

## Working without a connection

- **A point on the map.** On **Map**, **Add point**, place it on one of the
  incident's boards, fill the form and **Save record**. With no connection
  it reads "Saved on this device" and is sent when the connection returns.
- **A message.** On **Coordination > Messages**, a message to one of the
  incident's threads shows **Queued on this device** until it is sent.
- **A task.** Only a completion queues offline; an administrator's **New
  task** is kept under **New tasks kept on this device**.
- **Deliver it.** When the connection returns, select **Reconnect and
  reconcile** in the continuity panel and read what it delivered. Anything
  the server refused stays with its reason.
- **An incident closed meanwhile.** Your work is kept as a late submission
  for the incident's administrators, who accept or refuse it. The continuity
  panel counts it under **Late submissions**.

## Every operational period

- Complete assigned tasks on **Operations > Tasks**, **My Tasks**, and
  reconcile before calling one done.
- At shift change, finish synchronization, report anything still queued or
  conflicted, and sign out.

## Screens used

| Screen | Use |
|---|---|
| Operations > Smart Forms | Queue field reports |
| Operations > Field Reports | Confirm your report arrived |
| Operations > Tasks | Assigned completions |
| Situation > Map | Your reports and closures; new points |
| Coordination > Messages | Messages to the incident's threads |

## What the product does not do

- A queued report is not received. Only synced is.
- Task assignment, due dates and other task edits need a connection.
- A point on a board outside the selected incident needs the connection.
- An incident board's form opens offline only after this device showed that
  board on the map with a connection.

## Read next

- [Field user guide](../FIELD-USER.md): all of it, including "Question
  types" and "When the incident closed while you were offline".
