# Small EOC starter pack

Day-one content for a small tribal or rural emergency operations center, as a
[solution package](../../README.md#signing-solution-packages). It names no
hazard and no place, so it serves any incident and any exercise scenario.
`package.json` is the unsigned source; sign it with your own publisher key
before an instance will take it.

## What it holds

| Part | Contents |
|---|---|
| Incident template **Small EOC activation (any hazard)** | The eight ICS Command and General Staff positions and a **Community Liaison**; seven boards; 29 activation checklist items, five of them due 30 to 120 minutes after activation; two contact groups; three reports; two notification rules; the overview dashboard; two message threads; four file folders |
| Incident template **Tabletop exercise (small EOC)** | Six positions, five boards, exercise checklists, an **Exercise players** contact group and the welfare follow-up report; see [TABLETOP.md](TABLETOP.md) |
| Board template **Welfare Checks** | One record per household that may need help: elders, people whose medical equipment needs power, people without transport. Directions and notes are read by members only |
| Form **Welfare check** | The same questions for field staff in **Smart Forms**, queued offline and filed on the welfare checks board |
| Report templates | **Shelter census** and **Open resource requests**, each stored as a PDF every 12 hours; **Welfare follow-up**, on demand |
| Rule templates | An immediate resource request reaches the Logistics Section Chief in the app and by email; a household changed to "needs help" reaches the Operations Section Chief and the **Community outreach** group in the app |
| Dashboard template **Small EOC overview** | Households needing help, immediate requests, welfare checks by status, roads closed, and recent significant events |

The activation template's other boards are the standard ones every instance
has: activity log, significant events, situation report, resource requests,
shelters and road closures.

## What activation opens

Activating **Small EOC activation (any hazard)** on an instance that has
imported the pack opens, with no other setup:

- the nine positions, making any the jurisdiction lacks, and each position's
  checklist;
- the seven boards, titled with the incident's name;
- the contact groups **EOC command and general staff** and **Community
  outreach**, each holding the jurisdiction's contacts at those positions in
  order. A group the jurisdiction already has under that name is used as it
  is. On a new instance the groups start empty: add each contact with their
  position on **Contacts**, and the next group made from the template holds
  them;
- the three reports, on this incident's boards. A scheduled report stores its
  file with the incident; add recipients on **Reports** if it should also be
  sent;
- the two notification rules, on this incident's boards;
- the **Small EOC overview** dashboard, titled with the incident's name, first
  on **Dashboards** while the incident is selected;
- two message threads on **Messages**: **EOC coordination**, read by everyone
  on the incident, and **Public information**, for the Public Information
  Officer and the Community Liaison;
- four folders on **Files**: **Situation reports**, **Maps and plans**,
  **Public messages** and **Cost recovery**.

## Import it

1. Make a publisher key once, off the network if you can:
   `node server/dist/main.js new-package-key --private publisher.key.pem --public publisher.pub.pem`
2. Sign the pack:
   `node server/dist/main.js sign-package --key publisher.key.pem --in deploy/packs/small-eoc-starter/package.json --out small-eoc-starter.signed.json`
3. Put `publisher.pub.pem` in the PEM bundle that `OPENEOC_TRUSTED_TEMPLATE_KEYS`
   names, and restart the server. On a Windows install, that is
   `trusted-template-keys.pem` in the profile folder
   ([Signing solution packages](../../README.md#signing-solution-packages)
   gives the folders).
4. As an instance administrator who administers the jurisdiction, open
   **Templates**, **Create template**, the **Import** tab, and choose the
   signed file under **Signed solution package**. The form joins that
   jurisdiction; everything else joins the instance.

Importing again changes nothing already there. An incident template you have
edited on screen is kept as you left it.

## Adapting it

Edit the incident templates on **Incident Setup**: positions, boards and
checklists change on screen, and the contact groups, reports, rules,
dashboard, threads and folders are kept through the edit. To change those, or the welfare checks board, edit
`package.json`, raise the version of what changed (a board, report, rule or
dashboard template is refused if its key and version are already on the
instance with other content), and sign and import it again.
