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
