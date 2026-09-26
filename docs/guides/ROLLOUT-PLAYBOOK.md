# Rollout Playbook for a Small EOC

This playbook takes a small tribal or rural emergency operations center from
a setup file to a system its staff trust in an activation. It is written for
a thin staff: two to six people who carry emergency management beside other
duties, with communications that fail when they are needed most, grant
funding, and mutual aid with the county and the state.

It has six steps, in order. Each ends with an exit check. Do not start the
next step until the check passes and the program lead has signed it on the
[sign-off sheet](#sign-off-sheet). A step that stalls is a finding, not a
failure: write down what stopped it.

The order is a proposal drawn from how other agencies adopt incident
management software, not a measured result. How long a person new to the
product takes to install it and open a first incident is measured by the
[timed onboarding](TIMED-ONBOARDING.md).

## Who does what

| Role | Usually, in a small EOC | In this playbook |
|---|---|---|
| Program lead | The emergency manager or EOC director | Sets the pace, signs each exit check |
| Administrator | Whoever looks after the EOC's computers | Installs, adds people, sets up channels and partners |
| Second administrator | Another trusted person | Holds a second administrator account, so one absence never locks the EOC out |
| Staff | Everyone who will sit a position | Completes the self-paced modules, the week of routine use and the tabletop |

One person may hold several roles. Name who holds which before step 1.

## Step 1: install, and prove you can recover

Choose where it runs:

- **One computer.** The setup, installed for your own account (its
  default), serves only the computer it runs on. **Open Source EOC** in the
  Start menu starts it; its first start asks, in a PowerShell window, for the
  first administrator and the jurisdiction.
- **Every computer, tablet and phone in the building.** The network host,
  the usual choice for an EOC with more than one seat. Follow the
  [network host guide](NETWORK-HOST.md) from "What the host needs" to "Keep
  time without the internet".

Then:

1. Install from removable media. Check the setup against the `.sha256` file
   beside it first, with your drive and setup file in place of these:

   ```powershell
   $setup = 'E:\Open-Source-EOC-Setup-0.9.2.exe'
   (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() -ceq (Get-Content "$setup.sha256").Trim()
   ```

   It must print `True`. The setup carries everything it needs; the install
   needs no internet.
2. On a host, leave **Check the host now** ticked on the setup's last page.
   It must end with `HOST CHECK PASSED`. Write down the thumbprint of the
   host's certificate authority it prints: every device compares against it.
3. With the internet unplugged, run **Check Open Source EOC with no
   internet** from the Start menu. It must end with `AIR-GAP CHECK PASSED`.
4. The first administrator signs in and sets up two-step sign-in with an
   authenticator app on a phone. The app needs no network to make codes.
   Write the ten recovery codes on paper, seal them in an envelope, and keep
   it away from the host.
5. On **Administration > People**, **Create a new account** for the second
   administrator, with the Admin role. They sign in and set up two-step
   sign-in too.
6. Give the network one clock, as
   [Keep time without the internet](NETWORK-HOST.md#keep-time-without-the-internet)
   describes. Two-step codes fail on a clock more than 30 seconds off.
7. On a host, connect each EOC computer, tablet and phone once and trust the
   host's authority:
   [Connecting another computer, tablet or phone](NETWORK-HOST.md#connecting-another-computer-tablet-or-phone).
8. Make sure backups run: a host backs up every day at 02:30; one computer
   needs the scheduled task in
   [Scheduled backups](DISASTER-RECOVERY.md#scheduled-backups). Copy a backup
   off the computer ([Copies off the computer](DISASTER-RECOVERY.md#copies-off-the-computer)),
   then restore that copy on a second computer by the
   [quarterly restore test](DISASTER-RECOVERY.md#quarterly-restore-test).

The rail lists the core sections at first. **Incident Setup**, **Contacts**,
**Mass Notification** and **Templates** appear once **Show every section**
is ticked under **Settings > General** (Settings is at the foot of the rail),
and **Open Administration** is on the same page.

**Exit check.**

- `HOST CHECK PASSED` on a host, and `AIR-GAP CHECK PASSED`, each with its
  date.
- Both administrators sign in with two-step codes.
- A backup copied off the computer was restored on a second computer, the
  restored system opened, and the times are in the runbook's table.
- Every EOC device opens the console with no certificate warning.

## Step 2: people, contacts and a test call-down

1. **Accounts.** On **Administration > People**, **Create a new account** for
   each person who will sit a position, with the role they need: Admin,
   Member or Viewer ([Manage people](ADMIN.md#manage-people)). Give each
   first password by a separate channel.
2. **Positions.** On **Administration > Positions**, **Assign** each person
   to the positions they may hold. The standard ICS positions are already
   there; **Add a position** adds your own, such as a Community Liaison.
3. **Contacts.** On **Contacts**, add everyone the EOC calls, or **Import
   from CSV**: staff, council members, department heads, partner duty
   officers. **Check file** lists every problem before anything is written.
   Link each staff contact to their account or position, so a mass
   notification also reaches them in the app.
4. **Groups.** Under **Groups**, make the call-down lists in the order you
   call people, for example "EOC staff" and "Council and department heads".
5. **Channels.** In-app notices need nothing more. Email needs a mail relay
   and text messages an SMS provider, set on **Administration > Channels**. A
   relay inside the building keeps email moving inside it when the internet
   is out. Leave **When a message cannot go out** at 72 hours unless you
   have a reason to change it
   ([When a message cannot go out](ADMIN.md#when-a-message-cannot-go-out)).
6. **Test call-down.** On **Mass Notification**, send to the staff group
   with **Call-down, one contact at a time**, every channel you set up, and
   "Available" and "Not available" under **Answers to ask for**. Each person
   answers from the link or the app. Read the receipts as
   [Reach contacts and page a duty officer](OPERATOR-QUICKSTART.md#reach-contacts-and-page-a-duty-officer)
   describes.

**Exit check.**

- Every staff member has signed in under their own account and acted in a
  position.
- The receipts of the test call-down show an answer from each member of the
  group, or name who was not reached and why.
- The time from sending to the last answer is written down.

## Step 3: a week of daily operations

1. On **Incident Setup**, **Activate an incident** from the **Daily
   Operations** template with **Incident type** "Daily operations". It opens
   an activity log, a significant events board and the Operations Section
   Chief's checklist.
2. Add the boards your routine work needs: on **Templates**, **Create a
   board from a published template**, then adapt it in the
   [board designer](DESIGNER.md). Records kept in WebEOC come across by the
   [WebEOC migration](MIGRATION.md).
3. Set up, on **Reports**, the reports you now write by hand
   ([Reports](REPORTS.md)).
4. For five working days, log the day's activity and significant events,
   and hand off each shift as
   [Hand off the shift](OPERATOR-QUICKSTART.md#6-hand-off-the-shift)
   describes.
5. Keep a list of what got in the way. Mark each item as a training need, a
   configuration change, or a problem to report
   ([Reporting problems](../EVALUATOR.md#reporting-problems)).

**Exit check.**

- Five working days of entries, by at least two people.
- One report produced from the boards.
- The list of what got in the way, each item with what was done about it.

## Step 4: an activation template and a tabletop

1. **Choose what you activate from.** Every install has three incident
   templates: **Wildfire**, **Severe Storm** and **Daily Operations**. The
   [small EOC starter pack](../../deploy/packs/small-eoc-starter/README.md)
   adds **Small EOC activation (any hazard)** and **Tabletop exercise (small
   EOC)**, with a Community Liaison, welfare checks, contact groups, reports
   and notification rules. Importing it needs the server to trust the key it
   was signed with (`OPENEOC_TRUSTED_TEMPLATE_KEYS`, under
   [Signing solution packages](../../deploy/README.md#signing-solution-packages)).
   The Windows setup has no option that sets that, and setting it by hand on
   an installed computer has not been tried. Until that is settled, build the
   template you need under **Incident Setup > Incident templates**
   ([Prepare an incident](ADMIN.md#prepare-an-incident)), using the pack's
   README as a list of what a small EOC activation opens.
2. **Put the emergency plan in the product.** Under **Incident Setup >
   Plans**, write the plan's sections, the template it activates, the tasks
   it releases to positions after activation, and whom it notifies
   ([Prepare an incident](ADMIN.md#prepare-an-incident), "Plans").
3. **Train.** Each person completes the
   [self-paced modules](SELF-PACED-TRAINING.md) for their role.
4. **Run a tabletop.** The starter pack's
   [tabletop](../../deploy/packs/small-eoc-starter/TABLETOP.md) names no
   hazard and takes any scenario. It is built on the **Tabletop exercise
   (small EOC)** template; on another template, play its injects on the
   boards that template opens and record what was missing. Activate with
   **Incident type** "Exercise" and **Notify people when it activates**
   unticked, so nothing leaves the room.
5. Record each corrective action with an owner and a date, as the
   tabletop's result template says.

**Exit check.**

- An incident activated in one action from the template you will use for
  real, with its positions, boards and checklists present.
- The tabletop run and its result template filled in.
- Each corrective action has an owner and a date.

## Step 5: county and state partners

1. **Partner people on your instance.** A county or state liaison who works
   in your EOC, or reads it from theirs, signs in with an account in their
   own organization on your instance; an instance administrator provisions
   that organization on **Administration > Deployment**. Then, on **Incident
   Setup**, **Participants** on the incident takes the organization code,
   the person's account email, their incident position, the role (Read only,
   Contributor or Coordinator), when it expires and why, and **Add
   participant** sends them an invitation in the app. For read access to
   chosen positions or boards for a set time, use **Administration > Guest
   access** instead.
2. **Federate with a county instance, where one exists.** Each side
   registers the other on **Federation**, sets the push link and shares the
   boards agreed on ([Federation setup](FEDERATION-SETUP.md)). A county host
   on its own certificate authority is trusted once its root is in your
   host's Windows certificate store
   ([Connections out through an agency authority](NETWORK-HOST.md#connections-out-through-an-agency-authority)).
   Federation holds updates through an outage and delivers them when the
   link returns.
3. **Write down the agreement**, in the mutual aid agreement or a
   memorandum: what each side shares, who may write, and how long a
   partner's access lasts. The product enforces what is configured, not
   what was meant.
4. **Escalate one request** to the next tier in an exercise
   ([Record costs and escalate a request](OPERATOR-QUICKSTART.md#record-costs-and-escalate-a-request)).

**Exit check.**

- A partner liaison opened your exercise incident under their own account
  and saw what the grant allows, which **Preview what ... can read** on the
  grant also shows.
- Where federated: an edit on a shared board reached the other side, in
  each direction the agreement allows.
- One resource request escalated in an exercise.

## Step 6: public warning and cost recovery

1. **IPAWS.** Enable it only once the tribe or county holds its Memorandum
   of Agreement with FEMA and the certificate FEMA issues for its
   Collaborative Operating Group. [IPAWS enablement](../IPAWS-ENABLEMENT.md)
   lists what has to be true first, the two-person rule and the test
   handshake. An alert needs a route to FEMA's servers; with the internet
   out, warning goes by the local routes the EOC keeps: radio, runners and
   printed call-down lists.
2. **Public Assistance cost capture.** Staff check in and out on
   **Staffing**, so their hours reach the force account on **Damage
   Assessment**, where equipment use is recorded against the **Resources**
   pool ([Force account](DAMAGE-ASSESSMENT.md#force-account)). Before a
   disaster, set each person's labor rate and import the equipment rates
   your agency uses; the product ships with none.

**Exit check.**

- IPAWS: the test handshake's answer, with its date, or "not enabled" and
  the reason.
- The tabletop incident's force account summary agrees with its check-ins
  and equipment hours.

## Sign-off sheet

Fill in one row as each exit check passes. A step signed with exceptions
names them.

| Step | Exit check met on | Result, exceptions and notes | Signed by |
|---|---|---|---|
| 1. Install, and prove you can recover | | | |
| 2. People, contacts and a test call-down | | | |
| 3. A week of daily operations | | | |
| 4. An activation template and a tabletop | | | |
| 5. County and state partners | | | |
| 6. Public warning and cost recovery | | | |
