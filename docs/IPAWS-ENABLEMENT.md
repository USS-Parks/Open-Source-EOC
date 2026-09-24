# IPAWS-OPEN Enablement (enable-at-will)

Open Source EOC can transmit CAP 1.2 alerts to FEMA's IPAWS-OPEN, but the
connector ships **disabled**. No instance sends a public alert until a
jurisdiction admin has completed two explicit steps and then flipped a
single switch. There is no redeploy in that path: once credentials exist,
going live is one API call.

This is deliberate. A public warning system that could fire on a
misconfiguration is worse than one that stays quiet. The connector fails
closed at every step (INV-7).

## What has to be true before an alert can leave the building

1. **A COG is configured.** An admin sets the Collaborative Operating Group
   id, the IPAWS-OPEN endpoint (test or production), and the COG credential.
   The credential is encrypted at rest with the server key
   (`OPENEOC_SECRET_KEY`); only an AES-256-GCM envelope and a short
   fingerprint are stored, never the secret in the clear. If the server has
   no secret key, configuration with a credential is refused.
2. **The MOA is acknowledged.** IPAWS access requires a signed Memorandum of
   Agreement with FEMA. The admin records the MOA reference; the
   acknowledgment is stamped with who and when, and is auditable.
3. **Enablement is toggled on.** Only after both of the above will
   `enable` succeed. Turning it back off is always allowed.

Miss any prerequisite and `enable` returns `409` naming what is missing.

This project has not made a live send. Doing so needs Basho's authorized
IPAWS-OPEN COG credentials and a signed MOA with FEMA; until both exist, the
test suite reaches only a loopback stand-in that answers with the recorded
IPAWS-OPEN responses.

## On screen

All of this is done in the notification center (the bell, then **Open
center**).

- **Where a send would go.** Under the heading, every member sees one line
  naming the destination and whether IPAWS is enabled: *IPAWS not
  configured*, *Fixture endpoint, not FEMA* (any endpoint that is not an
  https FEMA IPAWS-OPEN host), *IPAWS test environment*, *Production IPAWS,
  disabled*, or *LIVE production IPAWS*.
- **Configure.** An admin opens the **IPAWS** tab, chooses the environment,
  enters the COG id, the IPAWS-OPEN endpoint and the COG credential, and
  selects **Save configuration**. The credential field clears once saved and
  the credential is never shown again; the screen shows only its
  fingerprint. To change the COG id or endpoint later, leave the credential
  blank and the stored one is kept.
- **Acknowledge the MOA.** Enter the MOA reference and select **Acknowledge
  MOA**. The screen then shows the reference and when it was recorded.
- **Enable.** **Enable IPAWS** stays unavailable until a credential and the
  MOA are recorded. **Disable IPAWS** is always available.
- **Request a send.** In **Alert records**, open a local alert that passes
  the IPAWS profile, submit it for local review and approve it. An admin
  then selects **Request IPAWS send**, or **Request test handshake** while a
  test configuration is not yet enabled. Nothing is sent; the screen says a
  different admin must confirm by the expiry time.
- **Confirm.** A different admin opens the **IPAWS** tab. **Send requests**
  lists each request with the alert headline, the requester, and the time
  left to confirm, with **Confirm send** and **Cancel request**. The
  requester sees **Confirm send** disabled on their own request. After
  confirmation the request shows *Accepted by IPAWS-OPEN* or *Rejected by
  IPAWS-OPEN* with the reason; a lapsed request shows *Expired without
  confirmation*, and a withdrawn one *Cancelled*.

## The endpoints

| Step | Call |
|---|---|
| Read status | `GET /api/v1/jurisdictions/:jurisdictionId/ipaws` |
| Configure the COG | `PUT /api/v1/jurisdictions/:jurisdictionId/ipaws/config` |
| Acknowledge the MOA | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/moa` |
| Enable or disable | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/enable` |
| Request a test-environment handshake | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/test` |
| Request an alert transmission | `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws` |
| List send requests | `GET /api/v1/jurisdictions/:jurisdictionId/ipaws/sends` |
| Confirm a send (second admin) | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/confirm` |
| Cancel a pending send | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/sends/:sendId/cancel` |

Every route is admin-only except reading status, which any member may do.
The full surface is listed in [API.md](./API.md).

## Two-person rule

Nothing reaches the IPAWS-OPEN endpoint on one admin's word. Requesting a
handshake or an alert transmission answers `202` with a pending send request
and sends nothing. A different admin of the same jurisdiction then confirms
it, and only then is the alert posted, under the confirming admin. The
requesting admin cannot confirm their own request (`403`), and a database
constraint refuses a confirmation recorded by the requester.

A request expires 15 minutes after it is made; confirming it afterwards
returns `409`, and the send must be requested again. Any admin may cancel a
pending request. The audit trail records `ipaws.send.requested`,
`ipaws.send.confirmed` or `ipaws.send.cancelled`, and `ipaws.submitted`,
each naming the admin who acted; the confirmation and the submission also
name the requester. A jurisdiction therefore needs at least two admins to
transmit.

A confirmed request is sent once. The confirmation is recorded before
IPAWS-OPEN is called and the outcome after it, so an endpoint that does not
answer is recorded as rejected with the reason. If the server stops between
the call and the record, the request stays confirmed with no submission; it
cannot be sent again, and a new send must be requested.

The recorded-fixture path in the test suite injects a transport in place of
the HTTP one and sends single-handed; the server refuses a single-handed send
through the HTTP transport.

## The test handshake

Before going live, an admin can validate the configuration against the
IPAWS-OPEN **test** environment with `POST .../ipaws/test`. This posts a
stored CAP alert through the same connector and records the outcome, but it
does not require enablement. It only runs when the configured environment is
`test`, so a production COG is never exercised by a dry run. It still
contacts the configured endpoint, so it takes a second admin's confirmation
like any other send. The connector's behavior against recorded IPAWS-OPEN
responses is covered by the fixtures in `server/src/ipaws/__fixtures__/`.

## What gets transmitted

Only a stored CAP alert that passes the FEMA IPAWS Profile v1.0
(`ipaws_eligible`) can be transmitted. A merely valid CAP alert that is not
profile-complete is refused with `422`. Every attempt, accepted or
rejected, is written to `ipaws_submissions` and the audit trail, attributed
to the admin who confirmed it and naming the admin who requested it (INV-2).

## Operator checklist

- [ ] `OPENEOC_SECRET_KEY` is set in the deployment.
- [ ] COG id, endpoint, and credential configured for the jurisdiction.
- [ ] MOA reference recorded.
- [ ] At least two admins hold the jurisdiction admin role.
- [ ] Test handshake against the IPAWS test environment, requested by one
      admin and confirmed by another, returns accepted.
- [ ] Enable toggled on; status shows `enabled: true`.
