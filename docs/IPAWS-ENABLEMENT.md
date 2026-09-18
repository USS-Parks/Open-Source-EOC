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

## The endpoints

| Step | Call |
|---|---|
| Read status | `GET /api/v1/jurisdictions/:jurisdictionId/ipaws` |
| Configure the COG | `PUT /api/v1/jurisdictions/:jurisdictionId/ipaws/config` |
| Acknowledge the MOA | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/moa` |
| Enable or disable | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/enable` |
| Test-environment handshake | `POST /api/v1/jurisdictions/:jurisdictionId/ipaws/test` |
| Transmit an alert | `POST /api/v1/jurisdictions/:jurisdictionId/cap/alerts/:alertId/ipaws` |

Every route is admin-only except reading status, which any member may do.
The full surface is listed in [API.md](./API.md).

## The test handshake

Before going live, an admin can validate the configuration against the
IPAWS-OPEN **test** environment with `POST .../ipaws/test`. This posts a
stored CAP alert through the same connector and records the outcome, but it
does not require enablement. It only runs when the configured environment is
`test`, so a production COG is never exercised by a dry run. The connector's
behavior against recorded IPAWS-OPEN responses is covered by the fixtures in
`server/src/ipaws/__fixtures__/`.

## What gets transmitted

Only a stored CAP alert that passes the FEMA IPAWS Profile v1.0
(`ipaws_eligible`) can be transmitted. A merely valid CAP alert that is not
profile-complete is refused with `422`. Every attempt, accepted or
rejected, is written to `ipaws_submissions` and the audit trail, attributed
to the admin who sent it (INV-2).

## Operator checklist

- [ ] `OPENEOC_SECRET_KEY` is set in the deployment.
- [ ] COG id, endpoint, and credential configured for the jurisdiction.
- [ ] MOA reference recorded.
- [ ] Test handshake against the IPAWS test environment returns accepted.
- [ ] Enable toggled on; status shows `enabled: true`.
