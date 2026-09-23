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
  An operator with database owner access deletes the person's rows from
  `mfa_recovery_codes` and `person_mfa`; the person enrolls again at the next
  sign-in. Treat this as an identity-verification event and record why.

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

## During operations

Monitor authorization, source freshness, failed ingestion, offline queues, and
conflicts. Keep unknown and missing conditions visible. Do not mark an incident
closed until queued work is reconciled or deliberately accounted for; closeout
blocks later incident mutations.

The audit trail is append-only. Corrections are new attributed actions rather
than edits to history. Use domain screens for operational decisions; database
access is not a routine administrative workflow.

## Retention and audit export

Nothing is deleted by default. A jurisdiction admin sets a retention period in
days per data class with `PUT /api/v1/jurisdictions/:jurisdictionId/retention`,
for example `{"policies": [{"dataClass": "feed_items", "retentionDays": 90}]}`;
`null` keeps a class indefinitely. `GET` on the same path lists every class.
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

`GET /api/v1/jurisdictions/:jurisdictionId/audit/export?format=csv` (or
`format=json`) returns one page of the jurisdiction's audit events to an
admin, 100 by default and up to 500 with `limit`. Pass the next page's cursor
as `cursor`. CSV repeats its header row on every page and carries the next
cursor in the `x-next-cursor` response header, absent on the last page. A cell
that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gains a leading
single quote so a spreadsheet never runs it as a formula.

`format=json` requires `OPENEOC_SECRET_KEY` and answers 409 without it. It
returns `{ page, signature }`, where `page` holds the entries, `firstSeq`,
`lastSeq`, the `cursor` it was read from and `nextCursor`. To verify a page,
derive a key with HKDF-SHA256 from the UTF-8 bytes of `OPENEOC_SECRET_KEY`,
an empty salt and the info string `openeoc audit export v1`, 32 bytes long;
compute HMAC-SHA256 over the RFC 8785 canonical JSON of `page` (object keys
sorted, no whitespace); compare it with `signature.value` in hex. A set of
pages is complete when the first page's `cursor` is null, each later page's
`cursor` equals the previous page's `nextCursor`, and the last page's
`nextCursor` is null. Sequence numbers are shared by all jurisdictions, so gaps
between them are expected.

```js
// node verify.mjs page.json, with OPENEOC_SECRET_KEY in the environment
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v !== null && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v);
const { page, signature } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const key = Buffer.from(hkdfSync("sha256", process.env.OPENEOC_SECRET_KEY, "", "openeoc audit export v1", 32));
const mac = createHmac("sha256", key).update(canonical(page)).digest("hex");
console.log(mac === signature.value ? "valid" : "INVALID");
```

The signature is a keyed MAC: whoever can verify it could also produce one, so
it proves a page came from a holder of the server key, not from a particular
person.

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
