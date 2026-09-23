# Administrator Guide

Administrators configure the local instance and control incident access. The
application enforces current server authority; hiding a button is not an access
control.

## Install and protect the instance

Follow [the deployment guide](../../deploy/README.md). Run the application with
the `app_runtime` database role so Row-Level Security remains active. Protect
the deployment environment, database password, and credential-envelope secret,
and schedule tested backups before an activation.

Demo accounts and data are for exercises only. Remove or rotate the seeded
credentials before real operations.

### The first administrator

Every administrative task below is done on the **Administration** screen, which
needs an administrator to sign in. The first one is created once, outside the
application: the Windows desktop setup asks for the first administrator and
jurisdiction and creates both, and the server path does it as described under
"First incident" in [the deployment guide](../../deploy/README.md). After that,
no administrative task needs `psql` or `curl`.

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
| Records | Set retention periods; download the audit trail; export the jurisdiction |
| Channels | Configure the email relay and SMS provider notification rules send through; send a test message |
| Deployment | Show which optional integrations are enabled; provision a jurisdiction (instance administrators) |

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

## Optional integrations

Collaboration channels, facilities and shelters, meetings and briefings, and
patient, evacuee and asset tracking register their routes only when their names
(`collab`, `facilities`, `meetings`, `tracking`) are listed in
`OPENEOC_INTEGRATIONS` in the server environment. The **Deployment** tab shows
which are enabled. It cannot change them: edit the variable and restart the
server.

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
notification allowlist, which an admin sets with
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

Scheduled notification rules, due briefings and feed polls run on their own
through the server's scheduler; no one has to trigger them. A scheduled rule
or briefing runs under an enabled admin of its jurisdiction, so a jurisdiction
with no enabled admin runs none. Intervals are in
[the deployment guide](../../deploy/README.md#scheduler).

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

## During operations

Monitor authorization, source freshness, failed ingestion, offline queues, and
conflicts. Keep unknown and missing conditions visible. Do not mark an incident
closed until queued work is reconciled or deliberately accounted for; closeout
blocks later incident mutations.

The audit trail is append-only. Corrections are new attributed actions rather
than edits to history. Use domain screens for operational decisions; database
access is not a routine administrative workflow.

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
| `deliveries` | `delivery_outbox`, `federation_outbox` | a delivered or dead delivery was created before the period; a federation entry was received by the peer before the period |
| `feed_items` | `feed_items` | its source has not returned it within the period |
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
