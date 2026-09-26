# Administrator Guide

Administrators configure the local instance and control incident access. The
application enforces current server authority; hiding a button is not an access
control.

## Install and protect the instance

Follow [the deployment guide](../../deploy/README.md). Run the application with
the `app_runtime` database role so Row-Level Security remains active. Protect
the deployment environment, database password, and credential-envelope secret,
and schedule tested backups before an activation.

Upgrade with the newer Windows setup program; the launcher backs up the
database before it migrates and does not migrate when that backup fails. The
[upgrade guide](./UPGRADE.md) states which databases upgrade in place, the
migration baseline boundary, and how to go back to the previous version.

The [disaster recovery runbook](./DISASTER-RECOVERY.md) sets the recovery
targets, schedules the daily backup, and covers copies off the computer,
restores and the quarterly restore test.

Demo accounts and data are for exercises only. Remove or rotate the seeded
credentials before real operations.

### The first administrator

Every administrative task below is done on the **Administration** screen, which
needs an administrator to sign in. The first one is created once, outside the
application: the Windows desktop setup asks for the first administrator and
jurisdiction and creates both, as described under "First jurisdiction and
admin" in [the deployment guide](../../deploy/README.md#first-jurisdiction-and-admin).
After that, no administrative task needs `psql` or `curl`.

## The Administration screen

**Administration**, under Data and administration in the navigation rail,
appears only to jurisdiction administrators and instance administrators. The
server refuses every administration request from anyone else, whatever the
screen shows. The screen acts on the jurisdiction selected in the console.

| Tab | What it does |
|---|---|
| People | Create accounts, add existing accounts, change roles, disable sign-in, reset two-step sign-in, remove people from the jurisdiction |
| Positions | Add positions; assign, reassign and revoke their holders |
| Guest access | Grant and revoke time-boxed read access for mutual-aid accounts |
| Notifications | Set the webhook and push allowlist; add notification rules and copy a webhook rule's signing secret, shown once; list, pause, change and remove rules |
| Records | Set retention periods; download the audit trail; export the jurisdiction; move records from a WebEOC board export in the WebEOC migration panel |
| Channels | Configure the email relay and SMS provider notification rules send through; send a test message |
| Deployment | Show which optional integrations are enabled; configure collaboration channels and the meeting bridge where they are enabled; provision a jurisdiction (instance administrators) |

A change to a role, a membership, the disabled flag or a guest grant applies to
the person's next request, including a request from a session they already
have open.

## People, roles, positions, and participants

- **Admin** manages the jurisdiction and owner-authorized incident work.
- **Member** performs routine jurisdiction work.
- **Viewer** reads only the records and fields the server authorizes.
- **Positions** are attributable ICS seats. End the outgoing session and assign
  the incoming person at shift change.
- **Incident participants** grant bounded, current mutual-aid access. Verify the
  incident, home organization, position, expiration, and contribution role.
  Revocation or expiration takes effect on the next authorized read or write.

Do not replace incident participation with a broad board grant. Board and
position grants keep their exact scope and do not confer incident authority.

### Manage people

On the **People** tab:

- **Create an account.** Choose "Create a new account", enter the name, email,
  a first password of at least 12 characters and the role, and select **Add
  person**. Give the password to the person by a separate channel. An
  administrator enrolls in two-step sign-in at the first sign-in.
- **Add an existing account.** Choose "Add an existing account" and enter the
  account's email and the role. The person keeps their password and any access
  they hold elsewhere.
- **Change a role, disable sign-in, reset two-step sign-in or remove a
  person.** Select the person's name in the table. Role changes and removals
  never leave the jurisdiction without an administrator. Removing a person also
  ends their position assignments in the jurisdiction.

Disabling an account ends its sign-in everywhere at once and keeps its records
and history. Because it reaches every jurisdiction the person belongs to, a
jurisdiction administrator may disable only a person whose every membership is
in a jurisdiction that administrator administers; an instance administrator may
disable anyone. Nobody disables their own account; ask another administrator.

Membership changes, disabling and enabling, and two-step sign-in resets are
recorded in the audit trail.

### Positions

On the **Positions** tab each position shows who holds it. **Assign** adds a
holder. **Reassign** replaces every current holder with the chosen person, for
shift change. **Revoke** ends one person's assignment. A person already acting
in a position keeps acting in it until they sign out of it, so end the outgoing
session as well. **Add a position** creates a position beyond the standard ICS
set that provisioning creates.

### Guest access

