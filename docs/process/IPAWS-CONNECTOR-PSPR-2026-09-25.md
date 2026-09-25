# IPAWS Connector PSPR

Plan date: September 25, 2026
Approval state: **APPROVED 2026-09-25.** Basho: "approved, run it STS",
with every section 4 default in force.
Author of record: Basho Parks.

## 1. Purpose

Rebuild the IPAWS-OPEN connector so that its requests and its reading of
responses match FEMA's IPAWS-OPEN Interface Design Guide (IDG) v4.02.06.
The gaps are listed in `FEMA-IPAWS-INTEGRATION-RESEARCH-2026-09-25.md`, under
"Connector gaps". No FEMA contact happens here, and no live test-environment
send. Both wait on the developer MOA.

## 2. Relationship to the other plans

- The two live rosters, `VEOCI-AIR-GAP-PSPR-2026-09-25.md` and
  `EXERCISE-SCENARIOS-PSPR-2026-09-25.md`, do not touch `server/src/ipaws/`,
  `web/src/ipaws/` or the IPAWS tests. This plan owns those files and
  touches nothing those rosters own.
- `FINISH-PSPR-2026-09-22.md` remains the execution contract: commits,
  ledger receipts and landing.

## 3. What the IDG requires (sections 4, 5.3, 8.2 and 8.4, and Table 109)

- The service namespace is `http://gov.fema.ipaws.services/IPAWS_CAPService/`,
  and the SOAPAction is `...IPAWS_CAPService/postCAP`. The request body is
  `postCAPRequestTypeDef`, wrapping one CAP `<alert>`.
- The SOAP header carries WS-Security 1.0:
  - an X.509v3 `BinarySecurityToken`;
  - a `ds:Signature` over the Body, using exclusive canonicalization,
    RSA-SHA256 and a SHA-256 digest. The Reference URI must equal the
    Body's `wsu:Id`.
- The header also carries `CAPHeaderTypeDef`, holding `logonUser` and
  `logonCogId`. The certificate CN must contain the `logonCogId`.
- The CAP alert carries its own enveloped signature, made with the same
  algorithms and certificate. Changing so much as whitespace after signing
  breaks it.
- The alert's `<sent>` must be within 5 minutes of the time IPAWS-OPEN
  receives it (code 303).
- The response is `postCAPResponseTypeDef`, made of per-channel groups of
  `CHANNELNAME`, `STATUSITEMID`, `ERROR` (Y/N) and `STATUS`. A certificate
  problem comes back as a SOAP Fault.

## 4. Decisions, with the default this plan takes

1. **Certificate input.** The admin pastes the FEMA certificate and its
   private key as one PEM block. It is stored in the existing encrypted
   credential envelope. The admin guide gives the `keytool` and `openssl`
   commands that convert a JKS or PKCS#12 keystore to PEM. *The
   alternative* is a PKCS#12 upload, which needs a new dependency to parse.
2. **logonUser** is the confirming admin's email, because the IDG saves it
   with each transaction for traceability. *The alternative* is a fixed
   value set per COG.
3. **`sent` is re-stamped at transmission.**
   - The stored alert is re-serialized with `sent` set to the time of the
     second admin's confirmation, in CAP form (`YYYY-MM-DDThh:mm:ss-00:00`).
     It is then signed and sent. Without this, the 15-minute confirmation
     window makes code 303 nearly certain.
   - The send is refused if any `expires` falls before the new `sent`.
   - The exact XML transmitted is stored with the submission.
4. **Acceptance is decided per channel, and the connector fails closed.**
   - A send is accepted only when IPAWS-OPEN returns at least one status
     item and none of them has `ERROR` set to Y.
   - A Fault, a non-2xx status, an unparseable body or an unrecognized shape
     is a rejection.
   - Every channel's result is stored and shown. When some channels
     acknowledge and others report errors, the screen names both: for
     example, "accepted on EAS, PUBLIC; rejected on CMAS (615)". A plain
     "Rejected" would hide an alert that did go out.
5. **Checks before any network call.** The certificate must parse, must not
   be expired, must pair with the key, and its CN must contain the COG ID.
   Configuring refuses a bundle that fails these checks (422), and sending
   refuses too, with the reason.
