# FEMA and IPAWS Integration: What It Takes

Research date: 2026-09-25. Sources are FEMA's public pages and documents, listed at the end. No FEMA or IPAWS office was contacted; under CLAUDE.md, every outbound step below waits on Basho's separate authorization.

## Short answer

1. **FEMA does not certify or endorse software.** There is no "officially FEMA-integrated" status for an EOC platform. FEMA's own AOSP list says it "does not certify or endorse any vendor product."
2. **IPAWS is the only formal gate, and it has two separate tracks.**
   - **The developer track is yours, as the project.** You sign a developer MOA and Rules of Behavior. FEMA then issues a test certificate, the web-service endpoints and the Interface Design Guide. You build and test against the IPAWS-OPEN test environment. Once that works, you can volunteer a demonstration, which puts the product on FEMA's list of providers with demonstrated IPAWS capabilities.
   - **The alerting-authority track belongs to each jurisdiction that deploys OpenEOC.** Each one completes training, signs its own MOA to get a COG, gets alerting permissions signed, installs its certificates, and sends a proficiency message every month.
3. **The IPAWS connector in this repo will not work against the real IPAWS-OPEN.** Its SOAP format, authentication, namespace and response parsing all differ from FEMA's Interface Design Guide. It has to be rebuilt before the developer test step can pass. See "Connector gaps" below.
4. **The other FEMA touchpoints need no approval from FEMA.**
   - OpenFEMA is open data with a required disclaimer.
   - NIMS has had no software certification since 2013.
   - The grant lists cover alert and warning systems as a category, not by product.

## Track 1: the project as an Alert Origination Software Provider (AOSP)

### Steps (IDG v4.02 section 3.3 and 4; FEMA AOSP page)

1. Register for an IPAWS User Portal account. An IPAWS team member approves portal access.
2. Complete a Developer Application in the portal.
3. Review and sign the developer Memorandum of Agreement (MOA).
4. Review and sign the Rules of Behavior (ROB). Their text is not public; it arrives with the MOA.
5. FEMA returns:
   - the executed MOA and ROB
   - a digital certificate
   - COG profile permissions
   - the web-service endpoints
   - the IPAWS-OPEN Interface Design Guidance
6. Build and test in the IPAWS-OPEN development environment. The IDG says AOSPs "are required to test their product" there "to ensure they meet critical capabilities recommended by FEMA." That capability list is not published; ask for it.
7. Optionally, demonstrate the product to the IPAWS office to be added to the "Demonstrated IPAWS Capabilities" list. The April 2026 list names 30 providers, including one EOC platform (Juvare WebEOC). None of them is open source.

Access is free. Vendor webinars and the vendor distribution list are requested through ipaws@fema.dhs.gov.

### What FEMA needs from you on this track

- **A sponsoring organization, and a signer with authority to enter agreements with the United States government.** This is the wording of the 2015 MOA application form (FEMA Form 007-0-25), which the portal has since replaced. It is unconfirmed whether an individual or an unincorporated open-source project can sign; see "Questions to put to the IPAWS office."
- **Three points of contact** (primary, alternate and technical), each with an official email address.
- **A description of the system:**
  - its name and function
  - whether it will issue public alerts over EAS, WEA or NOAA Weather Radio
  - where the host server is
  - its software type (COTS, custom-designed or other)
  - the data it will send to and receive from IPAWS-OPEN
- **A data-sensitivity attestation.** The system holds no classified data, IPAWS-OPEN data is Sensitive But Unclassified, and no Law Enforcement Sensitive data or sensitive PII passes through it.
- **A working interface in the test environment**, and a demonstration of it if you want to be listed.

## Track 2: each jurisdiction as an Alerting Authority (COG)

### Steps (Process Map Playbook v2.0, sign-up page, tribal fact sheet of May 2025)

1. **Consult the state.**
   - A municipality may need county approval before it can apply to the state.
   - Federally recognized tribal nations are not subject to state review or approval. FEMA encourages them to coordinate with neighboring jurisdictions.
2. **Complete IS-247 (currently IS-247.c)** and submit its certificate. The Playbook also lists IS-251 for alerting administrators; the sign-up page calls it optional.
3. **Select IPAWS-compatible software.** Its provider must hold an executed MOA with IPAWS. This is why Track 1 has to come first.
4. **Apply for a COG through the portal.** FEMA prepares an MOA tailored to the organization and its software, and returns it for signature with a COG ID.
5. **Apply for public alerting permissions.** The application lists the event codes the jurisdiction intends to use and its geographic area. A designated state official signs it, or tribal leadership for a tribe.
6. **Receive authorization and set up.**
   - Install the digital certificates in the software.
   - Complete initial and vendor software training.
   - Practice in the Technical Support Services Facility (TSSF), the IPAWS Lab.
7. **Keep up the monthly proficiency demonstration.**
   - Send one message each month to the IPAWS Lab environment, with status `Actual`.
   - Use this exact text: "TEST TEST TEST. This is a Proficiency Demonstration Test Message. No action is required."
   - One miss brings a reminder. Two in a row and the state is notified. Three in a row and production access is lost until a successful demonstration.
   - A FEMA tip, seen only through a search summary, says a new certificate is issued automatically after three years if the monthly requirement is met.