On the **Guest access** tab, enter the guest's account email, choose what they
may read (positions, or individual boards) and when access ends, and select
**Grant access**. The guest signs in with their own account. **Revoke access**
ends a grant before it expires. Ended grants stay listed with their state.
A board the guest has open live under a revoked grant is closed at once.

## Two-step sign-in (MFA)

Local password accounts support a second factor: a time-based one-time code
(TOTP, six digits, 30-second step) from any standard authenticator app.

- **Who must enroll.** Jurisdiction admins and instance admins must enroll
  before a password sign-in issues a session. Enabling IPAWS is an admin act,
  so this covers every account that can enable it. Members and viewers are
  not asked to enroll.
- **Enrollment.** After the password, an admin who has not enrolled sees a
  setup key and a setup link. Add the account to an authenticator app with
  either one and enter the code it shows. The screen then shows ten recovery
  codes once. Store them offline; the server keeps only their hashes.
- **Signing in.** An enrolled person is always asked for a code after the
  password. A recovery code works in place of a code, once. A code that has
  already been accepted cannot be used again. Five wrong codes pause attempts
  for thirty seconds. The step between password and code expires after five
  minutes.
- **Audit.** Enrollment, recovery code use and wrong codes are recorded in
  the audit trail of each jurisdiction the person belongs to.
- **Secret key.** Authenticator secrets are stored under the
  credential-envelope key, `OPENEOC_SECRET_KEY`. Without it enrollment is
  refused, so admins cannot complete a password sign-in. Set the key before
  admins first sign in.
- **Switch.** `OPENEOC_REQUIRE_ADMIN_MFA=0` removes the admin requirement, for
  example on an isolated training laptop. It is on by default. A person who
  has enrolled is still asked for a code.
- **Single sign-on.** OIDC sign-in does not pass through this step. Require a
  second factor in the identity provider for accounts that sign in that way.
- **Lost authenticator and recovery codes.** There is no self-service reset.
  Verify the person's identity, then on the **People** tab select their name,
  enter the reason and select **Reset two-step sign-in**. Their authenticator
  secret and recovery codes are deleted, the reason is recorded in the audit
  trail, and they enroll again at their next sign-in. The same authority rule
  as disabling applies, and nobody resets their own. The table shows who has
  enrolled.

## Prepare an incident

1. Activate the appropriate incident template.
2. Set and verify the incident area and operational period. Revisions are
   append-only; a correction creates a new revision.
3. Assign positions and selected partner participants.
4. Confirm required boards and forms are attached to the incident.
5. Configure data sources and inspect registry presence, ingestion state,
   freshness, coverage, rejected rows, and retained last-good data separately.
6. Confirm task assignments and prerequisites before operators begin work.

Other preparation happens on the screens that use it:

- **Incident templates.** A template is the positions an incident opens
  with, its boards, and each position's checklist. On **Incident Setup**, an
  instance administrator sees **Incident templates**: **New template** takes
  a title (the key follows it), ticks the standard ICS positions and any the
  template adds with **Another position**, ticks the boards, and takes each
  position's checklist one item per line. **Save template** makes version 1;
  **Edit** and a save make the next version. A save over a version someone
  else replaced is refused, so reopen and save again. **Versions** lists each
  version with who saved it; **Load into the editor** brings one back to save
  as the newest. An item that came with a category, a task key or a due rule
  keeps them while its text stays the same. **Activate an incident** offers
  every template the database holds, and an incident keeps the version it
  opened from: a later edit changes no incident already open. Every version
  is kept and cannot be changed. On **Tasks**, **New task** adds a task of
  the incident's own beside the template's.
- **What a packaged template also opens.** A template that came in a signed
  solution package may also name contact groups, report templates and
  notification rule templates; the editor lists them under the checklists and
  keeps them through an edit. On activation, a contact group the jurisdiction
  lacks is made holding its contacts at the named positions, in that order;
  one it already has is used as it is. Each report is made on the incident's
  board of its template, scoped to the incident; a scheduled one stores its
  file, and recipients are added on **Reports**. Each rule is made on the
  incident's board, reaching the positions and contact groups it names. A
  save is refused, with the reason, when a report or rule runs on a board the
  template does not open, or reaches a position or contact group it does not
  name.