6. **Dependency.** Add `xml-crypto` (MIT) for exclusive canonicalization and
   XML signatures. Certificate parsing, expiry and key pairing use
   `node:crypto` `X509Certificate`. Production only signs, because the IDG
   says responses are not signed; the tests verify.
7. **The handshake** stays as a postCAP of a stored alert to the test
   environment. `getAck` and `getServerInfo` wait for the test-environment
   unit.

## 5. Units, in order

Work is serial on `main`, with one commit per unit, each green on its own.

**IC1. Server: connector, send path and storage.**
- `server/src/ipaws/connector.ts` gets the wire format, both signatures,
  the pre-flight checks and the per-channel parser (section 3 and
  decisions 1, 4 and 5).
- `server/src/ipaws/service.ts`:
  - configure validates the PEM bundle and records the certificate expiry;
  - confirm re-stamps `sent`, then signs and sends (decisions 2 and 3);
  - each submission stores its channels and the transmitted XML.
- The status response gains `certificateExpiresAt`.
- A new migration adds `ipaws_config.certificate_expires_at`, plus
  `ipaws_submissions.channels` (jsonb) and `transmitted_xml`.
- `server/package.json` and `pnpm-lock.yaml` add `xml-crypto`.
- Fixtures: replace `server/src/ipaws/__fixtures__/` with responses shaped
  after the IDG's own examples, each file saying so. There are four: all
  channels acknowledged, a CMAS permission error, an invalid signature
  (208 and 221), and an expired-certificate Fault.
- Tests:
  - `ipaws.test.ts` checks that the built request verifies against the test
    certificate (both signatures), the header and namespace, and each
    pre-flight refusal;
  - a regression test covers the old fail-open case: HTTP 200 carrying
    `ERROR` Y is a rejection;
  - `ipaws-send-browser.test.ts` and `write-path-network.test.ts` are
    updated;
  - the test certificate comes from the existing `selfSigned()` in
    `server/src/__tests__/smtp-relay.ts`, extended for RSA and a chosen CN.
    No key is committed.

**IC2. Web: certificate entry and channel results.**
- In `web/src/ipaws/IpawsPanel.tsx`, the credential input becomes a PEM
  text area, and the certificate expiry is shown.
- Send results list each channel.
- `web/src/ipaws/model.ts` drops `.integratedpublicalertsystem.gov`, a host
  the IDG never names, from the list of FEMA hosts.
- `web/src/ipaws/__tests__/ipaws.test.tsx` is updated.

**IC3. Documents.**
- `docs/IPAWS-ENABLEMENT.md`: the certificate bundle and its conversion,
  the CN rule, the `sent` re-stamp, per-channel results, and a correction of
  the claim that the fixtures were recorded from IPAWS-OPEN.
- Updates to `docs/API.md` for the status field, and to `CHANGELOG.md`.
- A receipt in `docs/process/V1-LEDGER.md`.

## 6. Verification gates

- Each unit runs `pnpm check` before it commits.
- IC3 closes with `pnpm check:gate`, which includes the advisory gate for
  the new dependency.
- A browser check of the IPAWS tab covers IC2: certificate entry, the
  expiry line, and the per-channel result against the loopback stand-in.
- Receipts record each command and its result.

## 7. Not in this plan

- The Lab COG held beside the production COG, for the monthly proficiency
  demonstration.
- Channel content validation: `CMAMtext`, 90 and 360 character limits, the
  Spanish character set, `WEAHandling`, `EAS-ORG`, `BLOCKCHANNEL`, and the
  NWEM senderName.
- `getAck`, `getServerInfo` and `getMessageStatus`.
- CAP date form for authored `effective`, `expires` and `sent`. Today
  `authorAlert` writes `toISOString()` with `Z`, which CAP 1.2 forbids.
- Any live test-environment send, which waits on the developer MOA. When
  FEMA's certificate, endpoints, WSDL and current IDG arrive, the fixtures
  are replaced with recorded responses and any version drift is fixed.

## 8. Completion

IC1 to IC3 land on `main`, each with its receipt. A built postCAP request
verifies under both signatures against its certificate. The parser rejects
every error shape in the IDG examples. The IPAWS tab takes a PEM bundle and
shows results by channel. Pushing stays Basho's separate instruction.
