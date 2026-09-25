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
   id, the IPAWS-OPEN endpoint (test or production), and the COG
   certificate: the certificate FEMA issued for the COG and its RSA private
   key, pasted as one PEM block. The server checks it as IPAWS-OPEN will
   before storing it: the key must be RSA, unencrypted and belong to the
   certificate, the certificate must be in date, and its CN must contain
   the COG id. A bundle that fails is refused with `422` naming the problem.
   The bundle is encrypted at rest with the server key
   (`OPENEOC_SECRET_KEY`); only an AES-256-GCM envelope, a short fingerprint
   and the certificate's expiry are stored, never the key in the clear. If
   the server has no secret key, configuration with a certificate is
   refused.
2. **The MOA is acknowledged.** IPAWS access requires a signed Memorandum of
   Agreement with FEMA. The admin records the MOA reference; the
   acknowledgment is stamped with who and when, and is auditable.
3. **Enablement is toggled on.** Only after both of the above will
   `enable` succeed. Turning it back off is always allowed.

Miss any prerequisite and `enable` returns `409` naming what is missing.

This project has not made a live send. Doing so needs a FEMA-issued COG
certificate and a signed MOA with FEMA; until both exist, the test suite
reaches only a loopback stand-in that answers with responses shaped after
the examples in FEMA's IPAWS-OPEN Interface Design Guide (IDG) v4.02.06.
None was recorded from IPAWS-OPEN.

## The certificate FEMA issues

FEMA sends each COG's digital certificate once the MOA is executed. If it
arrives as a Java keystore, convert it to PKCS#12, then write the
certificate and the unencrypted key into one PEM file:

```
keytool -importkeystore -srckeystore cog.jks -destkeystore cog.p12 -deststoretype PKCS12
openssl pkcs12 -in cog.p12 -nodes -out cog.pem
```

OpenSSL 3 may need `-legacy` on the second command for an older keystore.
Paste the whole of `cog.pem` into the certificate field, then delete
`cog.p12` and `cog.pem`: the second holds the key unencrypted.

## On screen

All of this is done in the notification center (the bell, then **Open
center**).

- **Where a send would go.** Under the heading, every member sees one line
  naming the destination and whether IPAWS is enabled: *IPAWS not
  configured*, *Fixture endpoint, not FEMA* (any endpoint that is not an
  https FEMA IPAWS-OPEN host), *IPAWS test environment*, *Production IPAWS,
  disabled*, or *LIVE production IPAWS*.
- **Configure.** An admin opens the **IPAWS** tab, chooses the environment,
  enters the COG id and the IPAWS-OPEN endpoint, pastes the PEM block into
  **COG certificate and private key (PEM)**, and selects **Save
  configuration**. The field clears once saved and the key is never shown
  again; the screen shows only the fingerprint and when the certificate
  expires. To change the COG id or endpoint later, leave the field blank:
  the stored certificate is kept and checked again against the new COG id.
- **Acknowledge the MOA.** Enter the MOA reference and select **Acknowledge
  MOA**. The screen then shows the reference and when it was recorded.
- **Enable.** **Enable IPAWS** stays unavailable until a certificate and the
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
  IPAWS-OPEN*, and an **IPAWS-OPEN answer** row names the public channels
  it acknowledged and any it refused, with the code, or the reason when
  nothing was processed; a lapsed request shows *Expired without
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
like any other send. The fixtures in `server/src/ipaws/__fixtures__/` give
the connector the answers the IDG shows: every channel acknowledged, one
channel refused, an invalid alert signature, and an expired certificate.
Each says it was shaped after the IDG, not recorded; they are replaced with
recorded answers once the test environment can be reached.

## What gets transmitted

Only a stored CAP alert that passes the FEMA IPAWS Profile v1.0
(`ipaws_eligible`) can be transmitted. A merely valid CAP alert that is not
profile-complete is refused with `422`.

IPAWS-OPEN refuses an alert whose `sent` time is more than five minutes old
(IDG code 303), and a second admin has fifteen minutes to confirm, so the
stored alert is serialized afresh with `sent` set to the moment of
confirmation, in CAP form (`2026-09-25T21:07:00-00:00`). An alert that has
expired by then is refused; author a new one.

The request follows the IDG (sections 5.3 and 8.2):

- the alert carries an enveloped XML signature, RSA-SHA256 over exclusive
  canonicalization, made with the COG certificate;
- the SOAP body is `postCAPRequestTypeDef` holding that alert, in the
  `http://gov.fema.ipaws.services/IPAWS_CAPService/` namespace;
- the SOAP header carries `CAPHeaderTypeDef`, with `logonCogId` set to the
  COG id and `logonUser` set to the confirming admin's email, and a
  WS-Security header with the certificate as a `BinarySecurityToken` and a
  signature over the body.

The certificate is checked again before anything is signed; one that has
expired or no longer matches the COG id is recorded as not sent, and no
call is made.

IPAWS-OPEN answers with a status for each channel (CAP exchange, the
profile checks, NOAA Weather Radio, EAS, WEA and the public feed). A send
counts as accepted only when IPAWS-OPEN lists at least one status and none
is flagged as an error. A SOAP Fault, any other HTTP status, or an answer
the connector does not recognize is a rejection. When some channels
acknowledge and others refuse, the send is recorded as rejected and the
answer names both, because the alert may already have reached the public on
the channels that acknowledged it. Do not request it again without reading
that answer.

Every attempt, accepted or rejected, is written to `ipaws_submissions` with
each channel's status and the signed alert exactly as transmitted, and to
the audit trail, attributed to the admin who confirmed it and naming the
admin who requested it (INV-2).

## Operator checklist

- [ ] `OPENEOC_SECRET_KEY` is set in the deployment.
- [ ] COG id, endpoint, and the COG certificate and key configured for the
      jurisdiction; the screen shows the certificate's expiry.
- [ ] The converted keystore and PEM files are deleted.
- [ ] MOA reference recorded.
- [ ] At least two admins hold the jurisdiction admin role.
- [ ] Test handshake against the IPAWS test environment, requested by one
      admin and confirmed by another, returns accepted.
- [ ] Enable toggled on; status shows `enabled: true`.