- **The incident room.** A packaged template may also name dashboard
  templates, message threads and file folders. On activation each dashboard
  is made for the incident, titled with its name; while the incident is
  selected, **Dashboards** lists its own first and leaves out other
  incidents'. A thread with no positions is incident-wide, read by everyone
  on the incident; one with positions reaches their holders. Each folder
  appears on **Files** under the incident, where **File into folder** files
  an upload in it and **Show folder** lists one folder's files. A save is
  refused when it names a dashboard template the instance lacks or a thread
  position the template does not open. The [small EOC starter pack](../../deploy/packs/small-eoc-starter/README.md)
  is one such package.
- **Plans.** A plan is the jurisdiction's emergency plan as something the
  product runs. On **Incident Setup**, **Plans** lists them for every member;
  **Read** shows a plan's sections and timed tasks. An administrator's **New
  plan** takes a title, the kind (an incident response plan, or a recurring
  event plan such as a fire season or a festival), the incident template it
  activates, and how many days between reviews. Each section has text and
  ticks for the template's positions, boards, contact groups and rules that
  carry it out. Each timed task goes to one of the template's positions and
  is released a number of hours after activation (for a recurring event,
  hours from the event's start, negative for before it), with an optional
  number of hours it is due within. **Notify people when the plan
  activates** addresses contact groups, the holders of positions and whoever
  is on call for them, by email, text message or in the app. A save is
  refused, with the reason, when it names a part the template does not open.
  **Save plan** makes version 1, and each later save the next version;
  **Versions** lists them, and **Load into the editor** brings one back.
  **Activate** asks for the incident's name (and, for a recurring event, when
  this occurrence starts), opens the incident from the template, releases
  each task whose time has come, keeps the others hidden until the scheduler
  releases them to their position with a notice, and sends the plan's
  notice, in one step; the result says how many tasks went out, how many
  wait and how many people the notice reached, and **Switch to** moves the
  console to the new incident. The incident's setup shows the plan's
  sections at the version it opened from and the tasks still to be
  released. A task waiting on a closed incident is not released unless the
  incident is reopened. When a plan's review falls due, the jurisdiction's
  administrators get one notification; **Mark reviewed** starts the next
  interval.
- **Libraries.** On **Incident Setup**, **Add a library** (administrators)
  stores a scenario, plan or reference text. A library attached to a template
  is linked to each incident activated from that template afterwards; the
  incident's setup panel lists its libraries.
- **Dashboards.** Under **Jurisdiction dashboards** at the foot of
  **Overview**, an administrator creates a dashboard from a published
  dashboard template key, optionally pinning a version and a title. With an
  incident selected, anyone who can see a dashboard downloads its template as
  JSON with **Export template**.
- **Standing lifeline status.** At the foot of **ESFs & Lifelines**,
  administrators and members record the jurisdiction's lifeline status outside
  any incident. A situation report composed without an incident uses it. It
  needs a board made from the Community Lifelines template; without one the
  server refuses the entry and the screen shows why.
- **Parcel baseline.** On **Damage Assessment**, **Parcel baseline**
  (administrators) imports the parcels field assessments are matched against,
  from CSV with a header of `parcelId`, `address`, `structureType`,
  `replacementValue` and optional `lon` and `lat`, or from a JSON array of
  those objects. A parcel ID already present is replaced.
- **Dataset records.** On **Datasets**, **Load records** sends a GeoJSON
  FeatureCollection or a JSON list of source records to a registered dataset.
  The load replaces the dataset's items, mapped by its field mapping, and
  reports how many records were accepted and rejected.
- **Message settings.** On **Messages**, **Message settings**
  (administrators) sets the message retention in days, after which messages
  are no longer shown or exported, and whether incident thread messages are
  written to the incident's audit trail. Saving sets both values; the values
  in effect are not shown.

## Optional integrations

Collaboration channels, facilities and shelters, meetings and briefings, and
patient, evacuee and asset tracking register their routes only when their names
(`collab`, `facilities`, `meetings`, `tracking`) are listed in
`OPENEOC_INTEGRATIONS` in the server environment. The **Deployment** tab shows
which are enabled. It cannot change them: edit the variable and restart the
server.

### Collaboration channels

With `collab` enabled, the **Deployment** tab shows **Collaboration channels**
to a jurisdiction administrator. Choose Mattermost or Matrix, enter the chat
server address and the access token the chat server issued for this platform
(a Mattermost bot token or a Matrix access token), and for Matrix the
homeserver domain used in user ids if it differs from the server address.
Select **Use this backend for incident channels** and **Save collaboration
settings**. The server stores the token encrypted under `OPENEOC_SECRET_KEY`
and never returns it; the screen shows only whether a token is stored. Leave
the field blank to keep the stored token. A server without
`OPENEOC_SECRET_KEY` refuses to store one.

