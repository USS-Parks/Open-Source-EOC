# VEOC-80 dashboard read-policy proposal

Status: proposed, not applied. Automatic approval review blocked this change.

The current dashboard policy permits jurisdiction members only. The requested
change also permits an active named incident participant when the server binds
that readable incident to the transaction and the dashboard has the same owner.

```sql
drop policy dashboards_read on dashboards;
create policy dashboards_read on dashboards for select using (
  is_member_of(jurisdiction_id)
  or exists (
    select 1 from incidents i
    where i.id::text = current_setting('app.incident_id', true)
      and i.jurisdiction_id = dashboards.jurisdiction_id
      and can_read_incident(i.id)
  )
);
```

The supporting service validates the incident UUID, calls getIncidentAuthority,
sets the context transaction-locally, and matches dashboard and incident owners.
Widget queries select that incident's attached boards and tagged records.
Writes retain their existing authority. No SECURITY DEFINER function is added.

Risk: dashboards are jurisdiction-owned definitions, not individually attached
to incidents. A participant can therefore discover those dashboard definitions
while working in an authorized incident. Data must remain limited to that
incident. The policy would be a persistent source migration, first exercised
only in throwaway local test databases; no production database is being changed.

Approval would authorize writing this migration and testing it. Landing still
requires the real database/browser allow-and-deny gate and independent review.
The automatic reviewer rejected it as an unverified session-setting-based
expansion of FOUO dashboard reads and requires informed, explicit approval.
