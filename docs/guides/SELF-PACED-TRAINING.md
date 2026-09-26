# Self-Paced Training

Eight short modules for learning Open Source EOC alone, at your own desk,
when the EOC is quiet. Each takes 15 to 30 minutes, ends with questions to
check yourself, and points to the guide that goes further. They suit a small
EOC where nobody has a free day for a class; the
[training kit](training/README.md) holds the instructor-led class and its
tabletop exercise.

## Which modules to take

| Module | Everyone | Members | Field users | Planning | Administrators |
|---|---|---|---|---|---|
| 1. Find your way | Yes | | | | |
| 2. Read the situation | Yes | | | | |
| 3. Work records and requests | | Yes | | Yes | Yes |
| 4. Field work without a connection | | | Yes | | |
| 5. Reach people | | Yes | | | Yes |
| 6. Plan the operational period | | | | Yes | |
| 7. Activate and close an incident | | | | | Yes |
| 8. Keep it running | | | | | Yes |

## Where to practice

Practice on the demonstration, never on your EOC's real data. The Windows
setup installs it for your own account: start **Open Source EOC Demo** from
the Start menu and sign in with the administrator account listed in
[Try it on Windows](../../TRY-IT-ON-WINDOWS.md). It runs on your computer
alone and reaches nobody. Module 4 needs a network host instead; it says
why.

- Everything in the demonstration is synthetic. Start everything you type
  with `SYNTHETIC`.
- When a module sends a notification, tick **In app** only.
- Several modules use sections the rail lists only after **Show every
  section**, which module 1 turns on.

## Module 1: find your way

**For:** everyone. **About 15 minutes.**

1. Sign in. The command bar across the top holds your context: the
   organization, the incident menu, the operational period, the acting
   position and the connection state. On a narrow screen the period and
   position are in the context drawer.
2. Choose an exercise from the incident menu, then a position from the
   position menu. Signing into a position is a deliberate act; the product
   never does it for you.
3. The rail on the left lists the sections, grouped as Situation,
   Operations, Planning, Coordination, and Data and administration. At its
   foot, **Settings > General > Show every section** lists the sections the
   rail leaves out at first, such as Contacts and Incident Setup. **Help**
   holds the keyboard keys and the operator, viewer, field user and
   accessibility guides.
4. Open the notifications panel in the command bar, then **Open center**.
5. Switch between the light and dark themes at the foot of the rail, then
   find **Sign out** in the account menu at the right of the command bar.

**Check yourself.**

- Where do you confirm the incident and period you are working in? *The
  command bar.*
- A section you need is not in the rail. What do you check? *Show every
  section; then whether your role allows it: Administration and Federation
  appear only to administrators.*
- A report reads "Queued". Has the server received it? *No. Queued means
  this device kept it; only "Synced" means the server accepted it.*

**Read next:** [Role guides](README.md), "State language used throughout
the application".

## Module 2: read the situation

**For:** everyone. **About 20 minutes.**

1. **Overview** shows the incident's counts, the common operating picture,
   the Community Lifelines, priority work and recent activity. Open one
   count and follow it.
2. **Map**: open **Map layers**, turn one layer off and fade another with
   its **Opacity** slider. Type an address in **Search addresses and
   places** and choose a result. Read the position readout in the map's
   top-left corner.
3. **ESFs & Lifelines**: open a lifeline on the **Lifelines** tab and read
   who assessed it, when, and on what evidence. Then the **ESFs** tab.
4. **SITREP**: open a snapshot and note its incident, period and the time it
   was composed.
5. **Chronology**: read **Significant events**, then **All events**.

**Check yourself.**

- A lifeline reads "Unknown". Is it stable? *No. Unknown is a reported
  condition; unknown or missing never means stable.*
- What does "Stale" tell you? *The last good data is kept but is older than
  its source should be.*
- Where is the attributed record of who did what? *Chronology.*

**Read next:** [Viewer quickstart](VIEWER-QUICKSTART.md) and
[Operator quickstart](OPERATOR-QUICKSTART.md), section 2.

## Module 3: work records and requests

**For:** members, planning staff and administrators. **About 30 minutes.**

1. **Boards**: open the incident's significant events board, choose **New
   record**, fill it in and save. Open the record again and read its
   history.
2. **Map**: choose **Add point**, pick a board, click the map, fill the form
   and save. The point appears on the map and the record on its board.
3. **Resources**: fill **Request intake** and choose **Submit request**.
   Under **Requests and next actions**, read its number, owner and next
   action, then find it again with **Find a request**.
4. **Tasks**: on **My Tasks**, start one task of your acting position and
   complete it. Look at **Team Tasks**.

**Check yourself.**

- A request reads "received". Has anyone agreed to fill it? *No. Received,
  accepted, assigned, in progress and fulfilled are separate stages.*
- Who owns a request once it is accepted? *Whoever accepted it, until it is
  assigned.*
- Can you complete a task whose prerequisite is open? *No; it stays
  blocked.*

**Read next:** [Operator quickstart](OPERATOR-QUICKSTART.md), section 3.

## Module 4: field work without a connection

**For:** field users. **About 25 minutes.**

This module needs a network host, best one set up with the demonstration
("With the North Coast Storm demonstration" in the setup), and a phone,
tablet or laptop on the same network that trusts the host, as the
[network host guide](NETWORK-HOST.md) describes. The demonstration on your
own computer runs its server on that computer, so it cannot lose its
connection.