For an incident, open **Incident Setup**, choose **Operational area** on the
incident, and use its **collaboration channels** section:

- **Set up channels** (administrators) creates one channel for the whole
  incident and one per ICS section the incident carries, with the position
  holders as members, matched by email address.
- **Update membership** (administrators) matches the channels to the current
  position holders after a reassignment.
- **Post announcement** (administrators and members) posts into the chosen
  channel.
- **Archive channels** (administrators) archives the incident's channels.

With no backend in use, these actions notify the incident's position holders
in the app instead, and the screen says so. When the chat server is in use but
does not answer (the internet is out, or the server is down), an announcement
also goes to the position holders in the app rather than being lost, and so
does notice of a channel setup that could not run; the screen names the
server's error. Setting up channels and updating membership can be run again
once it answers, and archiving asks to be tried again. The screen cannot show whether an
incident's channels already exist, because the server reports only the
backend's settings.

### Meetings and briefings

With `meetings` enabled, the **Deployment** tab shows **Meeting bridge**.
Enter the Jitsi server address and select **Offer meeting bridges for
incidents**. For a Jitsi deployment that requires signed tokens, also enter
its app id and token secret: each join link then carries a token signed for
the person who opened it, valid for four hours, and administrators join as
moderators. The secret is stored encrypted and never shown. Without a secret,
join links are plain room links.

In the incident's **meetings and briefings** section, members and
administrators open a bridge for the whole incident or for one ICS section.
The room is created once; a later **Open bridge** for the same section
returns the same room. Join links open in a new tab. Members and
administrators also schedule a briefing with a title, a start time and the
section it is for. When a briefing falls due, the scheduler notifies the
incident's position holders in the app, and the briefing table shows when
they were notified. Viewers see the bridges and briefings with no controls.

IPAWS, collaboration, meeting, federation, feed, and webhook adapters require
separate configuration. A local alert, release, message, or request is not proof
that an external system received it. Use the connector-specific status and
observed remote evidence before making a delivery claim.

Webhook and push notifications are queued with the board change that caused
them and sent by a background worker, so a slow or unreachable target never
delays an operator's write. A notification reads `pending` until the target
accepts it. Failed attempts retry with increasing delay; after eight failures
the notification is marked `failed` with the last error. A target that keeps
failing is paused for a minute at a time without using up attempts.

Webhook and push rules reach only destinations on the jurisdiction's
notification allowlist, which an admin sets on the **Notifications** tab of
the Administration screen, one destination per line, or with
`PUT /api/v1/jurisdictions/:jurisdictionId/notification-allowlist`. The list
starts empty, so no external destination is reachable until an admin adds
one. An entry is an exact origin such as `https://hooks.example.org` or
`https://ntfy.example.org:8443`, or a host suffix such as `*.example.org`
(https only). Plain http is accepted only for an exact loopback origin. A
host admitted by a suffix must resolve to a public address; to reach a
private, loopback or link-local host, list its exact origin. A rule whose
destination is not listed is refused when it is created. Removing a
destination later stops delivery to it: queued notifications for it are
marked `failed` with the reason, and redirects from a destination are not
followed.

Each rule queues at most 60 webhook or push deliveries per 10 minutes unless
it was created with a different `rateLimit` (`max` up to 600, `windowMinutes`
up to 1440). Deliveries beyond the cap are not sent; they are counted on one
`suppressed` notification per rule and window, which admins see with the
other notifications.

An admin adds a rule under **Add a notification rule** on the same tab: the
board (or any board), when it fires (a record is created, a record is
updated, or on a schedule every so many minutes), an optional condition (a
field equals a value, or changes to a value), one or more channels, and the
rate cap. A rule with a webhook channel gets a signing secret, shown once
under **Signing secret for the new rule** with **Copy secret**; it cannot be
read again. The receiver checks the `x-openeoc-signature` header, `sha256=`
followed by the HMAC-SHA256 of the request body with that secret. A
destination off the allowlist is refused with the server's reason, and the
draft is kept.

A channel may address people by where they sit rather than by address.
**Contact group** reaches the group's active contacts; **Position** reaches
**Whoever holds it now** (the position's own contact card and each holder,
through the holder's card) or **Whoever is on shift in it now** (Staffing's
shifts, or the holders when no one is on shift). **Reach each by** chooses the
in-app notice, email, SMS or a mix; each person's first email address and
first phone number are used, and a holder with no contact card is reached in
the app only. Who that is gets worked out each time the rule fires, so the
rule follows reassignments and shift changes. A group or position that
reaches no one when the rule fires leaves a failed notification saying so,
which admins see with the other notifications; the rate cap counts each
email and SMS.

