# Administrator Guide

For the person who runs an OpenEOC instance.

## Install and first boot

Follow [../../deploy/README.md](../../deploy/README.md). After the stack is up,
set the `app_runtime` password and put its URL in `deploy/.env` so the app runs
under Row-Level Security, then re-apply. Back up `deploy/.env`: it holds the
database password and the secret key for credential envelopes.

## Bootstrap the first jurisdiction and admin

Create the first jurisdiction and its admin once (via `psql` or the
provisioning endpoint). From then on, admins manage people and positions in
the app.

## People, positions, and roles

- **Roles** are `admin`, `member`, and `viewer`. Admins configure; members do
  the operational work; viewers read. Viewers are free and unlimited, and they
  cannot write.
- **Positions** are ICS seats. Assign a person to a position; at shift change,
  reassign it so the incoming holder takes over and the outgoing one steps
  down. Position-addressed messages and channel membership follow the seat.

## Integrations (all optional, all off by default)

- **IPAWS**: see [../IPAWS-ENABLEMENT.md](../IPAWS-ENABLEMENT.md). Disabled
  until a COG is configured and the MOA is acknowledged.
- **Collaboration** (Mattermost/Matrix) and **meetings** (Jitsi): configure a
  backend per jurisdiction; with none, the platform still runs and degrades to
  in-app notifications.
- **Federation**: see [FEDERATION-SETUP.md](./FEDERATION-SETUP.md).

## Backups and upgrades

Run `deploy/backup.sh` on a schedule and keep copies off the box. Upgrade by
pulling new code and re-applying compose; migrations run on boot and preserve
customization. Always back up first.

## The audit trail

Every action is attributed and the audit log is append-only. Corrections are
new events that point at the original; nothing is ever edited or deleted.