8. **NOAA Weather Radio (NWEM).** No separate NWS permission is needed at COG level any more. Record NWEM in the MOA and coordinate message types with the local NWS Warning Coordination Meteorologist.

Grant funding: FEMA's tribal fact sheet points to the Tribal Homeland Security Grant Program for alert software. AEL item 04AP-09-ALRT, "Systems, Public Notification and Warning", names IPAWS and applies to EMPG, SHSP, THSGP and UASI.

The TSSF is staffed around the clock: fema-ipaws-lab@fema.dhs.gov, 1-844-729-7522.

## Connector gaps: FEMA's interface versus this repo

The table compares the IPAWS-OPEN Interface Design Guide v4.02.06 (a draft FEMA published in September 2024) with the code in this repo.

| Area | IDG v4.02 requires | Repo today |
|---|---|---|
| Service namespace | `http://gov.fema.ipaws.services/IPAWS_CAPService/` | `http://www.integratedpublicalertsystem.gov/IPAWS_CAPService/` (`server/src/ipaws/connector.ts:12`) |
| Authentication | WS-Security 1.0 with an X.509v3 `BinarySecurityToken`. The SOAP Body is signed with RSA-SHA256, exclusive canonicalization and a SHA-256 digest, and the Reference URI must equal the Body's `wsu:Id` | A PIN or secret in an `x-ipaws-pin` HTTP header (`connector.ts:84-89`) |
| COG identity | SOAP header `CAPHeaderTypeDef` holding `logonUser` and `logonCogId`. The certificate CN must contain the `logonCogId` | A `<cogId>` element in the body (`connector.ts:76`) |
| CAP signature | Every alert carries an enveloped XML signature, with exclusive canonicalization. Reformatting after signing breaks it. A bad signature returns codes 208 and 221, and validation stops there | Not signed |
| Response | `postCAPResponseTypeDef`, with one `subParaListItem` group per channel: `CHANNELNAME`, `STATUSITEMID`, `ERROR` (Y/N) and `STATUS` | Looks for `postCAPResponse/return/errorCount` (`connector.ts:129-148`) |
| Partial outcomes | Permissions are checked channel by channel (CAPEXCH, NWEM, EAS, CMAS, PUBLIC). One channel can reject an alert that another accepts | A single `accepted` boolean |
| Credential | A certificate and its private key: a keystore, not a PIN | One encrypted string (`server/src/ipaws/service.ts:80-95`) |
| Environments | Monthly demonstrations go to the Lab while production stays live. Certificate numbers identify the environment: staging 12xxxxx, demo/test 3xxxxxx, production 2xxxxxxx | One config row per jurisdiction (`ipaws_config` primary key `jurisdiction_id`), either test or production. The handshake refuses a production config |
| Connectivity check | `getAck` and `getServerInfo`, which need no alert | The test handshake posts a stored CAP alert |
| Channel content | Rules per channel: `CMAMtext`, 90 and 360 characters for WEA, the Spanish character set, `WEAHandling`, `EAS-ORG`, `BLOCKCHANNEL`, 1,800 characters for EAS. For NWEM, senderName reads `<COGID>,<CogName>,<Requesting Agency>` | `shared/src/cap/validate.ts` checks profile basics only |
| Fixtures | Real responses from the test environment | `server/src/ipaws/__fixtures__/` does not match the IDG response schema, so it was not recorded from IPAWS-OPEN, although `docs/IPAWS-ENABLEMENT.md` says it was |

**The response parser fails open.** When a real IPAWS-OPEN rejects a channel, it answers HTTP 200 with `ERROR` set to `Y` inside `postCAPResponseTypeDef`. That response has no SOAP Fault and no `return` element, so `parseIpawsResponse` falls through to `accepted: true` at `connector.ts:148`. The operator would see "Accepted by IPAWS-OPEN" for an alert that was not disseminated. This cannot fire today, because an unsigned request draws a Fault, but it would fire as soon as signing works. That contradicts the fail-closed rule in `docs/IPAWS-ENABLEMENT.md`.

**Version note.** FEMA's AOSP page says the MOA package includes the "IPAWS-OPEN v3.11 Web-Service Interface Design Guidance". The v4.02.06 guide used above is marked DRAFT. Build against whichever guide and WSDL arrive with the developer MOA.

**Library note.** Neither `server` nor `shared` depends on an XML signature library today. The rebuild needs exclusive-canonicalization XML signing and the ability to load a PKCS#12 key.

## FEMA beyond IPAWS