**Notification rules** on the same tab lists the jurisdiction's rules, each
with its board, when it fires, its condition and where it sends, and whether
it is active or paused. **Pause** stops a rule sending until **Resume**.
**Change** opens the rule in the form, which becomes **Change a notification
rule**; **Save rule** replaces its board, trigger, condition, channels and
rate cap, and new channels are checked against the allowlist as at creation.
A rule that gains its first webhook shows its signing secret once, as a new
one does. **Remove** asks for **Confirm removal**; a removed rule stops firing
and leaves the list, and what it already sent stays in the notification log.
Only an administrator of the jurisdiction lists, changes or removes rules,
with `GET /api/v1/jurisdictions/:jurisdictionId/notification-rules`, `PATCH
/api/v1/notification-rules/:ruleId` and `DELETE
/api/v1/notification-rules/:ruleId`. Each creation, change and removal is
recorded in the audit trail as `notification.rule_created`,
`notification.rule_changed` or `notification.rule_removed`.

An email, SMS or push message names the board by its title and the record by
its first text field, as in "Shelter status record updated: McKinleyville
Library", followed by each changed field with its label, as in "Status:
Closed (was Normal)", or for a new record each field with a value. A value
from a list of choices shows as its label. Only fields every reader of the
board may see are spelled out. A webhook body keeps the stored keys and
values for the program that receives it.