1. Open the host's address, install the app and sign in inside it, as the
   [field user guide](FIELD-USER.md) describes under "Install the app and
   work offline".
2. Choose the incident and your position. Open **Settings > This computer**
   and wait until **Offline copy** reads "Kept on this computer".
3. Turn Wi-Fi off. Close the app and open it again: it opens marked "No
   connection · working offline".
4. On **Tasks**, **My Tasks**, complete one task of your position. It is
   queued on the device.
5. If your organization has a field form, queue a report on **Smart Forms**
   with **Queue field report**. The demonstration has none, and says "No
   field forms available".
6. Turn Wi-Fi on. Choose **Reconcile queued work** on **Tasks** and watch
   the completion reach the server.

**Check yourself.**

- Is a queued report received? *No. Only synced is.*
- Can you create a new task offline? *No. Only the completion of an
  assigned task queues.*
- Can you sign in for the first time with no connection? *No. Sign in
  before you leave coverage.*

**Read next:** [Field user guide](FIELD-USER.md), all of it.

## Module 5: reach people

**For:** members and administrators. **About 20 minutes.**

1. **Contacts**: find a contact, then the **Groups** and the order each
   calls people in.
2. **Mass Notification**: write a **Subject** and a **Message**. Under whom
   to reach, tick the position you are acting in under **Positions:
   whoever holds each now**. Choose **Everyone at once**, tick **In app**
   only, and choose **Send notification**.
3. Read the receipts: how the send found each person, and the state of each
   channel.
4. In the notification center, open your notice and choose **Acknowledge
   notification**. The receipts show the acknowledgement.

**Check yourself.**

- In **Call-down, one contact at a time**, when is the next contact
  notified? *When the current one has not acknowledged within the minutes
  to wait.*
- An email reads "Waiting for a route". Is it lost? *No. It is held and
  retried until its channel's window closes, 72 hours unless an
  administrator changed it.*

**Read next:** [Reach contacts and page a duty officer](OPERATOR-QUICKSTART.md#reach-contacts-and-page-a-duty-officer).

## Module 6: plan the operational period

**For:** planning staff. **About 30 minutes.**

1. Open **ICS Forms** under Planning and select the operational period.
2. Choose the 202 in **Form to start** and **Start form**. Write two
   objectives and **Save and mark ready**.
3. Do the same for the 208 safety message.
4. Under **Assemble the IAP from these forms**, keep the ticked forms and
   choose **Assemble IAP**, then **Review it in the IAP workspace**.
5. Back on **ICS Forms**, open a form's **Versions** and **Print** one.

**Check yourself.**

- A form saved as a draft: is it in the plan? *No. Only forms marked ready
  go into a plan.*
- The plan is approved and the 205 changes. What happens? *The approved
  plan stays approved; its next revision starts as a draft with the new
  205, waiting for approval.*

**Read next:** [Write the period's ICS forms](OPERATOR-QUICKSTART.md#write-the-periods-ics-forms).

## Module 7: activate and close an incident

**For:** administrators. **About 20 minutes.**

1. Open **Incident Setup**.
2. Under **Activate an incident**, choose the **Severe Storm** template,
   name the incident, choose **Incident type** "Exercise", leave **Notify
   people when it activates** unticked, and choose **Activate**.
3. Choose the new incident in the incident menu. Open **Tasks** to see the
   checklists its positions received, and **Boards** for the boards it
   opened.
4. On **Incident Setup**, choose **Close incident** on it, read what closing
   leaves running, and choose **Confirm closeout**.
5. Read **Plans** on the same screen, and **Incident templates** if you are
   an instance administrator.

**Check yourself.**

- A template changes after an incident opened from it. Does the incident
  change? *No. An incident keeps the version it opened from.*
- Does closing an incident delete its records? *No. They stay readable, and
  an administrator can reopen it.*

**Read next:** [Prepare an incident](ADMIN.md#prepare-an-incident).

## Module 8: keep it running

**For:** administrators. **About 30 minutes.**

1. Open **Administration** from **Settings > General**. On **People**,
   create a practice account, then disable its sign-in.
2. On **Positions**, **Assign** the practice account to a position, then
   **Revoke** it.
3. On **Channels**, read **When a message cannot go out**: how long each
   kind of message waits for a route.
4. In the notification center, find a delivery's state. An administrator
   can **Resend** one that reads "Delivery failed" or "Expired, not sent".
5. Read, in the [disaster recovery runbook](DISASTER-RECOVERY.md), "Copies
   off the computer" and "Quarterly restore test"; on a host, also run
   **Check the Open Source EOC host** from the Start menu.

**Check yourself.**

- Someone lost both their authenticator and their recovery codes. What do
  you do? *Verify who they are, then on **People** select them and **Reset
  two-step sign-in** with the reason.*
- Where does a network host keep its daily backups, and why is that not
  enough? *In the host's `backups` folder, which is lost with the host; copy
  them off it.*

**Read next:** [Administrator guide](ADMIN.md) and
[Upgrade guide](UPGRADE.md).

## Training record

Keep one row per person and module, for the EOC's training file.

| Name | Module | Date | Minutes taken | Questions left open |
|---|---|---|---|---|
| | | | | |
