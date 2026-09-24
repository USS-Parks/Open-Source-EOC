# Partner Sharing PSPR: one incident, one shared picture

**Created:** 2026-09-24
**Author:** Basho Parks
**Status:** APPROVED by Basho on 2026-09-24 for STS execution with commit and
push per unit, with every default in section 2 ("V1 grant: partner sharing"
in `docs/process/V1-LEDGER.md`). This approval records the expansion of FOUO
reads to participating organizations described in section 1.
**Baseline:** `main` at `825cc68`.

## 1. Goal

Organizations that participate in an incident share that incident's working
information with each other and with the owner, instead of each seeing only
its own. Basho's direction, 2026-09-24: "The db access rules need to be
changed so that adjacent partners with access to the incident can share this
type of data," and "Partner organization permissions need to be changed to
allow for a greater freedom of information sharing."

The design fidelity review found three places where the database refuses
what the frames show, and the access map found why:

| What the frames show | Why it fails today |
|---|---|
| A partner liaison's lifeline actions linked to the county's requests, with owners such as "Logistics" | A partner cannot read the owner's resource requests (`rr_read` is owner membership only) or the owner's positions (`positions_read` is members only), and cannot name an owner outside its own organization. |
| A Caltrans liaison's message in the incident's recent activity | Thread members must belong to the thread's jurisdiction; `messages_read` and `messages_write` know nothing of incident participation; the audit write for a partner's post is refused. |
| One set of incident counts and work for everyone | Every organization sees only its own requests on the incident, so the owner does not see a partner's requests either, and counts differ by reader. |

**The rule after this plan.** An active participant in an incident (a grant
that is not revoked or expired, held by a person who still belongs to the
granted organization) reads the incident's shared information: its resource
requests and their history, the incident's positions and who holds them, and
incident-wide message threads. Contributors and coordinators write where
their organization is acting (posting, linking, naming owners, recording
progress on work assigned to them). Access follows the grant live: revoking or
expiring a grant removes it at once, with no copies left behind. Nothing
outside the incident widens: the owner's other incidents, jurisdiction-wide
boards, the whole position roster and jurisdiction threads stay as they are.

**This is an expansion of FOUO reads to participating organizations.** As
with VEOC-80 (`docs/process/VEOC-80-POLICY-APPROVAL.md`), Basho's approval of
this plan is the recorded approval of that expansion.

## 2. Decisions, with the default the plan uses

| # | Question | Default |
|---|---|---|
| 1 | Which participant roles read the shared information? | All active roles: viewer, contributor and coordinator. Writes stay with contributor and coordinator. |
| 2 | Do request costs (reimbursement figures) travel with the shared requests? | No. Requests, their states, notes and history are shared; costs stay with the organization that owns the request. |
| 3 | Who can read an incident-wide thread, and who can post? | Every active participant reads; contributors, coordinators and the owner's members post. The owner keeps members-only threads as today. |
| 4 | Can a partner start an incident-wide thread? | Yes, a contributor or coordinator, as an incident-wide thread only. |
| 5 | Who may name the owner of a stabilization action? | Any contributor or coordinator writing the assessment, from the incident's positions and its active participants. This names who is expected to act; it does not create a task or an obligation in the owner's workflow. |
| 6 | May the participant a request is assigned to record its progress? | Yes: the delivery transitions after assignment (deployed, demobilizing, closed) and notes, for requests assigned to that participant. |
| 7 | Does sharing continue after the incident closes? | Yes, for as long as the grant lasts, as incident reads do today. |

## 3. Units

One at a time in the canonical checkout: they share the policy migration and
the resource and messaging services. Each unit ships its migration, the
server changes, real-database tests for what it opens and what it keeps
closed, the screens that read the new access, and a receipt.

| Unit | What | Acceptance |
|---|---|---|
| PS1 | **Shared incident requests.** `rr_read` and `rr_events_read` add requests whose incident the reader can read (decision 1); `rr_costs_*` unchanged (decision 2). Request services read incident requests by incident for participants; the assigned participant records the delivery transitions (decision 6), with the audit row written to the owning organization through a narrow `audit_append` allowance for the request's own events. The Resources screen shows a participant the incident's requests from every organization, marked with each owner; the overview's request counts are the same for every reader. | Real-database tests: a partner viewer reads the owner's and another partner's incident requests and their history but not their costs, nor any request outside the incident; revocation and expiry end access; the assignee advances only its own assigned request; `cross-boundary-legs` and `resource` expectations move from per-organization lists to the shared list. Browser: a partner sees the county's requests on Resources. |
| PS2 | **Incident positions.** `positions_read` and `assignments_read` add positions attached to an incident the reader can read, through `incident_positions`, and their current holders; the rest of the roster stays members only. Task and incident views then show position titles and holders to participants. | Tests: a partner reads the incident's positions and holders, not the jurisdiction's other positions; the task list shows a position owner's title to a partner. |
| PS3 | **Linked actions across organizations.** Stabilization actions link any request or incident board record the writer can now read, and name their owner from the incident's positions and active participants (decision 5). The drawer shows the owner and opens the linked request for any reader. | Tests: a partner liaison links the county's request and names "Logistics Section Chief"; a link to another incident's request is still refused; the operational relationships service follows the same rule. |
| PS4 | **Incident-wide threads.** A thread gains an audience: members only (today's) or the whole incident. Read and post policies admit active participants of the thread's incident for incident-wide threads (decisions 3 and 4), computed live from the grant, so revocation cuts access. The partner's `message.sent` audit row is allowed into the owning organization for its own post. Messages show the sender's organization; the Messages screen lets a partner read and post in the incident's threads. Attachments stay out of scope. | Tests: a partner reads and posts in an incident-wide thread, reads nothing in a members-only thread, loses both on revocation; a viewer reads but cannot post; the activity feed shows the partner's message. Browser: a partner posts and the owner sees it. |
| PS5 | **Scenario and review.** The North Coast seed uses the new access as the frames do: the Energy liaison links the generator request and the substation crew request, naming the Logistics Section Chief and the Utility liaison; the Caltrans liaison posts the road status message. `DESIGN-FIDELITY-REVIEW.md` drops the differences this closes; `pnpm fidelity` refreshes the images. The full serial gate runs. | Frames 2 and 3 show the linked actions and the Caltrans message; `pnpm check:gate` green. |

## 4. Risks the units handle

- **Revocation.** Every new read is computed from the live grant, never from
  copied membership rows, so a revoked or expired partner loses access at
  once (threads today would keep a person member after revocation; incident-
  wide threads do not add person members).
- **Field masks.** Board field masks are applied by the service, not the
  database; any new path that shows a linked record goes through the same
  masking.
- **Partner to partner.** Sharing is incident-wide by design: each partner
  also sees the other partners' incident requests (decision 1). Costs stay
  private (decision 2).
- **Audit.** The `audit_append` allowances are limited to the actor's own
  request and message events on the incident, so a partner cannot write other
  audit rows into the owning organization.
- **Updates.** No `UPDATE` policy widens beyond the assignee's delivery
  transitions; `records_update` gains an explicit check that an incident
  record stays on its incident.

## 5. Execution

On approval: STS, one unit at a time, each with a receipt in
`docs/process/V1-LEDGER.md`, commit and push per unit under the standing
grant, the full serial gate at PS5. Out of scope: message attachments,
jurisdiction boards and threads, the position roster outside incidents, and
any change to who may create requests or tasks in another organization.