Scheduled notification rules, due briefings and feed polls run on their own
through the server's scheduler; no one has to trigger them. A scheduled rule
or briefing runs under an enabled admin of its jurisdiction, so a jurisdiction
with no enabled admin runs none. Intervals are in
[the deployment guide](../../deploy/README.md#scheduler).

A feed that cannot be reached stays enabled and keeps its last good items on
the map, marked stale. Its creator gets one **Feed failing** notification per
outage, which counts the failed tries and shows the latest error, rather than
one per poll; when the feed answers again it becomes **Feed recovered** with
the number of failures and how long the outage lasted. The audit trail records
`feed.ingest.failed` when an outage starts and `feed.ingest.recovered` when it
ends.

- IPAWS setup: [IPAWS enablement](../IPAWS-ENABLEMENT.md)
- Federation setup: [Federation setup](./FEDERATION-SETUP.md)

### Email and SMS channels

A rule can also send email and SMS. Each jurisdiction configures one SMTP
relay and one SMS provider on the **Channels** tab of the Administration
screen, or with `GET` and `PUT
/api/v1/jurisdictions/:jurisdictionId/notification-channels/:kind`, where
`kind` is `email` or `sms`. Nothing is sent by email or SMS until an
administrator saves a relay or provider; a rule that names a channel the
jurisdiction has not configured is refused when it is created.

- **Email.** The relay's host, port, connection security, optional user name
  and from address. Security is STARTTLS (upgraded before anything else is
  sent, and never sent in plain text if the relay does not offer it), TLS
  from the start, or none for a local relay that needs no sign-in. A relay
  that needs a sign-in must use STARTTLS or TLS; the server signs in with
  AUTH PLAIN or AUTH LOGIN.
- **SMS.** The fixture provider records each message on the server and sends
  nothing; the Channels tab lists what it recorded, marked `fixture: not
  sent`. It keeps the last 200 messages in the memory of the server process
  that recorded them, until that process restarts.
  The HTTP provider posts a form with `To`, `From` and `Body` to the provider
  URL with basic authentication, the shape Twilio-style APIs accept. Its URL
  must be on the notification allowlist, checked when it is saved and again
  before each send.

The relay password or provider token is stored encrypted with the server key
(`OPENEOC_SECRET_KEY`) and is never returned; the screen shows a fingerprint
of the stored one. Saving without a new password keeps the stored one. Each
change is recorded in the audit trail as `notification.channel_configured`.

The email or SMS channel in a rule lists recipients: `{"kind": "email", "to":
["duty@example.org"]}` or `{"kind": "sms", "to": ["+17075551234"]}`, with
numbers in E.164 form and at most 50 recipients. Each recipient is its own
delivery, retried and capped like a webhook: a rule's rate cap counts each
recipient. The allowlist does not apply to addresses or numbers. When the
relay or provider accepts a message, the delivery keeps its answer (the SMTP
reply and queue id, or the provider's message id). A relay or provider that
keeps failing is paused as a whole, not per recipient.

**Send test email** and **Send test SMS** send one message at once, outside
the queue, and show the relay's or provider's answer or its error. Each test
is recorded as `notification.channel_tested`.

### When a message cannot go out

Every email, SMS, webhook and push delivery is held while its relay, provider
or target cannot be reached, and retried with a growing wait of up to fifteen
minutes between tries. Nothing is dropped on a count of tries. While a
message waits, Notifications shows it as **Waiting for a route**, with when
the wait began, how long the message is kept and the last error. When its
window closes with no route, it reads **Expired, not sent** and stays in
Notifications. A message the relay or provider refuses, or one addressed to a
destination no longer on the allowlist, fails at once and reads **Delivery
failed**.

Each kind waits 72 hours unless an administrator sets another window, from 1
to 720 hours, under **When a message cannot go out** on the **Channels** tab,
or with `PUT /api/v1/jurisdictions/:jurisdictionId/delivery-holds/:kind` and a
body of `{"hours": 24}`; `GET` on `/delivery-holds` reads all four. A window
applies to messages queued after it is saved. Each change is recorded as
`notification.hold_set`.

An administrator can resend a failed or expired message from its detail in
Notifications (**Resend**), or with `POST
/api/v1/notifications/:notificationId/resend`. The resend is queued with a
fresh window, the notification returns to **Queued**, and the audit trail
records `notification.resent`. The metrics endpoint counts expired messages
under `openeoc_delivery_queue{status="expired"}`.

### Contacts and mass notification

The **Contacts** screen under Coordination is the jurisdiction's contact
directory and its call-down groups. Members read it; only administrators add,
change, delete, group and import contacts, and row-level security holds the
same rule in the database. A contact may be linked to an account that is a
member of the jurisdiction, or to one of its positions, so that mass
notifications also reach it in the app. Changes are audited as
`contact.created`, `contact.updated`, `contact.deleted`, `contact.imported`,
`contact_group.saved` and `contact_group.deleted`.

**Import from CSV** reads a comma-separated file whose first row names the
columns, quoted as spreadsheets write it. Columns are matched to name,
organization, title, email and phone by their header names; change the match
under the column pickers and **Check file** again. Several addresses or
numbers in one cell are separated by semicolons or commas, and numbers such as
`+1 (707) 555-0100` are reduced to E.164. **Check file** writes nothing and
lists every row with its problems. The import adds every row or, when any row
has a problem, none. At most 2,000 rows go in one import.

Members and administrators send mass notifications from the **Mass
Notification** screen, as described in the
[operator quickstart](OPERATOR-QUICKSTART.md#reach-contacts-and-page-a-duty-officer).
Each contact and channel becomes its own notification and, for email and SMS,
its own delivery through the jurisdiction's relay and provider, retried and
receipted like any other; each send is audited as `notification.mass_sent`.
A mass send is not a notification rule and no rule rate cap applies to it. It
is bounded instead by its size, at most 500 people, and its outside addresses
all come from the directory administrators keep. The scheduler advances
call-downs every 30 seconds (`OPENEOC_SCHEDULER_CALLDOWNS_MS`), as a
jurisdiction administrator. A broadcast's fallback needs no scheduler: the
later device's delivery is queued to fall due after the wait, held for its
window from then, and withdrawn with its notification when the recipient
acknowledges first. An activation's notice is a mass send that names its
incident.

**Acknowledgement links.** Each email and SMS carries a link with a random
token for that one recipient of that one send; only a hash of the token is
stored. The link needs no sign-in. Opening it shows a page with one
**Acknowledge** button and nothing about the message, so a mail scanner that
fetches links does not acknowledge by itself; the button records the
acknowledgement. A link works for 24 hours after its message is sent, and
answers "not valid or has expired" after that. Each address may open 30 links
a minute. Links point at `OPENEOC_PUBLIC_URL` when it is set, otherwise at the
address the sender reached the server on; set it when recipients reach the
server by a different address than operators do, or when a reverse proxy in
front of it is not named in `OPENEOC_TRUST_PROXY`. The server must be reachable
from recipients' phones for the link to work; an in-app notice, acknowledged
in the notification center, does not depend on it. SMS replies are not read.

**Retention.** Contacts are kept until an administrator deletes them; deleting
a contact removes it from its groups. Mark a contact inactive instead to keep
it on record while no send reaches it. A mass notification keeps its own
record of each recipient, with the name and the address used when it was
sent, and deleting the contact does not change that record. Mass notification
records are not purged by the retention classes; their notifications and
deliveries are, under `notifications` and `deliveries`, after which the
receipts show only the acknowledgement state.

## During operations

Monitor authorization, source freshness, failed ingestion, offline queues, and
conflicts. Keep unknown and missing conditions visible. Do not mark an incident
closed until queued work is reconciled or deliberately accounted for; closeout
blocks later incident mutations.

The audit trail is append-only. Corrections are new attributed actions rather
than edits to history. Use domain screens for operational decisions; database
access is not a routine administrative workflow.

### Archive and lock down an incident

The **Jurisdiction master view** on **Incident Setup** lists every incident the
jurisdiction owns with its status, guest access, open resource requests, open
tasks, board records, participating organizations, operational period and
dates. Members read it; the **Action** column is for administrators.

- **Archive** appears on a closed incident; an open incident cannot be
  archived. An archived incident leaves the incident list and the command
  bar's incident choices. Nothing is deleted: its records stay readable to
  those who could read them, and it stays read-only because it is closed.
  Choose **Archived only** or **Show archived too** under **Archived
  incidents** to find it, and **Unarchive** to return it to the lists.
- **Lock guest access** withholds one incident's boards and their records from
  guest grants. The database enforces it, so every later guest read from a
  screen, search or export is refused. A board a guest already has open live
  is closed at once and hears no further changes. Members of the
  jurisdiction and participating organizations keep their access. A lockdown
  is off by default and never applied automatically. **Lift lockdown**
  restores guest read. The incident list and the incident's setup show when
  guest access is locked.

Archiving, unarchiving, locking and lifting are recorded in the audit trail.

## Retention and audit export

Nothing is deleted by default. On the **Records** tab a jurisdiction
administrator enters a retention period in days for a data class and selects
**Save retention**; an empty field keeps that class indefinitely. Automation can
use `GET` and `PUT /api/v1/jurisdictions/:jurisdictionId/retention` instead.
The scheduler's purge runs hourly (`OPENEOC_SCHEDULER_RETENTION_MS`), deletes
at most 5,000 expired rows per class per jurisdiction per run, and records a
`retention.purged` audit event with the count per table, attributed to the
admin who last set the jurisdiction's policy.

| Data class | Tables | A row expires when |
|---|---|---|
| `notifications` | `notifications` and their `delivery_outbox` rows | it was created before the period and is not pending |
| `deliveries` | `delivery_outbox`, `federation_outbox` | a delivered, dead or expired delivery was created before the period (a resend of it stays and forgets which delivery it resent); a federation entry was received by the peer before the period |
| `feed_items` | `feed_items` | its source has not returned it within the period; the items of a feed's last successful poll stay however old, so a feed that cannot be reached keeps its last good picture |
| `tracking` | `tracked_objects`, `tracking_events` | the object's latest event is older than the period; the whole chain goes together |
| `staff_checkins` | `staff_checkins` | it was checked out before the period; open check-ins stay |

Never purged: the audit trail, meaning `audit_events` and every table guarded
by an append-only trigger, and incident records, including those of closed
incidents, because records retention law varies by jurisdiction. The audit
trail leaves only by export. Tracking and facilities are optional
integrations; this version does not treat them as holding patient-level data.

### Export the audit trail

On the **Records** tab, **Download audit CSV** saves the jurisdiction's whole
audit trail, oldest first, as `audit-export.csv`. A cell that begins with `=`,
`+`, `-`, `@`, a tab or a carriage return gains a leading single quote so a
spreadsheet never runs it as a formula. **Download signed JSON** saves
`audit-export.json`, an array of signed pages; it needs `OPENEOC_SECRET_KEY` on
the server and reports an error without it.

Automation reads the same export a page at a time from
`GET /api/v1/jurisdictions/:jurisdictionId/audit/export?format=csv` (or
`format=json`), 100 events by default and up to 500 with `limit`, passing the
next page's cursor as `cursor`. CSV repeats its header row on every page and
carries the next cursor in the `x-next-cursor` response header, absent on the
last page.

Each signed page is `{ page, signature }`, where `page` holds the entries,
`firstSeq`, `lastSeq`, the `cursor` it was read from and `nextCursor`. To
verify a page,
derive a key with HKDF-SHA256 from the UTF-8 bytes of `OPENEOC_SECRET_KEY`,
an empty salt and the info string `openeoc audit export v1`, 32 bytes long;
compute HMAC-SHA256 over the RFC 8785 canonical JSON of `page` (object keys
sorted, no whitespace); compare it with `signature.value` in hex. A set of
pages is complete when the first page's `cursor` is null, each later page's
`cursor` equals the previous page's `nextCursor`, and the last page's
`nextCursor` is null. Sequence numbers are shared by all jurisdictions, so gaps
between them are expected.

```js
// node verify.mjs audit-export.json, with OPENEOC_SECRET_KEY in the environment.
// Accepts the screen's array of pages or a single page read from the API.
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v !== null && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v);
const pages = [JSON.parse(readFileSync(process.argv[2], "utf8"))].flat();
const key = Buffer.from(hkdfSync("sha256", process.env.OPENEOC_SECRET_KEY, "", "openeoc audit export v1", 32));
let ok = true;
pages.forEach(({ page, signature }, i) => {
  const mac = createHmac("sha256", key).update(canonical(page)).digest("hex");
  const linked = i === 0 || page.cursor === pages[i - 1].page.nextCursor;
  if (mac !== signature.value || !linked) ok = false;
});
console.log(ok ? "valid" : "INVALID");
```

The signature is a keyed MAC: whoever can verify it could also produce one, so
it proves a page came from a holder of the server key, not from a particular
person. After the key is rotated
([deploy/README.md](../../deploy/README.md#rotating-the-secret-key)), pages
signed before the rotation verify only with the old key.

### Forward the audit trail to syslog

Set `OPENEOC_SYSLOG_URL` to `udp://host:514` or `tcp://host:514`. The scheduler
then sends every jurisdiction's audit events as RFC 5424 messages (facility log
audit, severity informational, message id `audit`, the event as JSON) every 10
seconds (`OPENEOC_SCHEDULER_SYSLOG_MS`). TCP frames each message by octet count
(RFC 6587); a UDP message is cut at 8 KiB, so use TCP for large events.
Forwarding starts with events written after the sink first runs; use the export
for earlier history. A failed send is retried on the next run, so after a
failure an event can arrive twice but is not lost. A long-running database
transaction holds forwarding back until it finishes.

### Export the jurisdiction

On the **Records** tab, **Export jurisdiction** saves
`jurisdiction-export.tar.gz`: the jurisdiction's operational record and the
bytes of its stored files in one gzip-compressed tar archive that any tar tool
opens. The export runs as the administrator who asks for it, under the same
row-level security as every other request, so it holds only what that account
can read in the jurisdiction. Automation reads the same archive from
`GET /api/v1/jurisdictions/:jurisdictionId/export` with an administrator's
bearer token. The server streams the archive, but the screen holds all of it in
the browser before saving, so fetch a jurisdiction with gigabytes of files with
`curl -o` instead.

The archive holds `export.json` and a `files` folder. `export.json` carries
`schemaVersion` 2, `exportedAt`, `jurisdiction` and these sections:

| Key | Contents |
|---|---|
| `boards` | Every board with its `records`; geometry as GeoJSON |
| `sitreps` | The situation report archive |
| `lifelines` | Current lifeline status |
| `incidents` | Every incident with its operational area revisions (`areas`, geometry as GeoJSON), `participants` and attached `board_ids` |
| `iaps` | Every IAP revision; the ICS-204 assignments are inside `content` |
| `aars`, `aarObservations`, `correctiveActions` | After-action reports, their observations and corrective actions |
| `resourceRequests` | Every request with its `costs` and state `history` |
| `tasks` | Incident tasks with their `prerequisite_task_ids` |
| `assessments`, `assessmentDecisions` | Lifeline and ESF assessments and the decisions that select among them |
| `publicAssistanceItems` | Public Assistance line items from the damage assessment, every status; geometry as GeoJSON |
| `files` | Metadata of every stored file version, with the `archive_path` of its bytes |

Rows in the sections from `incidents` on keep their database column names.
Schema 1 exports were plain JSON with only `jurisdiction`, `boards`, `sitreps`
and `lifelines`; those four keep the same shape in schema 2. Each section is
read in one transaction but not as one snapshot, so a change committed during
the export can appear in a later section and not an earlier one.

`files/<sha256>` holds each distinct file content once, named by its SHA-256
hash, however many versions or names share it. To unpack and check every file:

```sh
tar -xzf jurisdiction-export.tar.gz
cd files && for f in *; do echo "$f  $f"; done | sha256sum -c
```