- **Endorsement and branding.** FEMA does not approve, endorse or certify products. Do not use the FEMA or DHS logos or seals without written permission. Do not describe the product as "FEMA-certified" or "FEMA-approved". "IPAWS-compatible" is fair only after testing in the IPAWS-OPEN test environment. Being on the demonstrated-capabilities list is the most the product can claim, and the list itself disclaims endorsement.
- **NIMS.** The NIMS Supporting Technology Evaluation Program (STEP) stopped taking applications on 2013-10-01, and nothing has replaced it. DHS S&T SAVER market surveys (for example, incident management software in January 2022) are surveys, not certifications.
- **OpenFEMA.** No registration or API key is needed. Any product that uses it must carry this statement: "This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s)." The data may not be used to decide an individual's rights or benefit eligibility. The repo does not use OpenFEMA today.
- **The IPAWS All-Hazards Information Feed** is the read side: live public CAP alerts over HTTP. It is free, and access starts with IPAWS User Portal registration. FEMA's IPAWS-OPEN page says developers can use it "for redistribution and/or situational awareness."

## Questions to put to the IPAWS office

1. Which legal entity can sign the developer MOA for an open-source project: an individual, a company, or a fiscal sponsor?
2. Do the Rules of Behavior restrict publishing the interface code, WSDL-derived types, or test responses in a public repository? FEMA posts the IDG draft publicly, which suggests the interface description is not restricted; certificates plainly are.
3. For self-hosted deployments, how should Appendix A of each jurisdiction's MOA be completed? This covers the software type, the host location per jurisdiction, and the vendor contact when there is no vendor support contract.
4. Does one demonstration by the project cover every self-hosted instance? What is on the "critical capabilities recommended by FEMA" list?
5. Which interface version should new development target, v3.11 or v4.02?

## Sequence

1. **Rebuild the connector from the published IDG (code only, no FEMA contact).**
   - WS-Security signing.
   - CAP enveloped signing.
   - The real namespace and header.
   - A per-channel, fail-closed response parser.
   - Keystore storage.
   - A Lab COG held beside the production COG.
   - Channel content validation.
   - `getAck` as the handshake.
2. **Developer MOA.** Needs Basho's authorization. Register on the portal, file the developer application, and sign the MOA and ROB. Receive the certificate, the endpoints, the WSDL and the current IDG.
3. **Test environment.**
   - Check connectivity with `getAck` and `getServerInfo`.
   - Run `postCAP` for each channel.
   - Replace the local fixtures with recorded responses.
   - Reconcile the code with the IDG version FEMA issued.
4. **Optional demonstration** to join the list.
5. **Pilot alerting authority.**
   - Training, COG MOA and signed permissions.
   - Production certificate installed.
   - TSSF practice.
   - The monthly proficiency demonstration running from OpenEOC.

## Sources

- [FEMA: Alert Origination Software Providers](https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system/technology-developers/alert-origination-software-providers)
- [FEMA: Demonstrated IPAWS Capabilities, AOSP list, April 2026](https://www.fema.gov/sites/default/files/documents/fema_continuity_ipaws-capabilities-alert-origination-software-providers_05182026.pdf)
- [FEMA: IPAWS-OPEN](https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system/technology-developers/ipaws-open)
- [FEMA: IPAWS-OPEN Interface Design Guide v4.02.06 (draft, September 2024)](https://content.govdelivery.com/attachments/USDHSFEMA/2024/09/11/file_attachments/2994434/IPAWS-OPEN-v4-02-06_InterfaceDesignGuide_Draft.pdf)
- [FEMA: Sign Up to Use IPAWS](https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system/public-safety-officials/sign-up)
- [FEMA: IPAWS Process Map Playbook v2.0 (February 2023)](https://www.fema.gov/sites/default/files/documents/fema_ipaws-process-playbook-version-2.pdf)
- [FEMA: How Tribal Nations Can Use IPAWS (May 2025)](https://www.fema.gov/sites/default/files/documents/fema_ncp_how-to-sign-up-for-ipaws-tribal-051625.pdf)
- [FEMA: Alerting Authorities (monthly proficiency demonstration)](https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system/public-safety-officials/alerting-authorities)
- [FEMA: IPAWS MOA Application, Form 007-0-25 (2015)](https://www.fema.gov/sites/default/files/2020-07/fema_ipaws_form-007-0-25_moa-application.pdf)
- [FEMA: IPAWS All-Hazards Information Feed](https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system/technology-developers/all-hazards-information-feed)
- [FEMA: IPAWS Tip, Monthly Proficiency Demonstrations (November 2023)](https://www.fema.gov/sites/default/files/documents/fema_ncp-tip-20-ipaws-monthly-proficiency-demonstrations.pdf)
- [FEMA: AEL 04AP-09-ALRT](https://www.fema.gov/grants/tools/authorized-equipment-list/04ap-09-alrt)
- [FEMA: OpenFEMA Terms and Conditions](https://www.fema.gov/about/openfema/terms-conditions)
- [FEMA FAQ: Does FEMA approve, endorse, or certify any products?](https://www.fema.gov/node/does-fema-approve-endorse-or-certify-any-products-or-companies)
- [Domestic Preparedness: DHS STEPs Forward to Identify NIMS Technology](https://www.domesticpreparedness.com/articles/dhs-steps-forward-to-identify-nims-technology/)
- [DHS S&T SAVER: Incident Management Software Market Survey (January 2022)](https://www.dhs.gov/sites/default/files/2022-01/SAVER%20IMS%20MSR_05Jan2022-508.pdf)
